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

**Important:** Only **Zo Computer** includes the server-side backup API (`/api/backup`). All other hosts serve the static PWA only — you'll use JSON export/import or Google Drive backup for your data.

---

## Option 1: Zo Computer (Recommended)

Zo gives you a free computer with 100GB storage, one hosted service, and built-in backup. This is the easiest path because the backup API runs in the same service.

**What you'll end up with:**
- Public app URL: `https://notary-journal-{your-handle}.zocomputer.io`
- Backup API: `https://notary-journal-{your-handle}.zocomputer.io/api/backup`
- Backup files stored in: `Documents/Notary Journal/backups/`

### Step 1: Sign up

Create a free Zo account using the project referral link:
https://zo-computer.cello.so/XvrzHZZ53TV

### Step 2: Clone and build

Open your Zo terminal and run these commands:

```bash
git clone https://github.com/SillyHippy/Notary-log
cd Notary-log
bun install
bun run build
```

### Step 3: Publish

```bash
bun run prod
```

The server (`server.ts`) starts automatically. It will print a **backup key** — save this somewhere safe. The server serves the built app from `artifacts/notary-journal/dist/public` and handles `/api/backup` for server-side backups.

Zo listens on its `PORT` environment variable automatically. The service is public by default.

### Step 4: Verify

Open the URL Zo shows you (should look like `https://notary-journal-{your-handle}.zocomputer.io`). Confirm you see the PIN setup screen.

### Step 5: Configure in-app Zo backup

1. Open the app in your browser
2. Go to **Settings > Backup & Restore**
3. Turn on **Show Zo backup**
4. Paste the backup API URL (your public URL + `/api/backup`)
5. Paste the backup key printed when you ran `bun run prod`
6. Click **Test Connection** — it should say success
7. Click **Backup to Zo** to create your first backup

### AI Deploy Prompt (optional)

If you want Zo's AI agent to handle everything, paste this into Zo:

```
Deploy the Notary Journal app for me on Zo using the free plan.

Use this repository:
https://github.com/SillyHippy/Notary-log

Please do all of this:

1. Clone the repo.
2. Use Bun.
3. From the repo root, run: bun install && bun run build
4. Publish with: bun run prod
5. The production server is server.ts — it serves artifacts/notary-journal/dist/public and handles /api/backup.
6. Make the site public.
7. Store backup files in Documents/Notary Journal/backups/.
8. Protect /api/backup with a generated backup key (print it when done).
9. Add CORS headers for /api/backup (allow GET, POST, OPTIONS; allow Authorization and Content-Type headers).
10. When finished, tell me: the public app URL, the backup API URL, and the backup key.
```

### Zo Limitations (good to know)

- Free Zo computers can sleep when idle — the first request after sleeping may take a few seconds
- Free accounts get one hosted service — that's all you need for this app
- The app protects journal access with an in-app PIN, but the URL itself is public
- Zo snapshots protect the Zo computer state, NOT your browser's local data — always keep JSON backups

---

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

Let clients fill out their information before the appointment. When they submit, you get an email and the data appears in your app's **Requests** tab. Tap "Start Entry" to auto-fill a new journal entry.

**Cost: $0. Uses [Web3Forms](https://web3forms.com) — free, no signup required.**

### How It Works

```
Client opens your intake link on their phone
    -> Fills form (name, ID details, uploads ID photos, e-signs)
    -> Submits -> You get an email via Web3Forms
    -> Web3Forms sends data to your app's /api/intake-webhook endpoint
You see it in the app -> Requests tab -> "Start Entry" -> Prefilled journal entry
```

### Platform Support

| Platform | Form | Email (Web3Forms) | Pending Queue | Cost |
|----------|------|-------------------|---------------|------|
| **Zo Computer** | Full support (auto) | Yes | Yes (server auto-provisions) | $0 |
| **Cloudflare Workers** | Full support (auto) | Yes | Yes (auto-provisions KV via Wrangler) | $0 |
| **Netlify** | Full support (auto) | Yes | Yes (auto-provisions Blobs via Functions) | $0 |
| **Hostinger / Shared Hosting** | Works | Yes | **Not available** (no server) | $0 |

All server-side options run on free-tier infrastructure -- **$0 cost**.

### Step 1: Get your Web3Forms access key

1. Go to [web3forms.com](https://web3forms.com)
2. Enter your email address
3. Click "Get your Access Key"
4. Copy the key from the email you receive

### Step 2: Configure the app

1. Open your Notary Journal app
2. Go to **Settings > Client Intake Form**
3. Paste your **Web3Forms Access Key**
4. Click **Save & Test**

### Step 3: Set the webhook URL in Web3Forms

1. Go to your Web3Forms dashboard
2. Find your form > click the **Webhooks** tab
3. Add this webhook URL: `https://yoursite.com/api/intake-webhook`
   (Replace `yoursite.com` with your actual deployed domain)

### Step 4: Share with clients

In Settings, click **Copy Intake Link** and send it to clients via text, email, or QR code.

> **Works everywhere:** The intake form works on **any deployment** (Zo, Cloudflare Workers, Netlify, etc.). No Zo backup or extra config needed — just paste your Web3Forms key and go.

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

1. Confirm the backup API URL is correct: `https://your-zo-url.zocomputer.io/api/backup`
2. Confirm the backup key matches what `bun run prod` printed
3. Click **Test Connection** — if it fails, check the Zo terminal for server errors
4. Make sure you didn't create a second Zo service — the backup runs in the same service as the app

---

## Project Structure (for reference)

| File | Purpose |
|------|---------|
| `netlify.toml` | Netlify git-connected build config + SPA redirect |
| `wrangler.toml` | Cloudflare Workers static assets + SPA fallback |
| `zosite.json` | Zo publish configuration |
| `server.ts` | Zo server — serves static files + `/api/backup` |
| `artifacts/notary-journal/` | The main app source code |
| `cloudflare/worker.ts` | Cloudflare Workers entry point |
| `scripts/cloudflare-deploy.mjs` | One-step build + deploy for Cloudflare |

---

## License

This project is licensed under a **Custom Non-Commercial License**. Free for personal use — commercial use requires a written agreement. See [LICENSE](LICENSE) for full terms.

**Questions about commercial licensing?** Contact Joseph Iannazzi at joseph@justlegalsolutions.org or iannazzi.joseph@gmail.com.
