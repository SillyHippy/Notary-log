# Checkpoint — Notary-log dev (2026-07-15)

**Status:** Stable, user-approved — *"how we have it right now is very nice"*

Use this document to restore context or roll back to this known-good state.

---

## Deploy

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| **notary-log-dev** | 3002 | https://notary-log-dev-sillyhippy.zocomputer.io | All signing-session + appointment work |
| **notary-log-test** | 3001 | https://notary-log-test-sillyhippy.zocomputer.io | Ken feedback line — **do not redeploy** |

**Verification at checkpoint:**
- HTTP health: **200**
- Tests: **202/202** pass (`pnpm --filter @workspace/notary-journal run test`)
- Branch: `feature/signing-session` (local; many changes **not yet committed** — see Git section)

---

## What works (feature summary)

### 1. Single-entry flow (+ button)

- Standard wizard: signer → ID → notarial act → signature → review → complete
- **Comma-separated document types** on step 3 (e.g. `Deed, Affidavit, Will`)
- Checkbox: **"One journal line per document"** — split vs one combined line
- Auto fee preview: `$5 × N acts = total`; stamp count matches document count
- Optional: **different act type per document** (ack, jurat, etc.)
- Auto-location on step 3 (city/state/address when GPS available)
- Settings compliance toggles respected (DOB, ID #, signature, ID photo)
- Draft save + restore

### 2. Signing appointment flow (+ → Signing appointment)

- **Appointment label** (e.g. "Western Sierra Loan Signing")
- **Signer roster** — add multiple people; **ID scan once per person** (barcode, photo/OCR, passport MRZ)
- **Documents step** — comma-separated docs (same as single-entry), per-doc act type, signer checkboxes per doc
- **Shared certificate** checkbox per document — Ken/PA one-line mode
- Auto-location on appointment step
- **Save as Draft** / **Save Draft & Continue** — plan ahead; drafts in Journal → Drafts
- localStorage restore if browser closes mid-wizard

### 3. Ken / PA — combined co-signers on one journal line

When **multiple signers share one stamp/certificate** on one document:

- Check **"Shared certificate (one stamp / one act for all signers on this doc)"**
- With PA default state (or Settings combined-line default on):
  - **1 entry #** with signer #1, #2, #3 on **one journal row**
  - `additionalSigners[]` stores each person's name, address, ID
  - Fee: PA tier ($5 + $2 per extra name on shared cert)
- Print/PDF: **one row**, taller/self-adjusting when multiple names

**Unchecked** shared cert → separate entry per signer (conservative mode).

### 4. Journal UI

- **Grouped signings** collapse to: entry range, **date**, **signer name**, **ID #**, **act type**, **total fee**, "N acts" badge
- Expand row → each document on its own sub-line
- **Print group** for linked signings
- Entry detail: sibling links within same `signingGroupId`

### 5. Settings defaults (State Compliance section)

| Setting | Field | Default behavior |
|---------|-------|------------------|
| Require signer signature | `requireSignerSignature` | On |
| Default: combine co-signers on one journal line | `journalSharedCertMode` | PA → `combined_line`; others → `separate_lines` unless toggled |
| Default: one journal line per document | `journalSplitDocumentsDefault` | On (split comma-separated docs) |

**Per-signing override:** Both checkboxes still appear in each wizard so the notary can change layout for that signing without changing Settings.

### 6. Fee rules

- OK: $5 per notarial act (shared cert = 1 act)
- PA: $5 first signer + $2 each additional on shared certificate
- Generic fallback when state not specialized
- Auto-calculated from document count × stamp fee

### 7. PDF / print

- One row per journal entry (unchanged compliance shape)
- **Self-adjusting row height** for multi-signer combined lines and long document names
- Group print exports all acts in a signing

---

## Two-checkbox model (not one master switch)

| Checkbox | Dimension | Checked | Unchecked |
|----------|-----------|---------|-----------|
| **One journal line per document** | Multiple documents | Separate lines per doc | All doc names on one line |
| **Shared certificate** | Multiple signers on one doc | One line, all signers (#1 #2 #3) | Separate line per signer |

**Do not** combine 50 docs × 50 signers into one entry # — compliance expects per-act clarity on print.

**Typical matrix:**
- 1 signer, 7 affidavits → 7 print lines (split docs on)
- 3 signers, 1 deed, shared cert → 1 print line (PA/Ken)
- 3 signers, 10 docs, shared cert each → 10 print lines, each may list all 3 signers

---

## Key files at this checkpoint

| Area | Files |
|------|-------|
| Data model | `src/lib/db.ts` — `signingGroupId`, `additionalSigners`, settings fields |
| Appointment backend | `src/lib/signing-appointment.ts`, `signing-appointment.test.ts` |
| Fee rules | `src/lib/fee-rules.ts`, `fee-rules.test.ts` |
| Entry signers | `src/lib/entry-signers.ts`, `entry-signers.test.ts` |
| Geolocation | `src/lib/geolocation.ts`, `geolocation.test.ts` |
| Group helpers | `src/lib/signing-group.ts`, `signing-session.ts` |
| Single-entry + comma docs | `src/pages/new-entry.tsx` |
| Appointment wizard | `src/pages/signing-appointment-wizard.tsx` |
| Journal grouping | `src/pages/journal-list.tsx` |
| Entry detail | `src/pages/entry-detail.tsx` |
| Settings toggles | `src/pages/settings.tsx` |
| PDF export | `src/lib/export.ts` (dynamic row heights) |
| Docs | `docs/SIGNING-SESSION.md`, `docs/MULTI-SIGNER-SIGNING.md`, `docs/MULTI-SIGNER-SIGNING-PLAN.md` |

---

## Known gaps (intentionally not in this checkpoint)

- Appointment **complete** validation lighter than single-entry for ID photo / DOB strict blocking
- `feature/signing-session` work **not fully committed/pushed** to GitHub (local only)
- No new GitHub beta tag for this checkpoint yet
- Ken's test deploy (3001) on older `v1.0.4-beta.1` line
- Multi-signer on regular + flow still uses "Add another signer" → separate entry # unless appointment wizard used
- Settings compliance on appointment: fields show/hide per Settings; strict complete blocking not fully mirrored

---

## Quick manual QA checklist

- [ ] + → comma docs `A, B, C` → 3 entries, grouped in journal
- [ ] + → Signing appointment → 3 signers, scan/type ID each once
- [ ] 1 doc, shared cert on, PA state → 1 entry, all names on line
- [ ] Print journal → combined line row is taller, all signers visible
- [ ] Settings → toggle combined-line default → wizard checkbox follows
- [ ] Save draft mid-appointment → appears in Drafts
- [ ] Settings → Verify entire journal → chain intact

---

## Git state at checkpoint

```
Branch: feature/signing-session
Last commit: bef92a5 (signing session workflow — earlier phase)
Uncommitted: appointment wizard, fee rules, PA combined line, settings defaults,
             geolocation, entry-signers, PDF row heights, draft save, etc.
```

**To preserve in git:** commit + tag e.g. `v1.0.6-beta.1-checkpoint` when ready.

---

## Related conversation context

- **Ken (PA):** Multiple signers per stamp = one entry #, signer #1 #2 #3 on one line — **implemented** via shared certificate + `additionalSigners`
- **User preference:** Unified + button workflow; comma-separated docs on step 3; Settings defaults + per-signing override checkboxes
- **Oklahoma:** HB 2265 journal requirement — per-act print lines; appointment flow supports 7 affidavits = 7 lines
- **Do not touch:** notary-log-test (3001) while Ken reviews

---

*Checkpoint saved: 2026-07-15. Resume from here with: "Continue from CHECKPOINT-2026-07-15.md"*
