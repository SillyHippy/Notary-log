# Deploying the Notary Journal

This guide covers deploying the Notary Journal PWA to **Zo Computer**, **Cloudflare Workers**, **Netlify**, **Cloudflare Pages**, or **Hostinger**.

> Kept in sync with [README.md](README.md). After editing this file, run `node scripts/sync-readme-deploy.mjs` to update the README.

## Quick reference

| Host | Build command | Publish folder | Zo JSON backup API |
|---|---|---|---|
| Zo Computer | `bun run build` | `server.ts` serves `dist/public` | Yes — `Documents/Notary Journal/backups/` |
| Cloudflare Workers (git build) | `pnpm --filter @workspace/notary-journal... run build` | `node scripts/cloudflare-deploy.mjs --skip-build` | No — static PWA only |
| Netlify (git-connected) | `pnpm --filter @workspace/notary-journal... run build` | `artifacts/notary-journal/dist/public` | No — static PWA only |
| Netlify (drag-and-drop) | local build + zip `dist/public` | zip only | No |
| Cloudflare Pages (static) | build + `_redirects` in output | `dist/public` | No |

**Node version on every host: `22` where configurable.** On Zo, use Bun with the committed `server.ts` and `zosite.json`.

---

## Option 1 - Zo Computer (easiest self-host path)

Use this when you want Zo to handle the deploy steps for you. Zo gives every free-plan user 100GB of storage and one hosted service, but the free computer can sleep when idle and has limited CPU/memory. That is fine for a personal notary journal, but not ideal for always-on background automation.

After deployment, Zo MUST output:

1. **Public App URL**: `https://notary-journal-{your-handle}.zocomputer.io`
2. **Backup API URL**: `https://notary-journal-{your-handle}.zocomputer.io/api/backup`
3. **Backup Key**: Generated secret token
4. **Backup Storage**: `Documents/Notary Journal/backups/`

Without these outputs, Backup & Restore won't work.

**Stamp fee:** Settings → **Stamp fee (per notarial act)** sets the per-stamp rate used on new entries (`# of stamps × rate`).

**Require ID photo:** Settings → **Journal Compliance → Require ID front photo** forces a front-of-ID capture before completing an entry (including after barcode scan).

### Step 1 - Sign up

