# Cal Multi-Tenant — Full Cloudflare Free Tier Port Plan

**Status:** Planning only — **do not merge to `main` until CF-4 passes staging QA.**  
**Branch:** `feature/cal-multi-tenant` (GitHub — client + Zo server done; CF backend not ported)  
**Reference implementation:** `server/cal-routes.ts` (970 lines, working on Zo cal host)  
**Target:** `notary-log.iannazzi.workers.dev` (production) via D1 + Worker routes  

---

## Executive summary

| Question | Answer |
|----------|--------|
| Merge `feature/cal-multi-tenant` → `main` today = Cal works on CF? | **No** |
| What blocks it? | No `cloudflare/cal-handlers.ts`, D1 not created/wired, `isCalHostMode()` ignores `workers.dev`, production deploy script doesn't set `VITE_CAL_HOST_MODE=1`, `d1-schema.sql` **out of sync** with Zo schema |
| Effort (10 parallel agents) | **~2–3 days wall clock** to staging-ready; **~4–6 hours** merge + prod verify after you approve |
| OAuth | **Deferred** — not required for CF port |

---

## Architecture (target)

```
Browser PWA (IndexedDB journal — unchanged)
    ↓ same-origin fetch
Cloudflare Worker (cloudflare/worker.ts)
    ├── ASSETS — static build (VITE_CAL_HOST_MODE=1)
    ├── D1 CAL_DB — users + bookings (Cal multi-tenant)
    ├── KV INTAKE_KV — legacy form intake (optional, unchanged)
    └── Cal API routes (port of server/cal-routes.ts):
        GET  /api/health
        GET  /api/bootstrap
        GET  /api/cal/platform
        GET  /api/book/:slug
        POST /api/notary/register
        GET  /api/me
        GET  /api/me/cal
        PATCH /api/me/cal
        POST /api/cal/webhook          ← shared URL, routes by organizer.username
        POST /api/cal/webhook/:token   ← legacy, optional
        GET  /api/bookings
        GET  /api/bookings/:id
        POST /api/bookings/:id/dismiss
        POST /api/bookings/:id/journal-linked
        GET/POST/DELETE /api/intake*   ← existing KV routes, unchanged
```

Journal, ID scan, seal, multi-signer = **client-only** (already works on CF today).

---

## Cloudflare Free Tier vs Zo Computer

### What works the same on both

| Feature | Notes |
|---------|-------|
| Journal (IndexedDB) | Per-origin storage — CF URL = fresh journal unless backup import |
| ID scan, seal, complete | Client-side |
| Multi-signer signing appointment | Client-side |
| Cal embed `/book/{cal-username}` | Same iframe approach |
| Shared webhook URL + secret | Same routing by `organizer.username` |
| Slug forced = Cal username | Same business rules |
| 2–300 notaries isolation | Same token + Cal username model |

### Zo cal host advantages

| Capability | Zo | CF Free |
|------------|-----|---------|
| **Request limits** | None (VPS) | **100,000 Worker requests/day** — book pages + Settings + webhooks count |
| **CPU per request** | Unlimited | **10 ms CPU/invocation** — HMAC + JSON parse is fine; avoid heavy loops |
| **D1 writes** | Unlimited (SQLite) | **100,000 rows written/day** — ~1 write per booking webhook + account setup |
| **D1 reads** | Unlimited | **5,000,000 rows read/day** — plenty |
| **D1 storage** | Disk | **5 GB total account** / **500 MB per DB** on free |
| **D1 databases** | N/A | **Max 10 databases** on free (we need 1) |
| **Subrequests per invocation** | N/A | **50 on free** — our handlers use 1–3 D1 calls each, OK |
| **Rate limiting** | In-memory Map, single process | In-memory Map, **per-isolate** — imperfect but OK for pilot |
| **Webhook secret storage** | File fallback in `JOURNAL_DIR` | **Worker secret only** (`wrangler secret put`) |
| **File-based intake uploads** | SQLite + disk (`/api/intake`) | KV only — **1,000 KV writes/day free** — not suitable for heavy file intake |
| **Zo backup API** | `/api/backup` + server-side JSON snapshots | **Not available** — use in-app JSON export / Google Drive |
| **Persistent process** | Bun server, supervisor restart | Stateless Worker — cold starts possible |
| **Logs / debugging** | `supervisorctl`, local SQLite file | Cloudflare dashboard logs, D1 console |
| **Custom domain** | Zo reverse proxy | workers.dev free; custom domain on CF account |
| **Deploy safety** | Zo service isolated from CF | **`main` auto-deploys Worker** — merge = live |

