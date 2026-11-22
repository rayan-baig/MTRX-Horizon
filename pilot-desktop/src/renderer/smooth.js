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
// - poseClock() (1.5.1): while a move plays, which picture shows runs on the
//   same clock as where he is. The actor moves him with an animation (on
//   the compositor) but changes picture with timers, which can fire a frame
//   before or after the animation gets there; now that a walk's body moves
//   at the cut from one picture to the next, a frame of the new picture in
//   the old place (or the old in the new) would make his planted foot jump.
//   poseClock() shows and hides the plan's pictures with animations started
//   at exactly the actor's own start time, dissolves included.
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
  // opts: {sameCycle(a, b), reduced() → bool, ms, skip() → bool (1.5.1:
  // true while poseClock() is doing the changes)}
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
      if (!came || (o.skip && o.skip())) return;
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

  // The keyframes that show and hide each picture of a plan:
  // {name: [{offset, opacity, zIndex, easing}]}. A cut: the new picture is
  // there and the old one gone at the same instant. A dissolve: the new one
  // is fully there at once and the old one fades away on top of it over ms.
  function poseKeyframes(plan, o) {
    const opt = o || {};
    const ms = opt.ms || DISSOLVE_MS;
    const D = Math.max(1, plan.duration);
    const list = [];
    let before = null; // the picture showing as the move starts, if it changes at once
    for (const p of plan.poses.slice().sort((a, b) => a.t - b.t)) {
      if (list.length && list[list.length - 1].pose === p.pose) continue;
      if (list.length && list[list.length - 1].t === p.t) { const gone = list.pop(); if (gone.t === 0 && !before) before = gone.pose; }
      if (list.length && list[list.length - 1].pose === p.pose) continue;
      list.push({ t: Math.min(Math.max(0, p.t), D), pose: p.pose });
    }
    const off = (t) => Math.min(1, Math.max(0, t / D));
    const out = {};
    const kf = (name) => (out[name] = out[name] || [{ offset: 0, opacity: 0, zIndex: 0, easing: "linear" }]);
    const step = (name, t, opacity, zIndex, easing) => {
      const a = kf(name);
      const last = a[a.length - 1];
      a.push({ offset: off(t), opacity: last.opacity, zIndex: last.zIndex, easing: "linear" });
      a.push({ offset: off(t), opacity, zIndex, easing: easing || "linear" });
    };
    list.forEach((p, i) => {
      step(p.pose, p.t, 1, 1);
      const next = list[i + 1];
      if (!next) return;
      if (changeStyle(p.pose, next.pose, opt.sameCycle, opt.reduced) === "dissolve") {
        step(p.pose, next.t, 1, 2, "ease-in");
        const end = Math.min(D, next.t + ms);
        kf(p.pose).push({ offset: off(end), opacity: 0, zIndex: 2, easing: "linear" });
        step(p.pose, end, 0, 0);
      } else step(p.pose, next.t, 0, 0);
    });
    // The picture he showed as the move began dissolves away on top too
    // (the clock takes over the dissolver's fade, so it has to carry it on).
    if (before && list.length && before !== list[0].pose && changeStyle(before, list[0].pose, opt.sameCycle, opt.reduced) === "dissolve") {
      const end = Math.min(D, ms);
      const a = kf(before);
      a.splice(1, 0, { offset: 0, opacity: 1, zIndex: 2, easing: "ease-in" }, { offset: off(end), opacity: 0, zIndex: 2, easing: "linear" }, { offset: off(end), opacity: 0, zIndex: 0, easing: "linear" });
      a.sort((x, y) => x.offset - y.offset);
    }
    for (const a of Object.values(out)) {
      const last = a[a.length - 1];
      if (last.offset < 1) a.push({ ...last, offset: 1 });
      // (A keyframe's easing is for the stretch after it.)
      for (let i = a.length - 1; i > 0; i -= 1) if (a[i].offset === a[i - 1].offset && a[i].opacity === a[i - 1].opacity && a[i].zIndex === a[i - 1].zIndex) a.splice(i, 1);
    }
    return out;
  }

  // Plays a plan's pictures on the actor's clock. opts: {clock: the actor's
  // moving element (its first animation is the move), picture(name) → the
  // element showing that pose, sameCycle, reduced(), ms, frame(fn)}.
  // Returns {active, stop()}; active once it has caught the actor's start.
  function poseClock(plan, opts) {
    const o = opts || {};
    const W = (o.clock && o.clock.ownerDocument && o.clock.ownerDocument.defaultView) || root;
    const frame = o.frame || ((fn) => (W.requestAnimationFrame ? W.requestAnimationFrame(fn) : setTimeout(fn, 16)));
    const ctl = { active: false, stopped: false, anims: [], els: [], stop() {
      ctl.stopped = true;
      ctl.active = false;
      for (const a of ctl.anims) { try { a.cancel(); } catch (_) { /* gone */ } }
      for (const el of ctl.els) el.classList.remove("mac-sync");
      ctl.anims = [];
      ctl.els = [];
    } };
    if (!plan || !o.clock || !o.clock.getAnimations || !o.picture) return ctl;
    const frames = plan.poses.map((p) => p.pose);
    if (new Set(frames).size < 2) return ctl;
    let tries = 0;
    const start = () => {
      if (ctl.stopped) return;
      const lead = o.clock.getAnimations()[0];
      if (!lead) { tries += 1; if (tries < 60) frame(start); return; }
      Promise.resolve(lead.ready).then(() => {
        if (ctl.stopped || lead.playState === "idle" || lead.startTime === null) return;
        const keys = poseKeyframes(plan, { ms: o.ms, sameCycle: o.sameCycle, reduced: o.reduced && o.reduced() });
        for (const [name, kf] of Object.entries(keys)) {
          const el = o.picture(name);
          if (!el || !el.animate) continue;
          el.classList.add("mac-sync");
          ctl.els.push(el);
          const a = el.animate(kf, { duration: Math.max(1, plan.duration), fill: "forwards" });
          a.startTime = lead.startTime;
          ctl.anims.push(a);
        }
        ctl.active = ctl.anims.length > 0;
      }).catch(() => {});
    };
    start();
    return ctl;
  }

  const api = { DISSOLVE_MS, REPORT_MS, snap, refine, wantsMouse, changeStyle, dissolver, poseKeyframes, poseClock };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PilotSmooth = api;
})(typeof window !== "undefined" ? window : globalThis);
