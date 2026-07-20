/**
 * Cal.com multi-tenant booking APIs for Cloudflare Worker + D1.
 * Port of server/cal-routes.ts — same business rules as Zo cal host.
 */
import { verifyCalHmac } from "./cal-crypto";

export type CalEnv = {
  CAL_DB: D1Database;
  CAL_WEBHOOK_SECRET?: string;
  CAL_ENABLED?: string;
};

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
      ...corsHeaders(),
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
  bookingUrl: string;
} | null {
  const raw = input.trim();
  if (!raw) return null;

  if (/^[a-zA-Z0-9]([a-zA-Z0-9._+-]*[a-zA-Z0-9])?$/.test(raw) && !raw.includes("/")) {
    const username = raw.toLowerCase();
    return {
      calLink: username,
      username,
      bookingUrl: `https://cal.com/${username}`,
    };
  }

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^\/+/, "");
    if (/^(www\.)?cal\.com\//i.test(candidate) || /^app\.cal\.com\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    } else if (/^[a-zA-Z0-9._+-]+(\/[a-zA-Z0-9._+-]+)?$/.test(candidate)) {
      candidate = `https://cal.com/${candidate}`;
    } else {
      return null;
    }
  }

  try {
    const u = new URL(candidate);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "cal.com" && host !== "app.cal.com") return null;
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

async function validateToken(
  env: CalEnv,
  token: string,
): Promise<ZoUser | null> {
  if (!token) return null;
  const row = await env.CAL_DB.prepare(
    "SELECT id, name, email FROM users WHERE token = ?",
  )
    .bind(token)
    .first<ZoUser>();
  return row ?? null;
}

function getPlatformWebhookSecret(env: CalEnv): string {
  return env.CAL_WEBHOOK_SECRET?.trim() || "";
}

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

function extractOrganizerUsername(
  payload: Record<string, unknown>,
): string | null {
  const org = payload.organizer as Record<string, unknown> | undefined;
  if (org) {
    if (typeof org.username === "string" && org.username.trim()) {
      return org.username.trim().toLowerCase();
    }
    if (typeof org.usernameInOrg === "string" && org.usernameInOrg.trim()) {
      return org.usernameInOrg.trim().toLowerCase();
    }
  }
  return null;
}

async function findUserTokenByCalUsername(
  env: CalEnv,
  username: string,
): Promise<string | null> {
  const uname = username.toLowerCase();
  const row = await env.CAL_DB.prepare(
    `SELECT token FROM users
     WHERE lower(cal_username) = ?
        OR lower(cal_booking_url) LIKE ?
        OR lower(slug) = ?
     LIMIT 1`,
  )
    .bind(uname, `%cal.com/${uname}%`, uname)
    .first<{ token: string }>();
  return row?.token ?? null;
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
    if (Number.isInteger(p) && p >= 100) return p;
    return Math.round(p * 100);
  }
  return null;
}

