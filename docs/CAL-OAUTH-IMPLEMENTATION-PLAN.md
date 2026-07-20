# Cal.com OAuth Integration — Implementation Plan (Harder Path)

**Status:** Phase 0 **complete** (OAuth client registered 2026-07-19, **approved 2026-07-20**). Phase 1–2 **implemented on Zo cal host** (`notary-log-cal` :3003) — start/callback/status/disconnect + Connect button. Do **not** push to GitHub / public Worker until Joseph says so.  
**Prerequisite met (2026-07-19):** Cal embed multi-tenant MVP is live on `notary-log-cal` (:3003) — paste-link + shared webhook + slug=Cal username + auto token.

| OAuth registration | Value |
|--------------------|--------|
| Client ID | `fe8c4dd695969ae8f12c1e71c7b5910cce371e1b16b684447c4eedc63343f230` |
| Credentials file | `/root/.hermes/secrets/notary-log-cal-oauth.env` (agent-only, not committed) |
| Redirect URI | `https://notary-log-cal-sillyhippy.zocomputer.io/api/cal/oauth/callback` |
| Scopes | `PROFILE_READ EVENT_TYPE_READ BOOKING_READ WEBHOOK_READ WEBHOOK_WRITE` |
| Approval | **Approved** 2026-07-20 |  
**Resume phrase:**  
`Implement Cal OAuth per docs/CAL-OAUTH-IMPLEMENTATION-PLAN.md — Phase N Task T`

