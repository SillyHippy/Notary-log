#!/usr/bin/env node
/**
 * Build and deploy the PWA to Cloudflare Workers (static assets only).
 *
 * Usage:
 *   node scripts/cloudflare-deploy.mjs              # build + deploy
 *   node scripts/cloudflare-deploy.mjs --skip-build # deploy only (CI split steps)
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function main() {
  const skipBuild = process.argv.includes("--skip-build");
  if (!skipBuild) {
    execSync("pnpm --filter @workspace/notary-journal... run build", {
      cwd: ROOT,
      stdio: "inherit",
    });
  }

  execSync("npx wrangler deploy", {
    cwd: ROOT,
    stdio: "inherit",
  });
}

main();
