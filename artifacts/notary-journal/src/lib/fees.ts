import type { JournalEntry, NotarySettings } from './db';

/**
 * Itemized fee categories. These are the labels stored on entries (as
 * `feeType`) and the keys used in `settings.defaultFees`. Kept as plain
 * strings (not an enum) so backups created in older app versions that lack
 * the field still round-trip cleanly.
 */
export const FEE_TYPES = [
  'Acknowledgment',
  'Jurat',
  'Oath',
  'Copy Certification',
  'Signature Witnessing',
  'Travel',
  'Other',
] as const;

export type FeeType = typeof FEE_TYPES[number];

export type NotarialActType = JournalEntry['notarialActType'];

/** Map from the wizard's enum act-type to the human-readable fee category. */
export const ACT_TYPE_TO_FEE_TYPE: Record<NotarialActType, FeeType> = {
  acknowledgment: 'Acknowledgment',
  jurat: 'Jurat',
  copy_certification: 'Copy Certification',
  signature_witnessing: 'Signature Witnessing',
  other: 'Other',
};

/**
 * Resolve an entry's fee category. Pre-Task-15 entries lack the `feeType`
 * field; we derive a sensible default from `notarialActType` so reports and
 * exports work without rewriting (and thus invalidating) signed historical
 * entries.
 */
export function resolveFeeType(entry: Pick<JournalEntry, 'feeType' | 'notarialActType'>): FeeType {
  if (entry.feeType && (FEE_TYPES as readonly string[]).includes(entry.feeType)) {
    return entry.feeType as FeeType;
  }
  // Unknown/missing → derive from act-type
  return ACT_TYPE_TO_FEE_TYPE[entry.notarialActType] ?? 'Other';
}

/**
 * Look up the configured default fee (in cents) for a given category. Falls
 * back to `0` when nothing is configured, so the fee field in the wizard
 * stays user-driven rather than guessing.
 */
export function getDefaultFeeCents(
  settings: Pick<NotarySettings, 'defaultFees'> | null | undefined,
  feeType: FeeType,
): number {
  const v = settings?.defaultFees?.[feeType];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

export interface FeeBucket {
  count: number;        // total entries in this bucket
  collectedCents: number; // sum of feeCharged for non-waived entries
  waivedCount: number;  // entries with feeWaived=true
}

export interface YearRollup {
  year: number;
  /** Index 0 = January, 11 = December. */
  monthly: FeeBucket[];
  /** Map keyed by FeeType label. */
  byType: Record<string, FeeBucket>;
  totals: FeeBucket;
}

function emptyBucket(): FeeBucket {
  return { count: 0, collectedCents: 0, waivedCount: 0 };
}

function applyEntry(bucket: FeeBucket, entry: JournalEntry): void {
  bucket.count += 1;
  if (entry.feeWaived) {
    bucket.waivedCount += 1;
  } else {
    // Defensive: treat negative or non-finite values as 0 so a bad entry
    // can't poison the totals row.
    const cents = Number.isFinite(entry.feeCharged) && entry.feeCharged > 0
      ? Math.round(entry.feeCharged)
      : 0;
    bucket.collectedCents += cents;
  }
}

/**
 * Build a year-end roll-up from the journal. Counts only entries whose
 * `createdAt` falls in the requested calendar year and whose status is
 * completed or amended (drafts are excluded — they are not finalized work).
 */
export function rollupYear(entries: JournalEntry[], year: number): YearRollup {
  const monthly: FeeBucket[] = Array.from({ length: 12 }, emptyBucket);
  const byType: Record<string, FeeBucket> = {};
  const totals = emptyBucket();

  for (const e of entries) {
    if (e.status !== 'completed' && e.status !== 'amended') continue;
    const d = new Date(e.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getFullYear() !== year) continue;

    applyEntry(monthly[d.getMonth()], e);
    applyEntry(totals, e);

    const ft = resolveFeeType(e);
    if (!byType[ft]) byType[ft] = emptyBucket();
    applyEntry(byType[ft], e);
  }

  return { year, monthly, byType, totals };
}

/**
 * Distinct calendar years (descending) that contain at least one
 * completed/amended entry. Used to populate the year picker on Reports.
 */
export function availableReportYears(entries: JournalEntry[]): number[] {
  const years = new Set<number>();
  for (const e of entries) {
    if (e.status !== 'completed' && e.status !== 'amended') continue;
    const d = new Date(e.createdAt);
    if (!Number.isNaN(d.getTime())) years.add(d.getFullYear());
  }
  if (years.size === 0) years.add(new Date().getFullYear());
  return [...years].sort((a, b) => b - a);
}

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
