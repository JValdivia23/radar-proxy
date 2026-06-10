# PLAN.md — Radar Proxy (Netlify Functions)

**Purpose:** Serverless proxy that forwards browser requests to NOAA/NSSL
MRMS endpoints with the required HTTP headers. Enables the radar frontend
to run as a static site on GitHub Pages without a Python backend.

## Architecture

```
GitHub Pages (JValdivia23.github.io/personal_webpage/radar/)
  └── index.html (static, JS-only)
        │
        │  fetch("https://radar-proxy.netlify.app/api/radar?...")
        │  fetch("https://radar-proxy.netlify.app/api/legend?...")
        ▼
Netlify Functions (radar-proxy.netlify.app)
  └── netlify/functions/radar-proxy.js
        │
        │  fetch(NOAA URL, { headers: { User-Agent, Referer } })
        ▼
NOAA/NSSL MRMS (mrms.nssl.noaa.gov)
  └── render_multi_domain_product_layer.php   → PNG
  └── fetch_svg_legend_via_config.php          → SVG
```

## Connections to other projects

| Project | Relationship |
|---|---|
| `radar_app/` | CLI + local dev server. Defines the radar app logic. The `static/` folder is the source for the frontend. |
| `personal_webpage/` | Next.js static site. Will host the radar app at `/personal_webpage/radar/`. Links to this proxy. |
| `radar-proxy/` | **This project.** Standalone Netlify deployment. Only dependency is Node.js built-in `fetch()`. |

## Files

| File | Purpose |
|---|---|
| `netlify.toml` | Netlify config: build settings, env vars, redirect rules |
| `netlify/functions/radar-proxy.js` | Single function handling `/api/radar` and `/api/legend` |
| `PLAN.md` | This file. |

## Key design decisions

### Why a separate repo?

- `personal_webpage` is deployed to GitHub Pages (static hosting, no serverless functions)
- `radar_app` is the Python project (CLI + local server)
- The proxy is infrastructure — cleanest as its own deployable unit

### Why `node_bundler = "esbuild"`?

Zero npm dependencies. The function uses only Node.js 18+ built-in `fetch()`.
`esbuild` bundles the function on deploy with no `package.json` needed.

### Why `NODE_TLS_REJECT_UNAUTHORIZED = "0"`?

NOAA's server doesn't send the intermediate CA certificate in its TLS
handshake (Sectigo Public Server Authentication CA DV R36). This is the
Node.js equivalent of Python's `verify=False`.

### Why base64-encode PNG responses?

Netlify Functions return JSON-style response objects. For binary data (PNG
images), we encode as base64 and set `isBase64Encoded: true`. SVG responses
are text, so no encoding needed.

### CORS headers

The frontend runs on `JValdivia23.github.io` while the proxy runs on
`radar-proxy.netlify.app`. Cross-origin requests require
`Access-Control-Allow-Origin: *` on all responses.

## Security

- No API keys, no secrets, no authentication
- The function only forwards public NOAA data
- Rate limiting is handled by NOAA's servers, not by us

## Free tier limits (Netlify)

| Resource | Limit |
|---|---|
| Requests | 125,000/month |
| Build minutes | 300/month |
| Bandwidth | 100 GB/month |
| Function execution | 10 seconds/timeout |

At ~2 requests per page load and typical personal usage (hundreds, not
thousands of loads per month), this will never exceed the free tier.

## Deployment

1. Push to GitHub: `JValdivia23/radar-proxy`
2. Connect to Netlify (GitHub login): netlify.com → "Import an existing project"
3. Netlify auto-detects `netlify.toml` and deploys
4. Function live at: `https://<site-name>.netlify.app/api/radar?product=...`
5. Custom subdomain option: rename to `radar-proxy.netlify.app` in Netlify UI

## Testing

```bash
# Test radar endpoint
curl "https://<site>.netlify.app/api/radar?product=M3DL13&lat=40.55&lon=-104.68&zoom=7&width=920&height=630" -o test.png
file test.png        # should be "PNG image data"
```

## Future improvements

- Add minimal cache layer (Netlify edge caching) to reduce NOAA calls
- Serve product catalog as static JSON (no proxy call needed)
- Rate limiting per IP to prevent abuse
