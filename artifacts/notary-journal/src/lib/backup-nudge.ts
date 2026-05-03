/**
 * Pure decision logic for the dashboard backup-staleness nudge, plus
 * IDB-backed snooze persistence. The core function takes all inputs as
 * arguments so it can be unit-tested without browser globals.
 */

export type BackupNudgeKind = 'none' | 'never-configured' | 'never' | 'stale';

export interface BackupNudgeInputs {
  /** ISO string of the last successful Drive backup, or null if none yet. */
  lastBackupIso: string | null;
  /** How many days old a backup may be before we nudge. Default 7. */
  thresholdDays: number;
  /** Snooze expiration in epoch ms; if `now < snoozeUntilMs`, suppress nudge. */
  snoozeUntilMs: number | null;
  /** True if the user opted out of cloud backup entirely. Suppresses all nudges. */
  manualBackupOnly: boolean;
  /** True if the env-level Google Drive integration is configured at all. */
  gdriveAvailable: boolean;
  /** True if the user is currently signed into Google Drive. */
  gdriveConnected: boolean;
  /** Now, in epoch ms. Injected for testability. */
  now: number;
}

export interface BackupNudgeState {
  kind: BackupNudgeKind;
  /** Whole days since last successful backup, or null if never. */
  daysSince: number | null;
  /** UI-ready message; empty when `kind === 'none'`. */
  message: string;
}

export const DEFAULT_THRESHOLD_DAYS = 7;
export const SNOOZE_HOURS = 24;
export const THRESHOLD_OPTIONS = [3, 7, 14, 30] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeBackupNudge(inputs: BackupNudgeInputs): BackupNudgeState {
  const {
    lastBackupIso,
    thresholdDays,
    snoozeUntilMs,
    manualBackupOnly,
    gdriveAvailable,
    gdriveConnected,
    now,
  } = inputs;

  if (manualBackupOnly) return { kind: 'none', daysSince: null, message: '' };

  if (snoozeUntilMs !== null && now < snoozeUntilMs) {
    return { kind: 'none', daysSince: null, message: '' };
  }

  if (!gdriveAvailable) return { kind: 'none', daysSince: null, message: '' };

  if (!gdriveConnected) {
    return {
      kind: 'never-configured',
      daysSince: null,
      message: "You haven't set up cloud backup. Set it up?",
    };
  }

  if (!lastBackupIso) {
    return {
      kind: 'never',
      daysSince: null,
      message: 'You have not backed up to Google Drive yet — back up now?',
    };
  }

  const lastMs = Date.parse(lastBackupIso);
  if (!Number.isFinite(lastMs)) {
    return {
      kind: 'never',
      daysSince: null,
      message: 'Your last backup time is invalid — back up now?',
    };
  }

  const days = Math.floor(Math.max(0, now - lastMs) / MS_PER_DAY);
  if (days < thresholdDays) {
    return { kind: 'none', daysSince: days, message: '' };
  }
  return {
    kind: 'stale',
    daysSince: days,
    message: `Your last backup was ${days} day${days === 1 ? '' : 's'} ago — back up now?`,
  };
}

import { getDB } from './db';

const SNOOZE_META_KEY = 'backup-snooze';

interface SnoozeRecord {
  id: 'backup-snooze';
  untilMs: number;
}

export async function getSnoozeUntilMs(): Promise<number | null> {
  try {
    const db = await getDB();
    const rec = (await db.get('meta', SNOOZE_META_KEY)) as SnoozeRecord | undefined;
    if (!rec) return null;
    return Number.isFinite(rec.untilMs) ? rec.untilMs : null;
  } catch {
    return null;
  }
}

export async function snoozeForOneDay(now: number = Date.now()): Promise<void> {
  try {
    const db = await getDB();
    const rec: SnoozeRecord = {
      id: SNOOZE_META_KEY,
      untilMs: now + SNOOZE_HOURS * 60 * 60 * 1000,
    };
    await db.put('meta', rec);
  } catch {/* non-fatal */}
}

export async function clearSnooze(): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('meta', SNOOZE_META_KEY);
  } catch {/* non-fatal */}
}
