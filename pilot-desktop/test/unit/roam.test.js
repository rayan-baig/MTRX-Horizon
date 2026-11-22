// Always moving (the default on the Mac): he keeps travelling with short
// pauses, holds still when he should, never shows a picture mirrored or
// facing away from where he's going, and the Energy setting (Calm, Relaxed,
// Always moving) is migrated and applied in the right order.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const M = require("../../src/core/pilot-motion");
const R = require("../../src/core/roam");
const lifeCore = require("../../src/main/life");
const { Settings, migrate, DEFAULTS } = require("../../src/main/store");
const csp = require("../../src/main/csp");

const ALL = ["standing", "sitting", "wave", "walk1", "run1", "fly", "climb1", "flip", "throw", "kick", "tennis", "celebrate",
  "slide", "point", "power", "love", "land", "arms-crossed"];
const seeded = (seed) => { let s = seed || 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const geo = (extra) => ({ pos: { x: 700, y: 892 }, home: { x: 1300, y: 892 }, floor: 892, left: 68, right: 1372, top: 187, u: 110,
  poses: ALL, random: seeded(3), profile: "desktop", sky: 540, ...(extra || {}) });

function fakeTimers() {
  const list = [];
  return {
    list,
    setTimeout: (fn, ms) => { const t = { fn, ms }; list.push(t); return t; },
    clearTimeout: (t) => { const i = list.indexOf(t); if (i >= 0) list.splice(i, 1); },
  };
}

// A run of journeys, each starting where the last one ended.
function wander(n, seed, extra) {
  const random = seeded(seed);
  const plans = [];
  let pos = { x: 700, y: 892 };
  let pose = "rest";
  for (let i = 0; i < n; i += 1) {
    const name = i % 13 === 12 ? "roam-trick" : i % 9 === 4 ? "roam-look" : i % 17 === 8 ? "roam-wave" : "roam";
    const g = geo({ pos, random, pointer: { x: random() * 1440, y: random() * 900 }, ...(extra || {}) });
    const plan = R.fromPose(R.plan(name, g, pose), pose, g);
    assert.ok(plan && plan.duration > 0, name);
    plans.push({ asked: name, plan, g });
    pos = plan.end;
    pose = plan.endPose;
  }
  return plans;
}

// ---------------------------------------------------------------- the scheduler

test("Always moving keeps him travelling, with pauses of 4 seconds at most", async () => {
  const timers = fakeTimers();
  let clock = 0;
  const sent = [];
  const life = lifeCore.create({ motion: M, send: (c) => sent.push(c.move), context: () => ({ level: "always" }), check: async () => ({}),
    random: seeded(9), now: () => clock, timers });
  life.start();
  const pauses = [];
  assert.equal(timers.list.length, 1, "no separate glance timer in Always moving");
  pauses.push(timers.list[0].ms);
  for (let i = 0; i < 400; i += 1) {
    const t = timers.list.shift();
    clock += t.ms;
    const name = await t.fn();
    assert.ok(name, "a move every time nothing holds him");
    assert.equal(timers.list.length, 1);
    assert.equal(timers.list[0].ms, R.MOST_MS, "waits for the move to end");
    clock += 5000; // the move plays
    life.settled();
    assert.equal(timers.list.length, 1);
    pauses.push(timers.list[0].ms);
  }
  assert.ok(pauses.every((ms) => ms >= 400 && ms <= 4000), `pauses ${Math.min(...pauses)}..${Math.max(...pauses)}`);
  assert.ok(pauses.filter((ms) => ms >= 1000).length > pauses.length * 0.8, "mostly 1 to 4 seconds");
  const travel = sent.filter((m) => m === "roam").length;
  assert.ok(travel / sent.length > 0.75, `travelling ${travel} of ${sent.length}`);
  assert.ok(sent.includes("roam-look") && sent.includes("roam-wave"), "sometimes a look or a wave");
  // A trick or a sport about every couple of minutes.
  const tricks = sent.filter((m) => m === "roam-trick").length;
  const minutes = clock / 60000;
  assert.ok(tricks >= minutes / 3 && tricks <= minutes, `${tricks} tricks in ${minutes.toFixed(1)} minutes`);
});

test("the holds still work: chat open, full screen, dragged, idle or locked, hidden, the pointer on him", async () => {
  const holds = [{ chatOpen: true }, { dragging: true }, { userAway: true }, { hidden: true }, { hovered: true }, { busy: true }];
  for (const h of holds) {
    const timers = fakeTimers();
    const sent = [];
    const life = lifeCore.create({ motion: M, send: (c) => sent.push(c), context: () => ({ level: "always", ...h }), check: async () => ({}),
      random: seeded(2), timers, back: () => {} });
    life.start();
    for (let i = 0; i < 30; i += 1) {
      const t = timers.list.shift();
      assert.equal(await t.fn(), null, JSON.stringify(h));
      assert.equal(timers.list[0].ms, R.HOLD_MS, "checks again in 2 seconds");
    }
    assert.deepEqual(sent, [], JSON.stringify(h));
    assert.ok(R.holdReason({ level: "always", ...h }));
  }
  // Full screen in front: found by the check just before a move.
  const timers = fakeTimers();
  const sent = [];
  const life = lifeCore.create({ motion: M, send: (c) => sent.push(c), context: () => ({ level: "always" }), check: async () => ({ fullscreen: true }),
    random: seeded(2), timers });
  life.start();
  for (let i = 0; i < 20; i += 1) assert.equal(await timers.list.shift().fn(), null);
  assert.deepEqual(sent, []);
  assert.equal(R.holdReason({ fullscreen: true }), "fullscreen");
  assert.equal(R.pick({ level: "always", chatOpen: true }, seeded(1)), null);
});

test("typing elsewhere doesn't stop him in Always moving, but still does in Relaxed", async () => {
  const sent = [];
  const always = lifeCore.create({ motion: M, send: (c) => sent.push(c.move), context: () => ({ level: "always", typing: true }),
    check: async () => ({ typing: true }), random: seeded(4), timers: fakeTimers() });
  for (let i = 0; i < 10; i += 1) assert.ok(await always.tick());
  assert.equal(R.holdReason({ level: "always", typing: true }), "");
  const relaxed = [];
  const life = lifeCore.create({ motion: M, send: (c) => relaxed.push(c), context: () => ({ level: "relaxed", typing: true }),
    check: async () => ({ typing: true }), random: seeded(4), timers: fakeTimers() });
  for (let i = 0; i < 30; i += 1) assert.equal(await life.tick(), null);
  assert.deepEqual(relaxed, []);
});

test("back at the Mac after it was idle or locked: one wave, then moving again", async () => {
  const timers = fakeTimers();
  let clock = 0;
  let away = true;
  const backs = [];
  const sent = [];
  const life = lifeCore.create({ motion: M, send: (c) => sent.push(c), context: () => ({ level: "always", userAway: away }), check: async () => ({}),
    random: seeded(5), now: () => clock, timers, back: (s) => backs.push(s) });
  life.start();
  for (let i = 0; i < 5; i += 1) { clock += 2000; await timers.list.shift().fn(); }
  assert.deepEqual(sent, []);
  away = false;
  clock += 2000;
  assert.equal(await timers.list.shift().fn(), "wave");
  assert.equal(backs.length, 1);
  assert.ok(backs[0] >= 8 && backs[0] <= 12, backs[0]);
  life.settled();
  assert.ok(timers.list[0].ms <= 1200, "a short pause after the wave");
  assert.equal(await timers.list.shift().fn(), "roam");
  // Without a back handler, it waves itself, once per return.
  const waves = [];
  const plain = lifeCore.create({ motion: M, send: (c) => waves.push(c), context: () => ({ level: "always" }), now: () => clock });
  assert.equal(plain.react("return"), "wave");
  assert.equal(plain.react("return"), null, "unlocking and the idle check notice the same return");
  assert.equal(waves.length, 1);
});

test("Calm only idles; Relaxed keeps Pilot 1.1's gentle timing", async () => {
  const sent = [];
  const calm = lifeCore.create({ motion: M, send: (c) => sent.push(c), context: () => ({ level: "calm" }), check: async () => ({}),
    random: seeded(1), timers: fakeTimers() });
  for (let i = 0; i < 50; i += 1) assert.equal(await calm.tick(), null);
  assert.deepEqual(sent, []);
  assert.equal(R.pick({ level: "calm" }, seeded(1)), null);
  const timers = fakeTimers();
  const relaxed = lifeCore.create({ motion: M, send: () => {}, context: () => ({ level: "relaxed" }), random: () => 0.5, timers });
  relaxed.start();
  assert.ok(timers.list.some((t) => t.ms === 75000), "30 to 120 seconds between moves");
  // A settled move doesn't hurry Relaxed along.
  relaxed.settled();
  assert.ok(timers.list.some((t) => t.ms === 75000));
});

test("which level applies: an explicit choice wins, else reduce motion means Calm, else Always moving", () => {
  assert.equal(R.DEFAULT_LEVEL, "always");
  assert.equal(R.level(undefined, false, false), "always");
  assert.equal(R.level("always", false, true), "calm");
  assert.equal(R.level("always", true, true), "always");
  assert.equal(R.level("relaxed", true, true), "relaxed");
  assert.equal(R.level("calm", true, false), "calm");
  assert.equal(R.level("playful", false, false), "always", "an old or unknown value");
  assert.deepEqual(R.LEVELS.map((l) => R.LABELS[l]), ["Calm", "Relaxed", "Always moving"]);
});

test("existing settings move to Always moving, unless the user had picked Calm", () => {
  assert.deepEqual(DEFAULTS().energy, "always");
  assert.equal(DEFAULTS().energyChosen, false);
  const cases = [
    [{ version: 1, calm: true, energy: "playful" }, "calm", true],
    [{ version: 1, calm: null, energy: "low" }, "always", false],
    [{ version: 1, calm: null, energy: "normal" }, "always", false],
    [{ version: 1, calm: false, energy: "normal" }, "always", true], // turned calm off by hand under reduce motion
    [{ energy: "playful" }, "always", false], // no version at all
    [{ version: 2, energy: "relaxed", energyChosen: true }, "relaxed", true],
    [{ version: 2, energy: "nonsense" }, "always", false],
  ];
  for (const [saved, energy, chosen] of cases) {
    const d = migrate(saved);
    assert.equal(d.energy, energy, JSON.stringify(saved));
    assert.equal(d.energyChosen, chosen, JSON.stringify(saved));
    assert.equal(d.version, 2);
    assert.equal("calm" in d, false);
  }
  // The real settings file is migrated once and saved; other settings stay.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-settings-"));
  try {
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ version: 1, calm: true, energy: "low", theme: "violet", home: { x: 5, y: 6 } }));
    const s = new Settings(dir);
    assert.equal(s.get("energy"), "calm");
    assert.equal(s.get("theme"), "violet");
    assert.deepEqual(s.get("home"), { x: 5, y: 6 });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
    assert.equal(onDisk.version, 2);
    assert.equal(onDisk.energy, "calm");
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ version: 1, calm: null, energy: "playful" }));
    assert.equal(new Settings(dir).get("energy"), "always");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- the moves

