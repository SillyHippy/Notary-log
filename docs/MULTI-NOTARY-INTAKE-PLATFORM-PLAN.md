# Multi-Notary Intake Platform — Comprehensive Implementation Plan

**Status:** Planning only — **do not implement until Joseph says go.**  
**Resume phrase:**  
`Implement multi-notary intake per docs/MULTI-NOTARY-INTAKE-PLATFORM-PLAN.md — Phase N Task T`  

| Meta | Value |
|------|--------|
| Repo | `/home/workspace/Projects/Notary-log` (GitHub `SillyHippy/Notary-log`) |
| Primary QA host | Zo reverse-proxy `https://zo-reverse-proxy-sillyhippy.zocomputer.io/notary/` → `notary-log` `:3000` |
| Public Worker | `notary-log.iannazzi.workers.dev` — **do not push `main`** until Joseph approves (auto-deploys) |
| Branch policy | Work on `feature/multi-notary-intake` (or similar); merge/push only on OK |
| License | Non-commercial today — **no public paid Stripe** until license/ToS decision |
| MVP scope | Phases 0–6 (self-serve + branded/dynamic form + isolated queue + Zo backup restore) |
| Later | Phase 7 Google auth, Phase 8 Stripe limits, Phase 9 domain |

---

## Table of contents

