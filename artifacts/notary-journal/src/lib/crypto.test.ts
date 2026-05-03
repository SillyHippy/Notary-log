import { describe, expect, it } from 'vitest';
import {
  generateSalt,
  deriveKey,
  encryptJSON,
  decryptJSON,
  sha256Hex,
  canonicalJson,
  bytesToBase64,
  base64ToBytes,
} from './crypto';

describe('crypto', () => {
  it('round-trips a JSON value through encrypt/decrypt with the same PIN', async () => {
    const salt = generateSalt();
    const key = await deriveKey('1234', salt, 1000);
    const blob = await encryptJSON(key, { hello: 'world', n: 42 });
    expect(blob.iv).toBeTypeOf('string');
    expect(blob.ct).toBeTypeOf('string');
    const out = await decryptJSON<{ hello: string; n: number }>(key, blob);
    expect(out).toEqual({ hello: 'world', n: 42 });
  });

  it('fails to decrypt with the wrong PIN', async () => {
    const salt = generateSalt();
    const right = await deriveKey('1234', salt, 1000);
    const wrong = await deriveKey('9999', salt, 1000);
    const blob = await encryptJSON(right, { secret: true });
    await expect(decryptJSON(wrong, blob)).rejects.toBeDefined();
  });

  it('produces different IVs for the same value', async () => {
    const salt = generateSalt();
    const key = await deriveKey('p', salt, 1000);
    const a = await encryptJSON(key, 'same');
    const b = await encryptJSON(key, 'same');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('canonicalJson is order-independent', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson({ a: { x: 1, y: 2 } })).toBe(canonicalJson({ a: { y: 2, x: 1 } }));
  });

  it('sha256Hex is deterministic', async () => {
    const a = await sha256Hex('hello');
    const b = await sha256Hex('hello');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('base64 helpers round-trip arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
