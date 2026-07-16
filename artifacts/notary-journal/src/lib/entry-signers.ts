import type { JournalEntry } from './db';
import type { SignerRosterEntry } from './signing-appointment';

/** Additional signer on a combined journal line (signer #2, #3, …). */
export interface AdditionalSignerRecord {
  signerIndex: number;
  signerFullName: string;
  signerAddress: string;
  signerCity: string;
  signerState: string;
  signerDOB?: string;
  signerPhone?: string;
  idType: JournalEntry['idType'];
  idNumber?: string;
  idIssuingState?: string;
  idExpirationDate?: string;
}

export function rosterEntryToAdditionalSigner(
  signer: SignerRosterEntry,
  signerIndex: number,
): AdditionalSignerRecord {
  return {
    signerIndex,
    signerFullName: signer.signerFullName,
    signerAddress: signer.signerAddress,
    signerCity: signer.signerCity,
    signerState: signer.signerState,
    signerDOB: signer.signerDOB,
    signerPhone: signer.signerPhone,
    idType: signer.idType,
    idNumber: signer.idNumber,
    idIssuingState: signer.idIssuingState,
    idExpirationDate: signer.idExpirationDate,
  };
}

/** All signer names for display / export (primary + additional). */
export function formatEntrySignerNames(entry: JournalEntry): string {
  const names: string[] = [];
  const primary = entry.signerFullName?.trim();
  if (primary) names.push(primary);
  if (entry.additionalSigners?.length) {
    for (const s of entry.additionalSigners) {
      const n = s.signerFullName?.trim();
      if (n) names.push(n);
    }
  } else if (entry.coSignerNames?.length) {
    names.push(...entry.coSignerNames.map(n => n.trim()).filter(Boolean));
  }
  return names.join(', ');
}

/** Numbered signer list for entry detail (PA-style journal line). */
export function formatEntrySignerList(entry: JournalEntry): string {
  return formatEntrySignerLines(entry).replace(/\n/g, ' · ');
}

/** One signer per line — used in journal print when co-signers share one row. */
export function formatEntrySignerLines(entry: JournalEntry): string {
  const lines: string[] = [];
  const primary = entry.signerFullName?.trim();
  if (primary) {
    lines.push(entryHasMultipleSigners(entry) ? `#1 ${primary}` : primary);
  }
  if (entry.additionalSigners?.length) {
    for (const s of entry.additionalSigners) {
      const n = s.signerFullName?.trim();
      if (n) lines.push(`#${s.signerIndex} ${n}`);
    }
  } else if (entry.coSignerNames?.length) {
    entry.coSignerNames.forEach((n, i) => {
      if (n.trim()) lines.push(`#${i + 2} ${n.trim()}`);
    });
  }
  return lines.join('\n');
}

export function entryHasMultipleSigners(entry: JournalEntry): boolean {
  return (entry.additionalSigners?.length ?? 0) > 0 || (entry.coSignerNames?.length ?? 0) > 0;
}

/** Street + city + state for one signer (journal print / export). */
export function formatSignerFullAddress(parts: {
  signerAddress?: string;
  signerCity?: string;
  signerState?: string;
}): string {
  const street = parts.signerAddress?.trim();
  const cityState = [parts.signerCity?.trim(), parts.signerState?.trim()].filter(Boolean).join(', ');
  if (street && cityState) return `${street}, ${cityState}`;
  return street || cityState || '';
}

function humanIdType(idType: JournalEntry['idType']): string {
  return idType.replace(/_/g, ' ');
}

function formatSignerIdLine(
  signerIndex: number | null,
  idType: JournalEntry['idType'],
  idNumber?: string,
  recordIdNumber?: boolean,
): string {
  const label = humanIdType(idType);
  const numbered = signerIndex != null ? `#${signerIndex} ` : '';
  if (recordIdNumber && idNumber?.trim()) {
    return `${numbered}${label} — ${idNumber.trim()}`;
  }
  return `${numbered}${label}`;
}

/** One line per signer address (primary + additional) for journal table PDF. */
export function formatEntryAddressLines(entry: JournalEntry): string {
  const multi = entryHasMultipleSigners(entry);
  const lines: string[] = [];
  const primary = formatSignerFullAddress(entry);
  if (primary) lines.push(multi ? `#1 ${primary}` : primary);
  if (entry.additionalSigners?.length) {
    for (const s of entry.additionalSigners) {
      const addr = formatSignerFullAddress(s);
      if (addr) lines.push(`#${s.signerIndex} ${addr}`);
    }
  }
  return lines.join('\n');
}

/** One line per signer ID type (and optional ID #) for journal table PDF. */
export function formatEntryIdTypeLines(
  entry: JournalEntry,
  recordIdNumber = true,
): string {
  const multi = entryHasMultipleSigners(entry);
  const lines: string[] = [];
  lines.push(
    formatSignerIdLine(
      multi ? 1 : null,
      entry.idType,
      entry.idNumber,
      recordIdNumber,
    ),
  );
  if (entry.additionalSigners?.length) {
    for (const s of entry.additionalSigners) {
      lines.push(
        formatSignerIdLine(s.signerIndex, s.idType, s.idNumber, recordIdNumber),
      );
    }
  }
  return lines.join('\n');
}
