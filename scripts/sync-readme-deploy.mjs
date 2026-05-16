import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const intro = `# Notary Journal PWA

A fast Progressive Web App (PWA) for modern notaries: offline support, local encryption, ID scanning, signatures, and print-ready journal PDFs.

The journal runs in the browser (IndexedDB). Optional server features — client intake form and Zo JSON backup — use \`server.ts\` (Zo), Netlify Functions, or Cloudflare Workers + KV. Static-only hosts (drag-and-drop zip, Cloudflare Pages) work for the journal only, not intake.

> [!WARNING]
> **STRICT NON-COMMERCIAL LICENSE**
> This repository is governed by a Custom Non-Commercial License. It is 100% free to deploy for personal use, but **it may NOT be sold, monetized, or used for commercial SaaS purposes** under any circumstances. See the [LICENSE](LICENSE) file before deploying.

> **This README is the deployment guide.** It matches [DEPLOYMENT.md](DEPLOYMENT.md). Cloudflare **Workers** (git-connected) settings are in **Option 4** — not Cloudflare Pages.

`;

const deployment = readFileSync(join(root, "DEPLOYMENT.md"), "utf8");
writeFileSync(join(root, "README.md"), intro + deployment);
