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
// Facing. A picture is never flipped on screen (the P on the chest would come
// out backwards). walk1 and run1 are drawn turned a little to the viewer's
// right and the knee slide to the left; the rest face the camera. Pilot for
// Mac 1.5 adds left-facing copies of the walk, run and climb pictures
// (tools/mirror_poses.py: mirrored, with the P put back the right way round),
// so he walks, runs and climbs facing the way he goes, either way. He only
// shows a pose that faces the way he's going, or the camera; he turns round
// standing (facing the camera), never mid-stride. Landings come straight
// down, so they suit any way.
//
// The plans have the same shape as pilot-motion.js's (pilot-actor.js plays
// them on the compositor, no script per frame); pose pictures change only at
// a step, and cross-fades are capped short.
//
// Pilot for Mac 1.3: smoother. Spring easing with a little overshoot,
// anticipation before every take-off, squash and stretch on take-offs and
// landings, jumps and flights on real arcs (sampled, so the speed along
// them is right). The plan builder here (track, with props) is also what
// tricks.js builds on.
//
// Pilot for Mac 1.5: he walks like a person. A steady rhythm of about 1.8
// steps a second (a run about 2.8), a stride that matches the gap between
// his feet in the pictures so his feet stay planted, a gentle start and
// stop (a short first and last step), a slight rise and dip over each step
// and a very slight sway from foot to foot, and no lean or squash while he
// walks, so the picture stays sharp. Flights are eased with a gentle bob.
// He climbs a side edge side-on, facing the wall, his hands and toes on the
// screen's edge, in reach-and-pull steps, and comes off it by climbing
// down, pushing off to a landing, or flying.
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
  const CADENCE = { walk: 1.8, run: 2.8 }; // steps a second
  const STRIDE = { walk: 0.3, run: 0.5 }; // robot widths a step (the gap between his feet in the pictures)
  // climb1's front edge (its hand and knee, measured on the picture) is this
  // many robot widths in front of the point between its feet.
  const CLIMB_REACH = 0.4;

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
  const FACING = { walk1: 1, walk2: 1, run1: 1, run2: 1, dash: 1, kick: 1, tennis: 1, slide: -1, surf: 1, ski: 1, snowboard: 1, kite: 1, sled: 1,
    climb1: 1, climb2: 1, "walk1-left": -1, "walk2-left": -1, "run1-left": -1, "run2-left": -1, "climb1-left": -1, "climb2-left": -1 };
  // The pictures of one walk, run or climb: a change between two of them is
  // a step, shown as a clean cut (like any drawn walk cycle); robot.js
  // dissolves every other change of picture.
  const CYCLES = [["walk1", "walk2", "run1", "run2", "dash"], ["walk1-left", "walk2-left", "run1-left", "run2-left"],
    ["climb1", "climb2"], ["climb1-left", "climb2-left"]];
  const sameCycle = (a, b) => a !== b && CYCLES.some((c) => c.includes(a) && c.includes(b));

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
    // Pilot for Mac 1.5: facing left (until a picture is there, the old way: facing the camera).
    "walk1-left": ["standing"], "walk2-left": ["walk1-left", "standing"], "run1-left": ["walk1-left", "standing"],
    "run2-left": ["run1-left", "walk2-left", "standing"], "climb1-left": ["climb1"], "climb2-left": ["climb1-left", "climb1"],
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
      get frames() { return plan.frames; },
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

  // How he walks or runs: a steady step rhythm (cadence, steps a second)
  // and a stride (pixels a step) that matches the pictures, so in each step
  // he covers one stride and his feet stay planted. pace > 1 is slower.
  function gait(g, run) {
    const pace = g.pace || 1;
    const cadence = (run ? CADENCE.run : CADENCE.walk) / Math.sqrt(pace);
    const stride = ((run ? STRIDE.run : STRIDE.walk) / Math.sqrt(pace)) * g.u;
    return { cadence, stride, speed: stride * cadence, stepMs: 1000 / cadence };
  }

  // The pictures for walking or running toward dir (1 right, -1 left).
  const strideNames = (run, dir) => {
    const l = dir < 0 ? "-left" : "";
    return run ? [`run1${l}`, `run2${l}`] : [`walk1${l}`, `walk2${l}`];
  };

  // Along the floor to x, the way a person walks (or runs): he sets off
  // gently (a short first step, speeding up), keeps a steady rhythm, and
  // slows into a short last step before standing still facing the camera.
  // The picture changes at each footfall, walk1 and walk2 in turn (a clean
  // cut, like any drawn walk), facing the way he goes. Over each step his
  // body rises a little and dips as the foot lands, moves a touch slower at
  // the top and quicker as the weight drops onto the front foot, and sways
  // very slightly from one foot to the other. The step time is fixed by the
  // rhythm and the distance per step is one stride, so his feet don't slide.
  // opts.carry: no slowing down at the end (the run goes straight into a
  // knee slide); he's still moving at full speed when this ends.
  function steps(k, g, toX, run, opts) {
    const dist = toX - k.now.x;
    if (Math.abs(dist) < 1) return k;
    const carry = Boolean(opts && opts.carry);
    const dir = Math.sign(dist);
    k.heading(dir);
    const { stride: nominal, stepMs } = gait(g, run);
    const n = Math.max(2, Math.round(Math.abs(dist) / nominal) + 1);
    const total = carry ? n - 0.5 : n - 1; // the first (and last) steps are half ones
    const stride = Math.abs(dist) / total;
    const [a, b] = strideNames(run, dir);
    const hop = g.u * (run ? 0.075 : 0.032);
    const sway = run ? 0.5 : 0.9; // degrees, from foot to foot
    const surge = run ? 0 : 0.06;
    const sub = 8;
    const x0 = k.now.x;
    const y0 = k.now.y;
    // Strides covered by step-time s (0..n): speeding up over the first
    // step from standing still (½ a stride), steady, slowing over the last.
    const ramp = (s) => s * s * s - (s * s * s * s) / 2;
    const along = (s) => {
      let d;
      if (s <= 1) d = n === 2 && !carry ? Math.min(ramp(s), 1 - ramp(2 - s)) : ramp(s);
      else if (!carry && s >= n - 1) d = total - ramp(n - s);
      else d = 0.5 + (s - 1);
      const w = Math.min(1, s, carry ? 1 : n - s); // the surge only once he's under way
      return d + (surge * w * Math.sin(2 * Math.PI * s)) / (2 * Math.PI);
    };
    const edgeStep = (i) => i === 0 || (!carry && i === n - 1);
    for (let i = 0; i < n; i += 1) {
      k.show(i % 2 === 0 ? a : b, 0);
      const amp = edgeStep(i) ? 0.55 : 1;
      const side = i % 2 ? -1 : 1;
      for (let j = 1; j <= sub; j += 1) {
        const f = j / sub;
        const up = run ? Math.sin(Math.PI * f) : (1 - Math.cos(2 * Math.PI * f)) / 2;
        k.to(stepMs / sub, { x: x0 + dir * stride * along(i + f), y: y0 - hop * amp * up, r: side * sway * amp * Math.sin(Math.PI * f), sx: 1, sy: 1 }, "linear");
      }
      if (run && i % 2 === 1) k.fx("dust", -dir * g.u * 0.12, 0, { dir });
    }
    if (carry) return k;
    // Standing, facing the camera: the weight settles.
    k.heading(0).show("standing", 120).to(run ? 220 : 160, { r: 0, sx: 1, sy: 1 }, "soft");
    return k;
  }

  // A dash to the left that ends in a knee slide (the slide picture faces left).
  // He runs straight into it (no stopping first), and the slide starts at
  // his running speed and slows to a stop.
  function slideLeft(k, g, toX) {
    if (!k.has("slide")) return steps(k, g, toX, true);
    const { speed } = gait(g, true);
    const slide = Math.min(g.u * 0.7, Math.abs(toX - k.now.x) * 0.45);
    const ms = clamp((2 * slide / speed) * 1000, 380, 900); // starts at the running speed
    steps(k, g, toX + slide, true, { carry: true });
    const x1 = k.now.x;
    k.heading(-1).show("slide", 60);
    path(k, ms, (u) => ({ x: x1 + (toX - x1) * u, y: g.floor }), 8, () => ({ r: 0, sx: 1, sy: 1 }), (u) => 1 - (1 - u) * (1 - u));
    k.fx("dust", g.u * 0.25, 0, { dir: 1 }).fx("dust", g.u * 0.05, 0, { dir: 1 });
    k.heading(0).wait(240).fx("sparkle", 0, -g.u * 1.2).show("standing", 120).to(90, { sy: 0.94, sx: 1.04 }, "out").to(300, { r: 0, sy: 1, sx: 1 }, "spring");
    return k;
  }

  // Land on the floor from just above it: straight down, falling faster
  // and faster (stretched a little), then the superhero landing with an
  // impact squash that springs back. Straight down, so it suits any way.
  function touchDown(k, g, x) {
    k.heading(0);
    const a = k.now;
    // (1.5: a longer fall takes longer, as it would: no dropping like a stone from high up.)
    const fall = clamp(200 + (g.floor - a.y) * 0.6, 320, 800);
    path(k, fall, (u) => ({ x: a.x + (x - a.x) * u, y: a.y + (g.floor - a.y) * u * u }), Math.max(5, Math.round(fall / 60)),
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
    const n = clamp(Math.round(total / 45), 16, 64);
    const dir = Math.sign(dx) || 1;
    k.heading(dir);
    let puffs = 0;
    // (1.5: a gentle bob along the way, about one a second, and a smaller
    // bank into the curve. g.bob: its height in robot widths, 0.05 unless set.)
    const bob = g.u * (Number.isFinite(g.bob) ? g.bob : 0.05);
    path(k, total, (u) => ({
      x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * b.x,
      y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cy + u * u * b.y,
    }), n, (u, tt) => {
      if (Math.floor(tt * 3) > puffs) { puffs += 1; k.fx("trail", 0, -g.u * 0.1); }
      const st = 1 + 0.06 * (1 - Math.min(1, tt * 4)); // the take-off stretch eases out
      return { r: dir * 4 * Math.sin(u * Math.PI), sy: st, sx: 1 / Math.sqrt(st) };
    });
    // The bob, added on top of the curve (none at either end).
    {
      const fr = k.frames;
      const from0 = fr.length - n;
      const t0 = fr[from0 - 1].t;
      for (let i = from0; i < fr.length; i += 1) {
        const tt = (fr[i].t - t0) / total;
        fr[i].y = Math.max(g.top, fr[i].y - bob * Math.sin(Math.PI * tt) * Math.sin((2 * Math.PI * (fr[i].t - t0)) / 1100));
      }
    }
    k.heading(0).to(220, { r: 0, sx: 1, sy: 1 }, "springSoft");
    if (hover) {
      // A gentle bob in the air.
      k.to(420, { y: b.y - g.u * 0.06 }, "soft").to(420, { y: b.y }, "soft");
      return k;
    }
    return touchDown(k, g, dest.x);
  }

  // The screen's side edges (robot.js passes them; else from left and right).
  function wallOf(g) { return g.wall || { left: g.left - g.u * 0.62, right: g.right + g.u * 0.62 }; }
  // Where he is while climbing a side edge (left: side -1): his hands and
  // toes right on the screen's edge.
  function wallX(g, side) {
    const w = wallOf(g);
    return side < 0 ? w.left + g.u * CLIMB_REACH : w.right - g.u * CLIMB_REACH;
  }
  // The climbing picture for that side, facing the wall (climb2 for the
  // other hand and foot when its picture is there, else climb1 again).
  const climbPose = (side, i) => (side < 0 ? (i % 2 ? "climb2-left" : "climb1-left") : (i % 2 ? "climb2" : "climb1"));
  const CLIMB_STEP = 0.22; // robot widths a climbing step

  // Up a side edge, a pause at the top, then down again: climbing back
  // down, pushing off to a landing, or flying off to somewhere on the floor.
  function climbEdge(k, g, side, then, flyX) {
    const room = g.floor - g.top - g.u * 1.6;
    const height = clamp((0.3 + 0.35 * rnd(g)) * (g.floor - g.top), g.u * 1.2, Math.max(g.u * 1.2, room));
    climbUp(k, g, side, height);
    if (then === "fly") return flyTo(k, g, { x: flyX, y: g.floor }, false);
    if (then === "down") return climbDown(k, g, side);
    return dropOff(k, g, side);
  }

  // Up the side edge (left: side -1) by height, the way a person climbs a
  // wall: side-on, facing it, hands and toes on the edge. He walks to the
  // foot of the wall, crouches, reaches up and steps on; then each step is
  // a reach (a little way up, quick) and a pull (the rest, slower), with a
  // short grip between and a slight shift of weight from one hand to the
  // other. He stays on the edge the whole way: no sliding sideways, no
  // floating off it.
  function climbUp(k, g, side, height) {
    const foot = side < 0 ? g.left : g.right;
    if (Math.abs(foot - k.now.x) > 2) { getUp(k); steps(k, g, foot, Math.abs(foot - k.now.x) > (g.right - g.left) * 0.35); }
    getUp(k);
    const x = wallX(g, side);
    const stepH = g.u * CLIMB_STEP;
    const n = Math.max(3, Math.round(height / stepH));
    // Onto the wall.
    k.heading(0).to(120, { sy: 0.95, sx: 1.02, r: 0 }, "out");
    k.heading(side).show(climbPose(side, 0), 110).to(300, { x, y: k.now.y - stepH * 0.6, sy: 1, sx: 1 }, "out");
    k.heading(0);
    for (let i = 1; i <= n; i += 1) {
      k.show(climbPose(side, i));
      const y = k.now.y;
      k.to(200, { x, y: y - stepH * 0.32, r: side * (i % 2 ? 0.8 : -0.8) }, "out"); // reach
      k.to(300, { x, y: y - stepH, r: 0 }, "soft"); // pull
      k.wait(70); // grip
    }
    k.wait(380);
    return k;
  }

  // Back down the way he went up, a little quicker (lower a hand, the feet
  // find the next hold), the last bit down to the floor, and a step back
  // from the wall, facing the camera again.
  function climbDown(k, g, side) {
    const x = k.now.x;
    const stepH = g.u * CLIMB_STEP;
    const low = g.floor - stepH * 0.6;
    const n = Math.max(1, Math.round((low - k.now.y) / stepH));
    const each = (low - k.now.y) / n;
    k.heading(0);
    for (let i = 1; i <= n; i += 1) {
      k.show(climbPose(side, i + 1));
      const y = k.now.y;
      k.to(170, { x, y: y + each * 0.6, r: side * (i % 2 ? -0.8 : 0.8) }, "in");
      k.to(230, { x, y: y + each, r: 0 }, "soft");
      k.wait(50);
    }
    k.to(220, { x, y: g.floor, sy: 0.96, sx: 1.02 }, "fall").show("standing", 120).to(260, { sy: 1, sx: 1 }, "springSoft");
    const foot = side < 0 ? g.left : g.right;
    return steps(k, g, foot - side * g.u * 0.2, false);
  }

  // A push against the wall, turned from it, and a fall to a landing.
  function dropOff(k, g, side) {
    const x0 = k.now.x;
    const out = clamp(x0 - side * g.u * 0.6, g.left, g.right);
    k.heading(0).to(120, { sy: 0.94, sx: 1.03, r: 0 }, "anticipate");
    k.heading(-side).show("standing", 90)
      .to(220, { x: x0 - side * g.u * 0.4, y: k.now.y - g.u * 0.12, r: -side * 3, sy: 1.04, sx: 0.98 }, "rise");
    return touchDown(k, g, out);
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

  // Walk or run to x (now and then, going left, a dash into a knee slide).
  function travelTo(k, g, x) {
    const dist = x - k.now.x;
    const span = g.right - g.left;
    getUp(k);
    if (dist < -g.u * 2.5 && rnd(g) < 0.2) return slideLeft(k, g, x);
    return steps(k, g, x, Math.abs(dist) > span * 0.3 && rnd(g) < 0.55);
  }

  // A pause to look around, standing: a slow shift of weight to one side
  // (toward the mouse, if it's about) and back, without tipping over.
  function lookAround(k, g, ms) {
    const d = g.pointer ? Math.sign(g.pointer.x - k.now.x) || 1 : rnd(g) < 0.5 ? -1 : 1;
    const x = k.now.x;
    k.heading(0).to(ms * 0.3, { x: x + d * 2, r: d * 1.2 }, "soft").wait(ms * 0.25).to(ms * 0.3, { x, r: 0 }, "soft").wait(ms * 0.15);
    return k;
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
      // Sometimes he stops on the way to look around, then walks on.
      travelTo(k, g, floorSpot(g, 0.08, 0.45));
      if (rnd(g) < 0.4) {
        if (rnd(g) < 0.6) lookAround(k, g, 900 + 900 * rnd(g)); else k.wait(400 + 600 * rnd(g));
        travelTo(k, g, floorSpot({ ...g, pos: k.now }, 0.06, 0.3));
      }
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
      // Climb a side edge (either one), then climb down, drop or fly back down.
      const side = rnd(g) < 0.5 ? -1 : 1;
      const r = rnd(g);
      const edge = side < 0 ? g.left : g.right;
      const flyX = floorSpot({ ...g, pos: { x: edge, y: g.floor } }, 0.2, 0.8);
      climbEdge(k, g, side, r < 0.3 ? "fly" : r < 0.65 ? "down" : "drop", flyX);
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

  // A quick look toward the mouse: a small lean and a little bounce that way.
  function glance(g, pose) {
    const k = track(g.pos, g.poses, pose);
    getUp(k);
    const at = g.pointer;
    const d = at ? Math.sign(at.x - g.pos.x) || 1 : 1;
    k.to(300, { r: d * 2.5, sy: 0.97 }, "soft").to(170, { y: g.floor - g.u * 0.05, sy: 1.02 }, "rise").to(170, { y: g.floor, sy: 0.98 }, "fall")
      .to(240, { sy: 1 }, "springSoft").wait(420).to(340, { r: 0 }, "soft");
    return k.done("look");
  }

  // A wave hello (the wave picture faces the camera), with a 👋 bubble.
  function hello(g, pose) {
    const k = track(g.pos, g.poses, pose);
    getUp(k);
    const y = g.pos.y;
    k.show("wave", 100).fx("bubble", 0, -g.u * 1.65, { text: "👋" });
    for (let i = 0; i < 2; i += 1) k.to(240, { r: 3, y: y - g.u * 0.04 }, "soft").to(240, { r: -2.5, y }, "soft");
    k.to(300, { r: 0 }, "soft").show("standing", 130).wait(80);
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

  // Pilot for Mac 1.5: the shared core's travelling moves (walk, run,
  // stroll, fly, climb, home, land: Relaxed mode picks them, and the menus
  // and Pilot's own actions can ask for them) are played the Mac's way too,
  // with the walk, flights and climbing here, so he moves the same in every
  // Energy level. null for any other move (pilot-motion.js plays it).
  function desktop(name, g, pose, o) {
    const opt = o || {};
    const k = track(g.pos, g.poses, pose);
    const span = g.right - g.left;
    g.pace = g.pace || 0.88 + 0.26 * rnd(g);
    const onFloor = atFloor(g);
    switch (name) {
      case "walk": case "run": {
        if (!onFloor) return null;
        getUp(k);
        steps(k, g, floorSpot(g, name === "run" ? 0.25 : 0.12, name === "run" ? 0.55 : 0.26), name === "run");
        return k.done(name);
      }
      case "stroll": {
        if (!onFloor) return null;
        const start = g.pos.x;
        const inward = g.pos.x - g.left > g.right - g.pos.x ? -1 : 1;
        getUp(k);
        steps(k, g, clamp(start + inward * (0.18 + 0.22 * rnd(g)) * span, g.left, g.right), false);
        lookAround(k, g, 900);
        steps(k, g, start, false);
        return k.done("stroll");
      }
      case "fly": {
        flyTo(k, g, { x: floorSpot(g, 0.2, 0.9), y: g.floor }, false);
        return k.done("fly");
      }
      case "land": {
        const x = clamp(g.pos.x + (g.pos.x - g.left > g.right - g.pos.x ? -1 : 1) * g.u * 3, g.left, g.right);
        flyTo(k, g, { x, y: g.floor }, false);
        return k.done("land");
      }
      case "climb": {
        if (!onFloor) return null;
        const side = opt.side || (g.pos.x - g.left < g.right - g.pos.x ? -1 : 1);
        climbEdge(k, g, side, rnd(g) < 0.5 ? "down" : "drop");
        return k.done("climb");
      }
      case "home": {
        const h = g.home;
        if (!h || Math.hypot(h.x - g.pos.x, h.y - g.pos.y) < g.u * 0.3) return null;
        getUp(k);
        if (onFloor && atFloor(g, h.y)) steps(k, g, clamp(h.x, g.left, g.right), Math.abs(h.x - g.pos.x) > span * 0.4);
        else flyTo(k, g, { x: clamp(h.x, g.left, g.right), y: h.y }, !atFloor(g, h.y));
        return k.done("home");
      }
      default: return null;
    }
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
    // Pilot for Mac 1.5: the walk's rhythm, the climbing spot and pictures, the cycles.
    CADENCE, STRIDE, CLIMB_REACH, CYCLES, sameCycle, strideNames, wallOf, wallX, climbPose, climbDown, climbEdge, lookAround, desktop,
    floorSpot, atFloor, rnd,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PilotRoam = api;
})(typeof window !== "undefined" ? window : globalThis);
