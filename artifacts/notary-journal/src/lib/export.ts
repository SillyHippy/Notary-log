import jsPDF from 'jspdf';
import type { JournalEntry, NotarySettings } from './db';
import {
  resolveFeeType,
  rollupYear,
  MONTH_LABELS,
  type YearRollup,
} from './fees';

// ── PDF helpers ────────────────────────────────────────────────────────────

/**
 * Stamp the notary's seal in the lower-right corner of the *current* page.
 * Silently no-ops when no seal is configured. We try to detect PNG vs JPEG
 * from the data URL; jsPDF needs the format to be explicit.
 */
function addSealToCurrentPage(doc: jsPDF, sealImage?: string): void {
  if (!sealImage) return;
  try {
    const fmt = /^data:image\/jpe?g/i.test(sealImage) ? 'JPEG' : 'PNG';
    const w = 35;
    const h = 35;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    doc.addImage(sealImage, fmt, pageW - w - 12, pageH - h - 12, w, h);
  } catch (err) {
    // Don't let a malformed seal break PDF generation
    console.warn('Failed to embed notary seal in PDF:', err);
  }
}

/** Stamp the seal on every page that's currently in the PDF. */
function stampSealOnAllPages(doc: jsPDF, sealImage?: string): void {
  if (!sealImage) return;
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    addSealToCurrentPage(doc, sealImage);
  }
}

// ── Single-entry PDF ───────────────────────────────────────────────────────

export function exportEntryPDF(entry: JournalEntry, settings: NotarySettings): void {
  const doc = new jsPDF();
  // Header
  doc.setFontSize(18);
  doc.text('Official Notary Journal Record', 105, 20, { align: 'center' });
  doc.setFontSize(11);
  doc.text(`Notary: ${settings.notaryName}`, 20, 35);
  doc.text(`Commission: ${settings.commissionNumber}`, 20, 42);
  // Entry details in table-like format
  doc.setFontSize(12);
  doc.text(`Entry #${entry.entryNumber}`, 20, 55);
  doc.text(`Status: ${entry.status}`, 20, 62);
  doc.text(`Date: ${new Date(entry.createdAt).toLocaleString()}`, 20, 69);

  doc.setFontSize(14);
  doc.text('Signer Information', 20, 85);
  doc.setFontSize(12);
  doc.text(`Name: ${entry.signerFullName}`, 20, 95);
  doc.text(`Address: ${entry.signerAddress}`, 20, 102);
  doc.text(`City, State: ${entry.signerCity}, ${entry.signerState}`, 20, 109);

  doc.setFontSize(14);
  doc.text('Identification', 20, 125);
  doc.setFontSize(12);
  doc.text(`Type: ${entry.idType}`, 20, 135);
  doc.text(`Number: ${entry.idNumber}`, 20, 142);
  doc.text(`Expiration: ${entry.idExpirationDate}`, 20, 149);

  doc.setFontSize(14);
  doc.text('Notarial Act', 20, 165);
  doc.setFontSize(12);
  doc.text(`Act Type: ${entry.notarialActType}`, 20, 175);
  doc.text(`Document: ${entry.documentType}`, 20, 182);
  const feeStr = entry.feeWaived
    ? 'Waived'
    : `$${(entry.feeCharged / 100).toFixed(2)}`;
  doc.text(`Fee (${resolveFeeType(entry)}): ${feeStr}`, 20, 189);

  // Signature image
  if (entry.signatureImage) {
    doc.text('Signer Signature:', 20, 200);
    doc.addImage(entry.signatureImage, 'PNG', 20, 205, 80, 30);
  }

  // Footer
  doc.setFontSize(9);
  doc.text(
    `Generated: ${new Date().toISOString()} | Entry #${entry.entryNumber}`,
    105, 280, { align: 'center' },
  );

  // Notary seal in lower-right of every page
  stampSealOnAllPages(doc, settings.sealImage);

  doc.save(`notary-entry-${entry.entryNumber}.pdf`);
}

// ── CSV ────────────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'Entry Number',
  'Status',
  'Created At',
  'Updated At',
  'Completed At',
  'Signer Full Name',
  'Signer Address',
  'Signer City',
  'Signer State',
  'Signer DOB',
  'Signer Phone',
  'ID Type',
  'ID Number',
  'ID Issuing State',
  'ID Expiration Date',
  'Document Type',
  'Document Date',
  'Document Description',
  'Notarial Act Type',
  'Fee Type',
  'Fee Charged (USD)',
  'Fee Waived',
  'Location Address',
  'Location City',
  'Location State',
  'Notes',
  'Needs Review',
  'Extraction Method',
  'Extraction Confidence',
  'Integrity Hash',
  'Amendment Count',
  'Has ID Front Image',
  'Has ID Back Image',
  'Has Signature',
];

