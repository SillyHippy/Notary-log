/**
 * Biometric unlock via WebAuthn + PRF extension.
 *
 * Strategy: a platform credential's PRF output is a deterministic, per-RP
 * secret that the device only releases after a successful biometric prompt
 * (Face ID / Touch ID / fingerprint / Windows Hello). We use that output as
 * key material to wrap a copy of the journal's data-encryption key (the
 * raw 32-byte AES-GCM key material derived from the user's PIN). On unlock,
 * the same PRF call yields the same wrapping key, so we can decrypt the
 * stored key material and import it directly as the in-memory journal key.
 *
 * IMPORTANT — what is and is not stored:
 *   - We NEVER store the PIN itself, plaintext or wrapped. The PIN is only
 *     used at enrollment time, just long enough to derive the key material,
 *     which is then immediately overwritten in memory.
 *   - We store only `{credentialId, prfSalt, wrappedKey}` in IDB. The
 *     `wrappedKey` is the 32-byte journal key, encrypted with the PRF-derived
 *     wrapping key. Without a successful biometric prompt that yields the
 *     same PRF output, the wrapped key is opaque ciphertext.
 *   - If PRF isn't supported by the platform authenticator, enable throws
 *     and the toggle stays off.
 *   - Disabling, changing the PIN, or losing the credential invalidates the
 *     wrapped key (and therefore the biometric path).
 */

import { bytesToBase64, base64ToBytes, encryptJSON, decryptJSON, type EncBlob } from './crypto';
import { getDB, deriveJournalKeyMaterial, unlockWithKeyMaterial } from './db';

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
  // The journal's 32-byte AES-GCM key material, encrypted with a key derived
  // from the WebAuthn PRF output. NOT the user's PIN.
  wrappedKey: EncBlob;
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

// ── PRF capability probe ────────────────────────────────────────────────────
// We can't enroll a credential without a user gesture, so a fully reliable
// PRF probe isn't possible up-front on every browser. We use two signals:
//   1. PublicKeyCredential.getClientCapabilities() (Chrome 132+, Safari 18+),
//      which reports 'extension:prf' without prompting.
//   2. A persistent "PRF unsupported" flag we set the first time enrollment
//      fails with the PRF-extension-not-supported error, so we never offer
//      the toggle again on the same device.
// Together these let Settings hide/disable the biometric UI on devices that
// have a platform authenticator but cannot satisfy our PRF requirement.

const PRF_UNSUPPORTED_KEY = 'biometric-prf-unsupported';

export async function markPrfUnsupported(): Promise<void> {
  try {
    const db = await getDB();
    await db.put('meta', { id: PRF_UNSUPPORTED_KEY, at: new Date().toISOString() });
  } catch {/* non-fatal */}
}

export async function isPrfPersistentlyUnsupported(): Promise<boolean> {
  try {
    const db = await getDB();
    return !!(await db.get('meta', PRF_UNSUPPORTED_KEY));
  } catch {
    return false;
  }
}

/**
 * Best-effort up-front PRF support probe. Returns:
 *   - false  if a previous enrollment attempt on this device failed because
 *            the authenticator did not honor the PRF extension, OR if the
 *            browser exposes getClientCapabilities and reports no PRF.
 *   - true   otherwise (optimistic — the actual support is verified at
 *            enrollment time).
 *
 * Never prompts the user; safe to call on app startup.
 */
