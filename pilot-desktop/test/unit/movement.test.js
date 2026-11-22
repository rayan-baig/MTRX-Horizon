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

// ---------------------------------------------------------------- planted feet (1.5.1)

// Where he is at t: just after t (after any jump at t), or with before, just
// before it (the place a jump at t starts from).
function placeAt(plan, t, before) {
  const fr = plan.frames;
  if (before) {
    let i = fr.findIndex((f) => f.t >= t);
    if (i < 0) return fr[fr.length - 1];
    if (fr[i].t === t || i === 0) return fr[i];
    const a = fr[i - 1];
    const b = fr[i];
    const u = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, r: a.r + (b.r - a.r) * u };
  }
  let i = -1;
  for (let j = 0; j < fr.length; j += 1) if (fr[j].t <= t) i = j;
  if (i < 0) return fr[0];
  if (i === fr.length - 1) return fr[i];
  const a = fr[i];
  const b = fr[i + 1];
  const u = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, r: a.r + (b.r - a.r) * u };
}
const STEP_PIC = /^(walk|run)\d+(-left)?$/;
// The planted foot's place on screen at a moment: his place, plus the foot
// (R.FEET: robot widths in front of the point between his feet, measured on
// the picture), turned with him.
const footAt = (f, pose, u) => {
  const d = R.footOf(pose) * u;
  const a = ((f.r || 0) * Math.PI) / 180;
  return { x: f.x + d * Math.cos(a), y: f.y + d * Math.sin(a) };
};
// Every walk or run picture's showing in a plan, with how far its planted
// foot moves on screen while it shows (points), checked at every keyframe.
function drifts(plan, u) {
  const out = [];
  const ps = plan.poses.slice().sort((a, b) => a.t - b.t);
  for (let i = 0; i < ps.length; i += 1) {
    if (!STEP_PIC.test(ps[i].pose)) continue;
    const t0 = ps[i].t;
    const t1 = ps[i + 1] ? ps[i + 1].t : plan.duration;
    if (t1 <= t0) continue;
    const pts = [placeAt(plan, t0, false), ...plan.frames.filter((f) => f.t > t0 && f.t < t1), placeAt(plan, t1, true)].map((f) => footAt(f, ps[i].pose, u));
    const drift = Math.max(...pts.map((p) => Math.hypot(p.x - pts[0].x, p.y - pts[0].y)));
    out.push({ pose: ps[i].pose, t: t0, ms: t1 - t0, drift });
  }
  return out;
}

test("his planted foot stays put on screen while each walk or run picture shows: under 3 points (1.5.0: about 32)", () => {
  let checked = 0;
  for (const run of [false, true]) {
    for (const [from, to] of [[200, 1300], [1300, 150], [700, 820], [700, 640]]) {
      for (const pace of [0.88, 1, 1.14]) {
        const plan = R.walkTo(geo({ pace, pos: { x: from, y: 892 } }), to, "standing", run);
        for (const dpr of [1, 2]) {
          for (const d of drifts(S.refine(plan, dpr), 110)) {
            assert.ok(d.drift <= 3, `${run ? "run" : "walk"} ${from}→${to} at ${dpr}x: ${d.pose} at ${Math.round(d.t)} ms, its foot moves ${d.drift.toFixed(1)} pt`);
            checked += 1;
          }
        }
      }
    }
  }
  assert.ok(checked > 200, `${checked} pictures checked`);
  assert.ok(Math.abs(R.footOf("walk2-left") + R.FEET.walk2) < 1e-9, "a -left copy's foot is the same distance the other way");
});

test("...and the same on every walk and run in his travels and in the tricks", () => {
  let n = 0;
  for (const { plan } of wander(250, 21)) for (const d of drifts(S.refine(plan, 2), 110)) { assert.ok(d.drift <= 3, `${plan.name}: ${d.pose} ${d.drift.toFixed(1)} pt`); n += 1; }
  for (const id of T.IDS) {
    for (const x of [300, 720, 1140]) {
      const plan = T.plan(id, geo({ pos: { x, y: 892 } }), "standing");
      // (Dances bounce on the spot, foot off the floor: only the sideways slide counts there.)
      for (const d of drifts(S.refine(plan, 2), 110)) {
        const pic = plan.poses.find((p) => p.t === d.t && p.pose === d.pose);
        const xs = [placeAt(plan, d.t, false), placeAt(plan, d.t + d.ms, true)].map((f) => footAt(f, d.pose, 110).x);
        assert.ok(Math.abs(xs[1] - xs[0]) <= 3, `${id} at ${x}: ${pic.pose} slides ${Math.abs(xs[1] - xs[0]).toFixed(1)} pt`);
        n += 1;
      }
    }
  }
  assert.ok(n > 500, `${n}`);
});

