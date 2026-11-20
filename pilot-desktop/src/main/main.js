// Pilot for Mac: the main process.
//
// Two windows: the robot's overlay (transparent and click-through, over the
// work area of one display, always on top, on every Space and over
// full-screen apps; only the robot itself catches the mouse) and the chat
// window that opens next to the robot.
// Pilot lives in the menu bar (no Dock icon). The AI calls, the keys and the
// actions all stay here, in the main process; the windows only show things
// and pass the user's clicks back through a small preload API.
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, clipboard, dialog, nativeImage,
  safeStorage, desktopCapturer, systemPreferences, protocol, session, net, powerMonitor,
} = require("electron");

const providers = require("../core/providers");
const media = require("../core/media");
const engineCore = require("../core/engine");
const desktopTools = require("../core/desktop-tools");
const { KeyStore, Settings } = require("./store");
const csp = require("./csp");
const screenTools = require("./screen");
const overlay = require("./overlay");
const lifeCore = require("./life");
const frontmost = require("./frontmost");
const poseFiles = require("./poses");
const motion = require("../core/pilot-motion");
const screenAccess = require("./screen-access");
const uploads = require("./uploads");

const APP_DIR = path.join(__dirname, "..", "..");
const TEST = process.env.PILOT_TEST === "1";
const U = overlay.U; // the resting robot's width, in points
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
let screenOpened = false; // the user opened Screen Recording settings in this run
let screenWatch = null;
// Pictures and videos waiting to go with the next message:
// {id, kind: "image" | "frames" | "video", name, size, thumb, progress, ...}
const pending = [];
const uploadsOpen = new Map(); // upload id → {url, key, meta, item}
let pendingSeq = 0;
const screenMode = () => screenAccess.cleanMode(settings.get("screenMode"));
let lastState = null;
// The robot's overlay and where the robot is on it.
let overlayDisplay = null; // the display the overlay covers
let gate = null; // click-through
let robotAt = null; // {x, y, rect: {left, top, right, bottom}} in overlay points
let moving = false;
let reducedMotion = false;
let life = null;
let typingUntil = 0;
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
    calm: motion.isCalm({ calm: settings.get("calm"), reducedMotion }),
    reducedMotion,
    energy: settings.get("energy"),
    keychain: keys.available(),
    screenStatus: shots.status(),
    screen: screenAccess.view(shots.status(), screenMode(), screenOpened),
    screenMode: screenMode(),
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
    looking, ready: ready(), helpScreen: screenMode() === "help", screenMode: screenMode(), screenHelp,
    attachments: pending.map((a) => ({ id: a.id, kind: a.kind, name: a.name, size: a.size, thumb: a.thumb, progress: a.progress,
      note: a.note || "", count: a.images ? a.images.length : 0, error: a.error || "" })),
    cards: [...cards.entries()].map(([id, c]) => ({ id, type: c.type, label: c.label, labels: c.labels, step: c.step, progress: c.progress })),
    providerName: providers.providerName(activeSettings()),
  };
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send("pilot:state", view);
  pushRobot(s);
}

