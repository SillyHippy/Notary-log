# notary-log-cal — Zo HTTP service runbook

**Created:** 2026-07-19  
**GitHub:** **DO NOT PUSH** feature work to `main` / public Worker. Local + this Zo service only until Joseph ships.

| Field | Value |
|-------|--------|
| Label | `notary-log-cal` |
| service_id | `svc_2jgMuq0ptpw` |
| Mode | `http` public |
| Port | **3003** |
| Workdir | `/home/workspace/Projects/Notary-log` |
| Public URL | https://notary-log-cal-sillyhippy.zocomputer.io |
| Health | https://notary-log-cal-sillyhippy.zocomputer.io/api/health |
| Data dir | `./Documents/Notary Journal Cal` (isolated from prod) |
| Prod notary-log | port **3000**, data `./Documents/Notary Journal` — **do not mix** |
| Proxy `/notary/` | still → 3000 only — **cal host is separate subdomain** |

## Env (supervisor)

```
PORT=3003
JOURNAL_DIR=./Documents/Notary Journal Cal
NOTARY_NAME=Cal Host Dev
NOTARY_EMAIL=cal-dev@localhost
NODE_ENV=production
CAL_HOST_MODE=1
```

## Verified at registration

| Check | Result |
|-------|--------|
| supervisor `notary-log-cal` | RUNNING |
| `GET :3003/api/health` | 200 |
| `GET https://notary-log-cal-sillyhippy.zocomputer.io/api/health` | 200 |
| `GET :3000/api/health` (prod) | 200 unchanged |
| Separate `notary.db` under Cal dir | yes |

## Logs

```bash
tail -f /dev/shm/notary-log-cal.log
tail -f /dev/shm/notary-log-cal_err.log
supervisorctl -s http://127.0.0.1:29011 restart notary-log-cal
```

First-boot intake token + backup key are in the log on first start. Re-read log after wipe DB; do not commit secrets to GitHub.

## Code note

`server.ts` supports `JOURNAL_DIR` env (default remains `./Documents/Notary Journal` for prod). Prod process must **not** set `JOURNAL_DIR` to the Cal path.

## After Cal feature builds

```bash
cd /home/workspace/Projects/Notary-log
# prefer BASE_PATH empty for this subdomain host
bun run build
supervisorctl -s http://127.0.0.1:29011 restart notary-log-cal
curl -s https://notary-log-cal-sillyhippy.zocomputer.io/api/health
```

## Forbidden

- Push to GitHub `main` / tags that auto-deploy Worker  
- Restart/redeploy `notary-log-test` (Ken) if it returns  
- Point Cal webhooks at prod `/notary/` until ship  
- Share Cal SQLite with prod Journal dir  
