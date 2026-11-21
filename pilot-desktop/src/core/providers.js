// Pilot desktop · providers.js
// The desktop layer over the shared web core (pilot-providers.js, Pilot core
// 1.0.0, copied unchanged; see core-version.json). The core's adapters do the
// talking: the same requests, streaming, model lists and plain-words errors.
// This layer adds what only the Mac app needs:
//
//   - pictures: a screenshot can go with the user's message, or come back
//     from the "look at the screen" tool ({mime, data} base64);
//   - the calls run in the main process (Node), not a browser, so the
//     Anthropic browser-access header is left out;
//   - the user may type any https:// (or http://localhost) compatible address:
//     it's their own app, so there's no site allowlist;
//   - Free mode (1.4): "local", the OpenAI-compatible server of Ollama on the
//     Mac itself (http://127.0.0.1 only). It isn't in the provider list (no
//     key to add); the main process picks it when Free mode is on.
//
// Pilot's message shape (same as the core, plus `images` and `image`):
//   {role: "user", text, images: [{mime, data}]}
//   {role: "assistant", text, toolCalls: [{id, name, args}], raw}
//   {role: "tool", results: [{id, name, content, isError, image}]}
//
// No model names are written here: models come from the provider's own list
// for the user's key, or the user types one. `fetch` is always passed in.
"use strict";

const core = require("./pilot-providers");

const VERSION = `${core.VERSION}-desktop`;
const { PilotError, LIST: CORE_LIST } = core;

const HOSTS = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
};

const LIST = CORE_LIST.map((p) => (p.id === "compatible" ? { ...p, label: "Any compatible API" } : { ...p }));
const NAMES = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google Gemini", compatible: "your provider", local: "Ollama on your Mac" };

// Free mode only ever talks to this Mac.
const localBase = (raw) => {
  try {
    const u = new URL(String(raw || ""));
    return u.protocol === "http:" && u.hostname === "127.0.0.1" && !u.username && !u.password && !u.search && !u.hash;
  } catch (_) { return false; }
};

function providerName(s) {
  if (s && s.provider === "local") return NAMES.local;
  if (s && s.provider === "compatible" && s.baseUrl) {
    try { return new URL(s.baseUrl).host; } catch (_) { return "your provider"; }
  }
  return NAMES[s && s.provider] || "your provider";
}

// An OpenAI-compatible address, or a PilotError saying what's wrong with it.
function checkBaseUrl(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch (_) {
    return new PilotError("address", "That address doesn't look right. It should start with https:// (or http://localhost).");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    return new PilotError("address", "Use an https:// address. Plain http:// works only for your own computer (localhost).");
  }
  if (url.username || url.password || url.search || url.hash) {
    return new PilotError("address", "Leave out any password, ? or # part. Put the key in the key box instead.");
  }
  return null;
}

const toolText = (r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content));
const pictures = (list) => (Array.isArray(list) ? list.filter((i) => i && typeof i.data === "string" && /^image\/(png|jpeg|webp|gif)$/.test(i.mime)) : []);
const videos = (list) => (Array.isArray(list) ? list.filter((v) => v && typeof v.uri === "string" && /^https:\/\/generativelanguage\.googleapis\.com\//.test(v.uri) && /^video\//.test(v.mime)) : []);
const picOf = (r) => (r && r.image ? pictures([r.image])[0] : null);

// ---------------------------------------------------------------- the core's adapters, with pictures

const anthropic = Object.create(core.adapters.anthropic);
anthropic.headers = function headers(s) {
  const h = core.adapters.anthropic.headers.call(this, s);
  delete h["anthropic-dangerous-direct-browser-access"]; // not a browser
  return h;
};
anthropic.toWire = function toWire(messages) {
  const block = (i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } });
  const wire = [];
  for (const m of messages) {
    if (m.role === "user") {
      const pics = pictures(m.images);
      wire.push({ role: "user", content: pics.length ? [...pics.map(block), { type: "text", text: m.text }] : m.text });
    } else if (m.role === "tool") {
      wire.push({ role: "user", content: m.results.map((r) => {
        const pic = picOf(r);
        return { type: "tool_result", tool_use_id: r.id, content: pic ? [{ type: "text", text: toolText(r) }, block(pic)] : toolText(r),
          ...(r.isError ? { is_error: true } : {}) };
      }) });
    } else {
      wire.push(...core.adapters.anthropic.toWire([m]));
    }
  }
  return wire;
};

function openaiLike(id) {
  const a = Object.create(core.adapters[id]);
  const part = (i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } });
  a.toWire = function toWire(system, messages) {
    const wire = [{ role: "system", content: system }];
    for (const m of messages) {
      if (m.role === "user") {
        const pics = pictures(m.images);
        wire.push({ role: "user", content: pics.length ? [{ type: "text", text: m.text }, ...pics.map(part)] : m.text });
      } else if (m.role === "tool") {
        const pics = [];
        for (const r of m.results) {
          wire.push({ role: "tool", tool_call_id: r.id, content: toolText(r) });
          const pic = picOf(r);
          if (pic) pics.push(pic);
        }
        // Tool messages carry text only here, so a screenshot a tool took
        // follows straight after the results, as the user's picture.
        if (pics.length) wire.push({ role: "user", content: [{ type: "text", text: "The screenshot from the tool result above:" }, ...pics.map(part)] });
      } else {
        wire.push(...core.adapters[id].toWire(system, [m]).slice(1));
      }
    }
    return wire;
  };
  return a;
}

