import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

const PUBLIC_DIR = "./artifacts/notary-journal/dist/public";
const BACKUP_DIR = "./Documents/Notary Journal/backups";
const BACKUP_KEY_FILE = join(BACKUP_DIR, ".backup-key");
const INTAKE_DIR = "./Documents/Notary Journal/intake";
const INTAKE_SETTINGS_FILE = join(INTAKE_DIR, "settings.json");

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

// ── Client intake queue ─────────────────────────────────────────────────────

interface IntakeSettingsFile {
  secret: string;
  config: {
    title: string;
    allowIdUpload: boolean;
    showEmail: boolean;
    showPhone: boolean;
    showAddress: boolean;
    showNotes: boolean;
    showPreferredDate: boolean;
  };
}

interface IntakeRecord {
  id: string;
  createdAt: string;
  read: boolean;
  fields: Record<string, unknown>;
}

async function readIntakeSettings(): Promise<IntakeSettingsFile | null> {
  const file = Bun.file(INTAKE_SETTINGS_FILE);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as IntakeSettingsFile;
  } catch {
    return null;
  }
}

async function writeIntakeSettings(data: IntakeSettingsFile) {
  await mkdir(INTAKE_DIR, { recursive: true });
  await Bun.write(INTAKE_SETTINGS_FILE, JSON.stringify(data, null, 2));
}

function intakeAuthOk(request: Request, settings: IntakeSettingsFile): boolean {
  const auth = request.headers.get("Authorization");
  if (auth === `Bearer ${settings.secret}`) return true;
  return false;
}

function safeIntakeId(id: string): string {
  const clean = basename(id);
  if (clean !== id || !/^[a-zA-Z0-9_-]+$/.test(clean)) {
    throw new Error("Invalid intake id");
  }
  return clean;
}

async function handleIntakeRequest(request: Request, url: URL) {
  const headers = corsHeaders();

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const path = url.pathname;

  if (path === "/api/intake/health" && request.method === "GET") {
    return json({ ok: true }, { headers });
  }

  if (path === "/api/intake/config" && request.method === "GET") {
    const secret = url.searchParams.get("k") ?? "";
    const settings = await readIntakeSettings();
    if (!settings || secret !== settings.secret) {
      return json({ error: "Not found" }, { status: 404, headers });
    }
    return json(settings.config, { headers });
  }

  if (path === "/api/intake/settings" && request.method === "POST") {
    const body = (await request.json()) as {
      secret?: unknown;
      config?: IntakeSettingsFile["config"];
    };
    if (typeof body.secret !== "string" || !body.config) {
      return json({ error: "Expected secret and config" }, { status: 400, headers });
    }
    const existing = await readIntakeSettings();
    if (existing && !intakeAuthOk(request, existing) && body.secret !== existing.secret) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    await writeIntakeSettings({ secret: body.secret, config: body.config });
    return json({ ok: true }, { headers });
  }

  if (path === "/api/intake" && request.method === "POST") {
    const body = (await request.json()) as {
      secret?: unknown;
      fields?: Record<string, unknown>;
    };
    const settings = await readIntakeSettings();
    if (!settings || body.secret !== settings.secret) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    if (!body.fields || typeof body.fields.signerFullName !== "string") {
      return json({ error: "signerFullName is required" }, { status: 400, headers });
    }
    const id = crypto.randomUUID().slice(0, 12);
    const record: IntakeRecord = {
      id,
      createdAt: new Date().toISOString(),
      read: false,
      fields: body.fields,
    };
    await mkdir(INTAKE_DIR, { recursive: true });
    await Bun.write(join(INTAKE_DIR, `${id}.json`), JSON.stringify(record, null, 2));
    return json({ id }, { headers });
  }

  if (path === "/api/intake" && request.method === "GET") {
    const settings = await readIntakeSettings();
    if (!settings || !intakeAuthOk(request, settings)) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    await mkdir(INTAKE_DIR, { recursive: true });
    const names = await readdir(INTAKE_DIR);
    const unreadOnly = url.searchParams.get("unread") === "true";
    const submissions: IntakeRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json") || name === "settings.json") continue;
      try {
        const rec = (await Bun.file(join(INTAKE_DIR, name)).json()) as IntakeRecord;
        if (unreadOnly && rec.read) continue;
        submissions.push(rec);
      } catch {
        // skip corrupt files
      }
    }
    submissions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json({ submissions }, { headers });
  }

  const singleMatch = path.match(/^\/api\/intake\/([^/]+)$/);
  if (singleMatch) {
    const id = safeIntakeId(singleMatch[1]);
    const settings = await readIntakeSettings();
    if (!settings || !intakeAuthOk(request, settings)) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const filePath = join(INTAKE_DIR, `${id}.json`);
    const file = Bun.file(filePath);

    if (request.method === "GET") {
      if (!(await file.exists())) {
        return json({ error: "Not found" }, { status: 404, headers });
      }
      return json(await file.json(), { headers });
    }

    if (request.method === "DELETE") {
      if (await file.exists()) {
        try {
          await unlink(filePath);
        } catch {
          // ignore
        }
      }
      return json({ ok: true }, { headers });
    }
  }

  const readMatch = path.match(/^\/api\/intake\/([^/]+)\/read$/);
  if (readMatch && request.method === "POST") {
    const id = safeIntakeId(readMatch[1]);
    const settings = await readIntakeSettings();
    if (!settings || !intakeAuthOk(request, settings)) {
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const filePath = join(INTAKE_DIR, `${id}.json`);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return json({ error: "Not found" }, { status: 404, headers });
    }
    const rec = (await file.json()) as IntakeRecord;
    rec.read = true;
    await Bun.write(filePath, JSON.stringify(rec, null, 2));
    return json({ ok: true }, { headers });
  }

  return json({ error: "Not found" }, { status: 404, headers });
}

const server = Bun.serve({
  port: process.env.PORT || 3000,
  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname;

    if (path === "/api/backup") {
      return handleBackupRequest(request, url);
    }

    if (path.startsWith("/api/intake")) {
      return handleIntakeRequest(request, url);
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
