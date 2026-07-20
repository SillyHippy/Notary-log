import jsPDF from 'jspdf';
import type { JournalEntry, NotarySettings } from './db';
import { shouldRecordSignerDOB, shouldRecordSignerIdNumber } from './db';
import { formatEntrySignerLines, formatEntryAddressLines, formatEntryIdTypeLines } from './entry-signers';
import {
  resolveFeeType,
  rollupYear,
  MONTH_LABELS,
  type YearRollup,
} from './fees';
import { formatJournalDateTime, getEntryNotarizationIso } from './journal-datetime';

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

/**
 * Extract the image format and raw base64 from a data URL.
 * Returns { format: 'PNG' | 'JPEG', base64: string } or throws.
 */
function extractImageFormat(dataUrl: string): { format: 'PNG' | 'JPEG'; base64: string } {
  if (/^data:image\/jpe?g/i.test(dataUrl)) return { format: 'JPEG', base64: dataUrl };
  if (/^data:image\/png/i.test(dataUrl)) return { format: 'PNG', base64: dataUrl };
  throw new Error('Unsupported image format in data URL');
}

// ── Single-entry PDF ───────────────────────────────────────────────────────

export function exportEntryPDF(entry: JournalEntry, settings: NotarySettings): void {
  const doc = new jsPDF();
  const recordDOB = shouldRecordSignerDOB(settings);
  const recordId = shouldRecordSignerIdNumber(settings);

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
  doc.text(`Notarization: ${formatJournalDateTime(entry)}`, 20, 69);

  // Cursor-based layout so disabled-by-compliance rows don't leave gaps.
  let y = 85;
  doc.setFontSize(14);
  doc.text('Signer Information', 20, y); y += 10;
  doc.setFontSize(12);
  doc.text(`#1 Name: ${entry.signerFullName}`, 20, y); y += 7;
  doc.text(`Address: ${entry.signerAddress}`, 20, y); y += 7;
  doc.text(`City, State: ${entry.signerCity}, ${entry.signerState}`, 20, y); y += 7;
  if (recordDOB && entry.signerDOB) {
    doc.text(`Date of Birth: ${entry.signerDOB}`, 20, y); y += 7;
  }
  if (entry.additionalSigners?.length) {
    for (const s of entry.additionalSigners) {
      y += 4;
      doc.text(`#${s.signerIndex} Name: ${s.signerFullName}`, 20, y); y += 7;
      doc.text(`Address: ${s.signerAddress}`, 20, y); y += 7;
      doc.text(`City, State: ${s.signerCity}, ${s.signerState}`, 20, y); y += 7;
      if (recordId && s.idNumber) {
        doc.text(`ID (${s.idType}): ${s.idNumber}`, 20, y); y += 7;
      }
    }
  }
  y += 9;

  doc.setFontSize(14);
  doc.text('Identification', 20, y); y += 10;
  doc.setFontSize(12);
  doc.text(`Type: ${entry.idType}`, 20, y); y += 7;
  if (recordId && entry.idNumber) {
    doc.text(`Number: ${entry.idNumber}`, 20, y); y += 7;
  }
  // Expiration date is always shown — never gated by the ID# toggle.
  if (entry.idExpirationDate) {
    doc.text(`Expiration: ${entry.idExpirationDate}`, 20, y); y += 7;
  }
  y += 9;

  doc.setFontSize(14);
  doc.text('Notarial Act', 20, y); y += 10;
  doc.setFontSize(12);
  doc.text(`Act Type: ${entry.notarialActType}`, 20, y); y += 7;
  doc.text(`Document: ${entry.documentType}`, 20, y); y += 7;
  const feeStr = entry.feeWaived
    ? 'Waived'
    : `$${(entry.feeCharged / 100).toFixed(2)}`;
  doc.text(`Fee (${resolveFeeType(entry)}): ${feeStr}`, 20, y); y += 11;

  // Signature image
  if (entry.signatureImage) {
    doc.text('Signer Signature:', 20, y); y += 5;
    doc.addImage(entry.signatureImage, 'PNG', 20, y, 80, 30);
  }

  // Embed ID photos if available
  let photoY = y + 40;
  if (entry.idFrontImage) {
    try {
      const { format, base64 } = extractImageFormat(entry.idFrontImage);
      if (photoY + 60 > doc.internal.pageSize.height - 20) {
        doc.addPage();
        photoY = 20;
      }
      doc.setFontSize(8);
      doc.text('ID Front', 20, photoY);
      doc.addImage(base64, format, 20, photoY + 3, 80, 45);
      photoY += 55;
    } catch (err) {
      console.warn('Failed to embed ID front photo:', err);
    }
  }
  if (entry.idBackImage) {
    try {
      const { format, base64 } = extractImageFormat(entry.idBackImage);
      if (photoY + 60 > doc.internal.pageSize.height - 20) {
        doc.addPage();
        photoY = 20;
      }
      doc.setFontSize(8);
      doc.text('ID Back', 20, photoY);
      doc.addImage(base64, format, 20, photoY + 3, 80, 45);
      photoY += 55;
    } catch (err) {
      console.warn('Failed to embed ID back photo:', err);
    }
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
  'Notarization Date Time',
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

export function generateCSVRow(entry: JournalEntry, settings?: NotarySettings | null): string {
  const amendments = entry.amendments ?? [];
  // Honor compliance toggles: if the notary's state forbids storing DOB or
  // ID#, we omit those values from the CSV row even if the entry happens to
  // have them on record (older entries written before the toggle flipped).
  // NOTE: idExpirationDate is intentionally NOT gated by the ID-number
  // toggle — every state allows expiration date as part of the standard
  // "what kind of ID did you check" record. Only the full ID# is sensitive.
  const recordDOB = shouldRecordSignerDOB(settings ?? undefined);
  const recordId = shouldRecordSignerIdNumber(settings ?? undefined);
  return [
    entry.entryNumber,
    entry.status,
    entry.createdAt,
    entry.updatedAt,
    entry.completedAt ?? '',
    getEntryNotarizationIso(entry),
    entry.signerFullName,
    entry.signerAddress,
    entry.signerCity,
    entry.signerState,
    recordDOB ? (entry.signerDOB ?? '') : '',
    entry.signerPhone ?? '',
    entry.idType,
    recordId ? (entry.idNumber ?? '') : '',
    entry.idIssuingState ?? '',
    entry.idExpirationDate ?? '',
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

export function exportEntryCSV(entry: JournalEntry, settings?: NotarySettings | null): void {
  const csvContent = csvHeader + generateCSVRow(entry, settings);
  downloadBlob(new Blob([csvContent], { type: 'text/csv' }), `notary-entry-${entry.entryNumber}.csv`);
}

/**
 * Pure helper — returns a compliance-sanitized copy of the entry without
 * triggering any download. Exported so it can be unit-tested independently
 * of the browser download API.
 */
export function sanitizeEntryForExport(entry: JournalEntry, settings?: NotarySettings | null): JournalEntry {
  const recordDOB = shouldRecordSignerDOB(settings ?? undefined);
  const recordId = shouldRecordSignerIdNumber(settings ?? undefined);
  // Build a sanitized copy that drops keys disabled by compliance toggles
  // entirely (vs. emitting empty strings) so downstream consumers cannot
  // accidentally treat a present-but-empty field as recorded data.
  const sanitized: JournalEntry = { ...entry };
  if (!recordDOB) delete sanitized.signerDOB;
  // Only idNumber is gated; idExpirationDate is part of the standard ID record.
  if (!recordId) delete sanitized.idNumber;
  return sanitized;
}

export function exportEntryJSON(entry: JournalEntry, settings?: NotarySettings | null): void {
  const sanitized = sanitizeEntryForExport(entry, settings);
  const jsonContent = JSON.stringify(sanitized, null, 2);
  downloadBlob(new Blob([jsonContent], { type: 'application/json' }), `notary-entry-${entry.entryNumber}.json`);
}

export function exportAllCSV(entries: JournalEntry[], settings?: NotarySettings | null): void {
  const csvContent = csvHeader + entries.map((e) => generateCSVRow(e, settings)).join('\n');
  downloadBlob(new Blob([csvContent], { type: 'text/csv' }), `notary-journal-export-${Date.now()}.csv`);
}

// ── Backup envelope ────────────────────────────────────────────────────────

export const BACKUP_FORMAT_VERSION = 2;

/** Optional Cal host OAuth ciphertext snapshot (same host restore only). */
export type CalHostBinding = {
  v: number;
  accessTokenEnc: string;
  refreshTokenEnc?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
  connectedAt?: string | null;
  calUsername?: string | null;
  calBookingUrl?: string | null;
  calUserId?: string | null;
  calEventSlug?: string | null;
  calDefaultEventTypeId?: number | null;
  managedWebhookId?: string | null;
  slug?: string | null;
  displayName?: string | null;
};

export interface BackupEnvelope {
  version: number;
  exportedAt: string;
  entries: JournalEntry[];
  settings: NotarySettings;
  /**
   * Cal.com OAuth binding for multi-tenant hosts (Zo/CF cal).
   * Contains server-side ciphertext only (not raw Cal tokens).
   * Restores only on a host that shares the same CAL_TOKEN_ENCRYPTION_KEY.
   */
  calHostBinding?: CalHostBinding | null;
}

export interface ParsedBackup {
  detectedVersion: 1 | 2;
  entries: JournalEntry[];
  settings: NotarySettings | null;
  calHostBinding?: CalHostBinding | null;
}

// `idNumber` was historically required but is now optional (compliance
// toggle). Older backups will still have it as a string; newer backups from
// notaries who disabled the toggle will omit it. Keep the universally-present
// fields here so v1 backups still validate.
const REQUIRED_ENTRY_FIELDS: Array<keyof JournalEntry> = [
  'entryNumber', 'status', 'signerFullName', 'idType',
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
 * fields are additive — older v2 backups without them parse cleanly here, and
 * newer backups with them are accepted by older versions because
 * `REQUIRED_ENTRY_FIELDS` does not include them.
 */
export function parseBackupFile(text: string): ParsedBackup {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Not a valid JSON file.'); }

  let entries: JournalEntry[] = [];
  let settings: NotarySettings | null = null;
  let calHostBinding: CalHostBinding | null = null;
  let detectedVersion: 1 | 2 = 1;

  if (Array.isArray(parsed)) {
    entries = parsed as JournalEntry[];
    detectedVersion = 1;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as {
      version?: unknown;
      entries?: unknown;
      settings?: unknown;
      entryNumber?: unknown;
      calHostBinding?: unknown;
    };
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
      if (obj.calHostBinding && typeof obj.calHostBinding === 'object') {
        const b = obj.calHostBinding as CalHostBinding;
        if (typeof b.accessTokenEnc === 'string' && b.accessTokenEnc.length > 0) {
          calHostBinding = b;
        }
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

  return { detectedVersion, entries, settings, calHostBinding };
}

export function exportAllJSON(
  entries: JournalEntry[],
  settings: NotarySettings,
  calHostBinding?: CalHostBinding | null,
): void {
  const payload: BackupEnvelope = {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
    settings,
    ...(calHostBinding ? { calHostBinding } : {}),
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
      `#${entry.entryNumber} | ${formatJournalDateTime(entry)} | ${entry.signerFullName} | ${entry.notarialActType} | ${resolveFeeType(entry)} | ${fee}`,
      20, y,
    );
    y += 10;
  });

  stampSealOnAllPages(doc, settings.sealImage);
  doc.save(`notary-journal-export-${Date.now()}.pdf`);
}

// ── Print-ready journal table ──────────────────────────────────────────────

const JOURNAL_TABLE_FONT_SIZE = 7;
const JOURNAL_TABLE_LINE_MM = 3.2;
const JOURNAL_TABLE_MIN_ROW_MM = 16;
const JOURNAL_TABLE_CELL_PAD_MM = 2;

function journalTableLineCount(doc: jsPDF, text: string, widthMm: number): number {
  if (!text.trim()) return 1;
  doc.setFontSize(JOURNAL_TABLE_FONT_SIZE);
  return text.split('\n').reduce((sum, paragraph) => {
    const wrapped = doc.splitTextToSize(paragraph.trim() || '—', Math.max(4, widthMm - 2));
    return sum + wrapped.length;
  }, 0);
}

function formatJournalSignerCell(entry: JournalEntry): string {
  return formatEntrySignerLines(entry);
}

function formatJournalAddressCell(entry: JournalEntry): string {
  return formatEntryAddressLines(entry);
}

function formatJournalIdTypeCell(entry: JournalEntry, settings: NotarySettings): string {
  return formatEntryIdTypeLines(entry, shouldRecordSignerIdNumber(settings));
}

function computeJournalTableRowHeight(
  doc: jsPDF,
  entry: JournalEntry,
  cols: Array<[string, number, number, 'left' | 'right' | 'center']>,
  settings: NotarySettings,
): number {
  const signerLines = journalTableLineCount(doc, formatJournalSignerCell(entry), cols[2][2]);
  const addressLines = journalTableLineCount(doc, formatJournalAddressCell(entry), cols[3][2]);
  const idLines = journalTableLineCount(doc, formatJournalIdTypeCell(entry, settings), cols[4][2]);
  const documentLines = journalTableLineCount(doc, entry.documentType || '', cols[5][2]);
  const maxLines = Math.max(1, signerLines, addressLines, idLines, documentLines);
  return Math.max(
    JOURNAL_TABLE_MIN_ROW_MM,
    maxLines * JOURNAL_TABLE_LINE_MM + JOURNAL_TABLE_CELL_PAD_MM * 2,
  );
}

function drawJournalTableCell(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  w: number,
  rowH: number,
  align: 'left' | 'right' | 'center',
): void {
  doc.setFontSize(JOURNAL_TABLE_FONT_SIZE);
  const allLines: string[] = [];
  for (const paragraph of (text || '—').split('\n')) {
    allLines.push(...doc.splitTextToSize(paragraph.trim() || '—', Math.max(4, w - 2)));
  }
  const textBlockH = allLines.length * JOURNAL_TABLE_LINE_MM;
  const startY = y + (rowH - textBlockH) / 2 + JOURNAL_TABLE_LINE_MM - 0.4;
  allLines.forEach((line, i) => {
    const tx = align === 'right' ? x + w - 1 : align === 'center' ? x + w / 2 : x + 1;
    doc.text(line, tx, startY + i * JOURNAL_TABLE_LINE_MM, {
      align: align === 'left' ? 'left' : align,
    });
  });
}

/**
 * Generate a print-ready journal PDF with a proper columnar table layout
 * matching the traditional NNA-style paper notary journal. Landscape
 * orientation for room across all columns.
 *
 * Columns: Entry# | Date | Signer Name | Address | ID Type | Document | Act Type | Fee | Signature
 *
 * Row height grows automatically when a line lists multiple signers or long
 * document names (PA combined-line entries, multi-name rows).
 */
export function exportJournalTablePDF(
  entries: JournalEntry[],
  settings: NotarySettings,
  downloadName?: string,
): void {
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Column definitions: [label, x-position, width, align]
  const cols: Array<[string, number, number, 'left' | 'right' | 'center']> = [
    ['#',         10,  12, 'center'],
    ['Date/Time', 22,  24, 'left'],
    ['Signer',    46,  38, 'left'],
    ['Address',   84,  44, 'left'],
    ['ID Type',   128, 22, 'left'],
    ['Document',  150, 32, 'left'],
    ['Act Type',  182,  28, 'left'],
    ['Fee',       210, 18, 'right'],
    ['Signature', 228, 52, 'center'],
  ];

  const headerY = 52;
  const startY = headerY + 10; // header row is 9mm
  const maxY = pageH - 20; // leave room for footer

  // Signature thumbnail size (fits inside the minimum row)
  const sigW = 40;
  const sigH = 12;

  // ── Page header ──────────────────────────────────────────────────────
  const drawHeader = (pageNum?: number) => {
    doc.setFontSize(16);
    doc.text('Official Notary Journal', pageW / 2, 16, { align: 'center' });
    doc.setFontSize(9);
    doc.text(`Notary: ${settings.notaryName}`, 10, 26);
    doc.text(`Commission #: ${settings.commissionNumber}`, 10, 32);
    if (settings.commissionExpiration) {
      doc.text(`Expires: ${settings.commissionExpiration}`, 10, 38);
    }
    doc.text(`Printed: ${new Date().toLocaleString()}`, pageW - 10, 26, { align: 'right' });
    if (pageNum) {
      doc.text(`Entries: ${entries.length} | Page ${pageNum}`, pageW - 10, 32, { align: 'right' });
    } else {
      doc.text(`Entries: ${entries.length}`, pageW - 10, 32, { align: 'right' });
    }

    // Column headers
    doc.setFillColor(30, 58, 95); // dark navy
    doc.rect(10, headerY - 1, pageW - 20, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    for (const [label, x, w, align] of cols) {
      const tx = align === 'right' ? x + w - 1 : align === 'center' ? x + w / 2 : x + 1;
      doc.text(label, tx, headerY + 5, { align: align === 'left' ? 'left' : align });
    }
    doc.setTextColor(0, 0, 0);
  };

  // ── Draw each entry (variable row height) ────────────────────────────
  let page = 1;
  drawHeader(page);
  let y = startY;

  entries.forEach((entry, idx) => {
    const rowH = computeJournalTableRowHeight(doc, entry, cols, settings);
    if (y + rowH > maxY) {
      doc.addPage();
      page++;
      drawHeader(page);
      y = startY;
    }

    // Alternating row shading
    if (idx % 2 === 0) {
      doc.setFillColor(245, 247, 250);
      doc.rect(10, y, pageW - 20, rowH, 'F');
    }

    // Light horizontal rule between rows
    doc.setDrawColor(220, 220, 220);
    doc.line(10, y + rowH, pageW - 10, y + rowH);

    const fee = entry.feeWaived
      ? 'Waived'
      : `$${(entry.feeCharged / 100).toFixed(2)}`;
    const date = formatJournalDateTime(entry, true);
    const act = entry.notarialActType.replace('_', ' ');

    drawJournalTableCell(doc, String(entry.entryNumber), cols[0][1], y, cols[0][2], rowH, cols[0][3]);
    drawJournalTableCell(doc, date, cols[1][1], y, cols[1][2], rowH, cols[1][3]);
    drawJournalTableCell(doc, formatJournalSignerCell(entry), cols[2][1], y, cols[2][2], rowH, cols[2][3]);
    drawJournalTableCell(doc, formatJournalAddressCell(entry), cols[3][1], y, cols[3][2], rowH, cols[3][3]);
    drawJournalTableCell(doc, formatJournalIdTypeCell(entry, settings), cols[4][1], y, cols[4][2], rowH, cols[4][3]);
    drawJournalTableCell(doc, entry.documentType || '', cols[5][1], y, cols[5][2], rowH, cols[5][3]);
    drawJournalTableCell(doc, act, cols[6][1], y, cols[6][2], rowH, cols[6][3]);
    drawJournalTableCell(doc, fee, cols[7][1], y, cols[7][2], rowH, cols[7][3]);

    // Signature thumbnail or placeholder
    const sigCol = cols[8];
    const sigX = sigCol[1] + (sigCol[2] - sigW) / 2;
    const sigY = y + (rowH - sigH) / 2;
    const sigTextY = y + rowH / 2 + 1.5;
    if (entry.signatureImage) {
      try {
        doc.addImage(entry.signatureImage, 'PNG', sigX, sigY, sigW, sigH);
      } catch {
        doc.text('(sig)', sigCol[1] + sigCol[2] / 2, sigTextY, { align: 'center' });
      }
    } else {
      doc.setTextColor(160, 160, 160);
      doc.text('—', sigCol[1] + sigCol[2] / 2, sigTextY, { align: 'center' });
      doc.setTextColor(0, 0, 0);
    }

    y += rowH;
  });

  // Add ID photos section
  const entriesWithPhotos = entries.filter(e => e.idFrontImage || e.idBackImage);
  if (entriesWithPhotos.length > 0) {
    doc.addPage();
    doc.setFontSize(14);
    doc.text('ID Photos', 20, 20);
    let py = 30;
    for (const entry of entriesWithPhotos) {
      if (py + 70 > doc.internal.pageSize.height - 20) {
        doc.addPage();
        py = 20;
      }
      doc.setFontSize(8);
      doc.text(`Entry #${entry.entryNumber} — ${entry.signerFullName}`, 20, py);
      py += 5;
      if (entry.idFrontImage) {
        try {
          const { format, base64 } = extractImageFormat(entry.idFrontImage);
          doc.addImage(base64, format, 20, py, 60, 40);
        } catch { /* skip */ }
      }
      if (entry.idBackImage) {
        try {
          const { format, base64 } = extractImageFormat(entry.idBackImage);
          doc.addImage(base64, format, 85, py, 60, 40);
        } catch { /* skip */ }
      }
      py += 50;
    }
  }

  // ── Footer line on every page ────────────────────────────────────────
  const totalPagesActual = doc.getNumberOfPages();
  for (let i = 1; i <= totalPagesActual; i++) {
    doc.setPage(i);
    doc.setDrawColor(200, 200, 200);
    doc.line(10, pageH - 14, pageW - 10, pageH - 14);
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `${settings.notaryName} — Commission #${settings.commissionNumber} — Printed ${new Date().toLocaleDateString()}`,
      pageW / 2, pageH - 10, { align: 'center' },
    );
    doc.setTextColor(0, 0, 0);
  }

  stampSealOnAllPages(doc, settings.sealImage);
  doc.save(downloadName ?? `notary-journal-printable-${Date.now()}.pdf`);
}

/** Print all journal lines for one signing group (one row per act). */
export function exportSigningGroupPDF(
  entries: JournalEntry[],
  settings: NotarySettings,
  groupLabel?: string,
): void {
  const completed = entries
    .filter(e => e.status === 'completed' || e.status === 'amended')
    .sort((a, b) => {
      const ai = a.actIndexInGroup ?? a.entryNumber;
      const bi = b.actIndexInGroup ?? b.entryNumber;
      return ai - bi || a.entryNumber - b.entryNumber;
    });
  if (completed.length === 0) {
    throw new Error('No completed entries in this signing group.');
  }
  const label = groupLabel
    || completed[0].appointmentLabel
    || completed[0].signingGroupLabel
    || completed[0].signerFullName
    || 'signing';
  const safeLabel = label.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 40);
  exportJournalTablePDF(completed, settings, `notary-signing-${safeLabel}-${Date.now()}.pdf`);
}

/** Alias for multi-signer appointment export — same one-line-per-act PDF. */
export function exportAppointmentPDF(
  entries: JournalEntry[],
  settings: NotarySettings,
  appointmentLabel?: string,
): void {
  exportSigningGroupPDF(entries, settings, appointmentLabel);
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
  const r = rollupYear(entries, year, settings);
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
  doc.text(`Charged acts: ${r.totals.chargedCount}`, 20, 81);
  doc.text(`Fees collected: ${fmtUSD(r.totals.collectedCents)}`, 20, 88);
  doc.text(`Waived acts: ${r.totals.waivedCount}`, 20, 95);
  doc.text(`Fees waived (est. value): ${fmtUSD(r.totals.waivedEstimatedCents)}`, 20, 102);

  doc.setFontSize(14);
  doc.text('Monthly Breakdown', 20, 118);
  doc.setFontSize(10);
  doc.text('Month', 20, 127);
  doc.text('Acts', 60, 127);
  doc.text('Collected', 90, 127);
  doc.text('Waived', 130, 127);
  doc.text('Waived $', 165, 127);
  let y = 134;
  for (let m = 0; m < 12; m++) {
    if (y > 270) { doc.addPage(); y = 20; }
    const b = r.monthly[m];
    doc.text(MONTH_LABELS[m], 20, y);
    doc.text(String(b.count), 60, y);
    doc.text(fmtUSD(b.collectedCents), 90, y);
    doc.text(String(b.waivedCount), 130, y);
    doc.text(fmtUSD(b.waivedEstimatedCents), 165, y);
    y += 7;
  }

  // Per-fee-type breakdown
  if (y > 230) { doc.addPage(); y = 20; } else { y += 8; }
  doc.setFontSize(14);
  doc.text('Breakdown by Fee Type', 20, y);
  y += 9;
  doc.setFontSize(10);
  doc.text('Fee Type', 20, y);
  doc.text('Acts', 80, y);
  doc.text('Collected', 105, y);
  doc.text('Waived', 145, y);
  doc.text('Waived $', 175, y);
  y += 7;
  for (const ft of Object.keys(r.byType).sort()) {
    if (y > 270) { doc.addPage(); y = 20; }
    const b = r.byType[ft];
    doc.text(ft, 20, y);
    doc.text(String(b.count), 80, y);
    doc.text(fmtUSD(b.collectedCents), 105, y);
    doc.text(String(b.waivedCount), 145, y);
    doc.text(fmtUSD(b.waivedEstimatedCents), 175, y);
    y += 7;
  }

  // Per-notarial-act-type breakdown
  if (y > 230) { doc.addPage(); y = 20; } else { y += 8; }
  doc.setFontSize(14);
  doc.text('Breakdown by Notarial Act Type', 20, y);
  y += 9;
  doc.setFontSize(10);
  doc.text('Notarial Act', 20, y);
  doc.text('Acts', 80, y);
  doc.text('Collected', 105, y);
  doc.text('Waived', 145, y);
  doc.text('Waived $', 175, y);
  y += 7;
  for (const act of Object.keys(r.byAct).sort()) {
    if (y > 270) { doc.addPage(); y = 20; }
    const b = r.byAct[act];
    doc.text(act, 20, y);
    doc.text(String(b.count), 80, y);
    doc.text(fmtUSD(b.collectedCents), 105, y);
    doc.text(String(b.waivedCount), 145, y);
    doc.text(fmtUSD(b.waivedEstimatedCents), 175, y);
    y += 7;
  }

  stampSealOnAllPages(doc, settings.sealImage);
  doc.save(`notary-annual-report-${year}.pdf`);
}

/**
 * Year-end CSV report: monthly rows + per-fee-type rows + per-act-type rows + totals.
 * Settings is used to estimate the monetary value of waived fees from the
 * configured defaults.
 */
export function exportYearReportCSV(
  entries: JournalEntry[],
  settings: NotarySettings,
  year: number,
): void {
  const r: YearRollup = rollupYear(entries, year, settings);
  const lines: string[] = [];
  lines.push('Section,Label,Acts,Charged Acts,Collected (USD),Waived Acts,Waived Est (USD)');

  const row = (section: string, label: string, b: typeof r.totals) =>
    [section, label, b.count, b.chargedCount, (b.collectedCents / 100).toFixed(2),
      b.waivedCount, (b.waivedEstimatedCents / 100).toFixed(2)]
      .map(csvField).join(',');

  for (let m = 0; m < 12; m++) lines.push(row('Month', MONTH_LABELS[m], r.monthly[m]));
  for (const ft of Object.keys(r.byType).sort()) lines.push(row('Fee Type', ft, r.byType[ft]));
  for (const act of Object.keys(r.byAct).sort()) lines.push(row('Notarial Act', act, r.byAct[act]));
  lines.push(row('Total', `Year ${year}`, r.totals));

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
