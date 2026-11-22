// Pilot for Mac 1.5: what keeps the robot sharp and smooth on screen, and
// clickable while he moves. robot.js uses it; the tests load it too.
//
// - refine(): every place in a move lands on the screen's own pixel grid
//   (half points on a Retina Mac), so the pictures are drawn 1:1 and don't
//   blur or shimmer when he stops; a squash that's really nothing is exactly
//   nothing; and the actor switches pictures at once (no half-and-half
//   fades), because the dissolver does the changing of pictures.
// - dissolver(): when the picture changes, the one going out dissolves away
//   ON TOP of the one coming in, which is already fully there. So he never
//   turns see-through mid-change, and two pictures never show at half
//   strength (the ghosting and flicker in 1.3 and 1.4, where both faded at
//   once). Steps of a walk, run or climb are clean cuts, like any drawn walk.
// - wantsMouse(): the overlay takes the mouse while the pointer is on the
//   robot, and keeps it from the moment the button goes down until it's let
//   go, even if he changes picture (and size) under the pointer meanwhile.
"use strict";

(function (root) {
  const DISSOLVE_MS = 140;
  // How often a moving robot tells the main process where it is (ms).
  const REPORT_MS = 50;

  const snap = (v, dpr) => {
    const d = dpr > 0 ? dpr : 1;
    return Math.round(v * d) / d;
  };
  const unit = (v) => (Math.abs(v - 1) < 0.004 ? 1 : v);

  // A plan ready to play (a copy; the plan itself is left alone).
  function refine(plan, dpr) {
    if (!plan) return plan;
    const frames = plan.frames.map((f) => ({ ...f, x: snap(f.x, dpr), y: snap(f.y, dpr), sx: unit(f.sx), sy: unit(f.sy), r: Math.abs(f.r) < 0.05 ? 0 : f.r }));
    const poses = plan.poses.map((p) => ({ ...p, fade: 0 }));
    const end = plan.end ? { x: snap(plan.end.x, dpr), y: snap(plan.end.y, dpr) } : plan.end;
    return { ...plan, frames, poses, end };
  }

  const hit = (rect, p, pad) => Boolean(rect && p) && p.x >= rect.left - pad && p.x <= rect.right + pad && p.y >= rect.top - pad && p.y <= rect.bottom + pad;

  // o: {rect (where he's drawn now), point (the pointer, or null), down, dragging, pad}
  function wantsMouse(o) {
    const x = o || {};
    if (x.down || x.dragging) return true;
    return hit(x.rect, x.point, x.pad === undefined ? 4 : x.pad);
  }

  // How a change of picture shows: "cut" (a step of one cycle, or reduce
  // motion) or "dissolve". sameCycle: roam.js's.
  function changeStyle(from, to, sameCycle, reduced) {
    if (reduced || !from || !to || from === to) return "cut";
    return sameCycle && sameCycle(from, to) ? "cut" : "dissolve";
  }

  // Watches the actor's pictures (inside stage) and dissolves each change.
  // opts: {sameCycle(a, b), reduced() → bool, ms}
  function dissolver(stage, opts) {
    const o = opts || {};
    const W = stage.ownerDocument.defaultView;
    const ms = o.ms || DISSOLVE_MS;
    const fading = new Map(); // picture → its dissolve
    const isPic = (el) => el.classList && (el.classList.contains("pa-pose") || el.classList.contains("pa-rest"));
    const isRest = (el) => el.classList.contains("pa-rest");
    const shownIn = (el, cls) => (isRest(el) ? !/(^|\s)pa-off(\s|$)/.test(cls) : /(^|\s)pa-on(\s|$)/.test(cls));
    const name = (el) => (isRest(el) ? "rest" : el.dataset.pose);
    let changes = 0;

    function out(el) {
      el.classList.add("mac-out");
      if (!el.animate) { el.classList.remove("mac-out"); return; }
      const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: "ease-in" });
      fading.set(el, a);
      const done = () => { if (fading.get(el) === a) { fading.delete(el); el.classList.remove("mac-out"); } };
      a.onfinish = done;
      a.oncancel = done;
    }

    const watch = new W.MutationObserver((list) => {
      const before = new Map();
      for (const m of list) if (isPic(m.target) && !before.has(m.target)) before.set(m.target, m.oldValue || "");
      let came = null;
      const went = [];
      for (const [el, was] of before) {
        const now = shownIn(el, el.className);
        if (now === shownIn(el, was)) continue;
        if (now) came = el; else went.push(el);
      }
      if (came && fading.has(came)) { const a = fading.get(came); fading.delete(came); came.classList.remove("mac-out"); a.cancel(); }
      if (!came) return;
      for (const el of went) {
        changes += 1;
        if (changeStyle(name(el), name(came), o.sameCycle, o.reduced && o.reduced()) === "dissolve") out(el);
      }
    });
    watch.observe(stage, { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    return {
      get fading() { return fading.size; },
      get changes() { return changes; },
      stop() { watch.disconnect(); for (const a of fading.values()) a.cancel(); },
    };
  }

  const api = { DISSOLVE_MS, REPORT_MS, snap, refine, wantsMouse, changeStyle, dissolver };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PilotSmooth = api;
})(typeof window !== "undefined" ? window : globalThis);
