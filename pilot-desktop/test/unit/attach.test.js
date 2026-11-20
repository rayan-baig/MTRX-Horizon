// Dropped pictures and videos, and screen access: pictures shrink to the
// provider's limits, video frames are evenly spaced, big files are read a
// piece at a time, Gemini's upload is sent in order, and the screen access
// mode and permission flow behave.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../../src/renderer/attach");
const uploads = require("../../src/main/uploads");
const access = require("../../src/main/screen-access");
const providers = require("../../src/core/providers");

test("every provider has limits, with no model names", () => {
  for (const p of ["anthropic", "openai", "gemini", "compatible"]) {
    const l = A.limitsFor(p);
    assert.ok(l.bytes > 1e6 && l.edge >= 1024 && l.count >= 4, p);
  }
  assert.equal(A.limitsFor("something-else"), A.LIMITS.compatible);
  assert.equal(A.LIMITS.gemini.upload, true);
  assert.equal(A.LIMITS.anthropic.upload, false);
});

test("files are told apart by type or name, HEIC included", () => {
  assert.equal(A.kindOf({ type: "image/png", name: "a.png" }), "image");
  assert.equal(A.kindOf({ type: "", name: "IMG_0001.HEIC" }), "image");
  assert.equal(A.kindOf({ type: "image/heic", name: "x" }), "image");
  assert.equal(A.kindOf({ type: "video/quicktime", name: "clip.mov" }), "video");
  assert.equal(A.kindOf({ type: "", name: "talk.webm" }), "video");
  assert.equal(A.kindOf({ type: "application/pdf", name: "a.pdf" }), null);
  assert.equal(A.isHeic({ type: "", name: "a.heif" }), true);
});

// A pretend JPEG encoder: bytes grow with the pixels and the quality.
const fakeEncode = (perPixel) => async (w, h, q) => ({ size: Math.round(w * h * perPixel * q) });

test("a huge picture is shrunk until it fits each provider's limits", async () => {
  for (const p of ["anthropic", "openai", "gemini", "compatible"]) {
    const l = A.limitsFor(p);
    const out = await A.shrinkToFit({ width: 12000, height: 9000 }, l, fakeEncode(1.2));
    assert.ok(out.blob.size <= l.bytes, `${p}: ${out.blob.size}`);
    assert.ok(Math.max(out.width, out.height) <= l.edge, `${p}: ${out.width}`);
    assert.ok(Math.abs(out.width / out.height - 12000 / 9000) < 0.01, "keeps its shape");
  }
  // A small one is left as it is, at good quality.
  const small = await A.shrinkToFit({ width: 800, height: 600 }, A.limitsFor("anthropic"), fakeEncode(0.5));
  assert.deepEqual([small.width, small.height, small.quality], [800, 600, 0.86]);
  // Even a picture that compresses badly ends up under the limit.
  const noisy = await A.shrinkToFit({ width: 4000, height: 4000 }, A.limitsFor("compatible"), fakeEncode(6));
  assert.ok(noisy.blob.size <= A.limitsFor("compatible").bytes, noisy.blob.size);
});

test("video frames are evenly spaced, and as many as the provider takes", () => {
  const times = A.frameTimes(180, 24);
  assert.equal(times.length, 24);
  const gaps = times.slice(1).map((t, i) => Math.round((t - times[i]) * 1000));
  assert.ok(gaps.every((g) => g === gaps[0]), gaps.join());
  assert.equal(times[0], 3.75);
  assert.equal(times[23], 176.25);
  assert.equal(A.frameCount(180, A.limitsFor("anthropic")), 20);
  assert.equal(A.frameCount(180, A.limitsFor("gemini")), 16);
  assert.equal(A.frameCount(180, { count: 100 }), 24);
  assert.equal(A.frameCount(6, A.limitsFor("anthropic")), 4);
  assert.equal(A.framesNote(24, 182), "I looked at 24 frames from your 3-minute video.");
  assert.equal(A.framesNote(4, 12), "I looked at 4 frames from your 12-second video.");
  assert.deepEqual(A.frameTimes(NaN, 5), [0]);
});

