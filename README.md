# Notary Journal PWA

A fast, fully client-side Progressive Web App (PWA) for modern notaries. It features offline support, highly secure local encryption, ID scanning, signature capture, and print-ready NNA-compliant journal PDFs.

Because this app is purely frontend (with no backend server), it can be hosted anywhere for free.

> [!WARNING]
> **STRICT NON-COMMERCIAL LICENSE**
> This repository is governed by a Custom Non-Commercial License. It is 100% free to deploy for personal use, but **it may NOT be sold, monetized, or used for commercial SaaS purposes** under any circumstances. Violations are subject to strict legal penalties including $50,000 in liquidated damages per the license terms. See the [LICENSE](LICENSE) file for full details before deploying.

---

# Free Hosting Guide: Zo, Netlify, Cloudflare Pages, or Hostinger

If you've cloned this repository and want to host your own instance of the Notary Journal PWA for **$0/month**, the easiest beginner path is **Zo Computer**. Netlify, Cloudflare Pages, and Hostinger are also supported if you prefer a traditional static host.

> [!NOTE]
> **Backups:** The app stores journal data locally in your browser. Zo can host the app and store exported backup files in your Zo workspace, but it cannot automatically read browser-only IndexedDB data unless you export or back up from inside the app first. Direct in-app Google Drive backup still requires a Google OAuth Client ID.

---

## Option A: Deploy with Zo Computer (Recommended for Beginners)

Zo Computer gives you a personal cloud computer with hosting and cloud storage. The free plan is a good fit for personal self-hosting because it includes 100GB of storage and one hosted service, but the free computer can sleep when idle and has limited CPU/memory.

### Step 1: Sign Up

Sign up for Zo Computer: [https://zo-computer.cello.so/XvrzHZZ53TV](https://zo-computer.cello.so/XvrzHZZ53TV)

### Step 2: Clone It

Open your Zo terminal and clone the repo:

```bash
git clone https://github.com/SillyHippy/Notary-log
```

### Step 3: Install and Build

Go into the folder and build the app:

```bash
cd Notary-log
corepack enable
pnpm install
pnpm --filter @workspace/notary-journal... run build
```

### Step 4: Publish It

Ask Zo to publish `artifacts/notary-journal/dist/public` as a public site or HTTP service with SPA fallback to `index.html`.

Or copy and paste this prompt into Zo:

```text
Deploy the Notary Journal app for me on Zo using the free plan.

Use this repository:
https://github.com/SillyHippy/Notary-log

Please do all of this:

1. Clone the repo.
2. Use Node 22 with Corepack and pnpm.
3. From the repo root, run:
   corepack enable
   pnpm install
   pnpm --filter @workspace/notary-journal... run build
4. Publish artifacts/notary-journal/dist/public as a public Zo Site or public HTTP service.
5. Configure it as a single-page app so every route falls back to index.html.
6. Make the site public.
7. Create a Zo Space API route at /api/backup.
8. Store backup files in Documents/Notary Journal/backups/.
9. Protect /api/backup with a secret backup key, because Zo Space API routes are public. Generate a strong backup key and show it to me when finished.
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
17. I will paste the backup API URL and backup key into Settings -> Zo Backup in the app.
18. When finished, tell me:
    - the public app URL, which should look like [site-name]-[my-zo-handle].zocomputer.io
    - the backup API URL, which should look like [my-zo-handle].zo.space/api/backup
    - where the backup files are stored

Keep this free-tier friendly: one app site/service, simple file storage, no always-on paid automation required.
```

Make the site public when Zo asks.

### Step 5: Complete App Setup

Open the Zo site URL and complete the in-app PIN setup.

### Step 6: Back Up and Restore with Zo

Open **Settings -> Zo Backup**, paste the Zo backup API URL and backup key, then click **Test Connection**. Use **Backup to Zo** to save a new backup and **Restore from Zo** to list and restore backup files.

Manual backup still works: use **Settings -> Data & Export -> Export JSON** to create a backup file, then store that file in a Zo folder such as `Notary Journal Backups`. To restore manually, download the JSON backup from Zo and use **Settings -> Import from JSON file**.

If you connect Google Drive inside Zo, you can ask Zo to copy or sync your `Notary Journal Backups` folder to Google Drive. This avoids Google Cloud Console for basic backup-file storage, but it is not the same as direct in-app Google Drive backup.

### Optional Step 7: Set Up a Zo Backup API

For a simple Zo-side backup connector, go to **Zo Space -> API Routes** and create `/api/backup`.

Recommended behavior:

- Save backup files to `Documents/Notary Journal/backups/`.
- `GET /api/backup` = list files.
- `POST /api/backup` = save new backup.
- `GET /api/backup?file=filename.json` downloads a backup for restore.
- Require a secret backup key, such as an `Authorization: Bearer ...` header, because Zo Space APIs are public endpoints.

The app's **Settings -> Zo Backup** section uses this API URL and backup key for one-click backup and restore. Manual JSON export/import still works if you do not create the API route.

### Step 8: Done

Your app is live at `[site-name]-[your-zo-handle].zocomputer.io`.

Backup is at `[your-zo-handle].zo.space/api/backup`.

That's it. No Google, no OAuth, no third-party accounts needed.

Open your Zo site URL, unlock the app with your PIN, and make a test JSON backup so you know restore is ready before you start using the journal.

### Optional: Create a Zo Helper

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

---

## Optional: Get Your Google Client ID (Required for Direct Google Drive Backup)

To enable the "Auto-Backup to Google Drive" feature in your self-hosted version, you need to create a free Google Cloud project to get a Client ID.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `notary-journal-app`).
3. **Enable the Drive API:** Go to **APIs & Services > Library**, search for **Google Drive API**, and click **Enable**.
4. Go to **APIs & Services > Credentials**.
5. Click **Create Credentials** -> **OAuth client ID**.
6. Choose **Web application** as the application type.
7. Under **Authorized JavaScript origins**, add the URL where you will host the app (e.g., `https://your-app.netlify.app` or `https://your-app.pages.dev`). *Note: You may need to come back and add this after you deploy.*
8. Copy your **Client ID** (it looks like `123456789-abcxyz.apps.googleusercontent.com`).

