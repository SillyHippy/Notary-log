import jsPDF from 'jspdf';
import type { JournalEntry, NotarySettings } from './db';

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
  doc.text(`Fee: $${(entry.feeCharged / 100).toFixed(2)}`, 20, 189);

  // Signature image
  if (entry.signatureImage) {
    doc.addImage(entry.signatureImage, 'PNG', 20, 200, 80, 30);
    doc.text('Signer Signature:', 20, 195);
  }

  // Footer
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toISOString()} | Entry #${entry.entryNumber}`, 105, 280, { align: 'center' });
  doc.save(`notary-entry-${entry.entryNumber}.pdf`);
}

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
 * Throws Error with a user-readable message on any malformed input,
 * a missing required field, or a future-version backup.
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

export function exportAllPDF(entries: JournalEntry[], settings: NotarySettings): void {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Official Notary Journal Export', 105, 20, { align: 'center' });
  doc.setFontSize(11);
  doc.text(`Notary: ${settings.notaryName}`, 20, 35);
  doc.text(`Commission: ${settings.commissionNumber}`, 20, 42);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 49);
  
  let y = 60;
  entries.forEach((entry, idx) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(10);
    doc.text(`#${entry.entryNumber} | ${new Date(entry.createdAt).toLocaleDateString()} | ${entry.signerFullName} | ${entry.notarialActType} | $${(entry.feeCharged / 100).toFixed(2)}`, 20, y);
    y += 10;
  });
  
  doc.save(`notary-journal-export-${Date.now()}.pdf`);
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
