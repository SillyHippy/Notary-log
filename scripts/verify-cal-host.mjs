#!/usr/bin/env bun
/**
 * End-to-end verification for notary-log-cal multi-tenant Cal host.
 * Usage: bun scripts/verify-cal-host.mjs [baseUrl]
 */
import { createHmac } from "node:crypto";

const BASE =
  process.argv[2]?.replace(/\/$/, "") ||
  "https://notary-log-cal-sillyhippy.zocomputer.io";

const WORKER_MODE =
  process.argv.includes("--worker") ||
  BASE.includes("workers.dev");

const CAL_DB =
  process.env.CAL_VERIFY_DB ||
  "/home/workspace/Projects/Notary-log/Documents/Notary Journal Cal/notary.db";

const fails = [];

function ok(label) {
  console.log(`  ✓ ${label}`);
}

function fail(label, detail) {
  console.log(`  ✗ ${label}: ${detail}`);
  fails.push(`${label}: ${detail}`);
}

async function register(name) {
  const res = await fetch(`${BASE}/api/notary/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email: `${name.replace(/\s+/g, "").toLowerCase()}@test.local` }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `register ${res.status}`);
  return data.token;
}

async function patchCal(token, calUsername) {
  const res = await fetch(`${BASE}/api/me/cal`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Notary-Token": token,
    },
    body: JSON.stringify({
      calBookingUrl: `https://cal.com/${calUsername}`,
      displayName: nameFor(calUsername),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `patchCal ${res.status}`);
  return data;
}

function nameFor(u) {
  return u === "joseph-joe-rf2msf" ? "Joseph Joe" : "Just Legal Solutions";
}

async function listBookings(token) {
  const res = await fetch(`${BASE}/api/bookings`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Notary-Token": token,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `bookings ${res.status}`);
  return data.bookings || [];
}

function signWebhook(body, secret) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function fireWebhook(secret, organizerUsername, uid, opts = {}) {
  const {
    status = "ACCEPTED",
    triggerEvent = "BOOKING_CREATED",
  } = opts;
  const payload = {
    triggerEvent,
    payload: {
      uid,
      title: `Verify ${organizerUsername}`,
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 90000000).toISOString(),
      organizer: { username: organizerUsername, name: organizerUsername },
      attendees: [{ name: "Test Client", email: "test@example.com" }],
      status,
    },
  };
  const body = JSON.stringify(payload);
  const sig = signWebhook(body, secret);
  const res = await fetch(`${BASE}/api/cal/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cal-signature-256": sig,
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log(`\nCal host verification: ${BASE}\n`);

// Clean slate for repeatable verify
try {
  if (WORKER_MODE) {
    const res = await fetch(`${BASE}/api/cal/verify-reset`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) ok("wiped users + bookings for clean verify (D1)");
    else fail("db wipe", JSON.stringify(data));
  } else {
    const { Database } = await import("bun:sqlite");
    const db = new Database(CAL_DB);
    db.run("DELETE FROM bookings");
    db.run("DELETE FROM users");
    db.close();
    ok("wiped users + bookings for clean verify");
  }
} catch (e) {
  fail("db wipe", e.message);
}

// 1. Health
{
  const res = await fetch(`${BASE}/api/health`);
  const data = await res.json();
  if (res.ok && data.cal && data.calHostMode) ok("health calHostMode");
  else fail("health", JSON.stringify(data));
}

// 2. Platform config (HTTPS webhook URL)
let platformSecret = null;
{
  const res = await fetch(`${BASE}/api/cal/platform`);
  const data = await res.json();
  platformSecret = data.webhookSecret;
  if (data.webhookUrl?.startsWith("https://") && data.webhookSecret) {
    ok(`platform webhook URL ${data.webhookUrl}`);
  } else {
    fail("platform config", JSON.stringify(data));
  }
}

// 3. Ping webhook
{
  const res = await fetch(`${BASE}/api/cal/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 200 && data.ping) ok("webhook ping 200");
  else fail("webhook ping", `${res.status} ${JSON.stringify(data)}`);
}

// 4. Two notary accounts
let tokenA, tokenB;
try {
  tokenA = await register("Verify User A");
  tokenB = await register("Verify User B");
  ok("registered two notary accounts");
} catch (e) {
  fail("register", e.message);
  process.exit(1);
}

// 5. Link Cal usernames (slug forced = username)
try {
  const a = await patchCal(tokenA, "joseph-joe-rf2msf");
  const b = await patchCal(tokenB, "justlegalsolutions");
  if (a.slug === "joseph-joe-rf2msf" && b.slug === "justlegalsolutions") {
    ok("slug forced to cal username");
  } else {
    fail("slug", `A=${a.slug} B=${b.slug}`);
  }
} catch (e) {
  fail("patchCal", e.message);
}

