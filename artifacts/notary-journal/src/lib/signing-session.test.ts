import { describe, expect, it } from 'vitest';
import {
  buildDraftEntriesFromSession,
  generateSigningGroupId,
  isMultiDocumentSession,
  parseDocumentTypesFromInput,
  validateSigningSessionPayload,
  type SigningSessionPayload,
} from './signing-session';
import { generateEntryHash, verifyChainPure, type JournalEntry } from './db';

function samplePayload(actsCount = 3): SigningSessionPayload {
  const groupId = generateSigningGroupId();
  return {
    signingGroupId: groupId,
    signingGroupLabel: 'Process server affidavits',
    shared: {
      signerFullName: 'Billy Bob',
      signerAddress: '123 Main St',
      signerCity: 'Tulsa',
      signerState: 'OK',
      idType: 'driver_license',
      idNumber: 'OK123456',
      idExpirationDate: '2030-01-01',
      signatureImage: 'data:image/png;base64,AAAA',
      locationCity: 'Tulsa',
      locationState: 'OK',
      completedAt: '2026-07-15T12:00:00.000Z',
    },
    acts: Array.from({ length: actsCount }, (_, i) => ({
      documentType: i < actsCount - 1 ? 'Affidavit of Service' : 'Affidavit of Non-Service',
      documentDescription: `Doc ${i + 1}`,
      notarialActType: 'acknowledgment' as const,
      feeChargedCents: 500,
      stampCount: 1,
    })),
  };
}

describe('parseDocumentTypesFromInput', () => {
  it('splits on commas', () => {
    expect(parseDocumentTypesFromInput('Warranty Deed, Affidavit, Will')).toEqual([
      'Warranty Deed',
      'Affidavit',
      'Will',
    ]);
  });

  it('treats a single document as one item', () => {
    expect(parseDocumentTypesFromInput('Warranty Deed')).toEqual(['Warranty Deed']);
  });

  it('ignores empty segments', () => {
    expect(parseDocumentTypesFromInput('Deed,, Affidavit ,')).toEqual(['Deed', 'Affidavit']);
  });

  it('detects multi-document sessions', () => {
    expect(isMultiDocumentSession('Deed, Affidavit')).toBe(true);
    expect(isMultiDocumentSession('Deed')).toBe(false);
  });
});

describe('signing session validation', () => {
  it('accepts a valid payload', () => {
    expect(validateSigningSessionPayload(samplePayload())).toEqual([]);
  });

  it('requires group id, signer, location, and acts', () => {
    const errors = validateSigningSessionPayload({
      signingGroupId: '',
      shared: {
        signerFullName: '',
        signerAddress: '',
        signerCity: '',
        signerState: '',
        idType: 'driver_license',
        locationCity: '',
        locationState: '',
      },
      acts: [],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('signingGroupId'))).toBe(true);
    expect(errors.some(e => e.includes('at least one act'))).toBe(true);
  });
});

describe('buildDraftEntriesFromSession', () => {
  it('creates one draft per act with shared signer and distinct documents', () => {
    const payload = samplePayload(3);
    const drafts = buildDraftEntriesFromSession(payload);
    expect(drafts).toHaveLength(3);
    expect(drafts.every(d => d.signerFullName === 'Billy Bob')).toBe(true);
    expect(drafts.every(d => d.signingGroupId === payload.signingGroupId)).toBe(true);
    expect(drafts.every(d => d.signatureImage === payload.shared.signatureImage)).toBe(true);
    expect(drafts.map(d => d.documentType)).toEqual([
      'Affidavit of Service',
      'Affidavit of Service',
      'Affidavit of Non-Service',
    ]);
    expect(drafts.map(d => d.actIndexInGroup)).toEqual([1, 2, 3]);
    expect(drafts.every(d => d.actCountInGroup === 3)).toBe(true);
  });
});

describe('signing session chain integrity', () => {
  it('produces a valid hash chain for three completed acts', async () => {
    const drafts = buildDraftEntriesFromSession(samplePayload(3));
    const completed: JournalEntry[] = [];
    let prevHash = '';

    for (let i = 0; i < drafts.length; i++) {
      const entry: JournalEntry = {
        ...drafts[i],
        entryNumber: i + 1,
        status: 'completed',
        createdAt: '2026-07-15T12:00:00.000Z',
        updatedAt: '2026-07-15T12:00:00.000Z',
        previousEntryHash: prevHash,
      };
      entry.hash = await generateEntryHash(entry);
      prevHash = entry.hash;
      completed.push(entry);
    }

    const result = await verifyChainPure(completed);
    expect(result.totalChecked).toBe(3);
    expect(result.okCount).toBe(3);
    expect(result.issues).toEqual([]);
  });

  it('does not change hash when only signing group metadata differs', async () => {
    const base = {
      entryNumber: 1,
      status: 'completed' as const,
      signerFullName: 'Jane',
      signerAddress: '1 Main',
      signerCity: 'Tulsa',
      signerState: 'OK',
      idType: 'driver_license' as const,
      documentType: 'Deed',
      notarialActType: 'acknowledgment' as const,
      feeCharged: 500,
      feeWaived: false,
      locationCity: 'Tulsa',
      locationState: 'OK',
      createdAt: '2026-07-15T12:00:00.000Z',
      updatedAt: '2026-07-15T12:00:00.000Z',
      completedAt: '2026-07-15T12:00:00.000Z',
      previousEntryHash: '',
    };
    const withoutGroup: JournalEntry = { ...base };
    const withGroup: JournalEntry = {
      ...base,
      signingGroupId: 'group-abc',
      signingGroupLabel: 'Loan signing',
      actIndexInGroup: 1,
      actCountInGroup: 3,
    };
    const h1 = await generateEntryHash(withoutGroup);
    const h2 = await generateEntryHash(withGroup);
    expect(h1).toBe(h2);
  });
});