async function upsertBookingFromPayload(
  env: CalEnv,
  token: string,
  trigger: string,
  payload: Record<string, unknown>,
  rawBody: string,
): Promise<{ id: string; created: boolean } | { error: string; status: number }> {
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

  const existing = await env.CAL_DB.prepare(
    `SELECT id FROM bookings WHERE user_token = ? AND cal_uid = ? LIMIT 1`,
  )
    .bind(token, calUid)
    .first<{ id: string }>();

  if (existing) {
    await env.CAL_DB.prepare(
      `UPDATE bookings SET
        status = ?, title = ?, start_time = ?, end_time = ?,
        attendee_name = ?, attendee_email = ?, attendee_phone = ?,
        location = ?, price_cents = ?, currency = ?, cal_booking_id = ?,
        payload_json = ?, updated_at = ?
       WHERE id = ? AND user_token = ?`,
    )
      .bind(
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
      )
      .run();
    return { id: existing.id, created: false };
  }

  await env.CAL_DB.prepare(
    `INSERT INTO bookings (
      id, user_token, cal_uid, cal_booking_id, status, title,
      start_time, end_time, attendee_name, attendee_email, attendee_phone,
      location, price_cents, currency, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
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
      now,
    )
    .run();
  return { id, created: true };
}

export async function handleCalRoutes(
  request: Request,
  url: URL,
  env: CalEnv,
): Promise<Response | null> {
  if (!env.CAL_DB) return null;

  const path = url.pathname;
  const headers = corsHeaders();

  if (request.method === "OPTIONS" && path.startsWith("/api/")) {
    if (
      path.startsWith("/api/book") ||
      path.startsWith("/api/cal") ||
      path.startsWith("/api/me") ||
      path.startsWith("/api/bookings") ||
      path.startsWith("/api/notary/register") ||
      path === "/api/health" ||
      path === "/api/bootstrap"
    ) {
      return new Response(null, { status: 204, headers });
    }
  }

  if (path === "/api/cal/platform" && request.method === "GET") {
    const origin = requestOrigin(request, url);
    const webhookPath = "/api/cal/webhook";
    const platformSecret = getPlatformWebhookSecret(env);
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

  const bookMatch = path.match(/^\/api\/book\/([^/]+)$/);
  if (bookMatch && request.method === "GET") {
    const slug = decodeURIComponent(bookMatch[1]).toLowerCase();
    if (!isValidSlug(slug)) {
      return json({ error: "Invalid slug" }, { status: 400, headers });
    }
    const row = await env.CAL_DB.prepare(
      `SELECT name, display_name, cal_booking_url, cal_username, cal_event_slug
       FROM users WHERE lower(slug) = ? LIMIT 1`,
    )
      .bind(slug)
      .first<{
        name: string;
        display_name: string | null;
        cal_booking_url: string | null;
        cal_username: string | null;
        cal_event_slug: string | null;
      }>();
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

  if (path === "/api/me" && request.method === "GET") {
    const token = getNotaryToken(request, url);
    const user = await validateToken(env, token);
    if (!user) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    return json({ ok: true, name: user.name, email: user.email }, { headers });
  }

  if (path === "/api/me/cal" && request.method === "PATCH") {
    const token = getNotaryToken(request, url);
    const user = await validateToken(env, token);
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
          const taken = await env.CAL_DB.prepare(
            `SELECT token FROM users WHERE lower(slug) = ? AND token != ? LIMIT 1`,
          )
            .bind(forcedSlug, token)
            .first<{ token: string }>();
          if (taken) {
            return json(
              {
                error: `Cal username "${parsedCal.username}" is already linked by another notary on this host.`,
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

    await env.CAL_DB.prepare(
      `UPDATE users SET ${updates.join(", ")} WHERE token = ?`,
    )
      .bind(...params)
      .run();

    const row = await env.CAL_DB.prepare(
      `SELECT slug, cal_booking_url, cal_webhook_secret, display_name, name, cal_username
       FROM users WHERE token = ?`,
    )
      .bind(token)
      .first<{
        slug: string | null;
        cal_booking_url: string | null;
        cal_webhook_secret: string | null;
        display_name: string | null;
        name: string;
        cal_username: string | null;
      }>();

    return json(
      {
        ok: true,
        slug: row?.slug,
        calBookingUrl: row?.cal_booking_url,
        calUsername: row?.cal_username,
        displayName: row?.display_name || row?.name,
        hasWebhookSecret: true,
        webhookPath: `/api/cal/webhook`,
        webhookUrlHint:
          "Same URL + secret for every notary. Cal routes by your unique Cal username.",
        platformWebhookSecret: getPlatformWebhookSecret(env),
      },
      { headers },
    );
  }

  if (path === "/api/me/cal" && request.method === "GET") {
    const token = getNotaryToken(request, url);
    const user = await validateToken(env, token);
    if (!user) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const row = await env.CAL_DB.prepare(
      `SELECT slug, cal_booking_url, cal_webhook_secret, display_name, name, cal_username
       FROM users WHERE token = ?`,
    )
      .bind(token)
      .first<{
        slug: string | null;
        cal_booking_url: string | null;
        cal_webhook_secret: string | null;
        display_name: string | null;
        name: string;
        cal_username: string | null;
      }>();
    const platformSecret = getPlatformWebhookSecret(env);
    return json(
      {
        slug: row?.slug,
        calBookingUrl: row?.cal_booking_url,
        calUsername: row?.cal_username,
        displayName: row?.display_name || row?.name,
        hasWebhookSecret: true,
        webhookPath: `/api/cal/webhook`,
        platformWebhookSecret: platformSecret,
        webhookInstructions:
          "In Cal → Settings → Developer → Webhooks: paste the shared URL and shared secret. Every notary uses the same pair. Bookings land only on the notary whose Cal username matches (Cal usernames are unique).",
      },
      { headers },
    );
  }

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
    const platformSecret = getPlatformWebhookSecret(env);
    const sigOk = await verifyCalHmac(rawBody, sig, platformSecret);
    if (!sigOk) {
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
    const userToken = await findUserTokenByCalUsername(env, organizerUser);
    if (!userToken) {
      return json(
        {
          error: `No notary linked to Cal username "${organizerUser}". In Notary-log Settings, paste that exact Cal username and Save.`,
          organizerUsername: organizerUser,
        },
        { status: 404, headers },
      );
    }
    const result = await upsertBookingFromPayload(
      env,
      userToken,
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

  const whMatch = path.match(/^\/api\/cal\/webhook\/([^/]+)$/);
  if (whMatch && request.method === "POST") {
    const token = decodeURIComponent(whMatch[1]);
    if (!rateLimit(`wh:${token}`, 120, 60_000)) {
      return json({ error: "Rate limit" }, { status: 429, headers });
    }
    const user = await validateToken(env, token);
    if (!user) {
      return json({ error: "Not found" }, { status: 404, headers });
    }
    const row = await env.CAL_DB.prepare(
      `SELECT cal_webhook_secret FROM users WHERE token = ?`,
    )
      .bind(token)
      .first<{ cal_webhook_secret: string | null }>();
    const rawBody = await request.text();
    if (rawBody.length > 512_000) {
      return json({ error: "Payload too large" }, { status: 413, headers });
    }
    const sig = request.headers.get("x-cal-signature-256");
    const platformSecret = getPlatformWebhookSecret(env);
    const userSecret = row?.cal_webhook_secret || "";
    const okSig =
      (await verifyCalHmac(rawBody, sig, platformSecret)) ||
      (userSecret
        ? await verifyCalHmac(rawBody, sig, userSecret)
        : false);
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
    const result = await upsertBookingFromPayload(
      env,
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

  if (path === "/api/bookings" && request.method === "GET") {
    const token = getNotaryToken(request, url);
    if (!(await validateToken(env, token))) {
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
    const { results: rows } = await env.CAL_DB.prepare(sql)
      .bind(...params)
      .all();
    return json({ bookings: rows || [] }, { headers });
  }

  const bidMatch = path.match(/^\/api\/bookings\/([^/]+)$/);
  if (bidMatch && request.method === "GET") {
    const token = getNotaryToken(request, url);
    if (!(await validateToken(env, token))) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const id = decodeURIComponent(bidMatch[1]);
    const row = await env.CAL_DB.prepare(
      `SELECT id, cal_uid, status, title, start_time, end_time,
        attendee_name, attendee_email, attendee_phone, location,
        price_cents, currency, journal_linked_at, dismissed_at, created_at,
        payload_json
       FROM bookings WHERE id = ? AND user_token = ?`,
    )
      .bind(id, token)
      .first();
    if (!row) {
      return json({ error: "Not found" }, { status: 404, headers });
    }
    return json({ booking: row }, { headers });
  }

  const dismissMatch = path.match(/^\/api\/bookings\/([^/]+)\/dismiss$/);
  if (dismissMatch && request.method === "POST") {
    const token = getNotaryToken(request, url);
    if (!(await validateToken(env, token))) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const id = decodeURIComponent(dismissMatch[1]);
    const r = await env.CAL_DB.prepare(
      `UPDATE bookings SET dismissed_at = ?, updated_at = ? WHERE id = ? AND user_token = ?`,
    )
      .bind(new Date().toISOString(), new Date().toISOString(), id, token)
      .run();
    if (!r.meta.changes) {
      return json({ error: "Not found" }, { status: 404, headers });
    }
    return json({ ok: true }, { headers });
  }

  const jlMatch = path.match(/^\/api\/bookings\/([^/]+)\/journal-linked$/);
  if (jlMatch && request.method === "POST") {
    const token = getNotaryToken(request, url);
    if (!(await validateToken(env, token))) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const id = decodeURIComponent(jlMatch[1]);
    const r = await env.CAL_DB.prepare(
      `UPDATE bookings SET journal_linked_at = ?, updated_at = ? WHERE id = ? AND user_token = ?`,
    )
      .bind(new Date().toISOString(), new Date().toISOString(), id, token)
      .run();
    if (!r.meta.changes) {
      return json({ error: "Not found" }, { status: 404, headers });
    }
    return json({ ok: true }, { headers });
  }

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
    const newToken =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "");
    const id = crypto.randomUUID();
    const name = String(body.name || "Notary").trim().slice(0, 120) || "Notary";
    const email =
      String(body.email || "notary@localhost").trim().slice(0, 200) ||
      "notary@localhost";
    const now = new Date().toISOString();
    await env.CAL_DB.prepare(
      `INSERT INTO users (id, token, name, email, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, newToken, name, email, now)
      .run();
    return json(
      { ok: true, token: newToken, id, name, email },
      { headers },
    );
  }

  return null;
}

export async function handleCalHealth(
  env: CalEnv,
): Promise<Response> {
  return json({
    status: "ok",
    timestamp: new Date().toISOString(),
    intake: "cloudflare-kv",
    cal: true,
    calHostMode: env.CAL_ENABLED === "1",
  });
}

export async function handleCalBootstrap(env: CalEnv): Promise<Response> {
  return json({
    intakeToken: null,
    calHostMode: env.CAL_ENABLED === "1",
  });
}

/** Wipe users + bookings for verify script (staging only). */
export async function handleCalVerifyReset(env: CalEnv): Promise<Response> {
  await env.CAL_DB.prepare("DELETE FROM bookings").run();
  await env.CAL_DB.prepare("DELETE FROM users").run();
  return json({ ok: true, wiped: true });
}
