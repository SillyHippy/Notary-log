# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 (currently used only by api-server; notary-journal is frontend-only)
- **Database**: PostgreSQL + Drizzle ORM (api-server); IndexedDB with idb (notary-journal)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

### Notary Journal (`artifacts/notary-journal`)
- **Type**: React + Vite, frontend-only PWA
- **Preview path**: `/`
- **Purpose**: Mobile-first electronic notary journal for licensed notaries
- **Storage**: IndexedDB (idb) — all data stored locally, works fully offline
- **Key libraries**: idb, signature_pad, jspdf, @zxing/browser, @zxing/library, tesseract.js
- **Features**:
  - Dashboard with stats and recent entries
  - Journal list with masked ID numbers, search/filter
  - New entry wizard: camera-based ID scanning (PDF417 barcode + OCR fallback), signer info, notarial act, signature pad, review
  - Entry detail: all fields, integrity verification (SHA-256 hash), amendments, export
  - Settings: notary profile, PIN lock, dark mode toggle, export all
  - PDF/CSV/JSON export (single entry and bulk)
  - Google Drive backup/restore (auto-backup after each entry, manual backup, restore with duplicate-skip merge)
  - GPS auto-detect location for notarization address
  - PWA manifest + service worker for offline use
  - AAMVA barcode format parser for driver's licenses (including Oklahoma concatenated subfile format)

### API Server (`artifacts/api-server`)
- **Type**: Express 5 REST API
- **Preview path**: `/api`
- **Purpose**: Shared backend (currently minimal health check only)

## Environment Variables

### Notary Journal

| Variable | Required | Description |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | For Drive backup | Google OAuth 2.0 Client ID for Google Drive backup. Set in Replit environment variables (shared). |

**Setting up `VITE_GOOGLE_CLIENT_ID`:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → enable **Google Drive API**
3. APIs & Services → Credentials → **Create OAuth Client ID** (Web application type)
4. Under **Authorized JavaScript Origins**, add every domain the app runs on:
   - Your Replit dev URL (e.g. `https://<repl>.janeway.replit.dev`)
   - Your published domain (e.g. `https://<app>.replit.app`) when deployed
5. Copy the Client ID (ends in `.apps.googleusercontent.com`) and store it as `VITE_GOOGLE_CLIENT_ID` in Replit's environment variables
6. Restart the notary-journal workflow for the change to take effect

Without this variable, the Cloud Backup section in Settings shows a "not enabled" message and Drive features are hidden. All other app features work without it.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/notary-journal run dev` — run notary journal locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Deployment

See `DEPLOYMENT.md` for Netlify and Cloudflare Pages deployment instructions (drag-and-drop and git-connected). For Replit's own `.replit.app` hosting, use the Publish button in the workspace — no extra config needed.
