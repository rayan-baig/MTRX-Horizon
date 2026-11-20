// Pilot desktop · media.js
// The desktop layer over the shared web core (pilot-media.js, Pilot core
// 1.0.0, copied unchanged; see core-version.json): pictures and videos with
// the user's own image or video key. The core does the requests; this layer
// runs it in Node, lets the user's own compatible address through, and hands
// back videos as bytes for the chat window.
"use strict";

const coreProviders = require("./pilot-providers");
const providers = require("./providers");

// pilot-media.js finds the provider helpers on the global object (as it does
// in a browser), so give it the same shared core module here.
if (!globalThis.PilotProviders) globalThis.PilotProviders = coreProviders;
const core = require("./pilot-media");

const VERSION = `${core.VERSION}-desktop`;

function settle(p) {
  if (!p || p.provider === "anthropic") throw new providers.PilotError("other", "Anthropic doesn't make pictures or videos. Pick another provider for this key.");
  if (p.provider !== "compatible") return p;
  const bad = providers.checkBaseUrl(p.baseUrl);
  if (bad) throw bad;
  return { ...p, baseUrl: String(p.baseUrl).replace(/\/+$/, "") };
}

// The core checks a compatible address against a list of allowed hosts;
// on the Mac that's simply the user's own address.
function opts(p, o) {
  const hosts = [];
  if (p.provider === "compatible") { const u = new URL(p.baseUrl); hosts.push(u.host, u.hostname); }
  return { fetch: o.fetch, signal: o.signal, compatibleHosts: hosts };
}

async function listModels(kind, p, o) {
  const s = settle(p);
  return core.listModels(kind, s, opts(s, o));
}

// One picture: {mime, data (base64)}.
async function image(p, text, o) {
  const s = settle(p);
  const pic = await core.image(s, text, opts(s, o));
  if (!pic || !pic.data) throw new providers.PilotError("other", "The provider sent a link instead of a picture, which Pilot can't show. Try another image model.");
  return pic;
}

async function startVideo(p, text, o) { const s = settle(p); return core.startVideo(s, text, opts(s, o)); }
async function checkVideo(p, id, o) { const s = settle(p); return core.checkVideo(s, id, opts(s, o)); }

// The finished video: {mime, bytes (Uint8Array)}.
async function fetchVideo(p, id, done, o) {
  const s = settle(p);
  const blob = await core.fetchVideo(s, id, done, opts(s, o));
  return { mime: blob.type && blob.type.startsWith("video/") ? blob.type : "video/mp4", bytes: new Uint8Array(await blob.arrayBuffer()) };
}

module.exports = { VERSION, CORE_VERSION: core.VERSION, listModels, image, startVideo, checkVideo, fetchVideo };
