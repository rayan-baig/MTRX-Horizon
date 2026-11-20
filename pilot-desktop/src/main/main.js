// Pilot for Mac: the main process.
//
// Two windows: the robot (small, transparent, always on top, on every Space
// and over full-screen apps) and the chat window that opens next to it.
// Pilot lives in the menu bar (no Dock icon). The AI calls, the keys and the
// actions all stay here, in the main process; the windows only show things
// and pass the user's clicks back through a small preload API.
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, clipboard, dialog, nativeImage,
  safeStorage, desktopCapturer, systemPreferences, protocol, session, net,
} = require("electron");

const providers = require("../core/providers");
const media = require("../core/media");
const engineCore = require("../core/engine");
const desktopTools = require("../core/desktop-tools");
const { KeyStore, Settings } = require("./store");
const csp = require("./csp");
const screenTools = require("./screen");

const APP_DIR = path.join(__dirname, "..", "..");
const TEST = process.env.PILOT_TEST === "1";
const ROBOT_SIZE = { width: 140, height: 150 };
const CHAT_SIZE = { width: 452, height: 744 };
const MAC = process.platform === "darwin";

if (process.env.PILOT_USER_DATA) app.setPath("userData", process.env.PILOT_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: "pilot", privileges: { standard: true, secure: true, supportFetchAPI: false } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let settings;
let keys;
let robotWin = null;
let chatWin = null;
let tray = null;
let engine = null;
let shots = null;
let looking = false;
let hidden = false;
let quitting = false;
let screenHelp = false;
let helpScreenOn = false; // "Help with what's on screen": this session only
let lastState = null;
const cards = new Map(); // id → {type, label, labels, step, resolve}
const mediaItems = new Map(); // id → {kind, state, progress, mime, data, prompt, message}
let cardSeq = 0;
let mediaSeq = 0;

// ---------------------------------------------------------------- where Pilot may connect

function compatibleOrigins() {
  const out = new Set();
  for (const p of settings.get("profiles")) { const o = providers.originFor(p); if (o) out.add(o); }
  for (const kind of ["image", "video"]) { const o = providers.originFor(settings.get("media")[kind]); if (o) out.add(o); }
  return [...out].filter((o) => !csp.PROVIDER_HOSTS.includes(o));
}

function allowedOrigin(url) {
  try {
    const origin = new URL(url).origin;
    return csp.PROVIDER_HOSTS.includes(origin) || compatibleOrigins().includes(origin);
  } catch (_) { return false; }
}

// Every AI call goes through here: only to the providers' API hosts or the
// user's own compatible address, never with cookies.
async function guardedFetch(url, init) {
  if (!allowedOrigin(url)) throw new providers.PilotError("address", "Pilot only talks to your AI provider's own address.");
  const opts = { ...init, credentials: "omit" };
  return net && typeof net.fetch === "function" ? net.fetch(url, opts) : fetch(url, opts);
}

// ---------------------------------------------------------------- settings as the engine sees them

function activeSettings() {
  const p = settings.profile();
  if (!p) return { provider: "", model: "" };
  return { ...p, key: keys.get(`profile:${p.id}`) };
}

function ready(s) {
  const p = s || activeSettings();
  if (!p.provider || !p.model) return false;
  return p.provider === "compatible" ? !providers.checkBaseUrl(p.baseUrl) : Boolean(p.key);
}

function mediaSettings(kind) {
  const m = settings.get("media")[kind];
  if (!m) return null;
  const key = keys.get(`media:${kind}`);
  if (!m.model || (m.provider !== "compatible" && !key)) return null;
  return { ...m, key };
}

function settingsView() {
  const m = settings.get("media");
  const mediaView = (kind) => (m[kind] ? { ...m[kind], keyHint: keys.hint(`media:${kind}`) } : null);
  return {
    version: app.getVersion(),
    providers: providers.LIST,
    profiles: settings.get("profiles").map((p) => ({ ...p, keyHint: keys.hint(`profile:${p.id}`) })),
    activeProfile: settings.get("activeProfile"),
    media: { image: mediaView("image"), video: mediaView("video") },
    memoryOn: settings.get("memoryOn"),
    memory: settings.get("memory"),
    notes: settings.get("notes"),
    theme: settings.get("theme"),
    openAtLogin: settings.get("openAtLogin"),
    keychain: keys.available(),
    screenStatus: shots.status(),
    screenExplained: settings.get("screenExplained"),
    welcomed: settings.get("welcomed"),
    ready: ready(),
  };
}

// ---------------------------------------------------------------- what the windows show

function viewMessages(list) {
  const out = [];
  for (const m of list) {
    if (m.role === "user") out.push({ role: "user", text: m.label || m.text, shots: (m.images || []).map((i) => i.thumb).filter(Boolean) });
    else if (m.role === "assistant") { if (m.text) out.push({ role: "assistant", text: m.text }); }
    else if (m.role === "tool") {
      for (const r of m.results) {
        if (r.shown) out.push({ role: "action", text: r.shown });
        if (r.image && r.image.thumb) out.push({ role: "action", text: "Pilot looked at your screen.", shots: [r.image.thumb] });
      }
    } else if (m.role === "note") {
      const item = m.mediaId ? mediaItems.get(m.mediaId) : null;
      out.push({ role: "note", kind: m.kind, text: m.text, media: item ? {
        id: m.mediaId, kind: item.kind, state: item.state, progress: item.progress, message: item.message || "" } : null });
    }
  }
  return out;
}

function robotStatus(state) {
  if (looking) return "looking";
  if (state && state.busy) return "thinking";
  return ready() ? "ready" : "nokey";
}

function push(state) {
  if (state) lastState = state;
  const s = lastState || { messages: [], busy: false, streaming: "", status: "" };
  const view = {
    messages: viewMessages(s.messages),
    busy: s.busy, streaming: s.streaming, status: s.status,
    looking, ready: ready(), helpScreen: helpScreenOn, screenHelp,
    cards: [...cards.entries()].map(([id, c]) => ({ id, type: c.type, label: c.label, labels: c.labels, step: c.step, progress: c.progress })),
    providerName: providers.providerName(activeSettings()),
  };
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send("pilot:state", view);
  if (robotWin && !robotWin.isDestroyed()) robotWin.webContents.send("pilot:robot", { status: robotStatus(s), theme: settings.get("theme") });
}

function pushSettings() {
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send("pilot:settings", settingsView());
  push();
}

// ---------------------------------------------------------------- the engine's host: cards in the chat window

function addCard(card) {
  return new Promise((resolve) => {
    const id = `c${(cardSeq += 1)}`;
    cards.set(id, { ...card, resolve });
    showChat();
    push();
  });
}

function answerCard(id, answer) {
  const c = cards.get(id);
  if (!c) return;
  cards.delete(id);
  c.resolve(answer);
  push();
}

const host = {
  update: (state) => push(state),
  confirm: (label, step) => addCard({ type: "confirm", label, step: step || null }),
  plan: (labels) => addCard({ type: "plan", labels }),
  progress: () => push(),
  cancelCards: () => {
    for (const [id, c] of cards) { cards.delete(id); c.resolve(c.type === "plan" ? "cancel" : false); }
    push();
  },
};

// ---------------------------------------------------------------- screenshots

function hideOwnWindows() {
  // Leave Pilot's own windows out of the picture while it's taken.
  const wins = [robotWin, chatWin].filter((w) => w && !w.isDestroyed());
  for (const w of wins) { try { w.setContentProtection(true); } catch (_) { /* not supported */ } }
  return () => { for (const w of wins) { try { w.setContentProtection(false); } catch (_) { /* not supported */ } } };
}

async function takeShot() {
  looking = true;
  push();
  try {
    const near = robotWin && !robotWin.isDestroyed() ? robotWin.getBounds() : null;
    const shot = await shots.capture(near ? { x: near.x + 40, y: near.y + 40 } : null, hideOwnWindows);
    if (shot.needPermission) { screenHelp = true; push(); }
    return shot;
  } finally {
    // Keep "Pilot is looking" up a moment so it's always seen.
    setTimeout(() => { looking = false; push(); }, 900);
  }
}

// ---------------------------------------------------------------- pictures and videos

async function makeImage(prompt) {
  const p = mediaSettings("image");
  if (!p) return { content: "There's no image key set in Pilot settings.", error: true };
  const id = `m${(mediaSeq += 1)}`;
  mediaItems.set(id, { kind: "image", state: "working", prompt });
  engine.attach({ kind: "image", text: prompt, mediaId: id });
  try {
    const pic = await media.image(p, prompt, { fetch: guardedFetch });
    mediaItems.set(id, { kind: "image", state: "done", prompt, mime: pic.mime, data: pic.data });
    push();
    return "Made the picture. It's shown in the chat with a Save button.";
  } catch (e) {
    mediaItems.set(id, { kind: "image", state: "failed", prompt, message: e.message });
    push();
    return { content: e.message || "The picture didn't work.", error: true };
  }
}

async function makeVideo(prompt) {
  const p = mediaSettings("video");
  if (!p) return { content: "There's no video key set in Pilot settings.", error: true };
  const job = await media.startVideo(p, prompt, { fetch: guardedFetch });
  const id = `m${(mediaSeq += 1)}`;
  mediaItems.set(id, { kind: "video", state: "working", progress: null, prompt });
  engine.attach({ kind: "video", text: prompt, mediaId: id });
  const started = Date.now();
  const tick = async () => {
    if (quitting) return;
    try {
      const st = await media.checkVideo(p, job.id, { fetch: guardedFetch });
      if (st.state === "working" && Date.now() - started < 20 * 60 * 1000) {
        mediaItems.set(id, { ...mediaItems.get(id), progress: st.progress });
        push();
        setTimeout(tick, 8000);
        return;
      }
      if (st.state === "done") {
        const vid = await media.fetchVideo(p, job.id, st, { fetch: guardedFetch });
        mediaItems.set(id, { kind: "video", state: "done", prompt, mime: vid.mime, data: Buffer.from(vid.bytes).toString("base64") });
      } else {
        mediaItems.set(id, { kind: "video", state: "failed", prompt, message: st.message || "The video took too long. Check with your provider." });
      }
    } catch (e) {
      mediaItems.set(id, { kind: "video", state: "failed", prompt, message: e.message || "The video didn't work." });
    }
    push();
  };
  setTimeout(tick, 5000);
  return "Started the video. The chat shows its progress, and the video when it's ready.";
}

// ---------------------------------------------------------------- windows

const webPreferences = () => ({
  preload: path.join(__dirname, "..", "preload", "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  spellcheck: false,
  navigateOnDragDrop: false,
  devTools: !app.isPackaged,
});

function floatEverywhere(win) {
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (MAC && typeof win.setHiddenInMissionControl === "function") win.setHiddenInMissionControl(true);
}

function onScreen(pos, size) {
  const display = screen.getDisplayMatching({ x: pos.x, y: pos.y, width: size.width, height: size.height });
  const a = display.workArea;
  return {
    x: Math.min(Math.max(pos.x, a.x), a.x + a.width - size.width),
    y: Math.min(Math.max(pos.y, a.y), a.y + a.height - size.height),
  };
}

function createRobot() {
  const a = screen.getPrimaryDisplay().workArea;
  const saved = settings.get("robot");
  const pos = onScreen(saved && Number.isFinite(saved.x) ? saved : { x: a.x + a.width - ROBOT_SIZE.width - 24, y: a.y + a.height - ROBOT_SIZE.height - 24 }, ROBOT_SIZE);
  robotWin = new BrowserWindow({
    ...ROBOT_SIZE, ...pos,
    type: MAC ? "panel" : undefined,
    transparent: true, frame: false, resizable: false, movable: true, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, minimizable: false, maximizable: false,
    acceptFirstMouse: true, show: false, title: "Pilot", backgroundColor: "#00000000",
    webPreferences: webPreferences(),
  });
  floatEverywhere(robotWin);
  robotWin.loadURL("pilot://app/src/renderer/robot.html");
  robotWin.once("ready-to-show", () => { if (!hidden) robotWin.showInactive(); push(); });
  robotWin.on("closed", () => { robotWin = null; });
}

function chatBounds() {
  const r = robotWin && !robotWin.isDestroyed() ? robotWin.getBounds() : null;
  const display = r ? screen.getDisplayMatching(r) : screen.getPrimaryDisplay();
  const a = display.workArea;
  const height = Math.min(CHAT_SIZE.height, a.height - 16);
  const size = { width: CHAT_SIZE.width, height };
  if (!r) return { ...size, ...onScreen({ x: a.x + a.width - size.width - 20, y: a.y + 20 }, size) };
  const right = r.x + r.width + size.width <= a.x + a.width;
  const x = right ? r.x + r.width - 8 : r.x - size.width + 8;
  const y = r.y + r.height - size.height + 20;
  return { ...size, ...onScreen({ x, y }, size) };
}

function createChat() {
  chatWin = new BrowserWindow({
    ...chatBounds(),
    type: MAC ? "panel" : undefined,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, minimizable: false, maximizable: false,
    acceptFirstMouse: true, show: false, title: "Pilot", backgroundColor: "#00000000",
    webPreferences: webPreferences(),
  });
  floatEverywhere(chatWin);
  chatWin.loadURL("pilot://app/src/renderer/chat.html");
  chatWin.webContents.on("did-finish-load", () => pushSettings());
  chatWin.on("close", (e) => {
    if (!quitting) { e.preventDefault(); chatWin.hide(); }
  });
  chatWin.on("closed", () => { chatWin = null; });
}

function showChat(view) {
  if (!chatWin || chatWin.isDestroyed()) createChat();
  chatWin.setBounds(chatBounds());
  const show = () => {
    chatWin.show();
    chatWin.focus();
    if (view) chatWin.webContents.send("pilot:view", view);
  };
  if (chatWin.webContents.isLoading()) chatWin.webContents.once("did-finish-load", show);
  else show();
}

function hideChat() {
  if (chatWin && !chatWin.isDestroyed()) chatWin.hide();
}

function toggleChat() {
  if (chatWin && !chatWin.isDestroyed() && chatWin.isVisible()) hideChat();
  else showChat();
}

function setHidden(h) {
  hidden = h;
  if (h) { hideChat(); if (robotWin) robotWin.hide(); }
  else if (robotWin) robotWin.showInactive();
  else createRobot();
  updateTray();
}

// ---------------------------------------------------------------- menu bar

function trayImage() {
  const img = nativeImage.createFromPath(path.join(APP_DIR, "assets", "tray-icon.png"));
  for (const [file, scale] of [["tray-icon@2x.png", 2], ["tray-icon@3x.png", 3]]) {
    const buf = fs.readFileSync(path.join(APP_DIR, "assets", file));
    img.addRepresentation({ scaleFactor: scale, buffer: buf });
  }
  return img;
}

function setLogin(on) {
  settings.set("openAtLogin", Boolean(on));
  settings.set("loginChosen", true);
  if (!TEST && MAC) app.setLoginItemSettings({ openAtLogin: Boolean(on) });
  updateTray();
  pushSettings();
}

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    hidden ? { label: "Show Pilot", click: () => setHidden(false) } : { label: "Hide Pilot", click: () => setHidden(true) },
    { label: "Open Chat", click: () => { setHidden(false); showChat(); } },
    { label: "Settings…", click: () => { setHidden(false); showChat("settings"); } },
    { type: "separator" },
    { label: "Start at Login", type: "checkbox", checked: Boolean(settings.get("openAtLogin")), click: (item) => setLogin(item.checked) },
    { label: "About Pilot", click: () => app.showAboutPanel() },
    { type: "separator" },
    { label: "Quit Pilot", accelerator: "Command+Q", click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip("Pilot");
  updateTray();
}

// ---------------------------------------------------------------- IPC (the preload's small API)

function fromPilot(event) {
  try { return new URL(event.senderFrame.url).protocol === "pilot:"; } catch (_) { return false; }
}

function handle(name, fn) {
  ipcMain.handle(`pilot:${name}`, async (event, ...args) => {
    if (!fromPilot(event)) throw new Error("Not allowed.");
    try {
      return await fn(event, ...args);
    } catch (e) {
      return { error: (e && e.kind && e.message) || (e && e.message) || "Something went wrong." };
    }
  });
}

const str = (v, n) => (typeof v === "string" ? v.slice(0, n || 10000) : "");

function draftSettings(d) {
  const draft = d && typeof d === "object" ? d : {};
  const provider = str(draft.provider, 20);
  if (!providers.LIST.some((p) => p.id === provider)) throw Object.assign(new Error("Choose a provider first."), { kind: "other" });
  let key = str(draft.key, 400).trim();
  if (!key && draft.id) key = keys.get(draft.kindKey || `profile:${str(draft.id, 40)}`);
  return { provider, baseUrl: str(draft.baseUrl, 300).trim(), key, model: str(draft.model, 200), method: str(draft.method, 20) };
}

function registerIpc() {
  let drag = null;
  handle("robot-drag-start", () => {
    if (!robotWin) return;
    const c = screen.getCursorScreenPoint();
    const [x, y] = robotWin.getPosition();
    drag = { cx: c.x, cy: c.y, x, y };
  });
  handle("robot-drag-move", () => {
    if (!drag || !robotWin) return;
    const c = screen.getCursorScreenPoint();
    robotWin.setPosition(Math.round(drag.x + c.x - drag.cx), Math.round(drag.y + c.y - drag.cy));
  });
  handle("robot-drag-end", () => {
    if (!robotWin) return;
    drag = null;
    const b = robotWin.getBounds();
    const pos = onScreen(b, ROBOT_SIZE);
    robotWin.setPosition(pos.x, pos.y);
    settings.set("robot", pos);
    if (chatWin && !chatWin.isDestroyed() && chatWin.isVisible()) chatWin.setBounds(chatBounds());
  });
  handle("robot-click", () => toggleChat());

  handle("chat-hide", () => hideChat());
  handle("chat-send", async (_e, text, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    const words = str(text, 8000).trim();
    if (!words) return {};
    let images = [];
    if (o.look || helpScreenOn) {
      if (!ready()) { engine.send(words); return {}; }
      const shot = await takeShot();
      if (shot.needPermission) return { needPermission: true };
      if (shot.error) { engine.note(shot.error, "error"); return {}; }
      images = [shot];
    }
    engine.send(words, { images, label: str(o.label, 200) || undefined });
    return {};
  });
  handle("chat-stop", () => engine.stop());
  handle("chat-clear", () => { engine.clear(); mediaItems.clear(); });
  handle("chat-answer", (_e, id, answer) => {
    const c = cards.get(str(id, 20));
    if (!c) return;
    const ok = c.type === "plan" ? ["all", "step", "cancel"].includes(answer) : typeof answer === "boolean";
    answerCard(str(id, 20), ok ? answer : (c.type === "plan" ? "cancel" : false));
  });
  handle("chat-help-screen", (_e, on) => { helpScreenOn = Boolean(on); push(); });
  handle("open-link", async (_e, url) => {
    const safe = desktopTools.safeWebUrl(url);
    if (safe) await shell.openExternal(safe);
  });
  handle("copy-text", (_e, text) => { clipboard.writeText(str(text, 50000)); return { ok: true }; });
  handle("media-get", (_e, id) => {
    const m = mediaItems.get(str(id, 20));
    return m && m.state === "done" ? { mime: m.mime, data: m.data } : null;
  });
  handle("media-save", async (_e, id) => {
    const m = mediaItems.get(str(id, 20));
    if (!m || m.state !== "done") return {};
    const ext = m.kind === "video" ? "mp4" : (m.mime || "").includes("jpeg") ? "jpg" : (m.mime || "").includes("webp") ? "webp" : "png";
    const res = await dialog.showSaveDialog(chatWin, { defaultPath: path.join(app.getPath("downloads"), `Pilot ${m.kind} ${Date.now()}.${ext}`) });
    if (res.canceled || !res.filePath) return {};
    fs.writeFileSync(res.filePath, Buffer.from(m.data, "base64"));
    return { saved: true };
  });

  handle("settings-get", () => settingsView());
  handle("models-list", async (_e, d) => {
    const s = draftSettings(d);
    if (s.provider === "compatible") { const bad = providers.checkBaseUrl(s.baseUrl); if (bad) throw bad; }
    const origin = providers.originFor(s);
    const list = await providers.listModels(s, { fetch: (url, init) => {
      // A compatible address the user is just trying out may be called once.
      if (origin && new URL(url).origin === origin) return net.fetch(url, { ...init, credentials: "omit" });
      return guardedFetch(url, init);
    } });
    return { models: list.slice(0, 300) };
  });
  handle("profile-save", async (_e, d, key) => {
    const draft = d && typeof d === "object" ? d : {};
    const provider = str(draft.provider, 20);
    if (!providers.LIST.some((p) => p.id === provider)) throw Object.assign(new Error("Choose a provider first."), { kind: "other" });
    if (provider === "compatible") { const bad = providers.checkBaseUrl(draft.baseUrl); if (bad) throw bad; }
    if (!str(draft.model, 200).trim()) throw Object.assign(new Error("Pick or type a model first."), { kind: "other" });
    const isNew = !draft.id || !settings.profile(str(draft.id, 40));
    const k = str(key, 400).trim();
    if (isNew && provider !== "compatible" && !k) throw Object.assign(new Error("Paste your API key first."), { kind: "other" });
    if (k && !keys.available()) throw Object.assign(new Error("Pilot can't reach the macOS Keychain, so it won't save your key."), { kind: "keychain" });
    const label = str(draft.label, 40).trim() || providers.NAMES[provider] || "My key";
    const pid = settings.upsertProfile({ ...draft, id: str(draft.id, 40), label, provider });
    if (k) await keys.set(`profile:${pid}`, k);
    settings.set("activeProfile", pid);
    pushSettings();
    return { ok: true, id: pid };
  });
  handle("profile-remove", async (_e, pid) => {
    const id = str(pid, 40);
    await keys.remove(`profile:${id}`);
    settings.removeProfile(id);
    pushSettings();
    return { ok: true };
  });
  handle("profile-activate", (_e, pid) => {
    if (settings.profile(str(pid, 40))) settings.set("activeProfile", str(pid, 40));
    pushSettings();
    return { ok: true };
  });
  handle("media-models", async (_e, kind, d) => {
    if (kind !== "image" && kind !== "video") return { models: [] };
    const s = draftSettings({ ...d, kindKey: `media:${kind}`, id: d && d.id ? "x" : "" });
    if (s.provider === "anthropic") throw Object.assign(new Error("Anthropic doesn't make pictures or videos."), { kind: "other" });
    const origin = providers.originFor(s);
    const list = await media.listModels(kind, s, { fetch: (url, init) => {
      if (origin && new URL(url).origin === origin) return net.fetch(url, { ...init, credentials: "omit" });
      return guardedFetch(url, init);
    } });
    return { models: list.slice(0, 300) };
  });
  handle("media-key-save", async (_e, kind, d, key) => {
    if (kind !== "image" && kind !== "video") return {};
    const draft = d && typeof d === "object" ? d : {};
    const provider = str(draft.provider, 20);
    if (!["openai", "gemini", "compatible"].includes(provider)) throw Object.assign(new Error("Choose OpenAI, Google Gemini or a compatible API for this."), { kind: "other" });
    if (provider === "compatible") { const bad = providers.checkBaseUrl(draft.baseUrl); if (bad) throw bad; }
    if (!str(draft.model, 200).trim()) throw Object.assign(new Error("Pick or type a model first."), { kind: "other" });
    const k = str(key, 400).trim();
    const had = Boolean(settings.get("media")[kind]);
    if (!had && provider !== "compatible" && !k) throw Object.assign(new Error("Paste your API key first."), { kind: "other" });
    if (k) await keys.set(`media:${kind}`, k);
    const m = { ...settings.get("media"), [kind]: { provider, baseUrl: provider === "compatible" ? str(draft.baseUrl, 300).trim() : "",
      model: str(draft.model, 200).trim(), method: str(draft.method, 20) } };
    settings.set("media", m);
    pushSettings();
    return { ok: true };
  });
  handle("media-key-remove", async (_e, kind) => {
    if (kind !== "image" && kind !== "video") return {};
    await keys.remove(`media:${kind}`);
    settings.set("media", { ...settings.get("media"), [kind]: null });
    pushSettings();
    return { ok: true };
  });
  handle("memory-set", (_e, on) => { settings.set("memoryOn", Boolean(on)); pushSettings(); return { ok: true }; });
  handle("memory-remove", (_e, id) => { settings.removeMemory(str(id, 40)); pushSettings(); return { ok: true }; });
  handle("note-remove", (_e, id) => { settings.removeNote(str(id, 40)); pushSettings(); return { ok: true }; });
  handle("note-copy", (_e, id) => {
    const n = settings.get("notes").find((x) => x.id === str(id, 40));
    if (n) clipboard.writeText(n.text);
    return { ok: Boolean(n) };
  });
  handle("theme-set", (_e, t) => {
    if (["blue", "violet", "aurora"].includes(t)) settings.set("theme", t);
    pushSettings();
    return { ok: true };
  });
  handle("login-set", (_e, on) => { setLogin(Boolean(on)); return { ok: true }; });
  handle("screen-status", () => ({ status: shots.status(), explained: settings.get("screenExplained") }));
  handle("screen-open-settings", async () => {
    settings.set("screenExplained", true);
    screenHelp = false;
    await shots.openSettings();
    push();
    return { ok: true };
  });
  handle("screen-help-close", () => { screenHelp = false; settings.set("screenExplained", true); push(); return { ok: true }; });
  handle("welcome-done", () => { settings.set("welcomed", true); pushSettings(); return { ok: true }; });
  handle("app-about", () => app.showAboutPanel());
  handle("app-quit", () => app.quit());
}

// ---------------------------------------------------------------- safety for every window

function lockDown() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const ok = u.startsWith("pilot://app/") || u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("devtools:") || allowedOrigin(u);
    cb({ cancel: !ok });
  });
  protocol.handle("pilot", (request) => {
    const res = csp.serve(APP_DIR, request.url, compatibleOrigins());
    return new Response(res.status === 200 ? res.body : "", { status: res.status, headers: res.headers });
  });
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-navigate", (e) => e.preventDefault());
    contents.on("will-redirect", (e) => e.preventDefault());
    contents.on("will-attach-webview", (e) => e.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });
}

