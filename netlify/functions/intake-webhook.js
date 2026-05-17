const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event, context) => {
  // Handle preflight OPTIONS requests
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const store = getStore({ name: "intake", consistency: "strong" });

    let bodyObj;
    try {
      bodyObj = JSON.parse(event.body || "{}");
    } catch {
      bodyObj = {};
    }

    const accessKey = bodyObj.access_key;
    if (!accessKey) {
      return {
        statusCode: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing 'access_key' in request body" }),
      };
    }

    const uuid = crypto.randomUUID();
    const key = `user/${accessKey}/intake-${Date.now()}-${uuid}`;

    const body = event.body || "";
    const contentType =
      event.headers["content-type"] || "application/json";

    await store.set(key, body, {
      contentType,
      customMetadata: {
        receivedAt: new Date().toISOString(),
        contentType,
      },
    });

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success: true, key }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
