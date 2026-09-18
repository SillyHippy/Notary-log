export interface Env {
  ASSETS: Fetcher;
  INTAKE_KV?: KVNamespace;
  CAL_DB?: D1Database;
  CAL_WEBHOOK_SECRET?: string;
  CAL_ENABLED?: string;
  BREVO_API_KEY?: string;
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

async function handleFeedback(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return jsonResponse(204, null);
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (!env.BREVO_API_KEY) {
    return jsonResponse(503, { error: "Feedback service not configured" });
  }

  let body: {
    name?: string;
    email?: string;
    state?: string;
    type?: string;
    message?: string;
    screenshotBase64?: string;
    screenshotFilename?: string;
    userAgent?: string;
  } = {};

  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  if (!body.message || body.message.trim().length === 0) {
    return jsonResponse(400, { error: "Message is required" });
  }

  const senderEmail = body.email && body.email.includes("@") ? body.email.trim() : "no-reply@notarylog.net";
  const senderName = body.name?.trim() || "Notary User";
  const category = body.type || "General Feedback / Request";
  const userState = body.state?.trim() || "Unspecified";

  // Escape HTML in user message
  const escapedMessage = body.message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 20px;">
      <h2 style="color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">
        [Notary-Log] ${category}
      </h2>
      <p><strong>From:</strong> ${senderName} (&lt;${senderEmail}&gt;)</p>
      <p><strong>State of Practice:</strong> ${userState}</p>
      <p><strong>Category:</strong> ${category}</p>
      <div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
        <p style="white-space: pre-wrap; margin: 0; font-size: 15px; line-height: 1.5;">${escapedMessage}</p>
      </div>
      <p style="font-size: 12px; color: #64748b; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
        <strong>Device info:</strong> ${body.userAgent || "Unknown"}<br />
        <strong>Timestamp:</strong> ${new Date().toISOString()}
      </p>
    </div>
  `;

  const payload: Record<string, unknown> = {
    sender: { name: "Notary-Log Feedback", email: "feedback@notarylog.net" },
    to: [{ email: "info@justlegalsolutions.org", name: "Just Legal Solutions" }],
    replyTo: { email: senderEmail, name: senderName },
    subject: `[Notary-Log Feedback] ${category} - ${userState}`,
    htmlContent: emailHtml,
  };

  if (body.screenshotBase64) {
    const cleanBase64 = body.screenshotBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    // Brevo attachment limit ~10MB; truncate if huge
    if (cleanBase64.length > 7 * 1024 * 1024) {
      return jsonResponse(413, { error: "Screenshot too large (max ~5MB)" });
    }
    payload.attachment = [
      {
        name: body.screenshotFilename || "screenshot.png",
        content: cleanBase64,
      },
    ];
  }

  try {
    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": env.BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!brevoRes.ok) {
      const errText = await brevoRes.text();
      console.error("Brevo API error:", errText);
      return jsonResponse(502, { error: "Failed to deliver email", detail: errText.slice(0, 500) });
    }

    return jsonResponse(200, { success: true, message: "Feedback delivered successfully" });
  } catch (err) {
    console.error("Feedback dispatch error:", err);
    return jsonResponse(500, { error: "Internal server error" });
  }
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

    if (path === "/api/feedback") {
      return handleFeedback(request, env);
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
