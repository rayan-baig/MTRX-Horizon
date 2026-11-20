"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const csp = require("../../src/main/csp");

const APP = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(APP, rel), "utf8");
const renderer = fs.readdirSync(path.join(APP, "src/renderer"));

test("the CSP is strict and lists only provider hosts plus the user's address", () => {
  const policy = csp.buildCsp(["https://llm.example.com", "javascript:x", "https://bad host"]);
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'self'(;|$)/);
  assert.match(policy, /style-src 'self'(;|$)/);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|\*/);
  const connect = policy.split("; ").find((p) => p.startsWith("connect-src")).split(" ").slice(1);
  assert.deepEqual(connect, ["https://api.anthropic.com", "https://api.openai.com", "https://generativelanguage.googleapis.com", "https://llm.example.com"]);
});

test("every window page is served with the CSP, and nothing outside the app is served", () => {
  for (const page of renderer.filter((f) => f.endsWith(".html"))) {
    const res = csp.serve(APP, `pilot://app/src/renderer/${page}`, []);
    assert.equal(res.status, 200, page);
    assert.equal(res.headers["content-security-policy"], csp.buildCsp([]));
  }
  for (const bad of ["pilot://app/src/main/main.js", "pilot://app/../package.json", "pilot://app/src/renderer/%2e%2e/main/main.js",
    "pilot://other/src/renderer/chat.html", "pilot://app/node_modules/x.js", "pilot://app/src/core/providers.js"]) {
    assert.equal(csp.serve(APP, bad, []).status, 404, bad);
  }
});

test("pages have no inline scripts, inline styles or remote content", () => {
  for (const f of renderer) {
    const text = read(`src/renderer/${f}`);
    if (f.endsWith(".html")) {
      assert.doesNotMatch(text, /<script(?![^>]*\ssrc=)[^>]*>/i, `${f}: inline script`);
      assert.doesNotMatch(text, /<style/i, `${f}: inline style`);
      assert.doesNotMatch(text, /\sstyle=/i, `${f}: style attribute`);
      assert.doesNotMatch(text, /\son[a-z]+=/i, `${f}: inline handler`);
      assert.doesNotMatch(text, /(src|href)="https?:/i, `${f}: remote content`);
    }
    if (f.endsWith(".js")) {
      assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|\.style\./, `${f}: unsafe DOM`);
    }
  }
  assert.doesNotMatch(read("src/core/pilot-render.js"), /\.innerHTML\s*=|outerHTML|insertAdjacentHTML/);
});

test("windows are created isolated and sandboxed, and can't navigate or open others", () => {
  const main = read("src/main/main.js");
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /will-navigate", \(e\) => e\.preventDefault\(\)/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.match(main, /setAlwaysOnTop\(true, "screen-saver"\)/);
  assert.match(main, /setVisibleOnAllWorkspaces\(true, \{ visibleOnFullScreen: true \}\)/);
  assert.doesNotMatch(main, /loadURL\("http/);
  assert.doesNotMatch(main, /console\.(log|info|debug)\(/, "nothing is logged (keys never are)");
  const preload = read("src/preload/preload.js");
  assert.match(preload, /contextBridge\.exposeInMainWorld\("pilot"/);
  assert.doesNotMatch(preload, /ipcRenderer\.send\(|exposeInMainWorld\("ipcRenderer"|require\("(fs|child_process)/);
});

test("no AI model names and no secrets in the app's code or docs", () => {
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(path.join(APP, dir))) {
      const rel = path.join(dir, f);
      if (["node_modules", "dist", "build", "assets", ".git"].includes(f)) continue;
      if (fs.statSync(path.join(APP, rel)).isDirectory()) walk(rel);
      else if (/\.(js|mjs|cjs|json|md|html|css|yml|yaml)$/.test(f) && f !== "package-lock.json" && f !== "csp.test.js") files.push(rel); // this file holds the patterns
    }
  };
  walk(".");
  const modelName = /\b(claude-(\d|opus|sonnet|haiku|fable|mythos|instant)|gpt-?\d|o\d-mini|gemini-\d|dall-e|sora-\d|veo-\d|imagen-\d|chatgpt-)/i;
  const secret = /\b(sk-ant-[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})/;
  for (const f of files) {
    const text = read(f);
    assert.doesNotMatch(text, modelName, `${f}: model name`);
    assert.doesNotMatch(text, secret, `${f}: secret`);
  }
});
