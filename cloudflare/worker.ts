export interface Env {
  ASSETS: Fetcher;
  INTAKE_KV?: KVNamespace;
  CAL_DB?: D1Database;
  CAL_WEBHOOK_SECRET?: string;
  CAL_ENABLED?: string;
}

import {
  handleCalRoutes,
  handleCalHealth,
  handleCalBootstrap,
  handleCalVerifyReset,
  type CalEnv,
} from "./cal-handlers";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Notary-Token",
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
      const kvKey = `user:${accessKey}:${file}`;
      const raw = await env.INTAKE_KV.get(kvKey);
      if (!raw) {
        return jsonResponse(404, { error: "Submission not found" });
      }
      return jsonResponse(200, JSON.parse(raw));
    }
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

function calEnv(env: Env): CalEnv | null {
  if (!env.CAL_DB) return null;
  return {
    CAL_DB: env.CAL_DB,
    CAL_WEBHOOK_SECRET: env.CAL_WEBHOOK_SECRET,
    CAL_ENABLED: env.CAL_ENABLED,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const cal = calEnv(env);

    if (path === "/api/health" && cal) {
      return handleCalHealth(cal);
    }

    if (path === "/api/bootstrap" && cal) {
      return handleCalBootstrap(cal);
    }

    if (path === "/api/cal/verify-reset" && cal && request.method === "POST") {
      return handleCalVerifyReset(cal);
    }

    if (cal) {
      const calResponse = await handleCalRoutes(request, url, cal);
      if (calResponse) return calResponse;
    }

    if (path === "/api/intake-webhook") {
      return handleIntakeWebhook(request, env);
    }

    if (path === "/api/intake") {
      return handleIntake(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
