// Pilot for Mac 1.4: two editions from one codebase. "Pilot" (own keys and
// Free mode) and "Pilot Free" (Free mode only), picked at build time.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const E = require("../../src/main/edition");

const APP = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(APP, rel), "utf8");

test("a packaged app is what it was built as; a development run reads PILOT_EDITION", () => {
  assert.equal(E.resolve({ env: {}, pkg: {} }).id, "pilot");
  assert.equal(E.resolve({ env: { PILOT_EDITION: "free" }, pkg: {} }).id, "free");
  assert.equal(E.resolve({ env: { PILOT_EDITION: "nonsense" }, pkg: {} }).id, "pilot");
  assert.equal(E.resolve({ env: { PILOT_EDITION: "pilot" }, pkg: { pilotEdition: "free" }, packaged: true }).id, "free");
  assert.equal(E.resolve({ env: { PILOT_EDITION: "free" }, pkg: { pilotEdition: "pilot" }, packaged: true }).id, "pilot",
    "the environment can't turn a packaged Pilot into the other edition");
  assert.equal(E.resolve({ env: {}, pkg: {}, packaged: true }).id, "pilot");
});

test("the editions differ in name, bundle id, Keychain item and download, so both install side by side", () => {
  const p = E.EDITIONS.pilot;
  const f = E.EDITIONS.free;
  assert.equal(p.appName, "Pilot");
  assert.equal(f.appName, "Pilot Free");
  assert.equal(p.appId, "com.mtrxhorizyn.pilot");
  assert.equal(f.appId, "com.mtrxhorizyn.pilot.free");
  assert.equal(E.keychainService(p), "Pilot Safe Storage");
  assert.equal(E.keychainService(f), "Pilot Free Safe Storage");
  assert.equal(p.keys, true);
  assert.equal(f.keys, false);
  assert.notEqual(p.artifact, f.artifact);
});

test("electron-builder builds each edition with its own name, id, .dmg name and edition flag, keeping the fuses", () => {
  const load = (edition) => {
    const before = process.env.PILOT_EDITION;
    if (edition) process.env.PILOT_EDITION = edition; else delete process.env.PILOT_EDITION;
    const file = require.resolve("../../electron-builder.config.js");
    delete require.cache[file];
    try { return require(file); } finally {
      if (before === undefined) delete process.env.PILOT_EDITION; else process.env.PILOT_EDITION = before;
      delete require.cache[file];
    }
  };
  const p = load("");
  const f = load("free");
  assert.equal(p.appId, "com.mtrxhorizyn.pilot");
  assert.equal(p.productName, "Pilot");
  assert.equal(p.artifactName, "Pilot-${version}-mac.${ext}");
  assert.deepEqual(p.extraMetadata, { productName: "Pilot", pilotEdition: "pilot" });
  assert.equal(f.appId, "com.mtrxhorizyn.pilot.free");
  assert.equal(f.productName, "Pilot Free");
  assert.equal(f.artifactName, "Pilot-Free-${version}-mac.${ext}");
  assert.deepEqual(f.extraMetadata, { productName: "Pilot Free", pilotEdition: "free" });
  assert.equal(f.dmg.title, "Pilot Free");
  for (const c of [p, f]) {
    assert.deepEqual(c.electronFuses, { runAsNode: false, enableCookieEncryption: true, enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true });
    assert.equal(c.asar, true);
    assert.ok(c.files.includes("src/**/*"), "the edition module and Free mode's data file are packaged");
  }
});

test("where the AI runs: Pilot Free is always Free mode; Pilot defaults to Free on Apple Silicon with no key", () => {
  const free = E.EDITIONS.free;
  const pilot = E.EDITIONS.pilot;
  const mac = { platform: "darwin", arch: "arm64" };
  assert.equal(E.source({ edition: free, saved: "key", hasKeys: true }), "free");
  assert.equal(E.source({ edition: pilot, ...mac }), "free");
  assert.equal(E.source({ edition: pilot, platform: "darwin", arch: "x64", cpuModel: "Apple M5" }), "free", "under Rosetta");
  assert.equal(E.source({ edition: pilot, platform: "darwin", arch: "x64", cpuModel: "Intel(R) Core(TM) i7" }), "key");
  assert.equal(E.source({ edition: pilot, platform: "linux", arch: "x64" }), "key");
  assert.equal(E.source({ edition: pilot, ...mac, hasKeys: true }), "key", "a saved key wins over the default");
  assert.equal(E.source({ edition: pilot, ...mac, hasKeys: true, saved: "free" }), "free", "the user's pick wins");
  assert.equal(E.source({ edition: pilot, ...mac, saved: "key" }), "key");
});

