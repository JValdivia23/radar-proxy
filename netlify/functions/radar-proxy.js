// MRMS Radar — Netlify Functions proxy
//
// Forwards browser requests to NOAA/NSSL MRMS endpoints with the required
// headers (User-Agent, Referer) and adds CORS so the frontend on GitHub Pages
// can call it cross-origin.
//
// NOAA's server has a broken SSL certificate chain. Netlify Functions use
// Node.js fetch() which respects NODE_TLS_REJECT_UNAUTHORIZED=0 (set in
// netlify.toml).

exports.handler = async (event) => {
  const path = event.path;
  const params = event.queryStringParameters || {};
  const method = event.httpMethod;

  // ── CORS preflight ──────────────────────────────────────────────────────
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

  // ── /api/radar → NOAA render endpoint ───────────────────────────────────
  if (path.includes("/api/radar")) {
    const url = new URL(
      "https://mrms.nssl.noaa.gov/qvs/product_viewer/local/render_multi_domain_product_layer.php",
    );
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "MRMS-Radar/1.0",
        Referer: "https://mrms.nssl.noaa.gov/qvs/product_viewer/index.php",
      },
    });

    const buf = Buffer.from(await resp.arrayBuffer());
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=120",
        "X-MRMS-Timestamp":
          resp.headers.get("X-MRMS-Timestamp") || "",
      },
      body: buf.toString("base64"),
      isBase64Encoded: true,
    };
  }

  // ── /api/legend → NOAA legend endpoint ──────────────────────────────────
  if (path.includes("/api/legend")) {
    const url = new URL(
      "https://mrms.nssl.noaa.gov/qvs/product_viewer/shared/fetch_svg_legend_via_config.php",
    );
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "MRMS-Radar/1.0",
        Referer: "https://mrms.nssl.noaa.gov/qvs/product_viewer/index.php",
      },
    });

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400, immutable",
      },
      body: await resp.text(),
    };
  }

  // ── 404 ─────────────────────────────────────────────────────────────────
  return {
    statusCode: 404,
    headers: corsHeaders,
    body: JSON.stringify({ error: "endpoint not found", path }),
  };
};
