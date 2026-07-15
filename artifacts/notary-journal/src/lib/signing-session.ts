import type { JournalEntry } from './db';

/** One notarial act within a signing session (same signer, different document). */
export interface SigningActRow {
  documentType: string;
  documentDescription?: string;
  documentDate?: string;
  notarialActType: JournalEntry['notarialActType'];
  feeType?: string;
  feeChargedCents: number;
  feeWaived?: boolean;
  stampCount?: number;
}

/** Signer + ID + location shared across every act in the session. */
export interface SigningSessionShared {
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
  idFrontImage?: string;
  idBackImage?: string;
  signatureImage?: string;
  locationCity: string;
  locationState: string;
  locationAddress?: string;
  completedAt?: string;
  notes?: string;
  extractedRawText?: string;
  extractionMethod?: JournalEntry['extractionMethod'];
  extractionConfidence?: number;
  needsReview?: boolean;
}

export interface SigningSessionPayload {
  signingGroupId: string;
  signingGroupLabel?: string;
  shared: SigningSessionShared;
  acts: SigningActRow[];
}

export function generateSigningGroupId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function validateSigningSessionPayload(payload: SigningSessionPayload): string[] {
  const errors: string[] = [];
  if (!payload.signingGroupId?.trim()) {
    errors.push('signingGroupId is required');
  }
  if (!payload.shared.signerFullName?.trim()) {
    errors.push('signer full name is required');
  }
  if (!payload.shared.signerAddress?.trim()) {
    errors.push('signer address is required');
  }
  if (!payload.shared.locationCity?.trim() || !payload.shared.locationState?.trim()) {
    errors.push('location city and state are required');
  }
  if (!payload.acts?.length) {
    errors.push('at least one act is required');
  }
  payload.acts?.forEach((act, i) => {
    if (!act.documentType?.trim()) {
      errors.push(`act ${i + 1}: document type is required`);
    }
    if (!act.notarialActType) {
      errors.push(`act ${i + 1}: notarial act type is required`);
    }
    if (typeof act.feeChargedCents !== 'number' || Number.isNaN(act.feeChargedCents)) {
      errors.push(`act ${i + 1}: feeChargedCents must be a number`);
    }
  });
  return errors;
}

/**
 * Build draft journal rows for each act. Caller runs createEntry + completeEntry
 * per row to preserve sequential entry numbers and hash chain order.
 */
export function buildDraftEntriesFromSession(
  payload: SigningSessionPayload,
): Array<Omit<JournalEntry, 'id' | 'entryNumber' | 'createdAt' | 'updatedAt'>> {
  const errors = validateSigningSessionPayload(payload);
  if (errors.length) {
    throw new Error(errors.join('; '));
  }

  const actCount = payload.acts.length;
  const completedAt = payload.shared.completedAt ?? new Date().toISOString();

  return payload.acts.map((act, index) => ({
    status: 'draft' as const,
    signingGroupId: payload.signingGroupId,
    signingGroupLabel: payload.signingGroupLabel,
    actIndexInGroup: index + 1,
    actCountInGroup: actCount,
    signerFullName: payload.shared.signerFullName,
    signerAddress: payload.shared.signerAddress,
    signerCity: payload.shared.signerCity,
    signerState: payload.shared.signerState,
    signerDOB: payload.shared.signerDOB,
    signerPhone: payload.shared.signerPhone,
    idType: payload.shared.idType,
    idNumber: payload.shared.idNumber,
    idIssuingState: payload.shared.idIssuingState,
    idExpirationDate: payload.shared.idExpirationDate,
    idFrontImage: payload.shared.idFrontImage,
    idBackImage: payload.shared.idBackImage,
    signatureImage: payload.shared.signatureImage,
    documentType: act.documentType,
    documentDescription: act.documentDescription,
    documentDate: act.documentDate,
    notarialActType: act.notarialActType,
    feeCharged: act.feeChargedCents,
    feeWaived: act.feeWaived ?? false,
    feeType: act.feeType,
    stampCount: act.stampCount,
    locationCity: payload.shared.locationCity,
    locationState: payload.shared.locationState,
    locationAddress: payload.shared.locationAddress,
    extractedRawText: payload.shared.extractedRawText,
    extractionMethod: payload.shared.extractionMethod,
    extractionConfidence: payload.shared.extractionConfidence,
    needsReview: payload.shared.needsReview,
    notes: payload.shared.notes,
    completedAt,
  }));
}
