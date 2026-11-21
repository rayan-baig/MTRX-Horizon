// Pilot for Mac 1.3: pasting pictures and files, links both ways, copying
// out, and "Read this link". Clipboard, shell and the network are pretend.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const clip = require("../../src/main/clip");
const LR = require("../../src/main/linkread");
const L = require("../../src/renderer/links");
const Render = require("../../src/core/pilot-render");

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

function noWrites() {
  const real = fs;
  const writes = [];
  const guard = (name) => (...a) => { writes.push([name, a[0]]); throw new Error(`no ${name} allowed`); };
  return { writes, fs: { ...real, writeFileSync: guard("writeFileSync"), writeFile: guard("writeFile"), createWriteStream: guard("createWriteStream"),
    mkdtempSync: guard("mkdtempSync"), statSync: real.statSync, readFileSync: real.readFileSync } };
}

test("a pasted picture (a screenshot on the clipboard) becomes an attachment, with no file written", () => {
  const { fs: safeFs, writes } = noWrites();
  const clipboard = {
    availableFormats: () => ["image/png"],
    read: () => "",
    readImage: () => ({ isEmpty: () => false, toPNG: () => PNG }),
  };
  const got = clip.readClipboard({ clipboard, fs: safeFs });
  assert.equal(got.length, 1);
  assert.equal(got[0].mime, "image/png");
  assert.equal(Buffer.from(got[0].data, "base64").equals(PNG), true);
  assert.deepEqual(writes, []);
  // Nothing on the clipboard: nothing to attach.
  assert.deepEqual(clip.readClipboard({ clipboard: { availableFormats: () => ["text/plain"], read: () => "", readImage: () => ({ isEmpty: () => true }) }, fs: safeFs }), []);
});

test("a picture or video copied in Finder attaches; other files don't", () => {
  const { fs: safeFs, writes } = noWrites();
  const pic = path.join(__dirname, "..", "..", "assets", "robot-128.png");
  const clipboard = {
    availableFormats: () => ["public.file-url", "text/plain"],
    read: (f) => (f === "public.file-url" ? `file://${encodeURI(pic)}` : ""),
    readImage: () => ({ isEmpty: () => true }),
  };
  const got = clip.readClipboard({ clipboard, fs: safeFs });
  assert.equal(got.length, 1);
  assert.equal(got[0].name, "robot-128.png");
  assert.equal(got[0].mime, "image/png");
  assert.deepEqual(writes, []);
  const notMedia = { ...clipboard, read: (f) => (f === "public.file-url" ? `file://${path.join(__dirname, "paste-links.test.js")}` : "") };
  assert.deepEqual(clip.readClipboard({ clipboard: notMedia, fs: safeFs }), []);
});

test("the chat pastes pictures straight from the clipboard, and text and links as text", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "..", "src", "renderer", "chat.js"), "utf8");
  assert.match(chat, /P\.chat\.paste\(\)/);
  assert.match(chat, /new File\(\[bytes\]/, "a File made in memory");
  assert.match(chat, /takeFiles\(got\.map/, "through the same shrink-to-fit path as a dropped file");
  assert.doesNotMatch(chat, /writeFile|showSaveDialog/);
});

// ---------------------------------------------------------------- links