### Free tier capacity estimate (300 notaries)

| Traffic | Daily estimate | Free limit | Verdict |
|---------|----------------|------------|---------|
| Book page views | ~500–2,000 | 100k requests | ✅ OK |
| Cal webhooks | ~50–200 bookings | 100k requests + 100k D1 writes | ✅ OK |
| Settings API | ~100–500 | included above | ✅ OK |
| Stored bookings (1 year) | ~50k rows × ~2KB | 500 MB DB | ✅ OK |
| Spike day (viral FB post) | Could hit 100k requests | Hard cap | ⚠️ Error 1027 until midnight UTC |

**Upgrade trigger:** sustained >100k requests/day or >100k D1 writes/day → Workers Paid ($5/mo) removes daily caps.

---

## Critical: D1 schema must match Zo (currently WRONG in repo)

`cloudflare/d1-schema.sql` is **out of date**. It must match `server/cal-routes.ts` `migrateCalSchema()` + `bookings` table.

### Required `cloudflare/d1-schema.sql` replacement

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  slug TEXT,
  cal_booking_url TEXT,
  cal_username TEXT,
  cal_event_slug TEXT,
  cal_webhook_secret TEXT,
  display_name TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_slug ON users(slug)
  WHERE slug IS NOT NULL AND slug != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cal_username ON users(cal_username)
  WHERE cal_username IS NOT NULL AND cal_username != '';

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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  UNIQUE(user_token, cal_uid),
  FOREIGN KEY (user_token) REFERENCES users(token)
);

CREATE INDEX IF NOT EXISTS idx_bookings_user_start ON bookings(user_token, start_time);
```

**Remove from old schema:** `fee`, `notes`, `dismiss INTEGER` — client expects `price_cents`, `dismissed_at`, `journal_linked_at`.

---

## Line-by-line file change manifest

### Wave CF-0 — Infrastructure (Orchestrator only, ~2–4 hours)

| # | File | Action | Exact change |
|---|------|--------|--------------|
| 0.1 | `cloudflare/d1-schema.sql` | **REPLACE** | Schema above (sync with Zo) |
| 0.2 | Terminal | **RUN** | `npx wrangler d1 create notary-log-cal` |
| 0.3 | `wrangler.cal.toml` L20 | **EDIT** | Set `database_id = "<output from 0.2>"` |
| 0.4 | Terminal | **RUN** | `npx wrangler d1 execute notary-log-cal --file=cloudflare/d1-schema.sql --remote -c wrangler.cal.toml` |
| 0.5 | Terminal | **RUN** | `npx wrangler secret put CAL_WEBHOOK_SECRET -c wrangler.cal.toml` → paste existing secret |
| 0.6 | `wrangler.cal.toml` | **VERIFY** | `INTAKE_KV` namespace id set (reuse prod or create staging KV) |

---

### Wave CF-1 — New Worker Cal backend (4 agents parallel, ~1–1.5 days)

#### Agent 1: `cloudflare/cal-handlers.ts` (NEW FILE, ~900 lines)

Port from `server/cal-routes.ts` with these **line-level substitutions**:

| Zo (`cal-routes.ts`) | CF Worker (`cal-handlers.ts`) |
|----------------------|-------------------------------|
| L7 `import type { Database } from "bun:sqlite"` | `import type { D1Database } from '@cloudflare/workers-types'` |
| L8–10 `node:crypto`, `node:path`, `node:fs` | **Remove** — use Web Crypto + env-only secrets |
| L30 `rateBuckets = new Map()` | Keep (per-isolate OK for pilot) OR stub always-allow |
| L44–51 `json()` helper | Reuse pattern from `worker.ts` `jsonResponse()` |
| L54–61 `corsHeaders()` | Add `"X-Notary-Token"` to `Access-Control-Allow-Headers` |
| L63–115 `migrateCalSchema()` | **Delete** — D1 schema applied via SQL file |
| L197–203 `validateToken()` | `env.CAL_DB.prepare('SELECT id, name, email FROM users WHERE token = ?').bind(token).first()` |
| L205–223 `verifyCalHmac()` | `crypto.subtle.importKey` + `sign` OR manual HMAC via `crypto.subtle` — **no Node Buffer** |
| L240–257 `getPlatformWebhookSecret()` | `return env.CAL_WEBHOOK_SECRET?.trim() || ''` — **no file fallback** |
| L285–294 `findUserTokenByCalUsername()` | D1 `.prepare(...).bind(uname, `%cal.com/${uname}%`, uname).first()` |
| L346–405 `upsertBookingFromPayload()` | D1 `.run()` with same column names as Zo |
| L440–969 `handleCalRoutes(request, url, db)` | `handleCalRoutes(request, url, env: CalEnv)` — same route table |
| L633–636 `db.run(UPDATE...)` | `await env.CAL_DB.prepare(...).bind(...).run()` |
| L877 `db.query(sql).all(...)` | `await env.CAL_DB.prepare(sql).bind(...).all()` then `.results` |
| L962–965 `INSERT users` | Add `created_at`: `new Date().toISOString()` |

**Export:** `handleCalRoutes(request, url, env): Promise<Response | null>`

**Shared pure functions** (copy verbatim, no changes):
- `RESERVED_SLUGS`, `isValidSlug`, `parseCalBookingUrl` (L124–183)
- `getNotaryToken`, `extractOrganizerUsername`, `extractAttendee`, `priceCents` (L185–438)
- `requestOrigin` (L226–237) — already handles `workers.dev`

#### Agent 2: `cloudflare/worker.ts` (EDIT)

| Line | Current | Change |
|------|---------|--------|
| L1–4 `Env` interface | `ASSETS`, `INTAKE_KV?` | Add `CAL_DB: D1Database`, `CAL_WEBHOOK_SECRET: string`, `CAL_ENABLED?: string` |
| L6–12 `corsHeaders()` | Missing `X-Notary-Token` | Add to `Allow-Headers` |
| L99–114 `fetch()` router | intake only | Add before ASSETS fallback: |

```typescript
import { handleCalRoutes } from "./cal-handlers";

