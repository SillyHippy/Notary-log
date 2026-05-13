const PUBLIC_DIR = "./artifacts/notary-journal/dist/public";

const server = Bun.serve({
  port: process.env.PORT || 3000,
  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname;

    if (path === "/") {
      path = "/index.html";
    }

    try {
      const filePath = `${PUBLIC_DIR}${path}`;
      const file = Bun.file(filePath);

      if (await file.exists()) {
        return new Response(file);
      }
    } catch (error) {
      console.error("File error:", error);
    }

    const indexFile = Bun.file(`${PUBLIC_DIR}/index.html`);
    return new Response(indexFile, {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(`Notary Journal server listening on port ${server.port}`);
