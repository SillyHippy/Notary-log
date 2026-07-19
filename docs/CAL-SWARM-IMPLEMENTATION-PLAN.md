# Cal Multi-Tenant — Comprehensive Multi-Agent Swarm Plan

**Status:** Service registered. Implementation **awaiting Joseph “go” on swarm waves.**  
**No GitHub push** of feature work until explicit ship.  
**Resume:** `Execute CAL swarm Wave N per docs/CAL-SWARM-IMPLEMENTATION-PLAN.md`

| Meta | Value |
|------|--------|
| Product plan | `docs/CAL-MULTI-TENANT-IMPLEMENTATION-PLAN.md` |
| OAuth (later, not this swarm) | `docs/CAL-OAUTH-IMPLEMENTATION-PLAN.md` |
| Zo service | `docs/CAL-ZO-SERVICE.md` → **https://notary-log-cal-sillyhippy.zocomputer.io** |
| Port / data | **3003** / `Documents/Notary Journal Cal` |
| Git branch | **None for now** — work on current tree / cal host only (no Cloudflare/Worker deploy without push) |
| Prod | `notary-log` :3000 + proxy `/notary/` — **read-only / no deploys** |
| Ken | never touch test :3001 |
| Worker | `notary-log.iannazzi.workers.dev` — **no main push** |

---

## 0A. Provider / model routing (Joseph 2026-07-19)

**Primary stack = Google Anti-Gravity + Cursor. Not free OC pool. Command Code only as last resort.**

| Tier | Provider path | Accounts | Use for |
|------|---------------|----------|---------|
| **Primary bulk** | Hermes provider `antigravity` → **9router `:20129`** (`ag/*` models) | **~6 Google AG accounts, automatic round-robin** in 9router | Parallel implementation agents (UI, tests, most server slices) |
| **Heavy / merge / security** | Hermes provider `cursor-sdk` → **`:26420`** | **1 Cursor account** — serialize; do not parallel-spam | HMAC/webhook correctness, `server.ts` integration merge, hard bugs, final review |
| **Last resort only** | Command Code **Go** path (credits) | **3 accounts, ~$10 total** | Only if AG+Cursor blocked; **one job at a time**; stop if credits burn or agent loops |
| **Forbidden default** | `delegation.provider: free` / `oc/*-free` | — | Do **not** use as default for this project |
| **Orchestrator (this chat)** | Current session (e.g. grok / xai-oauth) | — | Wave control, verify, restart cal service, no push |

### Preferred models (adjust if 9router catalog shifts)

| Role | Model id | Why |
|------|----------|-----|
| AG general code | `ag/gemini-3-flash` or `ag/gemini-3-flash-agent` | Fast parallel slices; RR spreads 6 accounts |
| AG stronger | `ag/gemini-pro-agent` or `ag/gemini-3.1-pro-low` | Tricky API design if flash fails |
| Cursor primary | `cursor-composer-2.5` or `cursor-composer-2.5-fast` | Single-account coding workhorse |
| Cursor review | `cursor-sonnet-5` sparingly | Only if composer stuck — still 1 account |
| Command Code (rare) | Go account models only | Budget watchdog required |

### How swarm is launched (not default `delegate_task` free pool)

Default Hermes `delegation:` pins **`free` / `oc/deepseek-v4-flash-free`**. For this project orchestrator must **override**:

1. **Preferred:** temporarily set session/config delegation to  
   `provider: antigravity` + model `ag/gemini-3-flash-agent` (or flash) so `delegate_task` children hit 9router RR, **or**  
2. **Explicit launch:**  
   `hermes chat -q -m 'ag/gemini-3-flash-agent' '…'` / provider antigravity via configured routing, and  
   `hermes chat -q -m 'cursor-composer-2.5' '…'` for the single Cursor lane.  
3. **Never** fire 4× Cursor in parallel (one account). Max **1 Cursor** job at a time.  
4. AG: up to **3–4 concurrent** is OK (RR across ~6 accounts); back off on 429/quota errors.  
5. After each child: orchestrator checks diff, runs build, restarts **only** `notary-log-cal`, health-checks cal + :3000.  
6. Command Code: require explicit “use CC for this task”; log estimated spend; kill runaway sessions.

### Optimize / change mid-flight

