# Multi-Signer Signing Appointments — Research & Implementation Plan

**Checkpoint:** 2026-07-15  
**Status:** ✅ **Implemented** on `notary-log-dev` (port 3002)  
**Builds on:** `feature/signing-session` / dev deploy (`notary-log-dev`, port 3002)  
**Related doc:** `SIGNING-SESSION-IMPLEMENTATION-PLAN.md` (same signer, many documents — **done**)

---

## 1. What the user wants (product intent)

One **named appointment** in the app (e.g. “Western Sierra Loan Signing”, “Office Building Signing — Glenpool”):

| Layer | Behavior |
|--------|----------|
| **Appointment header** | Custom group name visible in journal (not document names, not only signer name) |
| **Multiple signers** | 3+ people, each with own name, address, ID — **scan ID once per person**, reuse for every document they sign |
| **Multiple documents** | 10+ docs; per document: act type (ack / jurat / …), which signers are on that doc |
| **Stamps / fees** | User chooses per document: **one act / one stamp** (shared acknowledgment cert) vs **per-signer acts**; fee auto-calculated |
| **Dashboard** | Scroll/find by appointment name or signer; expand to see signers → documents |
| **Print / PDF** | **Normal paper-style log** — separate line(s) per notarial act; grouping is **UI only** unless state allows otherwise |

**Efficiency rule:** Billy Bob’s ID is captured once at the start of the appointment; he is not re-scanned for each of his 7 affidavits.

---

## 2. Legal research — stamps, fees, journal lines

> **Not legal advice.** Confirm with commissioning state SOS, HB 2265 course (OK), and local practice.

### 2.1 Oklahoma (primary user context)

| Topic | Rule / practice |
|--------|------------------|
| **Max fee** | **$5.00 per notarial act** (49 O.S. § 49-5) — not per stamp impression, not per signer by default |
| **Two signers, one acknowledgment certificate** | Typically **one notarial act** on that document → **$5 total**, **one seal/stamp block** on the certificate |
| **Journal (HB 2265, effective Nov 1, 2025)** | Tamper-evident journal for **all** notarial acts; entries include date/time, act type, individuals involved, ID method, etc. |
| **SOS FAQ (pre-2265, still illustrative)** | Recommended journal fields include **name and address of each person** for whom an act was performed — even when one act covers multiple people on one cert |
| **Journal line count** | Statute frames entries around **notarial acts**. One shared ack cert = **one act** for fee purposes, but **both individuals** should appear in the record somewhere clear |

**App takeaway (OK):** For “2 people, 1 deed, 1 shared acknowledgment cert” → default **1 fee unit ($5)**, **1 stamp**, journal should still **show both signers** (either one row listing both or two linked rows with fee only on the “primary” act — see §4).

### 2.2 Pennsylvania (contrast — stricter fee split)

| Topic | Rule |
|--------|------|
| **Acknowledgment, same certificate** | **$5** first name + **$2** each additional name on the **same** certificate (4 Pa. Code § 167.3) |
| **Journal** | One **complete entry per notarial act**; separate lines per signer is the safe default |

**App takeaway:** Fee engine **cannot** be “always $5 × stampCount” — needs **state profile** (OK flat per act vs PA tiered per name on cert).

### 2.3 Other states (high level)

| Pattern | Examples | Implication for app |
|---------|----------|---------------------|
| **Separate journal entry per notarial act** | NNA default; CA strict | Print = one line per act; conservative generator |
| **Separate entry per signer** | CO SOS guidance | 3 signers × 1 doc may = **3 journal lines** even if one physical cert (state-dependent) |
| **Can group multiple docs, same signer, same time** | NV (optional), CA (limited, same signer) | UI grouping OK; print may still split |
| **Per-signature / per-declarant fees** | PA jurat $5 per declarant; witness $5 per signature | Act type matters, not just ack |

### 2.4 Stamp vs fee vs journal line (do not conflate)

