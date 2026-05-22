# Zo Computer setup (extended reference)

The primary deploy flow is the **delete + deploy prompts** in [README.md](../README.md#option-1-zo-computer-recommended). This page adds troubleshooting and optional details.

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
| `Documents/Notary Journal/.zo-intake-token` | Primary intake token (same as logs) |
| `Documents/Notary Journal/intake/{token}/` | Uploaded ID images per Zo user token |
| `Documents/Notary Journal/intake/*.json` | Web3Forms webhook submissions |
| `Documents/Notary Journal/backups/` | Zo backup JSON files |

## Notary user (automatic)

On first server start, if the `users` table is empty, `server.ts` creates one notary and logs:

- `Zo Intake Token (new notary — paste in Settings): ...`
- Writes the same token to `Documents/Notary Journal/.zo-intake-token`

Optional environment variables on the Zo service:

| Variable | Purpose |
|----------|---------|
| `NOTARY_NAME` | Display name for the auto-created user (default: Primary Notary) |
| `NOTARY_EMAIL` | Email for notifications (default: notary@localhost) |
| `ZO_API_KEY` | Zo Advanced — enables intake confirmation emails |
| `BACKUP_KEY` | Fixed backup API secret (otherwise auto-generated) |

## Add another notary user (optional)

Only needed for multi-notary on one Zo box:

```bash
cd /home/workspace/Notary-log
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('./Documents/Notary Journal/notary.db');
const token = crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'');
db.run('INSERT INTO users (id, token, name, email) VALUES (?, ?, ?, ?)',
  [crypto.randomUUID(), token, 'Second Notary', 'second@example.com']);
console.log('Token:', token);
"
```

## Intake modes

| Mode | When | Client link | Notary dashboard |
|------|------|-------------|------------------|
| **Zo** | Zo deploy + token in Settings | `/intake?key=<zoToken>` | Client Requests via `/api/intake?key=` |
| **Web3Forms** | No Zo token (any host) | `/intake?key=<web3formsKey>` | Web3Forms email + webhook JSON files |

Both modes can coexist on Zo: Zo token takes precedence in Settings when the app runs on `*.zocomputer.io`.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Service won't start | `cat /dev/shm/notary-log.log` — ensure `bun run build` completed |
| 404 on app URL | `service_doctor(service="notary-log")`, confirm `public=true` |
| Intake 401 for clients | Token in logs or `.zo-intake-token`; must match Settings |
| Client Requests empty (Zo) | Settings → Zo token matches `users.token` |
| Port conflicts | Do not set `local_port`; Zo sets `PORT` |
| Backup 401 | Copy exact `Zo Backup Key` from logs into Settings |
| Fresh deploy, old data | Delete service only; wipe `Documents/Notary Journal` only if you want a clean DB |

## Local development

```bash
bun i
bun run build
PORT=3000 bun run server.ts
```

Open `http://localhost:3000`. First start prints `Zo Intake Token` in the terminal — use it in Settings and `/intake?key=...`.

## Out of scope (v1)

- Settings UI to mint extra Zo tokens (SQL only for additional users)
- Separate `server-zo-multiuser.ts` service on port 3001
- Changes to `cloudflare/worker.ts` or Netlify functions for Zo intake
