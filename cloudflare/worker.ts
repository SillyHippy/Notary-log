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

  const body = await request.json();
  const accessKey = body.access_key;

  if (!accessKey) {
    return jsonResponse(401, { error: "Missing 'access_key' in request body" });
  }

  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const key = `user:${accessKey}:intake-${id}`;
  await env.INTAKE_KV.put(key, JSON.stringify(body));

  return jsonResponse(200, { success: true });
}

async function handleIntake(request: Request, env: Env): Promise<Response> {
  if (!env.INTAKE_KV) {
    return jsonResponse(503, { error: "Storage not configured" });
  }

  if (request.method === "OPTIONS") {
    return jsonResponse(204, null);
  }

  const url = new URL(request.url);
  const accessKey = url.searchParams.get("access_key");
  const fileParam = url.searchParams.get("file");

  if (fileParam) {
    if (request.method === "GET") {
      if (!accessKey) {
        return jsonResponse(401, { error: "Missing 'access_key' query parameter" });
      }
      const key = `user:${accessKey}:${fileParam}`;
      const value = await env.INTAKE_KV.get(key);
      if (value === null) {
        return jsonResponse(404, { error: "Not found" });
      }
      return jsonResponse(200, JSON.parse(value));
    }

    if (request.method === "DELETE") {
      if (!accessKey) {
        return jsonResponse(401, { error: "Missing 'access_key' query parameter" });
      }
      const key = `user:${accessKey}:${fileParam}`;
      await env.INTAKE_KV.delete(key);
      return jsonResponse(200, { success: true });
    }

    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (request.method === "GET") {
    if (!accessKey) {
      return jsonResponse(401, { error: "Missing 'access_key' query parameter" });
    }
    const list = await env.INTAKE_KV.list({ prefix: `user:${accessKey}:` });
    const files = list.keys.map((k) => {
      let size = 1024;
      let created = new Date().toISOString();
      if (k.metadata) {
        created = k.metadata.created || created;
        try {
          size = JSON.stringify(k.metadata).length;
        } catch {
          // ignore
        }
      }
      return { name: k.name, modifiedTime: created, size };
    });
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
