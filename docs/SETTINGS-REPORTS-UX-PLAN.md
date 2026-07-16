# Settings + Reports UX Reorganization — Safe Implementation Plan

**Goal:** Backup, restore, verify, and export are easy to find without scrolling.  
**Scope:** Reorder Settings + add export buttons to Reports. **No logic changes.**  
**Test locally first. Do not push GitHub until you sign off.**

**Realistic effort:** ~1–1.5 hours (reorder + wire buttons + smoke test)

---

## What we're actually doing

| Task | What it is | Risk |
|------|------------|------|
| Move 4 Settings cards to the top | Cut/paste JSX blocks in `settings.tsx` | **Low** — same handlers, same state |
| Merge backup cards into one collapsible parent | Wrap existing Google + Zo cards | **Low** |
| Add 4 export buttons to Reports | Copy handlers from Settings | **Low** — same `export.ts` functions |
| Remove duplicate export buttons from Settings | Delete JSX + add link to Reports | **Low** |

**What we're NOT doing (keeps this safe):**
- No changes to `export.ts`, `db.ts`, `gdrive.ts`, `zo-backup.ts`
- No new fee logic, no intake changes, no deploy changes
- No big file split unless you want it later (optional cleanup, not required)

---

## Safety rules (read before touching code)

1. **Handlers stay identical** — `handleVerifyChain`, `handleBackupNow`, `handleExportPDF`, etc. Do not rewrite logic; only move JSX or call the same functions from Reports.
2. **Keep every `data-testid`** — tests and your manual checks rely on these. Moving a button is fine; renaming test ids is not.
3. **One change at a time** — reorder Settings → test → add Reports buttons → test → remove Settings duplicates → test.
4. **Build after each step** — `pnpm --filter @workspace/notary-journal... run build` catches import/JSX errors immediately.
5. **Local Zo rebuild only** — `./scripts/zo-auto-deploy.sh` or manual build:proxy + restart. **No GitHub push** until checklist below passes.

---

## Current layout (today)

### Settings (`settings.tsx` ~2350 lines) — top → bottom

1. Notary Profile (collapsible)
2. Journal Compliance (collapsible)
3. Security & Appearance (collapsible)
4. Client Intake (collapsible)
5. Default Fees
6. Stamp Fee
7. Seal / Logo
8. **Backup & Restore** (visibility toggles only)
9. **Zo Backup** (full panel)
10. **Cloud Backup** (Google Drive)
11. **Data & Export** (PDF/CSV/JSON/Print + Import JSON)
12. **Journal Integrity** (Verify chain)
13. Danger Zone

### Reports (`reports.tsx` ~370 lines)

- Annual report only (year/month charts, fee tables)
- Export year PDF / CSV
- **Missing:** Print Journal, full journal PDF/CSV/JSON

---

## Target layout

### Settings — new order

```
┌──────────────────────────────────────────────┐
│ Settings header                              │
│ Link: "Export journal → Reports"             │
├──────────────────────────────────────────────┤
│ 1. DATA & INTEGRITY          [open default]  │
│    • Entry count                             │
│    • Verify entire journal + result          │
│    • Link → Reports tab                      │
├──────────────────────────────────────────────┤
│ 2. BACKUP & RESTORE          [open default]  │
│    • Show Google / Show Zo toggles           │
│    • Import JSON (restore)                     │
│    • ▼ Cloud Backup (Google)  [nested]       │
│    • ▼ Zo Backup              [nested]       │
├──────────────────────────────────────────────┤
│ 3. Notary Profile            [collapsed]     │
│ 4. Journal Compliance        [collapsed]     │
│ 5. Client Intake             [collapsed]     │
│ 6. Default Fees                              │
│ 7. Stamp Fee                                 │
│ 8. Seal / Logo                               │
│ 9. Security & Appearance     [collapsed]     │
│ 10. Danger Zone                              │
└──────────────────────────────────────────────┘
```

**Removed from Settings after Phase 2:** Export PDF, CSV, JSON, Print Journal (live on Reports instead).

### Reports — add export section

