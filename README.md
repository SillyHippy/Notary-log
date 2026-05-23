# Notary Journal

A fast Progressive Web App (PWA) for modern notaries: offline support, local encryption, ID scanning, signatures, and print-ready journal PDFs.

> [!WARNING]
> **STRICT NON-COMMERCIAL LICENSE**
> This software is **100% free to deploy for personal use** but **may NOT be sold, monetized, or used for commercial purposes** under any circumstances. See [LICENSE](LICENSE) for full terms governed by Oklahoma law. Unauthorized commercial use carries liquidated damages of $50,000+ per violation.

---

## Quick Start (2 minutes)

Get the app running on your computer in under 2 minutes.

**Prerequisites:** You need [Git](https://git-scm.com) and [pnpm](https://pnpm.io) installed. pnpm is a fast package manager — install it with `npm install -g pnpm` if you have Node.js, or follow the [pnpm install guide](https://pnpm.io/installation).

```bash
# 1. Clone the repository
git clone https://github.com/SillyHippy/Notary-log

# 2. Enter the project directory
cd Notary-log

# 3. Install all dependencies (downloads the libraries the app needs)
pnpm install

# 4. Build the app (compiles the source code into optimized production files)
pnpm run build

# 5. Start the development server
cd artifacts/notary-journal && pnpm run dev
```

Open your browser to `http://localhost:5173`. You should see the Notary Journal login screen (PIN setup). If you do, it's working.

---

## Deployment Options

Choose **one** option below. Each one produces a live URL you can open from any device.

| Option | Best For | Server Backup | Difficulty |
|--------|----------|---------------|------------|
| [Zo Computer](#option-1-zo-computer-recommended) | All-in-one hosting + backup | Yes (built-in) | Easy |
| [Cloudflare Workers](#option-2-cloudflare-workers) | Fast global CDN, free tier | No | Medium |
| [Netlify Drag-and-Drop](#option-3-netlify-drag-and-drop) | Quick manual deploy, no git | No | Easy |
| [Netlify Git-Connected](#option-4-netlify-git-connected) | Auto-deploy on every commit | No | Easy |
| [Cloudflare Pages](#option-5-cloudflare-pages) | Git-connected with `_redirects` | No | Medium |
| [Hostinger / Shared Hosting](#option-6-hostinger--shared-hosting) | Traditional web hosting | No | Easy |

**Important:** Only **Zo Computer** includes the server-side backup API (`/api/backup`) and multi-user Zo intake (`/api/intake` with SQLite). Cloudflare, Netlify, and static hosts use Web3Forms for client intake only.

---

## Option 1: Zo Computer (Recommended)

Zo gives you a free computer with 100GB storage, one hosted service, and built-in backup. This is the easiest path because the backup API runs in the same service.

**What you'll end up with:**
- Public app URL: `https://notary-log-{your-handle}.zocomputer.io`
- Backup API: `https://notary-log-{your-handle}.zocomputer.io/api/backup`
- Client intake: Zo token link or Web3Forms fallback (same service)
- Backups stored on the server in `Documents/Notary Journal/backups/`
- Optional: Google Drive backup in Settings (only if configured **before** `bun run build` — see below)

### Google Drive backup and Zo environment variables

Google Drive uses `VITE_GOOGLE_CLIENT_ID`. That value is **baked into the app during `bun run build`**, not read when the server starts.

| Where you set it | Enables Google Drive? |
|------------------|------------------------|
| Zo Advanced → environment variables **before** build, **and** written to `artifacts/notary-journal/.env` (or exported in the shell) **before** `bun run build` | Yes |
| Zo Advanced only, after deploy, with no rebuild | **No** — Settings will show “Contact the app administrator” |
| Skipped at deploy | No — use the **Enable Google Drive later** prompt below when ready |

You can use **Zo backup**, **Google Drive**, or **both**. Zo intake and backup are unrelated to this step.

If you use Google OAuth, add your Zo app URL (e.g. `https://notary-log-{your-handle}.zocomputer.io`) under **Authorized JavaScript origins** in [Google Cloud Console](https://console.cloud.google.com/apis/credentials).

### Step 1: Clone the repo

```bash
cd /home/workspace
git clone https://github.com/SillyHippy/Notary-log
cd Notary-log
```

### Step 2: Install and build

```bash
bun i
bun run build
```

### Step 3: Remove an old Zo deployment (optional)

If Notary-log is already on this Zo Computer, paste this in Zo AI chat first:

```
Remove the Notary Journal deployment from this Zo Computer.

1. list_user_services — find any service with label "notary-log" (or entrypoint containing "Notary-log" or "server.ts" for notary).
2. For each match: delete_user_service(service_id=<id>)
3. list_user_services again — confirm notary-log is gone.
4. Do NOT delete Documents/Notary Journal unless I explicitly say "delete all notary data".
5. Report which service_id was deleted.
```

### Step 4: Deploy as a Zo service

In your Zo AI chat, paste this **entire** prompt (one block). Replace `{my-handle}` with your Zo handle (or ask Zo to use your real handle in URLs):

```
Deploy Notary Journal on this Zo Computer from scratch. Follow every step in order.

REPO: /home/workspace/Notary-log
GITHUB: https://github.com/SillyHippy/Notary-log
SERVICE LABEL: notary-log

A. PREP
1. cd /home/workspace
2. If Notary-log exists: cd Notary-log && git pull
   Else: git clone https://github.com/SillyHippy/Notary-log && cd Notary-log
3. pwd must be /home/workspace/Notary-log

B. BUILD (read Google note in README before this section)

If I want Google Drive backup on this deploy:
- Read VITE_GOOGLE_CLIENT_ID from Zo Advanced environment variables (or ask me for the value).
- Write artifacts/notary-journal/.env containing exactly:
  VITE_GOOGLE_CLIENT_ID=<that value>
- Zo Advanced env alone does NOT enable Google Drive — it must be present for bun run build.

If I do NOT want Google Drive yet, skip the .env file and continue; I can enable it later with the README “Enable Google Drive later” prompt.

4. (Google Drive only) create or update artifacts/notary-journal/.env with VITE_GOOGLE_CLIENT_ID
5. bun i
6. bun run build — if this fails, stop and report the error

C. REMOVE OLD SERVICE
7. list_user_services
8. If label "notary-log" exists: delete_user_service(service_id=...)
9. Confirm notary-log is gone

D. REGISTER ONE SERVICE (do NOT set local_port)
10. register_user_service(
      label="notary-log",
      mode="http",
      entrypoint="bun run server.ts",
      workdir="/home/workspace/Notary-log",
      public=true
    )

E. VERIFY
11. Wait 15 seconds
12. cat /dev/shm/notary-log.log | tail -60
    Must include: "listening on", "Zo Backup Key", "Zo Intake Token"
13. curl -s https://notary-log-{my-handle}.zocomputer.io/api/health
14. service_doctor(service="notary-log")

F. REPORT TO ME
15. Public app URL
16. Exact Zo Backup Key from logs
17. Exact Zo Intake Token from logs (also in Documents/Notary Journal/.zo-intake-token)
18. Whether Google Drive was configured at build (yes/no)
19. Optional: set ZO_API_KEY in Zo Advanced for intake emails

G. IN THE APP
20. Open the public URL → Settings → paste Zo Backup Key → paste Zo Computer Form Token → Copy Intake Link → test /intake?key=<token>
21. If Google was configured at build: Settings → Cloud Backup should show “Connect Google Drive”, not “Contact the app administrator”
```

On first start with an empty database, the server **creates the notary user and intake token automatically** — no manual SQL. Optional runtime env on the Zo service: `NOTARY_NAME`, `NOTARY_EMAIL` (defaults: Primary Notary / notary@localhost).

### Step 5: Enable Google Drive backup later (Zo)

Use this if you **skipped Google at deploy** or only added `VITE_GOOGLE_CLIENT_ID` to Zo Advanced **after** the app was already built. You must **rebuild** — Zo Settings env vars do not update an existing build.

**1.** Add `VITE_GOOGLE_CLIENT_ID` in Zo Advanced (if not already there).

**2.** In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), add your app URL to **Authorized JavaScript origins** (e.g. `https://notary-log-{your-handle}.zocomputer.io`).

**3.** Paste this in Zo AI chat:

```
Enable Google Drive backup for Notary Journal on this Zo Computer.

REPO: /home/workspace/Notary-log

1. cd /home/workspace/Notary-log && git pull

2. Read VITE_GOOGLE_CLIENT_ID from Zo Advanced environment variables (or ask me to paste it).

3. Write artifacts/notary-journal/.env with exactly:
   VITE_GOOGLE_CLIENT_ID=<that value>
   (Zo Advanced env alone is not enough — this file must exist before build.)

4. bun run build — if this fails, stop and report the error

5. Restart the notary-log service (list_user_services → restart or re-register if needed)

6. Confirm in logs that the service is listening again

7. Tell me to hard-refresh the app in the browser, then check Settings → Cloud Backup:
   - Should show “Connect Google Drive”
   - Must NOT show “Contact the app administrator”
```

### Step 6: Google OAuth reference (manual)

Same as the “later” flow, without Zo chat — run on the Zo machine:

```bash
cd /home/workspace/Notary-log
# Use the same client ID as in Zo Advanced:
echo 'VITE_GOOGLE_CLIENT_ID=your-google-client-id-here.apps.googleusercontent.com' > artifacts/notary-journal/.env
bun run build
# Then restart the notary-log service
```

### Zo Limitations

- One HTTP service per account on free tier
- Backups stored on the server (encrypted)
- Google Drive requires `VITE_GOOGLE_CLIENT_ID` in `artifacts/notary-journal/.env` **before** `bun run build` (see [Google Drive backup and Zo environment variables](#google-drive-backup-and-zo-environment-variables) and [Enable Google Drive backup later](#step-5-enable-google-drive-backup-later-zo))

Extended troubleshooting: [docs/zo-computer-setup.md](docs/zo-computer-setup.md).

## Option 2: Cloudflare Workers

Deploy to Cloudflare's edge network. Free tier, fast globally. No server-side backup — use JSON export/import or Google Drive.

### Step 1: Prerequisites

```bash
# Install Cloudflare's CLI tool globally
npm install -g wrangler

# Log in to your Cloudflare account (opens browser)
npx wrangler login
```

### Step 2: Build the app

From the **repo root**:

```bash
# Optional: set Google Drive backup client ID (skip if you don't need Google Drive)
export VITE_GOOGLE_CLIENT_ID="your-client-id-here.apps.googleusercontent.com"

# Build the app
pnpm --filter @workspace/notary-journal... run build
```

### Step 3: Deploy

```bash
# Deploy using the project's deploy script (builds + deploys in one step)
pnpm run deploy:cloudflare
```

Or if you already built in Step 2:

```bash
# Deploy without rebuilding
node scripts/cloudflare-deploy.mjs --skip-build
```

### Step 4: Verify

Open your `*.workers.dev` URL in a browser. Confirm you see the PIN setup screen.

**SPA routing:** The `wrangler.toml` file already includes `not_found_handling = "single-page-application"`, so deep links like `/journal` work correctly. No extra `_redirects` file needed.

**Note:** Zo backup (`/api/backup`) is not available on Cloudflare Workers. Use JSON export/import or Google Drive backup from within the app.

---

## Option 3: Netlify Drag-and-Drop

No git account needed. Build locally, upload a zip, done.

### Step 1: Install pnpm

If you don't have pnpm, install it:

```bash
npm install -g pnpm
```

### Step 2: Build the app

From the **repo root**:

```bash
# OPTIONAL: Set Google Drive backup client ID. Skip this line if you don't need Google Drive.
# This value gets baked into the JavaScript — you can't change it later without rebuilding.
export VITE_GOOGLE_CLIENT_ID="your-client-id-here.apps.googleusercontent.com"

# Build the app (compiles source code into production-ready files)
pnpm --filter @workspace/notary-journal run build

# Add the SPA redirect file (required so deep links like /journal don't 404)
echo '/*    /index.html   200' > artifacts/notary-journal/dist/public/_redirects

# Create a zip of the build output (the zip contents should have index.html at the top level)
( cd artifacts/notary-journal/dist/public && zip -r ../../../../notary-journal-netlify.zip . )
```

> **No `zip` command?** Install it: `apt-get install zip` (Linux), `brew install zip` (Mac), or on Windows use `tar -a -c -f notary-journal-netlify.zip *` from within the `dist/public` folder instead.

You now have `notary-journal-netlify.zip` at the repo root.

### Step 3: Upload to Netlify

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the `notary-journal-netlify.zip` file onto the drop zone
3. Wait ~10 seconds. Status changes: Uploading > Processing > Published
4. Netlify shows your live URL (something like `https://random-name-12345.netlify.app`)

### Step 4: Verify

Open the Netlify URL in a browser. Confirm you see the PIN setup screen. Then navigate to `your-url/journal` — it should still load the app (not a 404). If it does, the `_redirects` file is working.

**Important about `VITE_GOOGLE_CLIENT_ID`:** This value is baked into the build at Step 2. Netlify's dashboard environment variables are **ignored** for drag-and-drop deploys. If you forget to set it before building, Google Drive backup won't work, and you'll need to rebuild and re-upload.

---

## Option 4: Netlify Git-Connected

Every time you push to GitHub, Netlify auto-rebuilds and redeploys.

### Step 1: Push your repo to GitHub

```bash
# From the repo root (if not already on GitHub)
git remote add origin https://github.com/YOUR-USERNAME/Notary-log.git
git branch -M main
git push -u origin main
```

### Step 2: Connect Netlify to your repo

1. Go to [app.netlify.com](https://app.netlify.com) > **Add new site** > **Import an existing project**
2. Choose your Git provider (GitHub, GitLab, or Bitbucket)
3. Select the `Notary-log` repo
4. Netlify reads `netlify.toml` automatically — the build command and publish directory are already set. Accept the defaults.
5. Click **Deploy site**

First build takes 2-4 minutes.

### Step 3: Set environment variables (for Google Drive backup)

1. In Netlify, go to **Site settings > Build & deploy > Environment**
2. Click **Add a variable**
3. Key: `VITE_GOOGLE_CLIENT_ID` | Value: your Google OAuth client ID
4. Save

**Important:** `VITE_GOOGLE_CLIENT_ID` is a build-time variable. After setting it, trigger a new deploy: go to **Deploys > Trigger deploy > Deploy site**. The value is baked into the JavaScript bundle — it's not read at runtime.

### Step 4: Verify

Open your Netlify URL (something like `https://your-site-name.netlify.app`). Confirm you see the PIN setup screen. Test a deep link like `your-url/entry/test` — it should load the app, not a 404.

---

## Option 5: Cloudflare Pages

Like Cloudflare Workers but git-connected. Uses `_redirects` for SPA routing.

### Step 1: Push your repo to GitHub

Same as Option 4, Step 1.

### Step 2: Connect Cloudflare Pages

1. Go to Cloudflare Dashboard > **Workers & Pages** > **Create** > **Pages** > **Connect to Git**
2. Select your `Notary-log` repo
3. Configure the build settings:

| Field | Value |
|-------|-------|
| **Framework preset** | None (or "Vite" if listed) |
| **Build command** | `pnpm --filter @workspace/notary-journal... run build && echo '/*    /index.html   200' > artifacts/notary-journal/dist/public/_redirects` |
| **Build output directory** | `artifacts/notary-journal/dist/public` |
| **Root directory** | *(leave blank — repo root is correct)* |

### Step 3: Set environment variables

Under **Environment variables (build)**:

| Variable | Value |
|----------|-------|
| `NODE_VERSION` | `22` |
| `VITE_GOOGLE_CLIENT_ID` | Your Google OAuth client ID (skip if not using Google Drive) |

### Step 4: Deploy

Click **Save and Deploy**. First build takes 2-4 minutes.

### Step 5: Verify

Open your `*.pages.dev` URL. Confirm you see the PIN setup screen. Test a deep link like `your-url/journal` — it should load the app (not a 404). The `_redirects` file generated in the build command handles this.

---

## Option 6: Hostinger / Shared Hosting

Upload to any Apache/LiteSpeed-based web host (Hostinger, Bluehost, GoDaddy, etc.).

### Step 1: Build the app

From the **repo root**:

```bash
# OPTIONAL: Set Google Drive client ID (skip if you don't need Google Drive)
export VITE_GOOGLE_CLIENT_ID="your-client-id-here.apps.googleusercontent.com"

# Build the app
pnpm --filter @workspace/notary-journal run build
```

### Step 2: Create the `.htaccess` file

Create a file at `artifacts/notary-journal/dist/public/.htaccess` with this exact content:

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

This tells Apache to serve `index.html` for any URL that isn't a real file — this is what makes deep links like `/journal` work instead of returning 404 errors.

### Step 3: Upload files

1. Log into your hosting control panel (e.g., Hostinger hPanel)
2. Open **File Manager**
3. Navigate to your public directory (usually `public_html`)
4. Upload **all files and folders** from `artifacts/notary-journal/dist/public/` into `public_html`
   - `index.html` should be directly inside `public_html`
   - `.htaccess` should be directly inside `public_html`
   - The `assets/` folder should be directly inside `public_html`

> **Tip:** You can zip the contents of `dist/public` first, upload the zip, then extract it in the file manager. Make sure the zip contains `index.html` at its top level, not inside a subfolder.

### Step 4: Verify

Open your domain in a browser. Confirm you see the PIN setup screen. Navigate to `yourdomain.com/journal` — it should still load the app. If you see a 404, confirm that `.htaccess` was uploaded and that your host has `mod_rewrite` enabled.

---

## Google Drive Backup (Optional)

This section is only needed if you want the **Cloud Backup** feature in the app (direct backup to your Google Drive). Everything else works without it. Skip this section if you're using Zo backup or manual JSON export/import.

### Step 1: Create a Google OAuth Client ID

1. Go to [console.cloud.google.com](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials** > **OAuth client ID**
3. Application type: **Web application**
4. Under **Authorized JavaScript origins**, add your development URL: `http://localhost:5173`
5. Click **Create**
6. Copy the Client ID (looks like `123456-abc123.apps.googleusercontent.com`)

### Step 2: Set the environment variable before building

See the `VITE_GOOGLE_CLIENT_ID` instructions in each deployment option above. The key rule:

> **This value is baked into the JavaScript at build time.** If you change it, you must rebuild and redeploy.

### Step 3: Authorize your deployed domain

After your site is live:

1. Go back to [console.cloud.google.com](https://console.cloud.google.com/apis/credentials)
2. Click your OAuth client ID
3. Under **Authorized JavaScript origins**, add your **full deployed URL** (no trailing slash), e.g.:
   - `https://your-site.netlify.app`
   - `https://your-site.pages.dev`
   - `https://your-domain.com`
4. Click **Save**

Google takes a few seconds to ~5 minutes to propagate. If you get an "origin not allowed" error, wait a couple minutes and try again.

If you have multiple deployment URLs (e.g., a test deploy and a production deploy), add **every one** to Authorized JavaScript origins.

---

## Client Intake Form (Optional)

Let clients fill out their information before the appointment. When they submit, you get an email and the data appears in your app's **Requests** tab. Tap "Accept" to auto-fill a new journal entry.

**Cost: $0. Uses [Web3Forms](https://web3forms.com) — free, no signup required.**

### How It Works

```
Client opens your intake link on their phone
    -> Fills form (name, ID details, uploads ID photos, e-signs)
    -> Submits -> You get an email via Web3Forms
                -> The request appears in your app's Requests tab
You tap "Accept" -> Prefilled journal entry is created
```

### Platform Support

| Platform | Email (Web3Forms) | Pending Queue | Cost |
|----------|-------------------|---------------|------|
| **Zo Computer** | Yes | Yes (built-in) | $0 |
| **Cloudflare Workers/Pages** | Yes | Yes (KV namespace) | $0 |
| **Netlify** | Yes | Yes | $0 |
| **Hostinger / Shared Hosting** | Yes | No (no server) | $0 |

### Setup (1 minute)

1. Go to [web3forms.com](https://web3forms.com) → get your free access key
2. Open your Notary Journal app → **Settings > Client Intake Form**
3. Paste your Web3Forms Access Key → click **Save**
4. Copy the generated intake link and share it with clients

That's it. No webhook configuration needed — the form handles both email and in-app queue automatically.

> The intake link includes your key (e.g., `?key=86e34...`). This is a public form identifier, not a secret. Share it freely via text, email, or QR code.

---

## Troubleshooting

### "Page not found" or blank white screen after deploy

**Most common cause:** The build output files weren't uploaded correctly.

- **Netlify drag-and-drop:** The zip must contain `index.html` at its **root level**, not inside a `dist/public` folder. Unzip the file on your computer — if you see `dist/public/index.html`, you zipped the wrong thing. Re-zip the **contents** of `dist/public`, not the folder itself.
- **All hosts:** Confirm the build completed without errors. Run `pnpm run build` and check for red error text.

### Deep links return 404 (e.g., `/journal` or `/entry/abc`)

The host doesn't know to serve `index.html` for non-file URLs.

- **Netlify drag-and-drop:** Make sure `_redirects` was added (see Option 3, Step 2). The file must be at the root of your zip alongside `index.html`.
- **Netlify git-connected / Cloudflare Pages:** The `_redirects` is generated in the build command. Check the deploy log to confirm it ran.
- **Cloudflare Workers:** Check `wrangler.toml` has `not_found_handling = "single-page-application"`.
- **Hostinger / Apache:** Confirm `.htaccess` is uploaded to `public_html` alongside `index.html`. Check that `mod_rewrite` is enabled on your host.

### Google Drive backup shows "not enabled"

The `VITE_GOOGLE_CLIENT_ID` wasn't set when the app was built.

- **Zo Computer:** Zo Advanced environment variables **do not** enable Google Drive by themselves. Use the [Enable Google Drive backup later (Zo)](#step-5-enable-google-drive-backup-later-zo) prompt (write `.env`, `bun run build`, restart service).
- **Git-connected deploys (Netlify, Cloudflare Pages):** Set the variable in the host dashboard, then trigger a rebuild.
- **Drag-and-drop / manual deploys:** Set `VITE_GOOGLE_CLIENT_ID` in your shell **before** running `pnpm run build`, then rebuild and re-upload. Host dashboard environment variables are ignored for drag-and-drop.

### "It works in Chrome but not in Incognito or other browsers"

Chrome cached a previous working version via the service worker. Fix:

1. In Chrome: **Settings > Privacy and security > Site settings > All sites** > find your domain > **Clear & reset**
2. Reload the page

### Data doesn't sync between devices or domains

The journal stores data in **IndexedDB**, which is per-domain in the browser. Two different URLs = two separate journals.

To move data between domains:
- **Google Drive backup:** Settings > Cloud Backup > Backup on source, Restore on destination
- **JSON export/import:** Settings > Export all > JSON on source, then Import on destination

CSV and PDF exports are read-only — they cannot be re-imported.

### App loads but looks broken (no styles, missing icons)

The build didn't produce the asset files, or the host isn't serving the `assets/` folder.

1. Run `pnpm run build` again
2. Confirm `artifacts/notary-journal/dist/public/assets/` exists and contains `.js` and `.css` files
3. Re-upload/re-deploy

### Zo backup connection fails

1. Confirm the backup API URL is correct: `https://notary-log-{your-handle}.zocomputer.io/api/backup`
2. Confirm the backup key matches what `zo logs --service notary-log` shows
3. Check the Zo service logs for server errors: `zo logs --service notary-log`
4. Make sure you didn't create a second Zo service — the backup runs in the same service as the app

---

## Project Structure (for reference)

| File | Purpose |
|------|---------|
| `netlify.toml` | Netlify git-connected build config + SPA redirect |
| `wrangler.toml` | Cloudflare Workers static assets + SPA fallback + KV for intake |
| `zosite.json` | Zo publish configuration |
| `server.ts` | Zo server — serves static files + Zo backup API |
| `cloudflare/worker.ts` | Cloudflare Workers entry point + intake webhook/KV |
| `artifacts/notary-journal/src/` | Main app source (pages, components, lib) |
| `artifacts/notary-journal/src/pages/client-requests.tsx` | Pending intake requests UI |
| `artifacts/notary-journal/src/pages/client-intake.tsx` | Client-facing intake form |
| `artifacts/notary-journal/src/lib/gdrive.ts` | Google Drive backup logic |
| `artifacts/notary-journal/src/lib/intake-api.ts` | Intake API client (talks to server) |

---

## License

This project is licensed under a **Custom Non-Commercial License**. Free for personal use — commercial use requires a written agreement. See [LICENSE](LICENSE) for full terms.

**Questions about commercial licensing?** Contact Joseph Iannazzi at joseph@justlegalsolutions.org or iannazzi.joseph@gmail.com.