You will need to paste this as an **Environment Variable** (`VITE_GOOGLE_CLIENT_ID`) when setting up your hosting in the next steps.

---

## Option B: Deploy to Netlify

Netlify is incredibly easy to use and automatically builds your app every time you push changes to GitHub.

1. **Create an account:** Go to [Netlify.com](https://www.netlify.com/) and sign up using your GitHub account.
2. **Add new site:** In your dashboard, click **"Add new site"** -> **"Import an existing project"**.
3. **Connect GitHub:** Authorize GitHub and select your repository.
4. **Configure Build Settings (Crucial Step):** 
   Because the app is located in a subfolder, fill out the build settings exactly like this:
   - **Base directory:** `artifacts/notary-journal`
   - **Build command:** `pnpm run build` *(or `npm run build`)*
   - **Publish directory:** `artifacts/notary-journal/dist/public`
5. **Add Environment Variables:**
   - Click **Add environment variables**.
   - **Key:** `NODE_VERSION` | **Value:** `22`
   - **Key:** `VITE_GOOGLE_CLIENT_ID` | **Value:** *[paste the Client ID from the optional Google setup section]*
6. **Deploy:** Click **"Deploy site"**. Netlify will take a minute or two to build the app.
7. **Custom Domains & SSL:** Netlify will give you a free `.netlify.app` URL. If you want to use your own domain, go to **Domain Management**, add your custom domain, and follow their DNS instructions. Netlify provides free automatic SSL certificates.

---

## Option C: Deploy to Cloudflare Pages (Best for Speed/CDN)

Cloudflare Pages is also completely free and leverages Cloudflare's massive global CDN network, making your app load blazingly fast anywhere in the world.

1. **Create an account:** Go to [Cloudflare.com](https://www.cloudflare.com/) and sign up.
2. **Navigate to Pages:** On the left sidebar, click **"Workers & Pages"**, then click the **"Pages"** tab.
3. **Connect GitHub:** Click **"Connect to Git"**, authorize your GitHub account, and select your repository.
4. **Configure Build Settings:**
   Set it up exactly like this to handle the workspace structure:
   - **Framework preset:** `None`
   - **Build command:** `pnpm --filter @workspace/notary-journal... run build`
   - **Build output directory:** `artifacts/notary-journal/dist/public`
   - **Root directory:** *(leave blank)*
5. **Add Environment Variables:**
   - Scroll down to **Variables and secrets** and click **Add**.
   - **Name:** `NODE_VERSION` | **Value:** `22`
   - **Name:** `VITE_GOOGLE_CLIENT_ID` | **Value:** *[paste the Client ID from the optional Google setup section]*
6. **Deploy:** Click **"Save and Deploy"**.
7. **Custom Domains:** Cloudflare provides a free `.pages.dev` URL. If you want a custom domain, go to the **Custom Domains** tab on your Pages project. Since you are already in Cloudflare, managing the DNS is seamless and SSL is automatically applied.

---

## Option D: Deploy to Hostinger (or standard Shared Hosting)

If you are using Hostinger, cPanel, or another standard shared hosting provider (which typically use Apache or LiteSpeed servers), you can easily host this PWA.

1. **Build locally:** You will need to build the app on your own computer first.
   ```bash
   export VITE_GOOGLE_CLIENT_ID="[paste the Client ID you got from Step 1]" 
   pnpm --filter @workspace/notary-journal run build
   ```
2. **Add an `.htaccess` file:** Inside the newly built `artifacts/notary-journal/dist/public` folder, create a file named `.htaccess` with these contents to handle SPA routing:
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
3. **Upload & Extract:** Zip up the contents of the `dist/public` folder (including the new `.htaccess` file). Log into your Hostinger File Manager (or connect via FTP), upload the zip to your `public_html` directory, and extract the files directly there.

*(For more advanced deployment details and cache troubleshooting, see the `DEPLOYMENT.md` file included in this repository).*

---

### Troubleshooting a Blank Screen?
If your app deploys successfully on either platform but shows a completely blank white screen, it means the hosting provider is serving the wrong folder. Ensure your **Publish/Output directory** was set exactly to `dist/public` and not just `dist`.
