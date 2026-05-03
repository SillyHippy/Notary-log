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
 * Resolve an entry's fee category. Older entries lack the `feeType` field;
 * we derive a sensible default from `notarialActType` so reports and exports
 * work without rewriting (and thus invalidating) signed historical entries.
 *
 * Design note: an earlier draft of this feature called for a one-time data
 * migration that back-filled `feeType = 'Other'` on existing rows. We
 * intentionally chose a read-time fallback instead because every completed
 * entry is content-hashed (see `generateEntryHash` in db.ts) and rewriting
 * fields on disk would invalidate the chain. Reports therefore see a sensible
 * category for legacy rows without breaking tamper-evidence.
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
  count: number;          // total entries in this bucket
  chargedCount: number;   // entries with a non-waived, non-zero fee
  collectedCents: number; // sum of feeCharged for non-waived entries
  waivedCount: number;    // entries with feeWaived=true
  /**
   * Estimated $ value (cents) of waived fees, computed using the configured
   * default for each waived entry's category. Lets reports show a meaningful
   * "would-have-been" monetary total beside Collected. Zero when defaults
   * are not configured for those categories.
   */
  waivedEstimatedCents: number;
}

export interface YearRollup {
  year: number;
  /** Index 0 = January, 11 = December. */
  monthly: FeeBucket[];
  /** Map keyed by FeeType label (Acknowledgment, Jurat, …). */
  byType: Record<string, FeeBucket>;
  /** Map keyed by display label of the underlying notarialActType. */
  byAct: Record<string, FeeBucket>;
  totals: FeeBucket;
}

/** Human-readable label for the wizard's enum act-type. */
export const ACT_TYPE_LABELS: Record<NotarialActType, string> = {
  acknowledgment: 'Acknowledgment',
  jurat: 'Jurat',
  copy_certification: 'Copy Certification',
  signature_witnessing: 'Signature Witnessing',
  other: 'Other',
};

function emptyBucket(): FeeBucket {
  return { count: 0, chargedCount: 0, collectedCents: 0, waivedCount: 0, waivedEstimatedCents: 0 };
}

function applyEntry(
  bucket: FeeBucket,
  entry: JournalEntry,
  settings: Pick<NotarySettings, 'defaultFees'> | null | undefined,
): void {
  bucket.count += 1;
  if (entry.feeWaived) {
    bucket.waivedCount += 1;
    bucket.waivedEstimatedCents += getDefaultFeeCents(settings, resolveFeeType(entry));
  } else {
    // Defensive: treat negative or non-finite values as 0 so a bad entry
    // can't poison the totals row.
    const cents = Number.isFinite(entry.feeCharged) && entry.feeCharged > 0
      ? Math.round(entry.feeCharged)
      : 0;
    bucket.collectedCents += cents;
    if (cents > 0) bucket.chargedCount += 1;
  }
}

/**
 * Build a year-end roll-up from the journal. Counts only entries whose
 * `createdAt` falls in the requested calendar year and whose status is
 * completed or amended (drafts are excluded — they are not finalized work).
 *
 * `settings` is optional; when provided, waived entries gain an estimated
 * monetary value using the configured default for each fee category.
 */
export function rollupYear(
  entries: JournalEntry[],
  year: number,
  settings?: Pick<NotarySettings, 'defaultFees'> | null,
): YearRollup {
  const monthly: FeeBucket[] = Array.from({ length: 12 }, emptyBucket);
  const byType: Record<string, FeeBucket> = {};
  const byAct: Record<string, FeeBucket> = {};
  const totals = emptyBucket();

  for (const e of entries) {
    if (e.status !== 'completed' && e.status !== 'amended') continue;
    const d = new Date(e.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getFullYear() !== year) continue;

    applyEntry(monthly[d.getMonth()], e, settings);
    applyEntry(totals, e, settings);

    const ft = resolveFeeType(e);
    if (!byType[ft]) byType[ft] = emptyBucket();
    applyEntry(byType[ft], e, settings);

    const actLabel = ACT_TYPE_LABELS[e.notarialActType] ?? 'Other';
    if (!byAct[actLabel]) byAct[actLabel] = emptyBucket();
    applyEntry(byAct[actLabel], e, settings);
  }

  return { year, monthly, byType, byAct, totals };
}

/**
 * Pure rule for the new-entry wizard's auto-fill behaviour. The wizard treats
 * the fee field as "app-derived" until the user types into it, at which point
 * we stop overwriting their value. Toggling Waive on/off resets that flag
 * because the fee field is intentionally cleared.
 *
 * Returns the cents value to set on the form, or `null` to leave the field
 * untouched. Centralising this rule lets us cover it with unit tests.
 */
export function shouldApplyAutoFee(args: {
  feeType: FeeType;
  isWaived: boolean;
  isAppDerived: boolean;
  settings: Pick<NotarySettings, 'defaultFees'> | null | undefined;
}): number | null {
  if (args.isWaived) return null;
  if (!args.isAppDerived) return null;
  const cents = getDefaultFeeCents(args.settings, args.feeType);
  return cents > 0 ? cents : 0;
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
