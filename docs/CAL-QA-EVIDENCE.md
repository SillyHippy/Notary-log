# Cal multi-tenant QA evidence

**Date:** 2026-07-19  
**Host:** https://notary-log-cal-sillyhippy.zocomputer.io  
**Verifier:** `bun scripts/verify-cal-host.mjs`

## E2E checks (live)

| Check | Result |
|-------|--------|
| Health `calHostMode: true` | PASS |
| Shared webhook ping 200 | PASS |
| Two notary register + Cal link | PASS |
| Slug forced = Cal username | PASS |
| Duplicate Cal username → 409 | PASS |
| Public book pages both slugs | PASS |
| Webhook routes `joseph-joe-rf2msf` → user A only | PASS |
| Webhook routes `justlegalsolutions` → user B only | PASS |
| Cross-account booking isolation | PASS |
| `BOOKING_REQUESTED` → PENDING status | PASS |
| patchCal after register (no Unauthorized race) | PASS |
| Deployed Settings UI (token auto + race fix) | PASS |

## Unit tests

| Suite | Tests | Result |
|-------|-------|--------|
| `scripts/cal-routes.test.ts` | 8 | PASS |
| `booking-prefill.test.ts` | 2 | PASS |
| `entry-signers.test.ts` | 4 | PASS |
| `signing-appointment.test.ts` | 16 | PASS |
| `signing-group.test.ts` | 5 | PASS |

## Fixes in this pass

1. **Unauthorized on Cal save** — stale browser token shown as ready after DB resets; Cal save now calls `resolveWorkingNotaryToken()` before PATCH.
2. **Token UI** — Settings auto-creates account, shows token only after server `/api/me` validation.
3. **Multi-account isolation** — verified live with two Cal usernames; no cross-contamination.

## User flow (cal host)

1. Open Settings → account token auto-created (step 1).
2. Paste Cal username → **Save Cal link** (step 2).
3. Copy shared webhook URL + secret into Cal (step 3).
4. Share `/book/{cal-username}` (step 4).
5. Bookings tab → **Start journal entry** (single signer prefill from Cal attendee name).

Multi-signer journal: use **Signing appointment** mode on new entry after first signer (covered by signing-appointment unit tests).