Sign up with the project referral link: [https://zo-computer.cello.so/XvrzHZZ53TV](https://zo-computer.cello.so/XvrzHZZ53TV)

### Step 2 - Clone it

Open your Zo terminal and run:

```bash
git clone https://github.com/SillyHippy/Notary-log
```

### Step 3 - Install and build

Go into the folder, install dependencies, and build the app:

```bash
cd Notary-log
bun install
bun run build
```

### Step 4 - Publish it

The repo includes `server.ts` and `zosite.json` for Zo. Ask Zo to publish the configured HTTP service, or run `bun run prod` after `bun run build`. The server serves `artifacts/notary-journal/dist/public`, handles `/api/backup`, and falls back to `index.html` for deep links.

Zo should run the service from this repository root, not from a copy in `Trash` or a duplicated `notary-log` folder. `server.ts` listens on Zo's `PORT` environment variable automatically.

The app and backup API run together in this one service. Do not create a second service or separate Zo Space API route.

If you want Zo to do the setup for you, paste a prompt like this:

```text
Deploy the Notary Journal app for me on Zo using the free plan.

Use this repository:
https://github.com/SillyHippy/Notary-log

Please do all of this:

1. Clone the repo.
2. Use Bun.
3. From the repo root, run:
   bun install
   bun run build
4. Use the repository's zosite.json publish block, or publish the root HTTP service with:
   bun run prod
5. The production server is server.ts. It serves artifacts/notary-journal/dist/public and falls back to index.html for single-page app routes.
6. Make the site public.
7. Use the built-in /api/backup route from server.ts. Do not create a second service or Zo Space API route.
8. Store backup files in Documents/Notary Journal/backups/.
9. Protect /api/backup with the generated backup key printed by bun run prod.
10. Add CORS support so the public app can call the Zo Space API from the browser:
    - allow methods: GET, POST, OPTIONS
    - allow headers: Authorization, Content-Type
    - return Access-Control-Allow-Origin for the app URL, or use * if Zo requires a simpler setup
11. Make OPTIONS /api/backup return the CORS headers for preflight requests.
12. Make GET /api/backup list files and return JSON like:
    { "files": [{ "name": "notary-journal-backup-2026-05-13.json", "modifiedTime": "2026-05-13T18:00:00.000Z", "size": 12345 }] }
13. Make POST /api/backup save a new backup. The app will send JSON like:
    { "filename": "notary-journal-backup-2026-05-13.json", "backup": { "...": "backup payload" } }
    Return JSON like:
    { "name": "notary-journal-backup-2026-05-13.json" }
14. Make GET /api/backup?file=filename.json download that backup for restore by returning the raw backup JSON.
15. Reject requests without Authorization: Bearer <backup-key>.
16. Do not publish the backup folder with zo.pub.
17. I will open Settings -> Backup & Restore, turn on Show Zo backup, then paste the same-service backup API URL and backup key into Zo Backup.
18. When finished, tell me:
    - the public app URL, which should look like [site-name]-[my-zo-handle].zocomputer.io
    - the backup API URL, which should look like [public-app-url]/api/backup
    - where the backup files are stored

Keep this free-tier friendly: one app site/service, simple file storage, no always-on paid automation required.
```

If Zo asks for a hosting type, use a public **HTTP service**. The committed `zosite.json` publish block uses `bun run prod`, which starts `server.ts`.

Important for AI deployers: do not replace the app's encrypted browser storage with a plaintext server file such as `/home/workspace/notary-data.json`. The Zo integration is for hosting the app and storing explicit JSON backups made from inside the app.

### Step 5 - Complete app setup

Open the Zo site URL and complete the in-app PIN setup.

### Optional direct Google Drive backup

Direct in-app Google Drive backup still requires a Google OAuth client ID. If you want it on the Zo-hosted app, set `VITE_GOOGLE_CLIENT_ID` before the build and add the final Zo site URL to **Authorized JavaScript origins** in Google Cloud Console.

If you do not want to touch Google Cloud Console, skip `VITE_GOOGLE_CLIENT_ID`. The app still works, and you can use the Zo backup workflow below.

### Step 6 - Back up and restore with Zo

The journal data lives in the browser's IndexedDB, not automatically inside Zo storage. Zo cannot back up that browser database by itself. You must create a backup from inside the app first.

To use the in-app Zo backup:

1. Open the deployed app.
2. Go to **Settings -> Backup & Restore** and turn on **Show Zo backup**.
3. Paste the backup API URL and backup key from Zo.
4. Click **Test Connection**.
5. Click **Backup to Zo**.
6. Optional: ask Zo to copy `Documents/Notary Journal/backups/` to your connected Google Drive.

To restore with the in-app Zo backup:

1. Open the deployed app on the target device or domain.
2. Go to **Settings -> Backup & Restore** and turn on **Show Zo backup**.
3. Click **Restore from Zo**.
4. Pick a backup file and confirm the restore.

Manual backup still works: use **Settings -> Data & Export -> Export JSON**, store the file in Zo, then use **Import from JSON file** to restore.

### Optional Zo automation idea

After each manual export, you can ask Zo to organize and mirror backups:

```text
Whenever I upload a file named notary-journal*.json to my Notary Journal Backups folder, keep the newest copy there and copy it to my connected Google Drive backup folder.
```

This is a Zo-side file automation. It does not replace the app's export/import flow, and it does not give the app one-click Google Drive OAuth.

### Step 7 - Backup API is built into the same service

The Zo backup connector runs inside the same public HTTP service at `/api/backup`. Do not create a second service or separate Zo Space API route.

Use this route contract:

| Method | Behavior |
|---|---|
| `GET /api/backup` | List files. |
| `POST /api/backup` | Save new backup. |
| `GET /api/backup?file=filename.json` | Download one backup file for restore. |

Store files in:

```text
Documents/Notary Journal/backups/
```

Because the app service is public, `/api/backup` requires `Authorization: Bearer <backup-key>` before listing, saving, or downloading backups. `server.ts` prints the generated backup key when `bun run prod` starts.

The app's **Settings -> Backup & Restore -> Show Zo backup** section uses this API URL and backup key for one-click backup and restore. This API is not required for manual JSON export/import.

Do not store live journal data in a plaintext server file. Backup files are created only when the user clicks **Backup to Zo** or manually exports JSON.

### Step 8 - Done

Your app is live at `[site-name]-[your-zo-handle].zocomputer.io`.

Backup is at `[public-app-url]/api/backup`.

Open your Zo site URL, unlock the app with your PIN, and make a test JSON backup so you know restore is ready before you start using the journal.

### Optional - Create a Zo helper

After Zo deploys the app, you can paste this prompt into Zo so it remembers how to maintain the deployment and backup route:

```text
Create a Notary Journal helper for this Zo computer.

Your job is to help me deploy, update, repair, and verify the Notary Journal app and its Zo backup API.

You may:
- clone or update https://github.com/SillyHippy/Notary-log
- run the build commands from the README
- publish the built app as a public Zo Site or HTTP service
- create or repair /api/backup
- verify GET /api/backup lists files
- verify POST /api/backup saves a backup
- verify backups are stored in Documents/Notary Journal/backups/
- help copy backup files to connected storage only if I ask

Safety rules:
- keep /api/backup protected with the backup key
- do not publish backup files with zo.pub
- do not read, summarize, modify, expose, or delete backup contents unless I explicitly ask and confirm
- before changing the app or backup route, tell me what you are about to change and why

When something breaks, check the build output, public app URL, /api/backup route, CORS headers, backup key, and backup folder path.
```

### Zo limitations to tell users

- Free Zo computers can sleep when idle, so scheduled automations may not behave like an always-on server.
- Free Zo accounts include one hosted service. Use one Site/service for the app unless you upgrade.
- Public HTTP services are reachable by anyone with the URL. The app still protects journal access with the in-app PIN, but do not put backup JSON files in a public site folder or `zo.pub`.
- Zo snapshots protect the Zo computer state, not the browser's local IndexedDB on every device. Keep JSON backups.
- Direct browser-to-Google-Drive backup still uses `VITE_GOOGLE_CLIENT_ID` and Google Cloud Console.

---

## Option 2 - Netlify drag-and-drop (no GitHub needed)

Use this when you just want to upload a finished build by hand. No git connection, no CI.

### Build the zip

In the Replit workspace shell (or any machine with the project cloned and `pnpm install` run), from the **repo root**:

```bash
# 1. Set the Google OAuth client ID FIRST — this gets baked into the build.
#    Skip this line only if you don't need Google Drive backup on the deployed site.
export VITE_GOOGLE_CLIENT_ID="your-client-id-here.apps.googleusercontent.com" 

# 2. Build the app.
pnpm --filter @workspace/notary-journal run build

# 3. Add the Netlify drag-and-drop SPA redirect file.
echo '/*    /index.html   200' > artifacts/notary-journal/dist/public/_redirects

# 4. Zip the *contents* of dist/public into a file at the repo root.
( cd artifacts/notary-journal/dist/public && zip -r ../../../../notary-journal-netlify.zip . )
```

The output is `notary-journal-netlify.zip` at the repo root. **The zip must contain the contents of `dist/public` at its top level** (so `index.html` is at the root of the zip), not the `dist/public` folder itself. Otherwise Netlify will serve nothing and show "Page not found." If your shell doesn't have the `zip` command, install it (`apt-get install zip`, `brew install zip`) or run the build inside Replit, where the agent can package the zip for you.

The `_redirects` file is mandatory for Netlify drag-and-drop. It tells Netlify to send every URL (including deep links like `/journal` and `/entry/abc-123`) to `index.html` so the React Router (wouter) can handle the route. It is generated in the build output before zipping. Without it, refreshing the page on any non-root URL returns a 404.

**About `VITE_GOOGLE_CLIENT_ID` for drag-and-drop:** this value is baked into the JavaScript bundle at build time. Drag-and-drop deploys upload pre-built files, so Netlify's dashboard environment variables are **ignored** for this flow — the variable must be set in your shell *before* `pnpm run build` runs (step 1 above). If you forget, the Cloud Backup section in Settings will show "not enabled" on the deployed site, and you'll need to rebuild and re-upload.

> **Shortcut in Replit:** if the agent is available, just say *"rebuild the Netlify zip"* and it will do all of the above (using the workspace's `VITE_GOOGLE_CLIENT_ID` secret) and hand you the file.

### Upload

1. Open Netlify → click your site (or **Add new site → Deploy manually** for a brand new one).
2. Click the **Deploys** tab.
3. Scroll to the dashed drop zone labeled **"Need to update your site? Drag and drop your site output folder here."**
4. Drag `notary-journal-netlify.zip` onto it (mobile: tap the zone and pick the file).
5. Wait ~10 seconds. Status goes Uploading → Processing → Published.

Then add your deployed URL to Google Cloud Console as described in [Authorize the new domain](#2-authorize-the-new-domain-in-google-cloud-console). You do **not** need to set environment variables in the Netlify dashboard for the drag-and-drop flow — the Google client ID was already baked into the bundle in step 1 of the build.

---

## Option 3 - Netlify git-connected (auto-build on push)

Use this when you want every commit to GitHub (or other git provider) to redeploy automatically.

The repo already includes `netlify.toml` at the root, which is the source of truth for git-connected builds. You don't need to configure build commands or publish directories in the Netlify UI — Netlify reads them from `netlify.toml`:

### Connect

1. Push the repo to GitHub (or GitLab/Bitbucket).
2. Netlify → **Add new site → Import an existing project** → pick the provider → pick the repo.
3. Accept the defaults Netlify suggests (it reads them from `netlify.toml`).
4. Click **Deploy site**. First build takes 2–4 minutes.
5. After deploy, open the site and complete **Settings** (notary profile, Google Drive if used).

Then set environment variables and Google OAuth origins as in [Shared setup](#shared-setup).

> **Drag-and-drop** and **git-connected** Netlify deploys are equivalent for this app: static PWA + SPA redirect. Zo backup (`/api/backup`) is only on Zo (`server.ts`).

To re-link an existing Netlify site to a git repo (instead of replacing it), go to **Site settings → Build & deploy → Continuous deployment → Link site to Git**. Same URL, no broken bookmarks.

---

## Option 4 - Cloudflare Workers (`wrangler deploy`)

Use this when deploying the PWA on Cloudflare Workers static assets (free tier).

The repo includes `wrangler.toml` and `cloudflare/worker.ts`. The worker serves the built PWA only.

Cloudflare Workers does **not** use the Netlify-style `_redirects` file for this app. `not_found_handling = "single-page-application"` is the Workers-compatible SPA fallback.

**Cloudflare Workers build settings** (Workers & Pages → your worker → Settings → Build):

| Field | Value |
|-------|--------|
| **Path** | *(leave empty — repo root)* |
| **Build command** | `pnpm --filter @workspace/notary-journal... run build` |
| **Deploy command** | `node scripts/cloudflare-deploy.mjs --skip-build` |
| **Non-production deploy** | Same as deploy, or leave blank |

Do **not** set Path to `artifacts/notary-journal/dist/public` (that causes “root directory not found”). Assets path is in `wrangler.toml`.

Or a single local/CI step: `node scripts/cloudflare-deploy.mjs` (build + deploy).

**Local deploy** (after `npx wrangler login`):

```bash
pnpm run deploy:cloudflare
```

### Verify

Open your `*.workers.dev` URL and confirm the journal loads. Zo backup (`/api/backup`) is **not** on Cloudflare — use JSON export/import or deploy on Zo for server backups.

---

## Option 5 - Cloudflare Pages

Cloudflare Pages reads the same `_redirects` file syntax Netlify uses, so the SPA routing setup is similar — but Cloudflare Workers (`wrangler deploy`) rejects this rule for this app. Only generate `_redirects` inside the Pages build output when you are deploying to Cloudflare Pages.

### Configure the Pages build

1. Push the repo to GitHub or GitLab.
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick the repo. Configure the build:
   - **Framework preset**: None (or "Vite" if listed — both work).
   - **Build command**:
     ```bash
     pnpm --filter @workspace/notary-journal... run build && echo '/*    /index.html   200' > artifacts/notary-journal/dist/public/_redirects
     ```
   - **Build output directory**: `artifacts/notary-journal/dist/public`
   - **Root directory**: leave blank (the repo root is correct).
4. Under **Environment variables (build)**, set:
   - `NODE_VERSION` = `22`
   - `VITE_GOOGLE_CLIENT_ID` = your Google OAuth client ID (see [Shared setup](#shared-setup))
5. Click **Save and Deploy**. First build takes 2–4 minutes.

> If you skip the generated `_redirects` step on Cloudflare Pages, the home page will load but refreshing on `/journal` or any deep link can return a 404.

---

## Option 6 - Hostinger (or standard Shared Hosting)

Hostinger typically uses Apache or LiteSpeed web servers. The build process is identical to Netlify drag-and-drop, but instead of a `_redirects` file, you need an `.htaccess` file to handle the SPA (Single Page Application) routing.

### Build and Package

1. Run the build locally exactly as you would for Netlify:
   ```bash
   export VITE_GOOGLE_CLIENT_ID="your-client-id-here.apps.googleusercontent.com" 
   pnpm --filter @workspace/notary-journal run build
   ```
2. Create an `.htaccess` file inside the build output folder (`artifacts/notary-journal/dist/public/.htaccess`) with these contents:
   ```apache
   <IfModule mod_rewrite.c>
     RewriteEngine On
     RewriteBase /
     RewriteRule ^index\.html$ - [L]
     RewriteCond %{REQUEST_FILENAME} !-f
     RewriteCond %{REQUEST_FILENAME} !-d
     RewriteRule . /index.html [L]
   </IfModule>
   ```
   *This ensures deep links like `/journal` don't return a 404 error.*
3. Zip the **contents** of `artifacts/notary-journal/dist/public` (make sure `.htaccess` is included in the zip).

### Upload to Hostinger

1. Log into Hostinger and open your site's **File Manager** (or connect via FTP).
2. Navigate to your public web directory (usually `public_html`).
3. Upload the zip file you created and extract it directly into `public_html` (so that `index.html` and `.htaccess` are sitting directly inside `public_html`).
4. Follow the steps in [Shared setup](#shared-setup) below to authorize your new Hostinger domain in Google Cloud Console.

---

## Shared setup

These two steps are required only if you want direct in-app Google Drive backup. If you are using the Zo backup workflow with JSON files only, you can skip this entire section.

### 1. Set the `VITE_GOOGLE_CLIENT_ID` environment variable

This is the Google OAuth client ID that powers the **Cloud Backup** feature (Drive backup/restore). Without it, the Cloud Backup section in Settings shows a "not enabled" message and Drive features are hidden. Everything else in the app still works.

| Host | Where to set it |
|---|---|
| Zo Computer | Ask Zo to set `VITE_GOOGLE_CLIENT_ID` before running the production build |
| Netlify | Site settings → Build & deploy → Environment → Add a variable |
| Cloudflare Pages | Settings → Environment variables → **Production** (and Preview if you want) |

> **Important:** `VITE_GOOGLE_CLIENT_ID` is a **build-time** variable. The value is baked into the JavaScript bundle when the site is built — it's not read at runtime. If you change it, you must trigger a fresh build (push a commit, or in Netlify hit **Deploys → Trigger deploy → Deploy site**). Drag-and-drop deploys ignore the host's environment variables entirely; the value must already be set in the shell where you ran `pnpm run build`.

### 2. Authorize the new domain in Google Cloud Console

Google Sign-In refuses to run on domains it hasn't been told about. After your first deploy, get your live URL (e.g. `https://your-site.netlify.app` or `https://your-site.pages.dev`) and:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials**.
2. Click your OAuth 2.0 Client ID (the one whose ID matches `VITE_GOOGLE_CLIENT_ID`).
3. Under **Authorized JavaScript origins**, click **Add URI** and paste your full deployment URL **without a trailing slash** (e.g. `https://notarylog.netlify.app`).
4. Click **Save**.

Google takes anywhere from a few seconds to ~5 minutes to propagate the change. If you try Drive backup right after deploying and get an "origin not allowed" error, wait a couple minutes and try again.

If you have multiple deployment URLs (Replit + Netlify + Cloudflare + a custom domain), add **every one** to Authorized JavaScript origins.

---

## Post-deploy gotchas

### "It works in my Chrome tab but not in Incognito or other browsers"

This means Chrome is serving you a cached copy from a previous (working) deployment via the service worker, while other browsers are hitting the actual broken site. Fix the deployment first; then:

1. In Chrome: **Settings → Privacy and security → Site settings → All sites** → find your domain → **Clear & reset**.
2. Reload the page. Chrome will fetch the new version and install a fresh service worker.

### Future deploys auto-update

The service worker in `artifacts/notary-journal/public/sw.js` uses a versioned cache name (e.g. `notary-journal-v8`). When you change app behavior in a way that requires invalidating the old cache, bump that version before building. On the next visit, browsers detect the new version, drop the old cache, and serve the new bundle.

The service worker uses a **network-first strategy for HTML / navigation requests** and cache-first for hashed `/assets/*` files. That means a fresh deploy is picked up on the very next page load — even returning visitors aren't served a stale shell — as long as their network reaches the host. Cached hashed assets get re-validated on each visit and replaced when their filename changes (which happens automatically for every Vite build).

The build output also includes a `_headers` file telling Netlify (and Cloudflare Pages, which uses the same syntax) to:

- never cache `index.html` or `sw.js` (`Cache-Control: no-cache, no-store, must-revalidate`), and
- cache `/assets/*` aggressively for one year (`public, max-age=31536000, immutable`), since their filenames are content-hashed.

This is the host-level safety net that backs up the service worker. If you delete `_headers` you lose that guarantee and may see returning visitors get stuck on an old build for hours.

> **Recovering from a bad deploy that the SW already cached:** the agent's standard rebuild bumps `CACHE_NAME` automatically, so just push or drag-drop a new zip and existing visitors will pick it up on next load. As a last resort, users can also open Settings → Danger Zone → **Reset journal** to wipe local state and force a fresh fetch (note: this also deletes their entries — only use if backed up).

### Local data does NOT sync between domains

The journal stores all entries in **IndexedDB**, which is **per-domain** in the browser. Visiting the app on `your-app.replit.app` and on `your-app.netlify.app` gives you two completely separate journals. There is no automatic sync between them.

To move entries between domains:

- **Google Drive backup** (Settings → Cloud Backup → Backup now) on the source domain, then **Restore** on the destination domain. This is the easiest way for ongoing use.
- Or **Export** as JSON from the source (Settings → Export all → JSON) and **Import** on the destination.

CSV and PDF exports are read-only — they can't be re-imported back into another instance.

---

## Reference: how this all fits together

- `netlify.toml` — git-connected Netlify config (build + SPA redirect). Ignored by drag-and-drop.
- `wrangler.toml` + `cloudflare/worker.ts` — Cloudflare Workers static assets + SPA fallback.
- `server.ts` — Zo host: static PWA + `/api/backup` JSON backups.
- `_redirects` file inside the publish folder — SPA fallback for Netlify drag-and-drop and Cloudflare Pages only. Do not commit it under `artifacts/notary-journal/public/` for this repo, because `wrangler deploy` rejects the Netlify-style rule.
- `vite.config.ts` — base path defaults to `/`. Don't override `BASE_PATH` for Netlify or Cloudflare deploys; both serve from the domain root.
- `artifacts/notary-journal/public/sw.js` — service worker; bump `CACHE_NAME` to force-invalidate user caches. Network-first for HTML, cache-first for hashed `/assets/*`.
- `_headers` file inside the publish folder — host-level cache rules. Honored by both Netlify and Cloudflare Pages. Tells the CDN never to cache `index.html` / `sw.js` and to cache `/assets/*` for a year. Committed in `artifacts/notary-journal/public/_headers`, then copied into the build output by Vite.
- `replit.md` — workspace overview; lists `VITE_GOOGLE_CLIENT_ID` and other notary-journal config.
