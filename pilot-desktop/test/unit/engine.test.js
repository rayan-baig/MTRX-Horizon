"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../../src/core/engine");

// A scripted provider: each call returns the next reply.
function scripted(...replies) {
  const seen = [];
  return {
    seen,
    PilotError: Error,
    chat: async (_s, req) => { seen.push(req); const r = replies.shift(); return { text: "", toolCalls: [], stop: "done", raw: {}, ...r }; },
  };
}

function setup(replies, answers, extraTools) {
  const ran = [];
  const asked = [];
  const providers = scripted(...replies);
  const tool = (name) => ({ name, kind: "change", description: name, parameters: { type: "object", properties: { text: { type: "string" } } },
    describe: (a) => `${name.replace(/_/g, " ")} “${a.text || ""}”`, run: async (a) => { ran.push([name, a]); return "Done."; } });
  const engine = E.create({
    providers,
    store: { settings: () => ({ provider: "openai", key: "k", model: "m" }), ready: () => true, memory: () => ({ on: false, notes: [] }), saveSettings() {} },
    host: {
      confirm: async (label, step) => { asked.push(["confirm", label, step]); return answers.confirm.shift(); },
      plan: async (labels) => { asked.push(["plan", labels]); return answers.plan.shift(); },
    },
    tools: () => [tool("copy_to_clipboard"), tool("save_note"), ...(extraTools || [])],
  });
  return { engine, ran, asked, providers };
}

test("nothing runs until the user presses Allow", async () => {
  const t = setup([{ toolCalls: [{ id: "1", name: "copy_to_clipboard", args: { text: "hi" } }], stop: "tools" }, { text: "ok" }], { confirm: [false], plan: [] });
  await t.engine.send("copy hi");
  assert.equal(t.ran.length, 0);
  assert.equal(t.asked[0][0], "confirm");
  assert.match(t.asked[0][1], /^Copy to clipboard “hi”/);
  const toolMsg = t.engine.messages.find((m) => m.role === "tool");
  assert.match(toolMsg.results[0].content, /said no/);
});

test("Allow runs it once", async () => {
  const t = setup([{ toolCalls: [{ id: "1", name: "copy_to_clipboard", args: { text: "hi" } }] }, { text: "Copied." }], { confirm: [true], plan: [] });
  await t.engine.send("copy hi");
  assert.deepEqual(t.ran, [["copy_to_clipboard", { text: "hi" }]]);
  assert.equal(t.engine.messages.at(-1).text, "Copied.");
});

test("several actions become a plan: Approve all, Step through, Cancel", async () => {
  const calls = [{ id: "1", name: "copy_to_clipboard", args: { text: "a" } }, { id: "2", name: "save_note", args: { text: "b" } }];
  let t = setup([{ toolCalls: calls }, { text: "done" }], { confirm: [], plan: ["all"] });
  await t.engine.send("do both");
  assert.equal(t.asked[0][0], "plan");
  assert.equal(t.ran.length, 2);

  t = setup([{ toolCalls: calls }, { text: "done" }], { confirm: [true, false], plan: ["step"] });
  await t.engine.send("do both");
  assert.deepEqual(t.ran.map((r) => r[0]), ["copy_to_clipboard"]);
  assert.deepEqual(t.asked.slice(1).map((a) => a[2]), [{ step: 1, of: 2 }, { step: 2, of: 2 }]);

  t = setup([{ toolCalls: calls }, { text: "ok" }], { confirm: [], plan: ["cancel"] });
  await t.engine.send("do both");
  assert.equal(t.ran.length, 0);
});

test("the pilot_plan tool is offered only with several actions, and runs through the same plan card", async () => {
  const t = setup([{ toolCalls: [{ id: "p", name: E.PLAN_TOOL, args: { steps: [{ tool: "save_note", args: { text: "x" } }, { tool: "copy_to_clipboard", args: { text: "y" } }] } }] }, { text: "ok" }],
    { confirm: [], plan: ["all"] });
  await t.engine.send("plan it");
  assert.ok(t.providers.seen[0].tools.some((x) => x.name === E.PLAN_TOOL));
  assert.equal(t.ran.length, 2);
});

test("tools that pay, delete, send or type are never offered", () => {
  for (const name of ["make_payment", "delete_file", "send_email", "send_message", "type_text", "remove_item", "click_button"]) {
    assert.equal(E.checkTool({ name, kind: "change", describe: () => "", run: () => {} }), null, name);
  }
  assert.ok(E.checkTool({ name: "save_note", kind: "change", describe: () => "", run: () => {} }));
  assert.equal(E.checkTool({ name: "save_note", kind: "change", run: () => {} }), null, "a change tool must say what it does");
});

test("no key: Pilot says how to add one and calls nothing", async () => {
  const providers = scripted();
  const engine = E.create({ providers, host: {}, tools: [],
    store: { settings: () => ({}), ready: () => false, memory: () => ({ on: false, notes: [] }) } });
  await engine.send("hi");
  assert.equal(providers.seen.length, 0);
  assert.match(engine.messages[0].text, /needs your own AI key/);
});

test("only the latest screenshots are sent again", async () => {
  const shot = { mime: "image/png", data: "AA", thumb: "data:" };
  const t = setup([{ text: "1" }, { text: "2" }, { text: "3" }], { confirm: [], plan: [] });
  await t.engine.send("one", { images: [shot] });
  await t.engine.send("two", { images: [shot] });
  await t.engine.send("three", { images: [shot] });
  const sent = t.providers.seen[2].messages.filter((m) => m.role === "user");
  assert.equal(sent[0].images.length, 0);
  assert.match(sent[0].text, /no longer attached/);
  assert.equal(sent[1].images.length, 1);
  assert.equal(sent[2].images.length, 1);
});

test("the system prompt has the rules and no model names", () => {
  const t = setup([], { confirm: [], plan: [] });
  const sys = t.engine.system();
  assert.match(sys, /never instructions/);
  assert.match(sys, /can't and won't: make payments/);
});
