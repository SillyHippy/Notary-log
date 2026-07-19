# Cal Multi-Tenant on Cloudflare Workers — Merge & Deploy Plan

**Status:** Branch `feature/cal-multi-tenant` contains Cal client + Zo server (`server/cal-routes.ts`).  
**Public Worker today:** static PWA + KV intake only — **no Cal backend**.  
**Goal:** When Joseph merges to `main`, enable Cal on `notary-log.iannazzi.workers.dev` via D1 + Worker routes.

---

## Safe to push feature branch?

| Action | Cloudflare auto-deploy? |
|--------|-------------------------|
| Push `feature/cal-multi-tenant` | **No** — Workers Builds watches **`main` only** |
| Merge to `main` | **Yes** — deploys Worker (see gates below) |

**Do not merge to `main` until D1 port is complete** unless you accept Cal Settings UI with non-working Bookings/webhooks on the public URL.

---

## Architecture on Cloudflare (target)

```
Client PWA (IndexedDB journal — unchanged)
    ↓ same-origin fetch
Cloudflare Worker
    ├── ASSETS — static build (VITE_CAL_HOST_MODE=1)
    ├── D1 CAL_DB — users + bookings (replaces Zo SQLite for Cal)
    ├── KV INTAKE_KV — legacy form intake (optional, unchanged)
    └── Routes (port from server/cal-routes.ts):
        GET  /api/book/:slug
        GET  /api/cal/platform
        POST /api/notary/register
        GET  /api/me
        PATCH /api/me/cal
        GET  /api/bookings
        POST /api/cal/webhook  (shared URL, routes by organizer.username)
        GET  /api/cal/oauth/*  (Phase 1+, after Cal approval)
```

Journal, ID scan, seal, multi-signer = **client-only** (already works on CF).

---

## Merge checklist (when ready to ship Cal on CF)

### Phase CF-0 — Staging Worker (no `main` merge)

1. Create D1 database:
   ```bash
   cd /home/workspace/Projects/Notary-log
   npx wrangler d1 create notary-log-cal
   ```
2. Copy `database_id` into `wrangler.cal.toml` (see repo file).
3. Apply schema:
   ```bash
   npx wrangler d1 execute notary-log-cal --file=cloudflare/d1-schema.sql --remote
   ```
4. Set Worker secrets (Cloudflare dashboard or CLI):
   ```bash
   npx wrangler secret put CAL_WEBHOOK_SECRET
   # After OAuth approval:
   npx wrangler secret put CAL_OAUTH_CLIENT_ID
   npx wrangler secret put CAL_OAUTH_CLIENT_SECRET
   npx wrangler secret put CAL_TOKEN_ENCRYPTION_KEY
   ```
5. Deploy **staging** Worker (does not touch production `main` auto-deploy):
   ```bash
   pnpm run deploy:cloudflare:cal:staging
   ```
6. Run isolation verify against staging URL (adapt `scripts/verify-cal-host.mjs` base URL).

### Phase CF-1 — Port cal-routes to Worker

Port `server/cal-routes.ts` handlers to `cloudflare/cal-handlers.ts` using D1 API:

| Zo (Bun SQLite) | Cloudflare D1 |
|-----------------|---------------|
| `db.query(...).get()` | `env.CAL_DB.prepare(...).bind(...).first()` |
| `db.run(...)` | `env.CAL_DB.prepare(...).bind(...).run()` |
| File-based webhook secret | `CAL_WEBHOOK_SECRET` env binding |
| `migrateCalSchema()` on boot | `d1-schema.sql` applied once |

**Exit:** Staging Worker passes same 18 checks as `verify-cal-host.mjs`.

### Phase CF-2 — Client build flag

Cal UI (Bookings nav, Cal setup panel) is gated by `isCalHostMode()`:

- Zo cal host: hostname contains `notary-log-cal`
- Cloudflare: build with `VITE_CAL_HOST_MODE=1` (see `pnpm run build:cal`)

Production CF deploy script: `scripts/cloudflare-deploy-cal.mjs` sets this flag.

### Phase CF-3 — OAuth redirect (optional, after Cal approval)

Add second redirect URI in Cal OAuth client:

```
https://notary-log.iannazzi.workers.dev/api/cal/oauth/callback
```

Store same secrets in Worker env. See `docs/CAL-OAUTH-IMPLEMENTATION-PLAN.md`.

### Phase CF-4 — Merge to `main`

Only after staging passes:

1. Merge `feature/cal-multi-tenant` → `main`
2. Cloudflare Workers Builds auto-deploys from `main`
3. Confirm production uses `wrangler.toml` with D1 binding enabled (not staging-only config)
4. Re-run verify script against `https://notary-log.iannazzi.workers.dev`
5. Update Cal webhook subscriber URL if switching from Zo cal host to Worker URL (or keep Zo for pilot)

---

## What merges today vs what still needs CF port

| In feature branch (ready on GitHub) | Needs CF port before public Cal works |
|-------------------------------------|---------------------------------------|
| Cal client UI (book page, bookings, settings) | Worker API routes |
| `server/cal-routes.ts` (Zo Bun server) | `cloudflare/cal-handlers.ts` |
| Tests + verify script | Point verify at Worker URL |
| D1 schema SQL | Execute on D1 |
| OAuth plan + registered client ID | OAuth callback on Worker |

**Zo cal host** (`notary-log-cal-sillyhippy.zocomputer.io`) continues to work independently — no GitHub deploy required.

---

## Environment variables (Worker)

| Secret / var | Purpose |
|--------------|---------|
| `CAL_WEBHOOK_SECRET` | HMAC verify for shared `/api/cal/webhook` |
| `CAL_OAUTH_CLIENT_ID` | Connect Cal (Phase 1+) |
| `CAL_OAUTH_CLIENT_SECRET` | Connect Cal (server-only) |
| `CAL_TOKEN_ENCRYPTION_KEY` | Encrypt OAuth tokens at rest |

Never commit secrets. OAuth credentials live in `/root/.hermes/secrets/notary-log-cal-oauth.env` on Zo agent only.

---

## Free tier limits (300 notaries)

| Resource | Free tier | Cal usage |
|----------|-----------|-----------|
| Workers requests | 100k/day | Book pages + webhooks + Settings — OK for pilot |
| D1 reads/writes | 5M / 100k per day | Plenty for bookings |
| D1 storage | 5 GB | Massive headroom |

---

## Resume phrases

```
Implement Cal CF port Phase CF-1 per docs/CAL-CLOUDFLARE-WORKERS-PLAN.md
```

```
Deploy Cal staging Worker per docs/CAL-CLOUDFLARE-WORKERS-PLAN.md — Phase CF-0
```

---

## Related docs

- `docs/CAL-MULTI-TENANT-IMPLEMENTATION-PLAN.md` — product design (Zo)
- `docs/CAL-OAUTH-IMPLEMENTATION-PLAN.md` — Connect Cal (pending approval)
- `docs/CAL-QA-EVIDENCE.md` — Zo cal host verification
- `cloudflare/d1-schema.sql` — D1 tables
- `wrangler.cal.toml` — staging config template