| Concept | Meaning |
|---------|---------|
| **Physical stamp / seal** | How many times the notary affixes seal on certificates — often **one block per notarial act** |
| **Billable notarial act** | What statute counts for **$5 (OK)** or **$5+$2+… (PA ack)** |
| **Journal row on export** | What the **PDF/table** shows — should default to **one complete row per notarial act** for compliance |

The app should expose per document:

- **Signers on this document** (checkboxes from roster)
- **Certificate style:** “Shared acknowledgment (one act)” vs “Separate certificate per signer”
- **Fee preview** using **Settings → commission state**
- **Stamp count** (for user’s own tracking / `stampCount` field) — default from fee acts, overridable

---

## 3. What exists today (dev branch)

| Feature | Status |
|---------|--------|
| Same signer, comma-separated multi-document on **+** wizard | ✅ Done |
| Per-document act type toggle | ✅ Done |
| Auto fee = rate × act count (same signer) | ✅ Done (OK-style flat rate) |
| `signingGroupId` + journal collapse by group | ✅ Done |
| Group header shows **signer name + date + ID + act + total fee** | ✅ Done |
| “Add another signer” → new entry, shared `signingGroupId` | ✅ Partial — **no appointment name**, **re-scan ID each time**, no document matrix |
| Custom `signingGroupLabel` (e.g. “Western Sierra”) | ⚠️ Field exists; **not** in main + workflow |
| Signer roster / ID reuse | ❌ Not built |
| Multi-signer × multi-document matrix | ❌ Not built |
| State-aware fee tiers (PA $5+$2) | ❌ Not built |

**Important:** Today’s group is **one signer, many documents**. Multi-signer groups **collide** if we only use `signingGroupId` without a hierarchy — we need **`appointmentId`** (or nested labels) plus clear **entry generation rules**.

---

## 4. Recommended product shape

### 4.1 Two-level grouping

```
Appointment (signingGroupLabel: "Western Sierra Loan Signing")
├── Signer roster (in-memory + persisted on entries)
│   ├── Billy Bob Thornton  [ID scanned once]
│   ├── Jane Doe            [ID scanned once]
│   └── …
└── Document / act slots
    ├── Warranty Deed — Ack — signers: [Billy, Jane] — fee mode: shared cert (1 act)
    ├── Note — Ack — signers: [Billy] — 1 act
    └── …
```

**Journal UI (collapsed):**

```
Western Sierra Loan Signing · Mar 15 · 3 signers · 10 acts · $45.00
  ▼ expand
    Billy Bob · #101–104 · 4 acts · ID … · $20
    Jane Doe  · #105–107 · 3 acts · …
    …
```

**Print/PDF:** Unchanged principle — **one row per generated journal entry** (notarial act), not one row for the whole appointment.

### 4.2 Entry generation modes (Settings)

| Mode | When to use | Output |
|------|-------------|--------|
| **Conservative (default)** | PA, CO, unknown | **One `JournalEntry` per signer per document** (or per act type split) — fee on each or split per state rules |
| **OK shared cert** | User marks doc “one acknowledgment, all signers present” | **One entry** with primary signer + **`coSigners[]` metadata** *or* linked entries with `feeCharged: 0` on secondary rows — **must** list all names on print |
| **User override** | Edge cases | Per-doc stamp count + fee override |

**v1 recommendation:** Ship **Conservative** first (separate entries, shared appointment id, ID copied from roster — **no re-scan**). Add **OK shared-cert single fee** as v1.1 with explicit user toggle per document.

### 4.3 Why not one DB row with `signers[]` (Option B from earlier)

Still **avoid for v1** — hash chain, PA export, and amendments get painful. Instead:

- **One row per notarial act** (current model)
- **`appointmentId`** + **`signingGroupLabel`** tie rows together
- **`signerIndexInAppointment`** optional ordering
- Roster fields **copied** onto each entry at complete time (tamper-evident snapshot)

---

## 5. Data model additions

**File:** `src/lib/db.ts`