1. [Product locked decisions](#1-product-locked-decisions)  
2. [Baseline inventory (what exists today)](#2-baseline-inventory-what-exists-today)  
3. [Target architecture](#3-target-architecture)  
4. [Data model & migrations](#4-data-model--migrations)  
5. [API contract (exact)](#5-api-contract-exact)  
6. [Frontend change map](#6-frontend-change-map)  
7. [Phase 0 — Prep](#phase-0--prep--safety)  
8. [Phase 1 — Server](#phase-1--server-isolation-register-config-pending-cap)  
9. [Phase 2 — Onboarding + form editor](#phase-2--self-serve-onboarding--settings-form-editor)  
10. [Phase 3 — Dynamic intake](#phase-3--dynamic-public-intake-page)  
11. [Phase 4 — Client Requests](#phase-4--client-requests-isolation--ux)  
12. [Phase 5 — Zo backup restore](#phase-5--zo-backup-list--one-click-restore)  
13. [Phase 6 — Hardening](#phase-6--hardening--docs)  
14. [Phases 7–9 — Later](#phases-7-9--later-do-not-start-in-mvp)  
15. [Global regression suite](#15-global-regression-suite-run-before-any-ship)  
16. [Deploy checklist](#16-deploy-checklist)  
17. [Open questions](#17-open-questions-resolve-in-phase-0)  
18. [Definition of done (MVP)](#18-definition-of-done-mvp)

---

## 1. Product locked decisions

| Topic | Decision |
|-------|----------|
| Multi-user meaning | **Forms + queues + Zo backups** only; journal stays **device IndexedDB** |
| Isolation key | Zo `users.token` (same as today’s `zoComputerToken`) |
| Form customization | Name, phone, logo, accent, welcome, instructions, **per-field enable/required**, required docs list |
| Custom domain per notary | **Out of scope** |
| Email | **Web3Forms** (existing client path) / optional Formsubmit; **not** Zo mail as source of truth |
| Accept / Deny | Keep client-driven Accept (prefill draft + delete submission); Deny = delete PII |
| Pending cap | **Hard 429** at **10** pending per token (plan override later) |
| Self-serve | `POST /api/notary/register` → token + default form config |
| Free core | Intake + Accept/Deny always works without payment |
| Paid later | Higher pending, email quota, backup retention only |
| Zo domain | **Subdomain only** on Zo custom domains; apex via redirect elsewhere |

---

## 2. Baseline inventory (what exists today)

### 2.1 Server — `server.ts`

| Piece | Location / behavior | Keep / change |
|-------|---------------------|---------------|
| SQLite path | `Documents/Notary Journal/notary.db` (via `JOURNAL_DIR`) | Keep |
| `users` table | `id`, `token`, `name`, `email`, `created_at` | **ALTER** add columns |
| `submissions` | `id`, `user_token`, `payload_json`, `created_at` | Keep; optional `status` later |
| `files` | Linked to submission + `user_token` | Keep |
| `ensureDefaultNotaryUser` | Creates first user on empty DB | Keep for single-tenant bootstrap |
| `getPrimaryIntakeToken` / `/api/bootstrap` | Auto token for Settings | Keep for legacy single notary |
| `handleZoIntakePost` | Multipart/JSON; validate token; insert; optional `sendZoEmail` | Add **pending count** check; prefer Web3Forms notify from client |
| `handleZoIntakeList` | `WHERE user_token = ?` → `{ files: [{ name, modifiedTime, size }] }` | Keep shape for client compat |
| `handleZoIntakeDetail` | `id + user_token`; attaches file data URLs | Keep |
| `handleZoIntakeDelete` | Deletes files + rows scoped by token | Keep (Deny path) |
| Legacy Web3Forms file dir | `Documents/Notary Journal/intake/*.json` | Keep fallback |
| Backup | `handleBackupRequest` + `BACKUP_DIR` + Bearer key | Extend to **per-token subdirs** or token claim in key |

### 2.2 Client libs

| File | Role |
|------|------|
| `artifacts/notary-journal/src/lib/intake-api.ts` | `listSubmissions`, `getSubmission`, `deleteSubmission`, `getIntakeMode`, `isZoHost`, normalize payload |
| `artifacts/notary-journal/src/lib/intake-prefill.ts` | Accept → stash → `/entry/new` |
| `artifacts/notary-journal/src/lib/zo-backup.ts` | `listZoBackups`, `uploadZoBackup`, download helpers; Bearer backup key |
| `artifacts/notary-journal/src/lib/zo-backup.test.ts` | Unit tests for URL/auth |
| `artifacts/notary-journal/src/lib/app-path.ts` | `apiPath`, `appPath`, BASE_PATH `/notary/` |
| `artifacts/notary-journal/src/lib/db.ts` | Settings: `zoComputerToken`, `web3formsKey`, Zo backup URL/key fields |
| `artifacts/notary-journal/src/lib/export.ts` | Backup envelope parse/validate (reuse for restore) |

### 2.3 UI pages

| File | Role |
|------|------|
| `pages/client-intake.tsx` | Public form; Zo multipart POST + Web3Forms email Step A; hardcoded fields |
| `pages/client-requests.tsx` | List/expand/Accept/Deny |
| `pages/settings.tsx` | Paste Zo token / Web3Forms; intake link copy; Zo backup config; seal/logo (PDF) |
| `App.tsx` | `/intake` outside PIN; bootstrap auto token on Zo |

### 2.4 Gaps to close

1. No self-serve multi-user **register** (only default first user + bootstrap primary).  
2. No **form_config** / branding on Zo.  
3. Intake page **not** driven by config.  
4. No **pending cap**.  
5. Backup is **shared directory** + shared backup key — not multi-notary isolated.  
6. No one-click restore UX listing backups (list API exists; wire + confirm replace).  
7. Cross-token isolation tests not automated.  
8. Onboarding still “paste token from logs” for multi-user.

---

## 3. Target architecture

```
Notary device (PWA)
  PIN + IndexedDB journal
  Settings: zoComputerToken, form editor, backup
  Client Requests: Accept / Deny
         │
         │ HTTPS same origin (Zo) or configured backup URL
         ▼
Zo server.ts
  users (token, branding, form_config_json, plan, max_pending)
  submissions (user_token scoped)
  files (user_token scoped)
  backups/{tokenHash}/…json
         │
         │ notify only (optional)
         ▼
Web3Forms / Formsubmit → notary email
```

**Client form** never needs PIN.  
**Notary app** needs PIN + token in settings.

---

## 4. Data model & migrations

### 4.1 SQL migration strategy (`server.ts` `initDatabase`)

On startup after `CREATE TABLE IF NOT EXISTS`:

```sql
-- Idempotent column adds (run PRAGMA table_info; add missing only)
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN welcome_text TEXT;
ALTER TABLE users ADD COLUMN accent_color TEXT;
ALTER TABLE users ADD COLUMN logo_path TEXT;          -- filesystem path under user dir OR store small data URL in logo_data_url
ALTER TABLE users ADD COLUMN logo_data_url TEXT;
ALTER TABLE users ADD COLUMN notify_email TEXT;
ALTER TABLE users ADD COLUMN web3forms_key TEXT;
ALTER TABLE users ADD COLUMN form_config_json TEXT;
ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free';
ALTER TABLE users ADD COLUMN max_pending INTEGER;     -- NULL = use plan default
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;
```

SQLite ignores duplicate column errors if you gate with `PRAGMA table_info(users)`.

**Default plan limits (code constants):**

```ts
const PLAN_DEFAULTS = {
  free: { maxPending: 10, maxBackups: 5 },
  pro:  { maxPending: 50, maxBackups: 30 },
} as const;
```

### 4.2 Default `form_config_json` (code constant)

Ship `DEFAULT_FORM_CONFIG` in a shared module:

- **New file (recommended):** `artifacts/notary-journal/src/lib/intake-form-config.ts`  
- **Mirror or import from server:** either duplicate constant in `server.ts` or extract `lib/intake-form-config.ts` at monorepo root consumed by both (simplest MVP: **duplicate JSON constant** in server + client with matching `version: 1`).

Required fields for v1 default (enabled+required unless noted):

| Field key | Default enabled | Default required |
|-----------|-----------------|------------------|
| signerFirstName, signerLastName | yes | yes |
| phone, email | yes | no |
| signerAddress, signerCity, signerState, zip | yes | state yes; others no |
| idType, idNumber | yes | idType yes |
| idFrontImage | yes | yes |
| idBackImage | yes | no |
| notes / preferredDate / services | yes/no mix | no |

Plus `welcomeText`, `instructions`, `successMessage`, `requiredDocs[]`.

### 4.3 Submission identity (compat)

Keep list API shape:

```json
{ "files": [ { "name": "<submission_uuid>", "modifiedTime": "...", "size": 123 } ] }
```

`name` = submission `id` (already true for Zo path in `handleZoIntakeList`).

### 4.4 Backup isolation layout

**Change from:** `Documents/Notary Journal/backups/*.json` (flat, all notaries if shared key)  

**Change to:**

```
Documents/Notary Journal/backups/
  _shared/                    # legacy single-key backups (migrate existing files here on first boot)
  t_<sha256(token).slice(0,16)>/
    notary-journal-backup-YYYY-MM-DD.json
    notary-journal-latest.json   # optional rolling pointer
```

Auth options (pick one in Phase 5 Task 1):

**Option A (recommended MVP):** Backup requests include header `X-Intake-Token: <token>` **in addition to** or **instead of** global backup key when multi-notary. Server resolves dir from token. Global `BACKUP_KEY` remains for legacy single-tenant.

**Option B:** Per-user `backup_key` column (extra settings field). More UI; better if tokens are for intake only.

**Default for plan:** Option A — same `zoComputerToken` scopes backups when present; fallback to legacy flat dir + `Authorization: Bearer BACKUP_KEY`.

---

## 5. API contract (exact)

Base path: respect reverse proxy. Client uses `apiPath('/api/...')` → `/notary/api/...` when `BASE_PATH=/notary/`.

### 5.1 `POST /api/notary/register`

**Purpose:** Self-serve create notary user.

**Request:**
```json
{
  "name": "Ken Clark",
  "email": "ken@example.com",
  "phone": "555-0100",
  "notifyEmail": "ken@example.com"
}
```

**Response 201:**
```json
{
  "token": "<64+ hex>",
  "intakePath": "/intake?key=<token>",
  "name": "Ken Clark",
  "plan": "free",
  "maxPending": 10
}
```

**Errors:**  
- `400` missing name  
- `429` rate limit (e.g. 5/hour/IP)  
- `503` if register disabled via env `INTAKE_REGISTER_ENABLED=false`

**Verification:**
```bash
curl -sS -X POST "$BASE/api/notary/register" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test A","email":"a@test.com"}' | jq .
# expect token length >= 32; store TOKEN_A
```

### 5.2 `GET /api/intake/config?key=TOKEN`

**Public** (client form load). **Strip secrets.**

**Response 200:**
```json
{
  "name": "Ken Clark",
  "phone": "555-0100",
  "welcomeText": "...",
  "accentColor": "#1e3a5f",
  "logoDataUrl": "data:image/png;base64,...",
  "formConfig": { "version": 1, "fields": {}, "requiredDocs": [], "instructions": "", "successMessage": "" }
}
```

**Never return:** `web3forms_key`, `email` internals, other users.

**Errors:** `401` invalid key.

**Verification:**
```bash
curl -sS "$BASE/api/intake/config?key=$TOKEN_A" | jq 'keys'
# must NOT contain web3forms_key
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/intake/config?key=deadbeef"
# expect 401
```

### 5.3 `GET /api/intake/config` (authenticated editor) + `PUT`

Same as public GET but may include `notifyEmail`, `web3formsKey` set flag (`hasWeb3formsKey: true` without revealing full key optional).

**PUT body:** branding fields + `formConfig` object. Server writes `form_config_json`, updates `updated_at`.

**Verification:** PUT then public GET shows new welcomeText.

### 5.4 `POST /api/intake` (existing — extend)

Before insert:

```ts
const max = user.max_pending ?? PLAN_DEFAULTS[user.plan ?? 'free'].maxPending;
const count = db.query(
  `SELECT COUNT(*) AS c FROM submissions WHERE user_token = ?`
).get(token).c;
if (count >= max) return json({ error: 'queue_full', maxPending: max }, { status: 429 });
```

**Response 429:**
```json
{ "error": "queue_full", "maxPending": 10, "message": "This notary's request queue is full. Try again later." }
```

Client intake page must surface this string.

**Verification:** insert 10 dummy rows for TOKEN_A; 11th POST → 429; TOKEN_B still 201.

### 5.5 `GET/DELETE /api/intake` (existing)

Already token-scoped for Zo. **Add automated tests.**  
Optional: filter list to pending only if status column added.

### 5.6 Backup API extensions

| Method | Behavior |
|--------|----------|
| GET `/api/backup` | List files in token dir (or legacy flat if only Bearer global key) |
| GET `/api/backup?file=` | Download if file in caller's dir |
| POST `/api/backup` | Write into caller's dir; enforce maxBackups (delete oldest) |

**Verification:** upload as A; list as B → empty / no A's files; download as B of A's filename → 404.

---

## 6. Frontend change map

| File | Changes |
|------|---------|
| **NEW** `src/lib/intake-form-config.ts` | Types `FormConfig`, `DEFAULT_FORM_CONFIG`, `mergeFormConfig()`, field labels |
| **NEW** `src/lib/intake-form-config.test.ts` | Defaults + merge validation |
| `src/lib/intake-api.ts` | `registerNotary()`, `getIntakeFormConfig(key)`, `saveIntakeFormConfig()`, `getPublicIntakeConfig(key)`; better 429 handling |
| `src/lib/zo-backup.ts` | Pass intake token header; `restore` helper wrapping download + parse |
| `src/lib/zo-backup.test.ts` | Token header + list isolation mocks |
| `src/lib/db.ts` | Settings fields if needed: `intakeNotifyEmail` optional (or store only on server) |
| `src/pages/client-intake.tsx` | Fetch config; dynamic fields; branding CSS vars; queue_full UI |
| `src/pages/client-requests.tsx` | Empty state CTA; token errors; optional pending count badge `n / max` |
| `src/pages/settings.tsx` | Section **Client intake form** editor; **Create my intake link**; backup list + Restore button |
| `src/App.tsx` | First-run card if Zo host && !token → create link; keep bootstrap compat |
| `src/pages/privacy-policy.tsx` | Multi-notary Zo storage wording |
| `server.ts` | All server tasks below |
| **NEW** `artifacts/notary-journal/src/lib/intake-isolation.test.ts` or server-side test script | Cross-token tests |
| `docs/client-form-integration.md` | Update for multi-notary |
| `DEPLOYMENT.md` | Register + form config notes |

---

# Phase 0 — Prep & safety

**Goal:** Safe branch, baseline measurements, answers to open questions.  
**Estimate:** 0.5 day  
**No product behavior change.**

### Task 0.1 — Branch & baseline

**Do:**
```bash
cd /home/workspace/Projects/Notary-log
git checkout main && git pull
git checkout -b feature/multi-notary-intake
# record HEAD
git rev-parse --short HEAD > /tmp/notary-intake-baseline-sha.txt
```

**Verify:**
- [ ] `git status -sb` shows feature branch  
- [ ] `notary-log` still RUNNING; proxy `/notary/` returns 200  
- [ ] Manual: open app, journal still loads (sanity)

### Task 0.2 — Capture baseline API behavior

**Do:** With existing Zo token (from Settings or bootstrap):

```bash
BASE='https://zo-reverse-proxy-sillyhippy.zocomputer.io/notary'
# or http://127.0.0.1:3000 with path awareness
curl -sS "$BASE/api/health" || curl -sS "$BASE/api/bootstrap" | head
```

Document current intake list shape to a short note in plan appendix or `docs/intake-baseline.md`.

**Verify:**
- [ ] List/detail/delete still work for primary token  
- [ ] Note file written

### Task 0.3 — Resolve open questions (Joseph)

Record answers in §17 of this doc (edit the Decision column).

**Verify:**
- [ ] Shared Web3Forms vs own-key-only decided  
- [ ] Zo-only register vs public Worker decided (default Zo-only)  
- [ ] License note acknowledged if Stripe planned

### Task 0.4 — Test harness prep

**Do:**
```bash
cd /home/workspace/Projects/Notary-log/artifacts/notary-journal
pnpm test   # or bun run test — fix only if env broken, not feature work
```

**Verify:**
- [ ] Existing tests green (or known failures listed, not ignored silently)

### Phase 0 exit criteria
- [ ] Feature branch exists  
- [ ] Baseline SHA recorded  
- [ ] Open questions answered or explicitly deferred with defaults  
- [ ] App still healthy on reverse-proxy  

---

# Phase 1 — Server: isolation, register, config, pending cap

**Goal:** All multi-notary guarantees exist at API layer before UI.  
**Estimate:** 1–2 days  
**Files:** `server.ts` primarily; optional extract `server/intake-*.ts` if file > ~900 lines.

### Task 1.1 — Schema migration helpers

**Change `initDatabase()` / new `migrateUsersTable(db)`:**
- PRAGMA table_info  
- ADD COLUMN for each new field if missing  
- Backfill: `UPDATE users SET form_config_json = ? WHERE form_config_json IS NULL` with `JSON.stringify(DEFAULT_FORM_CONFIG)`  
- Backfill `plan = 'free'`, `notify_email = email` where null  

**Verify:**
```bash
# After restart notary-log
sqlite3 "$JOURNAL_DB" "PRAGMA table_info(users);"
# expect new columns present
sqlite3 "$JOURNAL_DB" "SELECT token, plan, length(form_config_json) FROM users LIMIT 3;"
```
- [ ] Existing primary user still validates  
- [ ] form_config_json non-null for all users  

### Task 1.2 — `DEFAULT_FORM_CONFIG` + helpers in server

**Add functions:**
- `defaultFormConfig(): object`  
- `publicConfigForUser(row): object` — strips secrets  
- `resolveMaxPending(user): number`  
- `countPending(db, token): number`  

**Verify:** Unit-test pure helpers if extracted; else manual node/bun snippet importing constants.

### Task 1.3 — `POST /api/notary/register`

**Wire in request router** (same place other `/api/*` routes register).

**Implementation details:**
- Generate token via existing `generateIntakeToken()`  
- Insert user with defaults  
- Rate limit: in-memory `Map<ip, timestamps[]>` (OK for single Zo process); env `REGISTER_MAX_PER_HOUR=5`  
- Env killswitch `INTAKE_REGISTER_ENABLED` default `true` on Zo  

**Verify:**
```bash
# Register A and B
TOKEN_A=$(curl -sS -X POST "$BASE/api/notary/register" -H 'Content-Type: application/json' \
  -d '{"name":"Notary A","email":"a@ex.com"}' | jq -r .token)
TOKEN_B=$(curl -sS -X POST "$BASE/api/notary/register" -H 'Content-Type: application/json' \
  -d '{"name":"Notary B","email":"b@ex.com"}' | jq -r .token)
test "${#TOKEN_A}" -ge 32 && test "$TOKEN_A" != "$TOKEN_B" && echo OK_REGISTER
```
- [ ] Two distinct tokens  
- [ ] 6th rapid register from same IP → 429 (if limit 5)  
- [ ] Primary bootstrap user still works  

### Task 1.4 — Config GET/PUT

**Routes:**
- `GET /api/intake/config?key=` → publicConfigForUser  
- `PUT /api/intake/config?key=` or `Authorization: Bearer` / header `X-Intake-Token` → update fields  

**PUT validation:**
- `accentColor` must match `/^#[0-9A-Fa-f]{6}$/` or empty  
- `formConfig.version === 1`  
- logo size cap e.g. 300KB data URL  

**Verify:**
```bash
curl -sS -X PUT "$BASE/api/intake/config?key=$TOKEN_A" -H 'Content-Type: application/json' \
  -d '{"welcomeText":"Hello from A","accentColor":"#112233","formConfig":{...}}'
curl -sS "$BASE/api/intake/config?key=$TOKEN_A" | jq -r .welcomeText
# expect Hello from A
curl -sS "$BASE/api/intake/config?key=$TOKEN_B" | jq -r .welcomeText
# must NOT be Hello from A
```
- [ ] Isolation on config  
- [ ] Secrets not in public GET  

### Task 1.5 — Pending cap on POST `/api/intake`

**Change `handleZoIntakePost`:** after token validate, before INSERT, count + 429.

**Verify:**
```bash
# script: post 10 minimal payloads as TOKEN_A
for i in $(seq 1 10); do
  curl -sS -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/intake" \
    -H 'Content-Type: application/json' \
    -d "{\"key\":\"$TOKEN_A\",\"signerFirstName\":\"T$i\",\"signerLastName\":\"User\"}"
done
# 11th
curl -sS -w "\n%{http_code}\n" -X POST "$BASE/api/intake" \
  -H 'Content-Type: application/json' \
  -d "{\"key\":\"$TOKEN_A\",\"signerFirstName\":\"Overflow\",\"signerLastName\":\"User\"}"
# expect 429 queue_full
# TOKEN_B post still 201
```
- [ ] A blocked at 10  
- [ ] B unaffected  
- [ ] After DELETE one of A's, POST succeeds again  

### Task 1.6 — Cross-token isolation tests (automated)

**Add** `scripts/test-intake-isolation.sh` or vitest against running server:

Cases:
1. A cannot GET B's submission id → 404  
2. A cannot DELETE B's submission → 404 / 0 rows  
3. A cannot PUT B's config  
4. List A length independent of B inserts  

**Verify:**
```bash
bash scripts/test-intake-isolation.sh "$BASE"
# exit 0
```
- [ ] Script in repo  
- [ ] Documented in this plan Phase 1 exit  

### Task 1.7 — Restart & smoke primary notary

**Do:** rebuild not needed for server-only TS if bun runs `server.ts` direct; restart supervisor `notary-log`.

```bash
supervisorctl -s http://127.0.0.1:29011 restart notary-log
sleep 2
curl -sS -o /dev/null -w '%{http_code}\n' https://zo-reverse-proxy-sillyhippy.zocomputer.io/notary/
```

**Verify:**
- [ ] Service RUNNING  
- [ ] Existing app Settings token still lists submissions  
- [ ] No regression on `/api/backup` with existing backup key  

### Phase 1 exit criteria
- [ ] Register works  
- [ ] Config GET/PUT + isolation  
- [ ] Pending cap 429  
- [ ] Isolation script green  
- [ ] Primary notary unbroken  
- [ ] **No GitHub push** unless Joseph asks  

---

# Phase 2 — Self-serve onboarding + Settings form editor

**Goal:** Notary can create link and edit form without SSH/logs.  
**Estimate:** 1–2 days  

### Task 2.1 — Client API wrappers

**File:** `intake-api.ts`

Add:
```ts
export async function registerNotary(input: { name: string; email?: string; phone?: string; notifyEmail?: string }): Promise<{ token: string; intakePath: string; maxPending: number }>
export async function fetchPublicIntakeConfig(key: string): Promise<PublicIntakeConfig>
export async function fetchEditorIntakeConfig(): Promise<EditorIntakeConfig>  // uses getActiveIntakeKey
export async function saveIntakeFormConfig(body: EditorIntakeConfig): Promise<void>
```

Use `apiPath('/api/notary/register')` and `apiPath('/api/intake/config')`.

**Verify:**
```bash
cd artifacts/notary-journal && pnpm exec tsc -p tsconfig.json --noEmit 2>&1 | head
# no errors in intake-api (ignore pre-existing unrelated errors if listed as known)
```
- [ ] Functions exported  
- [ ] 401/429 mapped to clear Error messages  

### Task 2.2 — Settings: Create my intake link

**File:** `settings.tsx` (Client intake card area ~Zo/Web3Forms section)

**UI:**
- If `!zoComputerToken` && `isZoHost()`: primary button **Create my intake link**  
- On click: call `registerNotary` with Settings notary name/email fields (or small dialog)  
- Save token via existing settings save path (`zoComputerToken`)  
- Toast success + show copyable link using existing intake link UI  

**Keep:** Manual paste token for advanced/migration.

**Verify (manual on phone/desktop):**
1. Clear Zo token in Settings (or fresh profile)  
2. Create link → token populated  
3. Copy link → path includes `/intake?key=` and works with BASE_PATH  
4. Reload Settings → token persists  
- [ ] All 4 steps pass  

### Task 2.3 — Settings: Form editor section

**New collapsible card** “Intake form appearance & fields” under intake keys.

**Controls:**
| Control | Binds to |
|---------|----------|
| Display name | users.name |
| Phone | phone |
| Welcome text | welcome_text |
| Instructions | formConfig.instructions |
| Success message | formConfig.successMessage |
| Accent color | accent_color (color input) |
| Logo upload | logo_data_url (reuse image compress from seal/logo if possible) |
| Notify email | notify_email |
| Web3Forms key | web3forms_key (password input) |
| Per-field switches | formConfig.fields[key].enabled / .required |
| Required docs | dynamic list add/remove |

**Save button** → `saveIntakeFormConfig` + toast.

**data-testid suggestions:**
- `button-create-intake-link`  
- `button-save-intake-form`  
- `input-intake-welcome`  
- `input-intake-accent`  

**Verify:**
1. Change welcome + accent → Save  
2. `curl` public config shows new values  
3. Reload Settings editor shows same values  
4. Disable `signerEmail` → config fields.email.enabled false  
- [ ] Pass  

### Task 2.4 — App first-run nudge (optional but recommended)

**File:** `App.tsx` after unlock  

If `isZoHost()` && settings loaded && !zoComputerToken → non-blocking banner: “Set up client intake” → Settings.

**Verify:**
- [ ] Banner shows only when missing token  
- [ ] Dismiss or navigate works; no block of journal  

### Phase 2 exit criteria
- [ ] Create link without logs  
- [ ] Editor persists config on Zo  
- [ ] Manual token paste still works  
- [ ] Web3Forms-only mode still works when no Zo token on non-Zo hosts  

---

# Phase 3 — Dynamic public intake page

**Goal:** `/intake?key=` branded + field-filtered form.  
**Estimate:** 1–2 days  
**File:** `client-intake.tsx` (large — change carefully)

### Task 3.1 — Load config on mount

**Replace** hard dependency on only key presence:

```ts
const key = searchParams key
useEffect → fetchPublicIntakeConfig(key)
  states: loading | invalid | ready(config)
```

**UI states:**
- Loading spinner  
- Invalid link (401)  
- Ready: render form  

**Verify:**
- [ ] Bad key → clear error, no crash  
- [ ] Good key → name/welcome/logo visible  

### Task 3.2 — Branding

- Set CSS variables on form root: `--intake-accent: config.accentColor`  
- Header: logo + name + phone (tel: link)  
- Welcome + instructions blocks  

**Verify:**
- [ ] Accent affects button/link color  
- [ ] Logo renders if set; layout OK if missing  

### Task 3.3 — Dynamic fields

**Render rules:**
- Skip field if `!enabled`  
- `required` attribute if required  
- Keep existing validation patterns for ID images  
- requiredDocs → file inputs with labels  

**Submit payload:** only include enabled fields + key/token.

**Verify:**
1. Disable phone in editor → intake has no phone field  
2. Require notes → empty submit blocked  
3. Enable preferredDate → shows and submits  
- [ ] Pass  

### Task 3.4 — Submit + email + queue_full

**Keep dual path:**
1. Zo POST multipart (primary when Zo token key)  
2. Web3Forms text email (if web3 key available — **from notary config** server-side is better long-term; MVP may still use client-side key only if stored in notary settings not public config)

**Important design (MVP):**  
Public page cannot read `web3forms_key`. Options:

| Option | Implementation |
|--------|----------------|
| **A (recommended)** | Server after successful Zo POST sends notify via stored `web3forms_key` or `notify_email` server-side fetch to Web3Forms API |
| B | Client only emails if somehow configured (won't work multi-tenant public) |

**Phase 3 Task 3.4a:** Implement **server-side notify** after `handleZoIntakePost` success using user's `web3forms_key` + `notify_email` (HTTP POST to Web3Forms). Keep client Web3Forms path only for pure Web3Forms mode (no Zo token).

**429 handling:** show `queue_full` message from API.

**Verify:**
- [ ] Submit appears in Client Requests for that token  
- [ ] Email received if web3forms_key set on user  
- [ ] Email fail does not fail intake (still 201)  
- [ ] 11th pending shows friendly full message  

### Task 3.5 — Success screen

Use `formConfig.successMessage` or default.

**Verify:**
- [ ] Custom success message displays  

### Phase 3 exit criteria
- [ ] Two notaries, two brandings, two queues  
- [ ] Field toggles honored  
- [ ] Queue cap UX OK  
- [ ] Mobile layout smoke (narrow viewport)  

---

# Phase 4 — Client Requests isolation & UX

**Goal:** Accept/Deny remain correct; clearer multi-notary UX.  
**Estimate:** 0.5–1 day  
**File:** `client-requests.tsx`, light `intake-api.ts`

### Task 4.1 — Confirm Accept path unchanged but robust

Current:
1. `getSubmission`  
2. `stashIntakePrefill`  
3. `deleteSubmission`  
4. Navigate `/entry/new`  

**Add:** toast if delete fails after stash (orphan warning). Prefer: delete only after stash success; if navigate fails, submission already deleted — acceptable MVP; document.

**Verify:**
- [ ] Accept creates draft with client name/ID  
- [ ] Submission gone from list  
- [ ] Wrong token cannot accept another's id  

### Task 4.2 — Deny

Keep delete; toast.

**Verify:**
- [ ] Files removed server-side (detail 404 after)  

### Task 4.3 — Empty / error states

- No token → link to Settings intake section  
- Empty queue → “Share your intake link” + copy button if token present  
- Show `pendingCount / maxPending` if API adds header or config endpoint returns max  

**Optional API:** list response `{ files, pendingCount, maxPending }` — **additive** field; client ignores if missing.

**Verify:**
- [ ] Empty state helpful  
- [ ] Error copy distinguishes invalid token vs network  

### Phase 4 exit criteria
- [ ] Accept/Deny manual path green for Zo token  
- [ ] Web3Forms legacy path still works when mode=web3forms  

---

# Phase 5 — Zo backup list + one-click restore

**Goal:** Multi-notary safe backups + restore UX.  
**Estimate:** 1–2 days  
**Files:** `server.ts` backup handler, `zo-backup.ts`, Settings/Reports UI

### Task 5.1 — Server per-token backup dirs

**Change `handleBackupRequest`:**
1. Resolve identity: `X-Intake-Token` validated → `backupDirForToken(token)`  
2. Else Bearer global key → `_shared` or flat legacy dir  
3. GET list / GET file / POST write only inside resolved dir  
4. On POST, if files > maxBackups, delete oldest  

**Migrate:** on boot, if flat json files exist in BACKUP_DIR root, move to `_shared/`.

**Verify:**
```bash
# upload with token A header
curl -sS -X POST "$BASE/api/backup" \
  -H "Authorization: Bearer $BACKUP_KEY" \
  -H "X-Intake-Token: $TOKEN_A" \
  -H 'Content-Type: application/json' \
  -d '{"filename":"notary-journal-backup-test-a.json","backup":{"version":2,"entries":[]}}'
# list with B must not show test-a
```
- [ ] Isolation holds  
- [ ] Legacy backup key still lists `_shared`  

### Task 5.2 — Client `zo-backup.ts`

- Add optional `intakeToken` to config; send `X-Intake-Token`  
- Settings already has zo backup URL/key — auto-set URL to `apiPath('/api/backup')` on Zo host when empty  
- `downloadZoBackup` already used — ensure restore uses `parseBackupPayload` from `export.ts`  

**Verify:** unit tests in `zo-backup.test.ts` updated for header.

### Task 5.3 — UI: list + restore

**Location:** Settings **Data & Integrity** / backup card (top of Settings per prior UX).

**UI:**
1. Button **Refresh backups** → `listZoBackups`  
2. List rows: name, date, size  
3. **Restore** → confirm dialog: “Replaces journal entries on **this device**?”  
4. On confirm: download → validate → import entries (use existing import path from Settings file import)  
5. Toast success; stay locked/unlocked consistently  

**Verify (manual):**
1. Create 1–2 journal entries  
2. Backup to Zo  
3. Add another entry locally  
4. Restore older backup → confirm data matches backup (entry count)  
5. Second notary token cannot see first's backup list  
- [ ] Pass  

### Task 5.4 — Origin warning

Short note in backup UI: “Backups are per account token. Changing domain/device requires restore.”

**Verify:** text visible.

### Phase 5 exit criteria
- [ ] Per-token backup isolation  
- [ ] One-click restore works on Zo  
- [ ] Drive backup untouched  

---

# Phase 6 — Hardening & docs

**Estimate:** 1 day  

### Task 6.1 — Rate limits & payload caps

| Endpoint | Limit (defaults) |
|----------|------------------|
| POST register | 5/hour/IP |
| POST intake | 30/hour/token + pending cap |
| POST backup | 20/day/token |
| Logo / ID image | max 5MB/file, images only |

**Verify:** curl loops return 429 appropriately.

### Task 6.2 — Privacy policy + README/DEPLOYMENT

Update multi-notary Zo storage, Accept/Deny, email provider language.

**Verify:** links open; no stale “Web3Forms only” as sole path on Zo.

### Task 6.3 — Full isolation script in CI/local

```bash
bash scripts/test-intake-isolation.sh
cd artifacts/notary-journal && pnpm test
```

**Verify:** exit 0.

### Task 6.4 — Manual MVP checklist (Joseph)

Use §18. Print or tick in Telegram.

### Phase 6 exit criteria
- [ ] Hardening done  
- [ ] Docs updated  
- [ ] MVP checklist passed on reverse-proxy  
- [ ] Ready for Joseph ship decision  

---

# Phases 7–9 — Later (do not start in MVP)

### Phase 7 — Google sign-in
- Link `google_sub` to user  
- On sign-in, restore `zoComputerToken` + form config from server  
- Journal still via backup restore  
- **Verify:** two devices same Google → same intake link; journals independent until restore  

### Phase 8 — Stripe (Zo Connect)
- Checkout → webhook → `plan=pro`, raise `max_pending`  
- Free forever Accept/Deny  
- **Blocked on:** license commercial decision  
- **Verify:** test mode checkout upgrades cap 10 → 50  

### Phase 9 — Domain
- Subdomain CNAME `cname.zocomputer.io`  
- Prefer public HTTP service at **root** (not only `/notary/`)  
- Update OAuth origins  
- Export journals before origin switch  
- **Verify:** intake + backup on new origin; document migration  

---

## 15. Global regression suite (run before any ship)

### Automated
```bash
cd /home/workspace/Projects/Notary-log
bash scripts/test-intake-isolation.sh "https://zo-reverse-proxy-sillyhippy.zocomputer.io/notary"
cd artifacts/notary-journal && pnpm test
# build
cd /home/workspace/Projects/Notary-log && pnpm --filter @workspace/notary-journal... run build
# or build:proxy for BASE_PATH
```

### Manual core journal (must not break)
- [ ] New single entry complete  
- [ ] Signing appointment Complete (regression for `validateSigningAppointmentForComplete` import)  
- [ ] Print Journal PDF  
- [ ] PIN lock / unlock  
- [ ] Draft save  

### Manual multi-notary MVP
- [ ] Register A & B  
- [ ] Distinct branding  
- [ ] Cross-queue invisible  
- [ ] Cap at 10  
- [ ] Accept → draft  
- [ ] Deny → gone  
- [ ] Backup/restore A  

---

## 16. Deploy checklist

### Local Zo only (default until OK)
```bash
cd /home/workspace/Projects/Notary-log
# build for proxy path if serving via reverse proxy:
pnpm --filter @workspace/notary-journal... run build
# if package script build:proxy exists:
# bun run build:proxy
supervisorctl -s http://127.0.0.1:29011 restart notary-log
curl -sS -o /dev/null -w '%{http_code}\n' https://zo-reverse-proxy-sillyhippy.zocomputer.io/notary/
```

**Verify:** new JS hash in HTML if UI changed; hard refresh mobile.

### GitHub `main` / public Worker
- [ ] Joseph explicit **push OK**  
- [ ] Feature complete or clearly stable  
- [ ] Isolation tests green  
- [ ] Know Worker **lacks** full Zo SQLite unless hybrid — document Worker = static + Web3Forms only until Zo domain product  

---

## 17. Open questions (resolve in Phase 0)

| # | Question | Default if unanswered |
|---|----------|------------------------|
| 1 | Platform shared Web3Forms key for free notaries, or require each notary's own key? | **Own key for email**; queue works without email |
| 2 | Accept only → new draft, or also “add to appointment”? | **Draft only** |
| 3 | Soft vs hard pending cap? | **Hard 429** |
| 4 | Register API on public Worker? | **Zo-only** |
| 5 | Commercial license before Stripe? | **Required before Phase 8 public** |
| 6 | Server-side Web3Forms notify (Phase 3) vs client-only? | **Server-side after Zo POST** |

---

## 18. Definition of done (MVP)

MVP is **done** when all are true on Zo reverse-proxy:

1. **Self-serve:** New notary creates intake link in-app without Joseph.  
2. **Branding + fields:** Editor changes reflect on public form.  
3. **Isolation:** Two tokens cannot see each other's submissions, config, or backups.  
4. **Accept/Deny:** Works; Deny deletes PII.  
5. **Pending cap:** 11th request 429 with clear UI.  
6. **Email:** Optional; failure doesn't block intake.  
7. **Zo backup:** Upload + list + one-click restore for that token.  
8. **Regression:** Single-entry + signing appointment Complete still work.  
9. **Tests:** Isolation script + unit tests green.  
10. **Docs:** This plan + DEPLOYMENT/privacy updated.  
11. **No unauthorized main push.**

---

## 19. Suggested execution cadence

| Day | Focus |
|-----|--------|
| 1 | Phase 0 + Phase 1.1–1.4 |
| 2 | Phase 1.5–1.7 + start Phase 2 |
| 3 | Phase 2 complete |
| 4 | Phase 3 |
| 5 | Phase 4 + Phase 5 start |
| 6 | Phase 5 finish + Phase 6 |
| 7 | Buffer QA / fixes |

Adjust freely; **never skip isolation verification.**

---

## 20. Resume commands (copy-paste)

```
Implement multi-notary intake per docs/MULTI-NOTARY-INTAKE-PLATFORM-PLAN.md — Phase 0
Implement multi-notary intake per docs/MULTI-NOTARY-INTAKE-PLATFORM-PLAN.md — Phase 1
Implement multi-notary intake per docs/MULTI-NOTARY-INTAKE-PLATFORM-PLAN.md — Phase 1 Task 1.5
Implement multi-notary intake per docs/MULTI-NOTARY-INTAKE-PLATFORM-PLAN.md — Phase 2 Task 2.3
```

After each task: run that task's **Verify** section and tick checkboxes in this file or a progress note.

---

## 21. Appendix — Minimal isolation script outline

`scripts/test-intake-isolation.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE="${1:?usage: $0 https://host/notary}"
reg() { curl -sS -X POST "$BASE/api/notary/register" -H 'Content-Type: application/json' -d "$1"; }
TA=$(reg '{"name":"Iso A","email":"iso-a@test"}' | jq -r .token)
TB=$(reg '{"name":"Iso B","email":"iso-b@test"}' | jq -r .token)
# create submission on A
SID=$(curl -sS -X POST "$BASE/api/intake" -H 'Content-Type: application/json' \
  -d "{\"key\":\"$TA\",\"signerFirstName\":\"X\",\"signerLastName\":\"Y\"}" | jq -r .submission_id)
# B must not read A
CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/intake?key=$TB&file=$SID")
test "$CODE" = "404" -o "$CODE" = "401"
# B list empty or without SID
curl -sS "$BASE/api/intake?key=$TB" | jq -e --arg id "$SID" '[.files[].name] | index($id) | not'
echo "ISOLATION OK"
```

Expand script as endpoints land (register must exist first — Phase 1).

---

*End of comprehensive plan. Implementation waits for explicit go + phase/task selection.*
