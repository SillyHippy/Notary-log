import { describe, expect, it } from 'vitest';
import {
  ACT_TYPE_TO_FEE_TYPE,
  availableReportYears,
  getDefaultFeeCents,
  resolveFeeType,
  rollupYear,
} from './fees';
import type { JournalEntry, NotarySettings } from './db';

function makeEntry(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    entryNumber: 1,
    status: 'completed',
    signerFullName: 'Jane Doe',
    signerAddress: '1 St',
    signerCity: 'Town',
    signerState: 'CA',
    signerDOB: '1990-01-01',
    idType: 'driver_license',
    idNumber: 'X1',
    idExpirationDate: '2030-01-01',
    documentType: 'Deed',
    notarialActType: 'acknowledgment',
    feeCharged: 1000, // cents
    feeWaived: false,
    locationCity: 'Town',
    locationState: 'CA',
    createdAt: '2025-03-15T12:00:00.000Z',
    updatedAt: '2025-03-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('resolveFeeType', () => {
  it('returns the explicit feeType when valid', () => {
    expect(resolveFeeType({ feeType: 'Jurat', notarialActType: 'acknowledgment' })).toBe('Jurat');
  });
  it('falls back to mapping from notarialActType when missing', () => {
    expect(resolveFeeType({ feeType: undefined, notarialActType: 'jurat' })).toBe('Jurat');
    expect(resolveFeeType({ feeType: undefined, notarialActType: 'copy_certification' })).toBe('Copy Certification');
  });
  it('falls back when feeType is unknown', () => {
    expect(resolveFeeType({ feeType: 'GarbageValue', notarialActType: 'jurat' })).toBe('Jurat');
  });
  it('matches ACT_TYPE_TO_FEE_TYPE for every known act', () => {
    for (const act of Object.keys(ACT_TYPE_TO_FEE_TYPE) as Array<keyof typeof ACT_TYPE_TO_FEE_TYPE>) {
      expect(resolveFeeType({ feeType: undefined, notarialActType: act })).toBe(ACT_TYPE_TO_FEE_TYPE[act]);
    }
  });
});

describe('getDefaultFeeCents', () => {
  const settings = {
    defaultFees: { Acknowledgment: 1500, Jurat: 0, Travel: -100, Other: NaN as unknown as number },
  } as Pick<NotarySettings, 'defaultFees'>;

  it('returns the configured value', () => {
    expect(getDefaultFeeCents(settings, 'Acknowledgment')).toBe(1500);
  });
  it('returns 0 when missing or unset', () => {
    expect(getDefaultFeeCents(settings, 'Oath')).toBe(0);
    expect(getDefaultFeeCents(null, 'Acknowledgment')).toBe(0);
    expect(getDefaultFeeCents(undefined, 'Acknowledgment')).toBe(0);
  });
  it('treats negative or non-finite values as 0', () => {
    expect(getDefaultFeeCents(settings, 'Travel')).toBe(0);
    expect(getDefaultFeeCents(settings, 'Other')).toBe(0);
  });
});

describe('rollupYear', () => {
  const entries: JournalEntry[] = [
    makeEntry({ entryNumber: 1, createdAt: '2025-01-10T00:00:00Z', feeCharged: 1500, feeType: 'Acknowledgment' }),
    makeEntry({ entryNumber: 2, createdAt: '2025-01-20T00:00:00Z', feeCharged: 2500, feeType: 'Jurat' }),
    makeEntry({ entryNumber: 3, createdAt: '2025-03-01T00:00:00Z', feeCharged: 0, feeWaived: true, feeType: 'Acknowledgment' }),
    makeEntry({ entryNumber: 4, createdAt: '2025-12-31T23:00:00Z', feeCharged: 1000, feeType: 'Travel' }),
    // Drafts must NOT count
    makeEntry({ entryNumber: 5, createdAt: '2025-06-01T00:00:00Z', status: 'draft', feeCharged: 9999 }),
    // Different year must NOT count
    makeEntry({ entryNumber: 6, createdAt: '2024-06-01T00:00:00Z', feeCharged: 5000 }),
    // Amended counts
    makeEntry({ entryNumber: 7, createdAt: '2025-05-15T00:00:00Z', status: 'amended', feeCharged: 750, feeType: 'Oath' }),
  ];

  const r = rollupYear(entries, 2025);

  it('aggregates totals excluding drafts and other years', () => {
    expect(r.totals.count).toBe(5); // 1,2,3,4,7
    expect(r.totals.collectedCents).toBe(1500 + 2500 + 1000 + 750);
    expect(r.totals.waivedCount).toBe(1);
  });

  it('buckets entries into the correct months', () => {
    expect(r.monthly[0].count).toBe(2);
    expect(r.monthly[0].collectedCents).toBe(4000);
    expect(r.monthly[2].waivedCount).toBe(1);
    expect(r.monthly[4].count).toBe(1);
    expect(r.monthly[11].collectedCents).toBe(1000);
  });

  it('groups by fee type with derived defaults when missing', () => {
    expect(r.byType.Acknowledgment.count).toBe(2);
    expect(r.byType.Acknowledgment.collectedCents).toBe(1500);
    expect(r.byType.Jurat.collectedCents).toBe(2500);
    expect(r.byType.Travel.collectedCents).toBe(1000);
    expect(r.byType.Oath.collectedCents).toBe(750);
  });
});

describe('availableReportYears', () => {
  it('returns descending unique years from completed/amended entries', () => {
    const entries = [
      makeEntry({ createdAt: '2024-01-01T00:00:00Z' }),
      makeEntry({ createdAt: '2025-01-01T00:00:00Z' }),
      makeEntry({ createdAt: '2025-06-01T00:00:00Z' }),
      makeEntry({ createdAt: '2026-02-01T00:00:00Z', status: 'amended' }),
      makeEntry({ createdAt: '2027-01-01T00:00:00Z', status: 'draft' }),
    ];
    expect(availableReportYears(entries)).toEqual([2026, 2025, 2024]);
  });

  it('falls back to current year when no entries', () => {
    expect(availableReportYears([])).toEqual([new Date().getFullYear()]);
  });
});
