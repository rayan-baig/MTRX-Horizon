// Free mode: AI that runs on the Mac, with no keys.
//
//   Chat      Ollama, the free app, on its local server http://127.0.0.1:11434.
//             Pilot talks to its OpenAI-compatible address (/v1) for chat,
//             and to its own API for the model list (/api/tags), downloading
//             a model ("Download brain", /api/pull, with progress) and what a
//             model can do (/api/show: tools, pictures).
//   Pictures  Draw Things, the free app, when its API Server is switched on
//             (Draw Things → Settings → API Server: on, HTTP, port 7860). It
//             answers like the common txt2img API at http://127.0.0.1:7860.
//   Videos    not in Free mode: local video isn't practical on a Mac.
//
// Nothing is installed by Pilot: the setup cards open the download pages in
// the browser and Pilot notices when the apps are there. Which model to
// recommend comes from src/config/free-models.json (editable, by memory), never
// from this code. Every call here gets `fetch` passed in.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const OLLAMA = "http://127.0.0.1:11434";
const DRAW_THINGS = "http://127.0.0.1:7860";
const LOCAL_ORIGINS = [OLLAMA, DRAW_THINGS];
const OLLAMA_DOWNLOAD = "https://ollama.com/download";
const DRAW_THINGS_STORE = "https://apps.apple.com/app/draw-things/id6444050820";
const MODELS_FILE = "free-models.json";
const BUILT_IN = path.join(__dirname, "..", "config", MODELS_FILE);

const GiB = 1024 ** 3;

// The two local addresses. The smoke test may point them at its pretend
// servers (only in a test run that isn't packaged).
function origins(o) {
  const opts = o || {};
  const env = opts.env || {};
  const ok = (v) => (typeof v === "string" && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(v) ? v : "");
  const test = opts.test && !opts.packaged;
  return {
    ollama: (test && ok(env.PILOT_TEST_OLLAMA)) || OLLAMA,
    drawThings: (test && ok(env.PILOT_TEST_DRAWTHINGS)) || DRAW_THINGS,
  };
}

// ---------------------------------------------------------------- the recommended brains (a data file)

function cleanList(data) {
  const list = data && Array.isArray(data.recommend) ? data.recommend : [];
  return list.filter((m) => m && typeof m.model === "string" && /^[a-z0-9][a-z0-9._\-/:]{0,120}$/i.test(m.model))
    .map((m) => ({ model: m.model, minMemoryGB: Number(m.minMemoryGB) || 0, label: String(m.label || m.model).slice(0, 80),
      download: String(m.download || "").slice(0, 40) }))
    .sort((a, b) => a.minMemoryGB - b.minMemoryGB);
}

// The owner's copy in the settings folder wins over the built-in file.
function loadRecommended(o) {
  const opts = o || {};
  const read = opts.readFile || ((f) => fs.readFileSync(f, "utf8"));
  for (const file of [opts.userDir ? path.join(opts.userDir, MODELS_FILE) : "", opts.builtIn || BUILT_IN]) {
    if (!file) continue;
    try {
      const list = cleanList(JSON.parse(read(file)));
      if (list.length) return list;
    } catch (_) { /* missing or broken: the next one */ }
  }
  return [];
}

// The biggest brain this Mac's memory fits.
function recommend(list, totalBytes) {
  const gb = Math.round((Number(totalBytes) || 0) / GiB);
  let pick = null;
  for (const m of list || []) if (m.minMemoryGB <= gb) pick = m;
  return pick || (list && list[0]) || null;
}

const memoryGB = (bytes) => Math.round((Number(bytes) || 0) / GiB);

// "name" and "name:latest" are the same model to Ollama.
const sameModel = (a, b) => String(a || "").replace(/:latest$/, "") === String(b || "").replace(/:latest$/, "");

// ---------------------------------------------------------------- is it there?

function appPaths(o) {
  const opts = o || {};
  const home = opts.home || "";
  const dirs = opts.appsDirs || ["/Applications", home ? path.join(home, "Applications") : ""].filter(Boolean);
  const bins = opts.binDirs || ["/usr/local/bin", "/opt/homebrew/bin"];
  return {
    ollama: [...dirs.map((d) => path.join(d, "Ollama.app")), ...bins.map((d) => path.join(d, "ollama"))],
    drawThings: dirs.map((d) => path.join(d, "Draw Things.app")),
  };
}

// Which of the two apps are installed: the first path found, or "".
function installed(o) {
  const opts = o || {};
  const exists = opts.exists || ((p) => fs.existsSync(p));
  const p = appPaths(opts);
  const first = (list) => list.find((x) => { try { return exists(x); } catch (_) { return false; } }) || "";
  return { ollama: first(p.ollama), drawThings: first(p.drawThings) };
}

