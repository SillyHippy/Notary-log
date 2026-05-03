/**
 * Biometric unlock via WebAuthn + PRF extension.
 *
 * Strategy: a platform credential's PRF output is a deterministic, per-RP
 * secret that the device only releases after a successful biometric prompt
 * (Face ID / Touch ID / fingerprint / Windows Hello). We use that output as
 * key material to wrap a copy of the user's PIN. On unlock, the same PRF
 * call yields the same wrapping key, so we can decrypt the stored PIN and
 * feed it through the existing `unlock(pin)` path.
 *
 * Important:
 *   - The PIN itself is still required to bootstrap encryption at-rest;
 *     biometric only caches it, locked behind the device's biometric.
 *   - If PRF isn't supported by the platform authenticator, enable throws
 *     and the toggle should stay off.
 *   - Disabling, changing the PIN, or losing the credential invalidates
 *     the wrapped PIN (and therefore the biometric path).
 */

import { bytesToBase64, base64ToBytes, encryptJSON, decryptJSON, type EncBlob } from './crypto';
import { getDB } from './db';

const META_KEY = 'biometric';
// The PRF "salt" (eval input) is fixed per record. Rotated by uninstall/disable.
const PRF_SALT_BYTES = 32;
const RP_NAME = 'Notary Journal';
const USER_NAME = 'notary';
const USER_DISPLAY = 'Notary Journal User';

export interface BiometricRecord {
  id: 'biometric';
  credentialId: string;   // base64 (raw)
  prfSalt: string;        // base64 (32 bytes)
  wrappedPin: EncBlob;    // PIN encrypted with key derived from PRF output
  createdAt: string;
}

// ── Capability checks ───────────────────────────────────────────────────────

export function isBiometricApiAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    !!navigator.credentials &&
    typeof navigator.credentials.create === 'function' &&
    typeof navigator.credentials.get === 'function'
  );
}

/**
 * True if the device exposes a platform authenticator (Face ID / Touch ID /
 * Android biometric / Windows Hello). Falls back to `false` on browsers that
 * don't implement the helper or that throw.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isBiometricApiAvailable()) return false;
  try {
    const fn = window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof fn !== 'function') return false;
    return await fn.call(window.PublicKeyCredential);
  } catch {
    return false;
  }
}

// ── IDB record access ───────────────────────────────────────────────────────

export async function getBiometricRecord(): Promise<BiometricRecord | undefined> {
  const db = await getDB();
  return db.get('meta', META_KEY) as Promise<BiometricRecord | undefined>;
}

export async function isBiometricEnabled(): Promise<boolean> {
  return !!(await getBiometricRecord());
}

export async function clearBiometric(): Promise<void> {
  const db = await getDB();
  await db.delete('meta', META_KEY);
}

// ── Internal helpers (exported for tests) ──────────────────────────────────

/** Import a PRF output (raw bytes) as an AES-GCM 256 wrapping key. */
export async function importPrfWrappingKey(prfOutput: Uint8Array): Promise<CryptoKey> {
  if (prfOutput.byteLength < 32) {
    throw new Error('PRF output too short to derive a 256-bit key');
  }
  return crypto.subtle.importKey(
    'raw',
    prfOutput.slice(0, 32) as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Read the PRF "first" output from a WebAuthn extension results object.
 * Returns null if the authenticator didn't honor the PRF extension request,
 * which typically means PRF isn't supported on this device.
 */
export function extractPrfOutput(results: AuthenticationExtensionsClientOutputs | undefined): Uint8Array | null {
  const prf = (results as { prf?: { results?: { first?: ArrayBuffer | Uint8Array } } } | undefined)?.prf;
  const first = prf?.results?.first;
  if (!first) return null;
  return first instanceof Uint8Array ? first : new Uint8Array(first);
}

// ── Enable / unlock ────────────────────────────────────────────────────────

/**
 * Register a platform credential locked behind device biometric and store a
 * PRF-wrapped copy of the PIN. Throws if the device doesn't support PRF.
 *
 * Two-step flow:
 *   1. `navigator.credentials.create` to register a new platform passkey.
 *   2. `navigator.credentials.get` immediately after, with the same PRF salt,
 *      to actually retrieve the PRF output. (Many authenticators only return
 *      PRF support — not the output itself — during create.)
 */
export async function enableBiometric(pin: string): Promise<void> {
  if (!isBiometricApiAvailable()) {
    throw new Error('Biometric authentication is not supported on this device.');
  }
  if (!pin) {
    throw new Error('PIN required to enable biometric unlock.');
  }

  const prfSalt = crypto.getRandomValues(new Uint8Array(PRF_SALT_BYTES));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as unknown as BufferSource,
      rp: { name: RP_NAME },
      user: {
        id: userId as unknown as BufferSource,
        name: USER_NAME,
        displayName: USER_DISPLAY,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: prfSalt as unknown as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!created) throw new Error('Biometric registration was cancelled.');

  const credentialId = new Uint8Array(created.rawId);

  // Step 2: actually fetch the PRF output via a get() call.
  const prfOutput = await assertAndGetPrfOutput(credentialId, prfSalt);

  const wrappingKey = await importPrfWrappingKey(prfOutput);
  const wrappedPin = await encryptJSON(wrappingKey, pin);

  const record: BiometricRecord = {
    id: META_KEY,
    credentialId: bytesToBase64(credentialId),
    prfSalt: bytesToBase64(prfSalt),
    wrappedPin,
    createdAt: new Date().toISOString(),
  };
  const db = await getDB();
  await db.put('meta', record);
}

/**
 * Prompt the device biometric and return the unwrapped PIN. Caller passes the
 * PIN to the existing `unlock()` path. Returns null if the user cancelled,
 * the credential is gone, or PRF is no longer available.
 */
export async function unwrapPinWithBiometric(): Promise<string | null> {
  const record = await getBiometricRecord();
  if (!record) return null;
  if (!isBiometricApiAvailable()) return null;

  const credentialId = base64ToBytes(record.credentialId);
  const prfSalt = base64ToBytes(record.prfSalt);

  let prfOutput: Uint8Array;
  try {
    prfOutput = await assertAndGetPrfOutput(credentialId, prfSalt);
  } catch {
    return null;
  }

  try {
    const wrappingKey = await importPrfWrappingKey(prfOutput);
    return await decryptJSON<string>(wrappingKey, record.wrappedPin);
  } catch {
    return null;
  }
}

async function assertAndGetPrfOutput(
  credentialId: Uint8Array,
  prfSalt: Uint8Array,
): Promise<Uint8Array> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge as unknown as BufferSource,
      allowCredentials: [
        { type: 'public-key', id: credentialId as unknown as BufferSource },
      ],
      userVerification: 'required',
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: prfSalt as unknown as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error('Biometric prompt cancelled.');
  const results = assertion.getClientExtensionResults?.();
  const out = extractPrfOutput(results);
  if (!out) {
    throw new Error('This device does not support the PRF extension required for biometric unlock.');
  }
  return out;
}
