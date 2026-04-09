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

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/notary-journal run dev` — run notary journal locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