test("the edition flag hides and shows the right settings sections", () => {
  const free = E.sections(E.EDITIONS.free, "free");
  assert.deepEqual(free, ["free", "screen", "memory", "notes", "voice", "general"]);
  for (const s of ["keys", "media", "source"]) assert.ok(!free.includes(s), `Pilot Free has no ${s} section`);
  assert.deepEqual(E.sections(E.EDITIONS.pilot, "free"), ["source", "free", "screen", "memory", "notes", "voice", "general"]);
  assert.deepEqual(E.sections(E.EDITIONS.pilot, "key"), ["source", "keys", "media", "screen", "memory", "notes", "voice", "general"]);
});

test("the main process refuses every key call in Pilot Free and never opens the Keychain there", () => {
  const main = read("src/main/main.js");
  for (const name of ["profile-save", "profile-remove", "profile-activate", "media-key-save", "media-key-remove"]) {
    const at = main.indexOf(`handle("${name}"`);
    assert.ok(at > 0, name);
    assert.match(main.slice(at, at + 160), /keysOnly\(\)/, `${name} is refused in Pilot Free`);
  }
  assert.match(main, /function draftSettings\(d\) \{\n {2}keysOnly\(\);/, "model lists for keys too");
  assert.match(main, /new KeyStore\(dir, ED\.keys \? safeStorage : null\)/);
  assert.match(main, /providers: ED\.keys \? providers\.LIST : \[\]/, "no provider list is sent to Pilot Free's window");
  assert.match(main, /app\.setPath\("userData", process\.env\.PILOT_USER_DATA \|\| path\.join\(app\.getPath\("appData"\), ED\.appName\)\)/);
});

// The real chat window script, in a pretend window, given each edition's settings.
function chatWindow() {
  const html = read("src/renderer/chat.html").replace(/<script[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const listeners = {};
  const calls = [];
  const on = (name) => (fn) => { listeners[name] = fn; return () => {}; };
  const call = (name) => (...a) => { calls.push([name, ...a]); return Promise.resolve({ ok: true }); };
  const group = (names) => Object.fromEntries(names.map((n) => [n, call(n)]));
  w.pilot = {
    robot: {},
    chat: { ...group(["send", "stop", "clear", "hide", "focus", "answer", "helpScreen", "openLink", "paste", "readLink", "context", "copy", "mediaGet", "mediaSave"]),
      onFocus: on("focus"), onState: on("state"), onView: on("view") },
    settings: { ...group(["listModels", "saveProfile", "removeProfile", "activate", "mediaModels", "saveMedia", "removeMedia", "setMemory",
      "removeMemory", "removeNote", "copyNote", "setTheme", "setLogin", "setEnergy", "welcomeDone", "setSource", "freeStatus", "freePull",
      "freeCancel", "freeUse", "freeOpen"]), get: () => new Promise(() => {}), onChange: on("settings") },
    voice: { ...group(["set", "talking", "say", "stop"]), onStop: on("voiceStop") },
    attach: group(["info", "add", "remove", "heic", "uploadStart", "uploadPiece", "progress", "show"]),
    screen: group(["status", "setMode", "check", "openSettings", "closeHelp"]),
    app: group(["about", "quit", "relaunch"]),
  };
  for (const f of ["src/core/pilot-render.js", "src/renderer/attach.js", "src/renderer/links.js", "src/renderer/speech.js", "src/renderer/chat.js"]) {
    w.eval(read(f));
  }
  return { w, doc: w.document, listeners, calls };
}

const base = (over) => ({
  version: "1.4.0", theme: "blue", openAtLogin: true, energy: "always", reducedMotion: false, energyChosen: false, keychain: true,
  screen: { allowed: false, mode: "ask" }, screenMode: "ask", welcomed: true, voice: { speak: false, sounds: true, soundVolume: 0.3, quietFrom: 21, quietTo: 7 },
  memoryOn: false, memory: [], notes: [], providers: [], profiles: [], activeProfile: "", media: { image: null, video: null }, ready: false,
  free: { ollama: "missing", drawThings: "missing", models: [], model: "", memoryGB: 16, recommended: { model: "m", label: "Medium brain", download: "about 5 GB", installed: false }, pull: null, status: "Free mode · set up Ollama to start" },
  ...over,
});

test("Pilot Free's settings: Free mode setup cards, and no key settings, slots or provider list", () => {
  const { doc, listeners, calls } = chatWindow();
  listeners.settings(base({ edition: { id: "free", name: "Pilot Free", keys: false }, source: "free", sections: E.sections(E.EDITIONS.free, "free") }));
  doc.getElementById("gear").click();
  const page = doc.getElementById("view-settings").textContent;
  assert.match(page, /Free mode · on your Mac/);
  assert.match(page, /Download Ollama \(free\)/);
  assert.match(page, /Get Draw Things \(free\)/);
  assert.match(page, /Videos aren't available in Pilot Free/);
  for (const words of ["Your AI keys", "API key", "Add a key", "Image key", "Video key", "AI source", "Provider"]) {
    assert.ok(!page.includes(words), `no “${words}” in Pilot Free`);
  }
  assert.equal(doc.querySelectorAll("#view-settings input[type=password]").length, 0);
  assert.ok(calls.some((c) => c[0] === "freeStatus"), "opening settings checks Ollama and Draw Things");
  // The setup card's button opens the download page (in the browser, from the main process).
  [...doc.querySelectorAll("#view-settings button")].find((b) => b.textContent === "Download Ollama (free)").click();
  assert.deepEqual(calls.filter((c) => c[0] === "freeOpen").map((c) => c[1]), ["ollama-download"]);
  // The key card and status line say Free mode.
  assert.equal(doc.querySelector(".byok-title").textContent, "Free mode · on your Mac");
  assert.equal(doc.querySelector(".tagline").textContent, "Your AI copilot. Free, on your Mac.");
});

test("Download brain shows its progress, then the brains to pick from", () => {
  const { doc, listeners, calls } = chatWindow();
  const s = (free) => base({ edition: { id: "free", name: "Pilot Free", keys: false }, source: "free", sections: E.sections(E.EDITIONS.free, "free"),
    free: { ...base().free, ollama: "running", ...free } });
  listeners.settings(s({}));
  doc.getElementById("gear").click();
  [...doc.querySelectorAll("#view-settings button")].find((b) => b.textContent === "Download brain").click();
  assert.deepEqual(calls.filter((c) => c[0] === "freePull").map((c) => c[1]), ["m"]);
  listeners.settings(s({ pull: { model: "m", progress: 0.42, words: "Downloading…", error: "", done: false } }));
  const bar = doc.querySelector(".pullbox progress");
  assert.equal(bar.getAttribute("value"), "42");
  assert.match(doc.querySelector(".pullbox").textContent, /Downloading… 42%/);
  assert.ok([...doc.querySelectorAll("#view-settings button")].some((b) => b.textContent === "Cancel download"));
  listeners.settings(s({ models: [{ id: "m", size: "4.7 GB", params: "7B" }], model: "m", recommended: { ...base().free.recommended, installed: true },
    pull: { model: "m", progress: 1, words: "Done: the brain is ready.", done: true } }));
  assert.equal(doc.querySelectorAll('input[name="free-model"]').length, 1);
  assert.ok(doc.querySelector('input[name="free-model"]').checked);
  assert.match(doc.getElementById("view-settings").textContent, /This brain can use Pilot's actions/);
});

test("Pilot's settings: the AI source choice, with keys or with Free mode", () => {
  const { doc, listeners, calls } = chatWindow();
  const providers = [{ id: "anthropic", label: "Anthropic" }, { id: "compatible", label: "Any compatible API" }];
  listeners.settings(base({ edition: { id: "pilot", name: "Pilot", keys: true }, source: "key", sections: E.sections(E.EDITIONS.pilot, "key"), providers }));
  doc.getElementById("gear").click();
  let page = doc.getElementById("view-settings").textContent;
  assert.match(page, /AI source/);
  assert.match(page, /Free: runs on my Mac/);
  assert.match(page, /Your AI keys/);
  assert.match(page, /Image key/);
  assert.ok(!page.includes("Download Ollama"));
  assert.equal(doc.querySelector(".byok-title").textContent, "Bring Your Own API Key");
  doc.querySelector('input[name="ai-source"][value="free"]').click();
  assert.deepEqual(calls.filter((c) => c[0] === "setSource").map((c) => c[1]), ["free"]);
  listeners.settings(base({ edition: { id: "pilot", name: "Pilot", keys: true }, source: "free", sections: E.sections(E.EDITIONS.pilot, "free"), providers }));
  page = doc.getElementById("view-settings").textContent;
  assert.match(page, /Download Ollama \(free\)/);
  assert.match(page, /Videos aren't available in Free mode/);
  assert.ok(!page.includes("Your AI keys"));
  assert.equal(doc.querySelector(".byok-title").textContent, "Free mode · on your Mac");
});