```ts
// New optional fields on JournalEntry (backward compatible)
appointmentId?: string;           // uuid — top-level "Western Sierra" session
appointmentLabel?: string;        // display name
signerSlotId?: string;            // uuid — stable id within appointment roster
signerIndexInAppointment?: number;
documentSlotId?: string;          // uuid — which doc row in the matrix
coSignerNames?: string[];         // v1.1 — shared cert only (names only on primary row)
feeAllocation?: 'primary' | 'split' | 'waived';  // for linked rows
certificateStyle?: 'shared' | 'individual';
```

Keep existing `signingGroupId` for **same-signer multi-doc** groups; **`appointmentId`** is the parent when multiple signers participate. Option: merge concepts — `signingGroupId` = appointment id everywhere (simpler).

**New types file:** `src/lib/signing-appointment.ts`

```ts
interface SignerRosterEntry {
  slotId: string;
  signerFullName: string;
  address: …;
  idType, idNumber, idImages, signatureImage?;
  // captured once
}

interface DocumentActSlot {
  slotId: string;
  documentType: string;
  notarialActType: NotarialActType;
  signerSlotIds: string[];       // who signs this doc
  certificateStyle: 'shared' | 'individual';
  stampCount?: number;           // override
  feeCentsOverride?: number;
}

interface SigningAppointmentPayload {
  appointmentId: string;
  appointmentLabel: string;
  location, completedAt;
  roster: SignerRosterEntry[];
  documents: DocumentActSlot[];
}
```

**New backend function:**

```ts
createAndCompleteSigningAppointment(payload, settings): Promise<number[]>
```

Expands matrix → N `JournalEntry` drafts → sequential `createEntry` + `completeEntry`.

---

## 6. Fee engine

**New file:** `src/lib/fee-rules.ts`

| State profile | Ack shared cert (n signers) | Ack individual certs | Jurat (n declarants) |
|---------------|----------------------------|----------------------|----------------------|
| **OK** (default) | $5 × **1 act** | $5 × **n acts** | $5 × **n acts** |
| **PA** | $5 + $2×(n−1) on **one entry** or split | $5 × n | $5 × n |
| **Generic** | $5 × act count (user confirms) | $5 × n | $5 × n |

- Read **`settings.commissionState`** (or new `feeSchedule` override).
- Wizard shows **live fee preview** per document and appointment total.
- **`stampCount`** on each entry defaults from generated act count; user can bump (travel packages, etc.).

---

## 7. Wizard UX (unified + button flow)

User asked for **same workflow as today** — extend the **+** path, not a hidden separate page.

### Proposed steps

| Step | Content |
|------|---------|
| **0. Mode** | Toggle: **Single entry** (today) / **Signing appointment** (multi-signer and/or multi-doc) |
| **1. Appointment** | Optional label: “Western Sierra Loan Signing”; location; date/time |
| **2. Signers** | Add signer → scan/type ID → **Add another signer** (roster list). **No document yet.** |
| **3. Documents** | For each row: document type, act type, **which signers** (checkboxes), shared vs individual cert, stamp hint |
| **4. Signatures** | If required: capture **once per signer** on roster (not per document) |
| **5. Review** | Tree preview: appointment → signers → docs → **fee total** → entry count |
| **Complete** | Bulk create + chain verify toast |

**Reuse:** `IdScanCard`, `createAndCompleteSigningSession` patterns, `buildJournalDisplayRows`.

**Remove / avoid:** Separate “Signing Session” nav-only entry (already removed on dev); keep one **+** flow.

---

## 8. Journal & export changes

| File | Changes |
|------|---------|
| `src/lib/signing-group.ts` | **`buildAppointmentDisplayRows()`** — nest: appointment → signer subgroups → entries |
| `src/pages/journal-list.tsx` | Collapsed: **appointment label**; expand level 2: **signer name**; level 3: documents |
| `src/lib/export.ts` | `exportAppointmentPDF(appointmentId)` — sequential per-entry lines |
| `src/pages/entry-detail.tsx` | Show appointment label + sibling signers/docs |

**Search:** Match appointment label, any signer name, entry #.

---

