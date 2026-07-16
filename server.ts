import { Database } from "bun:sqlite";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const PUBLIC_DIR = "./artifacts/notary-journal/dist/public";
const JOURNAL_DIR = "./Documents/Notary Journal";
const BACKUP_DIR = join(JOURNAL_DIR, "backups");
const INTAKE_LEGACY_DIR = join(JOURNAL_DIR, "intake");
const DB_PATH = join(JOURNAL_DIR, "notary.db");
const BACKUP_KEY_FILE = join(BACKUP_DIR, ".backup-key");
const ZO_API_URL = "https://api.zo.computer/zo/ask";

const PORT = Number(process.env.PORT) || 3000;

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
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

/* ── SQLite (Zo multi-user intake) ─────────────────────────────── */

type ZoUser = { id: string; name: string; email: string };

function initDatabase(): Database {
  const db = new Database(DB_PATH);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      user_token TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_token) REFERENCES users(token)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      user_token TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER,
      field_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submission_id) REFERENCES submissions(id),
      FOREIGN KEY (user_token) REFERENCES users(token)
    )
  `);

  return db;
}

function generateIntakeToken(): string {
  return (
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "")
  );
}

/** First Zo start with an empty users table: create one notary and return their token. */
function ensureDefaultNotaryUser(db: Database): {
  token: string;
  name: string;
  email: string;
  created: boolean;
} | null {
  const row = db
    .query("SELECT COUNT(*) AS count FROM users")
    .get() as { count: number };
  if (row.count > 0) {
    return null;
  }

  const token = generateIntakeToken();
  const id = crypto.randomUUID();
  const name = process.env.NOTARY_NAME?.trim() || "Primary Notary";
  const email = process.env.NOTARY_EMAIL?.trim() || "notary@localhost";

  db.run(
    "INSERT INTO users (id, token, name, email) VALUES (?, ?, ?, ?)",
    [id, token, name, email],
  );

  return { token, name, email, created: true };
}

function getPrimaryIntakeToken(db: Database): string | null {
  const row = db
    .query("SELECT token FROM users ORDER BY created_at ASC LIMIT 1")
    .get() as { token: string } | null;
  return row?.token ?? null;
}

function validateToken(db: Database, token: string): ZoUser | null {
  if (!token) return null;
  const row = db
    .query("SELECT id, name, email FROM users WHERE token = ?")
    .get(token) as ZoUser | null;
  return row ?? null;
}

async function sendZoEmail(to: string, subject: string, body: string) {
  const zoApiKey = process.env.ZO_API_KEY;
  if (!zoApiKey) {
    console.warn("ZO_API_KEY not set — skipping intake email");
    return;
  }
  try {
    await fetch(ZO_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${zoApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: `Send an email to ${to} with subject "${subject}" and body: ${body}`,
      }),
    });
  } catch (err) {
    console.error("Failed to send Zo email:", err);
  }
}

const FILE_FIELD_NAMES = new Set([
  "idFrontFiles",
  "idBackFiles",
  "signer2IdFrontFiles",
  "signer2IdBackFiles",
]);

async function storeUploadedFile(
  db: Database,
  submissionId: string,
  token: string,
  fieldName: string,
  file: File,
) {
  const storedFilename = `${crypto.randomUUID()}${extname(file.name) || ".bin"}`;
  const userUploadDir = join(INTAKE_LEGACY_DIR, token);
  await mkdir(userUploadDir, { recursive: true });
  const filePath = join(userUploadDir, storedFilename);
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  db.run(
    `INSERT INTO files (id, submission_id, user_token, original_filename, stored_filename, file_path, mime_type, file_size, field_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      submissionId,
      token,
      file.name,
      storedFilename,
      filePath,
      file.type || null,
      file.size,
      fieldName,
    ],
  );
}

async function handleZoIntakePost(request: Request, db: Database) {
  const headers = corsHeaders();
  const contentType = request.headers.get("content-type") || "";

  let token = "";
  let payload: Record<string, unknown> = {};
  const filesToStore: Array<{ fieldName: string; file: File }> = [];

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return json({ error: "Invalid form data" }, { status: 400, headers });
    }

    for (const [key, value] of formData.entries()) {
      if (key === "token" || key === "key") {
        if (typeof value === "string") token = value;
        continue;
      }
      if (value instanceof File) {
        filesToStore.push({ fieldName: key, file: value });
        continue;
      }
      if (typeof value === "string") {
        payload[key] = value;
      }
    }
  } else {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON body" }, { status: 400, headers });
    }
    token = String(body.token ?? body.key ?? "");
    const { token: _t, key: _k, ...rest } = body;
    payload = rest;
  }

  if (!token || !validateToken(db, token)) {
    return json({ error: "Invalid or missing token" }, { status: 401, headers });
  }

  payload.submitted_at = payload.submitted_at ?? new Date().toISOString();
  const submissionId = crypto.randomUUID();

  db.run(
    `INSERT INTO submissions (id, user_token, payload_json) VALUES (?, ?, ?)`,
    [submissionId, token, JSON.stringify(payload)],
  );

  const storedFileNames: string[] = [];
  for (const { fieldName, file } of filesToStore) {
    await storeUploadedFile(db, submissionId, token, fieldName, file);
    storedFileNames.push(file.name);
  }

  const user = validateToken(db, token)!;
  const signerName = [
    payload.signerFirstName,
    payload.signerMiddleName,
    payload.signerLastName,
  ]
    .filter(Boolean)
    .join(" ");
  const signerEmail = String(payload.email ?? "");

  if (signerEmail) {
    await sendZoEmail(
      signerEmail,
      "Notary Request Received",
      `Hello ${signerName || "there"},\n\nYour notary request has been received. The notary will contact you soon.\n\nThank you!`,
    );
  }

  if (user.email) {
    await sendZoEmail(
      user.email,
      "New Notary Request",
      `Hello ${user.name},\n\nYou have a new notary request from ${signerName || "a client"} (${signerEmail}).\n\nFiles uploaded: ${storedFileNames.join(", ") || "none"}\n\nReview it in Client Requests in your Notary Journal app.`,
    );
  }

  return json(
    { success: true, submission_id: submissionId, files: storedFileNames },
    { status: 201, headers },
  );
}