// Inside fetch():
if (path === "/api/health") {
  return jsonResponse(200, {
    status: "ok",
    timestamp: new Date().toISOString(),
    intake: env.INTAKE_KV ? "kv" : "none",
    cal: env.CAL_DB != null,
    calHostMode: env.CAL_ENABLED === "1",
  });
}

if (path === "/api/bootstrap") {
  return jsonResponse(200, { intakeToken: null, calHostMode: env.CAL_ENABLED === "1" });
}

if (env.CAL_DB) {
  const calResponse = await handleCalRoutes(request, url, env);
  if (calResponse) return calResponse;
}
```

Keep existing `/api/intake*` handlers unchanged.

#### Agent 3: `cloudflare/cal-crypto.ts` (NEW FILE, ~40 lines)

Web Crypto HMAC-SHA256 for Cal webhook verification (replaces Node `createHmac`):

```typescript
export async function verifyCalHmac(rawBody: string, signature: string | null, secret: string): Promise<boolean>
export function timingSafeEqual(a: string, b: string): boolean
```

Used by Agent 1's `cal-handlers.ts`.

#### Agent 4: `cloudflare/cal-handlers.test.ts` (NEW FILE)

Port logic tests from `scripts/cal-routes.test.ts`:
- `parseCalBookingUrl` cases
- `isValidSlug`
- HMAC verify (Web Crypto)
- Mock D1 with in-memory stub OR use `@cloudflare/vitest-pool-workers`

---

### Wave CF-2 — Client + build flags (2 agents parallel, ~4–6 hours)

#### Agent 5: `artifacts/notary-journal/src/lib/cal-link.ts` L85–96

**Current:**
```typescript
export function isCalHostMode(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (host.includes('notary-log-cal')) return true;
  if ((host === 'localhost' || host === '127.0.0.1') && import.meta.env.VITE_CAL_HOST_MODE === '1') return true;
  return false;
}
```

**Change to:**
```typescript
export function isCalHostMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.VITE_CAL_HOST_MODE === '1') return true;
  const host = window.location.hostname;
  if (host.includes('notary-log-cal')) return true;
  return false;
}
```

This enables Cal UI on **any** host when built with `VITE_CAL_HOST_MODE=1` (including `*.workers.dev`).

#### Agent 6: Deploy scripts

| File | Change |
|------|--------|
| `scripts/cloudflare-deploy.mjs` L18–21 | After merge (CF-4): add `VITE_CAL_HOST_MODE: "1"` to build env **OR** create `scripts/cloudflare-deploy-production-cal.mjs` |
| `wrangler.toml` L8–12 | Uncomment D1 binding, set real `database_id` |
| `wrangler.toml` | Add `[vars] CAL_ENABLED = "1"` |
| `package.json` | Add `"test:cal-worker": "vitest run cloudflare/"` if using vitest-pool-workers |

**No client API URL changes needed** — `cal-api.ts` uses `apiPath()` same-origin; Worker serves API + static on one domain.

---

### Wave CF-3 — Verify + QA (3 agents parallel, ~4–6 hours)

#### Agent 7: `scripts/verify-cal-host.mjs`

| Line | Change |
|------|--------|
| L8–10 default BASE | Keep; accept CLI arg for staging/prod URL |
| L12–14 `CAL_DB` path | Skip SQLite wipe when target is Worker (no local DB) |
| Add | `--worker` flag: skip DB file operations, only HTTP checks |

#### Agent 8: Staging deploy + verify

```bash
cd /home/workspace/Projects/Notary-log
pnpm run deploy:cloudflare:cal:staging
bun scripts/verify-cal-host.mjs https://notary-log-cal-staging.<account>.workers.dev
```

**18 checks must pass:**
1. Health `cal:true`, `calHostMode:true`
2. Register user A + B
3. PATCH cal username A, B
4. Duplicate username → 409
5. GET `/api/book/{username}` both
6. Webhook A → only A bookings
7. Webhook B → only B bookings
8. Cross-contamination negative
9. BOOKING_REQUESTED → PENDING
10. Ping webhook → 200
11. Bad HMAC → 401
12. Settings bundle contains `cal-setup-panel` / `ensureNotaryAccount`

#### Agent 9: Browser QA checklist (manual or gstack browse)

| # | Test |
|---|------|
| 1 | `/book/test-user-a` — Cal iframe loads (not black) |
| 2 | Settings — auto token + Save Cal username |
| 3 | Real Cal booking → Bookings tab |
| 4 | Start journal entry prefill |
| 5 | iPhone Safari book page |

#### Agent 10: `docs/CAL-QA-EVIDENCE-CF.md` (NEW)

Record staging URL, verify output, two-account isolation proof, merge readiness sign-off.

---

### Wave CF-4 — Production merge (Orchestrator, after you approve, ~2–4 hours)

| # | Step |
|---|------|
| 4.1 | Uncomment D1 in `wrangler.toml`, set production `database_id` |
| 4.2 | `wrangler secret put CAL_WEBHOOK_SECRET` on production Worker |
| 4.3 | Update `scripts/cloudflare-deploy.mjs` to build with `VITE_CAL_HOST_MODE=1` |
| 4.4 | Merge `feature/cal-multi-tenant` → `main` |
| 4.5 | CF Workers Builds auto-deploys |
| 4.6 | `bun scripts/verify-cal-host.mjs https://notary-log.iannazzi.workers.dev` |
| 4.7 | Update Cal OAuth redirect URI (when OAuth Phase 1) |
| 4.8 | Notify notaries: webhook URL changes if migrating from Zo cal host |