| Signal | Action |
|--------|--------|
| AG 429 / empty | Drop concurrency; switch flash ↔ pro-agent; wait RR cool-down |
| Cursor slow/exhausted | Pause Cursor lane; finish with AG only; notify Joseph |
| Agent not editing right files | Kill job; re-prompt with file ownership map (§4) |
| Command Code spinning | Stop immediately — protect $10 |
| Merge conflicts on `server.ts` | **Cursor-only** single agent owns merge |

### Credit / account guardrails

```
AG (6 acct RR)     ████████░░░░  parallel OK (cap 3–4)
Cursor (1 acct)    █░░░░░░░░░░░  serial only
CC Go ($10 / 3)    ░ emergency  serial + budget watch
Free OC            ░ not for this project
```

---

## 0. Non-negotiable rules for every agent

1. **No `git push`**, no `gh`, no force-push, no tags, no Worker deploy, no Cloudflare wrangler prod.  
2. **No edits** that change default prod data path without `JOURNAL_DIR`.  
3. **Do not** restart or reconfigure `notary-log` (3000) unless a shared `server.ts` bugfix is required — then verify 3000 health after.  
4. **No new branch required** — implement on cal host / current tree until Joseph says otherwise.  
5. Verify with **curl + tests + browser** against **notary-log-cal** URL, not assumptions.  
6. Isolation: User A token never sees User B bookings.  
7. Secrets (webhook HMAC, intake tokens, backup keys) → logs/env only, never commit.  
8. If blocked, write `docs/CAL-SWARM-BLOCKERS.md` entry; do not invent Cal Platform OAuth.  
9. **Accuracy guard:** no unauthorized nested swarms; no Command Code / paid burn without need.  
10. After each wave: health 200 on cal **and** prod :3000.  
11. **Providers:** AG via 9router RR + Cursor serial; not free pool.

---

## 1. Goal (definition of done — full Plan A on Zo cal host)

| # | Capability | Proof |
|---|------------|--------|
| D1 | Public `GET /book/{slug}` embeds Cal for that notary only | Browser + two slugs |
| D2 | Settings: set slug + `cal_booking_url`; copy public book URL | UI + API |
| D3 | Webhook `POST /api/cal/webhook/:token` HMAC verified | curl forged=401; real Cal or signed fixture=200 |
| D4 | Bookings list token-scoped | A/B isolation test |
| D5 | Start journal prefill from booking | name/time in new entry |
| D6 | Old intake not required for happy path on cal host | flag or nav hide when `CAL_HOST_MODE` |
| D7 | Automated tests green (unit + isolation) | `bun test` / project test cmd |
| D8 | Mobile-ish check | viewport or real device notes |
| D9 | Service survives restart; separate DB intact | supervisor restart |
| D10 | Zero GitHub remote updates from agents | `git status` / no push |

**Out of swarm scope:** Cal OAuth, Stripe SaaS, custom invoices, Platform managed users, GitHub.

---

## 2. Pre-flight (orchestrator — already partially done)

| Step | Status |
|------|--------|
| Register `notary-log-cal` HTTP public :3003 | **DONE** |
| Isolated `JOURNAL_DIR` | **DONE** |
| `JOURNAL_DIR` env support in `server.ts` | **DONE** (minimal) |
| Health public 200 | **DONE** at registration |
| Local branch `feature/cal-multi-tenant` | Wave 0 |
| Two free Cal.com accounts + event types | Joseph or Wave 0 agent (manual Cal UI) |
| Cal webhook can hit public HTTPS | use cal host URL |
| Research snapshot pinned in §11 | DONE in companion docs |

### Wave 0 — Orchestrator only (no parallel code) — ~30–60 min

- [ ] `cd /home/workspace/Projects/Notary-log && git checkout -b feature/cal-multi-tenant` (if not exists; allow dirty local)  
- [ ] Confirm `git remote -v` and **do not push**  
- [ ] Snapshot baseline: `curl` health cal + prod; copy intake token from cal log for Settings tests  
- [ ] Create `docs/CAL-SWARM-PROGRESS.md` checklist  
- [ ] Ensure `bun` install + existing tests still pass on baseline  
- [ ] Optional: Joseph provides 2× `cal.com/user/event` links for embed E2E  

**Exit:** branch + progress file + baseline green.

---

## 3. Architecture target (implement exactly)

