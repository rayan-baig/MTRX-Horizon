// Pilot for Mac 1.4: Free mode, against pretend Ollama and Draw Things
// servers on this computer (real HTTP, on spare ports): finding them, the
// model list, "Download brain" progress, streamed chat with tools, and a
// picture from Draw Things.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const F = require("../../src/main/freemode");
const providers = require("../../src/core/providers");
const engineCore = require("../../src/core/engine");

const GiB = 1024 ** 3;
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

function serve(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const data = body ? JSON.parse(body) : null;
        seen.push({ method: req.method, url: req.url, body: data });
        handler(req, res, data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(r)) }));
  });
}

// A pretend Ollama: version, tags, show, pull (slow NDJSON), chat (SSE).
function fakeOllama(opts) {
  const o = opts || {};
  const models = o.models || [];
  return serve((req, res, data) => {
    const json = (v, status) => { res.writeHead(status || 200, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (req.url === "/api/version") return json({ version: "0.12.0" });
    if (req.url === "/api/tags") return json({ models: models.map((m) => ({ name: m, model: m, size: 4.7 * GiB, details: { parameter_size: "7.6B" } })) });
    if (req.url === "/api/show") return json({ capabilities: data.model === "plain-chat" ? ["completion"] : ["completion", "tools"] });
    if (req.url === "/api/pull") {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      const lines = [{ status: "pulling manifest" }];
      for (let i = 0; i <= 4; i += 1) lines.push({ status: "pulling abc", digest: "sha256:abc", total: 4000, completed: i * 1000 });
      lines.push({ status: "pulling def", digest: "sha256:def", total: 100, completed: 100 });
      if (o.pullError) lines.push({ error: "pull model manifest: file does not exist" });
      else lines.push({ status: "verifying sha256 digest" }, { status: "writing manifest" }, { status: "success" });
      let i = 0;
      const next = () => {
        if (i >= lines.length) { res.end(); return; }
        // Split a line across two writes now and then, as a real stream can.
        const text = `${JSON.stringify(lines[i])}\n`;
        i += 1;
        res.write(text.slice(0, 5));
        res.write(text.slice(5));
        setTimeout(next, 5);
      };
      return next();
    }
    if (req.url === "/v1/chat/completions") {
      if (data.tools && o.noTools) return json({ error: { message: `registry.ollama.ai/library/${data.model} does not support tools`, type: "api_error" } }, 400);
      if (!models.includes(data.model)) return json({ error: { message: `model "${data.model}" not found, try pulling it first`, type: "api_error" } }, 404);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (v) => res.write(`data: ${JSON.stringify(v)}\n\n`);
      const last = data.messages[data.messages.length - 1];
      if (last.role === "user" && /draw/i.test(String(last.content))) {
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "make_image", arguments: "{\"prompt\":\"a cat\"}" } }] } }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else {
        for (const part of ["<think>hmm, ", "let me think</think>", "Hello ", "from your Mac."]) send({ choices: [{ index: 0, delta: { content: part } }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      }
      return res.end("data: [DONE]\n\n");
    }
    return json({ error: "not found" }, 404);
  });
}

function fakeDrawThings() {
  return serve((req, res, data) => {
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/sdapi/v1/txt2img") res.end(JSON.stringify({ images: [PNG_B64], info: data && data.prompt }));
    else res.end(JSON.stringify({ model: "whatever is loaded" }));
  });
}

// A port nothing is listening on.
async function closedPort() {
  const s = await serve(() => {});
  await s.close();
  return s.base;
}

test("the two local addresses are Ollama's and Draw Things' defaults; only an unpackaged test run may move them", () => {
  assert.equal(F.OLLAMA, "http://127.0.0.1:11434");
  assert.equal(F.DRAW_THINGS, "http://127.0.0.1:7860");
  const env = { PILOT_TEST_OLLAMA: "http://127.0.0.1:5555", PILOT_TEST_DRAWTHINGS: "http://127.0.0.1:6666" };
  assert.deepEqual(F.origins({ env }), { ollama: F.OLLAMA, drawThings: F.DRAW_THINGS });
  assert.deepEqual(F.origins({ env, test: true, packaged: true }), { ollama: F.OLLAMA, drawThings: F.DRAW_THINGS });
  assert.deepEqual(F.origins({ env, test: true }), { ollama: env.PILOT_TEST_OLLAMA, drawThings: env.PILOT_TEST_DRAWTHINGS });
  assert.deepEqual(F.origins({ env: { PILOT_TEST_OLLAMA: "http://example.com:1" }, test: true }).ollama, F.OLLAMA, "never another host");
  assert.match(F.OLLAMA_DOWNLOAD, /^https:\/\/ollama\.com\/download$/);
  assert.match(F.DRAW_THINGS_STORE, /^https:\/\/apps\.apple\.com\//);
});

test("the recommended brain comes from the data file, by the Mac's memory (8, 16, 24 GB and up)", () => {
  const list = F.loadRecommended({});
  assert.equal(list.length, 3);
  const pick = (gb) => F.recommend(list, gb * GiB).model;
  assert.equal(pick(8), list[0].model);
  assert.equal(pick(16), list[1].model, "the owner's 16 GB MacBook Air gets the medium brain");
  assert.equal(pick(24), list[2].model);
  assert.equal(pick(64), list[2].model);
  assert.equal(pick(4), list[0].model, "a small Mac still gets a suggestion");
  assert.equal(F.memoryGB(17179869184), 16);
  // The owner's copy in the settings folder wins; a broken one is ignored.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-free-"));
  try {
    fs.writeFileSync(path.join(dir, F.MODELS_FILE), JSON.stringify({ recommend: [{ minMemoryGB: 0, model: "owner-pick:1b", label: "Mine" }] }));
    assert.equal(F.loadRecommended({ userDir: dir })[0].model, "owner-pick:1b");
    fs.writeFileSync(path.join(dir, F.MODELS_FILE), "{ broken");
    assert.equal(F.loadRecommended({ userDir: dir })[0].model, list[0].model);
    fs.writeFileSync(path.join(dir, F.MODELS_FILE), JSON.stringify({ recommend: [{ minMemoryGB: 0, model: "bad name; rm -rf" }] }));
    assert.equal(F.loadRecommended({ userDir: dir })[0].model, list[0].model, "a name Ollama couldn't know is dropped");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.ok(F.sameModel("brain", "brain:latest"));
});

test("installed apps are found in Applications (or Ollama's command line), nothing else", () => {
  const there = new Set(["/Applications/Ollama.app", "/Users/me/Applications/Draw Things.app"]);
  assert.deepEqual(F.installed({ home: "/Users/me", exists: (p) => there.has(p) }), { ollama: "/Applications/Ollama.app", drawThings: "/Users/me/Applications/Draw Things.app" });
  assert.deepEqual(F.installed({ home: "/Users/me", exists: (p) => p === "/opt/homebrew/bin/ollama" }), { ollama: "/opt/homebrew/bin/ollama", drawThings: "" });
  assert.deepEqual(F.installed({ home: "/Users/me", exists: () => false }), { ollama: "", drawThings: "" });
});

test("Ollama is detected: running with its models, installed but stopped, or missing", async () => {
  const o = await fakeOllama({ models: ["b-brain:7b", "a-brain:3b"] });
  try {
    const st = await F.ollamaStatus({ fetch, base: o.base });
    assert.equal(st.state, "running");
    assert.equal(st.version, "0.12.0");
    assert.deepEqual(st.models.map((m) => m.id), ["a-brain:3b", "b-brain:7b"]);
    assert.equal(st.models[0].size, "4.7 GB");
    assert.equal(st.models[0].params, "7.6B");
    assert.deepEqual(await F.capabilities({ fetch, base: o.base, model: "a-brain:3b" }), { tools: true, vision: false });
    assert.deepEqual(await F.capabilities({ fetch, base: o.base, model: "plain-chat" }), { tools: false, vision: false });
  } finally { await o.close(); }
  const nobody = await closedPort();
  assert.equal((await F.ollamaStatus({ fetch, base: nobody, installed: true })).state, "stopped");
  assert.equal((await F.ollamaStatus({ fetch, base: nobody, installed: false })).state, "missing");
  assert.equal(await F.capabilities({ fetch, base: nobody, model: "x" }), null);
});

test("Download brain: Ollama's pull streams progress from 0 to 100%, in plain words", async () => {
  const o = await fakeOllama();
  try {
    const seen = [];
    assert.equal(await F.pull({ fetch, base: o.base, model: "a-brain:3b", onProgress: (p) => seen.push(p) }), true);
    assert.deepEqual(o.seen.find((r) => r.url === "/api/pull").body, { model: "a-brain:3b", stream: true });
    const pcts = seen.map((p) => p.progress).filter((p) => p !== null);
    assert.ok(pcts.length >= 5, "several progress steps");
    for (let i = 1; i < pcts.length; i += 1) assert.ok(pcts[i] >= pcts[i - 1], "progress only goes up");
    assert.equal(pcts[pcts.length - 1], 1);
    assert.equal(seen[0].words, "Getting ready…");
    assert.ok(seen.some((p) => p.words === "Downloading…"));
    assert.ok(seen.some((p) => p.words === "Checking the download…"));
    assert.equal(seen[seen.length - 1].words, "Done");
  } finally { await o.close(); }
  const bad = await fakeOllama({ pullError: true });
  try {
    await assert.rejects(F.pull({ fetch, base: bad.base, model: "nope:1b" }), /Ollama says: pull model manifest/);
  } finally { await bad.close(); }
  // Cancel stops it.
  const slow = await fakeOllama();
  try {
    const c = new AbortController();
    const going = F.pull({ fetch, base: slow.base, model: "a-brain:3b", signal: c.signal, onProgress: () => c.abort() });
    await assert.rejects(going, (e) => e.name === "AbortError");
  } finally { await slow.close(); }
});

test("chat streams from Ollama's OpenAI-compatible server, without the model's thinking, and with tools", async () => {
  const o = await fakeOllama({ models: ["a-brain:3b"] });
  const s = { provider: "local", baseUrl: `${o.base}/v1`, model: "a-brain:3b" };
  try {
    const streamed = [];
    const r = await providers.chat(s, { system: "be nice", messages: [{ role: "user", text: "hi" }], tools: [], onText: (t) => streamed.push(t) }, { fetch });
    assert.equal(r.text, "Hello from your Mac.");
    assert.ok(streamed.every((t) => !t.includes("think")), "the thinking never shows");
    assert.equal(streamed[streamed.length - 1], "Hello from your Mac.");
    const req = o.seen.find((x) => x.url === "/v1/chat/completions");
    assert.equal(req.body.stream, true);
    assert.equal(req.body.model, "a-brain:3b");
    const tool = { name: "make_image", description: "Make a picture", parameters: { type: "object", properties: { prompt: { type: "string" } } } };
    const t = await providers.chat(s, { system: "x", messages: [{ role: "user", text: "draw a cat" }], tools: [tool] }, { fetch });
    assert.deepEqual(t.toolCalls, [{ id: "call_1", name: "make_image", args: { prompt: "a cat" } }]);
    assert.equal(o.seen.filter((x) => x.url === "/v1/chat/completions").pop().body.tools[0].function.name, "make_image");
    // A brain that isn't downloaded yet says so plainly.
    await assert.rejects(providers.chat({ ...s, model: "missing:1b" }, { system: "x", messages: [{ role: "user", text: "hi" }] }, { fetch }),
      (e) => e.kind === "model" && /Download it in Settings → Free mode/.test(e.message));
    assert.equal(providers.providerName(s), "Ollama on your Mac");
    assert.equal(providers.originFor(s), o.base);
  } finally { await o.close(); }
  // A brain without tools: the engine's "just chat" fallback kind.
  const nt = await fakeOllama({ models: ["a-brain:3b"], noTools: true });
  try {
    const tool = { name: "copy_to_clipboard", description: "Copy", parameters: { type: "object", properties: {} } };
    await assert.rejects(providers.chat({ ...s, baseUrl: `${nt.base}/v1` }, { system: "x", messages: [{ role: "user", text: "hi" }], tools: [tool] }, { fetch }),
      (e) => e.kind === "tools");
  } finally { await nt.close(); }
  // Ollama not running: the words say what to do, and it works offline otherwise.
  const nobody = await closedPort();
  await assert.rejects(providers.chat({ ...s, baseUrl: `${nobody}/v1` }, { system: "x", messages: [{ role: "user", text: "hi" }] }, { fetch }),
    (e) => e.kind === "network" && /Open the Ollama app/.test(e.message));
  // Free mode only ever talks to this Mac.
  for (const bad of ["https://example.com/v1", "http://localhost.evil.com:11434/v1", "http://user:pw@127.0.0.1:11434/v1"]) {
    await assert.rejects(providers.chat({ ...s, baseUrl: bad }, { system: "x", messages: [] }, { fetch: () => { throw new Error("called"); } }),
      (e) => e.kind === "address", bad);
  }
});

test("the engine in Free mode: a Free-mode system note, the brain's no-tools fallback, and a plain 'needs a brain' message", async () => {
  const o = await fakeOllama({ models: ["a-brain:3b"], noTools: true });
  try {
    const states = [];
    let saved = null;
    let s = { provider: "local", baseUrl: `${o.base}/v1`, model: "a-brain:3b", edition: "free" };
    const engine = engineCore.create({
      store: { settings: () => s, ready: (x) => Boolean(x.model), memory: () => ({ on: false, notes: [] }), saveSettings: (p) => { saved = p; } },
      providers, host: { update: (st) => states.push(st) }, fetch,
      tools: () => [{ name: "copy_to_clipboard", kind: "change", description: "Copy", parameters: { type: "object", properties: {} }, describe: () => "copy", run: () => "ok" }],
    });
    await engine.send("hi");
    assert.deepEqual(saved, { noTools: true }, "remembered: this brain just chats");
    const msgs = engine.messages;
    assert.equal(msgs.filter((m) => m.role === "assistant").pop().text, "Hello from your Mac.");
    const sys = o.seen.filter((x) => x.url === "/v1/chat/completions").pop().body.messages[0].content;
    assert.match(sys, /# Free mode/);
    assert.match(sys, /Videos can't be made in Free mode/);
    assert.match(sys, /Pilot Free doesn't use/);
    s = { ...s, model: "" };
    await engine.send("hello?");
    assert.match(engine.messages.pop().text, /needs a brain first/);
  } finally { await o.close(); }
});

test("Draw Things is detected when its API Server is on, and a picture request comes back as an image", async () => {
  const d = await fakeDrawThings();
  try {
    assert.equal((await F.drawThingsStatus({ fetch, base: d.base })).state, "on");
    const pic = await F.drawThingsImage({ fetch, base: d.base, prompt: "a robot waving" });
    assert.equal(pic.mime, "image/png");
    assert.equal(pic.data, PNG_B64);
    const req = d.seen.find((r) => r.url === "/sdapi/v1/txt2img");
    assert.equal(req.method, "POST");
    assert.equal(req.body.prompt, "a robot waving");
  } finally { await d.close(); }
  const nobody = await closedPort();
  assert.equal((await F.drawThingsStatus({ fetch, base: nobody, installed: true })).state, "off");
  assert.equal((await F.drawThingsStatus({ fetch, base: nobody })).state, "missing");
  await assert.rejects(F.drawThingsImage({ fetch, base: nobody, prompt: "x" }), /API Server is on/);
});