**Webhook URL change on prod:**
```
https://notary-log.iannazzi.workers.dev/api/cal/webhook
```
Same shared secret (or rotate + update all Cal accounts).

---

## Routes NOT ported to CF (intentional)

| Zo route | CF status | Reason |
|----------|-----------|--------|
| `/api/backup` | ❌ Skip | Zo-specific server backup |
| `/api/intake` (SQLite + file upload) | ⚠️ KV only | Existing KV handler; heavy uploads hit KV write limits |
| `/api/intake-webhook` (Zo email) | ⚠️ KV only | Web3Forms-style; no Zo email API |
| Cal OAuth `/api/cal/oauth/*` | ❌ Phase OAuth | Pending Cal approval |
| Default notary user on boot | ❌ Skip | Cal host uses auto-register per device |

---

## Parallel agent assignment (10 agents)

```
Orchestrator (parent)
│
├── Wave CF-0 (serial, orchestrator)
│   └── D1 create, schema, secrets, wrangler.cal.toml
│
├── Wave CF-1 (4 parallel)
│   ├── AG-1: cloudflare/cal-handlers.ts (main port)
│   ├── AG-2: cloudflare/worker.ts wiring
│   ├── AG-3: cloudflare/cal-crypto.ts
│   └── AG-4: cloudflare/cal-handlers.test.ts
│
├── Wave CF-2 (2 parallel, after CF-1 merge)
│   ├── AG-5: cal-link.ts isCalHostMode fix
│   └── AG-6: wrangler.toml + deploy scripts
│
├── Wave CF-3 (3 parallel, after staging deploy)
│   ├── AG-7: verify-cal-host.mjs --worker mode
│   ├── AG-8: deploy staging + run 18 checks
│   └── AG-9: browser QA (book page, Settings, iframe)
│
└── Wave CF-4 (serial, user approval)
    └── AG-10: evidence doc + merge to main + prod verify
```

