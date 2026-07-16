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
  idFrontImage?: string;
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
  if (settings?.requireIdFrontPhoto && !data.idFrontImage) {
    missing.push('ID front photo');
  }
  return missing;
}

/** Validate shared signer fields before completing a signing session. */
export function getMissingSigningSessionSharedFields(
  data: CompletionFields,
  settings: NotarySettings | null | undefined,
): string[] {
  return getMissingCompletionFields(
    { ...data, documentType: data.documentType || 'placeholder' },
    settings,
  ).filter(label => label !== 'Document type');
}

/** Per-act document row validation for signing sessions. */
export function getMissingSigningActFields(
  acts: Array<{ documentType?: string; notarialActType?: string }>,
): string[] {
  const missing: string[] = [];
  acts.forEach((act, i) => {
    if (!act.documentType?.trim()) missing.push(`Act ${i + 1}: document type`);
    if (!act.notarialActType) missing.push(`Act ${i + 1}: notarial act type`);
  });
  if (acts.length === 0) missing.push('At least one document/act');
  return missing;
}

/** Validate one roster signer against compliance toggles (appointment wizard). */
export function getMissingRosterEntryFields(
  data: CompletionFields,
  settings: NotarySettings | null | undefined,
  signerLabel = 'Signer',
): string[] {
  return getMissingCompletionFields(
    { ...data, documentType: 'placeholder', locationCity: 'x', locationState: 'x' },
    settings,
  )
    .filter(label => !['Document type', 'Location city', 'Location state'].includes(label))
    .map(label => `${signerLabel}: ${label}`);
}
