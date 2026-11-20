"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../src/core/providers");
const { sseBody, streamResponse, jsonResponse, fakeFetch } = require("./helpers");

const MODEL = "test-model"; // any name: Pilot never hard-codes one
const pic = { mime: "image/png", data: "iVBORw0KGgo=" };

test("Anthropic: streams text, sends the key only in x-api-key, no browser header", async () => {
  const fetch = fakeFetch(streamResponse(sseBody([
    { type: "message_start", message: { id: "m1", content: [] } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo!" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ])));
  const seen = [];
  const out = await P.chat({ provider: "anthropic", key: "sk-test-1234", model: MODEL },
    { system: "sys", messages: [{ role: "user", text: "hi" }], onText: (t) => seen.push(t) }, { fetch });
  assert.equal(out.text, "Hello!");
  assert.equal(out.stop, "done");
  assert.deepEqual(seen, ["Hel", "Hello!"]);
  const call = fetch.calls[0];
  assert.equal(call.url, "https://api.anthropic.com/v1/messages");
  assert.equal(call.init.headers["x-api-key"], "sk-test-1234");
  assert.ok(call.init.headers["anthropic-version"]);
  assert.equal(call.init.headers["anthropic-dangerous-direct-browser-access"], undefined);
  assert.equal(call.body.model, MODEL);
  assert.equal(call.body.stream, true);
  assert.equal(call.body.temperature, undefined);
  assert.ok(!JSON.stringify(call.body).includes("sk-test-1234"), "the key is never in the body");
});

test("Anthropic: tool calls come back whole, and screenshots go as image blocks", async () => {
  const fetch = fakeFetch(streamResponse(sseBody([
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "copy_to_clipboard", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"text\":" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "\"hi\"}" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
  ])));
  const out = await P.chat({ provider: "anthropic", key: "k", model: MODEL }, {
    system: "s", tools: [{ name: "copy_to_clipboard", description: "d", parameters: { type: "object", properties: {} } }],
    messages: [
      { role: "user", text: "look", images: [pic] },
      { role: "assistant", text: "", toolCalls: [{ id: "t0", name: "look_at_screen", args: {} }] },
      { role: "tool", results: [{ id: "t0", name: "look_at_screen", content: "here", image: pic }] },
    ],
  }, { fetch });
  assert.deepEqual(out.toolCalls, [{ id: "tu1", name: "copy_to_clipboard", args: { text: "hi" } }]);
  assert.equal(out.stop, "tools");
  const wire = fetch.calls[0].body.messages;
  assert.equal(wire[0].content[0].type, "image");
  assert.equal(wire[0].content[0].source.media_type, "image/png");
  assert.equal(wire[0].content[1].text, "look");
  assert.equal(wire[2].content[0].type, "tool_result");
  assert.equal(wire[2].content[0].content[1].type, "image");
  assert.equal(fetch.calls[0].body.tools[0].input_schema.type, "object");
});

test("Anthropic: model list follows pages", async () => {
  const fetch = fakeFetch(
    jsonResponse({ data: [{ id: "a", display_name: "A" }], has_more: true, last_id: "a" }),
    jsonResponse({ data: [{ id: "b", display_name: "B", max_tokens: 1000 }], has_more: false }),
  );
  const list = await P.listModels({ provider: "anthropic", key: "k" }, { fetch });
  assert.deepEqual(list.map((m) => m.id), ["a", "b"]);
  assert.match(fetch.calls[1].url, /after_id=a/);
});

test("OpenAI: streams text and tool calls, sends pictures as image_url", async () => {
  const fetch = fakeFetch(streamResponse(sseBody([
    JSON.stringify({ choices: [{ delta: { content: "Sure" } }] }),
    JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "open_website", arguments: "{\"url\":\"https://exa" } }] } }] }),
    JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "mple.com\"}" } }] }, finish_reason: "tool_calls" }] }),
    "[DONE]",
  ])));
  const out = await P.chat({ provider: "openai", key: "sk-o", model: MODEL },
    { system: "s", messages: [{ role: "user", text: "go", images: [pic] }] }, { fetch });
  assert.equal(out.text, "Sure");
  assert.deepEqual(out.toolCalls, [{ id: "c1", name: "open_website", args: { url: "https://example.com" } }]);
  const call = fetch.calls[0];
  assert.equal(call.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(call.init.headers.authorization, "Bearer sk-o");
  assert.equal(call.body.messages[1].content[1].type, "image_url");
  assert.match(call.body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
});

