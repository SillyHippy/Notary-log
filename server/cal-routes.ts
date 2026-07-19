/**
 * Cal.com multi-tenant booking APIs for Notary-log cal host.
 * Isolation: bookings scoped by user_token.
 * Shared webhook: POST /api/cal/webhook routes by unique Cal username
 * (Cal.com usernames are globally unique — no two people share cal.com/same-name).
 */
import type { Database } from "bun:sqlite";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export type ZoUser = { id: string; name: string; email: string };

const RESERVED_SLUGS = new Set([
  "api",
  "book",
  "intake",
  "settings",
  "admin",
  "entry",
  "journal",
  "requests",
  "bookings",
  "reports",
  "privacy",
  "terms",
  "assets",
]);

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now > b.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
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

export function migrateCalSchema(db: Database): void {
  const cols = db
    .query(`PRAGMA table_info(users)`)
    .all() as Array<{ name: string }>;
  const have = new Set(cols.map((c) => c.name));
  const add = (name: string, def: string) => {
    if (!have.has(name)) {
      db.run(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
    }
  };
  add("slug", "TEXT");
  add("cal_booking_url", "TEXT");
  add("cal_username", "TEXT");
  add("cal_event_slug", "TEXT");
  add("cal_webhook_secret", "TEXT");
  add("display_name", "TEXT");
  add("updated_at", "TEXT");

  db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_token TEXT NOT NULL,
      cal_uid TEXT NOT NULL,
      cal_booking_id INTEGER,
      status TEXT NOT NULL,
      title TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT,
      attendee_name TEXT,
      attendee_email TEXT,
      attendee_phone TEXT,
      location TEXT,
      price_cents INTEGER,
      currency TEXT,
      payload_json TEXT NOT NULL,
      journal_linked_at TEXT,
      dismissed_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      UNIQUE(user_token, cal_uid),
      FOREIGN KEY (user_token) REFERENCES users(token)
    )
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_bookings_user_start ON bookings(user_token, start_time)`,
  );
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_slug ON users(slug) WHERE slug IS NOT NULL AND slug != ''`,
  );
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cal_username ON users(cal_username) WHERE cal_username IS NOT NULL AND cal_username != ''`,
  );
}

export function isValidSlug(slug: string): boolean {
  if (!slug || slug.length < 2 || slug.length > 48) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  return true;
}

export function parseCalBookingUrl(input: string): {
  calLink: string;
  username?: string;
  eventSlug?: string;
  /** Canonical https://cal.com/... URL for storage / open-in-cal */
  bookingUrl: string;
} | null {
  const raw = input.trim();
  if (!raw) return null;

  // Bare username: your-cal-username
  if (/^[a-zA-Z0-9]([a-zA-Z0-9._+-]*[a-zA-Z0-9])?$/.test(raw) && !raw.includes("/")) {
    const username = raw.toLowerCase();
    return {
      calLink: username,
      username,
      bookingUrl: `https://cal.com/${username}`,
    };
  }

  // cal.com/user or cal.com/user/event (no scheme)
  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^\/+/, "");
    if (/^(www\.)?cal\.com\//i.test(candidate) || /^app\.cal\.com\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    } else if (/^[a-zA-Z0-9._+-]+(\/[a-zA-Z0-9._+-]+)?$/.test(candidate)) {
      // user or user/event
      candidate = `https://cal.com/${candidate}`;
    } else {
      return null;
    }
  }

  try {
    const u = new URL(candidate);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "cal.com" && host !== "app.cal.com") return null;
    // allow http → normalize to https
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 1) return null;
    const username = parts[0];
    if (parts.length === 1) {
      return {
        calLink: username,
        username,
        bookingUrl: `https://cal.com/${username}`,
      };
    }
    const eventSlug = parts[1];
    return {
      calLink: `${username}/${eventSlug}`,
      username,
      eventSlug,
      bookingUrl: `https://cal.com/${username}/${eventSlug}`,
    };
  } catch {
    return null;
  }
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

