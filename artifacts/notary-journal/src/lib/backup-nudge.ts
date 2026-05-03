/**
 * Pure logic for the dashboard "your backup is stale" nudge.
 *
 * Kept free of IndexedDB / localStorage / DOM access so it can be unit-tested
 * without browser globals. Callers wire it up to:
 *   - `gdrive_last_backup` (localStorage) for `lastBackupIso`
 *   - `NotarySettings.backupReminderDays` for `thresholdDays`
 *   - `NotarySettings.manualBackupOnly` for `manualBackupOnly`
 *   - `gdrive_backup_snooze_until` (localStorage) for `snoozeUntilMs`
 *   - `isGdriveConfigured()` / token presence for `gdriveAvailable` / `gdriveConnected`
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

// ── localStorage helpers (browser only) ────────────────────────────────────

const SNOOZE_KEY = 'gdrive_backup_snooze_until';

export function getSnoozeUntilMs(): number | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(SNOOZE_KEY);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function snoozeForOneDay(now: number = Date.now()): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SNOOZE_KEY, String(now + SNOOZE_HOURS * 60 * 60 * 1000));
}

export function clearSnooze(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(SNOOZE_KEY);
}
