import { describe, it, expect } from 'vitest';

import { generateCSVRow } from './export';
import {
  shouldRecordSignerDOB,
  shouldRecordSignerIdNumber,
  type JournalEntry,
  type NotarySettings,
} from './db';

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