```
https://notary-log-cal-sillyhippy.zocomputer.io
  /book/{slug}          → public embed page (no PIN)
  /api/book/{slug}      → { displayName, calBookingUrl, calLink }
  /api/me/cal           → PATCH slug + cal url + webhook secret (token)
  /api/cal/webhook/:token → HMAC → upsert bookings
  /api/bookings         → list for token
  /                     → PWA (PIN) Settings + Bookings + Journal
```

Data: same process, `JOURNAL_DIR=./Documents/Notary Journal Cal` only.

---

## 4. File ownership map (avoid agent collisions)

| Owner wave | Paths (exclusive write) |
|------------|-------------------------|
| **W1-Server** | `server.ts` (or extract `server/cal-routes.ts` + thin `server.ts` wire) |
| **W1-Server-tests** | `server.cal.test.ts` or `artifacts/.../server-cal*.test.ts` |
| **W1-Embed** | `artifacts/notary-journal/src/pages/public-book.tsx`, `src/lib/cal-link.ts`, `App.tsx` routes only |
| **W1-Settings** | `artifacts/notary-journal/src/pages/settings.tsx` Cal section only (coordinate markers) |
| **W2-Bookings-UI** | `src/pages/bookings.tsx`, nav component files |
| **W2-Prefill** | `src/lib/booking-prefill.ts`, entry new page hooks |
| **W2-Flag** | `src/lib/cal-host-mode.ts`, nav visibility |
| **W3-QA** | `docs/CAL-QA-EVIDENCE.md`, scripts under `scripts/cal-e2e*.ts` — **no product code** unless fix PR back |
| **W3-Isolation** | tests only + curl scripts |

**Rule:** If two agents need `App.tsx`, Server finishes routes first; UI agents rebase. Prefer **extract modules** over 5-way `server.ts` edits.

**Suggested extract (W1-Server may do first commit):**

```
server.ts                 # wire only
server/db.ts              # optional later
server/cal-api.ts         # book slug, me/cal, webhook, bookings
```

Only if extract reduces conflict; not mandatory if single server agent owns whole file per wave.

---

## 5. Parallel waves (execute in order; parallel inside wave)

### Wave 1 — Foundation (3 agents parallel)

| Agent ID | Role | Deliverables | Verify |
|----------|------|--------------|--------|
| **A1** | Server API + schema | migrations slug/cal fields; `bookings` table; GET book; PATCH me/cal; POST webhook skeleton (HMAC); GET bookings; register second user helper | unit tests + curl on :3003 |
| **A2** | Public book + embed | `public-book.tsx`; parse cal URL; `@calcom/embed-react` or official script; App public route | page loads; embed iframe present (even before real Cal) |
| **A3** | Settings Cal block | fields slug, cal URL, copy `origin/book/{slug}`, copy webhook URL template, secret field | UI saves via PATCH |

**Merge order:** A1 → A2/A3.  
**Restart:** `supervisorctl restart notary-log-cal` after build.  
**Gate W1:**

```bash
curl -sS https://notary-log-cal-sillyhippy.zocomputer.io/api/health
# after seed:
curl -sS https://notary-log-cal-sillyhippy.zocomputer.io/api/book/demo-slug
# 404 until set; after PATCH 200 with calBookingUrl
curl -sS -o /dev/null -w "%{http_code}\n" https://notary-log-cal-sillyhippy.zocomputer.io/book/demo-slug
curl -sS http://127.0.0.1:3000/api/health   # still 200
```

---

### Wave 2 — Sync + journal glue (3 agents parallel)

| Agent ID | Role | Deliverables | Verify |
|----------|------|--------------|--------|
| **B1** | Webhook complete | full CREATED/CANCELLED/RESCHEDULED(+PAID); raw body HMAC; fixture vectors | bad sig 401; good sig upsert |
| **B2** | Bookings page | list upcoming/past; empty states; detail | UI with seeded rows |
| **B3** | Prefill + host mode | Start entry; `booking-prefill`; hide primary intake nav if `CAL_HOST_MODE`/build flag | prefill fields; nav |

**Gate W2:**

- Seed booking via signed test POST  
- List only for owning token  
- Prefill path documented in QA doc  

---

### Wave 3 — Adversarial QA (2–4 agents parallel) — **no feature scope creep**