function csvField(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function generateCSVRow(entry: JournalEntry): string {
  const amendments = entry.amendments ?? [];
  return [
    entry.entryNumber,
    entry.status,
    entry.createdAt,
    entry.updatedAt,
    entry.completedAt ?? '',
    entry.signerFullName,
    entry.signerAddress,
    entry.signerCity,
    entry.signerState,
    entry.signerDOB,
    entry.signerPhone ?? '',
    entry.idType,
    entry.idNumber,
    entry.idIssuingState ?? '',
    entry.idExpirationDate,
    entry.documentType,
    entry.documentDate ?? '',
    entry.documentDescription ?? '',
    entry.notarialActType,
    resolveFeeType(entry),
    (entry.feeCharged / 100).toFixed(2),
    entry.feeWaived ? 'true' : 'false',
    entry.locationAddress ?? '',
    entry.locationCity,
    entry.locationState,
    entry.notes ?? '',
    entry.needsReview ? 'true' : 'false',
    entry.extractionMethod ?? 'manual',
    entry.extractionConfidence != null ? entry.extractionConfidence.toFixed(1) : '',
    entry.hash ?? '',
    amendments.length,
    entry.idFrontImage ? 'true' : 'false',
    entry.idBackImage ? 'true' : 'false',
    entry.signatureImage ? 'true' : 'false',
  ].map(csvField).join(',');
}

const csvHeader = CSV_HEADERS.join(',') + '\n';

export function exportEntryCSV(entry: JournalEntry): void {
  const csvContent = csvHeader + generateCSVRow(entry);
  downloadBlob(new Blob([csvContent], { type: 'text/csv' }), `notary-entry-${entry.entryNumber}.csv`);
}

export function exportEntryJSON(entry: JournalEntry): void {
  const jsonContent = JSON.stringify(entry, null, 2);
  downloadBlob(new Blob([jsonContent], { type: 'application/json' }), `notary-entry-${entry.entryNumber}.json`);
}

export function exportAllCSV(entries: JournalEntry[]): void {
  const csvContent = csvHeader + entries.map(generateCSVRow).join('\n');
  downloadBlob(new Blob([csvContent], { type: 'text/csv' }), `notary-journal-export-${Date.now()}.csv`);
}

// ── Backup envelope ────────────────────────────────────────────────────────

export const BACKUP_FORMAT_VERSION = 2;

export interface BackupEnvelope {
  version: number;
  exportedAt: string;
  entries: JournalEntry[];
  settings: NotarySettings;
}

export interface ParsedBackup {
  detectedVersion: 1 | 2;
  entries: JournalEntry[];
  settings: NotarySettings | null;
}

const REQUIRED_ENTRY_FIELDS: Array<keyof JournalEntry> = [
  'entryNumber', 'status', 'signerFullName', 'idType', 'idNumber',
  'documentType', 'notarialActType', 'createdAt',
];

/**
 * Parse and validate a backup/import payload. Accepts:
 *   - v2 envelope: { version: 2, entries, settings, exportedAt }
 *   - v1 envelope: { entries: [...] }            (no version field)
 *   - v1 bare array: [...]                        (legacy export)
 *   - single-entry object                         (per-entry export)
 *
 * The optional `feeType` per-entry field and `defaultFees`/`sealImage` settings
 * fields added in Task #15 are additive — older v2 backups without them parse
 * cleanly here, and newer backups with them are accepted by older versions
 * because `REQUIRED_ENTRY_FIELDS` does not include them.
 */
export function parseBackupFile(text: string): ParsedBackup {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Not a valid JSON file.'); }

  let entries: JournalEntry[] = [];
  let settings: NotarySettings | null = null;
  let detectedVersion: 1 | 2 = 1;

  if (Array.isArray(parsed)) {
    entries = parsed as JournalEntry[];
    detectedVersion = 1;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as { version?: unknown; entries?: unknown; settings?: unknown; entryNumber?: unknown };
    if (Array.isArray(obj.entries)) {
      if (obj.version !== undefined && typeof obj.version !== 'number') {
        throw new Error('Backup file has an invalid version field.');
      }
      const v = (obj.version as number | undefined) ?? 1;
      if (v > 2) throw new Error(`Backup format v${v} is newer than this app supports.`);
      detectedVersion = v >= 2 ? 2 : 1;
      entries = obj.entries as JournalEntry[];
      if (obj.settings && typeof obj.settings === 'object') {
        settings = obj.settings as NotarySettings;
      }
    } else if ('entryNumber' in obj) {
      entries = [obj as unknown as JournalEntry];
      detectedVersion = 1;
    } else {
      throw new Error('Unrecognized file format. Expected a journal backup or entry export.');
    }
  } else {
    throw new Error('Unrecognized file format.');
  }

  for (const e of entries) {
    if (!e || typeof e !== 'object') throw new Error('Backup contains a non-object entry.');
    for (const f of REQUIRED_ENTRY_FIELDS) {
      if (!(f in e)) throw new Error(`Entry is missing required field "${String(f)}".`);
    }
    if (typeof e.entryNumber !== 'number') throw new Error('Entry has non-numeric entryNumber.');
  }

  return { detectedVersion, entries, settings };
}

export function exportAllJSON(entries: JournalEntry[], settings: NotarySettings): void {
  const payload: BackupEnvelope = {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
    settings,
  };
  const jsonContent = JSON.stringify(payload, null, 2);
  downloadBlob(new Blob([jsonContent], { type: 'application/json' }), `notary-journal-export-${Date.now()}.json`);
}

// ── Bulk PDF (journal index) ───────────────────────────────────────────────

export function exportAllPDF(entries: JournalEntry[], settings: NotarySettings): void {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Official Notary Journal Export', 105, 20, { align: 'center' });
  doc.setFontSize(11);
  doc.text(`Notary: ${settings.notaryName}`, 20, 35);
  doc.text(`Commission: ${settings.commissionNumber}`, 20, 42);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 49);

  let y = 60;
  entries.forEach((entry) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    const fee = entry.feeWaived ? 'Waived' : `$${(entry.feeCharged / 100).toFixed(2)}`;
    doc.setFontSize(10);
    doc.text(
      `#${entry.entryNumber} | ${new Date(entry.createdAt).toLocaleDateString()} | ${entry.signerFullName} | ${entry.notarialActType} | ${resolveFeeType(entry)} | ${fee}`,
      20, y,
    );
    y += 10;
  });

  stampSealOnAllPages(doc, settings.sealImage);
  doc.save(`notary-journal-export-${Date.now()}.pdf`);
}

