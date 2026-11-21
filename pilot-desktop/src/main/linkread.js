// "Read this link" (Pilot for Mac 1.3): when the user sends a message with a
// web link and leaves "Read this link" on, the main process fetches the page
// and sends a readable text version along with the message (or, for a
// picture, the picture itself).
//
// Only http and https, never with cookies, 10 seconds at most, 2 MB at most.
// Never a local, private-network or file address: the host's every address
// is checked before connecting, and again for each redirect (followed by
// hand, at most 4). Scripts, styles and the like are stripped; what's left
// is the title and the main text, about 20,000 characters at most.
"use strict";

const dns = require("node:dns");
const net = require("node:net");

const TIMEOUT_MS = 10000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 20000;
const MAX_REDIRECTS = 4;

class LinkError extends Error {
  constructor(words, kind) { super(words); this.kind = kind || "read"; }
}

// Private, local and special addresses (IPv4 and IPv6).
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return privateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

// Is this an address Pilot may read? Returns the URL, or throws a LinkError.
function checkUrl(raw) {
  let url;
  try { url = new URL(String(raw || "").trim()); } catch (_) { throw new LinkError("That doesn't look like a web address.", "address"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkError("Pilot only reads http and https web pages.", "address");
  if (url.username || url.password) throw new LinkError("Pilot doesn't read addresses with a name or password in them.", "address");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || /\.(local|localhost|internal|lan|home|arpa)$/.test(host) || (!host.includes(".") && !net.isIP(host))) {
    throw new LinkError("Pilot doesn't read addresses on this Mac or your local network.", "private");
  }
  if (net.isIP(host) && privateIp(host)) throw new LinkError("Pilot doesn't read addresses on this Mac or your local network.", "private");
  return url;
}

// Every address the host name has must be public.
async function checkHost(url, lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return;
  let list;
  try { list = await (lookup || ((h) => dns.promises.lookup(h, { all: true })))(host); } catch (_) { throw new LinkError("Pilot couldn't find that website.", "dns"); }
  if (!list.length || list.some((a) => privateIp(a.address))) throw new LinkError("Pilot doesn't read addresses on this Mac or your local network.", "private");
}

// Read a response body, stopping at max bytes.
async function readCapped(res, max) {
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > max) throw new LinkError("That page is too big for Pilot to read (over 2 MB).", "size");
  if (!res.body || !res.body.getReader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new LinkError("That page is too big for Pilot to read (over 2 MB).", "size");
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch (_) { /* fine */ } throw new LinkError("That page is too big for Pilot to read (over 2 MB).", "size"); }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] || m;
  });
}

// The readable part of a web page: its title and main text.
function readable(html) {
  const src = String(html || "");
  const title = decode(((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(src) || [])[1] || "").replace(/\s+/g, " ").trim()).slice(0, 300);
  let body = src.replace(/<!--[\s\S]*?-->/g, " ");
  body = body.replace(/<(script|style|noscript|svg|template|iframe|object|canvas|head|nav|footer|form|button|select)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/i.exec(body);
  if (main && main[2].replace(/<[^>]+>/g, "").trim().length > 400) body = main[2];
  body = body.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n").replace(/<li\b[^>]*>/gi, "\n• ");
  body = body.replace(/<[^>]+>/g, " ");
  const text = decode(body).replace(/[ \t\f\v\r]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text };
}

// Fetch a link. deps: {fetch (net.fetch), lookup (dns), timeoutMs}.
// Returns {kind: "page", url, title, text} or {kind: "image", url, mime, data (base64)}.
async function read(raw, deps) {
  const d = deps || {};
  let url = checkUrl(raw);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), d.timeoutMs || TIMEOUT_MS);
  try {
    let res;
    for (let hop = 0; ; hop += 1) {
      await checkHost(url, d.lookup);
      try {
        res = await d.fetch(url.toString(), { credentials: "omit", redirect: "manual", signal: ctrl.signal,
          headers: { accept: "text/html,text/plain,image/*;q=0.9,*/*;q=0.5" } });
      } catch (e) {
        if (ctrl.signal.aborted) throw new LinkError("That page took too long to answer (10 seconds).", "timeout");
        throw new LinkError("Pilot couldn't reach that page.", "network");
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) throw new LinkError("That page sends Pilot round in circles.", "redirect");
        url = checkUrl(new URL(res.headers.get("location"), url).toString());
        continue;
      }
      break;
    }
    if (!res.ok) throw new LinkError(`That page didn't open (the website said ${res.status}).`, "status");
    const type = String(res.headers.get("content-type") || "").toLowerCase();
    const body = await readCapped(res, MAX_BYTES).catch((e) => {
      if (ctrl.signal.aborted) throw new LinkError("That page took too long to answer (10 seconds).", "timeout");
      throw e;
    });
    if (/^image\/(png|jpeg|gif|webp)/.test(type)) return { kind: "image", url: url.toString(), mime: type.split(";")[0].trim(), data: body.toString("base64") };
    if (type.startsWith("text/html") || type.includes("xhtml")) return { kind: "page", url: url.toString(), ...readable(body.toString("utf8")) };
    if (type.startsWith("text/")) {
      const text = body.toString("utf8").trim();
      return { kind: "page", url: url.toString(), title: "", text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text };
    }
    throw new LinkError("Pilot can read web pages and pictures, but not that kind of file.", "type");
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { TIMEOUT_MS, MAX_BYTES, MAX_TEXT, LinkError, privateIp, checkUrl, checkHost, readable, read };