// What the robot window needs: its look, where home is, and how lively to be.
function pushRobot(state) {
  if (!robotWin || robotWin.isDestroyed() || !overlayDisplay) return;
  const a = overlayDisplay.workArea;
  const h = home();
  robotWin.webContents.send("pilot:robot", {
    status: robotStatus(state || lastState), theme: settings.get("theme"),
    area: { width: a.width, height: a.height }, home: { x: h.x - a.x, y: h.y - a.y },
    poses: poseFiles.list(path.join(APP_DIR, "assets", "poses")),
    calm: motion.isCalm({ calm: settings.get("calm"), reducedMotion }), reducedMotion,
    energy: settings.get("energy"), chatOpen: chatOpen(), test: TEST,
  });
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
  update: (state) => { chatActivity(); push(state); },
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
    const r = robotScreenRect();
    const shot = await shots.capture(r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null, hideOwnWindows);
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

// ---------------------------------------------------------------- screen access

function setScreenMode(mode) {
  settings.set("screenMode", screenAccess.cleanMode(mode));
  pushSettings();
  return { ok: true, mode: screenMode() };
}

// ---------------------------------------------------------------- dropped pictures and videos

function attachInfo() {
  const p = settings.profile();
  const provider = p ? p.provider : "";
  return { provider, providerName: providers.providerName(activeSettings()), ready: ready(), upload: provider === "gemini" && ready() };
}

const b64ok = (v, most) => typeof v === "string" && v.length > 0 && v.length <= most && /^[A-Za-z0-9+/=]+$/.test(v);
const thumbOk = (v) => (typeof v === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 400000 ? v : "");

function addPending(item) {
  const id = `a${(pendingSeq += 1)}`;
  pending.push({ ...item, id });
  if (pending.length > 12) pending.shift();
  push();
  return id;
}

// Everything waiting, for the message being sent (and cleared).
function takePending() {
  const out = { images: [], videos: [], notes: [], words: [] };
  const gemini = (settings.profile() || {}).provider === "gemini";
  for (const a of pending.splice(0)) {
    if (a.error) continue;
    if (a.kind === "image") out.images.push({ mime: a.mime, data: a.data, thumb: a.thumb });
    else if (a.kind === "frames") {
      out.images.push(...a.images.map((f) => ({ mime: f.mime, data: f.data, thumb: "" })));
      if (out.images[out.images.length - a.images.length]) out.images[out.images.length - a.images.length].thumb = a.thumb;
      out.notes.push(a.note);
      out.words.push(`The user attached a video, “${a.name}”, ${Math.round(a.duration)} seconds long. These are ${a.images.length} evenly spaced frames from it, in order.`);
    } else if (a.kind === "video" && a.uri && gemini) {
      out.videos.push({ mime: a.mime, uri: a.uri, name: a.name });
      out.words.push(`The user attached a video, “${a.name}”.`);
    }
  }
  push();
  return out;
}

function registerAttachIpc() {
  handle("attach-info", () => attachInfo());
  // A picture (already shrunk in the window) or frames from a video.
  handle("attach-add", (_e, item) => {
    const it = item && typeof item === "object" ? item : {};
    const name = str(it.name, 200) || "File";
    const size = Number.isFinite(it.size) ? it.size : 0;
    if (it.kind === "image") {
      if (!b64ok(it.data, 12e6) || it.mime !== "image/jpeg") return { error: "That picture couldn't be read." };
      return { id: addPending({ kind: "image", mime: "image/jpeg", data: it.data, thumb: thumbOk(it.thumb), name, size }) };
    }
    if (it.kind === "frames" && Array.isArray(it.images) && it.images.length) {
      const images = it.images.slice(0, 24).filter((f) => f && f.mime === "image/jpeg" && b64ok(f.data, 2e6)).map((f) => ({ mime: f.mime, data: f.data }));
      if (!images.length) return { error: "No frames could be read from that video." };
      return { id: addPending({ kind: "frames", images, thumb: thumbOk(it.thumb), name, size, duration: Number(it.duration) || 0,
        note: str(it.note, 200) }) };
    }
    return { error: "Pilot takes pictures and videos." };
  });
  handle("attach-remove", (_e, id) => {
    const i = pending.findIndex((a) => a.id === str(id, 20));
    if (i >= 0) {
      const [a] = pending.splice(i, 1);
      for (const [uid, u] of uploadsOpen) if (u.item === a) uploadsOpen.delete(uid);
    }
    push();
    return { ok: true };
  });
  // HEIC: macOS opens it, and it goes back as a JPEG for the window to shrink.
  handle("attach-heic", async (_e, bytes) => {
    if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) return { error: "That picture couldn't be read." };
    const tmp = path.join(app.getPath("temp"), `pilot-${process.pid}-${Date.now()}.heic`);
    try {
      fs.writeFileSync(tmp, Buffer.from(bytes));
      const img = nativeImage.createFromPath(tmp);
      if (img.isEmpty()) return { error: "This HEIC picture couldn't be opened." };
      const { width } = img.getSize();
      const out = width > 4096 ? img.resize({ width: 4096 }) : img;
      return { mime: "image/jpeg", data: out.toJPEG(90).toString("base64") };
    } finally { fs.rmSync(tmp, { force: true }); }
  });
  // A video for Gemini's file upload: started here, sent a piece at a time.
  handle("upload-start", async (_e, meta) => {
    const m = meta && typeof meta === "object" ? meta : {};
    const s = activeSettings();
    if (s.provider !== "gemini" || !s.key) return { error: "Video upload works with a Google Gemini key." };
    const info = { name: str(m.name, 200) || "Video", size: Number(m.size) || 0, mime: /^video\/[a-z0-9.+-]+$/i.test(m.mime) ? m.mime : "video/mp4" };
    const url = await uploads.start(guardedFetch, s.key, info);
    const item = { kind: "video", name: info.name, size: info.size, mime: info.mime, thumb: thumbOk(m.thumb), progress: 0 };
    const id = addPending(item);
    uploadsOpen.set(id, { url, key: s.key, meta: info, item: pending.find((a) => a.id === id) });
    return { id };
  });
  handle("upload-piece", async (_e, id, offset, bytes, last) => {
    const u = uploadsOpen.get(str(id, 20));
    if (!u) return { error: "That upload was cancelled." };
    if (!(bytes instanceof Uint8Array)) return { error: "That piece couldn't be read." };
    try {
      const file = await uploads.piece(guardedFetch, u.key, u.url, Number(offset) || 0, bytes, Boolean(last));
      u.item.progress = Math.min(0.99, ((Number(offset) || 0) + bytes.length) / Math.max(1, u.meta.size));
      push();
      if (last) {
        const done = await uploads.ready(guardedFetch, u.key, file);
        u.item.uri = done.uri;
        u.item.mime = done.mimeType || u.meta.mime;
        u.item.progress = 1;
        uploadsOpen.delete(str(id, 20));
        push();
      }
      return { ok: true };
    } catch (e) {
      u.item.error = e.message || "The upload stopped.";
      u.item.progress = 1;
      uploadsOpen.delete(str(id, 20));
      push();
      return { error: u.item.error };
    }
  });
  handle("attach-progress", (_e, id, done) => {
    const a = pending.find((x) => x.id === str(id, 20));
    if (a) { a.progress = Math.max(0, Math.min(1, Number(done) || 0)); push(); }
  });
  // Dropped on the robot: open the chat to show what's waiting.
  handle("attach-show", () => { setHidden(false); showChat(); });
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

// The robot's home: the point between its feet, in screen points. Wherever
// it's dropped becomes home.
function home() {
  let h = settings.get("home");
  if (!h || !Number.isFinite(h.x) || !Number.isFinite(h.y)) {
    h = overlay.homeFromLegacy(settings.get("robot"), U) || overlay.defaultHome(screen.getPrimaryDisplay().workArea, U);
  }
  const d = screen.getDisplayNearestPoint({ x: Math.round(h.x), y: Math.round(h.y) });
  return overlay.clampHome(h, d.workArea, U);
}

// The robot's box on screen (for the chat's place and screenshots).
function robotScreenRect() {
  if (!overlayDisplay) return null;
  const a = overlayDisplay.workArea;
  if (robotAt && robotAt.rect) {
    const r = robotAt.rect;
    return { x: Math.round(a.x + r.left), y: Math.round(a.y + r.top), width: Math.round(r.right - r.left), height: Math.round(r.bottom - r.top) };
  }
  const h = home();
  return { x: Math.round(h.x - U * 0.447), y: Math.round(h.y - U * 0.966), width: U, height: Math.round(U * 0.966) };
}

// The overlay covers the work area of the display the robot's home is on:
// never the menu bar or the Dock, so the robot can't sit over them.
function placeOverlay() {
  if (!robotWin || robotWin.isDestroyed()) return;
  const h = home();
  overlayDisplay = screen.getDisplayNearestPoint({ x: h.x, y: h.y });
  robotWin.setBounds({ ...overlayDisplay.workArea });
  pushRobot();
}

function createRobot() {
  const h = home();
  overlayDisplay = screen.getDisplayNearestPoint({ x: h.x, y: h.y });
  robotWin = new BrowserWindow({
    ...overlayDisplay.workArea,
    type: MAC ? "panel" : undefined,
    transparent: true, frame: false, resizable: false, movable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, minimizable: false, maximizable: false,
    focusable: false, // it never takes focus from the app the user is in
    acceptFirstMouse: true, show: false, title: "Pilot", backgroundColor: "#00000000",
    webPreferences: webPreferences(),
  });
  floatEverywhere(robotWin);
  gate = new overlay.MouseGate(robotWin);
  robotWin.loadURL("pilot://app/src/renderer/robot.html");
  robotWin.webContents.on("did-finish-load", () => pushRobot());
  robotWin.once("ready-to-show", () => { if (!hidden) robotWin.showInactive(); push(); });
  robotWin.on("closed", () => { robotWin = null; gate = null; });
}

function chatBounds() {
  const r = robotScreenRect();
  const display = r ? screen.getDisplayMatching(r) : screen.getPrimaryDisplay();
  const a = display.workArea;
  const height = Math.min(CHAT_SIZE.height, a.height - 16);
  const size = { width: CHAT_SIZE.width, height };
  if (!r) return { ...size, ...onScreen({ x: a.x + a.width - size.width - 20, y: a.y + 20 }, size) };
  // Beside the robot, never over it: the side with room, bottoms level.
  const right = r.x + r.width + 12 + size.width <= a.x + a.width;
  const x = right ? r.x + r.width + 12 : r.x - size.width - 12;
  const y = r.y + r.height - size.height + 20;
  return { ...size, ...onScreen({ x, y }, size) };
}

// The chat is an ordinary frameless window, not a non-activating panel: a
// menu-bar app's panel never becomes the key window, so typing went to the
// app in front (Pilot 1.0). It still floats over every app, on every Space
// and over full-screen apps (floatEverywhere).
function createChat() {
  chatWin = new BrowserWindow({
    ...chatBounds(),
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

// The app that was in front before the chat opened, so focus goes back to
// it when the chat closes (the robot never keeps focus).
let previousApp = null;

function showChatNow(view) {
  if (MAC) app.focus({ steal: true }); // the user clicked: Pilot comes forward
  chatWin.show();
  chatWin.focus();
  chatWin.webContents.focus();
  chatWin.webContents.send("pilot:focus", view || "chat");
}

function chatOpen() { return Boolean(chatWin && !chatWin.isDestroyed() && chatWin.isVisible()); }

function showChat(view) {
  if (!chatWin || chatWin.isDestroyed()) createChat();
  const was = chatOpen();
  chatWin.setBounds(chatBounds());
  const show = async () => {
    if (MAC && !was) {
      // Note the app in front first (a fraction of a second at most).
      const info = await Promise.race([frontmost.read(execFile, process.platform), wait(400).then(() => null)]);
      previousApp = info && info.pid !== process.pid ? info.pid : null;
    }
    showChatNow(view);
    if (view) chatWin.webContents.send("pilot:view", view);
    pushRobot();
    // The robot waves (gently) when the chat opens, then stays calm.
    if (!was && life) life.react("chat");
    if (!was) { waitedThisOpen = false; chatActivity(); }
  };
  if (chatWin.webContents.isLoading()) chatWin.webContents.once("did-finish-load", show);
  else show();
}

function hideChat() {
  const had = chatOpen() && chatWin.isFocused();
  if (chatWin && !chatWin.isDestroyed()) chatWin.hide();
  pushRobot();
  if (life) life.restart();
  // Give focus back to the app that was in front.
  if (MAC && had && previousApp) frontmost.activate(execFile, previousApp);
  previousApp = null;
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
  if (robotWin && !robotWin.isDestroyed()) robotWin.webContents.send("pilot:robot-show", !h);
  pushRobot();
  updateTray();
  if (life) life.restart();
}

// ---------------------------------------------------------------- the robot's moves

// Ask the robot window to play a move ({move, how}). A glance gets where the
// mouse is; anything that wanders gets the chat's box, to keep clear of it.
function sendMove(cmd) {
  if (!robotWin || robotWin.isDestroyed() || hidden || !overlayDisplay) return;
  const a = overlayDisplay.workArea;
  const c = screen.getCursorScreenPoint();
  robotWin.webContents.send("pilot:robot-do", { ...cmd, at: { x: c.x - a.x, y: c.y - a.y } });
}

const TRICKS = [["Backflip", "backflip"], ["Football", "football"], ["Soccer", "soccer"], ["Tennis", "tennis"], ["Wave", "wave"],
  ["Celebrate", "celebrate"], ["Knee Slide", "slide"], ["Point", "point"], ["Power Up", "power"], ["Superhero Landing", "land"],
  ["Love", "love"], ["Waiting", "wait"]];
const ANY_TRICK = ["backflip", "spin", "bounce", "peek", "football", "soccer", "tennis", "celebrate", "slide", "power", "land", "love"];

// "Play a trick", from the menus: the user asked, so it plays even in calm
// mode. The chat is closed first, so a prop never lands on it.
function playTrick(name) {
  const move = name || ANY_TRICK[Math.floor(Math.random() * ANY_TRICK.length)];
  const wasOpen = chatOpen();
  if (hidden) setHidden(false);
  if (wasOpen) hideChat();
  setTimeout(() => sendMove({ move }), wasOpen ? 250 : 0);
}

function trickItems() {
  return [
    { label: "Play a Trick", click: () => playTrick() },
    { label: "Trick", submenu: TRICKS.map(([label, move]) => ({ label, click: () => playTrick(move) })) },
  ];
}

// How lively the robot is right now, for life.js.
function lifeContext() {
  const a = overlayDisplay ? overlayDisplay.workArea : null;
  const h = home();
  const at = robotAt;
  const away = Boolean(a && at && Math.hypot(a.x + at.x - h.x, a.y + at.y - h.y) > 20);
  return {
    calm: settings.get("calm"), reducedMotion, energy: settings.get("energy"), chatOpen: chatOpen(),
    hidden, dragging: Boolean(gate && gate.dragging), busy: moving, away,
    atFloor: !a || !at ? true : at.y >= a.height - 8 - U * 0.1,
    typing: Date.now() < typingUntil,
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A cheer for something the user did ("done", "thanks", "missed"): a
// celebration or hearts, unless the robot must keep still.
function cheer(kind) {
  const move = motion.cheer(kind, { ...lifeContext(), calm: motion.isCalm({ calm: settings.get("calm"), reducedMotion }) || undefined });
  if (move) sendMove({ move });
  return move;
}

// The chat open with nothing happening for a while: a playful "waiting"
// (arms crossed, a little foot tap), once per opening.
let chatQuietSince = 0;
let waitedThisOpen = false;
function chatActivity() { chatQuietSince = Date.now(); }

// The slower checks, run only just before a move: typing elsewhere (keys
// in use but the pointer still), or a full-screen window in front.
async function lifeCheck() {
  const before = screen.getCursorScreenPoint();
  await wait(1200);
  const typing = overlay.typingGuess(powerMonitor.getSystemIdleTime(), before, screen.getCursorScreenPoint());
  const info = await frontmost.read(execFile, process.platform);
  const fullscreen = overlay.fullscreenFront(info, overlayDisplay, process.pid);
  return { typing: typing || Date.now() < typingUntil, fullscreen };
}

// A few times a second: is the cursor over the robot? (So a file dragged
// from Finder can be dropped on it; drags send the window no mouse moves.)
function watchCursor() {
  if (!gate || !overlayDisplay || hidden || !robotAt || !robotAt.rect) return;
  const c = screen.getCursorScreenPoint();
  const a = overlayDisplay.workArea;
  gate.set({ near: motion.hit(robotAt.rect, { x: c.x - a.x, y: c.y - a.y }, 6) });
}

// Every 10 seconds (in the main process only; the robot window sleeps):
// back after being away? typing?
let lastIdle = 0;
let lastCursor = null;
function watchUser() {
  const idle = powerMonitor.getSystemIdleTime();
  const cursor = screen.getCursorScreenPoint();
  // Back after being away: a wave, or (after half an hour or more) hearts.
  if (overlay.backFromIdle(lastIdle, idle)) {
    const long = lastIdle >= 1800;
    setTimeout(() => { if (!(long && cheer("missed")) && life) life.react("return"); }, 1200);
  }
  if (chatOpen() && !waitedThisOpen && !reducedMotion && !engine.busy && chatQuietSince && Date.now() - chatQuietSince > 150000) {
    waitedThisOpen = true;
    sendMove({ move: "wait" });
  }
  if (overlay.typingGuess(idle, lastCursor, cursor)) typingUntil = Date.now() + 15000;
  lastIdle = idle;
  lastCursor = cursor;
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

// Calm mode: no wandering, only resting. Under "reduce motion" it's on
// unless the user turns it off here.
function setCalm(on) {
  settings.set("calm", Boolean(on));
  updateTray();
  pushSettings();
  if (life) life.restart();
}

function setEnergy(level) {
  if (!motion.ENERGY.includes(level)) return;
  settings.set("energy", level);
  updateTray();
  pushSettings();
  if (life) life.restart();
}

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    hidden ? { label: "Show Pilot", click: () => setHidden(false) } : { label: "Hide Pilot", click: () => setHidden(true) },
    { label: "Open Chat", click: () => { setHidden(false); showChat(); } },
    { label: "Settings…", click: () => { setHidden(false); showChat("settings"); } },
    { type: "separator" },
    ...trickItems(),
    { label: "Calm Mode", type: "checkbox", checked: motion.isCalm({ calm: settings.get("calm"), reducedMotion }), click: (item) => setCalm(item.checked) },
    { label: "Energy", submenu: [["low", "Low"], ["normal", "Normal"], ["playful", "Playful"]].map(([v, label]) => ({
      label, type: "radio", checked: settings.get("energy") === v, click: () => setEnergy(v) })) },
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
  // The robot window says when the pointer is over the robot, so the overlay
  // takes the mouse only then (and while dragging).
  handle("robot-hover", (_e, over) => { if (gate) gate.set({ over: Boolean(over) }); });
  handle("robot-drag-start", () => { if (gate) gate.set({ dragging: true }); moving = false; });
  // Dropped: that spot becomes home. Dropped on another display, the overlay
  // moves there. Returns where the robot is now, in overlay points.
  handle("robot-drop", (_e, at) => {
    const p = at && typeof at === "object" ? at : {};
    const num = (v) => (Number.isFinite(v) ? v : 0);
    if (gate) gate.set({ dragging: false });
    if (!overlayDisplay) return null;
    const cursor = screen.getCursorScreenPoint();
    const there = screen.getDisplayNearestPoint(cursor);
    let h;
    if (there.id !== overlayDisplay.id) h = { x: cursor.x - num(p.ox), y: cursor.y - num(p.oy) };
    else h = { x: overlayDisplay.workArea.x + num(p.x), y: overlayDisplay.workArea.y + num(p.y) };
    h = overlay.clampHome(h, there.workArea, U);
    settings.set("home", h);
    if (there.id !== overlayDisplay.id) placeOverlay();
    const a = overlayDisplay.workArea;
    robotAt = { x: h.x - a.x, y: h.y - a.y, rect: null };
    pushRobot();
    if (chatOpen()) chatWin.setBounds(chatBounds());
    return { x: h.x - a.x, y: h.y - a.y };
  });
  // Where the robot is (after a move, a drop or a start) and whether it's moving.
  handle("robot-at", (_e, at) => {
    const p = at && typeof at === "object" ? at : {};
    const r = p.rect && typeof p.rect === "object" ? p.rect : null;
    const n = (v) => (Number.isFinite(v) ? v : 0);
    robotAt = { x: n(p.x), y: n(p.y), rect: r ? { left: n(r.left), top: n(r.top), right: n(r.right), bottom: n(r.bottom) } : null };
    moving = Boolean(p.moving);
  });
  handle("robot-env", (_e, env) => {
    const reduced = Boolean(env && env.reducedMotion);
    if (reduced !== reducedMotion) { reducedMotion = reduced; updateTray(); pushSettings(); if (life) life.restart(); }
  });
  handle("robot-click", () => toggleChat());
  // Right-click on the robot.
  handle("robot-menu", () => {
    Menu.buildFromTemplate([
      { label: "Open Chat", click: () => showChat() },
      { type: "separator" },
      ...trickItems(),
      { type: "separator" },
      { label: "Calm Mode", type: "checkbox", checked: motion.isCalm({ calm: settings.get("calm"), reducedMotion }), click: (item) => setCalm(item.checked) },
      { label: "Hide Pilot", click: () => setHidden(true) },
    ]).popup({ window: robotWin });
  });

  handle("chat-hide", () => hideChat());
  // A click in the chat while another app is in front: make it the key window.
  handle("chat-focus", () => { if (chatOpen() && !chatWin.isFocused()) showChatNow(); });
  handle("chat-send", async (_e, text, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    const words = str(text, 8000).trim();
    if (!words) return {};
    chatActivity();
    // Thanks in the chat: hearts (rarely seen, so it stays special).
    if (/\b(thanks|thank you|thank u|thx|ty|cheers)\b/i.test(words)) setTimeout(() => cheer("thanks"), 600);
    let images = [];
    if (screenAccess.wantsShot(screenMode(), o.look)) {
      if (!ready()) { engine.send(words); return {}; }
      const shot = await takeShot();
      if (shot.needPermission) return { needPermission: true };
      if (shot.error) { engine.note(shot.error, "error"); return {}; }
      images = [shot];
    }
    // Dropped pictures and videos go with this message.
    if (engine.busy) return {};
    if (pending.some((a) => a.progress !== undefined && a.progress < 1)) return { waiting: true };
    const sent = takePending();
    for (const n of sent.notes) engine.note(n);
    const said = sent.words.length ? `${words}\n\n(${sent.words.join(" ")})` : words;
    engine.send(said, { images: [...images, ...sent.images], videos: sent.videos, label: str(o.label, 200) || (sent.words.length ? words : undefined) });
    return {};
  });
  handle("chat-stop", () => engine.stop());
  handle("chat-clear", () => { engine.clear(); mediaItems.clear(); });
  handle("chat-answer", (_e, id, answer) => {
    const c = cards.get(str(id, 20));
    if (!c) return;
    const ok = c.type === "plan" ? ["all", "step", "cancel"].includes(answer) : typeof answer === "boolean";
    answerCard(str(id, 20), ok ? answer : (c.type === "plan" ? "cancel" : false));
    chatActivity();
    // Something the user allowed got done: a little celebration.
    if (ok && (answer === true || answer === "all")) setTimeout(() => cheer("done"), 1200);
  });
  handle("chat-help-screen", (_e, on) => setScreenMode(on ? "help" : "ask"));
  registerAttachIpc();
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
  handle("calm-set", (_e, on) => { setCalm(Boolean(on)); return { ok: true }; });
  handle("energy-set", (_e, level) => { setEnergy(str(level, 20)); return { ok: true }; });
  handle("screen-status", () => ({ status: shots.status(), explained: settings.get("screenExplained"), ...screenAccess.view(shots.status(), screenMode(), screenOpened) }));
  handle("screen-mode-set", (_e, mode) => setScreenMode(str(mode, 10)));
  // "Check again": macOS's answer now.
  handle("screen-check", () => { pushSettings(); return screenAccess.view(shots.status(), screenMode(), screenOpened); });
  handle("screen-open-settings", async () => {
    settings.set("screenExplained", true);
    screenHelp = false;
    screenOpened = true;
    await shots.openSettings();
    // Notice when it's allowed, without a restart (where macOS allows that).
    if (screenWatch) screenWatch.stop();
    screenWatch = screenAccess.watch({ status: () => shots.status(), onChange: () => pushSettings() });
    pushSettings();
    return { ok: true };
  });
  // macOS sometimes applies Screen Recording only after the app restarts.
  handle("app-relaunch", () => { app.relaunch(); app.exit(0); });
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
    // The standard Edit shortcuts (type, paste, copy, select all, undo) only
    // work in a menu-bar app if they're in its menu.
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" },
      { role: "paste" }, { role: "pasteAndMatchStyle" }, { role: "delete" }, { role: "selectAll" }] },
  ]));
}

app.on("second-instance", () => { setHidden(false); showChat(); });
app.on("before-quit", () => { quitting = true; });
// When another app comes forward, the robot stays where it is.
app.on("did-resign-active", () => {
  if (!hidden && robotWin && !robotWin.isDestroyed() && !robotWin.isVisible()) robotWin.showInactive();
});
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
      screen: screenMode() === "off" ? null : { capture: takeShot },
      media: { has: (kind) => Boolean(mediaSettings(kind)), image: makeImage, video: makeVideo },
      providerName: () => providers.providerName(activeSettings()),
    }),
  });

  try { reducedMotion = Boolean(systemPreferences.getAnimationSettings().prefersReducedMotion); } catch (_) { reducedMotion = false; }
  life = lifeCore.create({ motion, send: sendMove, context: lifeContext, check: lifeCheck });

  registerIpc();
  createTray();
  createRobot();
  createChat();
  life.start();
  setInterval(watchUser, 10000);
  // No AI key yet: the robot points up (toward the menu bar) once, a little after start.
  if (!TEST) setTimeout(() => { if (!ready() && !chatOpen() && !reducedMotion) sendMove({ move: "point", say: "🔑" }); }, 8000);
  setInterval(watchCursor, 300);
  if (powerMonitor) {
    for (const ev of ["unlock-screen", "resume"]) powerMonitor.on(ev, () => setTimeout(() => life && life.react("return"), 1500));
  }
  for (const ev of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(ev, () => placeOverlay());
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
      move: (cmd) => sendMove(cmd), playTrick, life: () => life, gate: () => gate, robotAt: () => robotAt,
      context: lifeContext, setCalm, setEnergy, home, cheer, addPending, pending: () => pending.slice(), setScreenMode, takePending,
    };
  }
});