// ---------------------------------------------------------------- start

function appMenu() {
  // Pilot has no menu bar of its own, but the shortcuts (copy, paste, quit)
  // need one to exist.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Pilot", submenu: [{ label: "About Pilot", click: () => app.showAboutPanel() }, { type: "separator" },
      { label: "Hide Chat", accelerator: "Command+W", click: () => hideChat() },
      { label: "Quit Pilot", accelerator: "Command+Q", click: () => app.quit() }] },
    { role: "editMenu" },
  ]));
}

app.on("second-instance", () => { setHidden(false); showChat(); });
app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => { /* stays in the menu bar until Quit */ });

app.whenReady().then(async () => {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  settings = new Settings(dir);
  keys = new KeyStore(dir, safeStorage);
  await keys.init();
  shots = screenTools.make({ desktopCapturer, systemPreferences, shell, screen, platform: process.platform });

  app.setAboutPanelOptions({
    applicationName: "Pilot",
    applicationVersion: app.getVersion(),
    copyright: "MTRX Horizyn",
    credits: "Your AI copilot. Powered by you. Pilot uses your own AI key: your provider bills you directly, and MTRX never sees your key.",
  });

  if (MAC && app.dock) app.dock.hide();
  lockDown();
  appMenu();

  if (!settings.get("loginChosen") && !TEST) setLogin(true);

  engine = engineCore.create({
    store: {
      settings: () => ({ ...activeSettings(), noTools: Boolean((settings.profile() || {}).noTools) }),
      ready,
      memory: () => ({ on: settings.get("memoryOn"), notes: settings.get("memory") }),
      saveSettings: (patch) => {
        const p = settings.profile();
        if (p) { Object.assign(p, patch); settings.save(); }
      },
    },
    providers,
    host,
    fetch: guardedFetch,
    tools: () => desktopTools.make({
      clipboard,
      openExternal: (url) => shell.openExternal(url),
      notes: { add: (n) => { settings.addNote(n); pushSettings(); } },
      memory: { on: () => settings.get("memoryOn"), add: (t) => { settings.addMemory(t); pushSettings(); } },
      screen: { capture: takeShot },
      media: { has: (kind) => Boolean(mediaSettings(kind)), image: makeImage, video: makeVideo },
      providerName: () => providers.providerName(activeSettings()),
    }),
  });

  registerIpc();
  createTray();
  createRobot();
  createChat();
  // The first time, Pilot opens its chat with a short welcome.
  if (!settings.get("welcomed") && (!TEST || process.env.PILOT_TEST_WELCOME === "1")) {
    robotWin.once("ready-to-show", () => setTimeout(() => showChat(), 400));
  }

  if (TEST) {
    global.__pilotTest = {
      showChat, hideChat, engine, mediaItems,
      robot: () => robotWin, chat: () => chatWin, push,
      addCard: (c) => addCard(c),
      setLooking: (v) => { looking = v; push(); },
      seed: (list) => { for (const m of list) engine.attachRaw(m); push(); },
    };
  }
});
