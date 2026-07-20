/**
 * Cal.com OAuth (standard "Continue with Cal.com") for Zo cal host.
 * Confidential client — token exchange only on server.
 */
import type { Database } from "bun:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export type ZoUser = { id: string; name: string; email: string };

function requestOrigin(request: Request, url: URL): string {
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    url.host;
  if (host.includes("zocomputer.io") || host.includes("workers.dev")) {
    return `https://${host}`;
  }
  return `${proto}://${host}`;
}

function isValidSlug(slug: string): boolean {
  if (!slug || slug.length < 2 || slug.length > 48) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) return false;
  return true;
}

async function getPlatformWebhookSecret(): Promise<string> {
  const fromEnv = process.env.CAL_WEBHOOK_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const dir = process.env.JOURNAL_DIR?.trim() || "./Documents/Notary Journal";
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, ".cal-platform-webhook-secret");
  const f = Bun.file(filePath);
  if (await f.exists()) {
    const existing = (await f.text()).trim();
    if (existing) return existing;
  }
  return "";
}

const CAL_AUTH_URL = "https://app.cal.com/auth/oauth2/authorize";
const CAL_TOKEN_URL = "https://api.cal.com/v2/auth/oauth2/token";
const CAL_API = "https://api.cal.com/v2";
const CAL_API_VERSION = "2024-08-13";

export type OAuthEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  encryptionKey: Buffer | null;
  configured: boolean;
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Notary-Token",
  };
}

export function getOAuthEnv(): OAuthEnv {
  const clientId = process.env.CAL_OAUTH_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.CAL_OAUTH_CLIENT_SECRET?.trim() || "";
  const redirectUri =
    process.env.CAL_OAUTH_REDIRECT_URI?.trim() ||
    "https://notary-log-cal-sillyhippy.zocomputer.io/api/cal/oauth/callback";
  const scopes =
    process.env.CAL_OAUTH_SCOPES?.trim() ||
    "PROFILE_READ EVENT_TYPE_READ BOOKING_READ WEBHOOK_READ WEBHOOK_WRITE";
  let keyRaw = process.env.CAL_TOKEN_ENCRYPTION_KEY?.trim() || "";
  // Fallback: journal-dir file (supervisor env can choke on base64 +/=)
  if (!keyRaw) {
    try {
      const dir =
        process.env.JOURNAL_DIR?.trim() || "./Documents/Notary Journal";
      const f = Bun.file(join(dir, ".cal-token-encryption-key"));
      // sync-ish via cache — file is small
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = (globalThis as any).__calEncKeyCache as string | undefined;
      if (text) keyRaw = text;
    } catch {
      /* ignore */
    }
  }
  let encryptionKey: Buffer | null = null;
  if (keyRaw) {
    try {
      // accept base64 (32 bytes) or 64-char hex
      if (/^[0-9a-fA-F]{64}$/.test(keyRaw)) {
        encryptionKey = Buffer.from(keyRaw, "hex");
      } else {
        const b = Buffer.from(keyRaw, "base64");
        if (b.length === 32) encryptionKey = b;
      }
    } catch {
      encryptionKey = null;
    }
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    encryptionKey,
    configured: !!(clientId && clientSecret && encryptionKey),
  };
}

/** Load encryption key file once at startup (call from server). */
export async function loadOAuthEncryptionKeyFromDisk(): Promise<void> {
  if (process.env.CAL_TOKEN_ENCRYPTION_KEY?.trim()) return;
  const dir = process.env.JOURNAL_DIR?.trim() || "./Documents/Notary Journal";
  const filePath = join(dir, ".cal-token-encryption-key");
  const f = Bun.file(filePath);
  if (await f.exists()) {
    const key = (await f.text()).trim();
    if (key) process.env.CAL_TOKEN_ENCRYPTION_KEY = key;
  }
}