async function getJson(fetcher, url, init, ms) {
  const res = await fetcher(url, { ...(init || {}), credentials: "omit", signal: AbortSignal.timeout(ms || 2500) });
  if (!res.ok) { const e = new Error(`status ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

const sizeWords = (bytes) => {
  const n = Number(bytes) || 0;
  return n >= GiB ? `${(n / GiB).toFixed(1)} GB` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : "";
};

// Ollama: "running" (with its models), "stopped" (installed, not answering)
// or "missing".
async function ollamaStatus(o) {
  const opts = o || {};
  const base = opts.base || OLLAMA;
  try {
    const v = await getJson(opts.fetch, `${base}/api/version`, { method: "GET" }, 1500);
    let models = [];
    try {
      const tags = await getJson(opts.fetch, `${base}/api/tags`, { method: "GET" }, 4000);
      models = (Array.isArray(tags && tags.models) ? tags.models : [])
        .filter((m) => m && typeof (m.name || m.model) === "string")
        .map((m) => ({ id: m.name || m.model, size: sizeWords(m.size),
          params: String((m.details && m.details.parameter_size) || "").slice(0, 20) }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (_) { models = []; }
    return { state: "running", version: String((v && v.version) || "").slice(0, 20), models };
  } catch (_) {
    return { state: opts.installed ? "stopped" : "missing", version: "", models: [] };
  }
}

// What a model can do, from Ollama: {tools, vision}, or null when this
// Ollama doesn't say (then Pilot tries tools and falls back to plain chat).
async function capabilities(o) {
  const opts = o || {};
  try {
    const info = await getJson(opts.fetch, `${opts.base || OLLAMA}/api/show`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ model: opts.model }) }, 5000);
    if (!info || !Array.isArray(info.capabilities)) return null;
    return { tools: info.capabilities.includes("tools"), vision: info.capabilities.includes("vision") };
  } catch (_) { return null; }
}

const PULL_WORDS = [
  [/^pulling manifest/, "Getting ready…"],
  [/^pulling/, "Downloading…"],
  [/^verifying/, "Checking the download…"],
  [/^writing/, "Almost done…"],
  [/^removing/, "Tidying up…"],
  [/^success/, "Done"],
];
const pullWords = (status) => (PULL_WORDS.find(([re]) => re.test(String(status || ""))) || [null, "Downloading…"])[1];

// "Download brain": Ollama downloads the model and streams one JSON line per
// step. onProgress gets {progress: 0..1 or null, words, done, total}.
async function pull(o) {
  const opts = o || {};
  const res = await opts.fetch(`${opts.base || OLLAMA}/api/pull`, { method: "POST", credentials: "omit",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ model: opts.model, stream: true }), signal: opts.signal });
  if (!res.ok || !res.body) throw new Error(res.status === 404 ? "Ollama doesn't know that model." : "Ollama couldn't start the download.");
  const layers = new Map();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ok = false;
  const line = (raw) => {
    const t = raw.trim();
    if (!t) return;
    let ev;
    try { ev = JSON.parse(t); } catch (_) { return; }
    if (ev.error) throw new Error(`Ollama says: ${String(ev.error).slice(0, 200)}`);
    if (ev.digest && Number(ev.total) > 0) layers.set(ev.digest, { total: Number(ev.total), completed: Number(ev.completed) || 0 });
    let total = 0;
    let completed = 0;
    for (const l of layers.values()) { total += l.total; completed += Math.min(l.completed, l.total); }
    if (ev.status === "success") ok = true;
    if (opts.onProgress) {
      opts.onProgress({ progress: ok ? 1 : total ? completed / total : null, words: pullWords(ev.status), done: completed, total });
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop();
    for (const p of parts) line(p);
  }
  line(buffer);
  if (!ok) throw new Error("The download stopped before it finished. Try again.");
  return true;
}

// ---------------------------------------------------------------- Draw Things

// Is Draw Things' API Server on? Any answer from its port means yes.
async function drawThingsStatus(o) {
  const opts = o || {};
  try {
    const res = await opts.fetch(`${opts.base || DRAW_THINGS}/`, { method: "GET", credentials: "omit", signal: AbortSignal.timeout(1500) });
    return { state: "on", status: res.status };
  } catch (_) {
    return { state: opts.installed ? "off" : "missing" };
  }
}

// One picture from Draw Things, with the model and settings chosen in the
// app itself. Returns {mime, data} (base64).
async function drawThingsImage(o) {
  const opts = o || {};
  let res;
  try {
    res = await opts.fetch(`${opts.base || DRAW_THINGS}/sdapi/v1/txt2img`, { method: "POST", credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: String(opts.prompt || "").slice(0, 2000), negative_prompt: "", batch_size: 1, batch_count: 1 }),
      signal: opts.signal || AbortSignal.timeout(10 * 60 * 1000) });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw new Error("Pilot couldn't reach Draw Things. Open it and check its API Server is on (Settings → API Server, HTTP, port 7860).");
  }
  if (!res.ok) throw new Error(`Draw Things couldn't make that picture (error ${res.status}). Check a model is loaded in Draw Things.`);
  const body = await res.json().catch(() => null);
  const img = body && Array.isArray(body.images) ? body.images.find((x) => typeof x === "string" && x.length) : "";
  const data = String(img || "").replace(/^data:image\/[a-z]+;base64,/, "");
  if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new Error("Draw Things didn't send a picture back. Check a model is loaded in it.");
  const clean = data.replace(/\s+/g, "");
  const mime = clean.startsWith("/9j/") ? "image/jpeg" : clean.startsWith("UklGR") ? "image/webp" : "image/png";
  return { mime, data: clean };
}

module.exports = {
  OLLAMA, DRAW_THINGS, LOCAL_ORIGINS, OLLAMA_DOWNLOAD, DRAW_THINGS_STORE, MODELS_FILE, BUILT_IN,
  origins, cleanList, loadRecommended, recommend, memoryGB, sameModel, appPaths, installed,
  ollamaStatus, capabilities, pull, pullWords, drawThingsStatus, drawThingsImage,
};
