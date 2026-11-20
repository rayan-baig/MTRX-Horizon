// The robot's overlay: one transparent window over the work area of the
// display where Pilot lives (never over the menu bar or the Dock), which
// lets every click through except on the robot itself.
//
// The window ignores the mouse, with mouse moves still forwarded to it
// (setIgnoreMouseEvents(true, { forward: true })), so the robot window can
// tell when the pointer comes over the robot. Then, and while the robot is
// being dragged, it takes the mouse; otherwise everything underneath gets it.
// A file dragged from Finder sends no mouse moves, so the main process also
// checks the cursor's place a few times a second (a cheap call): over the
// robot, the window takes the drop.
//
// Also here, without Electron, so they can be tested: where the robot's home
// is, and the guesses for "the user is typing", "something is full screen in
// front" and "the user is back after being away".
"use strict";

const U = 110; // the resting robot's width, in points

// Turns click-through on and off, calling the window only when it changes.
class MouseGate {
  constructor(win) {
    this.win = win;
    this.over = false; // the robot window saw the pointer over the robot
    this.near = false; // the main process saw the cursor over it (also during a file drag)
    this.dragging = false;
    this.ignoring = null;
    this.apply();
  }

  // Click-through, unless the pointer is over the robot or it's being dragged.
  wantIgnore() { return !(this.over || this.near || this.dragging); }

  set(patch) {
    for (const k of ["over", "near", "dragging"]) if (patch && k in patch) this[k] = Boolean(patch[k]);
    return this.apply();
  }

  apply() {
    const ignore = this.wantIgnore();
    if (ignore === this.ignoring) return false;
    this.ignoring = ignore;
    if (!this.win || (this.win.isDestroyed && this.win.isDestroyed())) return false;
    if (ignore) this.win.setIgnoreMouseEvents(true, { forward: true });
    else this.win.setIgnoreMouseEvents(false);
    return true;
  }
}

const finite = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);

// The robot's home is the point between its feet, in screen points.
function defaultHome(area, u) {
  const w = u || U;
  return { x: Math.round(area.x + area.width - 24 - w * 0.6), y: Math.round(area.y + area.height - 8) };
}

// Pilot 1.0 kept the top-left of its 140 x 150 robot window.
function homeFromLegacy(robot, u) {
  if (!finite(robot)) return null;
  const w = u || U;
  return { x: Math.round(robot.x + 15 + w * 0.447), y: Math.round(robot.y + 12 + w * 0.966) };
}

// Keep the whole robot inside the work area.
function clampHome(home, area, u) {
  const w = u || U;
  return {
    x: Math.round(Math.min(Math.max(home.x, area.x + w * 0.6), area.x + area.width - w * 0.6)),
    y: Math.round(Math.min(Math.max(home.y, area.y + w * 1.1), area.y + area.height - 4)),
  };
}

// Is the front app showing a window that covers the whole display (a video,
// a game, a presentation)? windows: [{pid, layer, x, y, w, h}] in points.
function fullscreenFront(info, display, ownPid) {
  if (!info || !Array.isArray(info.windows) || !display) return false;
  const b = display.bounds || display;
  return info.windows.some((w) => w && w.pid === info.pid && w.pid !== ownPid && (w.layer || 0) === 0
    && Math.abs(w.x - b.x) <= 2 && Math.abs(w.y - b.y) <= 2 && w.w >= b.width - 2 && w.h >= b.height - 2);
}

// Typing elsewhere: the keyboard or mouse was used in the last second or so,
// but the pointer hasn't moved.
function typingGuess(idleSeconds, before, after) {
  if (!Number.isFinite(idleSeconds) || !before || !after) return false;
  return idleSeconds <= 1 && before.x === after.x && before.y === after.y;
}

// Back after being away for a while (seconds of no keyboard or mouse).
function backFromIdle(previousIdle, idle, awayFor) {
  return Number.isFinite(previousIdle) && Number.isFinite(idle) && previousIdle >= (awayFor || 180) && idle < 5;
}

module.exports = { U, MouseGate, defaultHome, homeFromLegacy, clampHome, fullscreenFront, typingGuess, backFromIdle };
