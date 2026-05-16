import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { handleIntakeRequest } from "./lib/serverless/intake-api";
import { createFsIntakeStore } from "./lib/serverless/intake-store-fs";

const PUBLIC_DIR = "./artifacts/notary-journal/dist/public";
const BACKUP_DIR = "./Documents/Notary Journal/backups";
const BACKUP_KEY_FILE = join(BACKUP_DIR, ".backup-key");
const INTAKE_DIR = "./Documents/Notary Journal/intake";
function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function generateBackupKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function ensureBackupKey() {
  await mkdir(BACKUP_DIR, { recursive: true });

  if (process.env.BACKUP_KEY) {
    return process.env.BACKUP_KEY;
  }

  const keyFile = Bun.file(BACKUP_KEY_FILE);
  if (await keyFile.exists()) {
    return (await keyFile.text()).trim();
  }

  const key = generateBackupKey();
  await Bun.write(BACKUP_KEY_FILE, key);
  return key;
}

async function requireBackupAuth(request: Request) {
  const key = await ensureBackupKey();
  const expected = `Bearer ${key}`;
  return request.headers.get("Authorization") === expected;
}

function safeBackupName(fileName: string) {
  const cleanName = basename(fileName);
  if (cleanName !== fileName || !cleanName.endsWith(".json")) {
    throw new Error("Invalid backup filename");
  }
  return cleanName;
}

async function handleBackupRequest(request: Request, url: URL) {
  const headers = corsHeaders();

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (!(await requireBackupAuth(request))) {
    return json({ error: "Unauthorized" }, { status: 401, headers });
  }

  await mkdir(BACKUP_DIR, { recursive: true });

  if (request.method === "GET") {
    const requestedFile = url.searchParams.get("file");
    if (requestedFile) {
      const fileName = safeBackupName(requestedFile);
      const file = Bun.file(join(BACKUP_DIR, fileName));
      if (!(await file.exists())) {
        return json({ error: "Backup not found" }, { status: 404, headers });
      }
      return new Response(file, {
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
      });
    }

    const names = await readdir(BACKUP_DIR);
    const files = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const info = await stat(join(BACKUP_DIR, name));
          return {
            name,
            modifiedTime: info.mtime.toISOString(),
            size: info.size,
          };
        }),
    );
    files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
    return json({ files }, { headers });
  }

  if (request.method === "POST") {
    const body = (await request.json()) as {
      filename?: unknown;
      backup?: unknown;
    };
    if (typeof body.filename !== "string" || body.backup === undefined) {
      return json(
        { error: "Expected filename and backup payload" },
        { status: 400, headers },
      );
    }

    const fileName = safeBackupName(body.filename);
    await Bun.write(
      join(BACKUP_DIR, fileName),
      JSON.stringify(body.backup, null, 2),
    );
    return json({ name: fileName }, { headers });
  }

  return json({ error: "Method not allowed" }, { status: 405, headers });
}

const intakeStore = createFsIntakeStore(INTAKE_DIR);

const server = Bun.serve({
  port: process.env.PORT || 3000,
  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname;

    if (path === "/api/backup") {
      return handleBackupRequest(request, url);
    }

    if (path.startsWith("/api/intake")) {
      return handleIntakeRequest(request, url, intakeStore);
    }

    if (path === "/") {
      path = "/index.html";
    }

    try {
      const filePath = `${PUBLIC_DIR}${path}`;
      const file = Bun.file(filePath);

      if (await file.exists()) {
        return new Response(file);
      }
    } catch (error) {
      console.error("File error:", error);
    }

    const indexFile = Bun.file(`${PUBLIC_DIR}/index.html`);
    return new Response(indexFile, {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(`Notary Journal server listening on port ${server.port}`);
void ensureBackupKey().then((key) => {
  console.log(`Zo Backup API URL: /api/backup`);
  console.log(`Zo Backup Key: ${key}`);
  console.log(`Zo Backup Storage: ${BACKUP_DIR}`);
});
