import { describe, it, expect } from 'vitest';
import { parseBackupFile, BACKUP_FORMAT_VERSION } from './export';
import { generateEntryHash, verifyChainPure, type JournalEntry } from './db';

const baseEntry = (n: number, overrides: Partial<JournalEntry> = {}): JournalEntry => ({
  entryNumber: n,
  status: 'completed',
  signerFullName: `Signer ${n}`,
  signerAddress: '',
  signerCity: '',
  signerState: '',
  signerDOB: '',
  signerPhone: '',
  idType: "Driver's License",
  idNumber: `ID${n}`,
  idIssuingState: '',
  idExpirationDate: '',
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
  createdAt: `2025-01-0${n}T00:00:00Z`,
  updatedAt: `2025-01-0${n}T00:00:00Z`,
  completedAt: `2025-01-0${n}T00:00:00Z`,
  ...overrides,
});

async function buildChain(count: number): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  let prevHash = '';
  for (let i = 1; i <= count; i++) {
    const e = baseEntry(i, { previousEntryHash: prevHash });
    e.hash = await generateEntryHash(e);
    prevHash = e.hash;
    entries.push(e);
  }
  return entries;
}

describe('parseBackupFile (import format support)', () => {
  it('parses a v2 envelope and reports detectedVersion=2', () => {
    const v2 = JSON.stringify({
      version: BACKUP_FORMAT_VERSION,
      exportedAt: '2025-01-01T00:00:00Z',
      entries: [baseEntry(1), baseEntry(2)],
      settings: { id: 1, notaryName: 'Jane', commissionNumber: 'C1', commissionExpiration: '', defaultCity: '', defaultState: '' },
    });
    const r = parseBackupFile(v2);
    expect(r.detectedVersion).toBe(2);
    expect(r.entries).toHaveLength(2);
    expect(r.settings?.notaryName).toBe('Jane');
  });

  it('parses a v1 unversioned envelope (entries-only) as v1', () => {
    const v1 = JSON.stringify({ entries: [baseEntry(1)] });
    const r = parseBackupFile(v1);
    expect(r.detectedVersion).toBe(1);
    expect(r.entries).toHaveLength(1);
    expect(r.settings).toBeNull();
  });

  it('parses a v1 bare-array export', () => {
    const v1 = JSON.stringify([baseEntry(1), baseEntry(2)]);
    const r = parseBackupFile(v1);
    expect(r.detectedVersion).toBe(1);
    expect(r.entries).toHaveLength(2);
  });

  it('parses a single-entry export object', () => {
    const r = parseBackupFile(JSON.stringify(baseEntry(7)));
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].entryNumber).toBe(7);
  });

  it('rejects future-version backups', () => {
    expect(() => parseBackupFile(JSON.stringify({ version: 99, entries: [] })))
      .toThrow(/v99 is newer/);
  });

  it('rejects entries missing required fields', () => {
    const bad = { version: 2, entries: [{ entryNumber: 1 }] };
    expect(() => parseBackupFile(JSON.stringify(bad))).toThrow(/missing required field/);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseBackupFile('not json')).toThrow(/valid JSON/);
  });

  it('round-trips the optional feeType field on entries and defaultFees/sealImage on settings', () => {
    const envelope = {
      version: BACKUP_FORMAT_VERSION,
      exportedAt: '2025-06-01T00:00:00Z',
      entries: [
        baseEntry(1, { feeType: 'Jurat', feeCharged: 2500 }),
        baseEntry(2, { feeType: 'Travel', feeCharged: 1500 }),
        // Older entry without feeType — must still parse cleanly.
        baseEntry(3),
      ],
      settings: {
        id: 1,
        notaryName: 'Jane',
        commissionNumber: 'C1',
        commissionExpiration: '',
        defaultCity: '',
        defaultState: '',
        defaultFees: { Acknowledgment: 1500, Jurat: 2500, Travel: 1000 },
        sealImage: 'data:image/png;base64,AAAA',
      },
    };
    const r = parseBackupFile(JSON.stringify(envelope));
    expect(r.detectedVersion).toBe(2);
    expect(r.entries).toHaveLength(3);
    expect(r.entries[0].feeType).toBe('Jurat');
    expect(r.entries[1].feeType).toBe('Travel');
    expect(r.entries[2].feeType).toBeUndefined();
    expect(r.settings?.defaultFees).toEqual({ Acknowledgment: 1500, Jurat: 2500, Travel: 1000 });
    expect(r.settings?.sealImage).toBe('data:image/png;base64,AAAA');
  });

  it('accepts a v2 backup that omits the new defaultFees/sealImage fields (forward-compatible)', () => {
    const envelope = {
      version: 2,
      exportedAt: '2025-06-01T00:00:00Z',
      entries: [baseEntry(1)],
      settings: {
        id: 1,
        notaryName: 'Jane',
        commissionNumber: 'C1',
        commissionExpiration: '',
        defaultCity: '',
        defaultState: '',
      },
    };
    const r = parseBackupFile(JSON.stringify(envelope));
    expect(r.settings?.defaultFees).toBeUndefined();
    expect(r.settings?.sealImage).toBeUndefined();
  });
});

describe('verifyChainPure (tamper cascade)', () => {
  it('verifies a clean 3-entry chain', async () => {
    const entries = await buildChain(3);
    const r = await verifyChainPure(entries);
    expect(r.okCount).toBe(3);
    expect(r.issues).toEqual([]);
  });

  it('flags entry #1 AND every later entry as broken when entry #1 content is tampered (stored hash unchanged)', async () => {
    const entries = await buildChain(3);
    // Tamper with entry #1's notes but leave its stored .hash and .previousEntryHash alone
    entries[0].notes = 'TAMPERED';
    const r = await verifyChainPure(entries);
    // Entry #1 fails because computed != stored hash.
    // Entries #2 and #3 must ALSO fail (chain link mismatch) because their
    // previousEntryHash points to the OLD stored hash, but verification
    // recomputes the upstream hash and notices the change.
    const failed = r.issues.map(i => i.entryNumber).sort();
    expect(failed).toEqual([1, 2, 3]);
    expect(r.okCount).toBe(0);
  });

  it('flags only the tampered entry when its content AND stored hash are restamped (chain link stays broken downstream)', async () => {
    const entries = await buildChain(3);
    entries[0].notes = 'edited locally';
    entries[0].hash = await generateEntryHash(entries[0]); // attacker re-stamps own hash
    const r = await verifyChainPure(entries);
    // Entry #1 now self-validates, but #2's previousEntryHash no longer matches
    // the recomputed hash of #1 (different content), so #2 (and #3) break.
    const failed = r.issues.map(i => i.entryNumber).sort();
    expect(failed).toContain(2);
    expect(failed).toContain(3);
  });

  it('flags missing hash on a completed entry', async () => {
    const entries = await buildChain(2);
    delete entries[1].hash;
    const r = await verifyChainPure(entries);
    expect(r.issues.some(i => i.entryNumber === 2 && /Missing/.test(i.reason))).toBe(true);
  });
});
