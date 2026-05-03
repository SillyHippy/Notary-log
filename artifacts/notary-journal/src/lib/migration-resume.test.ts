import { describe, it, expect } from 'vitest';
import { generateEntryHash, rebuildChainForResume, verifyChainPure, type JournalEntry } from './db';

const e = (n: number): JournalEntry => ({
  entryNumber: n,
  status: 'completed',
  signerFullName: `Signer ${n}`,
  signerAddress: '', signerCity: '', signerState: '', signerDOB: '', signerPhone: '',
  idType: "Driver's License", idNumber: `ID${n}`, idIssuingState: '', idExpirationDate: '',
  documentType: 'Affidavit', documentDate: '', documentDescription: '',
  notarialActType: 'Acknowledgment',
  feeCharged: 100, feeWaived: false,
  locationCity: '', locationState: '', locationAddress: '',
  notes: '', amendments: [],
  createdAt: `2025-01-0${n}T00:00:00Z`,
  updatedAt: `2025-01-0${n}T00:00:00Z`,
  completedAt: `2025-01-0${n}T00:00:00Z`,
});

async function buildClean(n: number): Promise<JournalEntry[]> {
  const out: JournalEntry[] = [];
  let prev = '';
  for (let i = 1; i <= n; i++) {
    const x = e(i);
    x.previousEntryHash = prev;
    x.hash = await generateEntryHash(x);
    prev = x.hash;
    out.push(x);
  }
  return out;
}

describe('rebuildChainForResume (interrupted migration recovery)', () => {
  it('seeds prevHash from the last already-encrypted entry so the resumed chain verifies', async () => {
    // Simulate: a 5-entry journal where entries 1..3 were already encrypted
    // (with valid hashes) before the migration was interrupted, and entries
    // 4..5 are still plaintext (no hash / no previousEntryHash).
    const all = await buildClean(5);
    const encrypted = all.slice(0, 3); // already migrated
    const plaintext = all.slice(3).map(x => {
      const { hash: _h, previousEntryHash: _p, ...rest } = x as JournalEntry & { hash?: string };
      void _h; void _p;
      return rest as JournalEntry;
    });

    await rebuildChainForResume(encrypted, plaintext);

    // After resume: entries 4 and 5 should have hashes that link off entry 3
    expect(plaintext[0].previousEntryHash).toBe(encrypted[2].hash);
    expect(plaintext[0].hash).toBeDefined();
    expect(plaintext[1].previousEntryHash).toBe(plaintext[0].hash);

    // The combined chain (encrypted + freshly stamped plaintext) should
    // verify cleanly with no issues.
    const combined = [...encrypted, ...plaintext];
    const result = await verifyChainPure(combined);
    expect(result.issues).toEqual([]);
    expect(result.okCount).toBe(5);
  });

  it('starts from genesis ("") when no encrypted entries exist yet (cold migration)', async () => {
    const plaintext = [e(1), e(2), e(3)];
    await rebuildChainForResume([], plaintext);
    expect(plaintext[0].previousEntryHash).toBe('');
    const r = await verifyChainPure(plaintext);
    expect(r.issues).toEqual([]);
    expect(r.okCount).toBe(3);
  });
});