**Option (recommended):** Single scroll page — **Journal Export card first**, then existing Annual Report below.  
No new tab component needed; simpler and faster on mobile.

```
┌──────────────────────────────────────────────┐
│ Reports & Export                             │
├──────────────────────────────────────────────┤
│ JOURNAL EXPORT (new card at top)             │
│   • "42 completed entries" preview           │
│   • Print Journal                            │
│   • Export PDF / CSV / JSON                  │
├──────────────────────────────────────────────┤
│ ANNUAL REPORT (existing, unchanged)          │
│   Year/month filters, charts, year PDF/CSV   │
└──────────────────────────────────────────────┘
```

---

## File change map (minimal)

| File | Change | Required? |
|------|--------|-----------|
| `src/pages/settings.tsx` | Reorder JSX; wrap backup panels; remove export buttons | **Yes** |
| `src/pages/reports.tsx` | Add Journal Export card + 4 buttons | **Yes** |
| `src/hooks/use-journal-export.ts` | **New** — shared load entries + export handlers | **Recommended** (avoids copy-paste bugs) |
| `src/components/reports/journal-export-card.tsx` | **New** — optional thin wrapper | Optional |
| `src/lib/export.ts` | — | **Do not touch** |
| `src/lib/db.ts` | — | **Do not touch** |
| `src/pages/journal-list.tsx` | Keep Print Journal shortcut | **No change** |

**Why a small hook?** Settings and Reports both need `getAllEntries()` + `getSettings()` + the same four export calls. One hook = one place to fix if something breaks. ~20 lines, not a refactor.

---

## Step-by-step implementation (with checkpoints)

### Step 1 — Create shared export hook (~10 min)

**File:** `src/hooks/use-journal-export.ts`

```ts
// Pseudocode — same calls Settings uses today
loadEntriesAndSettings()
handlePrintJournal()  → exportJournalTablePDF(completed, settings)
handleExportPDF()     → exportAllPDF(...)
handleExportCSV()     → exportAllCSV(...)
handleExportJSON()    → exportAllJSON(...)
return { entryCount, completedCount, handlers, isLoading }
```

**Checkpoint 1:** `pnpm test` — existing tests still pass (hook can have a tiny unit test optional).

---

### Step 2 — Add export card to Reports (~15 min)

**File:** `src/pages/reports.tsx`

- Import `useJournalExport` (or inline the same handlers Settings already has)
- Add card **above** the "Annual Report" header with:
  - `button-print-journal` (same test id as Settings)
  - `button-export-pdf`, `button-export-csv`, `button-export-json`
- Update page subtitle: "Export your journal and view annual fee reports"
- Optional: rename h1 to "Reports & Export"

**Checkpoint 2 — manual:**
- [ ] Open Reports → all 4 buttons visible without scrolling much
- [ ] Print Journal downloads/opens PDF
- [ ] Export PDF / CSV / JSON each trigger a download
- [ ] Annual report section still works (year PDF/CSV unchanged)

---

### Step 3 — Move verify + backup blocks to top of Settings (~20 min)

**File:** `src/pages/settings.tsx`

**3a. Data & Integrity (new top card)**
- Move **Journal Integrity** block here (verify button + result alert)
- Add entry count: `entries.length` from existing state or quick `getAllEntries()` on load
- Add link: `<Link href="/reports">Export journal →</Link>`

**3b. Backup & Restore (unified parent card)**
- Move **Backup & Restore** visibility toggles into card header
- Move **Import JSON** from Data & Export into this card (restore belongs with backup)
- Nest **Cloud Backup** and **Zo Backup** inside as sub-sections with chevrons:
  - Collapse ids: `backup-google`, `backup-zo`
  - Reuse existing `collapsedSections` / `toggleSection` pattern from Profile card

**3c. Reorder**
- Place cards **1 + 2** immediately after Settings header (before Notary Profile form)
- Set default collapsed for config sections: add `'notary-profile'`, `'journal-compliance'`, etc. to initial collapsed Set **or** document that first visit shows them open until user collapses (current behavior)

