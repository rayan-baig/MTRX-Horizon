"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../src/core/media");
const { jsonResponse, fakeFetch } = require("./helpers");

test("OpenAI pictures come back as base64", async () => {
  const fetch = fakeFetch(jsonResponse({ data: [{ b64_json: "AAAA" }] }));
  const out = await M.image({ provider: "openai", key: "k", model: "img" }, "a red kite", { fetch });
  assert.deepEqual(out, { mime: "image/png", data: "AAAA" });
  assert.equal(fetch.calls[0].url, "https://api.openai.com/v1/images/generations");
  assert.equal(fetch.calls[0].body.prompt, "a red kite");
});

test("Gemini pictures, and Anthropic is refused for media", async () => {
  const fetch = fakeFetch(jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "BBBB" } }] } }] }));
  const out = await M.image({ provider: "gemini", key: "k", model: "img" }, "a boat", { fetch });
  assert.equal(out.data, "BBBB");
  await assert.rejects(M.image({ provider: "anthropic", key: "k", model: "x" }, "a boat", { fetch }), /doesn't make/);
});

test("Videos: start, check progress, fetch the result", async () => {
  const fetch = fakeFetch(
    jsonResponse({ id: "vid_1" }),
    jsonResponse({ status: "in_progress", progress: 42 }),
    jsonResponse({ status: "completed" }),
    new Response(new Uint8Array([1, 2, 3])),
  );
  const p = { provider: "openai", key: "k", model: "vid" };
  const job = await M.startVideo(p, "waves", { fetch });
  assert.equal(job.id, "vid_1");
  assert.deepEqual(await M.checkVideo(p, job.id, { fetch }), { state: "working", progress: 42 });
  const done = await M.checkVideo(p, job.id, { fetch });
  assert.equal(done.state, "done");
  const vid = await M.fetchVideo(p, job.id, done, { fetch });
  assert.deepEqual([...vid.bytes], [1, 2, 3]);
  assert.equal(fetch.calls[3].url, "https://api.openai.com/v1/videos/vid_1/content");
  await assert.rejects(M.checkVideo(p, "../../etc", { fetch }), /isn't valid/);
});