| Meta | Value |
|------|--------|
| Repo | `/home/workspace/Projects/Notary-log` |
| Branch | `feature/cal-oauth` (from cal-multi-tenant or main only after multi-tenant ships) |
| Depends on | Multi-tenant users + `/book/{slug}` + bookings table ideally already exist |
| Cal docs | [OAuth](https://cal.com/docs/api-reference/v2/oauth), [API v2 intro](https://cal.com/docs/api-reference/v2/introduction), [Webhooks](https://cal.com/docs/developing/guides/automation/webhooks) |
| Goal | “Connect Cal” one-click: auto-fill booking link, list event types, auto-register webhooks, pull bookings via API |

---

## Table of contents

1. [Honest difficulty](#1-honest-difficulty)
2. [Research: two Cal “OAuth” worlds](#2-research-two-cal-oauth-worlds)
3. [What OAuth buys vs paste-link](#3-what-oauth-buys-vs-paste-link)
4. [Product locked decisions](#4-product-locked-decisions)
5. [Prerequisites (Cal admin + env)](#5-prerequisites-cal-admin--env)
6. [Data model additions](#6-data-model-additions)
7. [OAuth flow (step-by-step protocol)](#7-oauth-flow-step-by-step-protocol)
8. [Scopes (minimum vs nice)](#8-scopes-minimum-vs-nice)
9. [API design (our server)](#9-api-design-our-server)
10. [Post-connect automation](#10-post-connect-automation)
11. [Phases 0–7](#phases-0-7)
12. [Security requirements](#12-security-requirements)
13. [Test matrix](#13-test-matrix)
14. [Effort, risks, kill criteria](#14-effort-risks-kill-criteria)
15. [Definition of done](#15-definition-of-done)
16. [Out of scope](#16-out-of-scope)

---

## 1. Honest difficulty

| Dimension | Rating | Why |
|-----------|--------|-----|
| Overall | **Hard (7/10)** | Real OAuth + token vault + refresh + Cal approval gate + multi-tenant isolation |
| vs paste-link multi-tenant | **+2–4 weeks** after embed MVP | Embed plan alone is ~1.5–3 weeks |
| Blocker outside your code | **Cal.com admin must approve** your OAuth client (pending until email accept/reject) |
| Platform managed users | **Do not use** | New Platform signups closed (as of 2025-12-15); managed-user APIs marked deprecated |
| Recommended order | Ship **embed + manual webhook** first; OAuth only if notaries choke on setup |

**Bottom line:** OAuth is the “pro onboarding” layer. It is **not** required for Cal-as-intake + multi-user separation. Skip if approval delays or scope is enough with Settings paste.

---

## 2. Research: two Cal “OAuth” worlds

### 2.1 Standard OAuth (“Continue with Cal.com”) — **use this**

- Create client: [https://app.cal.com/settings/developer/oauth](https://app.cal.com/settings/developer/oauth)  
- Client starts **pending** → Cal admin review → email accepted/rejected.  
- Up to **10 redirect URIs** per client.  
- Must select **at least one scope** at client creation.  
- Authorize:  
  `https://app.cal.com/auth/oauth2/authorize?client_id=...&redirect_uri=...&state=...&scope=BOOKING_READ%20EVENT_TYPE_READ%20...`  
- Token: `POST https://api.cal.com/v2/auth/oauth2/token` with `grant_type=authorization_code` + `client_id` + `client_secret` + `code` + `redirect_uri`.  
- Refresh: use documented refresh grant (same token endpoint family; implement against current docs at build time).  
- Optional UX: Cal **Onboarding** React component (iframe dialog: signup → calendar → consent) — still ends in auth code → your backend exchange.  
- Public clients: PKCE (`code_challenge` / `code_verifier`) — prefer **confidential server** exchange so `client_secret` never hits the browser.  
- API calls: `Authorization: Bearer <access_token>` (+ `cal-api-version` header where required by endpoint).  
- Rate limit (API key class): on order of **120 req/min** (confirm at implement time).

### 2.2 Platform OAuth + managed users — **avoid for new product**

- Headers `x-cal-client-id` / `x-cal-secret-key`; create managed users; tokens 60m / refresh 1y.  
- Docs: **Platform restructuring; no new Platform plan signups**; managed-user routes under **Deprecated**.  
- Atoms / white-label booker oriented at Platform.  
- **Kill path:** do not design Notary-log multi-tenant around managed users.

### 2.3 Still available without OAuth

- Embed, booking links, **user-configured webhooks**, Cal Stripe on event types.  
- Covered by `CAL-MULTI-TENANT-IMPLEMENTATION-PLAN.md`.

---

## 3. What OAuth buys vs paste-link

| Capability | Paste URL + manual webhook | OAuth |
|------------|----------------------------|--------|
| Public book embed | Yes | Yes (auto-detect `calLink`) |
| Fees / Stripe at book | Cal dashboard | Cal dashboard (unchanged) |
| Notary setup steps | Many (Cal account, event, copy link, webhook URL) | Fewer (“Connect Cal”) |
| List event types in app | No | Yes (`EVENT_TYPE_READ`) |
| Auto-create webhook to our URL | Manual in Cal UI | Yes (`WEBHOOK_WRITE`) |
| Pull bookings if webhook missed | No | Yes (`BOOKING_READ` poll/sync) |
| Create event type “Mobile Notary” template | No | Optional (`EVENT_TYPE_WRITE`) |
| Cal admin dependency | None | **Client approval required** |
| Token security burden | Low | **High** (encrypt at rest, refresh, revoke) |

---

## 4. Product locked decisions

| Topic | Decision |
|-------|----------|
| OAuth client type | **Confidential** — code exchange **only on server** |
| Token storage | Server SQLite (or secret store), **encrypted**; never `localStorage` access token |
| Multi-user | Each notary connects **their own** Cal user; tokens on **their** `users` row |
| Fallback | Always keep paste Cal username if OAuth disconnects or unapproved |
| Webhooks | API-created webhook pointing at **shared** `/api/cal/webhook` (routes by `organizer.username`; same as paste-link today) |
| Embed | Still embed/public book page — OAuth does not replace embed |
| Platform / Atoms | Out of scope |
| Branch | No OAuth secrets on public Worker env until Joseph approves |

---

## 5. Prerequisites (Cal admin + env)

### 5.1 Before writing feature code

1. Create OAuth client in Cal developer settings.  
2. Register redirect URIs, e.g.:  
   - `https://{zo-dev-host}/api/cal/oauth/callback`  
   - `http://localhost:5173/api/cal/oauth/callback` only if Cal allows (often HTTPS-only — use Zo dev for real tests)  
   - Later production host (max 10).  
3. Enable scopes (see §8).  
4. **Wait for Cal approval email.** Until approved, authorize URL shows “Client not approved.”  
5. Store `CAL_OAUTH_CLIENT_ID` + `CAL_OAUTH_CLIENT_SECRET` in **server env only** (Zo secrets / `.env` not committed).

### 5.2 Env vars

```bash
CAL_OAUTH_CLIENT_ID=
CAL_OAUTH_CLIENT_SECRET=
CAL_OAUTH_REDIRECT_URI=https://{host}/api/cal/oauth/callback
CAL_OAUTH_SCOPES=PROFILE_READ EVENT_TYPE_READ BOOKING_READ WEBHOOK_READ WEBHOOK_WRITE
# optional encryption key for tokens at rest
CAL_TOKEN_ENCRYPTION_KEY=  # 32-byte base64
```

---

## 6. Data model additions

Extend `users` (on top of multi-tenant Cal columns):

```sql
ALTER TABLE users ADD COLUMN cal_oauth_access_token_enc TEXT;
ALTER TABLE users ADD COLUMN cal_oauth_refresh_token_enc TEXT;
ALTER TABLE users ADD COLUMN cal_oauth_expires_at TEXT;       -- ISO
ALTER TABLE users ADD COLUMN cal_oauth_scope TEXT;
ALTER TABLE users ADD COLUMN cal_oauth_connected_at TEXT;
ALTER TABLE users ADD COLUMN cal_user_id TEXT;                -- from PROFILE /me
ALTER TABLE users ADD COLUMN cal_username TEXT;
ALTER TABLE users ADD COLUMN cal_default_event_type_id INTEGER;
ALTER TABLE users ADD COLUMN cal_managed_webhook_id TEXT;     -- id returned by Cal webhook API
```

**Never log** decrypted tokens. Redact in error reports.

Optional table `oauth_states`:

```sql
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_token TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);
```

---

## 7. OAuth flow (step-by-step protocol)

### 7.1 Connect (notary logged into Notary-log)

1. Notary opens Settings → **Connect Cal.com**.  
2. Frontend `GET /api/cal/oauth/start` (with notary token) → server:  
   - Generate `state` (32+ bytes random), store `{state, user_token, expires 10m}`.  
   - Return `{ authorizeUrl }`.  
3. Browser navigates to Cal authorize URL (full page or popup).  
4. User logs into Cal / consents scopes.  
5. Cal redirects: `REDIRECT_URI?code=...&state=...` (or `error=...`).  
6. Server `GET/POST /api/cal/oauth/callback`:  
   - Validate `state` exists and not expired; load `user_token`; delete state (one-time).  
   - `POST api.cal.com/v2/auth/oauth2/token` with code (server-side secret).  
   - Encrypt + store access + refresh + expiry on that user.  
   - Call `GET /v2/me` (PROFILE_READ) → save `cal_username`, `cal_user_id`.  
   - Call `GET` event types → pick default or let user choose.  
   - Set `cal_booking_url` from username + selected event slug.  
   - `WEBHOOK_WRITE`: create webhook subscriber  
     `https://{public-host}/api/cal/webhook` (platform shared URL)  
     with platform `CAL_WEBHOOK_SECRET`; store webhook id per user (idempotent: skip if URL already registered in their Cal account).  
   - Redirect browser to Settings `?cal=connected`.  

### 7.2 API use (ongoing)

1. Before Cal API call: if `expires_at` soon, refresh token; rotate stored tokens.  
2. On 401: try refresh once; else mark disconnected and surface UI.  
3. Optional cron: `BOOKING_READ` sync last N days into `bookings` table (backfill missed webhooks).

### 7.3 Disconnect

1. Delete webhook via API if `cal_managed_webhook_id` set.  
2. Null token columns.  
3. Keep `cal_booking_url` unless user clears it (embed still works).

### 7.4 Optional Onboarding component

Cal documents an onboarding iframe component that can signup + consent. Still:

- `onSuccess` gives **authorization code** → **must** hit **your** token exchange.  
- Do not put `client_secret` in the Vite bundle.  
- Use only if plain authorize link UX is too rough; not required for MVP OAuth.

---

## 8. Scopes (minimum vs nice)

### Minimum viable connect

| Scope | Why |
|-------|-----|
| `PROFILE_READ` | Username for embed link |
| `EVENT_TYPE_READ` | List events; build `cal.com/user/event` |
| `BOOKING_READ` | Sync / list bookings in app |
| `WEBHOOK_WRITE` | Auto-register webhook |
| `WEBHOOK_READ` | Idempotent check existing hooks |

### Nice later

| Scope | Why |
|-------|-----|
| `EVENT_TYPE_WRITE` | Create templated “Mobile Notarization” event |
| `BOOKING_WRITE` | Cancel/reschedule from app (support burden) |
| `SCHEDULE_READ` | Show availability summary (rarely needed if embed exists) |

**Do not** request org/team scopes unless product is multi-notary firms on Cal Teams.

---

## 9. API design (our server)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/cal/oauth/start` | Notary token | Create state → authorize URL |
| `GET` | `/api/cal/oauth/callback` | None (browser redirect) | Exchange code; bind to state.user_token |
| `POST` | `/api/cal/oauth/disconnect` | Notary token | Revoke local + delete webhook |
| `GET` | `/api/cal/oauth/status` | Notary token | `{ connected, username, eventTypesPreview, expiresAt }` |
| `GET` | `/api/cal/event-types` | Notary token | Proxy Cal list (refresh as needed) |
| `POST` | `/api/cal/default-event` | Notary token | `{ eventTypeId }` → update booking URL |
| `POST` | `/api/cal/sync-bookings` | Notary token | Pull recent bookings into DB |
| existing | `/api/cal/webhook` | HMAC | Shared platform webhook; routes by `organizer.username` |

**Proxy rule:** Browser never calls `api.cal.com` with user tokens; only our server does.

---

## 10. Post-connect automation

Ordered jobs after successful token store:

1. **Profile** → username.  
2. **Event types** → if exactly one, auto-select; else Settings dropdown.  
3. **Build** `cal_booking_url`.  
4. **Webhook ensure:** list webhooks; if our URL missing, create with secret; save id.  
5. **Optional sync** last 30 days bookings.  
6. **UI:** show Connect ✓ + book link + “Open Cal to set prices/Stripe.”

Fees/Stripe remain **documentation + Cal UI** — OAuth does not configure Stripe programmatically in this plan (unless Cal later exposes a simple payments API you choose to add).

---

## Phases 0–7

### Phase 0 — Gate & client registration

- [ ] **0.1** Confirm multi-tenant embed plan at least through Phase 2 (book page works)  
- [ ] **0.2** Register OAuth client + redirect URIs (dev + localhost policy)  
- [ ] **0.3** Submit for Cal approval; **block coding of callback until approved** (or code against mock)  
- [ ] **0.4** Generate `CAL_TOKEN_ENCRYPTION_KEY`; document rotation  
- [ ] **0.5** Branch `feature/cal-oauth`  

**Exit:** Approved client **or** explicit decision to implement against mock + wait.

### Phase 1 — Crypto + DB

- [ ] **1.1** Migrations for OAuth columns + `oauth_states`  
- [ ] **1.2** AES-GCM (or libsodium) encrypt/decrypt helpers  
- [ ] **1.3** Unit tests: encrypt roundtrip; state expiry  

**Exit:** Tokens can be stored without plaintext in DB browser dumps.

### Phase 2 — Start + callback + status

- [ ] **2.1** `oauth/start` + authorize URL builder (scopes from env)  
- [ ] **2.2** Callback exchange + state validation + CSRF  
- [ ] **2.3** Store tokens; `oauth/status`  
- [ ] **2.4** Settings button Connect / Connected / Disconnect shell  
- [ ] **2.5** Manual test with approved client on Zo HTTPS  

**Exit:** One notary can connect and see username.

### Phase 3 — Refresh + Cal API client

- [ ] **3.1** Shared `calFetch(user, path)` with auto-refresh  
- [ ] **3.2** Handle refresh failure → disconnected  
- [ ] **3.3** Tests with mocked Cal token endpoint  

**Exit:** Expired access token transparently refreshes in tests.

### Phase 4 — Event types + booking URL

- [ ] **4.1** List event types in Settings  
- [ ] **4.2** Select default → set `cal_booking_url` + embed works without paste  
- [ ] **4.3** Edge: zero event types → deep link “Create event in Cal”  

**Exit:** Connect → select event → `/book/{slug}` works with zero manual URL paste.

### Phase 5 — Auto webhook

- [ ] **5.1** Create webhook via API after connect  
- [ ] **5.2** Idempotent re-connect (don’t duplicate hooks)  
- [ ] **5.3** Disconnect deletes hook  
- [ ] **5.4** Confirm booking still lands in `bookings` table  

**Exit:** No manual Cal webhook UI required for happy path.

### Phase 6 — Booking sync backfill

- [ ] **6.1** `sync-bookings` endpoint + button  
- [ ] **6.2** Map Cal booking DTO → same `bookings` rows as webhooks  
- [ ] **6.3** Dedupe on `cal_uid`  

**Exit:** Disable webhook temporarily; sync still fills list.

### Phase 7 — Harden & ship gate

- [ ] **7.1** Two-user isolation: A’s token never used for B’s API  
- [ ] **7.2** Rate limit start/callback  
- [ ] **7.3** Secret scanning: no client_secret in client bundle (CI grep)  
- [ ] **7.4** Docs: Connect Cal runbook + fallback paste  
- [ ] **7.5** Joseph go for merge — still avoid public Worker until ready  

---

## 12. Security requirements

1. `client_secret` and refresh tokens **server-only**.  
2. Encrypt tokens at rest; key in env not DB.  
3. `state` single-use, short TTL, bound to `user_token`.  
4. Redirect URI exact match allowlist.  
5. Webhook path still token-scoped; OAuth does not create a global booking inbox.  
6. Audit log optional: connect/disconnect timestamps.  
7. HTTPS only for redirect and webhooks (Cal SaaS requirement).  
8. Do not put notary Cal tokens in journal backups JSON by default.

---

## 13. Test matrix

| # | Case | Expected |
|---|------|----------|
| 1 | Unapproved client | Clear error; no partial token store |
| 2 | State mismatch | 400; no exchange |
| 3 | Expired state | 400 |
| 4 | Happy connect | Tokens enc; username set |
| 5 | Refresh cycle | API works after forced expiry |
| 6 | Revoked refresh | UI disconnected; paste URL still works |
| 7 | User A connect / User B | Separate token rows |
| 8 | Auto webhook | CREATED booking → A’s list only |
| 9 | Disconnect | Webhook removed; embed URL retained optional |
| 10 | Bundle audit | No `CAL_OAUTH_CLIENT_SECRET` in built JS |
| 11 | Scope too narrow | Graceful missing-event-types message |
| 12 | BASE_PATH callback | Works under `/notary/` if used |

---

## 14. Effort, risks, kill criteria

### Effort

| Phase | Time |
|-------|------|
| 0 Approval wait | **Unknown (days–weeks)** external |
| 1–2 Core OAuth | 3–5 days |
| 3 Refresh client | 1–2 days |
| 4 Event types | 1–2 days |
| 5 Webhooks API | 2–3 days |
| 6 Sync | 1–2 days |
| 7 Harden | 1–2 days |
| **Total after approval** | **~2–4 weeks** |

### Risks

| Risk | Mitigation |
|------|------------|
| Cal rejects OAuth app | Stay on paste-link plan forever |
| Approval slow | Don’t block multi-tenant launch |
| Token theft from DB | Encryption + host hardening |
| Scope/API churn | Thin adapter module; pin `cal-api-version` |
| Over-scope BOOKING_WRITE | Don’t request until needed |
| Platform docs confusion | Ignore managed users |

### Kill criteria (stop OAuth project)

- Cal denies client and won’t reconsider.  
- Embed + manual webhook already &lt;5 min setup for Ken’s cohort.  
- You won’t store third-party OAuth tokens on Zo.  

---

## 15. Definition of done

- [ ] Approved OAuth client in production-capable redirect set  
- [ ] Connect / refresh / disconnect for multi-notary users  
- [ ] Auto booking URL + auto webhook  
- [ ] Bookings list works via webhook and optional sync  
- [ ] Tokens encrypted; secret not in frontend  
- [ ] Isolation tests green  
- [ ] Paste-link fallback remains  
- [ ] No silent `main` / public Worker deploy  

---

## 16. Out of scope

- Cal Platform managed users / Atoms white-label  
- Creating Cal accounts entirely inside Notary-log without Cal UI (onboarding component optional only)  
- Programming Cal Stripe fee amounts via API  
- Your own SaaS Stripe for notaries (separate product)  
- Replacing journal compliance with Cal  

---

## Comparison cheat sheet

| | Multi-tenant embed plan | This OAuth plan |
|--|-------------------------|-----------------|
| File | `CAL-MULTI-TENANT-IMPLEMENTATION-PLAN.md` | `CAL-OAUTH-IMPLEMENTATION-PLAN.md` |
| Client setup | Paste link + optional manual webhook | Connect button |
| Cal approval | No | **Yes** |
| Build time | ~1.5–3 weeks | +2–4 weeks after embed |
| Payments | Cal Stripe on event | Same |
| Recommendation | **Build first** | **Build second / maybe never** |

---

## Resume

```
Implement Cal OAuth per docs/CAL-OAUTH-IMPLEMENTATION-PLAN.md — Phase 0 Task 0.1
```

Only after:

```
Implement Cal multi-tenant per docs/CAL-MULTI-TENANT-IMPLEMENTATION-PLAN.md
```

is at least through public embed + isolation, **or** Joseph explicitly prioritizes OAuth alone (not recommended).
