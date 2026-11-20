// Pilot's two stores on the Mac, both in the app's own folder
// (~/Library/Application Support/Pilot):
//
//   settings.json  everything that isn't secret: the robot's home, calm
//                  mode and energy, the key
//                  list (names, providers, models; never the keys), notes,
//                  memory, colours, start-at-login.
//   keys.bin       the AI keys, encrypted with Electron's safeStorage, whose
//                  encryption key lives in the macOS Keychain. Without the
//                  Keychain, Pilot refuses to save a key rather than write it
//                  in plain text. Keys are never logged and never sent to a
//                  window; a window only learns a key's last four characters.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const NOTES_MOST = 200;
const MEMORY_MOST = 50;
const PROFILES_MOST = 12;

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const id = () => crypto.randomBytes(6).toString("hex");

// ---------------------------------------------------------------- keys

class KeyStore {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, "keys.bin");
    this.safe = safeStorage;
    this.cache = {};
    this.ok = false;
  }

  // Reads the saved keys once at start. Never throws: an unreadable file (for
  // example from another Mac user) just means no keys.
  async init() {
    try { this.ok = Boolean(this.safe && await this.safe.isAsyncEncryptionAvailable()); } catch (_) { this.ok = false; }
    this.cache = {};
    if (!this.ok || !fs.existsSync(this.file)) return;
    try {
      const out = await this.safe.decryptStringAsync(fs.readFileSync(this.file));
      const data = JSON.parse(out.result);
      if (data && typeof data === "object") this.cache = data;
      if (out.shouldReEncrypt) await this.save();
    } catch (_) {
      this.cache = {};
    }
  }

  available() { return this.ok; }

  async save() {
    if (!this.ok) {
      const e = new Error("Pilot can't reach the macOS Keychain, so it won't save your key. Try again after restarting your Mac.");
      e.kind = "keychain";
      throw e;
    }
    writeAtomic(this.file, await this.safe.encryptStringAsync(JSON.stringify(this.cache)));
  }

  async set(name, key) {
    const value = String(key || "").trim();
    if (!value) return;
    if (value.length > 400 || /\s/.test(value)) {
      const e = new Error("That key doesn't look right. Paste just the key, with no spaces.");
      e.kind = "key";
      throw e;
    }
    const before = this.cache[name];
    this.cache[name] = value;
    try { await this.save(); } catch (e) {
      if (before === undefined) delete this.cache[name]; else this.cache[name] = before;
      throw e;
    }
  }

  get(name) { return this.cache[name] || ""; }
  has(name) { return Boolean(this.cache[name]); }

  hint(name) {
    const k = this.get(name);
    return k ? `…${k.slice(-4)}` : "";
  }

  async remove(name) {
    if (!(name in this.cache)) return;
    delete this.cache[name];
    if (Object.keys(this.cache).length === 0) {
      try { fs.rmSync(this.file, { force: true }); } catch (_) { /* nothing to remove */ }
      return;
    }
    await this.save();
  }
}

// ---------------------------------------------------------------- settings

const DEFAULTS = () => ({
  version: 1,
  robot: null, // Pilot 1.0: the old robot window's spot (read once, for home)
  home: null, // the point between the robot's feet, in screen points
  calm: null, // calm mode: null follows "reduce motion"; true or false is the user's choice
  energy: "normal", // low, normal or playful
  profiles: [],
  activeProfile: "",
  media: { image: null, video: null },
  memoryOn: false,
  memory: [],
  notes: [],
  theme: "blue",
  openAtLogin: true,
  loginChosen: false,
  screenExplained: false,
  screenMode: "ask", // screen access: "off", "ask" (only when asked) or "help" (a screenshot with each message)
  welcomed: false,
});

class Settings {
  constructor(dir) {
    this.file = path.join(dir, "settings.json");
    this.data = DEFAULTS();
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (saved && typeof saved === "object") this.data = { ...DEFAULTS(), ...saved };
    } catch (_) { /* first run, or unreadable: defaults */ }
  }

  save() { writeAtomic(this.file, JSON.stringify(this.data, null, 2)); }

  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; this.save(); }

  profile(pid) { return this.data.profiles.find((p) => p.id === (pid || this.data.activeProfile)) || null; }

  upsertProfile(p) {
    const clean = {
      id: p.id && this.data.profiles.some((x) => x.id === p.id) ? p.id : id(),
      label: String(p.label || "").trim().slice(0, 40),
      provider: String(p.provider || ""),
      baseUrl: p.provider === "compatible" ? String(p.baseUrl || "").trim().slice(0, 300) : "",
      model: String(p.model || "").trim().slice(0, 200),
      maxTokens: Number(p.maxTokens) || 0,
    };
    const i = this.data.profiles.findIndex((x) => x.id === clean.id);
    if (i >= 0) this.data.profiles[i] = { ...this.data.profiles[i], ...clean, noTools: false };
    else {
      if (this.data.profiles.length >= PROFILES_MOST) throw Object.assign(new Error("That's a lot of keys. Remove one first."), { kind: "other" });
      this.data.profiles.push(clean);
    }
    if (!this.data.activeProfile || !this.profile()) this.data.activeProfile = clean.id;
    this.save();
    return clean.id;
  }

  removeProfile(pid) {
    this.data.profiles = this.data.profiles.filter((p) => p.id !== pid);
    if (this.data.activeProfile === pid) this.data.activeProfile = this.data.profiles[0] ? this.data.profiles[0].id : "";
    this.save();
  }

  addNote(n) {
    this.data.notes.unshift({ id: id(), title: String(n.title || "").slice(0, 120), text: String(n.text || "").slice(0, 4000), at: Date.now() });
    this.data.notes = this.data.notes.slice(0, NOTES_MOST);
    this.save();
  }

  removeNote(nid) { this.data.notes = this.data.notes.filter((n) => n.id !== nid); this.save(); }

  addMemory(text) {
    if (!this.data.memoryOn) return;
    this.data.memory.push({ id: id(), text: String(text || "").slice(0, 300), at: Date.now() });
    this.data.memory = this.data.memory.slice(-MEMORY_MOST);
    this.save();
  }

  removeMemory(mid) { this.data.memory = this.data.memory.filter((m) => m.id !== mid); this.save(); }
}

module.exports = { KeyStore, Settings, DEFAULTS };