export function migrateOAuthSchema(db: Database): void {
  const cols = db
    .query(`PRAGMA table_info(users)`)
    .all() as Array<{ name: string }>;
  const have = new Set(cols.map((c) => c.name));
  const add = (name: string, def: string) => {
    if (!have.has(name)) {
      db.run(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
    }
  };
  add("cal_oauth_access_token_enc", "TEXT");
  add("cal_oauth_refresh_token_enc", "TEXT");
  add("cal_oauth_expires_at", "TEXT");
  add("cal_oauth_scope", "TEXT");
  add("cal_oauth_connected_at", "TEXT");
  add("cal_user_id", "TEXT");
  add("cal_default_event_type_id", "INTEGER");
  add("cal_managed_webhook_id", "TEXT");

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      user_token TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    )
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at)`,
  );
}

function deriveKeyFallback(): Buffer {
  // Last-resort key from client secret (still better than plaintext). Prefer env key.
  const secret = process.env.CAL_OAUTH_CLIENT_SECRET || "notary-log-cal-oauth";
  return createHash("sha256").update(`notary-log-cal:${secret}`).digest();
}

function getKey(env: OAuthEnv): Buffer {
  return env.encryptionKey || deriveKeyFallback();
}

/** AES-256-GCM encrypt → base64(iv|tag|ciphertext) */
export function encryptToken(plaintext: string, env: OAuthEnv): string {
  const key = getKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptToken(payload: string, env: OAuthEnv): string {
  const key = getKey(env);
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 12 + 16 + 1) throw new Error("Invalid token blob");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

function getNotaryToken(request: Request, url: URL): string {
  const h =
    request.headers.get("X-Notary-Token") ||
    request.headers.get("Authorization") ||
    "";
  if (h.toLowerCase().startsWith("bearer ")) {
    return h.slice(7).trim();
  }
  if (h && !h.includes(" ")) return h.trim();
  return (url.searchParams.get("key") || "").trim();
}

function validateToken(db: Database, token: string): ZoUser | null {
  if (!token) return null;
  const row = db
    .query("SELECT id, name, email FROM users WHERE token = ?")
    .get(token) as ZoUser | null;
  return row ?? null;
}

function purgeExpiredStates(db: Database): void {
  db.run(`DELETE FROM oauth_states WHERE expires_at < datetime('now')`);
}

/** HMAC key for self-contained OAuth state (survives DB misses / double callbacks). */
function stateSigningKey(env: OAuthEnv): Buffer {
  const material = [
    env.clientSecret || "",
    process.env.CAL_TOKEN_ENCRYPTION_KEY || "",
    "notary-log-oauth-state-v1",
  ].join(":");
  return createHash("sha256").update(material).digest();
}

/**
 * Signed state embeds notary token + expiry so callback does not depend only on SQLite.
 * Format: base64url(payloadJson).base64url(hmac)
 */
function createSignedState(userToken: string, env: OAuthEnv, ttlMs = 30 * 60 * 1000): string {
  const payload = {
    t: userToken,
    e: Date.now() + ttlMs,
    n: randomBytes(16).toString("hex"),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", stateSigningKey(env))
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifySignedState(
  state: string,
  env: OAuthEnv,
): { userToken: string; nonce: string } | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateSigningKey(env))
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as { t?: string; e?: number; n?: string };
    if (!payload.t || typeof payload.t !== "string") return null;
    if (!payload.e || typeof payload.e !== "number") return null;
    if (payload.e < Date.now()) return null;
    return { userToken: payload.t, nonce: payload.n || "" };
  } catch {
    return null;
  }
}

/**
 * Resolve notary token for callback: prefer signed state; fall back to DB row.
 * Marks nonce one-time in DB when possible (best-effort anti-replay).
 */
function resolveOAuthState(
  db: Database,
  state: string,
  env: OAuthEnv,
): { userToken: string; source: "signed" | "db"; replay: boolean } | null {
  const signed = verifySignedState(state, env);
  if (signed) {
    // Best-effort one-time: if nonce was already consumed, flag replay
    const nonceKey = `s:${signed.nonce || state.slice(0, 32)}`;
    const existing = db
      .query(`SELECT user_token FROM oauth_states WHERE state = ?`)
      .get(nonceKey) as { user_token: string } | null;

    if (existing?.user_token === "used") {
      return { userToken: signed.userToken, source: "signed", replay: true };
    }

    // Mark consumed (store under nonce key)
    const exp = new Date(Date.now() + 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");
    try {
      db.run(`DELETE FROM oauth_states WHERE state = ?`, [nonceKey]);
      db.run(
        `INSERT INTO oauth_states (state, user_token, expires_at) VALUES (?, ?, ?)`,
        [nonceKey, "used", exp],
      );
    } catch {
      /* ignore */
    }

    // Also clear legacy random-state rows if any
    try {
      db.run(`DELETE FROM oauth_states WHERE state = ?`, [state]);
    } catch {
      /* ignore */
    }

    return { userToken: signed.userToken, source: "signed", replay: false };
  }

  // Legacy DB-only state (pre-fix sessions)
  purgeExpiredStates(db);
  const st = db
    .query(`SELECT user_token, expires_at FROM oauth_states WHERE state = ?`)
    .get(state) as { user_token: string; expires_at: string } | null;
  if (!st?.user_token || st.user_token === "used") return null;
  db.run(`DELETE FROM oauth_states WHERE state = ?`, [state]);
  return { userToken: st.user_token, source: "db", replay: false };
}

function settingsRedirect(
  request: Request,
  url: URL,
  query: Record<string, string>,
): Response {
  const origin = requestOrigin(request, url);
  const q = new URLSearchParams(query);
  // SPA Settings route
  const loc = `${origin}/settings?${q.toString()}`;
  return Response.redirect(loc, 302);
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number | string;
  scope?: string;
  token_type?: string;
  // nested data shape
  data?: TokenResponse;
};

function unwrapTokens(body: TokenResponse): {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
} {
  const t = body.data && body.data.access_token ? body.data : body;
  if (!t.access_token) {
    throw new Error("Token response missing access_token");
  }
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_in: typeof t.expires_in === "number" ? t.expires_in : undefined,
    scope: t.scope,
  };
}

async function exchangeCode(
  env: OAuthEnv,
  code: string,
): Promise<ReturnType<typeof unwrapTokens>> {
  const res = await fetch(CAL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: env.redirectUri,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse & {
    message?: string;
    error?: string;
  };
  if (!res.ok) {
    const msg =
      body.message ||
      body.error ||
      `Token exchange failed (${res.status})`;
    throw new Error(msg);
  }
  return unwrapTokens(body);
}

async function refreshAccessToken(
  env: OAuthEnv,
  refreshToken: string,
): Promise<ReturnType<typeof unwrapTokens>> {
  const res = await fetch(CAL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse & {
    message?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(
      body.message || body.error || `Refresh failed (${res.status})`,
    );
  }
  return unwrapTokens(body);
}

async function calApiGet(
  accessToken: string,
  path: string,
): Promise<unknown> {
  const res = await fetch(`${CAL_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "cal-api-version": CAL_API_VERSION,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (body as { message?: string }).message ||
      `Cal API ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

async function calApiPost(
  accessToken: string,
  path: string,
  payload: unknown,
): Promise<unknown> {
  const res = await fetch(`${CAL_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "cal-api-version": CAL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (body as { message?: string }).message ||
      `Cal API POST ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

function expiresAtIso(expiresIn?: number): string {
  const sec = expiresIn && expiresIn > 0 ? expiresIn : 3600;
  return new Date(Date.now() + sec * 1000).toISOString();
}

function storeTokens(
  db: Database,
  userToken: string,
  env: OAuthEnv,
  tokens: ReturnType<typeof unwrapTokens>,
): void {
  const accessEnc = encryptToken(tokens.access_token, env);
  const refreshEnc = tokens.refresh_token
    ? encryptToken(tokens.refresh_token, env)
    : null;
  const exp = expiresAtIso(tokens.expires_in);
  const now = new Date().toISOString();
  if (refreshEnc) {
    db.run(
      `UPDATE users SET
        cal_oauth_access_token_enc = ?,
        cal_oauth_refresh_token_enc = ?,
        cal_oauth_expires_at = ?,
        cal_oauth_scope = ?,
        cal_oauth_connected_at = COALESCE(cal_oauth_connected_at, ?),
        updated_at = ?
       WHERE token = ?`,
      [
        accessEnc,
        refreshEnc,
        exp,
        tokens.scope || env.scopes,
        now,
        now,
        userToken,
      ],
    );
  } else {
    db.run(
      `UPDATE users SET
        cal_oauth_access_token_enc = ?,
        cal_oauth_expires_at = ?,
        cal_oauth_scope = ?,
        cal_oauth_connected_at = COALESCE(cal_oauth_connected_at, ?),
        updated_at = ?
       WHERE token = ?`,
      [accessEnc, exp, tokens.scope || env.scopes, now, now, userToken],
    );
  }
}

async function getValidAccessToken(
  db: Database,
  userToken: string,
  env: OAuthEnv,
): Promise<string | null> {
  const row = db
    .query(
      `SELECT cal_oauth_access_token_enc, cal_oauth_refresh_token_enc, cal_oauth_expires_at
       FROM users WHERE token = ?`,
    )
    .get(userToken) as {
    cal_oauth_access_token_enc: string | null;
    cal_oauth_refresh_token_enc: string | null;
    cal_oauth_expires_at: string | null;
  } | null;
  if (!row?.cal_oauth_access_token_enc) return null;

  const expMs = row.cal_oauth_expires_at
    ? Date.parse(row.cal_oauth_expires_at)
    : 0;
  const needsRefresh = !expMs || expMs < Date.now() + 60_000;

  if (!needsRefresh) {
    try {
      return decryptToken(row.cal_oauth_access_token_enc, env);
    } catch {
      return null;
    }
  }

  if (!row.cal_oauth_refresh_token_enc) {
    try {
      return decryptToken(row.cal_oauth_access_token_enc, env);
    } catch {
      return null;
    }
  }

  try {
    const refresh = decryptToken(row.cal_oauth_refresh_token_enc, env);
    const tokens = await refreshAccessToken(env, refresh);
    storeTokens(db, userToken, env, tokens);
    return tokens.access_token;
  } catch {
    return null;
  }
}

function extractProfile(meBody: unknown): {
  username: string | null;
  userId: string | null;
  name: string | null;
} {
  const root = meBody as {
    data?: Record<string, unknown>;
    username?: string;
    id?: number | string;
    name?: string;
  };
  const d = (root.data || root) as Record<string, unknown>;
  const username =
    typeof d.username === "string"
      ? d.username
      : typeof root.username === "string"
        ? root.username
        : null;
  const idRaw = d.id ?? root.id;
  const userId =
    idRaw === undefined || idRaw === null ? null : String(idRaw);
  const name =
    typeof d.name === "string"
      ? d.name
      : typeof root.name === "string"
        ? root.name
        : null;
  return { username, userId, name };
}

function extractEventTypes(body: unknown): Array<{
  id: number;
  slug: string;
  title?: string;
}> {
  const root = body as { data?: unknown };
  const list = Array.isArray(root.data)
    ? root.data
    : Array.isArray(body)
      ? body
      : [];
  const out: Array<{ id: number; slug: string; title?: string }> = [];
  for (const item of list as Array<Record<string, unknown>>) {
    const id = Number(item.id);
    const slug = typeof item.slug === "string" ? item.slug : "";
    if (!Number.isFinite(id) || !slug) continue;
    out.push({
      id,
      slug,
      title: typeof item.title === "string" ? item.title : undefined,
    });
  }
  return out;
}

async function applyProfileAndBookingUrl(
  db: Database,
  userToken: string,
  accessToken: string,
): Promise<{ username: string | null; eventTypes: number; reclaimed: boolean }> {
  const me = await calApiGet(accessToken, "/me");
  const profile = extractProfile(me);
  console.log(
    `OAuth profile raw username=${profile.username} id=${profile.userId} name=${profile.name}`,
  );

  let eventTypes: Array<{ id: number; slug: string; title?: string }> = [];
  try {
    const et = await calApiGet(accessToken, "/event-types");
    eventTypes = extractEventTypes(et);
  } catch (e) {
    console.warn(
      "event-types fetch failed:",
      e instanceof Error ? e.message : e,
    );
  }

  const username = profile.username?.toLowerCase() || null;
  let bookingUrl: string | null = null;
  let eventSlug: string | null = null;
  let defaultEventId: number | null = null;

  if (username && eventTypes.length >= 1) {
    // Prefer a single obvious default; if many, still set profile URL
    if (eventTypes.length === 1) {
      eventSlug = eventTypes[0].slug;
      defaultEventId = eventTypes[0].id;
      bookingUrl = `https://cal.com/${username}/${eventSlug}`;
    } else {
      bookingUrl = `https://cal.com/${username}`;
    }
  } else if (username) {
    bookingUrl = `https://cal.com/${username}`;
  }

  const forcedSlug = username
    ? username
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48)
    : null;

  let reclaimed = false;
  if (forcedSlug && isValidSlug(forcedSlug)) {
    // Cal username is globally unique. OAuth prove ownership — reclaim from
    // any other local row (stale phone tokens / test accounts).
    const others = db
      .query(
        `SELECT token FROM users
         WHERE token != ?
           AND (
             lower(slug) = ?
             OR lower(cal_username) = ?
           )`,
      )
      .all(userToken, forcedSlug, username) as Array<{ token: string }>;

    for (const o of others) {
      db.run(
        `UPDATE users SET
          slug = NULL,
          cal_username = NULL,
          cal_booking_url = NULL,
          cal_event_slug = NULL,
          cal_default_event_type_id = NULL,
          updated_at = ?
         WHERE token = ?`,
        [new Date().toISOString(), o.token],
      );
      reclaimed = true;
      console.log(
        `OAuth reclaimed cal username ${username} from stale token ${o.token.slice(0, 8)}…`,
      );
    }
  }

  const now = new Date().toISOString();
  // Always overwrite with OAuth profile (not COALESCE) so reconnect fixes blank state
  db.run(
    `UPDATE users SET
      cal_user_id = ?,
      cal_username = ?,
      cal_booking_url = ?,
      cal_event_slug = ?,
      cal_default_event_type_id = ?,
      slug = ?,
      display_name = COALESCE(NULLIF(display_name, ''), ?),
      updated_at = ?
     WHERE token = ?`,
    [
      profile.userId,
      username,
      bookingUrl,
      eventSlug,
      defaultEventId,
      forcedSlug && isValidSlug(forcedSlug) ? forcedSlug : null,
      profile.name || "Notary",
      now,
      userToken,
    ],
  );

  return { username, eventTypes: eventTypes.length, reclaimed };
}

