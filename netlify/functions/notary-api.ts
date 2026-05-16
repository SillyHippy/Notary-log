import { handleIntakeRequest } from "../../lib/serverless/intake-api";
import { createNetlifyIntakeStore } from "../../lib/serverless/intake-store-netlify";

/** Netlify rewrites should preserve the public URL; these headers cover edge cases. */
function intakeRequestUrl(request: Request): URL {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/intake")) return url;

  const candidates = [
    request.headers.get("x-nf-request-url"),
    request.headers.get("x-forwarded-uri"),
    request.headers.get("x-nf-original-url"),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = raw.startsWith("http")
        ? new URL(raw)
        : new URL(raw.startsWith("/") ? raw : `/${raw}`, url.origin);
      if (parsed.pathname.startsWith("/api/intake")) return parsed;
    } catch {
      // try next header
    }
  }
  return url;
}

export default async (request: Request): Promise<Response> => {
  const url = intakeRequestUrl(request);
  if (!url.pathname.startsWith("/api/intake")) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return handleIntakeRequest(request, url, createNetlifyIntakeStore());
};