test("OpenAI: a screenshot from a tool follows the tool results as the user's picture", () => {
  const wire = P.adapters.openai.toWire("s", [
    { role: "user", text: "look" },
    { role: "assistant", text: "", toolCalls: [{ id: "t", name: "look_at_screen", args: {} }] },
    { role: "tool", results: [{ id: "t", name: "look_at_screen", content: "here", image: pic }] },
  ]);
  assert.equal(wire[3].role, "tool");
  assert.equal(wire[4].role, "user");
  assert.equal(wire[4].content[1].type, "image_url");
});

test("OpenAI: model list leaves out models that don't chat", async () => {
  const fetch = fakeFetch(jsonResponse({ data: [{ id: "chat-one" }, { id: "text-embedding-x" }, { id: "tts-x" }] }));
  const list = await P.listModels({ provider: "openai", key: "k" }, { fetch });
  assert.deepEqual(list.map((m) => m.id), ["chat-one"]);
});

test("Compatible: uses the user's address, and refuses unsafe ones", async () => {
  const fetch = fakeFetch(streamResponse(sseBody([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }), "[DONE]"])));
  const out = await P.chat({ provider: "compatible", baseUrl: "https://llm.example.com/v1/", key: "", model: MODEL },
    { system: "s", messages: [{ role: "user", text: "hi" }] }, { fetch });
  assert.equal(out.text, "ok");
  assert.equal(fetch.calls[0].url, "https://llm.example.com/v1/chat/completions");
  assert.equal(fetch.calls[0].init.headers.authorization, undefined);
  assert.equal(P.checkBaseUrl("http://localhost:11434/v1"), null);
  assert.equal(P.checkBaseUrl("http://evil.example.com/v1").kind, "address");
  assert.equal(P.checkBaseUrl("https://u:p@x.example.com/v1").kind, "address");
  assert.equal(P.checkBaseUrl("javascript:alert(1)").kind, "address");
  await assert.rejects(P.chat({ provider: "compatible", baseUrl: "ftp://x", model: MODEL }, { system: "", messages: [] }, { fetch }), /https/);
});

test("Gemini: streams text and function calls, key in x-goog-api-key, pictures inline", async () => {
  const fetch = fakeFetch(streamResponse(sseBody([
    JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hi " }] } }] }),
    JSON.stringify({ candidates: [{ content: { parts: [{ text: "there" }, { functionCall: { name: "save_note", args: { text: "x" } } }] }, finishReason: "STOP" }] }),
  ])));
  const out = await P.chat({ provider: "gemini", key: "g-key", model: MODEL },
    { system: "s", messages: [{ role: "user", text: "hi", images: [pic] }] }, { fetch });
  assert.equal(out.text, "Hi there");
  assert.equal(out.toolCalls[0].name, "save_note");
  const call = fetch.calls[0];
  assert.equal(call.url, `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`);
  assert.equal(call.init.headers["x-goog-api-key"], "g-key");
  assert.ok(!call.url.includes("g-key"), "the key is never in the address");
  assert.equal(call.body.contents[0].parts[0].inlineData.mimeType, "image/png");
});

test("Errors become plain words", async () => {
  const cases = [
    [401, { error: { message: "invalid x-api-key" } }, "key"],
    [429, { error: { message: "slow down" } }, "rate"],
    [400, { error: { message: "Your credit balance is too low" } }, "quota"],
    [404, { error: { message: "not found" } }, "model"],
    [500, {}, "server"],
  ];
  for (const [status, body, kind] of cases) {
    const fetch = fakeFetch(jsonResponse(body, status));
    await assert.rejects(P.chat({ provider: "anthropic", key: "k", model: MODEL }, { system: "", messages: [] }, { fetch }), (e) => e.kind === kind);
  }
  const offline = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(P.chat({ provider: "openai", key: "k", model: MODEL }, { system: "", messages: [] }, { fetch: offline }), (e) => e.kind === "network");
});

test("Tool trouble is recognised so Pilot can just chat", async () => {
  const fetch = fakeFetch(jsonResponse({ error: { message: "tools are not supported by this model" } }, 400));
  await assert.rejects(P.chat({ provider: "openai", key: "k", model: MODEL },
    { system: "", messages: [], tools: [{ name: "x", description: "d", parameters: {} }] }, { fetch }), (e) => e.kind === "tools");
});

test("Each provider's own address only", () => {
  assert.equal(P.originFor({ provider: "openai" }), "https://api.openai.com");
  assert.equal(P.originFor({ provider: "compatible", baseUrl: "https://llm.example.com/v1" }), "https://llm.example.com");
  assert.equal(P.originFor({ provider: "compatible", baseUrl: "http://bad.example.com" }), null);
});
