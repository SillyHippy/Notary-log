import { handleIntakeRequest } from "../lib/serverless/intake-api";
import { createKvIntakeStore } from "../lib/serverless/intake-store-kv";

export interface Env {
  ASSETS: Fetcher;
  INTAKE_KV: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/intake")) {
      return handleIntakeRequest(request, url, createKvIntakeStore(env.INTAKE_KV));
    }
    return env.ASSETS.fetch(request);
  },
};
