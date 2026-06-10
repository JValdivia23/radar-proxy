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
    const baseUrl =
      "https://mrms.nssl.noaa.gov/qvs/product_viewer/local/" +
      "render_multi_domain_product_layer.php";

    // --- resolve time (mirrors mrms_core.py ln 143-151) ------------
    let year, month, day, hour, minute;
    if (params.year == null) {
      const now = new Date();
      const m = Math.floor(now.getUTCMinutes() / 2) * 2;
      const d = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          now.getUTCHours(),
          m - 4,
        ),
      );
      year = d.getUTCFullYear();
      month = d.getUTCMonth() + 1;
      day = d.getUTCDate();
      hour = d.getUTCHours();
      minute = d.getUTCMinutes();
    } else {
      year = +params.year;
      month = +params.month;
      day = +params.day;
      hour = +params.hour;
      minute = +params.minute;
    }

    // --- retry loop (mirrors mrms_core.py ln 156-241) ---------------
    let lastResp = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const stepMin = minute - attempt * 2;
      const t = new Date(
        Date.UTC(year, month - 1, day, hour, stepMin),
      );
      const url = new URL(baseUrl);
      url.searchParams.set("mode", "run");
      url.searchParams.set(
        "cpp_exec_dir",
        "/home/metop/web/specific/opv/",
      );
      url.searchParams.set(
        "web_resources_dir",
        "/var/www/html/qvs/product_viewer/resources/",
      );
      url.searchParams.set("prod_root", params.product || "M3DL13");
      url.searchParams.set("qperate_pal_option", "0");
      url.searchParams.set("qpe_pal_option", "0");
      url.searchParams.set("year", String(t.getUTCFullYear()));
      url.searchParams.set("month", String(t.getUTCMonth() + 1));
      url.searchParams.set("day", String(t.getUTCDate()));
      url.searchParams.set("hour", String(t.getUTCHours()));
      url.searchParams.set("minute", String(t.getUTCMinutes()));
      url.searchParams.set(
        "clon",
        params.lon || String(params.clon || "-104.68"),
      );
      url.searchParams.set(
        "clat",
        params.lat || String(params.clat || "40.55"),
      );
      url.searchParams.set("zoom", params.zoom || "7");
      url.searchParams.set("width", params.width || "920");
      url.searchParams.set("height", params.height || "630");

      lastResp = await noaaGet(url.toString());
      if (lastResp.body.length >= 1024) break;
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=120",
      },
      body: (lastResp || { body: Buffer.alloc(0) }).body.toString(
        "base64",
      ),
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
