import { describe, expect, it } from 'vitest';
import { generateEntryHash, type JournalEntry } from './db';

function entry(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    entryNumber: 1,
    status: 'completed',
    signerFullName: 'Jane Doe',
    signerAddress: '1 Main St',
    signerCity: 'Springfield',
    signerState: 'IL',
    signerDOB: '1980-01-01',
    idType: 'driver_license',
    idNumber: 'D1234567',
    idExpirationDate: '2030-01-01',
    documentType: 'Affidavit',
    notarialActType: 'jurat',
    feeCharged: 1000,
    feeWaived: false,
    locationCity: 'Springfield',
    locationState: 'IL',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    completedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('chain hashing', () => {
  it('is deterministic for the same entry', async () => {
    const e = entry({ previousEntryHash: 'abc' });
    const h1 = await generateEntryHash(e);
    const h2 = await generateEntryHash(e);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('changes when previousEntryHash changes', async () => {
    const a = await generateEntryHash(entry({ previousEntryHash: 'abc' }));
    const b = await generateEntryHash(entry({ previousEntryHash: 'xyz' }));
    expect(a).not.toBe(b);
  });

  it('changes when signed fields change', async () => {
    const a = await generateEntryHash(entry({ feeCharged: 1000 }));
    const b = await generateEntryHash(entry({ feeCharged: 2000 }));
    expect(a).not.toBe(b);
  });

  it('does not change when unsigned fields change', async () => {
    // notes is not part of the signed fields
    const a = await generateEntryHash(entry({ notes: 'one' }));
    const b = await generateEntryHash(entry({ notes: 'two' }));
    expect(a).toBe(b);
  });
});