function verifyCalHmac(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!secret) {
    return process.env.CAL_WEBHOOK_ALLOW_INSECURE === "1";
  }
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim(), "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Prefer HTTPS behind Zo reverse proxy (x-forwarded-* often missing). */
export function requestOrigin(request: Request, url: URL): string {
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

/** One shared secret for all notaries (Cal usernames route the event). */
export async function getPlatformWebhookSecret(): Promise<string> {
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
  const generated = randomBytes(32).toString("hex");
  await Bun.write(filePath, `${generated}\n`);
  console.log(
    `Cal platform webhook secret created (all notaries use the same URL+secret): ${filePath}`,
  );
  return generated;
}

function extractOrganizerUsername(
  payload: Record<string, unknown>,
): string | null {
  const org = payload.organizer as Record<string, unknown> | undefined;
  if (org) {
    const u =
      org.username ||
      org.usernameInOrg ||
      (typeof org.email === "string" ? null : null);
    if (typeof org.username === "string" && org.username.trim()) {
      return org.username.trim().toLowerCase();
    }
    if (typeof org.usernameInOrg === "string" && org.usernameInOrg.trim()) {
      return org.usernameInOrg.trim().toLowerCase();
    }
  }
  // type field sometimes holds event slug only; bookerUrl not useful
  // metadata / userFields — skip
  return null;
}

function findUserTokenByCalUsername(
  db: Database,
  username: string,
): string | null {
  const uname = username.toLowerCase();
  const row = db
    .query(
      `SELECT token FROM users
       WHERE lower(cal_username) = ?
          OR lower(cal_booking_url) LIKE ?
          OR lower(slug) = ?
       LIMIT 1`,
    )
    .get(uname, `%cal.com/${uname}%`, uname) as { token: string } | null;
  return row?.token ?? null;
}

function upsertBookingFromPayload(
  db: Database,
  token: string,
  trigger: string,
  payload: Record<string, unknown>,
  rawBody: string,
): { id: string; created: boolean } | { error: string; status: number } {
  const calUid = String(payload.uid || "").trim();
  if (!calUid) {
    return { error: "Missing booking uid", status: 400 };
  }

  let status = String(payload.status || "ACCEPTED").toUpperCase();
  const triggerUpper = trigger.toUpperCase();
  if (triggerUpper.includes("REQUEST")) status = "PENDING";
  else if (triggerUpper.includes("CANCEL")) status = "CANCELLED";
  else if (triggerUpper.includes("REJECT")) status = "REJECTED";
  else if (triggerUpper.includes("RESCHEDULE")) status = "ACCEPTED";
  else if (triggerUpper.includes("PAID")) status = status || "ACCEPTED";
  // Cal sends requiresConfirmation on event types that need host approval
  if (
    payload.requiresConfirmation === true &&
    status !== "CANCELLED" &&
    status !== "REJECTED"
  ) {
    if (triggerUpper.includes("REQUEST") || status === "PENDING") {
      status = "PENDING";
    }
  }

  const { name, email, phone } = extractAttendee(payload);
  const startTime = String(
    payload.startTime || payload.start || new Date().toISOString(),
  );
  const endTime = payload.endTime ? String(payload.endTime) : null;
  const title = payload.title ? String(payload.title) : null;
  const location =
    typeof payload.location === "string"
      ? payload.location
      : payload.location
        ? JSON.stringify(payload.location)
        : null;
  const cents = priceCents(payload);
  const currency = payload.currency ? String(payload.currency) : null;
  const calBookingId =
    typeof payload.bookingId === "number" ? payload.bookingId : null;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const existing = db
    .query(
      `SELECT id FROM bookings WHERE user_token = ? AND cal_uid = ? LIMIT 1`,
    )
    .get(token, calUid) as { id: string } | null;

  if (existing) {
    db.run(
      `UPDATE bookings SET
        status = ?, title = ?, start_time = ?, end_time = ?,
        attendee_name = ?, attendee_email = ?, attendee_phone = ?,
        location = ?, price_cents = ?, currency = ?, cal_booking_id = ?,
        payload_json = ?, updated_at = ?
       WHERE id = ? AND user_token = ?`,
      [
        status,
        title,
        startTime,
        endTime,
        name,
        email,
        phone,
        location,
        cents,
        currency,
        calBookingId,
        rawBody,
        now,
        existing.id,
        token,
      ],
    );
    return { id: existing.id, created: false };
  }

  db.run(
    `INSERT INTO bookings (
      id, user_token, cal_uid, cal_booking_id, status, title,
      start_time, end_time, attendee_name, attendee_email, attendee_phone,
      location, price_cents, currency, payload_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      token,
      calUid,
      calBookingId,
      status,
      title,
      startTime,
      endTime,
      name,
      email,
      phone,
      location,
      cents,
      currency,
      rawBody,
      now,
    ],
  );
  return { id, created: true };
}

function extractAttendee(payload: Record<string, unknown>) {
  const attendees = payload.attendees as
    | Array<Record<string, unknown>>
    | undefined;
  const first = attendees?.[0] || {};
  const responses = (payload.responses || {}) as Record<
    string,
    { value?: unknown }
  >;
  const name =
    String(first.name || responses.name?.value || "").trim() || null;
  const email =
    String(first.email || responses.email?.value || "").trim() || null;
  const phone = first.phoneNumber
    ? String(first.phoneNumber)
    : responses.attendeePhoneNumber?.value
      ? String(responses.attendeePhoneNumber.value)
      : null;
  return { name, email, phone };
}

function priceCents(payload: Record<string, unknown>): number | null {
  const p = payload.price;
  if (typeof p === "number" && Number.isFinite(p)) {
    // Cal may send dollars or cents; if small integer treat as dollars*100 when < 1000 and has decimals... use dollars*100 if price looks like dollars
    if (Number.isInteger(p) && p >= 100) return p; // already cents-ish
    return Math.round(p * 100);
  }
  return null;
}

export async function handleCalRoutes(
  request: Request,
  url: URL,
  db: Database,
): Promise<Response | null> {
  const path = url.pathname;
  const headers = corsHeaders();

  if (request.method === "OPTIONS" && path.startsWith("/api/")) {
    if (
      path.startsWith("/api/book") ||
      path.startsWith("/api/cal") ||
      path.startsWith("/api/me") ||
      path.startsWith("/api/me/cal") ||
      path.startsWith("/api/bookings") ||
      path.startsWith("/api/notary/register")
    ) {
      return new Response(null, { status: 204, headers });
    }
  }

  // GET /api/cal/platform — shared webhook URL + secret (no auth)
  if (path === "/api/cal/platform" && request.method === "GET") {
    const origin = requestOrigin(request, url);
    const webhookPath = "/api/cal/webhook";
    const platformSecret = await getPlatformWebhookSecret();
    return json(
      {
        webhookPath,
        webhookUrl: `${origin}${webhookPath}`,
        webhookSecret: platformSecret || null,
        instructions:
          "Paste webhook URL + secret into each notary's own Cal account. Routing uses organizer.username.",
      },
      { headers },
    );
  }

  // GET /api/book/:slug
  const bookMatch = path.match(/^\/api\/book\/([^/]+)$/);
  if (bookMatch && request.method === "GET") {
    const slug = decodeURIComponent(bookMatch[1]).toLowerCase();
    if (!isValidSlug(slug)) {
      return json({ error: "Invalid slug" }, { status: 400, headers });
    }
    const row = db
      .query(
        `SELECT name, display_name, cal_booking_url, cal_username, cal_event_slug
         FROM users WHERE lower(slug) = ? LIMIT 1`,
      )
      .get(slug) as {
      name: string;
      display_name: string | null;
      cal_booking_url: string | null;
      cal_username: string | null;
      cal_event_slug: string | null;
    } | null;
    if (!row?.cal_booking_url) {
      return json({ error: "Not found" }, { status: 404, headers });
    }
    const parsed = parseCalBookingUrl(row.cal_booking_url);
    return json(
      {
        displayName: row.display_name || row.name,
        calBookingUrl: row.cal_booking_url,
        calLink:
          parsed?.calLink ||
          (row.cal_username && row.cal_event_slug
            ? `${row.cal_username}/${row.cal_event_slug}`
            : null),
        slug,
      },
      { headers },
    );
  }

  // GET /api/me — lightweight token check (no Cal config required)
  if (path === "/api/me" && request.method === "GET") {
    const token = getNotaryToken(request, url);
    const user = validateToken(db, token);
    if (!user) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    return json({ ok: true, name: user.name, email: user.email }, { headers });
  }

  // PATCH /api/me/cal
  if (path === "/api/me/cal" && request.method === "PATCH") {
    const token = getNotaryToken(request, url);
    const user = validateToken(db, token);
    if (!user) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    if (!rateLimit(`me-cal:${token}`, 30, 60_000)) {
      return json({ error: "Rate limit" }, { status: 429, headers });
    }
    let body: {
      slug?: string;
      calBookingUrl?: string;
      calWebhookSecret?: string;
      displayName?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, { status: 400, headers });
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    let parsedCal: ReturnType<typeof parseCalBookingUrl> = null;
    if (body.calBookingUrl !== undefined) {
      const urlStr = String(body.calBookingUrl || "").trim();
      if (urlStr === "") {
        updates.push("cal_booking_url = NULL");
        updates.push("cal_username = NULL");
        updates.push("cal_event_slug = NULL");
        // Clearing Cal also clears public book page
        updates.push("slug = NULL");
      } else {
        parsedCal = parseCalBookingUrl(urlStr);
        if (!parsedCal) {
          return json(
            {
              error:
                "Enter a Cal username (e.g. your-cal-username) or URL (https://cal.com/you or https://cal.com/you/event)",
            },
            { status: 400, headers },
          );
        }
        updates.push("cal_booking_url = ?");
        params.push(parsedCal.bookingUrl);
        updates.push("cal_username = ?");
        params.push(parsedCal.username || null);
        updates.push("cal_event_slug = ?");
        params.push(parsedCal.eventSlug || null);

        // FORCE slug = Cal username (globally unique on Cal — no collisions).
        const forcedSlug = (parsedCal.username || "")
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 48);
        if (forcedSlug && !isValidSlug(forcedSlug)) {
          return json(
            {
              error:
                "Your Cal username can't be used as a book page slug. Contact support.",
            },
            { status: 400, headers },
          );
        }
        if (forcedSlug) {
          const taken = db
            .query(
              `SELECT token FROM users WHERE lower(slug) = ? AND token != ? LIMIT 1`,
            )
            .get(forcedSlug, token) as { token: string } | null;
          if (taken) {
            return json(
              {
                error:
                  `Cal username "${parsedCal.username}" is already linked by another notary on this host.`,
              },
              { status: 409, headers },
            );
          }
          updates.push("slug = ?");
          params.push(forcedSlug);
        }
      }
    }

    if (body.calWebhookSecret !== undefined) {
      updates.push("cal_webhook_secret = ?");
      params.push(String(body.calWebhookSecret || "").trim() || null);
    }

    if (body.displayName !== undefined) {
      updates.push("display_name = ?");
      params.push(String(body.displayName || "").trim() || null);
    }

    if (updates.length === 0) {
      return json({ error: "No fields to update" }, { status: 400, headers });
    }

    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(token);

    db.run(
      `UPDATE users SET ${updates.join(", ")} WHERE token = ?`,
      params as never[],
    );

    const row = db
      .query(
        `SELECT slug, cal_booking_url, cal_webhook_secret, display_name, name, cal_username
         FROM users WHERE token = ?`,
      )
      .get(token) as {
      slug: string | null;
      cal_booking_url: string | null;
      cal_webhook_secret: string | null;
      display_name: string | null;
      name: string;
      cal_username: string | null;
    };

    return json(
      {
        ok: true,
        slug: row.slug,
        calBookingUrl: row.cal_booking_url,
        calUsername: row.cal_username,
        displayName: row.display_name || row.name,
        hasWebhookSecret: true,
        webhookPath: `/api/cal/webhook`,
        webhookUrlHint:
          "Same URL + secret for every notary. Cal routes by your unique Cal username.",
        platformWebhookSecret: await getPlatformWebhookSecret(),
      },
      { headers },
    );
  }

  // GET /api/me/cal
  if (path === "/api/me/cal" && request.method === "GET") {
    const token = getNotaryToken(request, url);
    const user = validateToken(db, token);
    if (!user) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const row = db
      .query(
        `SELECT slug, cal_booking_url, cal_webhook_secret, display_name, name, cal_username
         FROM users WHERE token = ?`,
      )
      .get(token) as {
      slug: string | null;
      cal_booking_url: string | null;
      cal_webhook_secret: string | null;
      display_name: string | null;
      name: string;
      cal_username: string | null;
    };
    const platformSecret = await getPlatformWebhookSecret();
    return json(
      {
        slug: row.slug,
        calBookingUrl: row.cal_booking_url,
        calUsername: row.cal_username,
        displayName: row.display_name || row.name,
        hasWebhookSecret: true,
        webhookPath: `/api/cal/webhook`,
        platformWebhookSecret: platformSecret,
        webhookInstructions:
          "In Cal → Settings → Developer → Webhooks: paste the shared URL and shared secret. Every notary uses the same pair. Bookings land only on the notary whose Cal username matches (Cal usernames are unique).",
      },
      { headers },
    );
  }

  // POST /api/cal/webhook — SHARED for all notaries; route by Cal organizer username
  if (path === "/api/cal/webhook" && request.method === "POST") {
    if (!rateLimit("wh:shared", 300, 60_000)) {
      return json({ error: "Rate limit" }, { status: 429, headers });
    }
    const rawBody = await request.text();
    if (rawBody.length > 512_000) {
      return json({ error: "Payload too large" }, { status: 413, headers });
    }
    let envelope: {
      triggerEvent?: string;
      payload?: Record<string, unknown>;
    };
    try {
      envelope = rawBody.trim()
        ? (JSON.parse(rawBody) as typeof envelope)
        : {};
    } catch {
      return json({ error: "Invalid JSON" }, { status: 400, headers });
    }
    const trigger = String(envelope.triggerEvent || "");
    const payload = (envelope.payload ||
      (typeof envelope === "object" && envelope !== null
        ? envelope
        : {})) as Record<string, unknown>;

    // Cal "Ping test" and other non-booking payloads — return 200 before signature gate
    const calUid = String(payload.uid || "").trim();
    const organizerUser = extractOrganizerUsername(payload);
    const isPingLike =
      !calUid ||
      trigger.toUpperCase().includes("PING") ||
      trigger === "" ||
      (!organizerUser && !payload.startTime && !payload.attendees);

    if (isPingLike && !calUid) {
      return json(
        {
          ok: true,
          ping: true,
          message:
            "Webhook reachable. Real bookings need organizer.username and will route by Cal username.",
        },
        { headers },
      );
    }

    const sig = request.headers.get("x-cal-signature-256");
    const platformSecret = await getPlatformWebhookSecret();
    if (!verifyCalHmac(rawBody, sig, platformSecret)) {
      return json({ error: "Invalid signature" }, { status: 401, headers });
    }

    if (!organizerUser) {
      return json(
        {
          error:
            "Missing organizer.username in payload — cannot route to a notary",
        },
        { status: 400, headers },
      );
    }
    const token = findUserTokenByCalUsername(db, organizerUser);
    if (!token) {
      console.warn(
        `[cal-webhook] No notary for organizer.username="${organizerUser}" — save that exact Cal username in Settings`,
      );
      return json(
        {
          error: `No notary linked to Cal username "${organizerUser}". In Notary-log Settings, paste that exact Cal username and Save.`,
          organizerUsername: organizerUser,
        },
        { status: 404, headers },
      );
    }
    const result = upsertBookingFromPayload(
      db,
      token,
      trigger,
      payload,
      rawBody,
    );
    if ("error" in result) {
      return json({ error: result.error }, { status: result.status, headers });
    }
    return json(
      {
        ok: true,
        id: result.id,
        created: result.created,
        routedTo: organizerUser,
      },
      { headers },
    );
  }

  // POST /api/cal/webhook/:token — legacy per-token URL (still works)
  const whMatch = path.match(/^\/api\/cal\/webhook\/([^/]+)$/);
  if (whMatch && request.method === "POST") {
    const token = decodeURIComponent(whMatch[1]);
    if (!rateLimit(`wh:${token}`, 120, 60_000)) {
      return json({ error: "Rate limit" }, { status: 429, headers });
    }
    const user = validateToken(db, token);
    if (!user) {
      return json({ error: "Not found" }, { status: 404, headers });
    }
    const row = db
      .query(`SELECT cal_webhook_secret FROM users WHERE token = ?`)
      .get(token) as { cal_webhook_secret: string | null };
    const rawBody = await request.text();
    if (rawBody.length > 512_000) {
      return json({ error: "Payload too large" }, { status: 413, headers });
    }
    const sig = request.headers.get("x-cal-signature-256");
    const platformSecret = await getPlatformWebhookSecret();
    const userSecret = row.cal_webhook_secret || "";
    const okSig =
      verifyCalHmac(rawBody, sig, platformSecret) ||
      (userSecret ? verifyCalHmac(rawBody, sig, userSecret) : false);
    if (!okSig) {
      return json({ error: "Invalid signature" }, { status: 401, headers });
    }
    let envelope: {
      triggerEvent?: string;
      payload?: Record<string, unknown>;
    };
    try {
      envelope = JSON.parse(rawBody) as typeof envelope;
    } catch {
      return json({ error: "Invalid JSON" }, { status: 400, headers });
    }
    const trigger = String(envelope.triggerEvent || "");
    const payload = (envelope.payload || envelope) as Record<string, unknown>;
    const result = upsertBookingFromPayload(
      db,
      token,
      trigger,
      payload,
      rawBody,
    );
    if ("error" in result) {
      return json({ error: result.error }, { status: result.status, headers });
    }
    return json(
      { ok: true, id: result.id, created: result.created },
      { headers },
    );
  }

  // GET /api/bookings
  if (path === "/api/bookings" && request.method === "GET") {
    const token = getNotaryToken(request, url);
    if (!validateToken(db, token)) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const status = url.searchParams.get("status");
    const includeDismissed = url.searchParams.get("dismissed") === "1";
    let sql = `SELECT id, cal_uid, status, title, start_time, end_time,
      attendee_name, attendee_email, attendee_phone, location,
      price_cents, currency, journal_linked_at, dismissed_at, created_at
      FROM bookings WHERE user_token = ?`;
    const params: unknown[] = [token];
    if (!includeDismissed) {
      sql += ` AND (dismissed_at IS NULL OR dismissed_at = '')`;
    }
    if (status) {
      sql += ` AND upper(status) = ?`;
      params.push(status.toUpperCase());
    }
    sql += ` ORDER BY start_time ASC LIMIT 200`;
    const rows = db.query(sql).all(...(params as never[]));
    return json({ bookings: rows }, { headers });
  }

  // GET /api/bookings/:id
  const bidMatch = path.match(/^\/api\/bookings\/([^/]+)$/);
  if (bidMatch && request.method === "GET") {
    const token = getNotaryToken(request, url);
    if (!validateToken(db, token)) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const id = decodeURIComponent(bidMatch[1]);
    const row = db
      .query(
        `SELECT id, cal_uid, status, title, start_time, end_time,
          attendee_name, attendee_email, attendee_phone, location,
          price_cents, currency, journal_linked_at, dismissed_at, created_at,
          payload_json
         FROM bookings WHERE id = ? AND user_token = ?`,
      )
      .get(id, token);
    if (!row) {
      return json({ error: "Not found" }, { status: 404, headers });
    }
    return json({ booking: row }, { headers });
  }

  // POST /api/bookings/:id/dismiss
  const dismissMatch = path.match(/^\/api\/bookings\/([^/]+)\/dismiss$/);
  if (dismissMatch && request.method === "POST") {
    const token = getNotaryToken(request, url);
    if (!validateToken(db, token)) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const id = decodeURIComponent(dismissMatch[1]);
    const r = db.run(
      `UPDATE bookings SET dismissed_at = ?, updated_at = ? WHERE id = ? AND user_token = ?`,
      [new Date().toISOString(), new Date().toISOString(), id, token],
    );
    if (r.changes === 0) {
      return json({ error: "Not found" }, { status: 404, headers });
    }
    return json({ ok: true }, { headers });
  }

  // POST /api/bookings/:id/journal-linked
  const jlMatch = path.match(/^\/api\/bookings\/([^/]+)\/journal-linked$/);
  if (jlMatch && request.method === "POST") {
    const token = getNotaryToken(request, url);
    if (!validateToken(db, token)) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const id = decodeURIComponent(jlMatch[1]);
    const r = db.run(
      `UPDATE bookings SET journal_linked_at = ?, updated_at = ? WHERE id = ? AND user_token = ?`,
      [new Date().toISOString(), new Date().toISOString(), id, token],
    );
    if (r.changes === 0) {
      return json({ error: "Not found" }, { status: 404, headers });
    }
    return json({ ok: true }, { headers });
  }

  // POST /api/notary/register — create extra notary user (rate limited)
  if (path === "/api/notary/register" && request.method === "POST") {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    if (!rateLimit(`reg:${ip}`, 5, 3_600_000)) {
      return json({ error: "Rate limit" }, { status: 429, headers });
    }
    let body: { name?: string; email?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      /* empty ok */
    }
    const token =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "");
    const id = crypto.randomUUID();
    const name = String(body.name || "Notary").trim().slice(0, 120) || "Notary";
    const email =
      String(body.email || "notary@localhost").trim().slice(0, 200) ||
      "notary@localhost";
    db.run(
      `INSERT INTO users (id, token, name, email) VALUES (?, ?, ?, ?)`,
      [id, token, name, email],
    );
    return json({ ok: true, token, id, name, email }, { headers });
  }

  return null;
}