export async function isPrfLikelySupported(): Promise<boolean> {
  if (await isPrfPersistentlyUnsupported()) return false;
  try {
    const Pkc = (typeof window !== 'undefined' ? window.PublicKeyCredential : undefined) as
      | (typeof PublicKeyCredential & {
          getClientCapabilities?: () => Promise<Record<string, boolean>>;
        })
      | undefined;
    const fn = Pkc?.getClientCapabilities;
    if (typeof fn === 'function') {
      const caps = await fn.call(Pkc);
      // The spec uses 'extension:prf'; some early implementations used 'prf'.
      // Treat presence of either truthy key as support; absence is "unknown",
      // not "unsupported", so we stay optimistic and let enrollment confirm.
      const explicit = caps['extension:prf'] ?? caps['prf'];
      if (explicit === false) return false;
    }
  } catch {/* fall through to optimistic */}
  return true;
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
 * Register a platform credential locked behind device biometric, derive the
 * journal's encryption key from the supplied PIN, and store the key wrapped
 * by a PRF-derived key. Throws if the device doesn't support PRF or if the
 * PIN is wrong (so we never wrap a useless key).
 *
 * Two-step flow:
 *   1. `navigator.credentials.create` to register a new platform passkey.
 *   2. `navigator.credentials.get` immediately after, with the same PRF salt,
 *      to actually retrieve the PRF output. (Many authenticators only return
 *      PRF support — not the output itself — during create.)
 *
 * The PIN is consumed inside this function: the derived key material is
 * wrapped, the cleartext copy zeroed, and only the wrapped form is persisted.
 */
export async function enableBiometric(pin: string): Promise<void> {
  if (!isBiometricApiAvailable()) {
    throw new Error('Biometric authentication is not supported on this device.');
  }
  if (!pin) {
    throw new Error('PIN required to enable biometric unlock.');
  }

  // Derive the journal key material BEFORE invoking WebAuthn so we can fail
  // fast on a wrong PIN without prompting the user for biometric.
  const keyMaterial = await deriveJournalKeyMaterial(pin);
  if (!keyMaterial) {
    throw new Error('Incorrect PIN — cannot enroll biometric unlock.');
  }

  try {
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
    let prfOutput: Uint8Array;
    try {
      prfOutput = await assertAndGetPrfOutput(credentialId, prfSalt);
    } catch (err) {
      // If the authenticator silently dropped the PRF extension, persist a
      // "this device can't do PRF" flag so we don't keep offering the toggle.
      if (err instanceof Error && /PRF/.test(err.message)) {
        await markPrfUnsupported();
      }
      throw err;
    }

    const wrappingKey = await importPrfWrappingKey(prfOutput);
    // Encode as base64 inside the EncBlob so we never JSON.stringify a
    // Uint8Array (which would lose the byte values).
    const wrappedKey = await encryptJSON(wrappingKey, bytesToBase64(keyMaterial));

    const record: BiometricRecord = {
      id: META_KEY,
      credentialId: bytesToBase64(credentialId),
      prfSalt: bytesToBase64(prfSalt),
      wrappedKey,
      createdAt: new Date().toISOString(),
    };
    const db = await getDB();
    await db.put('meta', record);
  } finally {
    // Best-effort wipe of the in-memory key material copy.
    keyMaterial.fill(0);
  }
}

/**
 * Prompt the device biometric, unwrap the journal key, and install it as the
 * in-memory journal key (via `unlockWithKeyMaterial`). Returns true on
 * success, false on cancel / missing credential / PRF unavailable / stale
 * wrapped key.
 */
export async function unlockWithBiometric(): Promise<boolean> {
  const record = await getBiometricRecord();
  if (!record) return false;
  if (!isBiometricApiAvailable()) return false;

  const credentialId = base64ToBytes(record.credentialId);
  const prfSalt = base64ToBytes(record.prfSalt);

  let prfOutput: Uint8Array;
  try {
    prfOutput = await assertAndGetPrfOutput(credentialId, prfSalt);
  } catch {
    return false;
  }

  let material: Uint8Array;
  try {
    const wrappingKey = await importPrfWrappingKey(prfOutput);
    const b64 = await decryptJSON<string>(wrappingKey, record.wrappedKey);
    material = base64ToBytes(b64);
  } catch {
    return false;
  }

  try {
    return await unlockWithKeyMaterial(material);
  } finally {
    material.fill(0);
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