// 6. Duplicate cal username rejected
{
  const res = await fetch(`${BASE}/api/me/cal`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenB}`,
      "X-Notary-Token": tokenB,
    },
    body: JSON.stringify({ calBookingUrl: "https://cal.com/joseph-joe-rf2msf" }),
  });
  if (res.status === 409) ok("duplicate cal username rejected 409");
  else fail("duplicate cal username", `status ${res.status}`);
}

// 7. Public book pages
for (const slug of ["joseph-joe-rf2msf", "justlegalsolutions"]) {
  const res = await fetch(`${BASE}/api/book/${slug}`);
  if (res.ok) ok(`GET /api/book/${slug}`);
  else fail(`book/${slug}`, `${res.status}`);
}

// 8. Webhook routing isolation
if (platformSecret) {
  const uidA = `verify-a-${Date.now()}`;
  const uidB = `verify-b-${Date.now()}`;
  const rA = await fireWebhook(platformSecret, "joseph-joe-rf2msf", uidA);
  const rB = await fireWebhook(platformSecret, "justlegalsolutions", uidB);
  if (rA.status === 200 && rA.data.routedTo === "joseph-joe-rf2msf") {
    ok("webhook routed to joseph-joe-rf2msf");
  } else {
    fail("webhook A", `${rA.status} ${JSON.stringify(rA.data)}`);
  }
  if (rB.status === 200 && rB.data.routedTo === "justlegalsolutions") {
    ok("webhook routed to justlegalsolutions");
  } else {
    fail("webhook B", `${rB.status} ${JSON.stringify(rB.data)}`);
  }

  const bookingsA = await listBookings(tokenA);
  const bookingsB = await listBookings(tokenB);
  const aHas = bookingsA.some((b) => b.cal_uid === uidA);
  const bHas = bookingsB.some((b) => b.cal_uid === uidB);
  const aCross = bookingsA.some((b) => b.cal_uid === uidB);
  const bCross = bookingsB.some((b) => b.cal_uid === uidA);
  if (aHas && bHas && !aCross && !bCross) ok("bookings isolated per account");
  else {
    fail(
      "isolation",
      `A=${bookingsA.length} B=${bookingsB.length} cross=${aCross || bCross}`,
    );
  }

  // Pending (requires confirmation) booking status
  const uidPending = `verify-pending-${Date.now()}`;
  const rPending = await fireWebhook(platformSecret, "joseph-joe-rf2msf", uidPending, {
    status: "PENDING",
    triggerEvent: "BOOKING_REQUESTED",
  });
  if (rPending.status === 200) ok("pending booking webhook accepted");
  else fail("pending webhook", `${rPending.status} ${JSON.stringify(rPending.data)}`);
  const pendingRows = await listBookings(tokenA);
  const pendingRow = pendingRows.find((b) => b.cal_uid === uidPending);
  if (pendingRow && String(pendingRow.status).toUpperCase() === "PENDING") {
    ok("pending status stored on booking row");
  } else {
    fail("pending status", JSON.stringify(pendingRow));
  }
}

// 10. Token auth: patchCal immediately after register (simulates Settings save — no Unauthorized race)
{
  const me = await fetch(`${BASE}/api/me`, {
    headers: { Authorization: `Bearer ${tokenA}`, "X-Notary-Token": tokenA },
  });
  if (me.ok) ok("token A validates on /api/me after register");
  else fail("/api/me after register", `${me.status}`);
  // Re-save Cal link (idempotent) — must not 401
  try {
    await patchCal(tokenA, "joseph-joe-rf2msf");
    ok("patchCal re-save works (no Unauthorized race)");
  } catch (e) {
    fail("immediate patchCal", e.message);
  }
}

// 9. Frontend bundle has new setup UI
{
  const html = await (await fetch(`${BASE}/`)).text();
  const m = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (m) {
    const js = await (await fetch(`${BASE}${m[1]}`)).text();
    if (js.includes("Cal scheduling setup")) ok("deployed bundle has Cal scheduling setup");
    else fail("deployed bundle", "missing Cal scheduling setup string");
    const settingsMatch = js.match(/settings-[A-Za-z0-9_-]+\.js/);
    if (settingsMatch) {
      const settingsJs = await (await fetch(`${BASE}/assets/${settingsMatch[0]}`)).text();
      if (settingsJs.includes("Retry account setup")) ok("deployed bundle has token race fix UI");
      else fail("deployed bundle", "missing Retry account setup (stale build?)");
    } else {
      fail("deployed bundle", "could not find settings chunk in index bundle");
    }
    if (js.includes("Create my account")) fail("deployed bundle", "still has old Create my account UI");
    else ok("old Create my account UI removed from bundle");
  } else {
    fail("bundle", "no index js in html");
  }
}

console.log("");
if (fails.length) {
  console.log(`FAILED (${fails.length}):`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
console.log("");
console.log("Notary tokens (paste in Settings on each device):");
console.log(`  joseph-joe-rf2msf     → ${tokenA}`);
console.log(`  justlegalsolutions    → ${tokenB}`);
console.log("");