| Agent ID | Role | Deliverables |
|----------|------|----------------|
| **C1** | Isolation red team | scripts: token A webhook vs list B; slug enum; path traversal slug |
| **C2** | HTTP/API contract | OpenAPI-ish table of all new routes; status codes matrix |
| **C3** | UX / browser | Playwright or manual browser_navigate: book page, settings, bookings; screenshots paths in evidence |
| **C4** | Regression journal | run existing journal/signing tests; Print Journal smoke if present |

**Gate W3:** `docs/CAL-QA-EVIDENCE.md` with commands + outputs + PASS/FAIL. **All D1–D10.**

---

### Wave 4 — Hardening (1–2 agents)

| Item | Done when |
|------|-----------|
| Rate limit webhook + me/cal | abuse curl doesn't hang server |
| Prod :3000 health + intake still works | curl |
| README/dev docs for cal host only | `CAL-ZO-SERVICE.md` updated |
| Progress file 100% | Joseph review |
| Optional local commit | message only; **no push** |

---

## 6. Test matrix (must all pass before “done”)

### 6.1 Automated

| ID | Test |
|----|------|
| T01 | slug validate reject spaces/uppercase abuse |
| T02 | slug unique conflict 409 |
| T03 | GET book unknown 404 |
| T04 | PATCH me/cal requires token |
| T05 | webhook missing/invalid HMAC 401 |
| T06 | webhook valid creates row |
| T07 | webhook cancel updates status |
| T08 | list bookings other token empty/403 |
| T09 | cal URL allowlist https://cal.com or app.cal.com |
| T10 | JOURNAL_DIR isolation: cal DB path ≠ prod path in runtime logs |

### 6.2 Manual / browser on cal host

| ID | Test |
|----|------|
| M01 | Open `/` set PIN (fresh) |
| M02 | Settings save Cal link + slug |
| M03 | Incognito `/book/{slug}` shows embed |
| M04 | Complete booking on Cal test event (if accounts ready) |
| M05 | Webhook appears in Bookings (or signed simulate) |
| M06 | Start journal → name/time |
| M07 | Second user/slug independent embed |
| M08 | Prod `https://zo-reverse-proxy-.../notary/` still loads (spot check) |
| M09 | Restart cal service; data persists |
| M10 | Mobile width embed usable |

### 6.3 Negative

| ID | Test |
|----|------|
| N01 | Cannot access prod DB files via cal API |
| N02 | Webhook token guess returns 404 not 500 |
| N03 | XSS in slug reflected? must not |
| N04 | Huge webhook body rejected |

---

## 7. Build / restart protocol (every wave)

```bash
cd /home/workspace/Projects/Notary-log
# For cal subdomain host prefer empty BASE_PATH (default build)
bun run build
supervisorctl -s http://127.0.0.1:29011 restart notary-log-cal
sleep 2
curl -sS https://notary-log-cal-sillyhippy.zocomputer.io/api/health
curl -sS http://127.0.0.1:3000/api/health
# If server.ts changed and prod shares binary path — prod still old process until its restart;
# only restart prod if intentional shared fix:
# supervisorctl -s http://127.0.0.1:29011 restart notary-log
```

**Shared `server.ts` risk:** both services use same workdir file.  
- Default `JOURNAL_DIR` keeps prod safe.  
- After server.ts change, **restart cal always**; restart prod only if fix needed for prod too, then re-verify `/notary/`.

---

## 8. Agent prompts (copy-paste)

### Orchestrator system constraints (prepend all)

```
Repo: /home/workspace/Projects/Notary-log
Branch: feature/cal-multi-tenant (local only — NEVER git push)
Cal host: https://notary-log-cal-sillyhippy.zocomputer.io (port 3003)
Data: JOURNAL_DIR=./Documents/Notary Journal Cal
Prod notary-log :3000 must stay healthy. No GitHub. No Worker. No Ken test service.
Follow docs/CAL-MULTI-TENANT-IMPLEMENTATION-PLAN.md + docs/CAL-SWARM-IMPLEMENTATION-PLAN.md
Verify with real curl/tests. Report files changed + proof commands.
```

### A1 prompt

```
Implement server Cal multi-tenant APIs only: users columns slug/cal_*, bookings table,
GET /api/book/:slug, PATCH /api/me/cal, POST /api/cal/webhook/:token (HMAC), GET /api/bookings.
Optional extract server/cal-api.ts. Tests for isolation + HMAC. Restart notary-log-cal. No UI. No git push.
```

