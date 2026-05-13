import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';

const app = new Hono();
const staticRoot = './artifacts/notary-journal/dist/public';

app.use('/*', serveStatic({ root: staticRoot }));

app.get('/*', async c => {
  const index = await Bun.file(`${staticRoot}/index.html`).text();
  return c.html(index);
});

export default app;