test("he walks in a step pattern: holding still while the foot is planted, moving at the change of picture", () => {
  const g = geo();
  const plan = R.walkTo(g, 1200, "standing");
  const gt = R.gait(g, false);
  const st = plan.poses.filter((p) => STEP_PIC.test(p.pose));
  // Each change of picture in the middle of the walk moves him about a stride (two pictures, a step each).
  for (let i = 2; i < st.length - 1; i += 1) {
    const d = placeAt(plan, st[i].t, false).x - placeAt(plan, st[i - 1].t, false).x;
    assert.ok(Math.abs(d - gt.stride) < gt.stride * 0.2, `a step covers ${d.toFixed(1)}, the stride is ${gt.stride.toFixed(1)}`);
  }
  // A gentle start and stop: the first and last steps are half ones.
  const step = (i) => placeAt(plan, st[i].t, false).x - placeAt(plan, st[i - 1].t, false).x;
  assert.ok(step(1) < step(3) * 0.7 && step(st.length - 1) < step(3) * 0.7, `first ${step(1)}, last ${step(st.length - 1)}, middle ${step(3)}`);
  // No bob, lean or squash while walking: the picture stays sharp and the foot on the floor.
  const walking = plan.frames.filter((f) => f.t >= st[0].t && f.t <= st[st.length - 1].t + gt.stepMs);
  for (const f of walking) assert.ok(f.y === g.floor && f.r === 0 && f.sx === 1 && f.sy === 1, JSON.stringify(f));
  // Stands still for a real stop at the end (never a flash of the standing picture).
  const stand = plan.poses[plan.poses.length - 1];
  assert.equal(stand.pose, "standing");
  assert.ok(plan.duration - stand.t >= R.STAND_MS, `${plan.duration - stand.t} ms standing`);
});

test("a walk cycle can have more pictures: walk3, walk4 ... are used in turn when they're there (and climb2)", () => {
  const four = SHIPPED.concat(["walk3", "walk4", "walk3-left", "walk4-left", "climb2", "climb2-left"]);
  for (const [to, l] of [[1200, ""], [200, "-left"]]) {
    const g = geo({ poses: four, pace: 1 });
    const plan = R.walkTo(g, to, "standing");
    const st = plan.poses.filter((p) => STEP_PIC.test(p.pose)).map((p) => p.pose);
    assert.deepEqual(st.slice(0, 8), [1, 2, 3, 4, 1, 2, 3, 4].map((i) => `walk${i}${l}`));
    // Four pictures to two steps: each shows half as long, and the rhythm is the same.
    const ps = plan.poses.filter((p) => STEP_PIC.test(p.pose));
    const each = ps[2].t - ps[1].t;
    assert.ok(Math.abs(each - R.gait(g, false).stepMs / 2) < 1, `${each} ms a picture`);
    for (const d of drifts(S.refine(plan, 2), 110)) assert.ok(d.drift <= 3, `${d.pose} ${d.drift}`);
    // Only the pictures that are there: with walk3 but no walk4, a three-picture cycle.
    assert.deepEqual(R.strideNames(false, l ? -1 : 1, (n) => four.includes(n) && !/walk4/.test(n)), [1, 2, 3].map((i) => `walk${i}${l}`));
  }
  assert.deepEqual(R.strideNames(false, 1), ["walk1", "walk2"], "today's two pictures");
  // The left copies and the extra pictures are picked up from their files.
  assert.deepEqual(Object.keys(R.posesFromFiles(["walk3.webp", "walk4-left.webp", "climb2.webp", "climb2-left.webp", "walk9.webp"])).sort(),
    ["climb2", "climb2-left", "walk3", "walk4-left"]);
  // climb2: the hands and feet take turns, a picture a step.
  const k = R.track({ x: 1371, y: 892 }, four, "standing", { dpr: 2 });
  R.climbUp(k, geo({ poses: four }), 1, 110 * 1.5);
  const cl = k.done("climb").poses.filter((p) => p.pose.startsWith("climb")).map((p) => p.pose);
  assert.ok(cl.includes("climb1") && cl.includes("climb2"), cl.join());
  for (let i = 1; i < cl.length; i += 1) assert.notEqual(cl[i], cl[i - 1]);
});

