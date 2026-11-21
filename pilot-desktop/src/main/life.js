// When the robot does something (the main process decides; the robot window
// plays it).
//
// Always moving (the default): he's nearly always travelling. As soon as
// the robot window says a move has ended, a short pause (1 to 4 seconds)
// and the next one: travel, now and then a quick look or a wave, and a
// trick every minute or two: one of the 80 new ones that fits the Mac's
// date and time (tricks.js), sometimes a classic (roam.js). He holds still
// while the chat is open, something is full screen in front, he's dragged
// or hidden, the pointer is on him, or the Mac is idle (2 minutes) or
// locked; then the hold is checked again every 2 seconds, and he waves when
// the user comes back. Typing elsewhere doesn't stop him in this mode.
//
// Relaxed (Pilot 1.1's behaviour) and Calm: every so often, at random, he
// may walk or run somewhere, fly, climb an edge, do a trick, wave or look
// around; most of the time he rests (Calm: only resting). The choice is
// pilot-motion.js's, shared with the web robot. Just before a move, the
// slower checks run once (is the user typing, is something full screen in
// front); if either says so, he keeps still.
//
// Nothing here runs between those moments: one timer waits for the next one.
"use strict";

const roamCore = require("../core/roam");
const tricksCore = require("../core/tricks");

// opts: {motion, roam, send(cmd), context() → {level, calm, reducedMotion,
// energy, chatOpen, hidden, dragging, busy, away, atFloor, userAway,
// hovered}, check(ctx) → Promise<{typing, fullscreen}>, back(seconds),
// random, now, timers: {setTimeout, clearTimeout}}
function create(opts) {
  const o = opts || {};
  const motion = o.motion;
  const roam = o.roam || roamCore;
  const tricks = o.tricks || tricksCore;
  const recent = []; // the last few tricks, not picked again soon
  const random = o.random || Math.random;
  const now = o.now || Date.now;
  const T = o.timers || { setTimeout, clearTimeout };
  let timer = null;
  let glance = null;
  let running = false;
  let lastSent = "";
  let lastTrick = now();
  let gap = roam.trickGap(random);
  let awaySince = 0;
  let lastReturn = -Infinity;

  const ctx = () => ({ profile: "desktop", ...(o.context ? o.context() : {}) });
  const always = (c) => c.level === "always";
  // What pilot-motion.js expects for Relaxed and Calm.
  const coreOf = (c) => {
    if (c.level === "calm") return { ...c, calm: true };
    if (c.level === "relaxed") return { ...c, calm: false, energy: "normal" };
    return c;
  };

  function after(ms) {
    if (timer) T.clearTimeout(timer);
    timer = null;
    if (running) timer = T.setTimeout(tick, ms);
  }

  // The wait before the next tick: in Always moving the robot window's
  // "move ended" (settled) normally comes first and starts the pause.
  function schedule() {
    const c = ctx();
    if (always(c)) after(lastSent ? roam.MOST_MS : roam.pause(random));
    else after(motion.nextDelay(coreOf(c), random));
  }

  // A glance toward the mouse now and then, even in calm mode (it's part of
  // resting), but not while typing, full screen, hidden or under reduce
  // motion. Always moving has its own looks, between moves.
  function scheduleGlance() {
    if (glance) T.clearTimeout(glance);
    glance = null;
    if (!running || always(ctx())) return;
    glance = T.setTimeout(async () => {
      const c = ctx();
      if (!c.hidden && !c.dragging && !c.busy && !c.reducedMotion && !c.typing && !c.fullscreen && !c.userAway && !c.chatOpen) {
        const more = o.check ? await o.check(c) : {};
        if (!more.typing && !more.fullscreen) o.send({ move: "look" });
      }
      scheduleGlance();
    }, Math.round((25 + 40 * random()) * 1000));
  }

  // Back at the Mac after it was idle or locked: a wave (or hearts, after a long time).
  function noticeAway(c) {
    if (c.userAway) { if (!awaySince) awaySince = now(); return false; }
    if (!awaySince) return false;
    const gone = (now() - awaySince) / 1000;
    awaySince = 0;
    if (o.back) o.back(gone);
    else react("return");
    return true;
  }

  async function tickAlways(c) {
    if (noticeAway(c)) { lastSent = "wave"; after(roam.MOST_MS); return "wave"; }
    if (roam.holdReason(c)) { lastSent = ""; after(roam.HOLD_MS); return null; }
    const more = o.check ? await o.check(c) : {};
    const c2 = { ...ctx(), fullscreen: Boolean(more.fullscreen) };
    if (!always(c2)) { lastSent = ""; schedule(); return null; }
    if (roam.holdReason(c2)) { lastSent = ""; after(roam.HOLD_MS); return null; }
    const name = roam.pick(c2, random, { trickDue: now() - lastTrick >= gap });
    if (!name) { lastSent = ""; after(roam.HOLD_MS); return null; }
    if (name === "roam-trick") {
      lastTrick = now();
      gap = roam.trickGap(random);
      // One of the 80 new tricks that fits today (season, time of day), now
      // and then a classic (roam.js picks that one).
      const trick = tricks.choose(new Date(now()), random, recent);
      if (trick) { recent.push(trick); if (recent.length > 12) recent.shift(); }
      o.send(trick ? { move: name, trick } : { move: name });
    } else o.send({ move: name });
    lastSent = name;
    // In case the robot window never says it ended (it was reloaded, say).
    after(roam.MOST_MS);
    return name;
  }

  // Returns the move it sent, or null.
  async function tick() {
    timer = null;
    const c = ctx();
    if (always(c)) return tickAlways(c);
    lastSent = "";
    try {
      const cc = coreOf(c);
      if (motion.stillReason(cc)) return null;
      const more = o.check ? await o.check(c) : {};
      const name = motion.pick({ ...cc, ...more }, random);
      if (name) o.send({ move: name });
      return name;
    } finally {
      schedule();
    }
  }

  // The robot window says a move has ended (any move: travel, a trick from
  // the menu, a wave). In Always moving: a short pause, then the next.
  function settled() {
    if (!running) return;
    const c = ctx();
    if (!always(c)) return;
    const filler = lastSent === "roam-look" || lastSent === "roam-wave" || lastSent === "wave";
    lastSent = "";
    after(roam.pause(random, filler));
  }

  // Something happened the robot may wave at: "return" (back after being
  // away) or "chat" (the chat opened). Returns how it waved, or null.
  function react(kind, extra) {
    const c = { ...coreOf(ctx()), ...(extra || {}) };
    // One wave for one return (unlocking and the idle check both notice it).
    if (kind === "return" && now() - lastReturn < 15000) return null;
    const how = motion.reaction(kind, { ...c, busy: false });
    if (how) {
      if (kind === "return") lastReturn = now();
      o.send({ move: "wave", how });
    }
    return how;
  }

  return {
    start() { running = true; lastSent = ""; schedule(); scheduleGlance(); },
    stop() { running = false; after(0); scheduleGlance(); },
    // Settings changed (energy, calm), the chat closed, shown again: start the wait again.
    restart() { if (running) { lastSent = ""; schedule(); scheduleGlance(); } },
    // Something may have changed sooner than the next check (the mouse came to rest near him).
    nudge() { if (running && always(ctx()) && !lastSent) after(0); },
    settled,
    tick,
    react,
    // Only for pictures and checks: the next move is a trick.
    trickNow() { lastTrick = -Infinity; },
    get waiting() { return Boolean(timer); },
    get running() { return running; },
  };
}

module.exports = { create };
