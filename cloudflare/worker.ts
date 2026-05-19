export interface Env {
  ASSETS: Fetcher;
  INTAKE_KV?: KVNamespace;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...corsHeaders(),
    ...extraHeaders,
  };
  return new Response(JSON.stringify(body), { status, headers });
}

async function handleIntakeWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.INTAKE_KV) {
    return jsonResponse(503, { error: "Storage not configured" });
  }

  if (request.method === "OPTIONS") {
    return jsonResponse(204, null);
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.key !== "string" || body.key.trim() === "") {
    return jsonResponse(401, { error: "Access key required" });
  }

  const accessKey = body.key;
  const id = `intake-${Date.now()}-${crypto.randomUUID()}`;
  const key = `user:${accessKey}:${id}`;
  await env.INTAKE_KV.put(key, JSON.stringify(body));

  return jsonResponse(200, { success: true, id });
}

async function handleIntake(request: Request, env: Env): Promise<Response> {
  if (!env.INTAKE_KV) {
    return jsonResponse(503, { error: "Storage not configured" });
  }

  if (request.method === "OPTIONS") {
    return jsonResponse(204, null);
  }

  const url = new URL(request.url);
  const accessKey = url.searchParams.get("key");

  if (request.method === "DELETE") {
    const file = url.searchParams.get("file");
    if (!accessKey || !file) {
      return jsonResponse(400, { error: "Missing key or file parameter" });
    }
    const kvKey = `user:${accessKey}:${file}`;
    await env.INTAKE_KV.delete(kvKey);
    return jsonResponse(200, { success: true });
  }

  if (!accessKey) {
    return jsonResponse(401, { error: "Access key required" });
  }

  if (request.method === "GET") {
    const file = url.searchParams.get("file");
    if (file) {
      // Return a single submission's contents
      const kvKey = `user:${accessKey}:${file}`;
      const raw = await env.INTAKE_KV.get(kvKey);
      if (!raw) {
        return jsonResponse(404, { error: "Submission not found" });
      }
      return jsonResponse(200, JSON.parse(raw));
    }
    // List all submissions for this user
    const list = await env.INTAKE_KV.list({ prefix: `user:${accessKey}:` });
    const files = list.keys.map((k) => ({
      name: k.name.replace(`user:${accessKey}:`, ""),
      modifiedTime: k.metadata?.modified || new Date().toISOString(),
      size: k.metadata?.size ?? 1024,
    }));
    return jsonResponse(200, { files });
  }

  return jsonResponse(405, { error: "Method not allowed" });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/intake-webhook") {
      return handleIntakeWebhook(request, env);
    }

    if (path === "/api/intake") {
      return handleIntake(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