test("links render only for https, http and mailto, as text nodes and <a> elements", () => {
  const dom = new JSDOM("<!doctype html><div id=m></div>");
  const d = dom.window.document;
  const node = d.getElementById("m");
  node.appendChild(Render.render("See https://example.com/a?b=1, mailto:me@example.com and javascript:alert(1) or [x](javascript:alert(2)). `https://in.code`", d));
  L.linkify(node, d);
  const hrefs = [...node.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  assert.deepEqual(hrefs, ["https://example.com/a?b=1", "mailto:me@example.com"]);
  assert.ok(!node.innerHTML.includes("javascript:alert(1)\""), "never a javascript: link");
  assert.equal(node.querySelector("code").querySelector("a"), null, "not inside code");
  assert.equal(L.safeLink("javascript:alert(1)"), null);
  assert.equal(L.safeLink("file:///etc/passwd"), null);
  assert.equal(L.safeLink("http://example.com"), "http://example.com/");
  assert.deepEqual(L.webLinks("go to https://a.example/x. and mailto:a@b.co"), ["https://a.example/x"]);
  // Your own messages get links too.
  const user = d.createElement("div");
  user.textContent = "look http://example.org/page";
  L.linkify(user, d);
  assert.equal(user.querySelector("a").getAttribute("href"), "http://example.org/page");
});

test("a link opens in the browser only after the user says yes, and never an unsafe one", async () => {
  const opened = [];
  const asked = [];
  const deps = (answer) => ({ confirm: async (u) => { asked.push(u); return answer; }, openExternal: async (u) => { opened.push(u); } });
  assert.deepEqual(await clip.openLink("https://example.com/x", deps(true)), { opened: true, url: "https://example.com/x" });
  assert.deepEqual(await clip.openLink("https://example.com/y", deps(false)), { opened: false, reason: "cancelled" });
  for (const bad of ["javascript:alert(1)", "file:///etc/hosts", "pilot://app/x", "data:text/html,hi", "https://user:pw@example.com"]) {
    assert.equal((await clip.openLink(bad, deps(true))).opened, false, bad);
  }
  assert.deepEqual(opened, ["https://example.com/x"]);
  assert.deepEqual(asked, ["https://example.com/x", "https://example.com/y"]);
  assert.equal((await clip.openLink("mailto:hi@example.com", deps(true))).opened, true);
  const o = clip.confirmOptions("https://example.com/x");
  assert.equal(o.message, "Open this link?");
  assert.match(o.detail, /https:\/\/example\.com\/x/);
  const main = fs.readFileSync(path.join(__dirname, "..", "..", "src", "main", "main.js"), "utf8");
  assert.match(main, /handle\("open-link", \(_e, url\) => clip\.openLink/);
});

test("right-click: Copy text, Copy link, Copy image (as a picture) and Save image", () => {
  const did = [];
  const act = { copyText: (t) => did.push(["text", t]), openLink: (u) => did.push(["open", u]), copyImage: () => did.push(["image"]), saveImage: () => did.push(["save"]) };
  const labels = (info) => clip.menuTemplate(info, act).map((i) => i.label || i.role || i.type);
  assert.deepEqual(labels({ text: "Hello" }), ["Copy Text"]);
  assert.deepEqual(labels({ text: "Hi", link: "https://example.com" }), ["Copy Text", "separator", "Open Link…", "Copy Link"]);
  assert.deepEqual(labels({ link: "javascript:alert(1)", text: "x" }), ["Copy Text"]);
  assert.deepEqual(labels({ image: true }), ["Copy Image", "Save Image…"]);
  assert.deepEqual(labels({ editable: true }), ["cut", "copy", "paste", "separator", "selectAll"]);
  clip.menuTemplate({ text: "Hi", link: "https://example.com" }, act).find((i) => i.label === "Copy Link").click();
  assert.deepEqual(did, [["text", "https://example.com/"]]);
  // Copy image puts a picture (not text) on the clipboard.
  const put = [];
  const img = clip.dataUrlImage(`data:image/png;base64,${PNG.toString("base64")}`);
  assert.equal(img.mime, "image/png");
  const ok = clip.copyImage(img, { clipboard: { writeImage: (x) => put.push(x) }, nativeImage: { createFromBuffer: (b) => ({ isEmpty: () => !b.length, bytes: b.length }) } });
  assert.equal(ok, true);
  assert.equal(put.length, 1);
  assert.equal(put[0].bytes, PNG.length);
  assert.equal(clip.dataUrlImage("data:text/html;base64,PHA+"), null);
});

// ---------------------------------------------------------------- "Read this link"

const headers = (h) => ({ get: (k) => h[k.toLowerCase()] || null });
const reply = (status, type, body, extra) => ({ status, ok: status >= 200 && status < 300, headers: headers({ "content-type": type, ...(extra || {}) }),
  arrayBuffer: async () => Buffer.from(body), body: null });
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

test("the link reader refuses local, private-network and file addresses", async () => {
  for (const bad of ["file:///etc/passwd", "ftp://example.com/x", "http://localhost/", "http://127.0.0.1:8000/", "http://10.0.0.5/", "http://192.168.1.1/",
    "http://172.16.0.1/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://printer.local/", "http://intranet/", "http://0.0.0.0/",
    "http://[fd00::1]/", "http://[::ffff:127.0.0.1]/", "http://user:pass@example.com/", "javascript:alert(1)"]) {
    await assert.rejects(LR.read(bad, { fetch: async () => { throw new Error("must not fetch"); }, lookup: publicDns }), (e) => e instanceof LR.LinkError, bad);
  }
  // A public name that points at a private address (or a redirect to one) is refused too.
  await assert.rejects(LR.read("https://sneaky.example/", { fetch: async () => reply(200, "text/html", "x"), lookup: async () => [{ address: "10.1.2.3" }] }), /local network/);
  let calls = 0;
  await assert.rejects(LR.read("https://example.com/", { lookup: publicDns, fetch: async () => { calls += 1; return reply(302, "text/html", "", { location: "http://127.0.0.1/admin" }); } }), /local network/);
  assert.equal(calls, 1);
});

test("the link reader keeps the title and main text, no scripts or styles, and never sends cookies", async () => {
  const seen = [];
  const html = `<html><head><title>A &amp; B page</title><style>body{}</style><script>steal()</script></head>
    <body><nav>menu</nav><main><h1>Hello</h1><p>Main text here.</p><script>alert(1)</script><p>${"More words. ".repeat(60)}</p></main><footer>foot</footer></body></html>`;
  const got = await LR.read("https://example.com/a", { lookup: publicDns, fetch: async (u, init) => { seen.push(init); return reply(200, "text/html; charset=utf-8", html); } });
  assert.equal(got.kind, "page");
  assert.equal(got.title, "A & B page");
  assert.match(got.text, /Hello\nMain text here\./);
  assert.doesNotMatch(got.text, /steal|alert|body\{\}|menu|foot/);
  assert.equal(seen[0].credentials, "omit");
  assert.equal(seen[0].redirect, "manual");
  const long = await LR.read("https://example.com/b", { lookup: publicDns, fetch: async () => reply(200, "text/plain", "word ".repeat(10000)) });
  assert.ok(long.text.length <= LR.MAX_TEXT);
});

test("a link to a picture comes back as a picture", async () => {
  const got = await LR.read("https://example.com/cat.png", { lookup: publicDns, fetch: async () => reply(200, "image/png", PNG) });
  assert.equal(got.kind, "image");
  assert.equal(got.mime, "image/png");
  assert.equal(Buffer.from(got.data, "base64").equals(PNG), true);
});

test("the link reader gives up after 10 seconds, and on pages over 2 MB", async () => {
  // Timeout (shortened for the test): the fetch never answers until aborted.
  const hang = (u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  await assert.rejects(LR.read("https://slow.example/", { lookup: publicDns, fetch: hang, timeoutMs: 30 }), /too long/);
  assert.equal(LR.TIMEOUT_MS, 10000);
  // Too big, by its own say-so, and by what actually arrives.
  await assert.rejects(LR.read("https://big.example/", { lookup: publicDns, fetch: async () => reply(200, "text/html", "x", { "content-length": String(3 * 1024 * 1024) }) }), /too big/);
  const stream = (chunks) => ({ status: 200, ok: true, headers: headers({ "content-type": "text/html" }), body: { getReader() {
    let i = 0;
    return { read: async () => (i < chunks ? { done: false, value: new Uint8Array(512 * 1024 + (i++ * 0)) } : { done: true }), cancel: async () => {} };
  } } });
  let n = 0;
  const counting = { status: 200, ok: true, headers: headers({ "content-type": "text/html" }), body: { getReader() {
    return { read: async () => { n += 1; return n <= 10 ? { done: false, value: new Uint8Array(512 * 1024) } : { done: true }; }, cancel: async () => {} };
  } } };
  await assert.rejects(LR.read("https://big.example/2", { lookup: publicDns, fetch: async () => counting }), /too big/);
  assert.ok(n <= 6, `stopped reading after ${n} pieces`);
  const small = await LR.read("https://ok.example/", { lookup: publicDns, fetch: async () => stream(1) });
  assert.equal(small.kind, "page");
  assert.equal(LR.MAX_BYTES, 2 * 1024 * 1024);
});

test("the composer offers Read this link, on by default for a single pasted link, with Reading link… while it works", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "..", "src", "renderer", "chat.js"), "utf8");
  assert.match(chat, /Read this link \(/);
  assert.match(chat, /Reading link…/);
  assert.match(chat, /links\.length === 1 && !linkOn\.has\(links\[0\]\)\) linkOn\.set\(links\[0\], true\)/);
  const main = fs.readFileSync(path.join(__dirname, "..", "..", "src", "main", "main.js"), "utf8");
  assert.match(main, /linkread\.read\(str\(url, 4000\), \{ fetch: \(u, init\) => net\.fetch\(u, init\) \}\)/);
});
