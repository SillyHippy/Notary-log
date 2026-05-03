/**
 * Pure logic for the dashboard "your backup is stale" nudge.
 *
 * Kept free of IndexedDB / localStorage / DOM access so the core decision
 * function can be unit-tested without browser globals. Callers wire it up to:
 *   - `gdrive_last_backup` (localStorage in `gdrive.ts`) for `lastBackupIso`
 *   - `NotarySettings.backupReminderDays` for `thresholdDays`
 *   - `NotarySettings.manualBackupOnly` for `manualBackupOnly`
 *   - The IDB `meta` store (`backup-snooze`) for `snoozeUntilMs`
 *   - `isGdriveConfigured()` / token presence for `gdriveAvailable` / `gdriveConnected`
 *
 * Snooze persistence used to live in localStorage but moved to IndexedDB so
 * it sits next to the rest of the app's per-device state and survives
 * private-mode / quota cleanups consistently with the journal itself.
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

  // Respect the user's "I'll handle backups manually" preference: never nag.
  if (manualBackupOnly) return { kind: 'none', daysSince: null, message: '' };

  // Respect the snooze window.
  if (snoozeUntilMs !== null && now < snoozeUntilMs) {
    return { kind: 'none', daysSince: null, message: '' };
  }

  // If the integration isn't configured at all (no client id), don't nag —
  // the admin/user can't act on the message.
  if (!gdriveAvailable) return { kind: 'none', daysSince: null, message: '' };

  // Drive available but the user hasn't connected yet → invite them to set it up.
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

// ── IndexedDB-backed snooze persistence ────────────────────────────────────
// Stored in the `meta` store at id='backup-snooze' so the snooze deadline
// lives next to the rest of the app's encrypted per-device state. The value
// itself (an epoch-ms number) is non-sensitive and is stored unencrypted.

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