**Conflict rules:**
- Only orchestrator merges `cloudflare/worker.ts` and `cal-handlers.ts` imports
- AG-1 owns `cal-handlers.ts`; AG-2 only adds import + route calls
- Cursor reserved for HMAC/crypto review if AG-3 fails tests

---

## Test matrix (must pass before merge)

### Automated

| Suite | Command | Pass criteria |
|-------|---------|---------------|
| Cal helpers | `bun test scripts/cal-routes.test.ts` | 8/8 (unchanged) |
| Worker cal | `vitest cloudflare/cal-handlers.test.ts` | HMAC + parse + slug |
| Live verify | `bun scripts/verify-cal-host.mjs <staging-url>` | 18/18 |
| Client cal-link | existing vitest | 6/6 |

### Manual (once on staging)

- [ ] Real Cal booking → Bookings on phone
- [ ] Two notaries, no cross-bleed
- [ ] Cal iframe on Android + iPhone Safari
- [ ] Start journal entry prefill from booking
- [ ] Ping test in Cal webhook UI → 200

### NOT required on CF

- Full journal regression (ID scan, seal, multi-signer print) — same client, already QA'd on CF journal-only deploy
- OAuth Connect Cal — deferred
- Zo backup API

---

## Timeline (10 parallel agents via 9router Anti-Gravity)

| Phase | Wall clock | Agents | Deliverable |
|-------|------------|--------|-------------|
| CF-0 Infra | 2–4 hours | 1 (orchestrator) | Staging Worker URL live, empty D1 |
| CF-1 Port | 1–1.5 days | 4 AG + orchestrator merge | `cal-handlers.ts` + worker wired |
| CF-2 Client/build | 4–6 hours | 2 AG | `isCalHostMode` + deploy scripts |
| CF-3 QA | 4–6 hours | 3 AG | 18/18 verify + evidence doc |
| CF-4 Merge | 2–4 hours | 1 orchestrator | Production Worker Cal-ready |
| **Total to staging** | **~2–3 days** | up to 10 | Safe merge decision |
| **Total to production** | **+0.5 day** | after your "merge" | `notary-log.iannazzi.workers.dev` |

**Solo (no agents):** ~5–7 days same scope.

---

## Risk register

| Risk | Mitigation |
|------|------------|
| D1 schema drift | Fix `d1-schema.sql` first (CF-0.1) |
| `isCalHostMode()` false on workers.dev | `VITE_CAL_HOST_MODE=1` build flag (CF-2) |
| Web Crypto HMAC differs from Node | Unit test with known Cal test vectors |
| Rate limit Map per-isolate | Accept for pilot; upgrade to Durable Object if abuse |
| 100k requests/day cap | Monitor CF analytics; upgrade to Paid if FB viral |
| Merge to main before port done | **Do not merge** until CF-3 evidence doc signed off |
| Zo cal host vs CF prod different URLs | Notaries re-paste webhook URL when migrating |
| OAuth redirect only on Zo cal host today | Add CF redirect URI before OAuth Phase 1 |

---

## Resume phrases

```
go CF port Phase CF-0 per docs/CAL-CLOUDFLARE-FULL-PORT-PLAN.md
```

```
go CF port all per docs/CAL-CLOUDFLARE-FULL-PORT-PLAN.md
```

```
merge Cal to CF main per docs/CAL-CLOUDFLARE-FULL-PORT-PLAN.md — Phase CF-4
```

---

## Related docs

- `docs/CAL-CLOUDFLARE-WORKERS-PLAN.md` — short merge checklist
- `docs/CAL-QA-EVIDENCE.md` — Zo cal host verification (reference)
- `docs/CAL-OAUTH-IMPLEMENTATION-PLAN.md` — OAuth (deferred)
- `server/cal-routes.ts` — source of truth for port
- `feature/cal-multi-tenant` on GitHub — client + Zo server (safe push, no CF deploy)
