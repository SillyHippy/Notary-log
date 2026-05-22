# Zo Computer setup (extended reference)

The primary deploy flow is the **single copy-paste prompt** in [README.md](../README.md#option-1-zo-computer-recommended). This page adds troubleshooting and optional details.

## Architecture

One HTTP service (`bun run server.ts`) serves:

| Path | Purpose |
|------|---------|
| `/` | Built PWA (`artifacts/notary-journal/dist/public`) |
| `/api/backup` | Encrypted journal backups (Bearer key) |
| `/api/intake` | Zo token → SQLite submissions + file uploads |
| `/api/intake-webhook` | Web3Forms JSON file drops (legacy/fallback) |
| `/api/health` | Health check |

## Storage layout

| Path | Contents |
|------|----------|
| `Documents/Notary Journal/notary.db` | SQLite (`users`, `submissions`, `files`) |
| `Documents/Notary Journal/intake/{token}/` | Uploaded ID images per Zo user token |
| `Documents/Notary Journal/intake/*.json` | Web3Forms webhook submissions |
| `Documents/Notary Journal/backups/` | Zo backup JSON files |

## Create or add a notary user

```bash
cd /home/workspace/Notary-log
bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('./Documents/Notary Journal/notary.db');
const token = crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'');
db.run('INSERT INTO users (id, token, name, email) VALUES (?, ?, ?, ?)',
  [crypto.randomUUID(), token, 'Your Name', 'you@example.com']);
console.log('Token:', token);
"
```

Paste the printed token into **Settings → Zo Computer Form Token**.

## Intake modes

| Mode | When | Client link | Notary dashboard |
|------|------|-------------|------------------|
| **Zo** | Zo deploy + token in Settings | `/intake?key=<zoToken>` | Client Requests via `/api/intake?key=` |
| **Web3Forms** | No Zo token (any host) | `/intake?key=<web3formsKey>` | Web3Forms email + webhook JSON files |

Both modes can coexist on Zo: Zo token takes precedence in Settings when the app runs on `*.zocomputer.io`.

## Optional email (`ZO_API_KEY`)

Set `ZO_API_KEY` in Zo Advanced. On Zo intake submit, the server notifies the signer and notary via `https://api.zo.computer/zo/ask`. Intake works without email configured.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Service won't start | `cat /dev/shm/notary-log.log` — ensure `bun run build` completed |
| 404 on app URL | `service_doctor(service="notary-log")`, confirm `public=true` |
| Intake 401 for clients | Token must exist in `users` table; re-run INSERT |
| Client Requests empty (Zo) | Settings → Zo token matches SQL `users.token` |
| Port conflicts | Do not set `local_port` in `register_user_service`; Zo sets `PORT` |
| Backup 401 | Copy exact `Zo Backup Key` from logs into Settings |

## Local development

```bash
bun i
bun run build
PORT=3000 bun run server.ts
```

Open `http://localhost:3000`. Create a SQLite user as above, then test `/intake?key=...`.

## Out of scope (v1)

- UI to mint Zo tokens (SQL INSERT only)
- Separate `server-zo-multiuser.ts` service on port 3001
- Changes to `cloudflare/worker.ts` or Netlify functions for Zo intake