async function ensureWebhook(
  db: Database,
  userToken: string,
  accessToken: string,
  webhookUrl: string,
  secret: string,
): Promise<string | null> {
  try {
    // List existing
    const listed = (await calApiGet(accessToken, "/webhooks")) as {
      data?: Array<{ id?: string | number; subscriberUrl?: string }>;
    };
    const hooks = Array.isArray(listed.data) ? listed.data : [];
    const existing = hooks.find(
      (h) =>
        typeof h.subscriberUrl === "string" &&
        h.subscriberUrl.replace(/\/$/, "") === webhookUrl.replace(/\/$/, ""),
    );
    if (existing?.id != null) {
      const id = String(existing.id);
      db.run(
        `UPDATE users SET cal_managed_webhook_id = ?, updated_at = ? WHERE token = ?`,
        [id, new Date().toISOString(), userToken],
      );
      return id;
    }

    const created = (await calApiPost(accessToken, "/webhooks", {
      subscriberUrl: webhookUrl,
      secret,
      active: true,
      triggers: [
        "BOOKING_CREATED",
        "BOOKING_CANCELLED",
        "BOOKING_RESCHEDULED",
        "BOOKING_REQUESTED",
        "BOOKING_REJECTED",
      ],
    })) as { data?: { id?: string | number }; id?: string | number };

    const idRaw = created.data?.id ?? created.id;
    if (idRaw == null) return null;
    const id = String(idRaw);
    db.run(
      `UPDATE users SET cal_managed_webhook_id = ?, updated_at = ? WHERE token = ?`,
      [id, new Date().toISOString(), userToken],
    );
    return id;
  } catch (err) {
    console.warn(
      "Cal OAuth webhook ensure failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Handle /api/cal/oauth/* routes. Returns null if not an OAuth path.
 */
export async function handleCalOAuthRoutes(
  request: Request,
  url: URL,
  db: Database,
): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/api/cal/oauth")) return null;

  const headers = corsHeaders();
  const env = getOAuthEnv();

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // GET /api/cal/oauth/status
  if (path === "/api/cal/oauth/status" && request.method === "GET") {
    const token = getNotaryToken(request, url);
    const user = validateToken(db, token);
    if (!user) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const row = db
      .query(
        `SELECT cal_oauth_access_token_enc, cal_oauth_expires_at, cal_oauth_scope,
                cal_oauth_connected_at, cal_username, cal_booking_url, cal_user_id,
                cal_managed_webhook_id, slug, display_name
         FROM users WHERE token = ?`,
      )
      .get(token) as {
      cal_oauth_access_token_enc: string | null;
      cal_oauth_expires_at: string | null;
      cal_oauth_scope: string | null;
      cal_oauth_connected_at: string | null;
      cal_username: string | null;
      cal_booking_url: string | null;
      cal_user_id: string | null;
      cal_managed_webhook_id: string | null;
      slug: string | null;
      display_name: string | null;
    } | null;

    return json(
      {
        oauthConfigured: env.configured || !!(env.clientId && env.clientSecret),
        connected: !!row?.cal_oauth_access_token_enc,
        username: row?.cal_username || null,
        calUserId: row?.cal_user_id || null,
        calBookingUrl: row?.cal_booking_url || null,
        slug: row?.slug || null,
        displayName: row?.display_name || null,
        scope: row?.cal_oauth_scope || null,
        connectedAt: row?.cal_oauth_connected_at || null,
        expiresAt: row?.cal_oauth_expires_at || null,
        managedWebhookId: row?.cal_managed_webhook_id || null,
        redirectUri: env.redirectUri,
      },
      { headers },
    );
  }

  // GET /api/cal/oauth/binding — ciphertext + profile for journal backup (same host restore)
  if (path === "/api/cal/oauth/binding" && request.method === "GET") {
    const token = getNotaryToken(request, url);
    const user = validateToken(db, token);
    if (!user) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const row = db
      .query(
        `SELECT cal_oauth_access_token_enc, cal_oauth_refresh_token_enc,
                cal_oauth_expires_at, cal_oauth_scope, cal_oauth_connected_at,
                cal_username, cal_booking_url, cal_user_id, cal_event_slug,
                cal_default_event_type_id, cal_managed_webhook_id, slug, display_name
         FROM users WHERE token = ?`,
      )
      .get(token) as {
      cal_oauth_access_token_enc: string | null;
      cal_oauth_refresh_token_enc: string | null;
      cal_oauth_expires_at: string | null;
      cal_oauth_scope: string | null;
      cal_oauth_connected_at: string | null;
      cal_username: string | null;
      cal_booking_url: string | null;
      cal_user_id: string | null;
      cal_event_slug: string | null;
      cal_default_event_type_id: number | null;
      cal_managed_webhook_id: string | null;
      slug: string | null;
      display_name: string | null;
    } | null;

    if (!row?.cal_oauth_access_token_enc) {
      return json({ binding: null }, { headers });
    }

    return json(
      {
        binding: {
          v: 1,
          // Ciphertext only — encrypted with this host's CAL_TOKEN_ENCRYPTION_KEY
          accessTokenEnc: row.cal_oauth_access_token_enc,
          refreshTokenEnc: row.cal_oauth_refresh_token_enc,
          expiresAt: row.cal_oauth_expires_at,
          scope: row.cal_oauth_scope,
          connectedAt: row.cal_oauth_connected_at,
          calUsername: row.cal_username,
          calBookingUrl: row.cal_booking_url,
          calUserId: row.cal_user_id,
          calEventSlug: row.cal_event_slug,
          calDefaultEventTypeId: row.cal_default_event_type_id,
          managedWebhookId: row.cal_managed_webhook_id,
          slug: row.slug,
          displayName: row.display_name,
        },
      },
      { headers },
    );
  }

  // POST /api/cal/oauth/binding — restore ciphertext binding onto current account token
  if (path === "/api/cal/oauth/binding" && request.method === "POST") {
    const token = getNotaryToken(request, url);
    const user = validateToken(db, token);
    if (!user) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }

    let body: {
      binding?: {
        v?: number;
        accessTokenEnc?: string;
        refreshTokenEnc?: string | null;
        expiresAt?: string | null;
        scope?: string | null;
        connectedAt?: string | null;
        calUsername?: string | null;
        calBookingUrl?: string | null;
        calUserId?: string | null;
        calEventSlug?: string | null;
        calDefaultEventTypeId?: number | null;
        managedWebhookId?: string | null;
        slug?: string | null;
        displayName?: string | null;
      } | null;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, { status: 400, headers });
    }

    const b = body.binding;
    if (!b || typeof b !== "object" || !b.accessTokenEnc) {
      return json({ error: "No OAuth binding in payload" }, { status: 400, headers });
    }

    // Validate ciphertext is decryptable with THIS host key before writing
    try {
      decryptToken(String(b.accessTokenEnc), env);
      if (b.refreshTokenEnc) decryptToken(String(b.refreshTokenEnc), env);
    } catch {
      return json(
        {
          error:
            "OAuth binding cannot be decrypted on this host (different encryption key or corrupt backup). Connect Cal.com again.",
        },
        { status: 400, headers },
      );
    }

    const username = b.calUsername
      ? String(b.calUsername).toLowerCase().trim()
      : null;
    const forcedSlug = b.slug
      ? String(b.slug).toLowerCase().trim()
      : username
        ? username
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 48)
        : null;

    // Reclaim username from other rows (same as live OAuth connect)
    if (forcedSlug && isValidSlug(forcedSlug)) {
      const others = db
        .query(
          `SELECT token FROM users
           WHERE token != ?
             AND (lower(slug) = ? OR lower(cal_username) = ?)`,
        )
        .all(token, forcedSlug, username || forcedSlug) as Array<{
        token: string;
      }>;
      for (const o of others) {
        db.run(
          `UPDATE users SET slug=NULL, cal_username=NULL, cal_booking_url=NULL,
            cal_event_slug=NULL, cal_default_event_type_id=NULL, updated_at=?
           WHERE token=?`,
          [new Date().toISOString(), o.token],
        );
      }
    }

    const now = new Date().toISOString();
    db.run(
      `UPDATE users SET
        cal_oauth_access_token_enc = ?,
        cal_oauth_refresh_token_enc = ?,
        cal_oauth_expires_at = ?,
        cal_oauth_scope = ?,
        cal_oauth_connected_at = ?,
        cal_username = ?,
        cal_booking_url = ?,
        cal_user_id = ?,
        cal_event_slug = ?,
        cal_default_event_type_id = ?,
        cal_managed_webhook_id = ?,
        slug = ?,
        display_name = COALESCE(NULLIF(display_name, ''), ?),
        updated_at = ?
       WHERE token = ?`,
      [
        String(b.accessTokenEnc),
        b.refreshTokenEnc ? String(b.refreshTokenEnc) : null,
        b.expiresAt || null,
        b.scope || null,
        b.connectedAt || now,
        username,
        b.calBookingUrl || (username ? `https://cal.com/${username}` : null),
        b.calUserId || null,
        b.calEventSlug || null,
        b.calDefaultEventTypeId ?? null,
        b.managedWebhookId || null,
        forcedSlug && isValidSlug(forcedSlug) ? forcedSlug : null,
        b.displayName || "Notary",
        now,
        token,
      ],
    );

    console.log(
      `OAuth binding restored user=${user.id.slice(0, 8)} cal=${username || "?"}`,
    );

    return json(
      {
        ok: true,
        connected: true,
        username,
        slug: forcedSlug,
      },
      { headers },
    );
  }

  // GET /api/cal/oauth/start
  if (path === "/api/cal/oauth/start" && request.method === "GET") {
    if (!env.clientId || !env.clientSecret) {
      return json(
        { error: "OAuth is not configured on this host" },
        { status: 503, headers },
      );
    }
    const token = getNotaryToken(request, url);
    const user = validateToken(db, token);
    if (!user) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }

    purgeExpiredStates(db);
    // Self-contained signed state (primary). Also mirror to DB for diagnostics.
    const state = createSignedState(token, env, 30 * 60 * 1000);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");
    try {
      db.run(
        `INSERT OR REPLACE INTO oauth_states (state, user_token, expires_at) VALUES (?, ?, ?)`,
        [state.slice(0, 200), token, expiresAt],
      );
    } catch (e) {
      console.warn("oauth_states insert failed (signed state still works):", e);
    }

    const authorizeUrl = new URL(CAL_AUTH_URL);
    authorizeUrl.searchParams.set("client_id", env.clientId);
    authorizeUrl.searchParams.set("redirect_uri", env.redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("scope", env.scopes);

    console.log(
      `OAuth start user=${user.id.slice(0, 8)} stateLen=${state.length} redirect=${env.redirectUri}`,
    );

    return json(
      {
        authorizeUrl: authorizeUrl.toString(),
        state,
        redirectUri: env.redirectUri,
        scopes: env.scopes,
      },
      { headers },
    );
  }

  // GET /api/cal/oauth/callback
  if (path === "/api/cal/oauth/callback" && request.method === "GET") {
    const err = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description");
    if (err) {
      console.warn(`OAuth callback error from Cal: ${err} ${errDesc || ""}`);
      return settingsRedirect(request, url, {
        cal: "oauth_error",
        error: err,
        ...(errDesc ? { error_description: errDesc } : {}),
      });
    }

    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    console.log(
      `OAuth callback hit code=${code ? "yes" : "no"} stateLen=${state.length} statePrefix=${state.slice(0, 24)}`,
    );

    if (!code || !state) {
      return settingsRedirect(request, url, {
        cal: "oauth_error",
        error: "missing_code_or_state",
      });
    }

    const resolved = resolveOAuthState(db, state, env);
    if (!resolved) {
      console.warn(
        `OAuth invalid_state stateLen=${state.length} hasDot=${state.includes(".")}`,
      );
      return settingsRedirect(request, url, {
        cal: "oauth_error",
        error: "invalid_state",
        error_description:
          "Login session expired or already used. Tap Connect Cal.com again.",
      });
    }

    // Double callback after success: code already spent → treat as OK if connected
    if (resolved.replay) {
      const row = db
        .query(
          `SELECT cal_oauth_access_token_enc, cal_username FROM users WHERE token = ?`,
        )
        .get(resolved.userToken) as {
        cal_oauth_access_token_enc: string | null;
        cal_username: string | null;
      } | null;
      if (row?.cal_oauth_access_token_enc) {
        console.log("OAuth replay after success — redirect connected");
        return settingsRedirect(request, url, {
          cal: "connected",
          ...(row.cal_username ? { username: row.cal_username } : {}),
        });
      }
    }

    if (!validateToken(db, resolved.userToken)) {
      return settingsRedirect(request, url, {
        cal: "oauth_error",
        error: "invalid_user",
        error_description: "Account token no longer valid. Open Settings and try again.",
      });
    }

    try {
      const tokens = await exchangeCode(env, code);
      storeTokens(db, resolved.userToken, env, tokens);

      let profile: {
        username: string | null;
        eventTypes: number;
        reclaimed: boolean;
      } = { username: null, eventTypes: 0, reclaimed: false };
      try {
        profile = await applyProfileAndBookingUrl(
          db,
          resolved.userToken,
          tokens.access_token,
        );
      } catch (profileErr) {
        console.error(
          "OAuth profile sync failed (tokens kept):",
          profileErr instanceof Error ? profileErr.message : profileErr,
        );
      }

      // Auto-register shared platform webhook when possible
      let webhookId: string | null = null;
      try {
        const origin = requestOrigin(request, url);
        const webhookUrl = `${origin}/api/cal/webhook`;
        const secret = await getPlatformWebhookSecret();
        if (secret) {
          webhookId = await ensureWebhook(
            db,
            resolved.userToken,
            tokens.access_token,
            webhookUrl,
            secret,
          );
        } else {
          console.warn("OAuth webhook skipped: no platform secret");
        }
      } catch (e) {
        console.warn("post-connect webhook skipped", e);
      }

      console.log(
        `OAuth connected source=${resolved.source} user=${profile.username || "?"} webhook=${webhookId || "none"} reclaimed=${profile.reclaimed}`,
      );

      return settingsRedirect(request, url, {
        cal: "connected",
        ...(profile.username ? { username: profile.username } : {}),
        ...(webhookId ? { webhook: "auto" } : { webhook: "pending" }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "oauth_failed";
      console.error("OAuth callback failed:", msg);
      // If code was already used but we already stored tokens, succeed
      const row = db
        .query(
          `SELECT cal_oauth_access_token_enc, cal_username FROM users WHERE token = ?`,
        )
        .get(resolved.userToken) as {
        cal_oauth_access_token_enc: string | null;
        cal_username: string | null;
      } | null;
      if (
        row?.cal_oauth_access_token_enc &&
        /invalid_grant|already|used/i.test(msg)
      ) {
        return settingsRedirect(request, url, {
          cal: "connected",
          ...(row.cal_username ? { username: row.cal_username } : {}),
        });
      }
      return settingsRedirect(request, url, {
        cal: "oauth_error",
        error: "exchange_failed",
        error_description: msg.slice(0, 200),
      });
    }
  }

  // POST /api/cal/oauth/disconnect
  if (path === "/api/cal/oauth/disconnect" && request.method === "POST") {
    const token = getNotaryToken(request, url);
    const user = validateToken(db, token);
    if (!user) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }

    // Best-effort delete managed webhook
    try {
      const access = await getValidAccessToken(db, token, env);
      const row = db
        .query(
          `SELECT cal_managed_webhook_id FROM users WHERE token = ?`,
        )
        .get(token) as { cal_managed_webhook_id: string | null } | null;
      if (access && row?.cal_managed_webhook_id) {
        await fetch(`${CAL_API}/webhooks/${row.cal_managed_webhook_id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${access}`,
            "cal-api-version": CAL_API_VERSION,
          },
        }).catch(() => null);
      }
    } catch {
      /* ignore */
    }

    db.run(
      `UPDATE users SET
        cal_oauth_access_token_enc = NULL,
        cal_oauth_refresh_token_enc = NULL,
        cal_oauth_expires_at = NULL,
        cal_oauth_scope = NULL,
        cal_oauth_connected_at = NULL,
        cal_managed_webhook_id = NULL,
        updated_at = ?
       WHERE token = ?`,
      [new Date().toISOString(), token],
    );

    return json({ ok: true, connected: false }, { headers });
  }

  // POST /api/cal/oauth/sync — pull profile again with stored token
  if (path === "/api/cal/oauth/sync" && request.method === "POST") {
    const token = getNotaryToken(request, url);
    const user = validateToken(db, token);
    if (!user) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const access = await getValidAccessToken(db, token, env);
    if (!access) {
      return json(
        { error: "Not connected or token expired — reconnect Cal" },
        { status: 401, headers },
      );
    }
    try {
      const profile = await applyProfileAndBookingUrl(db, token, access);
      return json({ ok: true, ...profile }, { headers });
    } catch (e) {
      return json(
        {
          error: e instanceof Error ? e.message : "Sync failed",
        },
        { status: 400, headers },
      );
    }
  }

  return json({ error: "Not found" }, { status: 404, headers });
}

/** Unit-test helper: roundtrip encrypt */
export function _testEncryptRoundtrip(sample: string, env?: OAuthEnv): boolean {
  const e = env || getOAuthEnv();
  const enc = encryptToken(sample, e);
  const dec = decryptToken(enc, e);
  return dec === sample && !enc.includes(sample);
}

export function _testStateTimingSafe(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
