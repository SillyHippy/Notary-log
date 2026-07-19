# Cal.com Multi-Tenant Host — Implementation Plan (No OAuth)

**Status:** Planning only — **do not implement until Joseph says go.**  
**Resume phrase:**  
`Implement Cal multi-tenant per docs/CAL-MULTI-TENANT-IMPLEMENTATION-PLAN.md — Phase N Task T`

| Meta | Value |
|------|--------|
| Repo | `/home/workspace/Projects/Notary-log` (GitHub `SillyHippy/Notary-log`) |
| Branch | `feature/cal-multi-tenant` only — **never push to `main` until explicit ship** |
| Public Worker | `notary-log.iannazzi.workers.dev` — **do not deploy this feature here until approved** |
| QA host | Zo dev / reverse-proxy only (e.g. `notary-log-dev`, `/notary/` path aware) |
| Companion plan | OAuth path: `docs/CAL-OAUTH-IMPLEMENTATION-PLAN.md` (harder; later) |
| Product intent | Host for many notaries; **Cal replaces public intake form**; fees/Stripe live in each notary’s Cal |

---

## Table of contents

1. [Product locked decisions](#1-product-locked-decisions)
2. [Research summary (Cal.com)](#2-research-summary-calcom)
3. [Baseline inventory](#3-baseline-inventory)
4. [Target architecture](#4-target-architecture)
5. [Data model](#5-data-model)
6. [API contract](#6-api-contract)
7. [Frontend change map](#7-frontend-change-map)
8. [What to remove / gut from old intake](#8-what-to-remove--gut-from-old-intake)
9. [Phases 0–6 (step-by-step)](#phases-0-6)
10. [Test matrix](#10-test-matrix)
11. [Effort & risk](#11-effort--risk)
12. [Definition of done](#12-definition-of-done)
13. [Out of scope](#13-out-of-scope)

---

## 1. Product locked decisions

| Topic | Decision |
|-------|----------|
| Public client surface | **Cal.com** (booking page or embed) — not custom multi-field intake form |
| Fees / deposits / Stripe | Configured **per notary inside Cal** (Cal Payments / Stripe app) — **no** Notary-log payment processor in this plan |
| Multi-user isolation | One shared app deploy; each notary = `users` row with unique `token` + `slug` + `cal_booking_url` |
| Journal | Stays **device IndexedDB** (PIN PWA); legal acts never live only in Cal |
| Bookings list in app | Optional server table fed by **Cal webhooks** (per-notary subscriber URL) |
| ID photos | **v1:** capture in journal at signing (Cal is weak at ID upload). **v1.5 optional:** tiny post-book upload page |
| Old intake form | Gut or feature-flag off on this branch; keep code path for single-tenant rollback if needed |
| Embed vs redirect | **v1:** `/book/{slug}` page = inline Cal embed + copy link. Notary can also share raw Cal URL |
| Auth for notary | Existing PIN + Settings token (extend with register later if needed) |
| License | Multi-tenant free hosting still subject to current LICENSE; commercial SaaS fees separate decision |
| Branch / deploy | Feature branch + local + Zo **dev** only until Joseph ships |

---

## 2. Research summary (Cal.com)

Sources: [Cal embed](https://cal.com/embed), [Webhooks guide](https://cal.com/docs/developing/guides/automation/webhooks), [API v2 intro](https://cal.com/docs/api-reference/v2/introduction).

### 2.1 Embed (no API key, free)

- Formats: **inline**, floating button, click pop-up, email embed.
- Notary creates event type in Cal → Embed Snippet Generator → link like `username/event-slug`.
- Prefill via query params (name, email, custom fields).
- Works on free Cal accounts; Stripe payments configured on the **event type** in Cal dashboard.
- React: `@calcom/embed-react` or script `https://app.cal.com/embed/embed.js`.

### 2.2 Webhooks (optional but recommended for in-app list)

- Cal UI: `/settings/developer/webhooks` (user-level) or per event type.
- Triggers needed: `BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`, optional `BOOKING_PAID`.
- **SaaS Cal.com:** subscriber URL must be **HTTPS**; localhost/private IPs **blocked**.
- Local dev: use tunnel (Cloudflare/ngrok) **or** skip webhooks until Zo HTTPS URL exists. Joseph forbids CF quick tunnels for some Zo deploys — prefer **Zo public HTTPS** for webhook tests.
- Verify: header `x-cal-signature-256` = HMAC-SHA256 of raw body with webhook secret.
- Payload (v2021-10-20 shape): `{ triggerEvent, createdAt, payload: { uid, startTime, endTime, attendees[], responses, organizer, price, currency, status, ... } }`.

### 2.3 What this plan does **not** use

- Cal **Platform** / managed users — **new Platform signups closed** (restructure as of 2025-12-15); endpoints deprecated for new builds.
- Cal **OAuth** “Continue with Cal.com” — see companion plan (admin review, token storage, scopes).
- Cal Atoms (white-label booker) — Platform-oriented; overkill for paste-link multi-tenant.

### 2.4 Per-notary Cal setup (ops, not code)

1. Free account at cal.com  
2. Connect Google/Outlook calendar  
3. Event type e.g. “Mobile Notarization” (duration, location, questions, optional payment)  
4. Copy booking link `https://cal.com/{user}/{event}`  
5. Paste into Notary-log Settings  
6. Optional: create webhook pointing to `https://{host}/api/cal/webhook/{token}` with secret  

---

## 3. Baseline inventory

| Piece | Today | Role in this plan |
|-------|--------|-------------------|
| `server.ts` SQLite `users` | `id, token, name, email, created_at` | **ALTER** add `slug`, `cal_booking_url`, `cal_webhook_secret`, display fields |
| `submissions` + `files` | Custom intake queue | Deprecate for Cal path; optional keep for ID stub |
| `/intake` `client-intake.tsx` | Public form | Replace with redirect to `/book/{slug}` or Cal-only page |
| `client-requests.tsx` | Accept/Deny intake | Evolve to **Bookings** list (from webhook) + Start journal |
| Settings | Zo token, Web3Forms | Add Cal URL, slug, webhook secret display, copy book link |
| Journal / fees engine | Strong | Unchanged; notarial fees ≠ Cal price |
| Multi-notary full form plan | `MULTI-NOTARY-INTAKE-PLATFORM-PLAN.md` | **Superseded for public client** by this plan; isolation patterns reusable |

---

## 4. Target architecture

```
Client
  → https://{host}/book/{slug}     # public, no PIN
       → resolve slug → cal_booking_url
       → inline Cal embed (or redirect to Cal)
       → (Cal handles schedule + optional Stripe)
       → optional success → thank-you | ID stub

Cal.com
  → webhook BOOKING_* → POST /api/cal/webhook/{token}
       → verify HMAC
       → upsert bookings row WHERE user_token = token

Notary PWA (PIN)
  → Settings: slug, cal_booking_url, copy links
  → Bookings: list upcoming (server, token-scoped)
  → Start journal entry (prefill name/email/time from booking)
  → IndexedDB journal (compliance source of truth)
```

**Isolation rules (non-negotiable):**

1. Webhook path includes **that user’s token** (or signed slug); never a shared inbox.  
2. All booking queries `WHERE user_token = ?`.  
3. Public `/book/{slug}` only exposes embed URL + display name — **never** other users’ tokens.  
4. No single shared Cal account for all notaries.  
5. Backup dirs (if used) remain per-token if multi-tenant backups stay.

---

## 5. Data model

### 5.1 `users` columns (idempotent ALTER)

```sql
ALTER TABLE users ADD COLUMN slug TEXT;              -- unique, URL-safe
ALTER TABLE users ADD COLUMN cal_booking_url TEXT;   -- full https://cal.com/...
ALTER TABLE users ADD COLUMN cal_username TEXT;      -- optional parse from URL
ALTER TABLE users ADD COLUMN cal_event_slug TEXT;    -- optional
ALTER TABLE users ADD COLUMN cal_webhook_secret TEXT;
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;
-- UNIQUE INDEX on slug WHERE slug IS NOT NULL
```

### 5.2 `bookings` table (new)

```sql
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,                 -- our uuid
  user_token TEXT NOT NULL,
  cal_uid TEXT NOT NULL,               -- Cal booking uid
  cal_booking_id INTEGER,
  status TEXT NOT NULL,                -- ACCEPTED | CANCELLED | ...
  title TEXT,
  start_time TEXT NOT NULL,            -- ISO
  end_time TEXT,
  attendee_name TEXT,
  attendee_email TEXT,
  attendee_phone TEXT,
  location TEXT,
  price_cents INTEGER,
  currency TEXT,
  payload_json TEXT NOT NULL,          -- full webhook payload for debug
  journal_linked_at TEXT,              -- set when Start entry used
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME,
  UNIQUE(user_token, cal_uid),
  FOREIGN KEY (user_token) REFERENCES users(token)
);
CREATE INDEX IF NOT EXISTS idx_bookings_user_start ON bookings(user_token, start_time);
```

### 5.3 Optional `id_uploads` (v1.5 only)

Skip in MVP. If added: token + cal_uid scoped file rows, short TTL.

---

## 6. API contract

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| `GET` | `/api/book/{slug}` | Public | `{ displayName, calBookingUrl, calLink }` or 404 |
| `GET` | `/book/{slug}` | Public | SPA route or server HTML shell that loads embed |
| `POST` | `/api/cal/webhook/:token` | HMAC secret | Upsert booking; 401 if bad sig; 404 if unknown token |
| `GET` | `/api/bookings` | Bearer or `X-Notary-Token` = user token | List bookings for token (query: `from`, `status`) |
| `GET` | `/api/bookings/:id` | Token must own row | Detail + payload subset |
| `POST` | `/api/bookings/:id/dismiss` | Token | Soft-hide optional |
| `PATCH` | `/api/me/cal` | Token | `{ slug?, calBookingUrl?, calWebhookSecret? }` validate URL |
| `POST` | `/api/notary/register` | Public rate-limited | Optional: create user + token (if multi-signup wanted) |

**Webhook handler pseudocode:**

1. Read raw body.  
2. `validateToken(token)` → 404.  
3. HMAC compare `x-cal-signature-256` with `users.cal_webhook_secret` (if set; if unset accept only in dev with flag).  
4. Parse `triggerEvent` + `payload`.  
5. Map CANCELLED → update status; CREATED/RESCHEDULED → upsert by `cal_uid`.  
6. Return 200 quickly.

**Slug rules:** `^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])?$`, reserved: `api`, `book`, `intake`, `settings`, `admin`.

**cal_booking_url validation:** must be `https://cal.com/...` or `https://app.cal.com/...` (allow self-hosted later via allowlist env).

---

## 7. Frontend change map

| File / area | Change |
|-------------|--------|
| `App.tsx` | Public routes: `/book/:slug`, deprecate `/intake` or redirect |
| New `pages/public-book.tsx` | Fetch slug config → Cal inline embed (`@calcom/embed-react` or script) |
| `pages/settings.tsx` | Cal section: URL, slug, webhook URL copy, secret, test checklist |
| New or repurpose `pages/bookings.tsx` | Upcoming / past from `/api/bookings`; Start entry |
| `intake-prefill.ts` | Reuse pattern: `bookingPrefill` from booking row → `/entry/new` |
| `lib/db.ts` (client settings) | Store token; optional cache of slug |
| Nav | “Bookings” instead of or beside “Client Requests” |
| `client-intake.tsx` | Feature-flag off or thin redirect to settings instructions |

### Embed implementation note

Prefer official embed:

```ts
// conceptual — exact API per @calcom/embed-react docs at implement time
<Cal calLink={parsedUserEvent} config={{ layout: "month_view" }} />
```

Parse `cal_booking_url` → `username/event` for `calLink`. Fallback: iframe to booking URL if parse fails.

---

## 8. What to remove / gut from old intake

**On this branch (after Bookings works):**

- Primary UX path through multi-field `client-intake` + Web3Forms as **the** client onboarding  
- Form builder / `form_config_json` work from multi-notary form plan (not needed if Cal questions suffice)

**Keep for now (dead code OK until stable):**

- `/api/intake` handlers (rollback)  
- Web3Forms settings (optional notify still useful)

**Do not delete on `main` until ship decision.**

---

## Phases 0–6

### Phase 0 — Prep & safety

- [ ] **0.1** Create branch `feature/cal-multi-tenant` from current known-good commit  
- [ ] **0.2** Confirm QA URL (Zo dev service) — not public Worker  
- [ ] **0.3** Create two free Cal.com test accounts + event types (no payment required for MVP tests)  
- [ ] **0.4** Document BASE_PATH (`/notary/`) impact on `/book/{slug}` and API paths via `app-path.ts`  
- [ ] **0.5** Write failing isolation test stubs (see Phase 5)  
- [ ] **0.6** Checkpoint note in `docs/CHECKPOINT-cal-*.md` if mid-flight  

**Exit:** Branch + two Cal links + host chosen.

### Phase 1 — Server: users + slug + public book API

- [ ] **1.1** Idempotent migrations for `users` columns + unique slug index  
- [ ] **1.2** `PATCH /api/me/cal` (token auth)  
- [ ] **1.3** `GET /api/book/{slug}` public  
- [ ] **1.4** Seed/update helper for local: script or SQL to set slug + cal URL on default user  
- [ ] **1.5** Unit tests: slug validation, URL allowlist, unknown slug 404, token cannot set taken slug  

**Exit:** curl proves public config and authenticated update; second user cannot read first user’s token via public API.

### Phase 2 — Public book page + embed

- [ ] **2.1** Route `/book/:slug` outside PIN  
- [ ] **2.2** Load embed; mobile layout; loading/404 states  
- [ ] **2.3** Settings UI: set slug + cal URL; show `https://{host}{base}/book/{slug}` + raw Cal URL copy buttons  
- [ ] **2.4** Manual QA: book a slot on phone Safari against Zo HTTPS  

**Exit:** Real booking appears in notary’s Cal calendar; embed usable on mobile.

### Phase 3 — Webhooks → bookings table

- [ ] **3.1** Create `bookings` table  
- [ ] **3.2** `POST /api/cal/webhook/:token` + HMAC verify  
- [ ] **3.3** Settings: show webhook URL + generate/store secret; instructions for Cal UI  
- [ ] **3.4** Map CREATED / RESCHEDULED / CANCELLED (+ optional PAID)  
- [ ] **3.5** Tests: valid sig upserts; bad sig 401; wrong token 404; cross-token cannot list  

**Exit:** Create booking in Cal → row appears for correct user only.

### Phase 4 — Bookings UI + journal prefill

- [ ] **4.1** Bookings page: upcoming sorted by `start_time`  
- [ ] **4.2** Detail drawer: attendee, time, location, price if any  
- [ ] **4.3** **Start journal entry** → prefill name, email, phone, notes, appointment time fields if model allows  
- [ ] **4.4** Mark `journal_linked_at` optional  
- [ ] **4.5** Empty states: “Paste Cal link in Settings” / “Add webhook to sync”  

**Exit:** Book → see in app → open new entry with correct name/time.

### Phase 5 — Multi-user isolation & harden

- [ ] **5.1** Register or manually create User A and User B  
- [ ] **5.2** Automated tests: webhook A never inserts under B; list A empty of B’s uids  
- [ ] **5.3** Public book A embed URL ≠ B  
- [ ] **5.4** Rate limit webhook + register endpoints  
- [ ] **5.5** Strip/hide primary Client Intake nav if flag `VITE_CAL_BOOKING_MODE=1`  
- [ ] **5.6** README section: “Multi-notary Cal hosting”  

**Exit:** Two-notary test pass on Zo dev.

### Phase 6 — Polish & ship gate (no main until OK)

- [ ] **6.1** Optional thank-you page after Cal (Cal redirect URL settings)  
- [ ] **6.2** Optional v1.5 ID stub — only if Joseph requests  
- [ ] **6.3** Full regression: journal, print, signing appointment, PIN, backup  
- [ ] **6.4** Ship checklist: license note, FB copy, Ken Worker **not** updated unless explicit  
- [ ] **6.5** Joseph explicit **go** to merge/tag/deploy  

---

## 10. Test matrix

| # | Case | Expected |
|---|------|----------|
| 1 | Unknown slug | 404 book page |
| 2 | Valid embed book | Event on that Cal account |
| 3 | Webhook no secret in prod | Reject or force secret (choose: **require secret** in prod) |
| 4 | Webhook bad HMAC | 401 |
| 5 | User A webhook with B’s booking payload but A’s URL | Row under A only (Cal won’t send B’s; still don’t trust body organizer blindly — trust path token) |
| 6 | List bookings without token | 401 |
| 7 | Start entry prefill | Name/email/time present |
| 8 | Cancel in Cal | Status cancelled in app |
| 9 | BASE_PATH `/notary/` | Links and embed still work |
| 10 | Mobile Safari embed | Can complete booking |
| 11 | Cal payment test mode (optional) | Booking still syncs; price_cents set if present |
| 12 | Journal offline | Unaffected |

---

## 11. Effort & risk

| Phase | Effort | Risk |
|-------|--------|------|
| 0 Prep | 0.5 day | Low |
| 1 Server slug/API | 1–2 days | Low–med |
| 2 Embed page | 1–2 days | Embed mobile quirks |
| 3 Webhooks | 2–3 days | HMAC, HTTPS-only, payload versions |
| 4 Bookings UI + prefill | 2–3 days | Field mapping |
| 5 Isolation | 1–2 days | Must not skip |
| 6 Polish | 1 day | Scope creep |

**Total MVP: ~1.5–3 weeks** focused (not including OAuth plan).

| Risk | Mitigation |
|------|------------|
| Webhook localhost blocked | Test on Zo HTTPS |
| Payload version drift | Store raw JSON; parse defensively |
| Notary misconfigures Cal | Settings checklist + link to Cal docs |
| ID not in Cal | Document “scan ID at appointment” |
| Main/Worker accident | Branch policy + no deploy scripts to Worker in CI |

---

## 12. Definition of done

- [ ] Two notaries on one host, separate slugs and Cal accounts  
- [ ] Public `/book/{slug}` embed works on mobile  
- [ ] Webhook sync for create/cancel/reschedule  
- [ ] Bookings list + Start journal prefill  
- [ ] Isolation tests green  
- [ ] Old intake not required for happy path  
- [ ] No `main` / public Worker deploy without Joseph  

---

## 13. Out of scope

- Cal OAuth / Platform managed users (see companion doc)  
- Building native availability engine  
- In-app Stripe/Helcim invoices  
- Mileage, full CRM kanban  
- Per-notary custom domains  
- Replacing device journal with server journal  

---

## Resume

```
Implement Cal multi-tenant per docs/CAL-MULTI-TENANT-IMPLEMENTATION-PLAN.md — Phase 0 Task 0.1
```