**Checkpoint 3 — manual:**
- [ ] Open Settings → Verify + Backup visible without scrolling
- [ ] Verify chain still works
- [ ] Google/Zo panels expand/collapse
- [ ] Import JSON still restores
- [ ] Backup now (Google or Zo) still works
- [ ] Profile / compliance / intake still editable below

---

### Step 4 — Remove duplicate exports from Settings (~5 min)

- Delete export PDF/CSV/JSON/Print buttons from **Data & Export** card
- Either remove empty Data & Export card entirely **or** keep only privacy note + link to Reports
- Update header link: "View Reports & Export →"

**Checkpoint 4 — manual:**
- [ ] Settings has **no** export buttons (only link to Reports)
- [ ] Reports has all export buttons
- [ ] Journal list Print Journal still works (unchanged shortcut)

---

### Step 5 — Build + deploy locally (~10 min)

```bash
cd /home/workspace/Projects/Notary-log
pnpm --filter @workspace/notary-journal... run test
pnpm --filter @workspace/notary-journal... run build:proxy   # reverse proxy production
# restart notary-log service on Zo
```

**Checkpoint 5:**
- [ ] All tests pass
- [ ] Production URL loads Settings + Reports
- [ ] Phone smoke test: backup at top, export on Reports

---

## Local test checklist (before GitHub)

Run on **your production URL** after local rebuild:

| # | Action | Pass? |
|---|--------|-------|
| 1 | Settings opens (not blank blue screen) | |
| 2 | Verify journal at top — tap, see result | |
| 3 | Backup panels at top — expand Google/Zo | |
| 4 | Import JSON from Backup section | |
| 5 | Reports → Print Journal | |
| 6 | Reports → Export PDF / CSV / JSON | |
| 7 | Reports → Annual year PDF/CSV still works | |
| 8 | Journal list → Print Journal (shortcut) | |
| 9 | Collapse/expand Settings sections — refresh — state remembered | |

**Only after all pass:** commit + push to GitHub (when you say so).

---

## Collapse defaults

| Section | Default on first visit |
|---------|------------------------|
| Data & Integrity | **Open** |
| Backup & Restore (parent) | **Open** |
| Google sub-panel | Open if connected, else closed |
| Zo sub-panel | Open if URL+key set, else closed |
| Notary Profile, Compliance, Intake, Security | **Closed** (optional — or leave current user preference) |

Use existing `notary-settings-collapsed` localStorage key. Add ids: `data-integrity`, `backup-restore`, `backup-google`, `backup-zo`.

---

## What stays where (final)

| Action | Settings | Reports | Journal list |
|--------|----------|---------|--------------|
| Verify chain | ✅ | — | — |
| Backup / restore | ✅ | — | — |
| Import JSON | ✅ | — | — |
| Print Journal | — | ✅ | ✅ shortcut |
| Export PDF/CSV/JSON | — | ✅ | — |
| Annual report PDF/CSV | — | ✅ | — |
| Configure intake / fees / profile | ✅ | — | — |

---

## Rollback plan (if something breaks)

1. **Git:** `git checkout -- src/pages/settings.tsx src/pages/reports.tsx` (and delete new hook if added)
2. **Rebuild** production build
3. **Restart** notary-log service

Because we didn't touch `export.ts` or `db.ts`, rollback is just UI files.

---

## Out of scope (do not add during this task)

- Merging fee cards
- Date-range export filter
- Moving Client Intake to its own nav item
- Extracting all of settings.tsx into 10 component files
- Cloudflare / Zo deploy automation changes
- Help section / print preview changes (already done separately)

---

## How to start (when ready)

```
Implement SETTINGS-REPORTS-UX-PLAN.md — Steps 1–5, verify locally, do not push GitHub.
```

---

## Success criteria

1. Settings landing: **Verify** and **Backup** visible without scrolling on a typical phone
2. All journal exports on **Reports** in ≤2 taps from bottom nav
3. No duplicate export buttons in Settings
4. Same backup/export/verify behavior as before (same lib functions)
5. All existing tests pass + manual checklist above

**Estimated time: ~1–1.5 hours total.**
