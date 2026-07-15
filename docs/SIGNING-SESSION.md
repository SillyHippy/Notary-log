# Signing Session — User Guide

## What it does

**Signing Session** lets you notarize **one signer** against **multiple documents** in a single workflow:

1. Enter signer + ID **once**
2. Add each document/act (e.g. 6 affidavits of service + 1 non-service)
3. Capture **one signature** (if required in Settings)
4. Complete once → the app creates **separate journal entries** (separate entry numbers)

**Print/PDF:** Each act appears on its **own line** in the journal table export — same as a paper log.

## How to start

- **Desktop sidebar:** Signing Session
- **Journal page:** Signing Session button
- **URL:** `/entry/new/session`

## Grouped view

Entries from the same session share a **signing group ID** (metadata only — not part of the tamper-evident hash).

- **Journal:** Collapsible group header with act count; expand to see each line
- **Entry detail:** Links to sibling acts in the same signing
- **Print signing:** Exports only the lines in that group

## Multi-signer (same document)

**Add Another Signer** still creates a **new entry per person**, but entries are **linked** with the same group ID when you use that flow from a completed entry.

## Settings

- **Require signer signature:** Off = skip signature step (PA-style)
- **Zo / Google backup:** Manual or auto backup still exports JSON snapshots of all entries

## Dev deploy

- **notary-log-dev:** https://notary-log-dev-sillyhippy.zocomputer.io (port 3002)
- **notary-log-test (Ken):** https://notary-log-test-sillyhippy.zocomputer.io (port 3001) — frozen for stakeholder feedback
