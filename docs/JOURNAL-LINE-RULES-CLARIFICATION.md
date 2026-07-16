# Journal line layout — clarified rules (2026-07-15)

User-approved mental model for how journal lines should behave on screen and in print.

## Two independent Settings defaults (both off/on configurable)

| Setting | Default | Meaning |
|---------|---------|---------|
| **One journal line per document** | **On** | Comma-separated docs → separate print lines per document |
| **Combine co-signers on one journal line** | **Off** | Multiple signers on one stamp → one entry # with #1 #2 #3 (Ken/PA rule) |

**During each signing:** both checkboxes still appear so the notary can override for that appointment.

**No state auto-on:** PA does not force combined-line mode. User turns it on in Settings if they want Ken/PA behavior.

---

## Default behavior (checkboxes unchecked / Settings defaults)

**One line per document per signer.**

| Scenario | Lines on print |
|----------|----------------|
| 1 signer, 1 document | 1 |
| 1 signer, 50 documents | 50 |
| 50 signers, 1 document | 50 |
| 50 signers, 2 documents | 100 |

---

## Override: combine signers (shared certificate / combined line)

When **multiple signers share one stamp** on a document and user checks **shared certificate** (or Settings default is on):

| Scenario | Lines on print |
|----------|----------------|
| 50 signers, 1 document | **1** — all names on one entry # |
| 50 signers, 2 documents (split docs default on) | **2** — one line per doc, each line lists all 50 signers |

**Signatures:**
- If **require signer signature** is ON → capture signature for each signer (all stored on combined line).
- If OFF (e.g. PA journal) → no signature photos required; names/ID/address only.

---

## Override: combine documents (uncheck “one journal line per document”)

When user does **not** split comma-separated documents onto separate lines:

| Scenario | Lines on print |
|----------|----------------|
| 1 signer, 2 documents | **1** — both doc names on one line |
| 50 signers, 2 documents (split signers default) | **50** — each signer gets one line listing both documents |

---

## Both overrides (combine signers + combine documents)

| Scenario | Lines on print |
|----------|----------------|
| 50 signers, 2 documents | **1** — all signers, both documents, one entry # |

Use sparingly; mainly for Ken/PA shared-cert on a single combined row.

---

## Ken / PA explicit requirement

> If there’s more than one signer per stamp it has to all be one entry. Signer #1 #2 #3 under entry #1.

Implemented via **shared certificate** + **combine co-signers** (Settings or per-doc checkbox).

---

## PDF / print

Rows must **self-adjust height** when one line contains many signers or long document lists (already implemented on dev).