function handleZoIntakeList(db: Database, token: string) {
  const rows = db
    .query(
      `SELECT id, payload_json, created_at FROM submissions WHERE user_token = ? ORDER BY created_at DESC`,
    )
    .all(token) as Array<{
    id: string;
    payload_json: string;
    created_at: string;
  }>;

  const files = rows.map((row) => ({
    name: row.id,
    modifiedTime: new Date(row.created_at).toISOString(),
    size: row.payload_json.length,
  }));

  return files;
}

function handleZoIntakeDetail(
  db: Database,
  token: string,
  submissionId: string,
) {
  const row = db
    .query(
      `SELECT payload_json FROM submissions WHERE id = ? AND user_token = ?`,
    )
    .get(submissionId, token) as { payload_json: string } | null;

  if (!row) {
    return null;
  }

  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;

  const fileRows = db
    .query(
      `SELECT field_name, file_path, mime_type, original_filename FROM files WHERE submission_id = ? AND user_token = ?`,
    )
    .all(submissionId, token) as Array<{
    field_name: string | null;
    file_path: string;
    mime_type: string | null;
    original_filename: string;
  }>;

  const readFileAsDataUrl = async (filePath: string, mime: string) => {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    const buf = await file.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return `data:${mime || "application/octet-stream"};base64,${b64}`;
  };

  return { payload, fileRows, readFileAsDataUrl };
}

