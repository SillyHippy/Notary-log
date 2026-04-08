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

export function exportAllJSON(entries: JournalEntry[]): void {
  const jsonContent = JSON.stringify(entries, null, 2);
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
