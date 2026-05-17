const { getStore } = require("@netlify/blobs");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event, context) => {
  // Handle preflight OPTIONS requests
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS };
  }

  const store = getStore({ name: "intake", consistency: "strong" });

  // DELETE handler
  if (event.httpMethod === "DELETE") {
    try {
      const { file } = event.queryStringParameters || {};
      if (!file) {
        return {
          statusCode: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Missing 'file' query parameter" }),
        };
      }

      await store.delete(file);

      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, deleted: file }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: error.message }),
      };
    }
  }

  // GET handler
  if (event.httpMethod === "GET") {
    try {
      const { file } = event.queryStringParameters || {};

      // Fetch a single blob by key
      if (file) {
        const blob = await store.get(file, { type: "json" });
        if (!blob) {
          return {
            statusCode: 404,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Blob not found" }),
          };
        }
        return {
          statusCode: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify(blob),
        };
      }

      // List all blobs with prefix 'intake-'
      const { blobs } = await store.list({ prefix: "intake-" });
      const files = blobs.map((blob) => ({
        name: blob.key,
        modifiedTime: blob.lastModified,
        size: blob.size,
      }));

      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      };
    }
  }

  // Method not allowed
  return {
    statusCode: 405,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "Method not allowed" }),
  };
};
