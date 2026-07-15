import { describe, expect, it } from 'vitest';
import { buildJournalDisplayRows } from './signing-group';
import type { JournalEntry } from './db';

function mockEntry(partial: Partial<JournalEntry> & { entryNumber: number }): JournalEntry {
  return {
    status: 'completed',
    signerFullName: 'Test',
    signerAddress: '1 Main',
    signerCity: 'Tulsa',
    signerState: 'OK',
    idType: 'driver_license',
    documentType: 'Deed',
    notarialActType: 'acknowledgment',
    feeCharged: 500,
    feeWaived: false,
    locationCity: 'Tulsa',
    locationState: 'OK',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    ...partial,
  };
}

describe('buildJournalDisplayRows', () => {
  it('groups entries with the same signingGroupId', () => {
    const rows = buildJournalDisplayRows([
      mockEntry({ id: 1, entryNumber: 1, signingGroupId: 'g1', actIndexInGroup: 1, actCountInGroup: 2 }),
      mockEntry({ id: 2, entryNumber: 2, signingGroupId: 'g1', actIndexInGroup: 2, actCountInGroup: 2, documentType: 'Will' }),
      mockEntry({ id: 3, entryNumber: 3 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe('group');
    if (rows[0].kind === 'group') {
      expect(rows[0].entries).toHaveLength(2);
    }
    expect(rows[1].kind).toBe('solo');
  });

  it('leaves ungrouped entries as solo rows', () => {
    const rows = buildJournalDisplayRows([
      mockEntry({ id: 1, entryNumber: 1 }),
      mockEntry({ id: 2, entryNumber: 2 }),
    ]);
    expect(rows.every(r => r.kind === 'solo')).toBe(true);
  });
});
