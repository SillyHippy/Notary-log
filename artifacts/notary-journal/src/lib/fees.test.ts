import { describe, expect, it } from 'vitest';
import {
  ACT_TYPE_TO_FEE_TYPE,
  availableReportYears,
  computeStampFeeCents,
  DEFAULT_STAMP_FEE_CENTS,
  feeDollarsToCents,
  getDefaultFeeCents,
  getStampFeeCents,
  resolveFeeType,
  rollupYear,
  shouldApplyAutoFee,
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

describe('stamp fee helpers', () => {
  it('uses configured stamp fee and count', () => {
    expect(getStampFeeCents({ stampFeeCents: 750 })).toBe(750);
    expect(computeStampFeeCents(2, { stampFeeCents: 500 })).toBe(1000);
  });
  it('falls back to default when unset', () => {
    expect(getStampFeeCents(null)).toBe(DEFAULT_STAMP_FEE_CENTS);
  });
});

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

  it('separates charged vs waived counts on every bucket', () => {
    expect(r.totals.chargedCount).toBe(4); // 1,2,4,7
    expect(r.totals.waivedCount).toBe(1);
    expect(r.byType.Acknowledgment.chargedCount).toBe(1);
    expect(r.byType.Acknowledgment.waivedCount).toBe(1);
  });

  it('estimates waived monetary value from configured defaults', () => {
    const settings = { defaultFees: { Acknowledgment: 1500, Jurat: 2500 } } as Pick<NotarySettings, 'defaultFees'>;
    const r2 = rollupYear(entries, 2025, settings);
    // Only entry #3 is waived; it's an Acknowledgment so estimated value = $15.00
    expect(r2.totals.waivedEstimatedCents).toBe(1500);
    expect(r2.byType.Acknowledgment.waivedEstimatedCents).toBe(1500);
    // Without settings, falls back to 0
    expect(r.totals.waivedEstimatedCents).toBe(0);
  });

  it('groups by notarial act type using human-readable labels', () => {
    // All five 2025 entries default to notarialActType "acknowledgment" in
    // makeEntry, so byAct collapses them under "Acknowledgment". This proves
    // byAct reflects the recorded act-type, not the (independent) fee category.
    expect(r.byAct.Acknowledgment.count).toBe(5);
    expect(r.byAct.Acknowledgment.collectedCents).toBe(1500 + 2500 + 1000 + 750);
    expect(r.byAct.Acknowledgment.chargedCount).toBe(4);
    expect(r.byAct.Acknowledgment.waivedCount).toBe(1);
  });

  it('separates byAct buckets when entries have different notarialActType values', () => {
    const mixed: JournalEntry[] = [
      makeEntry({ entryNumber: 10, notarialActType: 'acknowledgment', feeCharged: 1500, createdAt: '2025-04-01T00:00:00Z' }),
      makeEntry({ entryNumber: 11, notarialActType: 'jurat', feeCharged: 2500, createdAt: '2025-04-02T00:00:00Z' }),
      makeEntry({ entryNumber: 12, notarialActType: 'copy_certification', feeCharged: 1000, createdAt: '2025-04-03T00:00:00Z' }),
    ];
    const r3 = rollupYear(mixed, 2025);
    expect(Object.keys(r3.byAct).sort()).toEqual(['Acknowledgment', 'Copy Certification', 'Jurat']);
    expect(r3.byAct.Jurat.collectedCents).toBe(2500);
    expect(r3.byAct['Copy Certification'].count).toBe(1);
  });
});

describe('shouldApplyAutoFee', () => {
  const settings = { defaultFees: { Acknowledgment: 1500, Jurat: 2500 } } as Pick<NotarySettings, 'defaultFees'>;

  it('returns the configured cents when fee is still app-derived', () => {
    expect(shouldApplyAutoFee({ feeType: 'Acknowledgment', isWaived: false, isAppDerived: true, settings })).toBe(1500);
    expect(shouldApplyAutoFee({ feeType: 'Jurat', isWaived: false, isAppDerived: true, settings })).toBe(2500);
  });

  it('returns 0 (still applies) when no default is configured for that category', () => {
    expect(shouldApplyAutoFee({ feeType: 'Travel', isWaived: false, isAppDerived: true, settings })).toBe(0);
  });

  it('returns null (do not touch) once the user has manually edited the fee', () => {
    expect(shouldApplyAutoFee({ feeType: 'Jurat', isWaived: false, isAppDerived: false, settings })).toBeNull();
  });

  it('returns null when the fee is waived (input is disabled)', () => {
    expect(shouldApplyAutoFee({ feeType: 'Jurat', isWaived: true, isAppDerived: true, settings })).toBeNull();
  });

  it('still applies even when current value is non-zero, as long as ref is app-derived', () => {
    // Regression: the previous logic only auto-filled when current === 0,
    // which left a stale Acknowledgment fee in place after switching to Jurat.
    // This test asserts the refactored behaviour: app-derived means we
    // overwrite regardless of the current value.
    expect(shouldApplyAutoFee({ feeType: 'Jurat', isWaived: false, isAppDerived: true, settings })).toBe(2500);
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

describe('feeDollarsToCents', () => {
  it('rounds positive dollar amounts to cents', () => {
    expect(feeDollarsToCents(10)).toBe(1000);
    expect(feeDollarsToCents(2.5)).toBe(250);
    expect(feeDollarsToCents(0.01)).toBe(1);
  });

  it('coerces numeric strings', () => {
    expect(feeDollarsToCents('5')).toBe(500);
    expect(feeDollarsToCents('12.34')).toBe(1234);
  });

  it('returns 0 for blank, NaN, undefined, null, or non-finite input', () => {
    // Regression: a manual draft save with an empty fee field used to
    // store NaN cents, which broke downstream reports.
    expect(feeDollarsToCents('')).toBe(0);
    expect(feeDollarsToCents(NaN)).toBe(0);
    expect(feeDollarsToCents(undefined)).toBe(0);
    expect(feeDollarsToCents(null)).toBe(0);
    expect(feeDollarsToCents(Infinity)).toBe(0);
    expect(feeDollarsToCents('abc')).toBe(0);
  });
});
