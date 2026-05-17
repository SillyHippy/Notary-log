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
      const { key, access_key } = event.queryStringParameters || {};
      if (!access_key) {
        return {
          statusCode: 401,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Missing 'access_key' query parameter" }),
        };
      }
      if (!key) {
        return {
          statusCode: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Missing 'key' query parameter" }),
        };
      }

      const fullKey = `user/${access_key}/${key}`;
      await store.delete(fullKey);

      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, deleted: fullKey }),
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
        const { access_key } = event.queryStringParameters || {};
        if (!access_key) {
          return {
            statusCode: 401,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Missing 'access_key' query parameter" }),
          };
        }
        const fullKey = `user/${access_key}/${file}`;
        const blob = await store.get(fullKey, { type: "json" });
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

      // List all blobs with prefix 'user/{access_key}/'
      const { access_key } = event.queryStringParameters || {};
      if (!access_key) {
        return {
          statusCode: 401,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Missing 'access_key' query parameter" }),
        };
      }
      const { blobs } = await store.list({ prefix: `user/${access_key}/` });
      const files = blobs.map((blob) => ({
        key: blob.key,
        lastModified: blob.lastModified,
        size: blob.size,
        contentType: blob.contentType,
        customMetadata: blob.customMetadata,
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
