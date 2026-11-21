// Pilot's voice and sounds, the main process's part (Pilot for Mac 1.3).
//
// - Whether the Mac is muted (asked of macOS with osascript, at most every
//   15 seconds, arguments only, no shell), so Pilot neither speaks nor plays
//   a sound then.
// - The fallback voice: macOS's own `say`, used only if the window's Web
//   Speech voices aren't available. The voice name and the text go in as
//   arguments (never through a shell), the text capped.
// - The settings: Speak replies (off unless turned on), the voice, its
//   speed; Sounds (on, quietly), their volume, and quiet hours.
"use strict";

const SAY_MOST = 2000; // characters per `say`
const VOICE_NAME = /^[A-Za-z0-9 ()._'-]{1,60}$/;

// The `say` arguments for some text: never a shell, never an option from the text.
function sayArgs(text, voice, rate) {
  const words = String(text || "").replace(/\s+/g, " ").trim().slice(0, SAY_MOST);
  const args = [];
  if (voice && VOICE_NAME.test(voice)) args.push("-v", voice);
  const wpm = Math.round(175 * Math.max(0.7, Math.min(1.4, Number(rate) || 1)));
  args.push("-r", String(wpm), "--", words);
  return args;
}

// One `say` at a time; sentences wait their turn. deps: {spawn
// (child_process.spawn), mac, onDone()}.
function sayer(deps) {
  let child = null;
  let queue = [];
  function next() {
    const item = queue.shift();
    if (!item) { child = null; if (deps.onDone) deps.onDone(); return; }
    const args = sayArgs(item.text, item.voice, item.rate);
    child = deps.spawn("/usr/bin/say", args, { shell: false, stdio: "ignore" });
    const mine = child;
    const done = () => { if (child === mine) next(); };
    child.on("exit", done);
    child.on("error", done);
  }
  return {
    speak(text, voice, rate) {
      if (!deps.mac) return false;
      if (!sayArgs(text, voice, rate).pop()) return false;
      if (queue.length > 20) return false;
      queue.push({ text, voice, rate });
      if (!child) next();
      return true;
    },
    stop() {
      queue = [];
      if (child) { const c = child; child = null; try { c.kill(); } catch (_) { /* gone */ } }
    },
    get speaking() { return Boolean(child); },
  };
}

// Is the Mac muted? deps: {execFile, mac, now}. Cached for 15 s; false if unknown.
function muteWatch(deps) {
  let cache = { at: -Infinity, value: false };
  let asking = null;
  const now = deps.now || Date.now;
  function ask() {
    if (!deps.mac) return Promise.resolve(false);
    if (asking) return asking;
    asking = new Promise((resolve) => {
      deps.execFile("/usr/bin/osascript", ["-e", "output muted of (get volume settings)"], { timeout: 3000 }, (err, out) => {
        asking = null;
        const v = !err && String(out).trim() === "true";
        cache = { at: now(), value: v };
        resolve(v);
      });
    });
    return asking;
  }
  return {
    // The last answer (and ask again in the background when it's old).
    get muted() { if (now() - cache.at > 15000) ask().catch(() => {}); return cache.value; },
    ask,
  };
}

// The voice and sound settings, cleaned up.
const VOICE_DEFAULTS = { speak: false, voice: "", voiceRate: 1, sounds: true, soundVolume: 0.3, quietFrom: 21, quietTo: 7 };
function cleanVoice(v) {
  const x = { ...VOICE_DEFAULTS, ...(v && typeof v === "object" ? v : {}) };
  const hour = (h, d) => (Number.isInteger(h) && h >= 0 && h <= 23 ? h : d);
  return {
    speak: Boolean(x.speak),
    voice: typeof x.voice === "string" && (x.voice === "" || VOICE_NAME.test(x.voice)) ? x.voice : "",
    voiceRate: Math.max(0.7, Math.min(1.4, Number(x.voiceRate) || 1)),
    sounds: Boolean(x.sounds),
    soundVolume: Math.max(0, Math.min(1, Number.isFinite(Number(x.soundVolume)) ? Number(x.soundVolume) : 0.3)),
    quietFrom: hour(x.quietFrom, 21),
    quietTo: hour(x.quietTo, 7),
  };
}

module.exports = { SAY_MOST, VOICE_NAME, sayArgs, sayer, muteWatch, VOICE_DEFAULTS, cleanVoice };