test("no pose is ever mirrored, and none faces away from where he's going", () => {
  // The P badge must never be backwards: nothing flips a picture.
  for (const { plan } of wander(300, 21)) {
    for (const f of plan.frames) assert.ok(f.sx > 0 && f.sy > 0, `${plan.name} sx ${f.sx}`);
  }
  for (const name of ["walk", "run", "fly", "climb", "backflip", "spin", "bounce", "peek", "wave", "look", "football", "soccer", "tennis",
    "celebrate", "slide", "point", "power", "love", "wait", "land"]) {
    for (const f of M.plan(name, geo({ random: seeded(name.length) })).frames) assert.ok(f.sx > 0, name);
  }
  for (const file of ["src/renderer/robot.css", "src/renderer/robot.js", "src/core/pilot-actor.css", "src/core/roam.js"]) {
    const text = fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8");
    assert.doesNotMatch(text, /scaleX\(\s*-|scale\(\s*-|rotateY\(/, file);
  }
  // Facing: while he travels sideways, the picture faces that way or the camera.
  let left = 0;
  let right = 0;
  for (const { plan } of wander(300, 33)) {
    const fr = plan.frames;
    for (let i = 1; i < fr.length; i += 1) {
      const dx = fr[i].x - fr[i - 1].x;
      if (Math.abs(dx) < 3) continue;
      if (dx < 0) left += 1; else right += 1;
      if (plan.props.length) continue; // a sport from pilot-motion.js, played only toward the side its pictures face
      const pose = plan.poses.filter((p) => p.t <= fr[i - 1].t).pop().pose;
      assert.ok(R.suits(pose, Math.sign(dx)), `${plan.name}: ${pose} while going ${dx > 0 ? "right" : "left"}`);
    }
  }
  assert.ok(left > 100 && right > 100, `both ways: ${left} left, ${right} right`);
  assert.equal(R.suits("walk1", -1), false);
  assert.equal(R.suits("walk1", 1), true);
  assert.equal(R.suits("slide", 1), false);
  assert.equal(R.suits("standing", -1), true);
  // Sports that face right are only picked when they'd go right.
  for (let i = 0; i < 60; i += 1) {
    const plan = R.plan("roam-trick", geo({ pos: { x: 1250, y: 892 }, random: seeded(i + 1) }), "standing");
    assert.ok(!["football", "soccer", "tennis"].includes(plan.name), plan.name);
  }
});

test("journeys vary: walks, runs, flights with a landing, climbs, both ways, random places", () => {
  const plans = wander(250, 7);
  const shown = (pose) => plans.filter(({ plan }) => plan.poses.some((p) => p.pose === pose)).length;
  for (const pose of ["walk1", "run1", "fly", "land", "climb1", "slide", "wave"]) assert.ok(shown(pose) > 0, pose);
  const ends = new Set(plans.map(({ plan }) => Math.round(plan.end.x / 20)));
  assert.ok(ends.size > 40, `${ends.size} different places`);
  const tricks = new Set(plans.filter(({ asked }) => asked === "roam-trick").map(({ plan }) => plan.name));
  assert.ok(tricks.size >= 4, [...tricks].join());
  for (const { plan, g } of plans) {
    const fr = plan.frames;
    for (let i = 1; i < fr.length; i += 1) assert.ok(fr[i].t >= fr[i - 1].t, plan.name);
    const last = fr[fr.length - 1];
    assert.deepEqual({ x: last.x, y: last.y }, plan.end, plan.name);
    for (const f of fr) {
      // (Climbing, his hands and toes are right on the screen's edge: a little past left and right.)
      assert.ok(f.x >= g.left - g.u * 0.25 && f.x <= g.right + g.u * 0.25, `${plan.name} x ${f.x}`);
      assert.ok(f.y <= g.floor + 1 && f.y >= g.top - g.u * 0.5, `${plan.name} y ${f.y}`);
    }
    assert.ok(plan.duration <= R.MOST_MS, `${plan.name} ${plan.duration}`);
    if (plan.name === "roam" || plan.name === "look" || plan.name === "wave") {
      assert.ok(Math.abs(plan.end.y - g.floor) < 1, "ends on the floor");
      assert.equal(plan.endPose, "standing", "ends standing, ready for the next");
    }
  }
});

test("cheap to play: pictures change only at a step, cross-fades are short, few effects", () => {
  for (const { plan } of wander(200, 15)) {
    const times = new Set(plan.frames.map((f) => f.t));
    for (const p of plan.poses) {
      assert.ok(times.has(p.t), `${plan.name}: a picture changes at ${p.t}, between steps`);
      if (plan.name === "roam" || plan.name === "slide") assert.ok(p.fade <= R.MAX_FADE, `${plan.name} fade ${p.fade}`);
    }
    if (plan.name === "roam") assert.ok(plan.fx.length <= plan.duration / 150, `${plan.name}: ${plan.fx.length} effects in ${plan.duration} ms`);
  }
});

test("he doesn't stop where the mouse is", () => {
  const pointer = { x: 720, y: 880 };
  let near = 0;
  for (const { plan, g } of wander(200, 41, { pointer })) {
    if (plan.name === "roam" && Math.abs(plan.end.x - pointer.x) < g.u * 2.2) near += 1;
  }
  assert.equal(near, 0);
});

test("from standing, a move from pilot-motion.js carries on without popping back to rest", () => {
  const g = geo();
  const cele = R.fromPose(M.plan("celebrate", g), "standing", g);
  assert.equal(cele.poses[0].pose, "standing");
  const nod = M.plan("nod", g);
  const after = R.fromPose(nod, "standing", g);
  assert.equal(after.poses[0].pose, "standing");
  assert.ok(after.poses.some((p) => p.pose === "rest" && p.t > 0), "sits down first");
  assert.equal(after.duration > nod.duration, true);
  assert.equal(R.fromPose(nod, "rest", g), nod);
  const sit = R.sit(g, "standing");
  assert.equal(sit.endPose, "rest");
  assert.equal(R.sit(g, "rest"), null);
});

test("the robot window may load roam.js, and nothing else new", () => {
  assert.equal(csp.serve(path.join(__dirname, "..", ".."), "pilot://app/src/core/roam.js", []).status, 200);
  assert.equal(csp.serve(path.join(__dirname, "..", ".."), "pilot://app/src/core/engine.js", []).status, 404);
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "src", "renderer", "robot.html"), "utf8");
  assert.ok(html.indexOf("pilot-motion.js") < html.indexOf("roam.js") && html.indexOf("roam.js") < html.indexOf("robot.js"));
});

test("the pointer resting near him during a pause: he moves on now", async () => {
  const timers = fakeTimers();
  const sent = [];
  const life = lifeCore.create({ motion: M, send: (c) => sent.push(c.move), context: () => ({ level: "always" }), check: async () => ({}),
    random: seeded(3), timers });
  life.start();
  await timers.list.shift().fn(); // a move
  life.nudge(); // mid-move: nothing changes
  assert.equal(timers.list[0].ms, R.MOST_MS);
  life.settled(); // the pause
  assert.ok(timers.list[0].ms >= 1000);
  life.nudge();
  assert.equal(timers.list.length, 1);
  assert.equal(timers.list[0].ms, 0, "the next move starts at once");
});
