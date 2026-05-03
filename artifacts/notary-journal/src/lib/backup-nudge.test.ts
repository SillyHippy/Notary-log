import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock the IDB-backed snooze persistence layer with a Map-backed fake `meta`
// store. Mirrors the shim used in biometric.test.ts.
const fakeMeta = new Map<string, unknown>();
vi.mock('./db', () => ({
  getDB: async () => ({
    get: async (_store: string, key: string) => fakeMeta.get(key),
    put: async (_store: string, value: { id: string }) => {
      fakeMeta.set(value.id, value);
    },
    delete: async (_store: string, key: string) => {
      fakeMeta.delete(key);
    },
  }),
}));

const {
  computeBackupNudge,
  getSnoozeUntilMs,
  snoozeForOneDay,
  clearSnooze,
  DEFAULT_THRESHOLD_DAYS,
  SNOOZE_HOURS,
} = await import('./backup-nudge');

const NOW = Date.parse('2026-05-03T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function base(overrides: Partial<Parameters<typeof computeBackupNudge>[0]> = {}) {
  return {
    lastBackupIso: null,
    thresholdDays: DEFAULT_THRESHOLD_DAYS,
    snoozeUntilMs: null,
    manualBackupOnly: false,
    gdriveAvailable: true,
    gdriveConnected: true,
    now: NOW,
    ...overrides,
  };
}

describe('computeBackupNudge', () => {
  it('returns "never" when connected to Drive but no backup yet', () => {
    const r = computeBackupNudge(base());
    expect(r.kind).toBe('never');
    expect(r.daysSince).toBeNull();
    expect(r.message).toMatch(/back up now/i);
  });

  it('returns "never-configured" when Drive is available but not connected', () => {
    const r = computeBackupNudge(base({ gdriveConnected: false }));
    expect(r.kind).toBe('never-configured');
    expect(r.message).toMatch(/set up cloud backup/i);
  });

  it('returns "none" when Drive is not even available (no client id)', () => {
    const r = computeBackupNudge(base({ gdriveAvailable: false, gdriveConnected: false }));
    expect(r.kind).toBe('none');
  });

  it('returns "none" inside the threshold window', () => {
    const r = computeBackupNudge(base({
      lastBackupIso: new Date(NOW - 6 * DAY).toISOString(),
      thresholdDays: 7,
    }));
    expect(r.kind).toBe('none');
    expect(r.daysSince).toBe(6);
  });

  it('returns "none" exactly on the boundary day (threshold = strict greater-or-equal)', () => {
    const justUnder = computeBackupNudge(base({
      lastBackupIso: new Date(NOW - 7 * DAY + 1).toISOString(),
      thresholdDays: 7,
    }));
    expect(justUnder.kind).toBe('none');

    const exactly = computeBackupNudge(base({
      lastBackupIso: new Date(NOW - 7 * DAY).toISOString(),
      thresholdDays: 7,
    }));
    expect(exactly.kind).toBe('stale');
    expect(exactly.daysSince).toBe(7);
  });

  it('returns "stale" past the threshold with a count of days', () => {
    const r = computeBackupNudge(base({
      lastBackupIso: new Date(NOW - 12 * DAY).toISOString(),
      thresholdDays: 7,
    }));
    expect(r.kind).toBe('stale');
    expect(r.daysSince).toBe(12);
    expect(r.message).toContain('12 days ago');
  });

  it('uses singular "day" when daysSince is exactly 1', () => {
    const r = computeBackupNudge(base({
      lastBackupIso: new Date(NOW - 1 * DAY).toISOString(),
      thresholdDays: 1,
    }));
    expect(r.message).toContain('1 day ago');
    expect(r.message).not.toContain('1 days');
  });

  it('respects an active snooze window', () => {
    const r = computeBackupNudge(base({
      lastBackupIso: new Date(NOW - 30 * DAY).toISOString(),
      snoozeUntilMs: NOW + 3 * 60 * 60 * 1000,
    }));
    expect(r.kind).toBe('none');
  });

  it('ignores an expired snooze', () => {
    const r = computeBackupNudge(base({
      lastBackupIso: new Date(NOW - 30 * DAY).toISOString(),
      snoozeUntilMs: NOW - 60 * 1000,
    }));
    expect(r.kind).toBe('stale');
  });

  it('returns "none" when manualBackupOnly is set, even with a very stale backup', () => {
    const r = computeBackupNudge(base({
      lastBackupIso: new Date(NOW - 90 * DAY).toISOString(),
      manualBackupOnly: true,
    }));
    expect(r.kind).toBe('none');
  });

  it('handles unparseable last-backup ISO by treating as never', () => {
    const r = computeBackupNudge(base({ lastBackupIso: 'not-a-date' }));
    expect(r.kind).toBe('never');
  });

  it('honors a configured threshold of 30 days', () => {
    const r = computeBackupNudge(base({
      lastBackupIso: new Date(NOW - 29 * DAY).toISOString(),
      thresholdDays: 30,
    }));
    expect(r.kind).toBe('none');

    const stale = computeBackupNudge(base({
      lastBackupIso: new Date(NOW - 31 * DAY).toISOString(),
      thresholdDays: 30,
    }));
    expect(stale.kind).toBe('stale');
  });
});

describe('snooze persistence (IndexedDB)', () => {
  beforeEach(() => {
    fakeMeta.clear();
  });

  it('round-trips the snooze deadline through IDB', async () => {
    expect(await getSnoozeUntilMs()).toBeNull();
    await snoozeForOneDay(NOW);
    const got = await getSnoozeUntilMs();
    expect(got).toBe(NOW + SNOOZE_HOURS * 60 * 60 * 1000);
  });

  it('clearSnooze removes the deadline', async () => {
    await snoozeForOneDay(NOW);
    await clearSnooze();
    expect(await getSnoozeUntilMs()).toBeNull();
  });

  it('returns null when the stored value is malformed', async () => {
    fakeMeta.set('backup-snooze', { id: 'backup-snooze', untilMs: NaN });
    expect(await getSnoozeUntilMs()).toBeNull();
  });
});
