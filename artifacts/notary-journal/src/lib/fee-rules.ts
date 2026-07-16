import type { JournalEntry } from './db';
import type { NotarySettings } from './db';
import { DEFAULT_STAMP_FEE_CENTS, getStampFeeCents } from './fees';

export type FeeScheduleState = 'OK' | 'PA' | 'GENERIC';

export type CertificateStyle = 'shared' | 'individual';

/** Resolve fee schedule from settings.defaultState (2-letter code). */
export function resolveFeeScheduleState(
  settings: Pick<NotarySettings, 'defaultState'> | null | undefined,
): FeeScheduleState {
  const state = (settings?.defaultState ?? '').toUpperCase();
  if (state === 'OK') return 'OK';
  if (state === 'PA') return 'PA';
  return 'GENERIC';
}

export interface DocumentFeeInput {
  notarialActType: JournalEntry['notarialActType'];
  certificateStyle: CertificateStyle;
  signerCount: number;
}

export interface SignerFeeAllocation {
  feeCents: number;
  stampCount: number;
  feeAllocation: 'primary' | 'split' | 'waived';
}

/**
 * Compute per-signer fee allocations for one document slot.
 * Conservative mode: individual certs → one act per signer.
 * Shared cert: OK = 1 act total; PA ack = $5 + $2×(n−1) on primary row.
 */
export function computeSignerFeesForDocument(
  doc: DocumentFeeInput,
  settings: Pick<NotarySettings, 'stampFeeCents' | 'stampFeeByState' | 'defaultState'> | null | undefined,
  locationState?: string,
): SignerFeeAllocation[] {
  const n = Math.max(1, doc.signerCount);
  const rate = getStampFeeCents(settings, locationState);
  const schedule = resolveFeeScheduleState(settings);

  if (doc.certificateStyle === 'individual' || n === 1) {
    return Array.from({ length: n }, () => ({
      feeCents: rate,
      stampCount: 1,
      feeAllocation: 'primary' as const,
    }));
  }

  // Shared certificate — multiple signers on one act
  if (schedule === 'PA' && doc.notarialActType === 'acknowledgment') {
    const additionalCents = 200; // PA § 167.3: $2 per additional name on same ack cert
    const total = rate + additionalCents * (n - 1);
    const primaryCents = Math.round(total);
    return Array.from({ length: n }, (_, i) => ({
      feeCents: i === 0 ? primaryCents : 0,
      stampCount: i === 0 ? 1 : 0,
      feeAllocation: (i === 0 ? 'primary' : 'waived') as SignerFeeAllocation['feeAllocation'],
    }));
  }

  // OK / generic shared: one notarial act
  return Array.from({ length: n }, (_, i) => ({
    feeCents: i === 0 ? rate : 0,
    stampCount: i === 0 ? 1 : 0,
    feeAllocation: (i === 0 ? 'primary' : 'waived') as SignerFeeAllocation['feeAllocation'],
  }));
}

/** Sum fee cents across all allocations for a document. */
export function sumDocumentFeeCents(allocations: SignerFeeAllocation[]): number {
  return allocations.reduce((sum, a) => sum + a.feeCents, 0);
}

/** Default per-stamp rate for previews when settings are null. */
export function defaultStampRateCents(): number {
  return DEFAULT_STAMP_FEE_CENTS;
}

export type JournalSharedCertMode = 'combined_line' | 'separate_lines';

/**
 * PA paper journals often list signer #1, #2, #3 on one entry when one stamp covers all.
 * OK and conservative states may prefer separate lines per signer.
 */
export function resolveJournalSharedCertMode(
  settings: Pick<NotarySettings, 'defaultState' | 'journalSharedCertMode'> | null | undefined,
): JournalSharedCertMode {
  if (settings?.journalSharedCertMode) return settings.journalSharedCertMode;
  return 'separate_lines';
}

/** Default shared-certificate checkbox in signing wizards (Ken/PA: combined line). */
export function defaultSharedCertificateStyle(
  settings: Pick<NotarySettings, 'defaultState' | 'journalSharedCertMode'> | null | undefined,
): CertificateStyle {
  return resolveJournalSharedCertMode(settings) === 'combined_line' ? 'shared' : 'individual';
}

/** Default for "one journal line per document" when comma-separated types are entered. */
export function shouldDefaultSplitDocuments(
  settings: Pick<NotarySettings, 'journalSplitDocumentsDefault'> | null | undefined,
): boolean {
  return settings?.journalSplitDocumentsDefault !== false;
}
