import type { IntakeRecord, IntakeSettingsFile, IntakeStore } from "./intake-types";

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
      ...init.headers,
    },
  });
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function intakeAuthOk(request: Request, settings: IntakeSettingsFile): boolean {
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${settings.secret}`;
}

function safeIntakeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid intake id");
  }
  return id;
}

/** Shared intake HTTP handler (Zo, Netlify, Cloudflare). */
export async function handleIntakeRequest(
  request: Request,
  url: URL,
  store: IntakeStore,
): Promise<Response> {
  const headers = corsHeaders();

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const path = url.pathname;

  if (path === "/api/intake/health" && request.method === "GET") {
    return jsonResponse({ ok: true });
  }

  if (path === "/api/intake/config" && request.method === "GET") {
    const secret = url.searchParams.get("k") ?? "";
    const settings = await store.getSettings();
    if (!settings || secret !== settings.secret) {
      return jsonResponse({ error: "Not found" }, { status: 404 });
    }
    return jsonResponse(settings.config);
  }

  if (path === "/api/intake/settings" && request.method === "POST") {
    const body = (await request.json()) as {
      secret?: unknown;
      config?: IntakeSettingsFile["config"];
    };
    if (typeof body.secret !== "string" || !body.config) {
      return jsonResponse({ error: "Expected secret and config" }, { status: 400 });
    }
    const existing = await store.getSettings();
    if (
      existing &&
      !intakeAuthOk(request, existing) &&
      body.secret !== existing.secret
    ) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
    await store.setSettings({ secret: body.secret, config: body.config });
    return jsonResponse({ ok: true });
  }

  if (path === "/api/intake" && request.method === "POST") {
    const body = (await request.json()) as {
      secret?: unknown;
      fields?: Record<string, unknown>;
    };
    const settings = await store.getSettings();
    if (!settings || body.secret !== settings.secret) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
    if (!body.fields || typeof body.fields.signerFullName !== "string") {
      return jsonResponse({ error: "signerFullName is required" }, { status: 400 });
    }
    const id = crypto.randomUUID().slice(0, 12);
    const record: IntakeRecord = {
      id,
      createdAt: new Date().toISOString(),
      read: false,
      fields: body.fields,
    };
    await store.setSubmission(record);
    return jsonResponse({ id });
  }

  if (path === "/api/intake" && request.method === "GET") {
    const settings = await store.getSettings();
    if (!settings || !intakeAuthOk(request, settings)) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
    const unreadOnly = url.searchParams.get("unread") === "true";
    let submissions = await store.listSubmissions();
    if (unreadOnly) submissions = submissions.filter((s) => !s.read);
    submissions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return jsonResponse({ submissions });
  }

  const singleMatch = path.match(/^\/api\/intake\/([^/]+)$/);
  if (singleMatch) {
    const id = safeIntakeId(singleMatch[1]);
    const settings = await store.getSettings();
    if (!settings || !intakeAuthOk(request, settings)) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }

    if (request.method === "GET") {
      const rec = await store.getSubmission(id);
      if (!rec) return jsonResponse({ error: "Not found" }, { status: 404 });
      return jsonResponse(rec);
    }

    if (request.method === "DELETE") {
      await store.deleteSubmission(id);
      return jsonResponse({ ok: true });
    }
  }

  const readMatch = path.match(/^\/api\/intake\/([^/]+)\/read$/);
  if (readMatch && request.method === "POST") {
    const id = safeIntakeId(readMatch[1]);
    const settings = await store.getSettings();
    if (!settings || !intakeAuthOk(request, settings)) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
    const rec = await store.getSubmission(id);
    if (!rec) return jsonResponse({ error: "Not found" }, { status: 404 });
    rec.read = true;
    await store.setSubmission(rec);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "Not found" }, { status: 404 });
}
