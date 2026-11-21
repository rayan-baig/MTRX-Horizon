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
// Pilot for Mac 1.3: smoother. Spring easing with a little overshoot,
// anticipation before every take-off, squash and stretch on take-offs and
// landings, jumps and flights on real arcs (sampled, so the speed along
// them is right), a gentle bob and sway while travelling, and a walk whose
// step rhythm follows the travel speed so his feet don't slide. The plan
// builder here (track, with props) is also what tricks.js builds on.
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
  const TRICK_GAP = [60000, 120000]; // a trick or sport every minute or two
  const HOLD_MS = 2000; // how often a hold is checked again
  const MOST_MS = 30000; // a move never takes longer; the timer carries on after this
  const MAX_FADE = 160; // cross-fades between pose pictures, at most

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
  const FACING = { walk1: 1, walk2: 1, run1: 1, run2: 1, dash: 1, kick: 1, tennis: 1, slide: -1, surf: 1, ski: 1, snowboard: 1, kite: 1, sled: 1 };

  // ---------------------------------------------------------------- the Mac's extra poses

  // Pilot for Mac 1.3 has the owner's bigger pose sheet: these on top of the
  // shared core's poses (pilot-motion.js's POSES), each with what it falls
  // back to while its picture is missing (then the core's own fallbacks).
  const EXTRA = {
    catch: ["throw"], baseball: ["standing"], bowling: ["standing"], browse: ["point-screen", "standing"], cartwheel: ["flip"],
    confetti: ["celebrate"], "draw-smiley": ["point-screen", "standing"], fireworks: ["sparklers", "celebrate"], hang: ["climb1"],
    "heart-eyes": ["love"], juggle: ["standing"], kite: ["run1"], knock: ["standing"], laptop: ["sitting"], laugh: ["celebrate"],
    lounge: ["sitting"], magic: ["power"], meditate: ["sitting"], paint: ["point"], "paper-plane": ["throw"], "peek-door": ["standing"],
    "peek-window": ["standing"], "point-screen": ["point"], pumpkin: ["standing"], shiver: ["arms-crossed"], shy: ["arms-crossed"],
    trampoline: ["standing"], ski: ["land"], sled: ["sitting"], sneeze: ["standing"], snowball: ["land"], snowboard: ["ski", "land"],
    snowman: ["standing"], sparklers: ["celebrate"], spin: ["flip"], surf: ["standing"], teleport: ["power"], umbrella: ["standing"],
    yawn: ["standing"],
  };
  const ALL_POSES = M.POSES.concat(Object.keys(EXTRA));
  function poseSet(have) {
    if (have instanceof Set) return have;
    return new Set(Array.isArray(have) ? have : Object.keys(have || {}));
  }
  // The picture to show for a pose: itself, its fallbacks, then the core's rules.
  function resolvePose(name, have) {
    if (!EXTRA[name]) return M.resolvePose(name, have);
    const set = poseSet(have);
    if (set.has(name)) return name;
    for (const f of EXTRA[name]) {
      const p = resolvePose(f, set);
      if (p !== REST) return p;
    }
    return M.resolvePose("standing", set);
  }
  // Pose pictures from file names, the core's names and the extra ones (WebP wins).
  function posesFromFiles(files) {
    const out = {};
    for (const f of files || []) {
      const m = /^([a-z0-9-]+)\.(webp|png)$/.exec(String(f));
      if (!m || !ALL_POSES.includes(m[1])) continue;
      if (!out[m[1]] || m[2] === "webp") out[m[1]] = f;
    }
    return out;
  }
  const facing = (pose) => FACING[pose] || 0;
  const suits = (pose, dir) => !dir || facing(pose) === 0 || facing(pose) === dir;

  // ---------------------------------------------------------------- easing

  // A damped spring as a CSS linear() easing: it overshoots a little and
  // settles, all on the compositor. zeta: damping (lower: bouncier).
  function spring(zeta) {
    const z = zeta;
    const w = 6.4 / z; // settles by the end
    const wd = w * Math.sqrt(1 - z * z);
    const pts = [];
    for (let i = 0; i <= 32; i += 1) {
      const t = i / 32;
      const v = i === 32 ? 1 : 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
      pts.push(Math.round(v * 1000) / 1000);
    }
    return `linear(${pts.join(", ")})`;
  }
  // Where linear() isn't understood (an old engine), a cubic overshoot instead.
  const LINEAR_OK = !(typeof CSS !== "undefined" && CSS && typeof CSS.supports === "function")
    || CSS.supports("animation-timing-function", "linear(0, 0.5, 1)");
  const EASE = {
    ...M.EASE,
    pop: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    // Overshoot and settle: landings, pops, follow-through.
    spring: LINEAR_OK ? spring(0.42) : "cubic-bezier(0.34, 1.56, 0.64, 1)",
    springSoft: LINEAR_OK ? spring(0.62) : "cubic-bezier(0.3, 1.3, 0.6, 1)",
    // Anticipation: a little the other way first.
    anticipate: "cubic-bezier(0.36, 0, 0.66, -0.56)",
    // A throw's follow-through: past the mark and back.
    follow: "cubic-bezier(0.2, 0.9, 0.3, 1.12)",
    // Gravity: speeding up as it falls, slowing as it rises.
    fall: "cubic-bezier(0.55, 0.085, 0.68, 0.53)",
    rise: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round = (v) => Math.round(v * 10) / 10;
  const smooth = (u) => u * u * (3 - 2 * u); // ease in and out, for sampling paths

  // ---------------------------------------------------------------- building a plan

  // A plan builder: the robot's own keyframes (place, lean, squash), the
  // pose pictures, effects and props (drawn in SVG, alive only during the
  // move). Same shape as pilot-motion.js's plans, so pilot-actor.js plays it.
  function track(start, have, pose0) {
    const s = { x: start.x, y: start.y, r: 0, sx: 1, sy: 1 };
    const first = pose0 && pose0 !== REST ? resolvePose(pose0, have) : REST;
    const plan = { frames: [{ t: 0, ...s, e: EASE.soft }], poses: [{ t: 0, pose: first, fade: 0 }], head: [], eyes: [], fx: [], props: [], sounds: [] };
    const props = {};
    let t = 0;
    let pose = first;
    let dir = 0; // the way it's travelling now, for picking poses
    const ez = (e, d) => EASE[e] || e || d;
    const k = {
      get t() { return t; },
      get now() { return { ...s }; },
      get pose() { return pose; },
      get dir() { return dir; },
      has: (name) => resolvePose(name, have) === name,
      shows: (name) => resolvePose(name, have),
      heading(d) { dir = Math.sign(d || 0); return k; },
      to(ms, vals, ease) {
        t += Math.max(0, ms);
        Object.assign(s, vals);
        plan.frames.push({ t, ...s, e: ez(ease, EASE.soft) });
        return k;
      },
      set(vals) { return k.to(0, vals, "linear"); },
      wait(ms) { return k.to(ms, {}, "linear"); },
      // Show a pose (after fallbacks), unless it would face away from where
      // it's going: then the camera-facing standing picture instead.
      show(name, fade) {
        let p = resolvePose(name, have);
        if (!suits(p, dir)) p = resolvePose("standing", have);
        if (p !== pose) { plan.poses.push({ t, pose: p, fade: Math.min(MAX_FADE, fade || 0) }); pose = p; }
        return k;
      },
      // A sound cue (sounds.js makes it, if sounds are on and it's a good time).
      sound(kind, dt) { plan.sounds.push({ t: Math.max(0, Math.round(t + (dt || 0))), kind }); return k; },
      head(ms, r, y, ease) { plan.head.push({ t, ms, r, y: y || 0, e: ez(ease, EASE.soft) }); return k; },
      fx(kind, dx, dy, extra) { plan.fx.push({ t, kind, x: round(s.x + (dx || 0)), y: round(s.y + (dy || 0)), ...(extra || {}) }); return k; },
      fxAt(at, kind, x, y, extra) { plan.fx.push({ t: Math.max(0, Math.round(at)), kind, x: round(x), y: round(y), ...(extra || {}) }); return k; },
      // A prop that lives only during this move. on: "stage" (placed on the
      // screen) or "body" (held: moves with him, from the point between his feet).
      prop(id, kind, on) {
        props[id] = { id, kind, on: on || "stage", frames: [], last: { x: 0, y: 0, r: 0, sx: 1, sy: 1, o: 0 } };
        plan.props.push(props[id]);
        return k;
      },
      // A prop's place at an absolute time (props run alongside the robot).
      propAt(id, at, vals, ease) {
        const p = props[id];
        Object.assign(p.last, vals);
        p.frames.push({ t: Math.max(0, Math.round(at)), ...p.last, e: ez(ease, EASE.linear) });
        return k;
      },
      propLast: (id) => ({ ...props[id].last }),
      done(name) {
        plan.name = name;
        plan.duration = Math.max(1, t);
        plan.end = { x: round(s.x), y: round(s.y) };
        plan.endPose = pose;
        for (const p of plan.props) {
          p.frames.sort((a, b) => a.t - b.t);
          p.frames = p.frames.map((f) => ({ ...f, t: Math.min(f.t, plan.duration), x: round(f.x), y: round(f.y), r: round(f.r),
            sx: Math.round(f.sx * 100) / 100, sy: Math.round(f.sy * 100) / 100, o: Math.round(f.o * 100) / 100 }));
          delete p.last;
        }
        plan.fx = plan.fx.filter((f) => f.t <= plan.duration);
        plan.sounds = plan.sounds.filter((x) => x.t <= plan.duration);
        plan.frames = plan.frames.map((f) => ({ ...f, x: round(f.x), y: round(f.y), r: round(f.r),
          sx: Math.round(f.sx * 100) / 100, sy: Math.round(f.sy * 100) / 100 }));
        return plan;
      },
    };
    return k;
  }

  // Along a path, sampled so the speed along it is right: from where he is
  // through the points pts(u) for u in 0..1 over ms. extra(u) adds lean,
  // squash and the like. linear between samples (the samples carry the easing).
  function path(k, ms, at, n, extra, timing) {
    const steps = Math.max(2, Math.round(n));
    const time = timing || smooth;
    for (let i = 1; i <= steps; i += 1) {
      const u = time(i / steps);
      k.to(ms / steps, { ...at(u), ...(extra ? extra(u, i / steps) : {}) }, "linear");
    }
    return k;
  }

  // A ballistic hop to (x, y) peaking h above the higher end: x steady,
  // y on a parabola in time, a stretch going up and down, so it reads as
  // a real jump. spin: degrees turned on the way (in the direction of travel).
  function arc(k, ms, to, h, o) {
    const a = k.now;
    const opt = o || {};
    const top = Math.min(a.y, to.y) - h;
    // Solve for the parabola through a, top and to (in time).
    const ya = a.y - top;
    const yb = to.y - top;
    const tp = Math.sqrt(ya) / (Math.sqrt(ya) + Math.sqrt(yb) || 1);
    const n = Math.max(6, Math.round(ms / 55));
    const r0 = a.r;
    for (let i = 1; i <= n; i += 1) {
      const u = i / n;
      const y = u <= tp ? top + ya * Math.pow((tp - u) / (tp || 1), 2) : top + yb * Math.pow((u - tp) / ((1 - tp) || 1), 2);
      const speed = Math.abs(u - tp) * 2; // fast near the ends, still at the top
      const st = 1 + 0.08 * speed * (opt.stretch === undefined ? 1 : opt.stretch);
      k.to(ms / n, { x: a.x + (to.x - a.x) * u, y, r: opt.spin ? r0 + opt.spin * smooth(u) : (opt.r === undefined ? a.r : opt.r),
        sy: st, sx: 1 / Math.sqrt(st) }, "linear");
    }
    return k;
  }

  // A jump on the spot or to x: anticipation (a crouch that dips first),
  // take-off stretch, the arc, an impact squash and a springy settle.
  function jump(k, g, o) {
    const opt = o || {};
    const from = k.now;
    const to = { x: opt.x === undefined ? from.x : opt.x, y: opt.y === undefined ? from.y : opt.y };
    const h = opt.h === undefined ? g.u * 0.45 : opt.h;
    k.to(opt.crouch || 130, { sy: 0.84, sx: 1.1, r: 0 }, "anticipate");
    if (opt.pose) k.show(opt.pose, 70);
    arc(k, opt.ms || 520, to, h, { spin: opt.spin, stretch: 1 });
    if (opt.spin) k.set({ r: 0 });
    if (opt.land) k.show(opt.land, 60);
    k.to(80, { sy: 0.82, sx: 1.13, r: 0 }, "out");
    if (opt.dust !== false && Math.abs(to.y - g.floor) < 2) k.fx("dust", g.u * 0.1, 0, { dir: 1 }).fx("dust", -g.u * 0.1, 0, { dir: -1 });
    k.to(opt.settle || 380, { sy: 1, sx: 1 }, "spring");
    return k;
  }

  // A quick squash and a springy recovery (a beat, a landing on the spot).
  function squash(k, amt, ms) {
    const a = amt || 0.1;
    return k.to(90, { sy: 1 - a, sx: 1 + a * 0.6 }, "out").to(ms || 300, { sy: 1, sx: 1 }, "springSoft");
  }

  // Up from the resting design robot into the standing picture (a little
  // squash so it reads as getting up); already standing, nothing to do.
  function getUp(k) {
    if (k.pose !== REST) return k;
    if (!k.has("standing")) return k.to(140, { sy: 0.92, sx: 1.05 }, "soft").to(300, { sy: 1, sx: 1 }, "springSoft");
    return k.to(90, { sy: 0.9, sx: 1.06 }, "in").show("standing", 130).to(150, { sy: 1.04, sx: 0.98 }, "out").to(280, { sy: 1, sx: 1 }, "springSoft");
  }

  // Back down to the resting robot (when nothing comes next for a while).
  function sit(g, pose) {
    const k = track(g.pos, g.poses, pose);
    if (k.pose === REST) return null;
    k.to(110, { sy: 0.92, sx: 1.05, r: 0 }, "in").show(REST, 150).to(340, { sy: 1, sx: 1 }, "springSoft");
    return k.done("settle");
  }

  // How he walks, skips or runs: a stride (in robot widths) and a speed
  // (widths a second). The step rhythm comes from the two, so the faster he
  // goes the quicker his steps, and his feet don't slide.
  function gait(g, run, right) {
    const pace = g.pace || 1; // > 1 is slower (as in Pilot 1.2)
    const stride = run ? (right ? 0.44 : 0.36) : (right ? 0.27 : 0.23);
    const speed = (run ? (right ? 2.3 : 1.9) : (right ? 0.92 : 0.8)) / pace;
    return { stride: stride * Math.sqrt(1 / pace) * g.u, speed: speed * g.u };
  }

  // Along the floor to x. Going right: walk1 and standing in turn (or run1
  // strides), with a little forward lean; going left: a sideways skip facing
  // the camera. Each step is a smooth bob (up mid-step, a soft squash as
  // the foot lands), with a gentle sway of the head and halo, and the
  // pictures cross-fade at the footfall. Dust every other step.
  function steps(k, g, toX, run) {
    const dist = toX - k.now.x;
    if (Math.abs(dist) < 1) return k;
    const dir = Math.sign(dist);
    k.heading(dir);
    const right = dir > 0;
    const { stride, speed } = gait(g, run, right);
    const n = Math.max(1, Math.round(Math.abs(dist) / stride));
    const each = dist / n;
    const ms = (Math.abs(each) / speed) * 1000; // matches the speed, step by step
    const hop = g.u * (run ? 0.11 : right ? 0.055 : 0.085);
    const lean = dir * (run ? 8 : right ? 4 : 2.5);
    const sway = run ? 1 : 1.6;
    const fade = Math.min(80, Math.round(ms * 0.25)); // a quick cross-fade at the footfall: no pop, and cheap
    // Anticipation: a small push-off the other way first.
    k.to(run ? 110 : 90, { r: -dir * 1.5, sy: 0.95, sx: 1.03 }, "out");
    const sub = run ? 3 : 4;
    for (let i = 0; i < n; i += 1) {
      const a = i % 2 === 0;
      if (right) k.show(run ? (i === 0 ? "dash" : a ? "run1" : "run2") : (a ? "walk1" : "walk2"), i === 0 ? 90 : fade);
      else k.show("standing", 90);
      const x0 = k.now.x;
      const side = a ? 1 : -1;
      for (let j = 1; j <= sub; j += 1) {
        const u = j / sub;
        const up = Math.sin(Math.PI * u);
        const st = 0.965 + 0.06 * up;
        k.to(ms / sub, { x: x0 + each * u, y: g.floor - hop * up, r: lean + side * sway * up, sy: st, sx: 1.02 - 0.035 * up }, "linear");
      }
      if (i % 2 === 1 || i === n - 1) k.fx("dust", -dir * g.u * 0.12, 0, { dir });
    }
    // Follow-through: the lean swings a touch past upright and settles.
    k.heading(0).show("standing", 120).to(300, { r: 0, sx: 1, sy: 1 }, "spring");
    return k;
  }

  // A dash to the left that ends in a knee slide (the slide picture faces left).
  function slideLeft(k, g, toX) {
    const slide = Math.min(g.u * 1.4, Math.abs(toX - k.now.x) * 0.45);
    steps(k, g, toX + slide, true);
    if (!k.has("slide")) return steps(k, g, toX, false);
    k.heading(-1).to(70, { sy: 0.92, sx: 1.05 }, "out").show("slide", 70).to(500, { x: toX, y: g.floor, r: 0, sx: 1, sy: 1 }, "out")
      .fx("dust", g.u * 0.25, 0, { dir: 1 }).fx("dust", g.u * 0.05, 0, { dir: 1 });
    k.heading(0).wait(240).fx("sparkle", 0, -g.u * 1.2).show("standing", 120).to(90, { sy: 0.94, sx: 1.04 }, "out").to(300, { r: 0, sy: 1, sx: 1 }, "spring");
    return k;
  }

  // Land on the floor from just above it: straight down, falling faster
  // and faster (stretched a little), then the superhero landing with an
  // impact squash that springs back. Straight down, so it suits any way.
  function touchDown(k, g, x) {
    k.heading(0);
    const a = k.now;
    path(k, 320, (u) => ({ x: a.x + (x - a.x) * u, y: a.y + (g.floor - a.y) * u * u }), 5,
      (u) => ({ r: a.r * (1 - u), sy: 1 + 0.07 * u, sx: 1 - 0.04 * u }), (u) => u);
    if (k.has("land")) {
      k.show("land", 60).to(80, { sy: 0.8, sx: 1.14 }, "out").fx("dust", 0, 0, { dir: 1 }).fx("dust", -g.u * 0.3, 0, { dir: -1 })
        .fx("sparkle", g.u * 0.5, -g.u * 0.5);
      k.to(380, { sy: 1, sx: 1 }, "spring").wait(260).show("standing", 140).to(150, { sy: 1.04, sx: 0.98 }, "out").to(260, { sy: 1, sx: 1 }, "springSoft");
    } else {
      k.show("standing", 60).to(80, { sy: 0.82, sx: 1.12 }, "out").fx("dust", 0, 0).to(380, { sy: 1, sx: 1 }, "spring");
    }
    return k;
  }

  // Fly along a smooth curve to a point above dest, then come straight down
  // (floor: a superhero landing; in the air: hover there). A crouch first
  // (anticipation), a stretched take-off, the curve sampled finely with
  // ease in and out, banking into it with a gentle wobble of the head and
  // halo. The fly picture faces the camera. A few glow puffs.
  function flyTo(k, g, dest, hover) {
    getUp(k);
    const from = k.now;
    k.heading(0).to(150, { sy: 0.84, sx: 1.1, r: 0 }, "anticipate");
    k.show("fly", 90).to(220, { y: from.y - g.u * 0.38, sy: 1.12, sx: 0.92 }, "rise").fx("trail", 0, -g.u * 0.1);
    const a = k.now;
    const b = { x: dest.x, y: hover ? dest.y : dest.y - g.u * 0.9 };
    const dx = b.x - a.x;
    const dist = Math.hypot(dx, b.y - a.y);
    const lift = g.u * (0.4 + Math.min(1.2, dist / (g.u * 6))) * (0.7 + 0.6 * rnd(g));
    const cx = (a.x + b.x) / 2;
    const cy = Math.max(g.top, Math.min(a.y, b.y) - lift);
    const total = clamp(dist * 2.6, 900, 3000);
    const n = clamp(Math.round(total / 85), 10, 30);
    const dir = Math.sign(dx) || 1;
    k.heading(dir);
    let puffs = 0;
    path(k, total, (u) => ({
      x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * b.x,
      y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cy + u * u * b.y,
    }), n, (u, tt) => {
      if (Math.floor(tt * 3) > puffs) { puffs += 1; k.fx("trail", 0, -g.u * 0.1); }
      const st = 1 + 0.06 * (1 - Math.min(1, tt * 4)); // the take-off stretch eases out
      return { r: dir * 7 * Math.sin(u * Math.PI) + 1.5 * Math.sin(tt * total / 80), sy: st, sx: 1 / Math.sqrt(st) };
    });
    k.heading(0).to(220, { r: 0, sx: 1, sy: 1 }, "springSoft");
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
    climbUp(k, g, side, height);
    if (then === "fly") return flyTo(k, g, { x: flyX, y: g.floor }, false);
    return dropOff(k, g, side);
  }

  // Up the side edge (left: side -1) by height, rung by rung: a reach (out),
  // a pull (soft), a little sway, and a look around at the top.
  function climbUp(k, g, side, height) {
    const edge = side < 0 ? g.left : g.right;
    const stepH = g.u * 0.24;
    const n = Math.max(3, Math.round(height / stepH));
    if (Math.abs(edge - k.now.x) > g.u * 0.3) { getUp(k); steps(k, g, edge, Math.abs(edge - k.now.x) > (g.right - g.left) * 0.35); }
    getUp(k);
    k.heading(0);
    if (k.has("climb1")) {
      k.to(110, { sy: 0.9, sx: 1.05 }, "anticipate").show("climb1", 110).to(220, { x: edge + side * g.u * 0.05, y: k.now.y - stepH * 0.4, sy: 1.04, sx: 0.98 }, "rise");
      for (let i = 0; i < n; i += 1) {
        k.show(i % 2 ? "climb2" : "climb1");
        k.to(170, { y: k.now.y - stepH * 0.7, r: side * 3, sy: 1.04 }, "out");
        k.to(190, { y: k.now.y - stepH * 0.3, r: -side * 2, sy: 1 }, "soft");
      }
      k.wait(300).to(260, { r: side * -6 }, "springSoft").wait(280).to(260, { r: 0 }, "springSoft");
    } else {
      for (let i = 0; i < n; i += 1) {
        k.to(160, { y: k.now.y - stepH * 0.6, sy: 1.06, sx: 0.95 }, "out").to(190, { y: k.now.y - stepH * 0.4, sy: 0.96, sx: 1.03 }, "soft");
      }
      k.to(200, { sy: 1, sx: 1 }, "springSoft").wait(500);
    }
    return k;
  }

  // Push off the wall a little and fall straight down to a landing.
  function dropOff(k, g, side) {
    const edge = side < 0 ? g.left : g.right;
    k.show("standing", 100).to(110, { sy: 0.92, sx: 1.04 }, "anticipate")
      .to(200, { x: edge - side * g.u * 0.3, y: k.now.y - g.u * 0.14, r: -side * 4, sy: 1.06, sx: 0.96 }, "rise");
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
    k.to(260, { r: d * 5, sy: 0.96 }, "out").to(160, { y: g.floor - g.u * 0.06, sy: 1.03 }, "rise").to(160, { y: g.floor, sy: 0.97 }, "fall")
      .to(240, { sy: 1 }, "springSoft").wait(420).to(320, { r: 0 }, "springSoft");
    return k.done("look");
  }

  // A wave hello (the wave picture faces the camera), with a 👋 bubble.
  function hello(g, pose) {
    const k = track(g.pos, g.poses, pose);
    getUp(k);
    const y = g.pos.y;
    k.show("wave", 100).fx("bubble", 0, -g.u * 1.65, { text: "👋" });
    for (let i = 0; i < 2; i += 1) k.to(220, { r: 5, y: y - g.u * 0.05 }, "soft").to(220, { r: -4, y }, "soft");
    k.to(300, { r: 0 }, "springSoft").show("standing", 130).wait(80);
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
      fx: by(plan.fx), sounds: by(plan.sounds || []), props: plan.props.map((p) => ({ ...p, frames: by(p.frames) })) };
  }

  // One plan after another (b starts where a ends).
  function concat(a, b) {
    const s = shift(b, a.duration);
    return { ...s, name: b.name, frames: a.frames.concat(s.frames), poses: a.poses.concat(s.poses.filter((p, i) => i > 0 || p.pose !== a.endPose)),
      head: a.head.concat(s.head), eyes: a.eyes.concat(s.eyes), fx: a.fx.concat(s.fx), props: a.props.concat(s.props),
      sounds: (a.sounds || []).concat(s.sounds || []) };
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
    // The builder and the moves, for tricks.js.
    EXTRA, ALL_POSES, resolvePose, posesFromFiles, EASE, spring, track, path, arc, jump, squash, gait, getUp, steps, slideLeft, touchDown, flyTo, climbUp, dropOff, travelTo,
    floorSpot, atFloor, rnd,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PilotRoam = api;
})(typeof window !== "undefined" ? window : globalThis);
