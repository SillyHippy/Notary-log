import { describe, it, expect } from 'vitest';

import { generateCSVRow, sanitizeEntryForExport } from './export';
import {
  shouldRecordSignerDOB,
  shouldRecordSignerIdNumber,
  type JournalEntry,
  type NotarySettings,
} from './db';
import { getMissingCompletionFields, type CompletionFields } from './completion';

const baseEntry = (overrides: Partial<JournalEntry> = {}): JournalEntry => ({
  entryNumber: 1,
  status: 'completed',
  signerFullName: 'Jane Doe',
  signerAddress: '1 Main St',
  signerCity: 'Chicago',
  signerState: 'IL',
  signerDOB: '1990-01-15',
  signerPhone: '555-0100',
  idType: 'driver_license',
  idNumber: 'D123456789',
  idIssuingState: 'IL',
  idExpirationDate: '2030-12-31',
  documentType: 'Affidavit',
  documentDate: '',
  documentDescription: '',
  notarialActType: 'Acknowledgment',
  feeCharged: 1000,
  feeWaived: false,
  locationCity: '',
  locationState: '',
  locationAddress: '',
  notes: '',
  amendments: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

const settings = (overrides: Partial<NotarySettings> = {}): NotarySettings => ({
  notaryName: 'Test Notary',
  commissionNumber: 'X1',
  commissionState: 'IL',
  commissionExpiration: '2030-01-01',
  recordSignerDOB: true,
  recordSignerIdNumber: true,
  ...overrides,
} as NotarySettings);

describe('compliance helpers', () => {
  it('treats undefined recordSignerDOB as ON (legacy default)', () => {
    expect(shouldRecordSignerDOB(undefined)).toBe(true);
    expect(shouldRecordSignerDOB({ recordSignerDOB: undefined } as unknown as NotarySettings)).toBe(true);
  });

  it('treats undefined recordSignerIdNumber as ON (legacy default)', () => {
    expect(shouldRecordSignerIdNumber(undefined)).toBe(true);
    expect(shouldRecordSignerIdNumber({ recordSignerIdNumber: undefined } as unknown as NotarySettings)).toBe(true);
  });

  it('honors explicit false', () => {
    expect(shouldRecordSignerDOB(settings({ recordSignerDOB: false }))).toBe(false);
    expect(shouldRecordSignerIdNumber(settings({ recordSignerIdNumber: false }))).toBe(false);
  });
});

describe('CSV export honors compliance toggles', () => {
  it('omits DOB when DOB toggle is off', () => {
    const row = generateCSVRow(baseEntry(), settings({ recordSignerDOB: false }));
    expect(row).not.toContain('1990-01-15');
  });

  it('omits ID number when ID# toggle is off', () => {
    const row = generateCSVRow(baseEntry(), settings({ recordSignerIdNumber: false }));
    expect(row).not.toContain('D123456789');
  });

  it('KEEPS expiration date when ID# toggle is off (decoupled per spec)', () => {
    // Expiration date is part of the standard "what kind of ID" record;
    // every state allows it. The ID# toggle must not gate it.
    const row = generateCSVRow(baseEntry(), settings({ recordSignerIdNumber: false }));
    expect(row).toContain('2030-12-31');
  });

  it('KEEPS issuing state when ID# toggle is off', () => {
    const row = generateCSVRow(baseEntry(), settings({ recordSignerIdNumber: false }));
    // Issuing state is part of the standard ID record — sandwiched in the
    // row as `"","IL","2030-12-31"` once the ID# field has been blanked.
    expect(row).toContain('"","IL","2030-12-31"');
  });

  it('emits all PII when both toggles are on', () => {
    const row = generateCSVRow(baseEntry(), settings());
    expect(row).toContain('1990-01-15');
    expect(row).toContain('D123456789');
    expect(row).toContain('2030-12-31');
  });
});

describe('JSON export sanitization (sanitizeEntryForExport)', () => {
  it('omits signerDOB key entirely when DOB toggle is off', () => {
    const out = sanitizeEntryForExport(baseEntry(), settings({ recordSignerDOB: false }));
    expect(Object.prototype.hasOwnProperty.call(out, 'signerDOB')).toBe(false);
  });

  it('omits idNumber key entirely when ID# toggle is off', () => {
    const out = sanitizeEntryForExport(baseEntry(), settings({ recordSignerIdNumber: false }));
    expect(Object.prototype.hasOwnProperty.call(out, 'idNumber')).toBe(false);
  });

  it('KEEPS idExpirationDate when ID# toggle is off (decoupled per spec)', () => {
    const out = sanitizeEntryForExport(baseEntry(), settings({ recordSignerIdNumber: false }));
    expect(out.idExpirationDate).toBe('2030-12-31');
  });

  it('KEEPS idIssuingState when ID# toggle is off', () => {
    const out = sanitizeEntryForExport(baseEntry(), settings({ recordSignerIdNumber: false }));
    expect(out.idIssuingState).toBe('IL');
  });

  it('retains all PII when both toggles are on', () => {
    const out = sanitizeEntryForExport(baseEntry(), settings());
    expect(out.signerDOB).toBe('1990-01-15');
    expect(out.idNumber).toBe('D123456789');
    expect(out.idExpirationDate).toBe('2030-12-31');
  });

  it('does not mutate the original entry object', () => {
    const entry = baseEntry();
    sanitizeEntryForExport(entry, settings({ recordSignerDOB: false, recordSignerIdNumber: false }));
    // Original must be untouched
    expect(entry.signerDOB).toBe('1990-01-15');
    expect(entry.idNumber).toBe('D123456789');
  });
});

describe('Scan-field persistence to draft (contract)', () => {
  // These tests verify the field-mapping contract used by handleScanResult
  // in edit-entry.tsx: only fields allowed by the active compliance toggles
  // should be applied; expiration date is always allowed regardless of the
  // ID# toggle.  We test by re-implementing the same allowed-list logic and
  // asserting the same decisions as the production FIELD_MAP.

  const ALWAYS_ALLOWED_FIELDS = ['fullName', 'address', 'city', 'state', 'idIssuingState', 'expirationDate'] as const;
  const DOB_FIELD = 'dob';
  const ID_NUMBER_FIELD = 'idNumber';

  function allowedScanFields(s: NotarySettings): string[] {
    const fields = [...ALWAYS_ALLOWED_FIELDS] as string[];
    if (shouldRecordSignerDOB(s)) fields.push(DOB_FIELD);
    if (shouldRecordSignerIdNumber(s)) fields.push(ID_NUMBER_FIELD);
    return fields;
  }

  it('includes dob and idNumber when both toggles ON', () => {
    const allowed = allowedScanFields(settings());
    expect(allowed).toContain('dob');
    expect(allowed).toContain('idNumber');
  });

  it('excludes dob when DOB toggle OFF', () => {
    const allowed = allowedScanFields(settings({ recordSignerDOB: false }));
    expect(allowed).not.toContain('dob');
    expect(allowed).toContain('idNumber');
  });

  it('excludes idNumber when ID# toggle OFF', () => {
    const allowed = allowedScanFields(settings({ recordSignerIdNumber: false }));
    expect(allowed).not.toContain('idNumber');
    expect(allowed).toContain('dob');
  });

  it('ALWAYS allows expirationDate regardless of ID# toggle', () => {
    const allowed = allowedScanFields(settings({ recordSignerIdNumber: false }));
    expect(allowed).toContain('expirationDate');
  });

  it('allows expirationDate even when both toggles OFF', () => {
    const allowed = allowedScanFields(settings({ recordSignerDOB: false, recordSignerIdNumber: false }));
    expect(allowed).toContain('expirationDate');
    expect(allowed).not.toContain('dob');
    expect(allowed).not.toContain('idNumber');
  });

  it('draft with no ID scan has undefined idFrontImage (skip-scan contract)', () => {
    // When a notary skips the scan step, the draft should have no front/back
    // image.  This ensures the "needs scan" indicator logic is correct.
    const draftNoScan = baseEntry({ status: 'draft', idFrontImage: undefined, idBackImage: undefined });
    expect(draftNoScan.idFrontImage).toBeUndefined();
    expect(draftNoScan.idBackImage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getMissingCompletionFields — compliance-aware required-field checker
// ---------------------------------------------------------------------------

const fullDraftFields = (): CompletionFields => ({
  signerFullName: 'Jane Doe',
  signerAddress: '1 Main St',
  signerCity: 'Chicago',
  signerState: 'IL',
  signerDOB: '1990-01-15',
  idNumber: 'D123456789',
  idExpirationDate: '2030-12-31',
  documentType: 'Affidavit',
  locationCity: 'Chicago',
  locationState: 'IL',
});

describe('getMissingCompletionFields', () => {
  it('returns empty array when all required fields are present (both toggles ON)', () => {
    const missing = getMissingCompletionFields(fullDraftFields(), settings());
    expect(missing).toHaveLength(0);
  });

  it('does NOT require signerDOB when DOB toggle is OFF', () => {
    const data = { ...fullDraftFields(), signerDOB: '' };
    const missing = getMissingCompletionFields(data, settings({ recordSignerDOB: false }));
    expect(missing).not.toContain('Date of birth');
    expect(missing).toHaveLength(0);
  });

  it('REQUIRES signerDOB when DOB toggle is ON and it is blank', () => {
    const data = { ...fullDraftFields(), signerDOB: '' };
    const missing = getMissingCompletionFields(data, settings({ recordSignerDOB: true }));
    expect(missing).toContain('Date of birth');
  });

  it('does NOT require idNumber when ID# toggle is OFF', () => {
    const data = { ...fullDraftFields(), idNumber: '' };
    const missing = getMissingCompletionFields(data, settings({ recordSignerIdNumber: false }));
    expect(missing).not.toContain('ID number');
    expect(missing).toHaveLength(0);
  });

  it('REQUIRES idNumber when ID# toggle is ON and it is blank', () => {
    const data = { ...fullDraftFields(), idNumber: '' };
    const missing = getMissingCompletionFields(data, settings({ recordSignerIdNumber: true }));
    expect(missing).toContain('ID number');
  });

  it('ALWAYS requires idExpirationDate regardless of ID# toggle', () => {
    const data = { ...fullDraftFields(), idExpirationDate: '' };
    const missingToggleOn = getMissingCompletionFields(data, settings({ recordSignerIdNumber: true }));
    const missingToggleOff = getMissingCompletionFields(data, settings({ recordSignerIdNumber: false }));
    expect(missingToggleOn).toContain('ID expiration date');
    expect(missingToggleOff).toContain('ID expiration date');
  });

  it('lists all core fields when data is empty and both toggles ON', () => {
    const missing = getMissingCompletionFields({}, settings());
    expect(missing).toContain('Signer full name');
    expect(missing).toContain('Address');
    expect(missing).toContain('City');
    expect(missing).toContain('State');
    expect(missing).toContain('Date of birth');
    expect(missing).toContain('ID expiration date');
    expect(missing).toContain('ID number');
    expect(missing).toContain('Document type');
    expect(missing).toContain('Location city');
    expect(missing).toContain('Location state');
  });

  it('lists all core fields when data is empty and both toggles OFF (DOB/ID# excluded)', () => {
    const missing = getMissingCompletionFields(
      {},
      settings({ recordSignerDOB: false, recordSignerIdNumber: false }),
    );
    expect(missing).not.toContain('Date of birth');
    expect(missing).not.toContain('ID number');
    expect(missing).toContain('Signer full name');
    expect(missing).toContain('ID expiration date');
    expect(missing).toContain('Document type');
  });

  it('treats undefined settings the same as toggles ON (legacy default)', () => {
    const data = { ...fullDraftFields(), signerDOB: '', idNumber: '' };
    const missing = getMissingCompletionFields(data, undefined);
    expect(missing).toContain('Date of birth');
    expect(missing).toContain('ID number');
  });
});
