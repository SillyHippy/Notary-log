# Manual Test Plan — Task #17 (Passport MRZ + License OCR Fallback)

These tests cover the parts of the scanner that automated unit tests cannot
reach: the camera permission flow, real-world OCR quality, and the wizard
end-to-end on a real device. Run on an Android phone in Chrome (the primary
target for this PWA).

## Setup
1. `pnpm --filter @workspace/notary-journal dev` and load the dev URL on the
   device.
2. Sign in / unlock the journal so the New Entry wizard is reachable.
3. Make sure the device camera permission is granted to the site.

## Test 1 — Real US driver's license (OCR fallback)
1. From the dashboard, tap **New Entry**.
2. On the Scan ID step, leave **Driver's License** selected (default).
3. Tap **Take Photos (OCR)**.
4. Capture the **front** of a real, clearly-lit driver's license.
5. Capture the **back** of the same license.
6. Wait for the OCR toast, then tap **Skip Scanning** is *not* needed —
   tap the **Next** button.

### Pass criteria
- Signer step shows: full name, address, city, state, ZIP, DOB, ID number,
  expiration date — all populated and readable.
- Any field that is wrong is **editable** (no field is locked by the scan).
- If OCR confidence was below 70 %, the amber **Review Extracted Data**
  banner is visible at the top of the Signer step.

### Fail criteria
- Wizard crashes or shows a console error.
- Required signer fields are blank when the printed license clearly contains
  them.
- The OCR banner does not appear despite a low-confidence scan.

## Test 2 — Real passport (MRZ scan)
1. Start a new entry.
2. On the Scan ID step, tap **Passport** in the segmented control. Verify
   the helper copy changes to *"Photograph the full data page of the
   passport so the two lines of monospace text at the bottom (the MRZ) are
   sharp and well-lit."* and that **Scan Barcode** is no longer offered.
3. Tap **Take Photo (MRZ)**.
4. Photograph the data page of a real passport so the bottom two MRZ lines
   are entirely in frame, sharp, and unobscured.
5. Wait for the MRZ toast, then tap **Next**.

### Pass criteria
- Signer step shows: full name (given names + surname), DOB, ID number
  (passport number), issuing authority (3-letter country code, e.g. `USA`),
  expiration date — all populated.
- The **address / city / state** fields are *not* required (no validation
  error when they're blank) — the wizard advances to the Notarial Act step.
- If any MRZ check digit failed, an amber **MRZ Check Digit Mismatch**
  banner is visible at the top of the Signer step listing the failing
  field(s).
- If OCR confidence was below 70 %, the same banner mentions
  *"low OCR confidence (NN %)"*.

### Fail criteria
- Required signer fields are blank when the MRZ is clearly readable.
- Wizard refuses to advance from Signer step due to address validation.
- No warning banner appears even though one or more check digits failed.

## Test 3 — Document-type round trip
1. Start a new entry.
2. Toggle **Driver's License → Passport → ID Card → Driver's License**.
   Verify the helper text and scan buttons update on each toggle.
3. Cancel out of the wizard.

### Pass criteria
- The toggle updates UI state without console errors and without locking
  the user into a single document type.

## Notes for the tester
- Take screenshots of any failure mode and attach them to the task ticket.
- For Test 2, if you do not have a real passport handy, photograph a high-
  resolution image of a sample passport printed on matte paper at full
  size; this is sufficient for OCR validation but should not be used as a
  substitute for the on-device camera test before release.