test("no standing picture hanging in mid-air: pushing off the wall, climbing and waving, dropped in the air", () => {
  const check = (plan, g, what) => {
    for (const p of plan.poses.filter((q) => q.pose === "standing" || q.pose === "wave")) {
      const next = plan.poses[plan.poses.indexOf(p) + 1];
      const end = next ? next.t : plan.duration;
      const fr = [placeAt(plan, p.t, false), ...plan.frames.filter((f) => f.t > p.t && f.t < end)];
      // (A little hop on the spot is fine; hanging up there is not.)
      for (const f of fr) assert.ok(g.floor - f.y <= g.u * 0.12, `${what}: ${p.pose} ${(g.floor - f.y).toFixed(0)} pt up in the air at ${Math.round(p.t)} ms`);
    }
  };
  let drops = 0;
  for (const side of [-1, 1]) {
    for (const { plan, g } of climbs(side)) {
      check(plan, g, "a climb");
      if (plan.poses.some((p) => p.pose === "land")) drops += 1;
    }
  }
  assert.ok(drops > 0, "pushing off checked");
  for (const { plan, g } of wander(250, 5)) check(plan, g, plan.name);
  for (const id of ["climb-wave", "slide-edge"]) {
    for (const x of [300, 1140]) {
      const g = geo({ pos: { x, y: 892 } });
      const plan = T.plan(id, g, "standing");
      check(plan, g, id);
      if (id === "climb-wave") assert.ok(plan.poses.some((p) => p.pose === "fly"), "waves from the air, flying");
    }
  }
  // Dropped in the air and let go: up into the flying picture, not standing.
  const g = geo({ pos: { x: 700, y: 500 } });
  check(R.plan("roam", g, "rest"), g, "from the air");
  // The push-off: the jump picture, then the landing one.
  const k = R.track({ x: 1396, y: 600 }, SHIPPED, "climb1", { dpr: 2 });
  R.dropOff(k, geo(), 1);
  const after = k.done("drop").poses.map((p) => p.pose);
  assert.deepEqual(after.slice(0, 3), ["climb1", R.airPose({ has: (n) => SHIPPED.includes(n) }), "land"]);
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
    // (On the screen's pixel grid: within a quarter point, half a pixel on a Retina screen.)
    assert.ok(Math.abs(plan.frames[0].x - g.pos.x) <= 0.25 && Math.abs(plan.frames[0].y - g.pos.y) <= 0.25, `${plan.name} starts at ${plan.frames[0].x}, he's at ${g.pos.x}`);
    const fr = plan.frames;
    for (let i = 1; i < fr.length; i += 1) {
      const dt = fr[i].t - fr[i - 1].t;
      const d = Math.hypot(fr[i].x - fr[i - 1].x, fr[i].y - fr[i - 1].y);
      // (1.5.1: a walk moves at the change from one of its pictures to the
      // next, by at most a stride; nowhere else does he jump.)
      const cut = plan.poses.some((p, j) => j > 0 && p.t === fr[i].t && R.sameCycle(plan.poses[j - 1].pose, p.pose));
      if (dt === 0) { assert.ok(d < 0.5 || (cut && d <= g.u * 0.6), `${plan.name}: a jump of ${d} px at ${fr[i].t}`); continue; }
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
      // (Until climb2's picture is there, one climbing picture all the way.)
      // Once on the wall (after the step on), until he leaves it.
      const on = cl[0].t + 110 + 300;
      const leave = plan.poses.find((p) => p.t > cl[0].t && !p.pose.startsWith("climb")).t;
      const fr = plan.frames.filter((f) => f.t >= on && f.t <= leave - 400);
      assert.ok(fr.length > 10);
      for (const f of fr) {
        // The picture's front edge (hand, knee) is CLIMB_REACH in front of the point between his feet:
        // on the screen's edge, or (1.5.1) leaning out from it a touch as he reaches.
        const front = f.x + side * g.u * R.CLIMB_REACH;
        const out = (wall - front) * side;
        assert.ok(out > -0.6 && out < g.u * R.CLIMB_OUT + 0.6, `front edge ${front.toFixed(1)}, the screen's edge ${wall}`);
        assert.ok(Math.abs(f.r) <= 1, `no tipping off the wall: ${f.r}`);
      }
      // Going up: never slipping down, in steps: a grip (holding still), a
      // reach (out a touch, not up), a pull (up, back against the wall). He
      // only goes up during a pull, with his front edge coming back to the wall.
      const up = fr.filter((f) => f.t <= fr[0].t + (leave - on) * 0.4);
      for (let i = 1; i < up.length; i += 1) assert.ok(up[i].y <= up[i - 1].y + 0.01, "never slides down while climbing up");
      const holds = up.filter((f, i) => i > 0 && f.t - up[i - 1].t >= 100 && f.x === up[i - 1].x && f.y === up[i - 1].y).length;
      assert.ok(holds >= 2, "grips between the steps, holding still");
      for (let i = 1; i < up.length; i += 1) {
        if (up[i].y < up[i - 1].y - 0.01) assert.ok(Math.abs(up[i].x + side * g.u * R.CLIMB_REACH - wall) < 0.6, "he goes up only in a pull, ending on the wall");
        else if (up[i].x !== up[i - 1].x) assert.equal(up[i].y, up[i - 1].y, "the reach doesn't climb");
      }
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

test("1.5.1: the pictures change on the move's own clock: a cut at the very moment he moves on, a dissolve that fades the old one on top", () => {
  const plan = { duration: 1000, poses: [{ t: 0, pose: "standing" }, { t: 0, pose: "walk1" }, { t: 300, pose: "walk2" }, { t: 600, pose: "standing" }] };
  const k = S.poseKeyframes(plan, { sameCycle: R.sameCycle });
  const val = (kf, t, after) => {
    // The value at offset t (after: just after a step at t).
    let v = kf[0];
    for (const f of kf) if (f.offset < t || (after && f.offset === t)) v = f;
    return v;
  };
  // walk1 → walk2 at 0.3: a cut, the same instant for both.
  assert.equal(val(k.walk1, 0.3, false).opacity, 1);
  assert.equal(val(k.walk1, 0.3, true).opacity, 0);
  assert.equal(val(k.walk2, 0.3, false).opacity, 0);
  assert.equal(val(k.walk2, 0.3, true).opacity, 1);
  // walk2 → standing at 0.6: standing is fully there at once; walk2 fades out over 140 ms, on top.
  assert.equal(val(k.standing, 0.6, true).opacity, 1);
  const out = k.walk2.filter((f) => f.offset >= 0.6 && f.offset <= 0.74);
  assert.ok(out.some((f) => f.offset === 0.6 && f.opacity === 1 && f.zIndex === 2 && f.easing === "ease-in"), JSON.stringify(out));
  assert.ok(out.some((f) => Math.abs(f.offset - 0.74) < 1e-9 && f.opacity === 0), "gone after the dissolve");
  assert.equal(val(k.walk2, 0.9, true).opacity, 0);
  for (const kf of Object.values(k)) {
    assert.equal(kf[0].offset, 0);
    assert.equal(kf[kf.length - 1].offset, 1);
    for (let i = 1; i < kf.length; i += 1) assert.ok(kf[i].offset >= kf[i - 1].offset);
  }
  // The picture he showed as the move began (standing) dissolves away on top too.
  assert.deepEqual(k.standing.slice(1, 3).map((f) => [f.offset, f.opacity, f.zIndex]), [[0, 1, 2], [0.14, 0, 2]]);
  // Reduce motion: every change a cut.
  const r = S.poseKeyframes(plan, { sameCycle: R.sameCycle, reduced: true });
  assert.ok(!r.walk2.some((f) => f.zIndex === 2));
  // The clock waits for the actor's own animation, then starts on exactly its start time.
  const dom = new JSDOM("<!doctype html><div id=a></div><img id=w1><img id=w2><img id=s>", { pretendToBeVisual: true });
  const w = dom.window;
  const made = [];
  w.Element.prototype.animate = function animate(kf, opts) { const a = { el: this, kf, opts, startTime: null, cancel() { this.cancelled = true; } }; made.push(a); return a; };
  const lead = { ready: Promise.resolve(), startTime: 1234.5, playState: "running" };
  const clockEl = w.document.getElementById("a");
  clockEl.getAnimations = () => [lead];
  const pics = { walk1: "w1", walk2: "w2", standing: "s" };
  const c = S.poseClock(plan, { clock: clockEl, picture: (n) => w.document.getElementById(pics[n]), sameCycle: R.sameCycle, frame: (fn) => setTimeout(fn, 0) });
  return new Promise((done) => setTimeout(done, 10)).then(() => {
    assert.ok(c.active);
    assert.equal(made.length, 3);
    assert.ok(made.every((a) => a.startTime === 1234.5 && a.opts.duration === 1000), "on the actor's clock");
    assert.ok(w.document.getElementById("w1").classList.contains("mac-sync"));
    c.stop();
    assert.ok(made.every((a) => a.cancelled) && !w.document.getElementById("w1").classList.contains("mac-sync"));
  });
});

test("1.5.1: the picture dissolving away is really seen (the CSS that hid it at once is overridden), and the dissolver steps aside for the clock", () => {
  const css = fs.readFileSync(path.join(ROOT, "src", "renderer", "tricks.css"), "utf8");
  const hide = css.indexOf(".pa-pose:not(.pa-on) { visibility: hidden; }");
  const show = css.indexOf(".pa-pose.mac-out, .pa-pose.mac-sync { visibility: visible; }");
  assert.ok(hide > 0 && show > hide, "after the rule that hides the pictures not showing");
  const dom = new JSDOM("<!doctype html><div id=stage><img class='pa-pose pa-on' data-pose=standing><img class=pa-pose data-pose=wave></div>", { pretendToBeVisual: true });
  const w = dom.window;
  const made = [];
  w.Element.prototype.animate = function animate(kf) { const a = { el: this, kf, cancel() {} }; made.push(a); return a; };
  let syncing = true;
  const stage = w.document.getElementById("stage");
  const d = S.dissolver(stage, { sameCycle: R.sameCycle, reduced: () => false, skip: () => syncing });
  const [a, b] = stage.querySelectorAll("img");
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return (async () => {
    b.classList.add("pa-on"); a.classList.remove("pa-on");
    await flush();
    assert.equal(made.length, 0, "while the clock does it, no second dissolve");
    syncing = false;
    a.classList.add("pa-on"); b.classList.remove("pa-on");
    await flush();
    assert.equal(made.length, 1);
    assert.ok(b.classList.contains("mac-out"));
    d.stop();
  })();
});

test("1.5.1: the main process checks the cursor 20 times a second while it matters, 5 times at rest", () => {
  assert.equal(overlay.cursorEvery({}), 200);
  assert.equal(overlay.cursorEvery({ moving: true }), 50);
  assert.equal(overlay.cursorEvery({ near: true }), 50);
  assert.equal(overlay.cursorEvery({ over: true }), 50);
  assert.equal(overlay.cursorEvery({ dragging: true }), 50);
  const main = fs.readFileSync(path.join(ROOT, "src", "main", "main.js"), "utf8");
  assert.doesNotMatch(main, /setInterval\(watchCursor, 50\)/);
  assert.match(main, /overlay\.cursorEvery\(/);
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

test("1.5.1: the 'Pilot needs your AI key.' tooltip comes up only when you point at him, not when he walks under a still pointer", () => inRobotWindow(async (r) => {
  // state from robotWindow(): status ready; make it the no-key one.
  r.w.dispatchEvent(new r.w.MouseEvent("mousemove", { clientX: 900, clientY: r.now.y - 60 }));
  assert.equal(r.stage.title, "", "no tooltip to start with");
  r.send({ move: "walk", user: true });
  for (let i = 0; i < 25 && !r.R().actor.busy; i += 1) await r.tick(20);
  r.now.x = 890; // he walks under the pointer, which doesn't move
  await r.tick(150);
  r.w.dispatchEvent(new r.w.MouseEvent("mousemove", { clientX: 900, clientY: r.now.y - 60 })); // (macOS repeats the same point)
  assert.equal(r.stage.title, "", "walking under a still pointer: no tooltip");
  r.R().halt();
  await r.tick(30);
  r.w.dispatchEvent(new r.w.MouseEvent("mousemove", { clientX: 905, clientY: r.now.y - 50 })); // the user points at him
  assert.equal(r.stage.title, "Pilot is ready.", "pointed at on purpose: the tooltip");
  r.w.dispatchEvent(new r.w.MouseEvent("mousemove", { clientX: 200, clientY: 100 }));
  assert.equal(r.stage.title, "", "and gone again when the pointer leaves him");
}));
