import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const app = new Hono();
const staticRoot = "./artifacts/notary-journal/dist/public";
const fallbackPort = 3000;
const parsedPort = Number.parseInt(process.env.PORT ?? "", 10);
const port =
  Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : fallbackPort;

app.use("/*", serveStatic({ root: staticRoot }));

app.get("/*", async (c) => {
  const index = await Bun.file(`${staticRoot}/index.html`).text();
  return c.html(index);
});

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Notary Journal server listening on port ${port}`);

export default app;
