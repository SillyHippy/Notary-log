/**
 * Biometric unlock via WebAuthn + PRF extension. Wraps the journal's
 * 32-byte AES-GCM key material with a key derived from the credential's
 * PRF output. The user's PIN is never stored.
 */

import { bytesToBase64, base64ToBytes, encryptJSON, decryptJSON, type EncBlob } from './crypto';
import { getDB, deriveJournalKeyMaterial, unlockWithKeyMaterial } from './db';

const META_KEY = 'biometric';
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

export function isBiometricApiAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    !!navigator.credentials &&
    typeof navigator.credentials.create === 'function' &&
    typeof navigator.credentials.get === 'function'
  );
}

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
 * Non-prompting PRF support probe. Returns false only when we have hard
 * evidence PRF won't work (a prior enrollment failure, or
 * getClientCapabilities reporting no PRF); optimistic otherwise.
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
      const explicit = caps['extension:prf'] ?? caps['prf'];
      if (explicit === false) return false;
    }
  } catch {/* optimistic */}
  return true;
}

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

export function extractPrfOutput(results: AuthenticationExtensionsClientOutputs | undefined): Uint8Array | null {
  const prf = (results as { prf?: { results?: { first?: ArrayBuffer | Uint8Array } } } | undefined)?.prf;
  const first = prf?.results?.first;
  if (!first) return null;
  return first instanceof Uint8Array ? first : new Uint8Array(first);
}

/**
 * Register a platform credential and store the journal's encryption key
 * wrapped under the credential's PRF output. Throws on wrong PIN or if PRF
 * isn't honored. Does a create() then an immediate get() because some
 * authenticators only expose PRF on get.
 */
export async function enableBiometric(pin: string): Promise<void> {
  if (!isBiometricApiAvailable()) {
    throw new Error('Biometric authentication is not supported on this device.');
  }
  if (!pin) {
    throw new Error('PIN required to enable biometric unlock.');
  }

  // Verify the PIN before prompting for biometric so a wrong PIN fails fast.
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

    let prfOutput: Uint8Array;
    try {
      prfOutput = await assertAndGetPrfOutput(credentialId, prfSalt);
    } catch (err) {
      if (err instanceof Error && /PRF/.test(err.message)) {
        await markPrfUnsupported();
      }
      throw err;
    }

    const wrappingKey = await importPrfWrappingKey(prfOutput);
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
    keyMaterial.fill(0);
  }
}

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
