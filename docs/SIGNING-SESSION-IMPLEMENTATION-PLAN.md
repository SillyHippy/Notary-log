# Signing Session + Linked Groups — Implementation Plan

**Repo:** `SillyHippy/Notary-log`  
**Branch:** `feature/signing-session`  
**Ken’s test URL (frozen):** `https://notary-log-test-sillyhippy.zocomputer.io` (port 3001)  
**Dev URL:** `https://notary-log-dev-sillyhippy.zocomputer.io` (port 3002)

**Completed:** 2026-07-15

---

## Research summary

### Compliance target
| Layer | Behavior |
|--------|----------|
| **UI** | One signing: signer + ID once, N document/act rows, one signature |
| **Database** | N `JournalEntry` rows, shared signer/ID/signature, different doc/act/fee each |
| **Print/PDF** | One line per act (`exportJournalTablePDF` = one row per entry) |
| **Hash chain** | Unchanged: `createEntry` + `completeEntry` per row |

### Tracks
| Track | Story |
|--------|--------|
| **A — Linked multi-signer** | Same deed, different people → separate lines, UI group (Ken) |
| **B — Signing session** | Same person, many documents → fill once, N print lines |

**Shared:** `signingGroupId`, optional `signingGroupLabel`, `actIndexInGroup`.

---

## Implementation checklist

### Phase 0 — Deploy isolation
- [x] Create branch `feature/signing-session` from current beta work
- [x] Copy/deploy tree → `/home/workspace/Notary-log-dev`
- [x] Register Zo HTTP service `notary-log-dev` on **PORT 3002**
- [x] Separate journal data path (separate origin = automatic)
- [x] Document URL → **https://notary-log-dev-sillyhippy.zocomputer.io**
- [x] **Do not** redeploy 3001 except Ken hotfixes

### Phase 1 — Core backend
- [x] Add optional group fields to `JournalEntry` in `src/lib/db.ts`
- [x] Create `src/lib/signing-session.ts`
- [x] Implement `createAndCompleteSigningSession()` in `db.ts`
- [x] Implement `getEntriesBySigningGroup(groupId)`
- [x] Add `src/lib/signing-session.test.ts`
- [x] Run vitest — **170 passed**

### Phase 2 — Wizard UI
- [x] Create `src/pages/signing-session.tsx`
- [x] Add route `/entry/new/session` in `App.tsx`
- [x] Entry point: nav + journal “Signing Session”
- [x] Reuse `IdScanCard` for ID scan
- [x] Session-level validation in `completion.ts`

### Phase 3 — Dashboard / journal
- [x] `journal-list.tsx`: group rows by `signingGroupId` (collapsible header)
- [x] `entry-detail.tsx`: sibling links + group label
- [x] `signing-group.ts` + tests

### Phase 4 — Export / print
- [x] `exportSigningGroupPDF()` in `export.ts`
- [x] Entry detail + journal group “Print group” buttons
- [x] Printed output = N lines, one document per line

### Phase 5 — Multi-signer link
- [x] Pass `signingGroupId` on “Add another signer” prefill
- [x] `new-entry.tsx` assigns group + `actIndexInGroup` on complete

### Phase 6 — Ship
- [x] `pnpm run build` succeeded
- [x] **notary-log-dev** serving new build (port 3002)
- [x] `docs/SIGNING-SESSION.md` user guide
- [x] Push branch + tag `v1.0.5-beta.1`
- [x] Plan updated with completion date

---

## Testing matrix

| Test | Pass criteria | Status |
|------|----------------|--------|
| 1 act session | 1 entry | Manual on dev |
| 7 acts, 1 signer | 7 entry numbers, shared signer | Manual on dev |
| Chain verify | Settings → all pass | Manual on dev |
| Table PDF | N rows, distinct document column | `exportSigningGroupPDF` |
| Signature off (PA) | Session completes without signature step | UI skips step |
| Group UI | Journal shows collapsed group | Implemented |

---

## Goal trigger (for user)

**`Go signing session plan — Phase 0 through 6`**

Agent: read this file, execute checklist, build, test, deploy **notary-log-dev** only.
