"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../../src/core/desktop-tools");
const E = require("../../src/core/engine");

function deps() {
  const log = [];
  return {
    log,
    clipboard: { writeText: (t) => log.push(["clip", t]) },
    openExternal: async (u) => log.push(["open", u]),
    notes: { add: (n) => log.push(["note", n]) },
    memory: { on: () => false, add: (t) => log.push(["mem", t]) },
    screen: { capture: async () => ({ mime: "image/jpeg", data: "AA", thumb: "data:" }) },
    media: { has: () => false },
    providerName: () => "OpenAI",
  };
}

test("every desktop tool asks first and is allowed by the engine", () => {
  const list = T.make(deps());
  for (const t of list) {
    assert.equal(t.kind, "change", t.name);
    assert.ok(E.checkTool(t), t.name);
  }
});

test("open_website: https only, opened in the browser", async () => {
  const d = deps();
  const open = T.make(d).find((t) => t.name === "open_website");
  for (const bad of ["http://example.com", "javascript:alert(1)", "file:///etc/passwd", "https://user:pw@example.com", "x"]) {
    const r = await open.run({ url: bad });
    assert.equal(r.error, true, bad);
  }
  assert.equal(d.log.length, 0);
  await open.run({ url: "https://example.com/a" });
  assert.deepEqual(d.log, [["open", "https://example.com/a"]]);
  assert.match(open.describe({ url: "https://example.com/a" }), /^open https:\/\/example.com\/a in your web browser/);
});

test("look_at_screen names the provider and returns the picture", async () => {
  const look = T.make(deps()).find((t) => t.name === "look_at_screen");
  assert.match(look.describe({}), /screenshot of your screen and send it to OpenAI/);
  const r = await look.run({});
  assert.equal(r.image.mime, "image/jpeg");
});

test("copy, note, and memory only when on", async () => {
  const d = deps();
  const list = T.make(d);
  await list.find((t) => t.name === "copy_to_clipboard").run({ text: "draft" });
  await list.find((t) => t.name === "save_note").run({ text: "note text" });
  assert.deepEqual(d.log.map((l) => l[0]), ["clip", "note"]);
  assert.equal(list.find((t) => t.name === "remember_fact").available(), false);
  assert.equal(list.find((t) => t.name === "make_image").available(), false);
});

test("the full flow: a tool the model asks for runs only after Allow", async () => {
  const d = deps();
  let confirmLabel = "";
  const engine = E.create({
    providers: { chat: (() => { const r = [{ text: "", toolCalls: [{ id: "1", name: "open_website", args: { url: "https://example.com" } }], stop: "tools", raw: {} }, { text: "Opened.", toolCalls: [], stop: "done", raw: {} }]; return async () => r.shift(); })() },
    store: { settings: () => ({ provider: "openai", key: "k", model: "m" }), ready: () => true, memory: () => ({ on: false, notes: [] }) },
    host: { confirm: async (label) => { confirmLabel = label; assert.equal(d.log.length, 0, "nothing opened before Allow"); return true; }, plan: async () => "cancel" },
    tools: () => T.make(d),
  });
  await engine.send("open example");
  assert.match(confirmLabel, /^Open https:\/\/example.com/);
  assert.deepEqual(d.log, [["open", "https://example.com/"]]);
});
