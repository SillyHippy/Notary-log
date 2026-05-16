#!/usr/bin/env node
/**
 * Deploy Worker + static assets. Resolves INTAKE_KV namespace id at deploy time
 * so wrangler.toml can keep a placeholder in git (Cloudflare CI is authenticated).
 *
 * Usage:
 *   node scripts/cloudflare-deploy.mjs              # build + deploy
 *   node scripts/cloudflare-deploy.mjs --skip-build # deploy only (CI split steps)
 *
 * Optional env: INTAKE_KV_NAMESPACE_ID — skip list/create lookup
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "REPLACE_WITH_KV_NAMESPACE_ID";
const BINDING = "INTAKE_KV";
const TITLE = "INTAKE_KV";
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function wrangler(args) {
  return execSync(`npx wrangler ${args}`, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
}

function parseNamespaceList(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  throw new Error(
    "Unexpected wrangler kv namespace list output. Set INTAKE_KV_NAMESPACE_ID in Cloudflare build env.",
  );
}

function readKvIdFromToml(toml) {
  const m = toml.match(new RegExp(`binding = "${BINDING}"\\s*\\r?\\nid = "([^"]+)"`));
  return m?.[1];
}

function resolveKvNamespaceId() {
  const fromEnv = process.env.INTAKE_KV_NAMESPACE_ID?.trim();
  if (fromEnv) {
    console.log("Using INTAKE_KV_NAMESPACE_ID from environment.");
    return fromEnv;
  }

  const toml = readFileSync(join(ROOT, "wrangler.toml"), "utf8");
  const fromToml = readKvIdFromToml(toml);
  if (fromToml && fromToml !== PLACEHOLDER) {
    console.log(`Using KV namespace from wrangler.toml: ${fromToml}`);
    return fromToml;
  }

  console.log("Looking up Cloudflare KV namespace…");
  const list = parseNamespaceList(wrangler("kv namespace list"));
  const existing = list.find((n) => n.title === TITLE);
  if (existing?.id) {
    console.log(`Found KV namespace "${TITLE}": ${existing.id}`);
    return existing.id;
  }

  console.log(`Creating KV namespace "${TITLE}"…`);
  wrangler(
    `kv namespace create ${TITLE} --binding ${BINDING} --update-config`,
  );
  const updated = readFileSync(join(ROOT, "wrangler.toml"), "utf8");
  const created = readKvIdFromToml(updated);
  if (!created || created === PLACEHOLDER) {
    throw new Error(
      "Could not create KV namespace. In Cloudflare Dashboard → Workers KV → Create, then set build env INTAKE_KV_NAMESPACE_ID to that namespace id.",
    );
  }
  console.log(`Created KV namespace: ${created}`);
  console.log(
    "Optional: set INTAKE_KV_NAMESPACE_ID in your Cloudflare build environment to speed up future deploys.",
  );
  return created;
}

function main() {
  const skipBuild = process.argv.includes("--skip-build");
  if (!skipBuild) {
    execSync("pnpm --filter @workspace/notary-journal... run build", {
      cwd: ROOT,
      stdio: "inherit",
    });
  }

  const kvId = resolveKvNamespaceId();
  let toml = readFileSync(join(ROOT, "wrangler.toml"), "utf8");
  if (toml.includes(PLACEHOLDER)) {
    toml = toml.replace(`id = "${PLACEHOLDER}"`, `id = "${kvId}"`);
  } else {
    toml = toml.replace(
      new RegExp(`(binding = "${BINDING}"\\s*\\r?\\n)id = "[^"]+"`),
      `$1id = "${kvId}"`,
    );
  }

  const deployConfig = join(ROOT, ".wrangler.deploy.toml");
  writeFileSync(deployConfig, toml);
  execSync(`npx wrangler deploy --config "${deployConfig}"`, {
    cwd: ROOT,
    stdio: "inherit",
  });
}

main();
