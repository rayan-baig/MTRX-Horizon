// Pilot for Mac 1.5: he walks like a person, moves smoothly, climbs a side
// edge the right way, stays sharp, and can always be clicked, even mid-walk.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const M = require("../../src/core/pilot-motion");
const R = require("../../src/core/roam");
const T = require("../../src/core/tricks");
const S = require("../../src/renderer/smooth");
const overlay = require("../../src/main/overlay");

const ROOT = path.join(__dirname, "..", "..");
const SHIPPED = Object.keys(R.posesFromFiles(fs.readdirSync(path.join(ROOT, "assets", "poses"))));
const seeded = (seed) => { let s = seed || 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const W = 1440;
const geo = (extra) => ({ pos: { x: 700, y: 892 }, floor: 892, left: 68.2, right: W - 68.2, top: 187, u: 110, poses: SHIPPED,
  random: seeded(3), profile: "desktop", sky: 540, wall: { left: 0, right: W }, ...(extra || {}) });
const at = (plan, t) => {
  const fr = plan.frames;
  let i = 1;
  while (i < fr.length - 1 && fr[i].t < t) i += 1;
  const a = fr[i - 1];
  const b = fr[i];
  const u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
};
const poseAt = (plan, t) => plan.poses.filter((p) => p.t <= t).pop().pose;

// A run of journeys, each starting where the last one ended.
function wander(n, seed) {
  const random = seeded(seed);
  const out = [];
  let pos = { x: 700, y: 892 };
  let pose = "standing";
  for (let i = 0; i < n; i += 1) {
    const name = i % 11 === 10 ? "roam-trick" : i % 9 === 4 ? "roam-look" : "roam";
    const g = geo({ pos, random, pointer: { x: random() * W, y: random() * 900 } });
    const plan = R.fromPose(R.plan(name, g, pose), pose, g);
    out.push({ plan, g });
    pos = plan.end;
    pose = plan.endPose;
  }
  return out;
}

// ---------------------------------------------------------------- walking

test("he walks like a person: a steady 1.6 to 2 steps a second, walk1 and walk2 in turn, facing the way he goes", () => {
  for (const [to, a, b] of [[1150, "walk1", "walk2"], [250, "walk1-left", "walk2-left"]]) {
    for (const pace of [0.88, 1, 1.14]) {
      const plan = R.walkTo(geo({ pace }), to, "standing");
      const stepsShown = plan.poses.filter((p) => p.pose === a || p.pose === b);
      assert.ok(stepsShown.length >= 6, `${stepsShown.length} steps`);
      for (let i = 1; i < stepsShown.length; i += 1) {
        assert.notEqual(stepsShown[i].pose, stepsShown[i - 1].pose, "the feet take turns");
        const rate = 1000 / (stepsShown[i].t - stepsShown[i - 1].t);
        assert.ok(rate >= 1.6 && rate <= 2, `${rate.toFixed(2)} steps a second`);
      }
      assert.equal(plan.endPose, "standing", "stands still at the end, facing the camera");
      assert.ok(!plan.poses.some((p) => p.pose === (a === "walk1" ? "walk1-left" : "walk1")), "never the picture facing the other way");
    }
  }
});

test("his feet stay planted: a step covers one stride, the stride the pictures show", () => {
  for (const run of [false, true]) {
    const g = geo();
    const gt = R.gait(g, run);
    const plan = R.walkTo(g, 1300, "standing", run);
    const names = R.strideNames(run, 1);
    const st = plan.poses.filter((p) => names.includes(p.pose));
    // The middle steps (not the gentle first and last ones).
    for (let i = 2; i < st.length - 1; i += 1) {
      const d = at(plan, st[i].t).x - at(plan, st[i - 1].t).x;
      assert.ok(Math.abs(d - gt.stride) < gt.stride * 0.15, `${run ? "run" : "walk"}: a step covers ${d.toFixed(1)}, the stride is ${gt.stride.toFixed(1)}`);
    }
    assert.ok(Math.abs(gt.stride / g.u - (run ? R.STRIDE.run : R.STRIDE.walk)) < 1e-9);
  }
});

test("a gentle start and stop: a short first and last step, speeding up and slowing down, no lurch anywhere", () => {
  const plan = R.walkTo(geo(), 1200, "standing");
  const st = plan.poses.filter((p) => p.pose === "walk1" || p.pose === "walk2");
  const end = plan.frames[plan.frames.length - 1].t;
  const stepLen = (i) => at(plan, (st[i + 1] ? st[i + 1].t : end)).x - at(plan, st[i].t).x;
  const mid = stepLen(3);
  assert.ok(stepLen(0) < mid * 0.7, `first step ${stepLen(0)} vs ${mid}`);
  // Speed from frame to frame: starts and ends near still, never jumps.
  const fr = plan.frames.filter((f, i, a) => i === 0 || f.t > a[i - 1].t);
  const v = [];
  for (let i = 1; i < fr.length; i += 1) v.push((fr[i].x - fr[i - 1].x) / ((fr[i].t - fr[i - 1].t) / 1000));
  const top = Math.max(...v);
  assert.ok(v[0] < top * 0.15, `sets off gently: ${v[0].toFixed(1)} of ${top.toFixed(1)} px/s`);
  const moving = v.filter((x) => x > 0.5);
  assert.ok(moving[moving.length - 1] < top * 0.2, "slows to a stop");
  for (let i = 1; i < v.length; i += 1) assert.ok(Math.abs(v[i] - v[i - 1]) < top * 0.25, `a lurch: ${v[i - 1].toFixed(1)} → ${v[i].toFixed(1)} px/s`);
});

test("a slight rise over each step and a dip as the foot lands; no lean, no squash, at most a hint of sway", () => {
  const g = geo();
  const plan = R.walkTo(g, 1200, "standing");
  const st = plan.poses.filter((p) => p.pose === "walk1" || p.pose === "walk2");
  for (let i = 2; i < st.length - 1; i += 1) {
    const land = at(plan, st[i].t).y;
    const midStep = at(plan, (st[i].t + st[i + 1].t) / 2).y;
    assert.ok(Math.abs(land - g.floor) < 0.01, "on the floor as the foot lands");
    assert.ok(g.floor - midStep > 2 && g.floor - midStep < 6, `rises ${(g.floor - midStep).toFixed(1)} px mid-step`);
  }
  for (const f of plan.frames) {
    assert.ok(Math.abs(f.r) <= 1, `lean ${f.r}`);
    assert.ok(f.sx === 1 && f.sy === 1, "no squash while walking (the picture stays sharp)");
  }
  assert.ok(plan.frames.some((f) => Math.abs(f.r) > 0.3), "a hint of sway from foot to foot");
});

test("he turns round standing (facing the camera), never from one stride straight into the other way", () => {
  let turns = 0;
  for (const { plan } of wander(250, 9)) {
    for (let i = 1; i < plan.poses.length; i += 1) {
      const a = R.facing(plan.poses[i - 1].pose);
      const b = R.facing(plan.poses[i].pose);
      assert.ok(!(a && b && a !== b), `${plan.name}: ${plan.poses[i - 1].pose} straight to ${plan.poses[i].pose}`);
      if (R.facing(plan.poses[i].pose) === -1 && /^(walk|run)/.test(plan.poses[i].pose)) turns += 1;
    }
  }
  assert.ok(turns > 50, "he really walks and runs to the left");
});

test("no teleports and no lurches: every move starts where he is, and he never jumps across the screen", () => {
  for (const { plan, g } of wander(250, 17)) {
    assert.deepEqual({ x: plan.frames[0].x, y: plan.frames[0].y }, { x: g.pos.x, y: g.pos.y }, plan.name);
    const fr = plan.frames;
    for (let i = 1; i < fr.length; i += 1) {
      const dt = fr[i].t - fr[i - 1].t;
      const d = Math.hypot(fr[i].x - fr[i - 1].x, fr[i].y - fr[i - 1].y);
      if (dt === 0) { assert.ok(d < 0.5, `${plan.name}: a jump of ${d} px at ${fr[i].t}`); continue; }
      assert.ok(d / (dt / 1000) < 2600, `${plan.name}: ${Math.round(d / (dt / 1000))} px/s at ${fr[i].t}`);
    }
  }
});

test("flying is eased at both ends, with a gentle bob along the way", () => {
  let checked = 0;
  for (let seed = 1; seed < 60 && checked < 6; seed += 1) {
    const plan = R.plan("roam", geo({ random: seeded(seed) }), "standing");
    const fly = plan.poses.find((p) => p.pose === "fly");
    if (!fly || plan.poses.some((p) => p.pose.startsWith("climb"))) continue;
    const next = plan.poses[plan.poses.indexOf(fly) + 1];
    const fr = plan.frames.filter((f) => f.t > fly.t + 220 && f.t < next.t - 230);
    const v = [];
    for (let i = 1; i < fr.length; i += 1) if (fr[i].t > fr[i - 1].t) v.push(Math.hypot(fr[i].x - fr[i - 1].x, fr[i].y - fr[i - 1].y) / (fr[i].t - fr[i - 1].t));
    const top = Math.max(...v);
    assert.ok(v[0] < top * 0.5 && v[v.length - 1] < top * 0.5, "speeds up and slows down");
    for (const f of fr) assert.ok(Math.abs(f.r) <= 4.5, `bank ${f.r}`);
    checked += 1;
  }
  assert.ok(checked >= 3, "flights found");
  // The bob: the same flight with and without it differs by a gentle wave,
  // up to about 5 px, up and down at least once, and none at either end.
  const fly = (bob) => { const k = R.track({ x: 300, y: 892 }, SHIPPED, "standing"); R.flyTo(k, geo({ bob }), { x: 1100, y: 892 }, false); return k.done("fly"); };
  const plain = fly(0);
  const bobbed = fly(undefined);
  assert.equal(plain.frames.length, bobbed.frames.length);
  const diff = bobbed.frames.map((f, i) => f.y - plain.frames[i].y);
  assert.ok(Math.max(...diff) > 2 && Math.min(...diff) < -2, `bob ${Math.min(...diff).toFixed(1)}..${Math.max(...diff).toFixed(1)}`);
  assert.ok(Math.max(...diff.map(Math.abs)) <= 110 * 0.05 + 0.01);
  assert.equal(diff[0], 0);
  assert.equal(diff[diff.length - 1], 0);
});

// ---------------------------------------------------------------- climbing

// Journeys that climb the left (side -1) or right edge.
function climbs(side) {
  const out = [];
  for (let seed = 1; seed < 600 && out.length < 12; seed += 1) {
    const g = geo({ random: seeded(seed), pos: { x: 300 + (seed % 9) * 100, y: 892 } });
    const plan = R.plan("roam", g, "standing");
    const c = plan.poses.find((p) => p.pose.startsWith("climb"));
    if (c && Math.sign(at(plan, c.t + 500).x - W / 2) === side) out.push({ plan, g });
  }
  return out;
}

test("he climbs a side edge facing it, his hands and toes on the screen's edge, going up in reach-and-pull steps", () => {
  for (const side of [-1, 1]) {
    const list = climbs(side);
    assert.ok(list.length >= 6, `${list.length} climbs on side ${side}`);
    for (const { plan, g } of list) {
      const wall = side < 0 ? 0 : W;
      const want = side < 0 ? "climb1-left" : "climb1";
      const cl = plan.poses.filter((p) => p.pose.startsWith("climb"));
      assert.ok(cl.every((p) => p.pose === want), `on the ${side < 0 ? "left" : "right"} edge: ${cl.map((p) => p.pose)} (facing the wall)`);
      // Once on the wall (after the step on), until he leaves it.
      const on = cl[0].t + 110 + 300;
      const leave = plan.poses.find((p) => p.t > cl[0].t && !p.pose.startsWith("climb")).t;
      const fr = plan.frames.filter((f) => f.t >= on && f.t <= leave - 400);
      assert.ok(fr.length > 10);
      for (const f of fr) {
        // The picture's front edge (hand, knee) is CLIMB_REACH in front of the point between his feet.
        const front = f.x + side * g.u * R.CLIMB_REACH;
        assert.ok(Math.abs(front - wall) < 0.6, `front edge ${front.toFixed(1)}, the screen's edge ${wall}`);
        assert.ok(Math.abs(f.r) <= 1, `no tipping off the wall: ${f.r}`);
      }
      // Going up: never slipping down, in steps (a quick reach, a slower pull, a grip).
      const up = fr.filter((f) => f.t <= fr[0].t + (leave - on) * 0.4);
      for (let i = 1; i < up.length; i += 1) assert.ok(up[i].y <= up[i - 1].y + 0.01, "never slides down while climbing up");
      const holds = up.filter((f, i) => i > 0 && f.t > up[i - 1].t && f.y === up[i - 1].y).length;
      assert.ok(holds >= 2, "grips between the steps");
      // Off the wall, standing on the floor by the end.
      assert.ok(Math.abs(plan.end.y - g.floor) < 1 && plan.endPose === "standing");
    }
  }
});

test("he gets off the wall three ways: climbing down, pushing off to a landing, or flying", () => {
  const ways = new Set();
  for (const side of [-1, 1]) {
    for (const { plan } of climbs(side)) {
      const i = plan.poses.findIndex((p) => p.pose.startsWith("climb"));
      const after = plan.poses.slice(i + 1).map((p) => p.pose);
      if (after.includes("fly")) ways.add("fly");
      else if (after.includes("land")) ways.add("drop");
      else ways.add("down");
    }
  }
  assert.deepEqual([...ways].sort(), ["down", "drop", "fly"]);
});

test("the climbing tricks face the wall on either side too", () => {
  for (const id of ["climb-wave", "slide-edge"]) {
    for (const x of [300, 1140]) {
      const plan = T.plan(id, geo({ pos: { x, y: 892 } }), "standing");
      const side = x < 720 ? -1 : 1;
      const cl = plan.poses.filter((p) => p.pose.startsWith("climb")).map((p) => p.pose);
      assert.ok(cl.length && cl.every((p) => p === (side < 0 ? "climb1-left" : "climb1")), `${id} at ${x}: ${cl}`);
    }
  }
});

test("the left-facing pictures ship, the same size as the rest", () => {
  for (const name of ["walk1-left", "walk2-left", "run1-left", "run2-left", "climb1-left"]) {
    assert.ok(SHIPPED.includes(name), name);
    const buf = fs.readFileSync(path.join(ROOT, "assets", "poses", `${name}.webp`));
    // VP8X header: canvas width and height (24-bit, minus one).
    assert.equal(buf.toString("ascii", 12, 16), "VP8X");
    assert.equal(buf.readUIntLE(24, 3) + 1, 300);
    assert.equal(buf.readUIntLE(27, 3) + 1, 340);
  }
  assert.equal(R.resolvePose("walk1-left", ["standing"]), "standing", "without its picture: the camera-facing one, as before");
  assert.equal(R.resolvePose("climb1-left", ["climb1"]), "climb1");
});

// ---------------------------------------------------------------- sharp

test("every place in a move lands on the screen's pixel grid; pictures switch at once for the dissolver", () => {
  const plan = R.walkTo(geo({ pos: { x: 700.37, y: 892 } }), 1000.13, "standing");
  for (const dpr of [1, 2]) {
    const p = S.refine(plan, dpr);
    for (const f of p.frames) {
      assert.equal(f.x * dpr, Math.round(f.x * dpr));
      assert.equal(f.y * dpr, Math.round(f.y * dpr));
    }
    assert.equal(p.end.x * dpr, Math.round(p.end.x * dpr));
    assert.ok(p.poses.every((q) => q.fade === 0));
    assert.equal(p.frames.length, plan.frames.length);
  }
  assert.equal(S.refine({ frames: [{ t: 0, x: 0, y: 0, r: 0.01, sx: 1.002, sy: 0.997 }], poses: [] }, 2).frames[0].sx, 1);
  assert.equal(S.refine(null, 2), null);
});

test("the robot's boxes are whole points (drawn pixel for pixel at 2x), with one shadow and glow, moving or still", () => {
  const css = fs.readFileSync(path.join(ROOT, "src", "renderer", "robot.css"), "utf8");
  assert.match(css, /\.pa-pose \{\s*left: round\(calc\(var\(--pa-u\) \* -0\.682\), 1px\)/);
  assert.match(css, /width: round\(calc\(var\(--pa-u\) \* 1\.364\), 1px\); height: round\(calc\(var\(--pa-u\) \* 1\.545\), 1px\)/);
  assert.match(css, /\.pa, \.pa-body \{ will-change: transform; \}/);
  assert.doesNotMatch(css, /\.travel \.pa-pose/, "no swapping the glow at each start and stop");
  // 110 px robot: the pose box is 150 x 170 points, 300 x 340 pixels at 2x, the pictures' own size.
  assert.equal(Math.round(110 * 1.364), 150);
  assert.equal(Math.round(110 * 1.545), 170);
  const tricksCss = fs.readFileSync(path.join(ROOT, "src", "renderer", "tricks.css"), "utf8");
  assert.match(tricksCss, /\.pa-pose\.pt-big \{ left: round\(/);
  const html = fs.readFileSync(path.join(ROOT, "src", "renderer", "robot.html"), "utf8");
  assert.ok(html.indexOf("smooth.js") > 0 && html.indexOf("smooth.js") < html.indexOf("robot.js"));
});

test("a change of picture dissolves the old one away on top of the new one; a step of a walk is a clean cut", () => {
  assert.equal(S.changeStyle("walk1", "walk2", R.sameCycle, false), "cut");
  assert.equal(S.changeStyle("walk2-left", "walk1-left", R.sameCycle, false), "cut");
  assert.equal(S.changeStyle("climb1", "climb2", R.sameCycle, false), "cut");
  assert.equal(S.changeStyle("standing", "walk1", R.sameCycle, false), "dissolve");
  assert.equal(S.changeStyle("walk1", "walk1-left", R.sameCycle, false), "dissolve");
  assert.equal(S.changeStyle("standing", "wave", R.sameCycle, true), "cut", "reduce motion: no dissolves");

  const dom = new JSDOM("<!doctype html><div id=stage></div>", { pretendToBeVisual: true });
  const w = dom.window;
  const made = [];
  w.Element.prototype.animate = function animate(keyframes, opts) {
    const a = { el: this, keyframes, opts, cancel() { this.cancelled = true; if (this.oncancel) this.oncancel(); }, finish() { if (this.onfinish) this.onfinish(); } };
    made.push(a);
    return a;
  };
  global.PilotMotion = M;
  delete require.cache[require.resolve("../../src/core/pilot-actor")];
  const A = require("../../src/core/pilot-actor");
  const stage = w.document.getElementById("stage");
  const actor = A.create({ doc: w.document, stage, art: {}, poses: { standing: "s.webp", walk1: "a.webp", walk2: "b.webp" } });
  const d = S.dissolver(stage, { sameCycle: R.sameCycle, reduced: () => false });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return (async () => {
    actor.show("standing", 0);
    await flush();
    const rest = stage.querySelector(".pa-rest");
    let a = made.find((x) => x.el === rest);
    assert.ok(a, "the resting robot dissolves out");
    assert.deepEqual(a.keyframes, [{ opacity: 1 }, { opacity: 0 }], "the old one fades out; the new one is fully there from the start");
    assert.ok(rest.classList.contains("mac-out"), "on top while it goes");
    assert.ok(stage.querySelector('[data-pose="standing"]').classList.contains("pa-on"));
    assert.ok(!made.some((x) => x.el === stage.querySelector('[data-pose="standing"]')), "nothing fades the new picture in");
    a.finish();
    assert.ok(!rest.classList.contains("mac-out"));
    actor.show("walk1", 0);
    await flush();
    const n = made.length;
    actor.show("walk2", 0);
    await flush();
    assert.equal(made.length, n, "a step is a clean cut");
    actor.show("standing", 0);
    await flush();
    const out = made[made.length - 1];
    assert.equal(out.el.dataset.pose, "walk2");
    // Back before it finished: the dissolve stops and it's simply shown.
    actor.show("walk2", 0);
    await flush();
    assert.ok(out.cancelled && !out.el.classList.contains("mac-out"));
    d.stop();
    actor.destroy();
  })();
});

// ---------------------------------------------------------------- clickable

test("the overlay keeps the mouse from press to release, even when he shrinks to the resting robot under it", () => {
  const pose = { left: 625, top: 724, right: 775, bottom: 894 };
  const p = { x: 640, y: 730 }; // on the pose picture, outside the resting robot's box
  assert.equal(S.wantsMouse({ rect: pose, point: p }), true);
  const rest = { left: 651, top: 786, right: 761, bottom: 892 };
  assert.equal(S.wantsMouse({ rect: rest, point: p }), false);
  assert.equal(S.wantsMouse({ rect: rest, point: p, down: true }), true, "pressed: keep it until let go");
  assert.equal(S.wantsMouse({ rect: rest, point: null, dragging: true }), true);
  assert.equal(S.wantsMouse({ rect: null, point: null }), false);
  // The gate: the main process's own check (near) is enough on its own.
  const calls = [];
  const gate = new overlay.MouseGate({ setIgnoreMouseEvents: (...a) => calls.push(a) });
  gate.set({ near: true });
  assert.deepEqual(calls[calls.length - 1], [false]);
  gate.set({ near: false });
  assert.deepEqual(calls[calls.length - 1], [true, { forward: true }]);
});

// The real robot window (robot.js and everything it loads) in a pretend
// browser, with a pretend main process, to click him while he walks.
async function robotWindow() {
  const html = fs.readFileSync(path.join(ROOT, "src", "renderer", "robot.html"), "utf8").replace(/<script[^>]*><\/script>/g, "").replace(/<link[^>]*>/g, "");
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window;
  const calls = { hover: [], click: 0, at: [] };
  let state = null;
  let doFn = null;
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.Element.prototype.animate = function animate(keyframes, opts) {
    return { keyframes, opts, cancel() {}, pause() {}, finish() {}, set onfinish(f) { this._f = f; }, get onfinish() { return this._f; } };
  };
  w.Element.prototype.getAnimations = () => [];
  w.HTMLImageElement.prototype.decode = () => Promise.resolve();
  w.Element.prototype.setPointerCapture = () => {};
  w.Element.prototype.releasePointerCapture = () => {};
  // Layout: where he's drawn is where the test says he is now (as if mid-animation).
  const now = { x: 700, y: w.innerHeight - 8 }; // on the floor of his window
  w.Element.prototype.getBoundingClientRect = function rect() {
    const u = 110;
    if (this.classList.contains("pa-rest")) return { left: now.x - 49, top: now.y - 106.5, right: now.x + 61, bottom: now.y, width: 110, height: 106.5 };
    if (this.classList.contains("pa-pose")) return { left: now.x - 75, top: now.y - 168, right: now.x + 75, bottom: now.y + 2, width: 150, height: 170 };
    return { left: 0, top: 0, right: u, bottom: u, width: u, height: u };
  };
  w.pilot = {
    robot: {
      hover: async (v) => { calls.hover.push(v); }, dragStart: async () => {}, drop: async () => null, at: async (p) => { calls.at.push(p); },
      click: async () => { calls.click += 1; }, menu: async () => {}, env: async () => {},
      onState: (f) => { state = f; }, onDo: (f) => { doFn = f; }, onShow: () => {},
    },
    attach: { show() {} },
  };
  for (const f of ["src/core/pilot-motion.js", "src/core/roam.js", "src/core/tricks.js", "src/core/pilot-actor.js", "src/renderer/props.js",
    "src/renderer/sounds.js", "src/renderer/attach.js", "src/renderer/smooth.js", "src/renderer/robot.js"]) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    w.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
  }
  const poses = { standing: "s.webp", walk1: "a.webp", walk2: "b.webp", "walk1-left": "c.webp", "walk2-left": "d.webp" };
  state({ status: "ready", theme: "blue", poses, home: { x: 700, y: now.y }, level: "always", test: true, sound: {} });
  const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
  await tick();
  return { w, calls, now, send: (cmd) => doFn(cmd), tick, R: () => w.__pilotRobot, stage: w.document.getElementById("stage") };
}
// Always closed at the end (its timers stop), pass or fail.
async function inRobotWindow(fn) {
  const r = await robotWindow();
  try { await fn(r); } finally { try { r.R().actor.stop(); } catch (_) { /* gone */ } r.w.close(); }
}

const mouse = (w, type, x, y, extra) => new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, ...(extra || {}) });
const pointer = (w, type, x, y) => {
  const ev = mouse(w, type, x, y, { button: 0 });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  return ev;
};

test("clicking him mid-walk opens the chat, even when he sits down under the pointer as it's pressed", () => inRobotWindow(async (r) => {
  r.send({ move: "walk", user: true });
  for (let i = 0; i < 25 && !r.R().actor.busy; i += 1) await r.tick(20);
  assert.ok(r.R().actor.busy, "walking");
  for (let i = 0; i < 60 && !/walk/.test(r.R().actor.pose); i += 1) await r.tick(20);
  assert.match(r.R().actor.pose, /walk/, "mid-stride");
  // Over the edge of the walking picture (outside the smaller resting robot).
  const y = r.now.y - 155;
  r.w.dispatchEvent(mouse(r.w, "mousemove", 640, y));
  assert.equal(r.calls.hover[r.calls.hover.length - 1], true, "over him: the overlay takes the mouse");
  const pic = r.stage.querySelector(".pa-pose.pa-on");
  pic.dispatchEvent(pointer(r.w, "pointerdown", 640, y));
  assert.equal(r.R().actor.pose, "rest", "he stops and sits as he's pressed");
  // A tiny wobble of the hand while pressing (as real clicks have).
  r.w.dispatchEvent(mouse(r.w, "mousemove", 641, y));
  await r.tick(30);
  assert.equal(r.calls.hover[r.calls.hover.length - 1], true, "pressed: the overlay keeps the mouse, so the release lands on him");
  r.stage.dispatchEvent(pointer(r.w, "pointerup", 641, y));
  await r.tick(10);
  assert.equal(r.calls.click, 1, "the click lands: the chat opens");
}));

test("he walks under a still pointer: the overlay takes the mouse; he walks away: it lets go; his place goes out as he moves", () => inRobotWindow(async (r) => {
  r.w.dispatchEvent(mouse(r.w, "mousemove", 900, r.now.y - 60)); // the pointer, resting away from him
  assert.notEqual(r.calls.hover[r.calls.hover.length - 1], true);
  r.send({ move: "walk", user: true });
  for (let i = 0; i < 25 && !r.R().actor.busy; i += 1) await r.tick(20);
  const before = r.calls.at.length;
  r.now.x = 890; // he has walked under it (no mouse move at all)
  await r.tick(250);
  assert.equal(r.calls.hover[r.calls.hover.length - 1], true, "under the pointer: clickable at once");
  const live = r.calls.at.slice(before).filter((p) => p.moving);
  assert.ok(live.length >= 2, `his place is reported while he moves (${live.length} times)`);
  assert.ok(live.some((p) => p.rect && p.rect.left === 815), "with where he is now, not where the walk began");
  r.now.x = 300; // and on, away from it
  await r.tick(120);
  assert.equal(r.calls.hover[r.calls.hover.length - 1], false, "away again: clicks go through to the apps");
}));
