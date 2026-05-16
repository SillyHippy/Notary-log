import { handleIntakeRequest } from "../../lib/serverless/intake-api";
import { createNetlifyIntakeStore } from "../../lib/serverless/intake-store-netlify";

/** Netlify rewrites should preserve the public URL; this covers edge cases. */
function intakeRequestUrl(request: Request): URL {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/intake")) return url;
  const forwarded =
    request.headers.get("x-forwarded-uri") ??
    request.headers.get("x-nf-original-url");
  if (forwarded) {
    const path = forwarded.startsWith("/") ? forwarded : `/${forwarded}`;
    if (path.startsWith("/api/intake")) {
      return new URL(path + url.search, url.origin);
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
