#!/usr/bin/env node
/**
 * Build Cal-enabled PWA + deploy to Cloudflare Workers (staging config).
 *
 * Usage:
 *   node scripts/cloudflare-deploy-cal.mjs              # build + deploy wrangler.cal.toml
 *   node scripts/cloudflare-deploy-cal.mjs --skip-build
 *
 * Production main deploy still uses scripts/cloudflare-deploy.mjs (no Cal flag)
 * until CAL-CLOUDFLARE-WORKERS-PLAN Phase CF-4 merge.
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
      env: {
        ...process.env,
        VITE_CAL_HOST_MODE: "1",
      },
    });
  }

  execSync("npx wrangler deploy -c wrangler.cal.toml", {
    cwd: ROOT,
    stdio: "inherit",
  });
}

main();
