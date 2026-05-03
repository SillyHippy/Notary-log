import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  importPrfWrappingKey,
  extractPrfOutput,
} from './biometric';
import { encryptJSON, decryptJSON } from './crypto';

// We mock IDB and the parts of db.ts the biometric module touches:
//   - getDB returns a Map-backed fake `meta` store
//   - deriveJournalKeyMaterial returns deterministic bytes per PIN
//   - unlockWithKeyMaterial only succeeds for the bytes that match the
//     "current" PIN — so we can simulate the post-PIN-change stale path.
const fakeMeta = new Map<string, unknown>();
let currentPin = '1234';
function materialFor(pin: string): Uint8Array {
  // Deterministic 32-byte material derived from the PIN — sha256(pin) makes
  // the test reflect the real flow (different PIN ⇒ different bytes).
  const bytes = new TextEncoder().encode('material:' + pin);
  // Pad/truncate to exactly 32 bytes.
  const out = new Uint8Array(32);
  out.set(bytes.subarray(0, 32));
  for (let i = bytes.length; i < 32; i++) out[i] = (i * 7) & 0xff;
  return out;
}
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

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
  deriveJournalKeyMaterial: async (pin: string) => {
    if (pin !== currentPin) return null;
    return materialFor(pin);
  },
  unlockWithKeyMaterial: async (mat: Uint8Array) => {
    return bytesEqual(mat, materialFor(currentPin));
  },
}));

// Re-import after mock so the SUT picks up the fake `getDB`.
const {
  enableBiometric,
  unlockWithBiometric,
  isBiometricEnabled,
  clearBiometric,
  getBiometricRecord,
} = await import('./biometric');

// ── Fake WebAuthn (PRF-capable platform authenticator) ─────────────────────

let store: { rawId: ArrayBuffer } | null = null;

async function fakePrfOutput(credentialId: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const buf = new Uint8Array(credentialId.length + 1 + salt.length);
  buf.set(credentialId, 0);
  buf[credentialId.length] = 0;
  buf.set(salt, credentialId.length + 1);
  const digest = await crypto.subtle.digest('SHA-256', buf as unknown as BufferSource);
  return new Uint8Array(digest);
}

function installFakeWebAuthn() {
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = class {
    static isUserVerifyingPlatformAuthenticatorAvailable() { return Promise.resolve(true); }
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      credentials: {
        async create(_opts: CredentialCreationOptions) {
          const rawId = crypto.getRandomValues(new Uint8Array(16)).buffer;
          store = { rawId };
          return {
            rawId,
            type: 'public-key',
            getClientExtensionResults: () => ({}),
          } as unknown as PublicKeyCredential;
        },
        async get(opts: CredentialRequestOptions) {
          if (!store) throw new Error('No credential registered');
          const pk = opts.publicKey!;
          const allowedId = new Uint8Array(pk.allowCredentials![0].id as ArrayBuffer);
          const storedId = new Uint8Array(store.rawId);
          if (
            allowedId.length !== storedId.length ||
            !allowedId.every((b, i) => b === storedId[i])
          ) {
            throw new Error('Credential not found');
          }
          const ext = pk.extensions as { prf?: { eval?: { first?: ArrayBuffer | Uint8Array } } } | undefined;
          const saltBuf = ext?.prf?.eval?.first!;
          const salt = saltBuf instanceof Uint8Array ? saltBuf : new Uint8Array(saltBuf);
          const prf = await fakePrfOutput(storedId, salt);
          return {
            rawId: store.rawId,
            type: 'public-key',
            getClientExtensionResults: () => ({ prf: { results: { first: prf.buffer } } }),
          } as unknown as PublicKeyCredential;
        },
      },
    },
  });
}

function uninstallFakeWebAuthn() {
  store = null;
  delete (globalThis as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { credentials: undefined },
  });
}

describe('biometric helpers (pure)', () => {
  it('importPrfWrappingKey rejects PRF output shorter than 32 bytes', async () => {
    await expect(importPrfWrappingKey(new Uint8Array(16))).rejects.toThrow(/256-bit/);
  });

  it('extractPrfOutput returns null when PRF results are absent', () => {
    expect(extractPrfOutput(undefined)).toBeNull();
    expect(extractPrfOutput({} as AuthenticationExtensionsClientOutputs)).toBeNull();
  });

  it('extractPrfOutput returns the first PRF output when present', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const out = extractPrfOutput({
      // @ts-expect-error PRF is a non-standard extension shape
      prf: { results: { first: bytes.buffer } },
    });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out!)).toEqual([1, 2, 3, 4]);
  });

  it('a key imported from PRF output round-trips a JSON value', async () => {
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const key = await importPrfWrappingKey(prf);
    const blob = await encryptJSON(key, '1234');
    const same = await importPrfWrappingKey(prf);
    expect(await decryptJSON<string>(same, blob)).toBe('1234');
  });
});

describe('enable + unlock round-trip (mocked WebAuthn + mocked IDB)', () => {
  beforeEach(() => {
    fakeMeta.clear();
    currentPin = '1234';
    installFakeWebAuthn();
  });

  afterEach(() => {
    uninstallFakeWebAuthn();
  });

  it('wraps the JOURNAL KEY (not the PIN) on enable and unwraps the same key on unlock', async () => {
    expect(await isBiometricEnabled()).toBe(false);
    await enableBiometric('1234');
    expect(await isBiometricEnabled()).toBe(true);

    const rec = await getBiometricRecord();
    expect(rec).toBeDefined();
    // Critical security assertion: the stored record must NOT contain a
    // `wrappedPin` field. It should expose `wrappedKey` instead.
    expect(rec).not.toHaveProperty('wrappedPin');
    expect(rec).toHaveProperty('wrappedKey');

    // The unlock path installs the journal key via unlockWithKeyMaterial.
    expect(await unlockWithBiometric()).toBe(true);
  });

  it('refuses to enroll when the PIN is wrong (key material derivation fails)', async () => {
    await expect(enableBiometric('9999')).rejects.toThrow(/Incorrect PIN/);
    expect(await isBiometricEnabled()).toBe(false);
  });

  it('returns false from unlock after the PIN has changed (stale wrapped key)', async () => {
    await enableBiometric('1234');
    expect(await unlockWithBiometric()).toBe(true);

    // Simulate a PIN change: the journal's key material is now different,
    // so the wrapped bytes no longer decrypt the canary.
    currentPin = '5678';
    expect(await unlockWithBiometric()).toBe(false);
  });

  it('clearBiometric disables biometric unlock', async () => {
    await enableBiometric('1234');
    await clearBiometric();
    expect(await isBiometricEnabled()).toBe(false);
    expect(await unlockWithBiometric()).toBe(false);
  });

  it('returns false from unlock when no biometric is enrolled', async () => {
    expect(await unlockWithBiometric()).toBe(false);
  });
});