// ── Annual report exports ──────────────────────────────────────────────────

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Generate a year-end PDF report covering the requested calendar year.
 * Includes a totals row, a monthly breakdown, and a per-fee-type breakdown.
 */
export function exportYearReportPDF(
  entries: JournalEntry[],
  settings: NotarySettings,
  year: number,
): void {
  const r = rollupYear(entries, year);
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text(`Annual Notary Report — ${year}`, 105, 20, { align: 'center' });
  doc.setFontSize(11);
  doc.text(`Notary: ${settings.notaryName}`, 20, 35);
  doc.text(`Commission: ${settings.commissionNumber}`, 20, 42);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 49);

  doc.setFontSize(14);
  doc.text('Totals', 20, 65);
  doc.setFontSize(11);
  doc.text(`Total acts: ${r.totals.count}`, 20, 74);
  doc.text(`Fees collected: ${fmtUSD(r.totals.collectedCents)}`, 20, 81);
  doc.text(`Fees waived (count): ${r.totals.waivedCount}`, 20, 88);

  doc.setFontSize(14);
  doc.text('Monthly Breakdown', 20, 105);
  doc.setFontSize(10);
  doc.text('Month', 20, 114);
  doc.text('Acts', 70, 114);
  doc.text('Collected', 100, 114);
  doc.text('Waived', 150, 114);
  let y = 121;
  for (let m = 0; m < 12; m++) {
    if (y > 270) { doc.addPage(); y = 20; }
    const b = r.monthly[m];
    doc.text(MONTH_LABELS[m], 20, y);
    doc.text(String(b.count), 70, y);
    doc.text(fmtUSD(b.collectedCents), 100, y);
    doc.text(String(b.waivedCount), 150, y);
    y += 7;
  }

  if (y > 240) { doc.addPage(); y = 20; } else { y += 8; }
  doc.setFontSize(14);
  doc.text('Breakdown by Fee Type', 20, y);
  y += 9;
  doc.setFontSize(10);
  doc.text('Fee Type', 20, y);
  doc.text('Acts', 100, y);
  doc.text('Collected', 130, y);
  doc.text('Waived', 170, y);
  y += 7;
  const feeTypes = Object.keys(r.byType).sort();
  for (const ft of feeTypes) {
    if (y > 270) { doc.addPage(); y = 20; }
    const b = r.byType[ft];
    doc.text(ft, 20, y);
    doc.text(String(b.count), 100, y);
    doc.text(fmtUSD(b.collectedCents), 130, y);
    doc.text(String(b.waivedCount), 170, y);
    y += 7;
  }

  stampSealOnAllPages(doc, settings.sealImage);
  doc.save(`notary-annual-report-${year}.pdf`);
}

/** Year-end CSV report: one row per month plus totals + fee-type summary. */
export function exportYearReportCSV(entries: JournalEntry[], year: number): void {
  const r: YearRollup = rollupYear(entries, year);
  const lines: string[] = [];
  lines.push('Section,Label,Acts,Collected (USD),Waived');
  for (let m = 0; m < 12; m++) {
    const b = r.monthly[m];
    lines.push(['Month', MONTH_LABELS[m], b.count, (b.collectedCents / 100).toFixed(2), b.waivedCount]
      .map(csvField).join(','));
  }
  for (const ft of Object.keys(r.byType).sort()) {
    const b = r.byType[ft];
    lines.push(['Fee Type', ft, b.count, (b.collectedCents / 100).toFixed(2), b.waivedCount]
      .map(csvField).join(','));
  }
  lines.push(['Total', `Year ${year}`, r.totals.count, (r.totals.collectedCents / 100).toFixed(2), r.totals.waivedCount]
    .map(csvField).join(','));
  downloadBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }), `notary-annual-report-${year}.csv`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