const gemini = Object.create(core.adapters.gemini);
gemini.toWire = function toWire(messages) {
  const inline = (i) => ({ inlineData: { mimeType: i.mime, data: i.data } });
  // A video uploaded with Gemini's file upload (uploads.js), by its address.
  const file = (v) => ({ fileData: { mimeType: v.mime, fileUri: v.uri } });
  // The core keeps tool names by call id across the whole history, so let it
  // build the history, then add the pictures to the matching turns.
  const plain = messages.map((m) => (m.role === "user" ? { role: "user", text: m.text } : m));
  const contents = core.adapters.gemini.toWire(plain);
  let at = 0;
  for (const m of messages) {
    if (m.role === "assistant" && !(m.text || (m.toolCalls || []).length || (m.raw && m.raw.parts && m.raw.parts.length))) continue;
    const turn = contents[at];
    at += 1;
    if (!turn) break;
    if (m.role === "user") turn.parts = [...videos(m.videos).map(file), ...pictures(m.images).map(inline), ...turn.parts];
    else if (m.role === "tool") for (const r of m.results) { const pic = picOf(r); if (pic) turn.parts.push(inline(pic)); }
  }
  return contents;
};

// Free mode: the compatible adapter, pointed at Ollama on this Mac. Models
// that think out loud wrap it in <think>…</think>: that part isn't shown.
const stripThinking = (t) => String(t || "").replace(/<think>[\s\S]*?<\/think>\s*/g, "").replace(/<think>[\s\S]*$/, "");

function localError(e, s) {
  if (!e || !e.kind) return e;
  const host = (() => { try { return new URL(s.baseUrl).host; } catch (_) { return ""; } })();
  if (e.kind === "network") {
    return new PilotError("network", "Pilot couldn't reach Ollama on your Mac. Open the Ollama app (it lives in the menu bar), then try again.");
  }
  if (e.kind === "model") return new PilotError("model", `Ollama doesn't have the brain “${s.model}” yet. Download it in Settings → Free mode.`, e.status);
  if (e.kind === "noimages") return new PilotError("noimages", "This brain can't look at pictures. Pick one that can in Settings → Free mode.", e.status);
  const words = host ? String(e.message).split(host).join(NAMES.local) : String(e.message);
  return new PilotError(e.kind, words.replace(/your provider/g, NAMES.local), e.status);
}

const compatibleAdapter = openaiLike("compatible");
const local = Object.create(compatibleAdapter);
local.models = async function models(s, fetcher, signal) {
  try { return await compatibleAdapter.models.call(this, s, fetcher, signal); } catch (e) { throw localError(e, s); }
};
local.chat = async function chat(s, req, fetcher) {
  const onText = req.onText ? (t) => req.onText(stripThinking(t)) : undefined;
  try {
    const r = await compatibleAdapter.chat.call(this, s, { ...req, onText }, fetcher);
    return { ...r, text: stripThinking(r.text).trim() };
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw localError(e, s);
  }
};

const ADAPTERS = { anthropic, openai: openaiLike("openai"), compatible: compatibleAdapter, gemini, local };

function prepare(s) {
  const a = ADAPTERS[s && s.provider];
  if (!a) throw new PilotError("key", "Choose an AI provider in Pilot settings first.");
  if (s.provider === "local") {
    if (!localBase(s.baseUrl)) throw new PilotError("address", "Free mode only talks to Ollama on this Mac.");
    return { a, s: { ...s, key: "", baseUrl: String(s.baseUrl).replace(/\/+$/, "") } };
  }
  if (s.provider !== "compatible") return { a, s };
  const bad = checkBaseUrl(s.baseUrl);
  if (bad) throw bad;
  return { a, s: { ...s, baseUrl: String(s.baseUrl).replace(/\/+$/, "") } };
}

// The models this key may use: [{id, label, maxTokens}].
async function listModels(settings, options) {
  const o = options || {};
  const { a, s } = prepare(settings);
  return a.models(s, o.fetch, o.signal);
}

// One turn: streams the words to req.onText, returns
// {text, toolCalls, stop: "done" | "tools" | "length" | "refused", raw}.
async function chat(settings, req, options) {
  const o = options || {};
  const { a, s } = prepare(settings);
  if (!s.model) throw new PilotError("model", "Pick a model in Pilot settings first.");
  return a.chat(s, req, o.fetch);
}

// The web address a set of settings may call, or null.
function originFor(s) {
  if (!s) return null;
  if (HOSTS[s.provider]) return HOSTS[s.provider];
  if (s.provider === "compatible" && !checkBaseUrl(s.baseUrl)) return new URL(s.baseUrl).origin;
  if (s.provider === "local" && localBase(s.baseUrl)) return new URL(s.baseUrl).origin;
  return null;
}

module.exports = {
  VERSION, CORE_VERSION: core.VERSION, LIST, NAMES, HOSTS, PilotError, providerName, checkBaseUrl, listModels, chat,
  readEvents: core.readEvents, originFor, adapters: ADAPTERS, stripThinking, localBase,
};
