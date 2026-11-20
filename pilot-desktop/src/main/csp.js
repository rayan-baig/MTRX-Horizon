// The Content-Security-Policy for every Pilot window, and the pilot://
// address the windows load from. Windows only ever load Pilot's own files
// from inside the app: no remote pages, no inline scripts or styles.
//
// The AI calls themselves run in the main process (so a window never holds a
// key), but connect-src still lists only the providers' API hosts plus the
// user's own compatible address, so a window couldn't reach anywhere else.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROVIDER_HOSTS = ["https://api.anthropic.com", "https://api.openai.com", "https://generativelanguage.googleapis.com"];

// Only these files can be served to a window.
const SERVED = [/^src\/renderer\/[a-z0-9-]+\.(html|css|js|svg)$/, /^src\/core\/pilot-render\.js$/, /^assets\/[a-z0-9@-]+\.png$/];

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png" };

function buildCsp(extraOrigins) {
  const extra = (extraOrigins || []).filter((o) => /^https?:\/\/[a-z0-9.\-[\]:]+$/i.test(o) && !PROVIDER_HOSTS.includes(o));
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src ${[...PROVIDER_HOSTS, ...extra].join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// pilot://app/<path> → a file inside the app, with the CSP header.
function serve(appDir, rawUrl, extraOrigins) {
  let url;
  try { url = new URL(rawUrl); } catch (_) { return { status: 400, headers: {}, body: "" }; }
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (url.host !== "app" || rel.includes("..") || !SERVED.some((re) => re.test(rel))) return { status: 404, headers: {}, body: "" };
  const file = path.join(appDir, rel);
  let body;
  try { body = fs.readFileSync(file); } catch (_) { return { status: 404, headers: {}, body: "" }; }
  return {
    status: 200,
    headers: {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "content-security-policy": buildCsp(extraOrigins),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
    body,
  };
}

module.exports = { PROVIDER_HOSTS, buildCsp, serve };
