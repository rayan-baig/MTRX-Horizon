// Pilot for Mac · roam.js: the robot's "Always moving" mode (the default).
// Desktop only: the web robot stays toned down (pilot-motion.js's own rules).
//
// In Always moving the robot is nearly always travelling: walking or running
// along the bottom of the screen, flying across to another spot with a
// superhero landing, or climbing a side edge and dropping or flying back
// down. Moves link into each other standing up, with short pauses of 1 to 4
// seconds, sometimes a quick look toward the mouse or a wave, and a trick or
// a sport about every couple of minutes. Destinations are random, in both
// directions, and keep away from the mouse.
//
// Facing. The pictures are never mirrored (the P on the chest would come out
// backwards). walk1 and run1 are drawn turned a little to the viewer's right
// and the knee slide to the left; the rest face the camera. So he only shows
// a pose that faces the way he's going, or the camera: going right he walks
// and runs; going left he skips sideways facing the camera, flies, or ends a
// dash in a knee slide. Landings come straight down, so they suit any way.
//
// The plans have the same shape as pilot-motion.js's (pilot-actor.js plays
// them on the compositor, no script per frame); pose pictures change only at
// a step, and cross-fades are capped short.
//
// Also here, with no DOM: the Energy levels (Calm, Relaxed, Always moving),
// which one applies, why the robot must hold still, and what comes next, for
// the main process's timer (src/main/life.js).
(function (root) {
  "use strict";

  const M = typeof module === "object" && module.exports ? require("./pilot-motion") : root.PilotMotion;
  const REST = M.REST;

  // ---------------------------------------------------------------- levels and timing

  // Calm: only idles. Relaxed: Pilot 1.1's gentle wandering. Always moving: the default.
  const LEVELS = ["calm", "relaxed", "always"];
  const LABELS = { calm: "Calm", relaxed: "Relaxed", always: "Always moving" };
  const DEFAULT_LEVEL = "always";
  const PAUSE = [1000, 4000]; // ms between moves
  const FILLER_PAUSE = [400, 1200]; // after a quick look or wave (they are the pause)
  const TRICK_GAP = [80000, 160000]; // a trick or sport about every couple of minutes
  const HOLD_MS = 2000; // how often a hold is checked again
  const MOST_MS = 30000; // a move never takes longer; the timer carries on after this
  const MAX_FADE = 120; // cross-fades between pose pictures, at most

  // The level that applies: the user's explicit choice wins; otherwise
  // "reduce motion" means Calm, and else the saved level (Always moving).
  function level(saved, chosen, reducedMotion) {
    const s = LEVELS.includes(saved) ? saved : DEFAULT_LEVEL;
    if (chosen) return s;
    return reducedMotion ? "calm" : s;
  }

  // Why he must hold still now in Always moving, or "". Typing elsewhere
  // doesn't count here (the owner wants him moving); it still does in Relaxed.
  function holdReason(c) {
    const x = c || {};
    if (x.hidden) return "hidden";
    if (x.dragging) return "dragging";
    if (x.level === "calm") return "calm";
    if (x.chatOpen) return "chat";
    if (x.userAway) return "away"; // the Mac is idle (2 minutes) or locked
    if (x.fullscreen) return "fullscreen";
    if (x.hovered) return "hovered"; // the pointer is on him: let the click land
    if (x.busy) return "busy";
    return "";
  }

  const pickIn = (range, r) => Math.round(range[0] + (range[1] - range[0]) * r());

  // Milliseconds of pause before the next move (shorter after a look or wave).
  function pause(random, afterFiller) {
    const r = typeof random === "function" ? random : Math.random;
    return pickIn(afterFiller ? FILLER_PAUSE : PAUSE, r);
  }

  function trickGap(random) { return pickIn(TRICK_GAP, typeof random === "function" ? random : Math.random); }

  // The next move: travel nearly always, sometimes a look or a wave, and a
  // trick when one is due. null while he must hold.
  function pick(c, random, o) {
    if (holdReason(c)) return null;
    const r = typeof random === "function" ? random : Math.random;
    if (o && o.trickDue) return "roam-trick";
    const roll = r();
    if (roll < 0.08) return "roam-look";
    if (roll < 0.12) return "roam-wave";
    return "roam";
  }

  // ---------------------------------------------------------------- facing

  // Which way each picture faces: 1 the viewer's right, -1 the left, 0 the camera.
  const FACING = { walk1: 1, walk2: 1, run1: 1, run2: 1, dash: 1, kick: 1, tennis: 1, slide: -1 };
  const facing = (pose) => FACING[pose] || 0;
  const suits = (pose, dir) => !dir || facing(pose) === 0 || facing(pose) === dir;

  // ---------------------------------------------------------------- building a plan

  const EASE = M.EASE;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round = (v) => Math.round(v * 10) / 10;

  function track(start, have, pose0) {
    const s = { x: start.x, y: start.y, r: 0, sx: 1, sy: 1 };
    const first = pose0 && pose0 !== REST ? M.resolvePose(pose0, have) : REST;
    const plan = { frames: [{ t: 0, ...s, e: EASE.soft }], poses: [{ t: 0, pose: first, fade: 0 }], head: [], eyes: [], fx: [], props: [] };
    let t = 0;
    let pose = first;
    let dir = 0; // the way it's travelling now, for picking poses
    const k = {
      get t() { return t; },
      get now() { return { ...s }; },
      get pose() { return pose; },
      has: (name) => M.resolvePose(name, have) === name,
      heading(d) { dir = Math.sign(d || 0); return k; },
      to(ms, vals, ease) {
        t += Math.max(0, ms);
        Object.assign(s, vals);
        plan.frames.push({ t, ...s, e: EASE[ease] || ease || EASE.soft });
        return k;
      },
      wait(ms) { return k.to(ms, {}, "linear"); },
      // Show a pose (after fallbacks), unless it would face away from where
      // it's going: then the camera-facing standing picture instead.
      show(name, fade) {
        let p = M.resolvePose(name, have);
        if (!suits(p, dir)) p = M.resolvePose("standing", have);
        if (p !== pose) { plan.poses.push({ t, pose: p, fade: Math.min(MAX_FADE, fade || 0) }); pose = p; }
        return k;
      },
      fx(kind, dx, dy, extra) { plan.fx.push({ t, kind, x: round(s.x + (dx || 0)), y: round(s.y + (dy || 0)), ...(extra || {}) }); return k; },
      done(name) {
        plan.name = name;
        plan.duration = Math.max(1, t);
        plan.end = { x: round(s.x), y: round(s.y) };
        plan.endPose = pose;
        plan.frames = plan.frames.map((f) => ({ ...f, x: round(f.x), y: round(f.y), r: round(f.r),
          sx: Math.round(f.sx * 100) / 100, sy: Math.round(f.sy * 100) / 100 }));
        return plan;
      },
    };
    return k;
  }

  // Up from the resting design robot into the standing picture (a little
  // squash so it reads as getting up); already standing, nothing to do.
  function getUp(k) {
    if (k.pose !== REST) return k;
    if (!k.has("standing")) return k.to(140, { sy: 0.92, sx: 1.05 }, "soft").to(140, { sy: 1, sx: 1 }, "out");
    return k.to(80, { sy: 0.9, sx: 1.06 }, "in").show("standing", 110).to(140, { sy: 1.03, sx: 0.98 }, "out").to(90, { sy: 1, sx: 1 }, "soft");
  }

  // Back down to the resting robot (when nothing comes next for a while).
  function sit(g, pose) {
    const k = track(g.pos, g.poses, pose);
    if (k.pose === REST) return null;
    k.to(100, { sy: 0.9, sx: 1.06 }, "in").show(REST, 110).to(170, { sy: 1.02, sx: 0.99 }, "out").to(90, { sy: 1, sx: 1 }, "soft");
    return k.done("settle");
  }

  // Along the floor to x. Going right: walk1 and standing in turn (or run1
  // strides); going left: a sideways skip facing the camera. Dust every
  // other step.
  function steps(k, g, toX, run) {
    const dist = toX - k.now.x;
    if (Math.abs(dist) < 1) return k;
    const dir = Math.sign(dist);
    k.heading(dir);
    const right = dir > 0;
    const len = g.u * (run ? (right ? 0.42 : 0.34) : (right ? 0.26 : 0.22));
    const n = Math.max(1, Math.round(Math.abs(dist) / len));
    const each = dist / n;
    const pace = g.pace || 1;
    const ms = (run ? 190 : 300) * pace;
    const hop = g.u * (run ? 0.12 : right ? 0.07 : 0.09);
    const lean = dir * (run ? 7 : right ? 4 : 3);
    for (let i = 0; i < n; i += 1) {
      const a = i % 2 === 0;
      if (right) k.show(run ? (i === 0 ? "dash" : a ? "run1" : "run2") : (a ? "walk1" : "walk2"));
      else k.show("standing");
      k.to(ms * 0.5, { x: k.now.x + each / 2, y: g.floor - hop, r: lean, sx: 0.98, sy: 1.04 }, "out");
      k.to(ms * 0.5, { x: k.now.x + each / 2, y: g.floor, sx: 1.04, sy: 0.95 }, "in");
      if (i % 2 === 1 || i === n - 1) k.fx("dust", -dir * g.u * 0.12, 0, { dir });
    }
    k.heading(0).show("standing").to(120, { r: 0, sx: 1, sy: 1 }, "out");
    return k;
  }

  // A dash to the left that ends in a knee slide (the slide picture faces left).
  function slideLeft(k, g, toX) {
    const slide = Math.min(g.u * 1.4, Math.abs(toX - k.now.x) * 0.45);
    steps(k, g, toX + slide, true);
    if (!k.has("slide")) return steps(k, g, toX, false);
    k.heading(-1).show("slide", 60).to(480, { x: toX, y: g.floor, r: 0, sx: 1, sy: 1 }, "out")
      .fx("dust", g.u * 0.25, 0, { dir: 1 }).fx("dust", g.u * 0.05, 0, { dir: 1 });
    k.heading(0).wait(260).fx("sparkle", 0, -g.u * 1.2).show("standing", 90).to(120, { r: 0 }, "out");
    return k;
  }

  // Land on the floor from just above it: straight down, so the superhero
  // landing suits any way it came from.
  function touchDown(k, g, x) {
    k.heading(0);
    k.to(300, { x, y: g.floor, r: 0, sx: 0.96, sy: 1.05 }, "in");
    if (k.has("land")) {
      k.show("land", 50).to(110, { sy: 0.88, sx: 1.08 }, "out").fx("dust", 0, 0, { dir: 1 }).fx("dust", -g.u * 0.3, 0, { dir: -1 })
        .fx("sparkle", g.u * 0.5, -g.u * 0.5);
      k.to(150, { sy: 1, sx: 1 }, "out").wait(380).show("standing", 100).to(120, { sy: 1.03 }, "out").to(90, { sy: 1 }, "soft");
    } else {
      k.show("standing").to(110, { sy: 0.88, sx: 1.08 }, "out").fx("dust", 0, 0).to(150, { sy: 1, sx: 1 }, "out");
    }
    return k;
  }

  // Fly along a soft arc to a point above dest, then come straight down
  // (floor: a superhero landing; in the air: hover there). The fly picture
  // faces the camera. A few glow puffs, not one per keyframe.
  function flyTo(k, g, dest, hover) {
    getUp(k);
    const from = k.now;
    k.heading(0).to(120, { sy: 0.88, sx: 1.08 }, "in");
    k.show("fly", 100).to(230, { y: from.y - g.u * 0.35, sy: 1.08, sx: 0.96 }, "out").fx("trail", 0, -g.u * 0.1);
    const a = k.now;
    const b = { x: dest.x, y: hover ? dest.y : dest.y - g.u * 0.9 };
    const dx = b.x - a.x;
    const dist = Math.hypot(dx, b.y - a.y);
    const lift = g.u * (0.4 + Math.min(1.2, dist / (g.u * 6))) * (0.7 + 0.6 * rnd(g));
    const cx = (a.x + b.x) / 2;
    const cy = Math.max(g.top, Math.min(a.y, b.y) - lift);
    const total = clamp(dist * 2.6, 900, 3000);
    const n = 6;
    const dir = Math.sign(dx) || 1;
    k.heading(dir);
    for (let i = 1; i <= n; i += 1) {
      const u = i / n;
      const x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * b.x;
      const y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cy + u * u * b.y;
      k.to(total / n, { x, y, r: dir * 6 * Math.sin(u * Math.PI), sx: 1, sy: 1 }, i === 1 ? "in" : i === n ? "out" : "linear");
      if (i % 2 === 0) k.fx("trail", 0, -g.u * 0.1);
    }
    k.heading(0).to(160, { r: 0 }, "soft");
    if (hover) {
      // A gentle bob in the air.
      k.to(420, { y: b.y - g.u * 0.06 }, "soft").to(420, { y: b.y }, "soft");
      return k;
    }
    return touchDown(k, g, dest.x);
  }

  // Up a side edge in small steps, a look around, then drop down or fly off
  // to somewhere else on the floor.
  function climbEdge(k, g, side, then, flyX) {
    const edge = side < 0 ? g.left : g.right;
    const room = g.floor - g.top - g.u * 1.6;
    const height = clamp((0.3 + 0.35 * rnd(g)) * (g.floor - g.top), g.u * 1.2, Math.max(g.u * 1.2, room));
    const stepH = g.u * 0.24;
    const n = Math.max(3, Math.round(height / stepH));
    if (Math.abs(edge - k.now.x) > g.u * 0.3) { getUp(k); steps(k, g, edge, Math.abs(edge - k.now.x) > (g.right - g.left) * 0.35); }
    getUp(k);
    k.heading(0);
    if (k.has("climb1")) {
      k.show("climb1", 100).to(150, { x: edge + side * g.u * 0.05, sy: 0.96 }, "soft");
      for (let i = 0; i < n; i += 1) {
        k.show(i % 2 ? "climb2" : "climb1");
        k.to(160, { y: k.now.y - stepH * 0.7, r: side * 3, sy: 1.04 }, "out");
        k.to(190, { y: k.now.y - stepH * 0.3, r: -side * 2, sy: 1 }, "soft");
      }
      k.wait(350).to(220, { r: side * -6 }, "soft").wait(300).to(200, { r: 0 }, "soft");
    } else {
      for (let i = 0; i < n; i += 1) {
        k.to(160, { y: k.now.y - stepH * 0.6, sy: 1.06, sx: 0.95 }, "out").to(190, { y: k.now.y - stepH * 0.4, sy: 0.96, sx: 1.03 }, "soft");
      }
      k.to(160, { sy: 1, sx: 1 }).wait(500);
    }
    if (then === "fly") return flyTo(k, g, { x: flyX, y: g.floor }, false);
    // Drop: push off the wall a little and fall straight down.
    k.show("standing").to(160, { x: edge - side * g.u * 0.3, y: k.now.y - g.u * 0.12, r: -side * 4 }, "out");
    return touchDown(k, g, edge - side * g.u * 0.3);
  }

  // ---------------------------------------------------------------- choosing where

  function rnd(g) { return typeof g.random === "function" ? g.random() : Math.random(); }
  const atFloor = (g, y) => Math.abs((y === undefined ? g.pos.y : y) - g.floor) < g.u * 0.08;

  // A spot on the floor at least `min` away, either side, clear of the mouse
  // (he never stops right where the pointer is).
  function floorSpot(g, min, max) {
    const span = g.right - g.left;
    const lo = Math.max(g.u * 1.2, min * span);
    const hi = Math.max(lo + g.u, (max || 1) * span);
    const clear = (x) => !g.pointer || g.pointer.y < g.floor - g.u * 2.6 || Math.abs(x - g.pointer.x) > g.u * 2.2;
    const away = (x) => Math.abs(x - g.pos.x) >= g.u;
    const sides = [-1, 1].filter((d) => (d < 0 ? g.pos.x - g.left : g.right - g.pos.x) >= lo);
    for (let i = 0; i < 12 && sides.length; i += 1) {
      const dir = sides[Math.floor(rnd(g) * sides.length) % sides.length];
      const x = clamp(g.pos.x + dir * (lo + (hi - lo) * rnd(g)), g.left, g.right);
      if (away(x) && clear(x)) return x;
    }
    // Anywhere on the floor a little way off and clear of the mouse.
    for (let i = 0; i < 16; i += 1) {
      const x = g.left + rnd(g) * span;
      if (away(x) && clear(x)) return x;
    }
    return g.pos.x - g.left > g.right - g.pos.x ? g.left + rnd(g) * span * 0.3 : g.right - rnd(g) * span * 0.3;
  }

  // Walk, skip or run to x (the way that suits the pictures).
  function travelTo(k, g, x) {
    const dist = x - k.now.x;
    const span = g.right - g.left;
    getUp(k);
    if (dist > 0) return steps(k, g, x, dist > span * 0.3 && rnd(g) < 0.6);
    if (-dist > g.u * 2.5 && rnd(g) < 0.35) return slideLeft(k, g, x);
    return steps(k, g, x, -dist > span * 0.3 && rnd(g) < 0.5);
  }

  // One leg of the journey from wherever it is now.
  function journey(g, pose) {
    const k = track(g.pos, g.poses, pose);
    const span = g.right - g.left;
    g.pace = 0.88 + 0.26 * rnd(g); // not every walk at the same speed
    if (!atFloor(g)) {
      // In the air (dropped there, or stopped mid-flight): down to the floor.
      if (g.floor - g.pos.y < g.u * 1.5) { getUp(k); touchDown(k, g, g.pos.x); return k.done("roam"); }
      flyTo(k, g, { x: floorSpot(g, 0.05, 0.5), y: g.floor }, false);
      return k.done("roam");
    }
    const roll = rnd(g);
    if (roll < 0.36) {
      // Walk somewhere near-ish, either way.
      travelTo(k, g, floorSpot(g, 0.08, 0.45));
      if (rnd(g) < 0.3) { k.wait(250 + 400 * rnd(g)); travelTo(k, g, floorSpot({ ...g, pos: k.now }, 0.06, 0.3)); }
    } else if (roll < 0.52) {
      // A longer run (right), or a dash and knee slide (left), or a flight.
      const x = floorSpot(g, 0.3, 0.9);
      if (x < k.now.x && rnd(g) < 0.4) flyTo(k, g, { x, y: g.floor }, false);
      else travelTo(k, g, x);
    } else if (roll < 0.8) {
      // Fly across, now and then by way of a hover somewhere in the air.
      if (rnd(g) < 0.25) {
        const hx = clamp(g.left + rnd(g) * span, g.left, g.right);
        const hy = g.top + g.u * 0.4 + (g.floor - g.top - g.u * 2.2) * rnd(g) * 0.7;
        flyTo(k, g, { x: hx, y: hy }, true);
        k.wait(300 + 500 * rnd(g));
        flyTo(k, g, { x: floorSpot({ ...g, pos: { x: hx, y: g.floor } }, 0.1, 0.6), y: g.floor }, false);
      } else flyTo(k, g, { x: floorSpot(g, 0.25, 0.95), y: g.floor }, false);
    } else {
      // Climb a side edge (either one), then drop or fly back down.
      const side = rnd(g) < 0.5 ? -1 : 1;
      const fly = rnd(g) < 0.5;
      const edge = side < 0 ? g.left : g.right;
      const flyX = floorSpot({ ...g, pos: { x: edge, y: g.floor } }, 0.2, 0.8);
      climbEdge(k, g, side, fly ? "fly" : "drop", flyX);
    }
    return k.done("roam");
  }

  // Just a walk (or a run) to x, standing at the end: for checks and pictures.
  function walkTo(g, x, pose, run) {
    const k = track(g.pos, g.poses, pose);
    getUp(k);
    steps(k, g, clamp(x, g.left, g.right), Boolean(run));
    return k.done(run ? "run" : "walk");
  }

  // A quick look toward the mouse: a lean and a little bounce that way.
  function glance(g, pose) {
    const k = track(g.pos, g.poses, pose);
    getUp(k);
    const at = g.pointer;
    const d = at ? Math.sign(at.x - g.pos.x) || 1 : 1;
    k.to(260, { r: d * 5, sy: 0.96 }, "out").to(160, { y: g.floor - g.u * 0.06, sy: 1.03 }, "out").to(160, { y: g.floor, sy: 1 }, "in")
      .wait(600).to(240, { r: 0 }, "soft");
    return k.done("look");
  }

  // A wave hello (the wave picture faces the camera), with a 👋 bubble.
  function hello(g, pose) {
    const k = track(g.pos, g.poses, pose);
    getUp(k);
    const y = g.pos.y;
    k.show("wave", 100).fx("bubble", 0, -g.u * 1.65, { text: "👋" });
    for (let i = 0; i < 2; i += 1) k.to(220, { r: 5, y: y - g.u * 0.05 }, "soft").to(220, { r: -4, y }, "soft");
    k.to(160, { r: 0 }, "soft").show("standing", 100).wait(120);
    return k.done("wave");
  }

  // The tricks and sports for Always moving, from where he is: football and
  // soccer only toward the right (the throw and kick pictures face right),
  // tennis only when its spot is to his right, the knee slide only with room
  // on his left. Played from pilot-motion.js except the knee slide.
  function trick(g, pose) {
    const span = g.right - g.left;
    const roomL = g.pos.x - g.left;
    const roomR = g.right - g.pos.x;
    const tennisSpot = g.right + g.u * 0.6 - g.u * 4.2;
    // (The backflip swings its feet out a little: not right by an edge.)
    const list = roomL > g.u && roomR > g.u ? ["backflip", "celebrate", "power"] : ["celebrate", "power"];
    if (atFloor(g)) {
      if (roomR >= roomL) list.push("football", "soccer");
      if (g.pos.x <= tennisSpot + g.u * 0.5) list.push("tennis");
      if (roomL > g.u * 3) list.push("slide");
    }
    const name = list[Math.floor(rnd(g) * list.length) % list.length];
    if (name === "slide") {
      const k = track(g.pos, g.poses, pose);
      getUp(k);
      slideLeft(k, g, clamp(g.pos.x - Math.min(span * 0.4, roomL * (0.5 + 0.4 * rnd(g))), g.left, g.right));
      if (k.has("celebrate")) k.show("celebrate", 90).to(160, { y: g.floor - g.u * 0.18 }, "out").to(160, { y: g.floor }, "in").show("standing", 90);
      return k.done("slide");
    }
    return fromPose(M.plan(name, { ...g, profile: "desktop" }), pose, g);
  }

  // ---------------------------------------------------------------- linking moves

  // Shift a plan later by ms (to put another in front of it).
  function shift(plan, ms) {
    const by = (a) => a.map((x) => ({ ...x, t: x.t + ms }));
    return { ...plan, duration: plan.duration + ms, frames: by(plan.frames), poses: by(plan.poses), head: by(plan.head), eyes: by(plan.eyes),
      fx: by(plan.fx), props: plan.props.map((p) => ({ ...p, frames: by(p.frames) })) };
  }

  // One plan after another (b starts where a ends).
  function concat(a, b) {
    const s = shift(b, a.duration);
    return { ...s, name: b.name, frames: a.frames.concat(s.frames), poses: a.poses.concat(s.poses.filter((p, i) => i > 0 || p.pose !== a.endPose)),
      head: a.head.concat(s.head), eyes: a.eyes.concat(s.eyes), fx: a.fx.concat(s.fx), props: a.props.concat(s.props) };
  }

  // A plan from pilot-motion.js starts from the resting robot. If he's
  // standing, carry on from that picture instead of popping back to rest:
  // when the plan gets up straight away, just start it from the standing
  // picture; otherwise sit down first, smoothly.
  function fromPose(plan, pose, g) {
    if (!plan || !pose || pose === REST || plan.poses[0].pose !== REST) return plan;
    if (plan.poses[1] && plan.poses[1].t <= 450) {
      return { ...plan, poses: [{ t: 0, pose, fade: 0 }].concat(plan.poses.slice(1)) };
    }
    const down = sit({ ...g, pos: { x: plan.frames[0].x, y: plan.frames[0].y } }, pose);
    return down ? concat(down, plan) : plan;
  }

  // A move for Always moving: "roam" (travel), "roam-look", "roam-wave" or
  // "roam-trick". g: pilot-motion.js's geometry (pos, floor, left, right,
  // top, u, poses, pointer, random); pose: the picture showing now.
  function plan(name, g, pose) {
    switch (name) {
      case "roam": return journey(g, pose);
      case "roam-look": return glance(g, pose);
      case "roam-wave": return hello(g, pose);
      case "roam-trick": return trick(g, pose);
      default: return null;
    }
  }

  const api = {
    LEVELS, LABELS, DEFAULT_LEVEL, PAUSE, FILLER_PAUSE, TRICK_GAP, HOLD_MS, MOST_MS, MAX_FADE, FACING,
    level, holdReason, pause, trickGap, pick, facing, suits, plan, walkTo, sit, fromPose, concat,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PilotRoam = api;
})(typeof window !== "undefined" ? window : globalThis);
