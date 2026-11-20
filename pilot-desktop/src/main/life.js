// When the robot does something (the main process decides; the robot window
// plays it). Every so often, at random, it may walk or run somewhere, fly,
// climb an edge, do a trick, wave or look around; most of the time it rests.
// The choice itself is pilot-motion.js's, shared with the web robot.
//
// Nothing here runs between those moments: one timer waits for the next one.
// Just before a move, the slower checks run once (is the user typing, is
// something full screen in front); if either says so, the robot keeps still.
"use strict";

// opts: {motion, send(cmd), context() → {calm, reducedMotion, energy,
// chatOpen, hidden, dragging, busy, away, atFloor}, check() → Promise<{typing,
// fullscreen}>, random, timers: {setTimeout, clearTimeout}}
function create(opts) {
  const o = opts || {};
  const motion = o.motion;
  const random = o.random || Math.random;
  const T = o.timers || { setTimeout, clearTimeout };
  let timer = null;
  let glance = null;
  let running = false;

  const ctx = () => ({ profile: "desktop", ...(o.context ? o.context() : {}) });

  function schedule() {
    if (timer) T.clearTimeout(timer);
    timer = null;
    if (!running) return;
    timer = T.setTimeout(tick, motion.nextDelay(ctx(), random));
  }

  // A glance toward the mouse now and then, even in calm mode (it's part of
  // resting), but not while typing, full screen, hidden or under reduce motion.
  function scheduleGlance() {
    if (glance) T.clearTimeout(glance);
    glance = null;
    if (!running) return;
    glance = T.setTimeout(async () => {
      const c = ctx();
      if (!c.hidden && !c.dragging && !c.busy && !c.reducedMotion && !c.typing && !c.fullscreen) {
        const more = o.check ? await o.check() : {};
        if (!more.typing && !more.fullscreen) o.send({ move: "look" });
      }
      scheduleGlance();
    }, Math.round((25 + 40 * random()) * 1000));
  }

  // Returns the move it sent, or null.
  async function tick() {
    timer = null;
    try {
      if (motion.stillReason(ctx())) return null;
      const more = o.check ? await o.check() : {};
      const c = { ...ctx(), ...more };
      const name = motion.pick(c, random);
      if (name) o.send({ move: name });
      return name;
    } finally {
      schedule();
    }
  }

  // Something happened the robot may wave at: "return" (back after being
  // away) or "chat" (the chat opened). Returns how it waved, or null.
  function react(kind, extra) {
    const how = motion.reaction(kind, { ...ctx(), ...(extra || {}) });
    if (how) o.send({ move: "wave", how });
    return how;
  }

  return {
    start() { running = true; schedule(); scheduleGlance(); },
    stop() { running = false; schedule(); scheduleGlance(); },
    // Settings changed (energy, calm): start the wait again.
    restart() { if (running) schedule(); },
    tick,
    react,
    get waiting() { return Boolean(timer); },
  };
}

module.exports = { create };
