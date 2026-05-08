# Deploying the Notary Journal

This guide covers deploying the Notary Journal PWA to **Netlify**, **Cloudflare Pages**, or **Hostinger**.

## Quick reference

| Host | Build command | Publish folder | SPA redirects |
|---|---|---|---|
| Netlify (git-connected) | `pnpm --filter @workspace/notary-journal... run build` | `artifacts/notary-journal/dist/public` | `netlify.toml` (already in repo) |
| Netlify (drag-and-drop) | run locally: `pnpm --filter @workspace/notary-journal run build` | zip the contents of `artifacts/notary-journal/dist/public` | `_redirects` file inside the zip |
| Cloudflare Pages | `pnpm --filter @workspace/notary-journal... run build` | `artifacts/notary-journal/dist/public` | `_redirects` file in publish folder |

**Node version on every host: `22`.**

---

## Option 1 — Netlify drag-and-drop (no GitHub needed)

Use this when you just want to upload a finished build by hand. No git connection, no CI.

### Build the zip

In the Replit workspace shell (or any machine with the project cloned and `pnpm install` run), from the **repo root**:

```bash
# 1. Set the Google OAuth client ID FIRST — this gets baked into the build.
#    Skip this line only if you don't need Google Drive backup on the deployed site.
export VITE_GOOGLE_CLIENT_ID="your-client-id-here.apps.googleusercontent.com" 

# 2. Build the app.
pnpm --filter @workspace/notary-journal run build

# 3. Add the SPA redirect rule + cache-control headers into the build output.
echo '/*    /index.html   200' > artifacts/notary-journal/dist/public/_redirects
cat > artifacts/notary-journal/dist/public/_headers <<'EOF'
/index.html
  Cache-Control: no-cache, no-store, must-revalidate

/sw.js
  Cache-Control: no-cache, no-store, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable
EOF

# 4. Zip the *contents* of dist/public into a file at the repo root.
( cd artifacts/notary-journal/dist/public && zip -r ../../../../notary-journal-netlify.zip . )
```

The output is `notary-journal-netlify.zip` at the repo root. **The zip must contain the contents of `dist/public` at its top level** (so `index.html` is at the root of the zip), not the `dist/public` folder itself. Otherwise Netlify will serve nothing and show "Page not found." If your shell doesn't have the `zip` command, install it (`apt-get install zip`, `brew install zip`) or run the build inside Replit, where the agent can package the zip for you.

The `_redirects` file is mandatory. It tells Netlify to send every URL (including deep links like `/journal` and `/entry/abc-123`) to `index.html` so the React Router (wouter) can handle the route. Without it, refreshing the page on any non-root URL returns a 404.

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

## Option 2 — Netlify git-connected (auto-build on push)

Use this when you want every commit to GitHub (or other git provider) to redeploy automatically.

The repo already includes `netlify.toml` at the root, which is the source of truth for git-connected builds. You don't need to configure build commands or publish directories in the Netlify UI — Netlify reads them from `netlify.toml`:

```toml
[build]
  base = "."
  command = "pnpm --filter @workspace/notary-journal... run build"
  publish = "artifacts/notary-journal/dist/public"

[build.environment]
  NODE_VERSION = "22"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Connect

1. Push the repo to GitHub (or GitLab/Bitbucket).
2. Netlify → **Add new site → Import an existing project** → pick the provider → pick the repo.
3. Accept the defaults Netlify suggests (it reads them from `netlify.toml`).
4. Click **Deploy site**. First build takes 2–4 minutes.

Then set environment variables and Google OAuth origins as in [Shared setup](#shared-setup).

To re-link an existing Netlify site to a git repo (instead of replacing it), go to **Site settings → Build & deploy → Continuous deployment → Link site to Git**. Same URL, no broken bookmarks.

---

## Option 3 — Cloudflare Pages

Cloudflare Pages reads the same `_redirects` file syntax Netlify uses, so the SPA routing setup is identical — but unlike Netlify, the redirect rule has to live inside the build output (Cloudflare doesn't read `netlify.toml`). Do the one-time setup *before* the first deploy or your first deep-link refresh will 404.

### Step 1 — Add the SPA redirect file (one-time, before first deploy)

Run this once from the repo root, then commit:

```bash
mkdir -p artifacts/notary-journal/public
echo '/*    /index.html   200' > artifacts/notary-journal/public/_redirects
git add artifacts/notary-journal/public/_redirects
git commit -m "Add SPA redirects for Netlify and Cloudflare Pages builds"
git push
```

Vite copies anything in `public/` straight into `dist/public/`, so the file lands at `dist/public/_redirects` on every build automatically. The same file works on Netlify, so this is also helpful for Netlify drag-and-drop deploys (you can skip the manual `echo` step in Option 1 once this is committed).

> If you skip this step, the home page will load on Cloudflare but refreshing on `/journal` or any deep link returns a 404.

### Step 2 — Connect to Cloudflare Pages

1. Push the repo to GitHub or GitLab (with the `_redirects` file from Step 1 included).
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick the repo. Configure the build:
   - **Framework preset**: None (or "Vite" if listed — both work).
   - **Build command**: `pnpm --filter @workspace/notary-journal... run build`
   - **Build output directory**: `artifacts/notary-journal/dist/public`
   - **Root directory**: leave blank (the repo root is correct).
4. Under **Environment variables (build)**, set:
   - `NODE_VERSION` = `22`
   - `VITE_GOOGLE_CLIENT_ID` = your Google OAuth client ID (see [Shared setup](#shared-setup))
5. Click **Save and Deploy**. First build takes 2–4 minutes.

---

## Option 4 — Hostinger (or standard Shared Hosting)

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

These two steps are required regardless of which host you pick.

### 1. Set the `VITE_GOOGLE_CLIENT_ID` environment variable

This is the Google OAuth client ID that powers the **Cloud Backup** feature (Drive backup/restore). Without it, the Cloud Backup section in Settings shows a "not enabled" message and Drive features are hidden. Everything else in the app still works.

| Host | Where to set it |
|---|---|
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

- `netlify.toml` — git-connected Netlify config. Read by Netlify, ignored by drag-and-drop and by Cloudflare.
- `_redirects` file inside the publish folder — SPA fallback. Honored by both Netlify (when there's no `netlify.toml` redirects rule) and Cloudflare Pages.
- `vite.config.ts` — base path defaults to `/`. Don't override `BASE_PATH` for Netlify or Cloudflare deploys; both serve from the domain root.
- `artifacts/notary-journal/public/sw.js` — service worker; bump `CACHE_NAME` to force-invalidate user caches. Network-first for HTML, cache-first for hashed `/assets/*`.
- `_headers` file inside the publish folder — host-level cache rules. Honored by both Netlify and Cloudflare Pages. Tells the CDN never to cache `index.html` / `sw.js` and to cache `/assets/*` for a year. Generated by the agent's "rebuild the Netlify zip" flow.
- `replit.md` — workspace overview; lists `VITE_GOOGLE_CLIENT_ID` and other notary-journal config.
