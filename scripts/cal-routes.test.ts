/**
 * Server-side isolation + HMAC tests for Cal routes (bun test).
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { createHmac } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  handleCalRoutes,
  isValidSlug,
  migrateCalSchema,
  parseCalBookingUrl,
} from "../server/cal-routes";

const TMP = join(import.meta.dir, "../.tmp-cal-test");
const DB_PATH = join(TMP, "t.db");

function makeDb() {
  mkdirSync(TMP, { recursive: true });
  const db = new Database(DB_PATH);
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  migrateCalSchema(db);
  return db;
}

describe("cal-routes helpers", () => {
  test("slug validation", () => {
    expect(isValidSlug("ok-slug")).toBe(true);
    expect(isValidSlug("api")).toBe(false);
    expect(isValidSlug("Bad")).toBe(false);
  });
  test("parse cal url", () => {
    expect(parseCalBookingUrl("https://cal.com/a/b")?.calLink).toBe("a/b");
    expect(parseCalBookingUrl("your-cal-username")?.bookingUrl).toBe(
      "https://cal.com/your-cal-username",
    );
    expect(parseCalBookingUrl("cal.com/joe")?.calLink).toBe("joe");
    expect(parseCalBookingUrl("https://evil.com/a/b")).toBeNull();
  });
});

describe("cal API isolation", () => {
  let db: Database;
  const tokenA =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const tokenB =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const secretA = "secret-a-xyz";

  beforeAll(() => {
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* */
    }
    db = makeDb();
    db.run(`INSERT INTO users (id, token, name, email) VALUES (?, ?, ?, ?)`, [
      "id-a",
      tokenA,
      "Notary A",
      "a@test.com",
    ]);
    db.run(`INSERT INTO users (id, token, name, email) VALUES (?, ?, ?, ?)`, [
      "id-b",
      tokenB,
      "Notary B",
      "b@test.com",
    ]);
  });

  afterAll(() => {
    db.close();
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  test("PATCH me/cal + public book", async () => {
    const req = new Request("http://localhost/api/me/cal", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Notary-Token": tokenA,
      },
      body: JSON.stringify({
        calBookingUrl: "https://cal.com/alice/mobile",
        displayName: "Alice Notary",
      }),
    });
    const res = await handleCalRoutes(req, new URL(req.url), db);
    expect(res?.status).toBe(200);
    const body = await res!.json();
    expect(body.slug).toBe("alice"); // slug forced to cal username

    const pub = await handleCalRoutes(
      new Request("http://localhost/api/book/alice"),
      new URL("http://localhost/api/book/alice"),
      db,
    );
    expect(pub?.status).toBe(200);
    const pb = await pub!.json();
    expect(pb.calLink).toBe("alice/mobile");
    expect(pb.displayName).toBe("Alice Notary");
    expect(JSON.stringify(pb)).not.toContain(tokenA);
  });

  test("slug conflict 409 when two users claim same cal username", async () => {
    const req = new Request("http://localhost/api/me/cal", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Notary-Token": tokenB,
      },
      body: JSON.stringify({
        calBookingUrl: "https://cal.com/alice/mobile",
      }),
    });
    const res = await handleCalRoutes(req, new URL(req.url), db);
    expect(res?.status).toBe(409);
  });

  test("webhook HMAC + isolation", async () => {
    const payload = {
      triggerEvent: "BOOKING_CREATED",
      createdAt: new Date().toISOString(),
      payload: {
        uid: "cal-uid-1",
        status: "ACCEPTED",
        title: "Mobile Notary",
        startTime: "2030-01-15T15:00:00.000Z",
        endTime: "2030-01-15T15:30:00.000Z",
        organizer: { username: "alice", name: "Alice" },
        attendees: [{ name: "Client One", email: "c@example.com" }],
        price: 75,
        currency: "usd",
      },
    };
    const raw = JSON.stringify(payload);
    // set alice cal username on token A
    db.run(`UPDATE users SET cal_username = ?, cal_booking_url = ? WHERE token = ?`, [
      "alice",
      "https://cal.com/alice",
      tokenA,
    ]);

    const { getPlatformWebhookSecret } = await import("../server/cal-routes");
    // use insecure for unit if needed - set secret via env
    process.env.CAL_WEBHOOK_SECRET = "platform-secret-test";
    const sig = createHmac("sha256", "platform-secret-test").update(raw).digest("hex");

    const bad = await handleCalRoutes(
      new Request(`http://localhost/api/cal/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cal-signature-256": "deadbeef",
        },
        body: raw,
      }),
      new URL(`http://localhost/api/cal/webhook`),
      db,
    );
    expect(bad?.status).toBe(401);

    const ok = await handleCalRoutes(
      new Request(`http://localhost/api/cal/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cal-signature-256": sig,
        },
        body: raw,
      }),
      new URL(`http://localhost/api/cal/webhook`),
      db,
    );
    expect(ok?.status).toBe(200);
    const okBody = await ok!.json();
    expect(okBody.routedTo).toBe("alice");

    const listA = await handleCalRoutes(
      new Request("http://localhost/api/bookings", {
        headers: { "X-Notary-Token": tokenA },
      }),
      new URL("http://localhost/api/bookings"),
      db,
    );
    const ja = await listA!.json();
    expect(ja.bookings.length).toBeGreaterThanOrEqual(1);

    const listB = await handleCalRoutes(
      new Request("http://localhost/api/bookings", {
        headers: { "X-Notary-Token": tokenB },
      }),
      new URL("http://localhost/api/bookings"),
      db,
    );
    const jb = await listB!.json();
    expect(jb.bookings.length).toBe(0);
  });

  test("BOOKING_REQUESTED maps to PENDING", async () => {
    db.run(`UPDATE users SET cal_username = ?, cal_booking_url = ?, slug = ? WHERE token = ?`, [
      "alice",
      "https://cal.com/alice",
      "alice",
      tokenA,
    ]);
    const payload = {
      triggerEvent: "BOOKING_REQUESTED",
      payload: {
        uid: "cal-uid-pending",
        status: "PENDING",
        title: "Needs approval",
        startTime: "2030-02-01T15:00:00.000Z",
        organizer: { username: "alice" },
        attendees: [{ name: "Pending Client", email: "p@example.com" }],
        requiresConfirmation: true,
      },
    };
    const raw = JSON.stringify(payload);
    process.env.CAL_WEBHOOK_SECRET = "platform-secret-test";
    const sig = createHmac("sha256", "platform-secret-test").update(raw).digest("hex");
    const res = await handleCalRoutes(
      new Request(`http://localhost/api/cal/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cal-signature-256": sig,
        },
        body: raw,
      }),
      new URL(`http://localhost/api/cal/webhook`),
      db,
    );
    expect(res?.status).toBe(200);
    const row = db
      .query(`SELECT status FROM bookings WHERE cal_uid = ?`)
      .get("cal-uid-pending") as { status: string };
    expect(row.status).toBe("PENDING");
  });

  test("two cal usernames route to separate notaries", async () => {
    db.run(`UPDATE users SET cal_username = ?, cal_booking_url = ?, slug = ? WHERE token = ?`, [
      "alice",
      "https://cal.com/alice",
      "alice",
      tokenA,
    ]);
    db.run(`UPDATE users SET cal_username = ?, cal_booking_url = ?, slug = ? WHERE token = ?`, [
      "bob",
      "https://cal.com/bob",
      "bob",
      tokenB,
    ]);

    process.env.CAL_WEBHOOK_SECRET = "platform-secret-test";

    const mkPayload = (username: string, uid: string) =>
      JSON.stringify({
        triggerEvent: "BOOKING_CREATED",
        payload: {
          uid,
          status: "ACCEPTED",
          title: `Booking for ${username}`,
          startTime: "2030-03-01T15:00:00.000Z",
          organizer: { username },
          attendees: [{ name: "Client", email: "c@example.com" }],
        },
      });

    const sigA = createHmac("sha256", "platform-secret-test")
      .update(mkPayload("alice", "uid-alice-only"))
      .digest("hex");
    const sigB = createHmac("sha256", "platform-secret-test")
      .update(mkPayload("bob", "uid-bob-only"))
      .digest("hex");

    const resA = await handleCalRoutes(
      new Request(`http://localhost/api/cal/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cal-signature-256": sigA,
        },
        body: mkPayload("alice", "uid-alice-only"),
      }),
      new URL(`http://localhost/api/cal/webhook`),
      db,
    );
    expect(resA?.status).toBe(200);

    const resB = await handleCalRoutes(
      new Request(`http://localhost/api/cal/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cal-signature-256": sigB,
        },
        body: mkPayload("bob", "uid-bob-only"),
      }),
      new URL(`http://localhost/api/cal/webhook`),
      db,
    );
    expect(resB?.status).toBe(200);

    const listA = await handleCalRoutes(
      new Request("http://localhost/api/bookings", {
        headers: { "X-Notary-Token": tokenA },
      }),
      new URL("http://localhost/api/bookings"),
      db,
    );
    const ja = await listA!.json();
    expect(ja.bookings.some((b: { cal_uid: string }) => b.cal_uid === "uid-alice-only")).toBe(true);
    expect(ja.bookings.some((b: { cal_uid: string }) => b.cal_uid === "uid-bob-only")).toBe(false);

    const listB = await handleCalRoutes(
      new Request("http://localhost/api/bookings", {
        headers: { "X-Notary-Token": tokenB },
      }),
      new URL("http://localhost/api/bookings"),
      db,
    );
    const jb = await listB!.json();
    expect(jb.bookings.some((b: { cal_uid: string }) => b.cal_uid === "uid-bob-only")).toBe(true);
    expect(jb.bookings.some((b: { cal_uid: string }) => b.cal_uid === "uid-alice-only")).toBe(false);
  });

  test("unknown token webhook 404", async () => {
    const res = await handleCalRoutes(
      new Request("http://localhost/api/cal/webhook/notarealtoken", {
        method: "POST",
        body: "{}",
      }),
      new URL("http://localhost/api/cal/webhook/notarealtoken"),
      db,
    );
    expect(res?.status).toBe(404);
  });
});
