# Notary Journal PWA

A fast, fully client-side Progressive Web App (PWA) for modern notaries. It features offline support, highly secure local encryption, ID scanning, signature capture, and print-ready NNA-compliant journal PDFs.

Because this app is purely frontend (with no backend server), it can be hosted anywhere for free.

---

# Free Hosting Guide: Netlify vs. Cloudflare Pages

If you've cloned this repository and want to host your own instance of the Notary Journal PWA for **$0/month**, you have two excellent options. Both Netlify and Cloudflare offer generous free tiers that can easily handle your traffic forever.

> [!NOTE]
> **Prerequisite:** Before starting either option, make sure you have pushed your cloned code to your own **GitHub account**. You will also need to generate a Google Client ID if you want the Google Drive Auto-Backup feature to work (see Step 1).

---

## Step 1: Get Your Google Client ID (Required for Backups)

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

## Option A: Deploy to Netlify (Recommended for Beginners)

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
   - **Key:** `VITE_GOOGLE_CLIENT_ID` | **Value:** *[paste the Client ID you got from Step 1]*
6. **Deploy:** Click **"Deploy site"**. Netlify will take a minute or two to build the app.
7. **Custom Domains & SSL:** Netlify will give you a free `.netlify.app` URL. If you want to use your own domain, go to **Domain Management**, add your custom domain, and follow their DNS instructions. Netlify provides free automatic SSL certificates.

---

## Option B: Deploy to Cloudflare Pages (Best for Speed/CDN)

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
   - **Name:** `VITE_GOOGLE_CLIENT_ID` | **Value:** *[paste the Client ID you got from Step 1]*
6. **Deploy:** Click **"Save and Deploy"**.
7. **Custom Domains:** Cloudflare provides a free `.pages.dev` URL. If you want a custom domain, go to the **Custom Domains** tab on your Pages project. Since you are already in Cloudflare, managing the DNS is seamless and SSL is automatically applied.

---

## Option C: Deploy to Hostinger (or standard Shared Hosting)

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
