// MRMS Radar — Netlify Functions proxy
//
// Forwards browser requests to NOAA/NSSL MRMS endpoints with the required
// headers (User-Agent, Referer) and adds CORS headers so the frontend on
// GitHub Pages can call it cross-origin.
//
// NOAA has a broken SSL certificate chain (missing intermediate CA). The
// https agent uses rejectUnauthorized:false — same as Python's verify=False.

const https = require("https");

const AGENT = new https.Agent({ rejectUnauthorized: false });

function noaaGet(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: "GET",
      agent: AGENT,
      headers: {
        "User-Agent": "MRMS-Radar/1.0",
        Referer:
          "https://mrms.nssl.noaa.gov/qvs/product_viewer/index.php",
      },
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

exports.handler = async (event) => {
  const path = event.path;
  const params = event.queryStringParameters || {};
  const method = event.httpMethod;

  // ── CORS preflight ──────────────────────────────────────────────
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    };
  }

  const corsHeaders = { "Access-Control-Allow-Origin": "*" };

  // ── /api/radar → NOAA render endpoint ───────────────────────────
  if (path.includes("/api/radar")) {
    const url = new URL(
      "https://mrms.nssl.noaa.gov/qvs/product_viewer/local/" +
        "render_multi_domain_product_layer.php",
    );
    Object.entries(params).forEach(([k, v]) =>
      url.searchParams.set(k, v),
    );

    const resp = await noaaGet(url.toString());
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=120",
      },
      body: resp.body.toString("base64"),
      isBase64Encoded: true,
    };
  }

  // ── /api/legend → NOAA legend endpoint ──────────────────────────
  if (path.includes("/api/legend")) {
    const url = new URL(
      "https://mrms.nssl.noaa.gov/qvs/product_viewer/shared/" +
        "fetch_svg_legend_via_config.php",
    );
    Object.entries(params).forEach(([k, v]) =>
      url.searchParams.set(k, v),
    );

    const resp = await noaaGet(url.toString());
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400, immutable",
      },
      body: resp.body.toString("utf-8"),
    };
  }

  // ── 404 ─────────────────────────────────────────────────────────
  return {
    statusCode: 404,
    headers: corsHeaders,
    body: JSON.stringify({ error: "endpoint not found", path }),
  };
};
