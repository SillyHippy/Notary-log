/** Web Crypto HMAC for Cal webhook signature verification (Workers runtime). */

export async function verifyCalHmac(
  rawBody: string,
  signature: string | null,
  secret: string,
  allowInsecure = false,
): Promise<boolean> {
  if (!secret) return allowInsecure;
  if (!signature) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = bufferToHex(sig);
  const a = enc.encode(expected);
  const b = enc.encode(signature.trim());
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

function bufferToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
