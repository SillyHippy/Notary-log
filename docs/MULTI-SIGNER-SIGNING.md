# Multi-Signer Signing Appointments

**Status:** Implemented on `notary-log-dev` (feature/signing-session branch)

## What it does

One **named appointment** (e.g. "Western Sierra Loan Signing") with:

- **Multiple signers** — ID captured once per person, reused for every document they sign
- **Multiple documents** — per doc: act type, which signers, shared vs individual certificate
- **Fees** — OK ($5/act) and PA ($5 + $2 per additional name on shared ack) via Settings → Default State
- **Journal UI** — appointment → signer → document (nested collapse)
- **Print/PDF** — one line per journal entry (normal paper log)

## How to use (+ button flow)

1. Tap **+** (New Journal Entry)
2. Tap **Signing appointment (multiple signers)**
3. **Appointment** — optional name, location
4. **Signers** — add each person, enter ID once
5. **Documents** — add rows, check signers, toggle shared cert if one stamp for all
6. **Signatures** — once per signer (skipped if signature waived in Settings)
7. **Complete** — creates N journal entries with shared `appointmentId`

## Single-signer multi-document

Still works on the **Single signer** path: comma-separated document types on step 3.

## Data model (metadata, not in hash v1)

- `appointmentId`, `appointmentLabel`
- `signerSlotId`, `signerIndexInAppointment`
- `documentSlotId`, `certificateStyle`, `feeAllocation`, `coSignerNames`

## Tests

- `fee-rules.test.ts` — OK/PA fee tiers
- `signing-appointment.test.ts` — matrix expansion, ID reuse, shared cert
- `signing-group.test.ts` — nested appointment display rows
