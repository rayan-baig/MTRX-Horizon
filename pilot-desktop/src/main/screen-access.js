// Screen access, as the user chose it in settings:
//   "off"   Pilot never looks; the eye button is hidden and the "look at the
//           screen" action isn't offered.
//   "ask"   only when the user asks: the eye button, or Allow on Pilot's
//           "look at the screen" card. The default.
//   "help"  "Help with what's on screen": a fresh screenshot goes with each
//           message the user sends. Still nothing between messages.
// The "Pilot is looking at your screen" banner shows every time.
"use strict";

const MODES = ["off", "ask", "help"];

const cleanMode = (m) => (MODES.includes(m) ? m : "ask");

// Does this message take a screenshot? look: the user asked for one now.
function wantsShot(mode, look) {
  const m = cleanMode(mode);
  if (m === "off") return false;
  return m === "help" || Boolean(look);
}

// What settings shows, from macOS's answer ("granted", "denied",
// "not-determined", "restricted", "unknown") and whether the user has opened
// System Settings for it in this run. macOS may only apply a new permission
// after Pilot restarts: then it offers "Relaunch Pilot".
function view(status, mode, openedThisRun) {
  const allowed = status === "granted";
  return {
    mode: cleanMode(mode),
    status,
    allowed,
    words: allowed ? "Allowed" : "Not allowed",
    eye: cleanMode(mode) !== "off",
    offerRelaunch: !allowed && Boolean(openedThisRun),
  };
}

// After the user opens System Settings, check now and then (for two
// minutes) whether it's been allowed, so Pilot notices without a restart.
function watch(opts) {
  const o = opts || {};
  const T = o.timers || { setTimeout, clearTimeout };
  const every = o.every || 2000;
  const until = Date.now() + (o.for || 120000);
  let timer = null;
  let last = o.status();
  const tick = () => {
    timer = null;
    const now = o.status();
    if (now !== last) { last = now; if (o.onChange) o.onChange(now); }
    if (now === "granted" || Date.now() > until) return;
    timer = T.setTimeout(tick, every);
  };
  timer = T.setTimeout(tick, every);
  return { stop() { if (timer) T.clearTimeout(timer); timer = null; } };
}

module.exports = { MODES, cleanMode, wantsShot, view, watch };