## 9. Files to touch (by phase)

### Phase A — Plan / spike (this doc) ✅
- `docs/MULTI-SIGNER-SIGNING-PLAN.md`

### Phase B — Backend
- `src/lib/db.ts` — appointment fields, `createAndCompleteSigningAppointment`
- `src/lib/signing-appointment.ts` — new
- `src/lib/fee-rules.ts` — new
- `src/lib/signing-appointment.test.ts` — matrix expansion, OK vs PA fees
- `src/lib/signing-group.ts` — nested display helpers

### Phase C — Wizard
- `src/pages/new-entry.tsx` **or** `src/pages/signing-appointment.tsx` + route from +
- `src/lib/completion.ts` — roster + slot validation
- `src/components/SignerRosterCard.tsx` — new
- `src/components/DocumentActMatrix.tsx` — new

### Phase D — Journal / export
- `journal-list.tsx`, `entry-detail.tsx`, `export.ts`

### Phase E — Settings
- `settings.tsx` — fee schedule state, default cert style, journal output mode (conservative)

### Phase F — Deploy
- Build on **`notary-log-dev` only** until QA passes
- Do **not** touch `notary-log-test` (Ken)

---

## 10. Testing matrix

| Scenario | Expected |
|----------|----------|
| 1 signer, 4 docs, all ack | 4 entries, 1 group, $20 OK |
| 3 signers, 1 deed, shared ack, OK | 1–3 entries per mode; **$5 total** in shared mode |
| 3 signers, 1 deed, individual ack, OK | 3 entries, **$15 total** |
| Same as above, PA shared | **$9** ($5+$2+$2) on appropriate rows |
| ID scan 3 signers, 10 docs | Each signer scanned **once**; 10+ entries have correct copied ID |
| Verify chain | Pass after appointment complete |
| Print appointment | N lines, one document (and signer) per line |
| Signature off (PA) | Complete without pad; data persists |

---

## 11. Effort & confidence

| Scope | Effort (with AI assist) | Confidence |
|-------|-------------------------|------------|
| **B + Conservative entry gen + roster ID reuse** | **3–5 days** | **High** |
| **Nested journal UI (appointment → signer → doc)** | **+2 days** | **High** |
| **State fee rules (OK + PA)** | **+1 day** | **Medium** (needs user verification) |
| **OK shared-cert single row w/ co-signers on print** | **+2 days** | **Medium** (legal display wording) |
| **Full hybrid setting (conservative vs OK vs PA)** | **+2–3 days** | **Medium** |

**Easiest high-confidence slice:** Appointment label + signer roster (ID once) + document matrix + **conservative separate entries** + nested journal header — **no shared-cert fee optimization yet**.

---

## 12. Open questions (for user / Ken)

1. **Print:** Always **one line per signer per document** — confirm OK for Ken’s states?
2. **Appointment naming:** Required or optional?
3. **Primary state for fee defaults:** OK only first, or OK + PA?
4. **Shared acknowledgment on one deed (2 signers):** Show as **one journal line listing both names** or **two lines, fee on first only**?
5. **Ken’s ask:** Grouped **UI** only vs **one printed line** — still waiting on his answer; this plan assumes **UI group, print splits**.

---

## 13. Checkpoint decision

**Complete.** Phases B–F implemented:

- [x] Backend: `signing-appointment.ts`, `fee-rules.ts`, `createAndCompleteSigningAppointment`
- [x] Wizard: `SigningAppointmentWizard` via + button → "Signing appointment"
- [x] Journal: nested appointment → signer → document rows
- [x] Export: `exportAppointmentPDF` (one line per act)
- [x] Settings: fee schedule hint on Default State
- [x] Tests: 189/189 pass
- [x] Deploy: `notary-log-dev` (3002) — Ken test (3001) untouched

---

## 14. Goal-setting phrase (when ready)

```
Implement multi-signer signing per MULTI-SIGNER-SIGNING-PLAN.md — Phase B through D on notary-log-dev, conservative entry mode, OK fee defaults.
```
