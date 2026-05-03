// WebCrypto helpers for at-rest encryption and tamper-evident hashing.
// AES-GCM 256 with PBKDF2-derived keys. Salt and an "OK" canary are stored
// alongside data so the right PIN can be verified before unlocking.

const PBKDF2_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export const DEFAULT_ITERATIONS = PBKDF2_ITERATIONS;

export interface EncBlob {
  iv: string; // base64 (12 bytes)
  ct: string; // base64 (ciphertext + auth tag)
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

export async function deriveKey(
  pin: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Derive the SAME 256 bits used by `deriveKey`, but return the raw bytes
 * instead of a non-extractable CryptoKey. Used only by the biometric-unlock
 * path so we can wrap a copy of the key material behind WebAuthn/PRF.
 *
 * NOTE: bytes returned here are the journal's encryption key material — they
 * must never be persisted in cleartext. Callers wrap them with an
 * AES-GCM key derived from the device's PRF output before storing.
 */
export async function deriveKeyMaterial(
  pin: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}

/** Reconstruct the in-memory non-extractable AES-GCM key from raw key material. */
export async function importAesKey(material: Uint8Array): Promise<CryptoKey> {
  if (material.byteLength !== 32) {
    throw new Error('AES-GCM 256 requires exactly 32 bytes of key material');
  }
  return crypto.subtle.importKey(
    'raw',
    material as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<EncBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource);
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

export async function decryptJSON<T = unknown>(key: CryptoKey, blob: EncBlob): Promise<T> {
  const iv = base64ToBytes(blob.iv);
  const ct = base64ToBytes(blob.ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return bytesToHex(new Uint8Array(hash));
}

/** Stable JSON: keys sorted recursively so hashes are deterministic. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  return Object.keys(v as object).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = sortKeys((v as Record<string, unknown>)[k]);
    return acc;
  }, {});
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}
