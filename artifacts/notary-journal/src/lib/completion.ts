import { shouldRecordSignerDOB, shouldRecordSignerIdNumber, type NotarySettings } from './db';

/**
 * Minimal subset of form/entry fields that are checked for completion
 * readiness.  Both the edit-entry form values and a raw JournalEntry
 * satisfy this shape.
 */
export interface CompletionFields {
  signerFullName?: string;
  signerAddress?: string;
  signerCity?: string;
  signerState?: string;
  idType?: 'driver_license' | 'passport' | 'state_id' | 'military_id' | 'other';
  signerDOB?: string;
  idNumber?: string;
  idExpirationDate?: string;
  documentType?: string;
  locationCity?: string;
  locationState?: string;
}

export type SignerStepFieldName = 'signerFullName' | 'signerAddress' | 'signerCity' | 'signerState';

/**
 * Fields that should block moving from the Signer step to the Notarial Act
 * step in the new-entry wizard. ID details can be collected later in the
 * flow, but the core signer identity fields still need to be present.
 */
export function getSignerStepFieldsToCheck(data: Pick<CompletionFields, 'idType'>): SignerStepFieldName[] {
  const fields: SignerStepFieldName[] = ['signerFullName'];
  if (data.idType !== 'passport') {
    fields.push('signerAddress', 'signerCity', 'signerState');
  }
  return fields;
}

/**
 * Returns a list of human-readable labels for fields that must be non-empty
 * before a draft entry can be completed, taking compliance toggles into
 * account.  An empty array means all required fields are satisfied.
 *
 * Pure function — safe to call in tests without a React tree.
 */
export function getMissingCompletionFields(
  data: CompletionFields,
  settings: NotarySettings | null | undefined,
): string[] {
  const missing: string[] = [];
  if (!data.signerFullName) missing.push('Signer full name');
  if (!data.signerAddress) missing.push('Address');
  if (!data.signerCity) missing.push('City');
  if (!data.signerState) missing.push('State');
  if (shouldRecordSignerDOB(settings ?? undefined) && !data.signerDOB) missing.push('Date of birth');
  if (!data.idExpirationDate) missing.push('ID expiration date');
  if (shouldRecordSignerIdNumber(settings ?? undefined) && !data.idNumber) missing.push('ID number');
  if (!data.documentType) missing.push('Document type');
  if (!data.locationCity) missing.push('Location city');
  if (!data.locationState) missing.push('Location state');
  return missing;
}