async function handleZoIntakeDelete(
  db: Database,
  token: string,
  submissionId: string,
) {
  const fileRows = db
    .query(
      `SELECT file_path FROM files WHERE submission_id = ? AND user_token = ?`,
    )
    .all(submissionId, token) as Array<{ file_path: string }>;

  for (const row of fileRows) {
    try {
      await unlink(row.file_path);
    } catch {
      // ignore missing files
    }
  }

  db.run(`DELETE FROM files WHERE submission_id = ? AND user_token = ?`, [
    submissionId,
    token,
  ]);
  db.run(`DELETE FROM submissions WHERE id = ? AND user_token = ?`, [
    submissionId,
    token,
  ]);
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

/* ── Intake (Zo SQLite + legacy Web3Forms JSON files) ───────────── */

async function handleLegacyIntakeGet(url: URL, headers: Record<string, string>) {
  await mkdir(INTAKE_LEGACY_DIR, { recursive: true });

  const requestedFile = url.searchParams.get("file");
  if (requestedFile) {
    const fileName = safeBackupName(requestedFile);
    const file = Bun.file(join(INTAKE_LEGACY_DIR, fileName));
    if (!(await file.exists())) {
      return json({ error: "Submission not found" }, { status: 404, headers });
    }
    return new Response(file, {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  const names = await readdir(INTAKE_LEGACY_DIR);
  const files = await Promise.all(
    names
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .map(async (name) => {
        const fullPath = join(INTAKE_LEGACY_DIR, name);
        const info = await stat(fullPath);
        if (!info.isFile()) return null;
        return {
          name,
          modifiedTime: info.mtime.toISOString(),
          size: info.size,
        };
      }),
  );
  const filtered = files.filter(Boolean) as Array<{
    name: string;
    modifiedTime: string;
    size: number;
  }>;
  filtered.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  return json({ files: filtered }, { headers });
}

async function handleLegacyIntakeDelete(
  url: URL,
  headers: Record<string, string>,
) {
  const fileName = url.searchParams.get("file");
  if (!fileName) {
    return json({ error: "Missing file parameter" }, { status: 400, headers });
  }
  const cleanName = safeBackupName(fileName);
  const filePath = join(INTAKE_LEGACY_DIR, cleanName);
  try {
    await unlink(filePath);
    return json({ success: true }, { headers });
  } catch {
    return json({ error: "Failed to delete" }, { status: 500, headers });
  }
}

async function handleIntakeRequest(
  request: Request,
  url: URL,
  db: Database,
) {
  const headers = corsHeaders();

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  await mkdir(INTAKE_LEGACY_DIR, { recursive: true });
  await mkdir(JOURNAL_DIR, { recursive: true });

  if (request.method === "POST" && url.pathname === "/api/intake-webhook") {
    try {
      const body = await request.json();
      const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const fileName = `intake-${id}.json`;
      await Bun.write(
        join(INTAKE_LEGACY_DIR, fileName),
        JSON.stringify(body, null, 2),
      );
      return json({ success: true, id }, { headers });
    } catch (err) {
      return json({ error: String(err) }, { status: 400, headers });
    }
  }

  if (url.pathname !== "/api/intake") {
    return json({ error: "Not found" }, { status: 404, headers });
  }

  if (request.method === "POST") {
    return handleZoIntakePost(request, db);
  }

  const token = url.searchParams.get("key") || "";
  const zoUser = validateToken(db, token);

  if (request.method === "GET" && url.searchParams.get("probe") === "1") {
    return json(
      {
        valid: !!zoUser,
        mode: zoUser ? "zo" : "web3forms",
      },
      { headers },
    );
  }

  if (request.method === "GET") {
    if (zoUser) {
      const requestedFile = url.searchParams.get("file");
      if (requestedFile) {
        const detail = handleZoIntakeDetail(db, token, requestedFile);
        if (!detail) {
          return json({ error: "Submission not found" }, { status: 404, headers });
        }

        const { payload, fileRows, readFileAsDataUrl } = detail;
        for (const row of fileRows) {
          const field = row.field_name || "files";
          if (!FILE_FIELD_NAMES.has(field) && field !== "files") continue;
          const dataUrl = await readFileAsDataUrl(
            row.file_path,
            row.mime_type || "image/jpeg",
          );
          if (!dataUrl) continue;
          const existing = payload[field];
          if (Array.isArray(existing)) {
            (existing as string[]).push(dataUrl);
          } else if (existing) {
            payload[field] = [String(existing), dataUrl];
          } else {
            payload[field] = [dataUrl];
          }
        }

        return json(payload, { headers });
      }

      const files = handleZoIntakeList(db, token);
      return json({ files }, { headers });
    }

    return handleLegacyIntakeGet(url, headers);
  }

  if (request.method === "DELETE") {
    const submissionId = url.searchParams.get("file");
    if (!submissionId) {
      return json({ error: "Missing file parameter" }, { status: 400, headers });
    }
    if (zoUser) {
      await handleZoIntakeDelete(db, token, submissionId);
      return json({ success: true }, { headers });
    }
    return handleLegacyIntakeDelete(url, headers);
  }

  return json({ error: "Method not allowed" }, { status: 405, headers });
}

function handleHealth() {
  return json({
    status: "ok",
    timestamp: new Date().toISOString(),
    intake: "zo-sqlite",
  });
}

async function handleBootstrap() {
  const tokenFile = Bun.file(INTAKE_TOKEN_FILE);
  if (!(await tokenFile.exists())) {
    return json({ intakeToken: null });
  }
  const intakeToken = (await tokenFile.text()).trim() || null;
  return json({ intakeToken });
}

/* ── Server ─────────────────────────────────────────────────────── */

await mkdir(JOURNAL_DIR, { recursive: true });
const db = initDatabase();
const INTAKE_TOKEN_FILE = join(JOURNAL_DIR, ".zo-intake-token");

async function logStartupCredentials() {
  await mkdir(JOURNAL_DIR, { recursive: true });

  const created = ensureDefaultNotaryUser(db);
  const intakeToken = created?.token ?? getPrimaryIntakeToken(db);

  if (intakeToken) {
    await Bun.write(INTAKE_TOKEN_FILE, `${intakeToken}\n`);
    if (created) {
      console.log(
        `Zo Intake Token (new notary — paste in Settings): ${intakeToken}`,
      );
      console.log(`Zo Intake User: ${created.name} <${created.email}>`);
    } else {
      console.log(`Zo Intake Token (existing): ${intakeToken}`);
    }
    console.log(`Zo Intake Token file: ${INTAKE_TOKEN_FILE}`);
  } else {
    console.warn("No Zo intake users in database — client intake will return 401");
  }

  const backupKey = await ensureBackupKey();
  console.log(`Zo Backup API URL: /api/backup`);
  console.log(`Zo Backup Key: ${backupKey}`);
  console.log(`Zo Backup Storage: ${BACKUP_DIR}`);
  console.log(`Intake webhook URL: /api/intake-webhook`);
  console.log(`Intake SQLite DB: ${DB_PATH}`);
  console.log(`Intake uploads dir: ${join(JOURNAL_DIR, "intake")}/`);
  console.log(`Legacy intake JSON dir: ${INTAKE_LEGACY_DIR}`);
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname;

    if (path === "/api/health") {
      return handleHealth();
    }

    if (path === "/api/bootstrap") {
      return handleBootstrap();
    }

    if (path === "/api/backup") {
      return handleBackupRequest(request, url);
    }

    if (path.startsWith("/api/intake")) {
      return handleIntakeRequest(request, url, db);
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
void logStartupCredentials();