test("a very large file is read and sent a piece at a time, never whole", async () => {
  const GB = 1024 ** 3;
  const reads = [];
  let biggest = 0;
  const file = { size: 6 * GB + 123, slice(a, b) { reads.push([a, b]); return { arrayBuffer: async () => new ArrayBuffer(Math.min(b - a, 16)) }; } };
  const sent = [];
  const progress = [];
  await A.upload(file, async (offset, bytes, last) => { biggest = Math.max(biggest, bytes.length); sent.push({ offset, last }); },
    { onProgress: (n, total) => progress.push(n / total) });
  // 8 MB pieces, in order, each read only when it's sent.
  assert.equal(reads.length, Math.ceil(file.size / A.CHUNK));
  assert.ok(reads.every(([a, b], i) => a === i * A.CHUNK && b - a <= A.CHUNK));
  assert.equal(reads[reads.length - 1][1], file.size);
  assert.ok(biggest <= A.CHUNK);
  assert.deepEqual(sent.filter((s) => s.last).length, 1);
  assert.equal(sent[sent.length - 1].last, true);
  assert.equal(progress[progress.length - 1], 1);
  assert.ok(progress.every((p, i) => i === 0 || p > progress[i - 1]));
});

test("Gemini's resumable upload: start, pieces in order, then wait until it's ready", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init && init.headers, size: init && init.body && init.body.length });
    if (url.endsWith("/upload/v1beta/files")) return new Response("{}", { headers: { "x-goog-upload-url": `${uploads.BASE}/upload/x?id=1` } });
    if (url.includes("/upload/x")) {
      const last = init.headers["X-Goog-Upload-Command"].includes("finalize");
      return new Response(last ? JSON.stringify({ file: { name: "files/abc", uri: `${uploads.BASE}/v1beta/files/abc`, state: "PROCESSING", mimeType: "video/mp4" } }) : "");
    }
    return new Response(JSON.stringify({ name: "files/abc", uri: `${uploads.BASE}/v1beta/files/abc`, state: "ACTIVE", mimeType: "video/mp4" }));
  };
  const url = await uploads.start(fetch, "test-key", { name: "clip.mp4", size: 20, mime: "video/mp4" });
  assert.equal(calls[0].headers["X-Goog-Upload-Protocol"], "resumable");
  assert.equal(calls[0].headers["X-Goog-Upload-Header-Content-Length"], "20");
  assert.equal(await uploads.piece(fetch, "test-key", url, 0, new Uint8Array(10), false), null);
  const file = await uploads.piece(fetch, "test-key", url, 10, new Uint8Array(10), true);
  assert.equal(calls[2].headers["X-Goog-Upload-Offset"], "10");
  assert.equal(calls[2].headers["X-Goog-Upload-Command"], "upload, finalize");
  const done = await uploads.ready(fetch, "test-key", file, { wait: async () => {} });
  assert.equal(done.state, "ACTIVE");
  await assert.rejects(uploads.piece(fetch, "k", "https://example.com/elsewhere", 0, new Uint8Array(1), true));
  // The message then names the file by its address (Gemini only).
  const wire = providers.adapters.gemini.toWire([{ role: "user", text: "What happens?", videos: [{ mime: "video/mp4", uri: done.uri }] }]);
  assert.deepEqual(wire[0].parts[0], { fileData: { mimeType: "video/mp4", fileUri: done.uri } });
  const other = providers.adapters.gemini.toWire([{ role: "user", text: "x", videos: [{ mime: "video/mp4", uri: "https://example.com/v" }] }]);
  assert.equal(other[0].parts.length, 1);
});

test("screen access: the mode decides when a screenshot is taken", () => {
  assert.equal(access.wantsShot("off", true), false);
  assert.equal(access.wantsShot("ask", false), false);
  assert.equal(access.wantsShot("ask", true), true);
  assert.equal(access.wantsShot("help", false), true);
  assert.equal(access.wantsShot("nonsense", false), false); // unknown means "only when I ask"
  assert.equal(access.cleanMode(undefined), "ask");
  assert.equal(access.view("granted", "off", false).eye, false);
  assert.equal(access.view("granted", "ask", false).eye, true);
});

test("screen access: the permission status flow, and Relaunch offered when macOS needs it", () => {
  let v = access.view("not-determined", "ask", false);
  assert.deepEqual([v.allowed, v.words, v.offerRelaunch], [false, "Not allowed", false]);
  v = access.view("denied", "ask", true); // opened System Settings, not counted yet
  assert.deepEqual([v.allowed, v.offerRelaunch], [false, true]);
  v = access.view("granted", "ask", true);
  assert.deepEqual([v.allowed, v.words, v.offerRelaunch], [true, "Allowed", false]);

  // After opening System Settings, Pilot notices the change without a restart.
  const timers = [];
  const T = { setTimeout: (fn) => { const t = { fn }; timers.push(t); return t; }, clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } };
  const answers = ["denied", "denied", "granted"];
  let now = "denied";
  const changes = [];
  access.watch({ status: () => now, onChange: (s) => changes.push(s), timers: T });
  for (const a of answers) { now = a; const t = timers.shift(); t.fn(); }
  assert.deepEqual(changes, ["granted"]);
  assert.equal(timers.length, 0); // stops once allowed
});