### A2 prompt

```
Implement public /book/:slug page with Cal embed from GET /api/book/:slug. Wire App.tsx public route.
Parse cal.com URL to calLink. Mobile layout. Works on notary-log-cal host BASE_PATH empty. No git push.
```

### A3 prompt

```
Settings UI: Cal booking URL, slug, copy public book link, webhook URL + secret fields calling PATCH /api/me/cal.
Do not rewrite unrelated settings. No git push.
```

### B1–B3 / C1–C4

Use wave tables above with orchestrator constraints.

---

## 9. Parallelism limits (Hermes / Zo reality)

| Limit | Practice |
|-------|----------|
| Max concurrent children | Prefer **3** code agents per wave (match host config) |
| `server.ts` | **One writer** per wave |
| Rebuild | Single agent or orchestrator runs `bun run build` after merges |
| Cal.com UI signup | Human / one agent with browser; not 3 agents fighting Google login |
| Tokens | Free models OK for UI; use stronger model for HMAC/security agent |

**Estimated wall clock with 3-wide waves:**

| Wave | Wall clock |
|------|------------|
| 0 | 30–60 min |
| 1 | 4–8 h |
| 2 | 4–8 h |
| 3 | 3–6 h |
| 4 | 2–4 h |
| **Total** | **~2–4 days** aggressive; **~5 days** with buffer |

---

## 10. Progress tracking

Maintain `docs/CAL-SWARM-PROGRESS.md`:

```markdown
| Wave | Agent | Status | Evidence path | Blockers |
|------|-------|--------|---------------|----------|
| 0 | orch | | | |
| 1 | A1 | | | |
...
```

Update after every agent return. Orchestrator does not mark D1–D10 done without evidence.

---

## 11. Research pin (do not re-litigate mid-swarm)

| Topic | Decision |
|-------|----------|
| Public client | Cal embed / link — not custom intake form |
| Fees/Stripe | Notary configures in Cal |
| OAuth | **Out of this swarm** |
| Platform managed users | **Forbidden** (no new signups / deprecated) |
| Webhooks | HTTPS to cal host; HMAC `x-cal-signature-256` |
| Multi-user | slug + token isolation on one Zo HTTP service |
| GitHub | **No push** |

Sources already captured in `CAL-MULTI-TENANT-IMPLEMENTATION-PLAN.md` and `CAL-OAUTH-IMPLEMENTATION-PLAN.md`.

---

## 12. Rollback

```bash
# stop cal feature process only
supervisorctl -s http://127.0.0.1:29011 stop notary-log-cal
# or leave running on pre-feature build:
git checkout -- artifacts/notary-journal server.ts  # careful local only
bun run build && supervisorctl ... restart notary-log-cal
```

MCP delete service only if Joseph wants full teardown (`docs` zo-service skill full delete checklist). **Do not** delete prod `notary-log`.

---

## 13. Joseph go / no-go

| Phrase | Meaning |
|--------|---------|
| `Execute CAL swarm Wave 0` | Branch + baseline only |
| `Execute CAL swarm Wave 1` | Spawn A1–A3 (or orchestrator implements) |
| `Execute CAL swarm all waves` | Full Plan A through QA on cal host |
| `Stop swarm` | No further agents; leave service as-is |
| `Ship` / push | **Only then** consider GitHub — still confirm Worker policy |

---

## 14. Orchestrator final verification script (Wave 3/4)

```bash
#!/usr/bin/env bash
set -euo pipefail
CAL=https://notary-log-cal-sillyhippy.zocomputer.io
PROD=http://127.0.0.1:3000
curl -fsS "$CAL/api/health" | grep -q ok
curl -fsS "$PROD/api/health" | grep -q ok
# extend with token fixtures from CAL-QA-EVIDENCE.md
echo "baseline health OK"
```

Save as `scripts/cal-verify-health.sh` during Wave 0/4.

---

## Resume

```
Execute CAL swarm Wave 0 per docs/CAL-SWARM-IMPLEMENTATION-PLAN.md
```

Then:

```
Execute CAL swarm Wave 1 per docs/CAL-SWARM-IMPLEMENTATION-PLAN.md
```
