import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory fake of the small slice of `idb`'s API that db.ts uses. Each
// test starts with an empty store map (see beforeEach below) so cases stay
// isolated.
const stores: Record<string, Map<unknown, unknown>> = {
  meta: new Map(),
  entries: new Map(),
  settings: new Map(),
};

function makeFakeDB() {
  const tx = (_names: string[] | string, _mode?: string) => ({
    objectStore: (name: string) => ({
      put: async (value: { id?: unknown }) => {
        stores[name].set(value.id, value);
      },
      get: async (key: unknown) => stores[name].get(key),
      index: () => ({ openCursor: async () => null }),
    }),
    done: Promise.resolve(),
  });
  return {
    get: async (store: string, key: unknown) => stores[store].get(key),
    getAll: async (store: string) => Array.from(stores[store].values()),
    put: async (store: string, value: { id?: unknown }) => {
      stores[store].set(value.id, value);
      return value.id;
    },
    add: async (store: string, value: { id?: unknown }) => {
      const id = (stores[store].size as number) + 1;
      stores[store].set(id, { ...value, id });
      return id;
    },
    delete: async (store: string, key: unknown) => {
      stores[store].delete(key);
    },
    transaction: tx,
  };
}

vi.mock('idb', () => ({
  openDB: async () => makeFakeDB(),
}));

// Minimal sessionStorage polyfill — vitest's default node environment
// doesn't ship one. We expose it on globalThis so the SUT's
// `typeof sessionStorage !== 'undefined'` check passes.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
}

(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage =
  new MemoryStorage();

const STORAGE_KEY = 'notary-journal:keyCache';

// Re-import after the mock so db.ts picks up our fake `openDB`.
import {
  setupCrypto,
  unlock,
  lock,
  isUnlocked,
  tryRestoreFromSessionCache,
  changePin,
  _setKeyForTests,
} from './db';

// Simulate a tab refresh: drop the in-memory key but keep sessionStorage
// intact. `_setKeyForTests(null)` would also clear the cache (mirroring
// `lock()`), which is the wrong shape for this scenario.
function simulateRefresh(): void {
  const snapshot = globalThis.sessionStorage.getItem(STORAGE_KEY);
  _setKeyForTests(null);
  if (snapshot !== null) {
    globalThis.sessionStorage.setItem(STORAGE_KEY, snapshot);
  }
}

beforeEach(() => {
  for (const m of Object.values(stores)) m.clear();
  (globalThis.sessionStorage as MemoryStorage).clear();
  _setKeyForTests(null);
});

describe('session key cache', () => {
  it('restores the unlocked state from sessionStorage after a "reload"', async () => {
    await setupCrypto('1234');
    expect(isUnlocked()).toBe(true);
    expect(globalThis.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();

    // Simulate a tab refresh: drop the in-memory key but keep sessionStorage.
    simulateRefresh();
    expect(isUnlocked()).toBe(false);

    const restored = await tryRestoreFromSessionCache();
    expect(restored).toBe(true);
    expect(isUnlocked()).toBe(true);
  });

  it('returns false and clears the cache when the entry has expired', async () => {
    await setupCrypto('1234');
    // Tamper with the stored expiry to simulate the idle window elapsing.
    const raw = globalThis.sessionStorage.getItem(STORAGE_KEY)!;
    const record = JSON.parse(raw);
    record.expiresAt = Date.now() - 1;
    globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    simulateRefresh();

    const restored = await tryRestoreFromSessionCache();
    expect(restored).toBe(false);
    expect(isUnlocked()).toBe(false);
    expect(globalThis.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clears the cache on explicit lock()', async () => {
    await setupCrypto('1234');
    expect(globalThis.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();

    lock();
    expect(isUnlocked()).toBe(false);
    expect(globalThis.sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    const restored = await tryRestoreFromSessionCache();
    expect(restored).toBe(false);
  });

  it('rejects stale cached material after a PIN change', async () => {
    // Original PIN sets up the cache.
    await setupCrypto('1234');
    const originalRecord = globalThis.sessionStorage.getItem(STORAGE_KEY)!;

    // PIN change should refresh the cache to the NEW material.
    const ok = await changePin('1234', '5678');
    expect(ok).toBe(true);
    const newRecord = globalThis.sessionStorage.getItem(STORAGE_KEY)!;
    expect(newRecord).not.toBe(originalRecord);

    // Simulate "another tab still has the pre-change cache": drop the
    // in-memory key and put the OLD record back into sessionStorage. The
    // canary in `meta` now belongs to the new key, so the restore must
    // detect the mismatch and refuse to install the stale bytes.
    globalThis.sessionStorage.setItem(STORAGE_KEY, originalRecord);
    simulateRefresh();

    const restored = await tryRestoreFromSessionCache();
    expect(restored).toBe(false);
    expect(isUnlocked()).toBe(false);
    expect(globalThis.sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    // The fresh PIN, however, still unlocks normally.
    const okNew = await unlock('5678');
    expect(okNew).toBe(true);
    expect(isUnlocked()).toBe(true);
  });

  it('returns false when no cache exists', async () => {
    expect(globalThis.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    const restored = await tryRestoreFromSessionCache();
    expect(restored).toBe(false);
  });
});
