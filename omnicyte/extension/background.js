// Omnicyte's browser half. It asks the Omnicyte app on this computer (127.0.0.1)
// about links and pages. Nothing is sent anywhere else, and nothing is stored
// except the pairing code and a few minutes' memory of answers.
"use strict";

const API = "http://127.0.0.1:47321";
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // href -> {at, verdict}

async function token() {
  const { omnicyteToken } = await chrome.storage.local.get("omnicyteToken");
  return omnicyteToken || "";
}

async function call(path, body) {
  const t = await token();
  if (!t) return { error: "not paired" };
  try {
    const res = await fetch(API + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "X-Omnicyte-Token": t },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 403) return { error: "not paired" };
    if (!res.ok) return { error: "app error " + res.status };
    return await res.json();
  } catch (e) {
    return { error: "app not running" };
  }
}

async function checkLinks(msg) {
  const now = Date.now();
  const out = {};
  const ask = [];
  for (const l of msg.links || []) {
    const hit = cache.get(l.href);
    if (hit && now - hit.at < CACHE_MS) out[l.href] = hit.verdict;
    else ask.push(l);
  }
  for (let i = 0; i < ask.length; i += 200) {
    const res = await call("/v1/links", { links: ask.slice(i, i + 200), site: msg.site, kind: msg.kind });
    if (res.error) return { error: res.error, links: out };
    for (const [href, v] of Object.entries(res.links || {})) {
      cache.set(href, { at: now, verdict: v });
      out[href] = v;
    }
  }
  if (cache.size > 5000) cache.clear();
  return { links: out };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const work =
    msg.type === "links" ? checkLinks(msg) :
    msg.type === "page" ? call("/v1/page", { url: msg.url, password_field: !!msg.password_field }) :
    msg.type === "status" ? call("/v1/status") :
    Promise.resolve({ error: "unknown" });
  work.then(reply);
  return true; // answer asynchronously
});
