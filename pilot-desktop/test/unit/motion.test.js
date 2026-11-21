// The moving robot: poses and their fallbacks, new pose pictures being picked
// up, when it may move (calm mode, reduce motion, the chat, typing, full
// screen), click-through, and the props being cleaned up after a trick.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const M = require("../../src/core/pilot-motion");
const poses = require("../../src/main/poses");
const overlay = require("../../src/main/overlay");
const lifeCore = require("../../src/main/life");

// The owner's pose set (18 pictures).
const ALL = ["standing", "sitting", "wave", "walk1", "run1", "fly", "climb1", "flip", "throw", "kick", "tennis", "celebrate",
  "slide", "point", "power", "love", "land", "arms-crossed"];
const FEW = ["standing", "wave", "walk1", "run1", "climb1"];
const seeded = (seed) => { let s = seed || 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const geo = (extra) => ({ pos: { x: 700, y: 892 }, home: { x: 1300, y: 892 }, floor: 892, left: 68, right: 1372, top: 187, u: 110,
  poses: ALL, random: seeded(3), profile: "desktop", ...(extra || {}) });

// ---------------------------------------------------------------- poses

test("a pose without a picture falls back, and in the end to the resting robot", () => {
  assert.equal(M.resolvePose("wave", ALL), "wave");
  assert.equal(M.resolvePose("walk2", ALL), "standing"); // between walk1 steps
  assert.equal(M.resolvePose("climb2", ALL), "climb1");
  assert.equal(M.resolvePose("run2", ALL), "walk1"); // running alternates run1 and walk1
  assert.equal(M.resolvePose("throw", FEW), "wave");
  assert.equal(M.resolvePose("kick", FEW), "run1");
  assert.equal(M.resolvePose("tennis", FEW), "standing");
  for (const name of ALL) assert.equal(M.resolvePose(name, ALL), name);
  assert.equal(M.resolvePose("walk2", ["walk1"]), "walk1");
  assert.equal(M.resolvePose("run2", []), "rest");
  assert.equal(M.resolvePose("wave", []), "rest");
  assert.equal(M.resolvePose("no-such-pose", ALL), "rest");
  for (const name of M.POSES) assert.equal(M.resolvePose(name, []), "rest", name);
});

test("every name in the owner's pose sheet is a pose, with sensible fallbacks", () => {
  for (const name of ALL.concat(["dash", "walk2", "run2", "climb2"])) assert.ok(M.POSES.includes(name), name);
  assert.equal(M.resolvePose("celebrate", FEW), "standing");
  assert.equal(M.resolvePose("dash", FEW), "run1");
  assert.equal(M.resolvePose("power", FEW), "standing");
  assert.equal(M.resolvePose("land", FEW), "standing");
  for (const name of ["slide", "point", "love", "arms-crossed"]) assert.equal(M.resolvePose(name, FEW), "rest", name); // used only when there
  assert.deepEqual(M.posesFromFiles(["arms-crossed.webp", "land.png"]), { "arms-crossed": "arms-crossed.webp", land: "land.png" });
});

test("new pose pictures are used as soon as they're there", () => {
  const more = ALL.concat(["dash"]);
  const has = (plan, pose) => plan.poses.some((p) => p.pose === pose);
  assert.ok(has(M.plan("soccer", geo({ poses: more })), "celebrate"));
  assert.ok(has(M.plan("backflip", geo({ poses: more })), "power"));
  assert.ok(has(M.plan("backflip", geo({ poses: more })), "celebrate"));
  assert.ok(has(M.plan("run", geo({ poses: more, random: seeded(8) })), "dash"));
  assert.ok(has(M.plan("wave", geo({ poses: more }), { how: "gentle" }), "love"));
  assert.ok(has(M.plan("look", geo({ poses: more }), { at: { x: 100, y: 300 } }), "point"));
  assert.ok(has(M.plan("peek", geo({ poses: more, pos: { x: 1360, y: 892 } })), "slide"));
  // And without them, the same moves play as before.
  assert.ok(has(M.plan("fly", geo({ poses: more, random: seeded(4) })), "land"));
  assert.ok(has(M.plan("wait", geo({ poses: more })), "arms-crossed"));
  for (const name of ["celebrate", "point", "power", "love"]) assert.ok(has(M.plan(name, geo({ poses: more })), name), name);
  assert.ok(has(M.plan("slide", geo({ poses: more })), "slide"));
  assert.ok(!has(M.plan("wave", geo({ poses: FEW }), { how: "gentle" }), "love"));
  assert.ok(!has(M.plan("look", geo({ poses: FEW }), { at: { x: 100, y: 300 } }), "standing"));
});

test("props drawn into pictures hand over to the drawn-in-code ones", () => {
  // Football: the throw picture holds the ball; at the release it gives way
  // to the follow-through and the code's football appears at its hand.
  const fb = M.plan("football", geo());
  const ball = fb.props.find((p) => p.kind === "football");
  const firstSeen = ball.frames.find((f) => f.o > 0);
  const toWave = fb.poses.find((p) => p.pose === "wave");
  assert.ok(fb.poses.some((p) => p.pose === "throw"));
  assert.ok(toWave && Math.abs(firstSeen.t - toWave.t) < 1, "the ball appears exactly when the throw picture goes");
  // Soccer: the kick picture shows its ball, ours is hidden for that moment.
  const sc = M.plan("soccer", geo());
  const kickAt = sc.poses.find((p) => p.pose === "kick").t;
  const sball = sc.props.find((p) => p.kind === "soccer");
  const during = sball.frames.filter((f) => f.t <= kickAt + 50).pop(); // its state just after the kick starts
  assert.equal(during.o, 0, "our ball hides while the picture's ball shows");
  assert.ok(sball.frames.some((f) => f.t > kickAt + 100 && f.o === 1));
  // Tennis: the picture has its own racket (no drawn one), and plays toward its racket side.
  const tn = M.plan("tennis", geo());
  assert.ok(!tn.props.some((p) => p.kind === "racket"));
  assert.ok(tn.end.x >= geo().pos.x);
  assert.ok(M.plan("tennis", geo({ poses: FEW })).props.some((p) => p.kind === "racket"));
});

test("cheers: celebrate when an allowed action is done, hearts for thanks or a long-awaited return", () => {
  assert.equal(M.cheer("done", {}), "celebrate");
  assert.equal(M.cheer("thanks", {}), "love");
  assert.equal(M.cheer("missed", {}), "love");
  for (const ctx of [{ reducedMotion: true }, { calm: true }, { typing: true }, { fullscreen: true }, { hidden: true }]) {
    assert.equal(M.cheer("done", ctx), null, JSON.stringify(ctx));
  }
  assert.equal(M.cheer("nonsense", {}), null);
});

test("every move still plays with no pose pictures at all", () => {
  for (const name of ["walk", "run", "fly", "climb", "backflip", "spin", "bounce", "peek", "wave", "look", "football", "soccer", "tennis",
    "celebrate", "slide", "point", "power", "love", "wait", "land"]) {
    const plan = M.plan(name, geo({ poses: [] }));
    assert.ok(plan && plan.duration > 0, name);
    assert.deepEqual([...new Set(plan.poses.map((p) => p.pose))], ["rest"], name);
  }
});

test("a pose picture dropped into assets/poses/ is picked up, with no code change", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-poses-"));
  try {
    assert.deepEqual(poses.list(dir), {});
    fs.writeFileSync(path.join(dir, "kick.png"), "x");
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    fs.writeFileSync(path.join(dir, "dance.webp"), "x"); // not a pose name
    assert.deepEqual(poses.list(dir), { kick: "../../assets/poses/kick.png" });
    fs.writeFileSync(path.join(dir, "kick.webp"), "x"); // WebP wins
    fs.writeFileSync(path.join(dir, "walk2.webp"), "x");
    const found = poses.list(dir);
    assert.equal(found.kick, "../../assets/poses/kick.webp");
    assert.equal(M.resolvePose("kick", found), "kick");
    assert.equal(M.resolvePose("walk2", found), "walk2");
    // A plan uses it straight away.
    const plan = M.plan("soccer", geo({ poses: Object.keys(found).concat(["run1", "run2", "standing"]) }));
    assert.ok(plan.poses.some((p) => p.pose === "kick"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the shipped pose pictures are all known poses", () => {
  const dir = path.join(__dirname, "..", "..", "assets", "poses");
  const found = poses.list(dir);
  const files = fs.readdirSync(dir).map((f) => f.replace(/\.(webp|png)$/, ""));
  assert.deepEqual(Object.keys(found).sort(), files.sort());
  // The owner's 18 earlier poses are all still there (1.3 adds the bigger sheet).
  for (const name of ALL) assert.ok(found[name], name);
});

// ---------------------------------------------------------------- when it moves

test("nothing wanders in calm mode, under reduce motion, while chatting, typing or full screen", () => {
  const r = seeded(11);
  for (const ctx of [{ calm: true }, { reducedMotion: true }, { chatOpen: true }, { typing: true }, { fullscreen: true },
    { hidden: true }, { dragging: true }, { calm: true, energy: "playful" }]) {
    for (let i = 0; i < 200; i += 1) assert.equal(M.pick(ctx, r), null, JSON.stringify(ctx));
  }
  assert.equal(M.stillReason({ reducedMotion: true }), "reduced-motion");
  assert.equal(M.stillReason({ calm: true }), "calm");
  assert.equal(M.stillReason({ chatOpen: true }), "chat");
  // Reduce motion means calm by default, but the user may turn calm off.
  assert.equal(M.isCalm({ calm: null, reducedMotion: true }), true);
  assert.equal(M.isCalm({ calm: false, reducedMotion: true }), false);
  assert.ok(M.pick({ calm: false, reducedMotion: true }, r));
});

test("most of the time it rests: 30 to 120 seconds between moves", () => {
  const r = seeded(5);
  for (let i = 0; i < 100; i += 1) {
    const ms = M.nextDelay({ energy: "normal" }, r);
    assert.ok(ms >= 30000 && ms <= 120000, ms);
  }
  assert.ok(M.nextDelay({ energy: "low" }, () => 0) > M.nextDelay({ energy: "playful" }, () => 0));
});

test("sports tricks are rare, more often on Playful, never when it must keep still", () => {
  const count = (energy) => {
    const r = seeded(17);
    let n = 0;
    for (let i = 0; i < 4000; i += 1) if (M.pick({ energy }, r) === "sport") n += 1;
    return n;
  };
  const normal = count("normal");
  const playful = count("playful");
  assert.ok(normal > 0 && normal < 4000 * 0.05, normal);
  assert.ok(playful > normal * 2, `${playful} vs ${normal}`);
  for (const ctx of [{ calm: true }, { reducedMotion: true }, { chatOpen: true }, { typing: true }]) {
    const r = seeded(2);
    for (let i = 0; i < 500; i += 1) assert.notEqual(M.pick({ ...ctx, energy: "playful" }, r), "sport");
  }
});

test("waves: when the user comes back or the chat opens, gently in calm mode, still under reduce motion", () => {
  assert.equal(M.reaction("return", {}), "wave");
  assert.equal(M.reaction("chat", {}), "gentle");
  assert.equal(M.reaction("return", { calm: true }), "gentle");
  assert.equal(M.reaction("return", { reducedMotion: true }), "still");
  assert.equal(M.reaction("return", { typing: true }), null);
  assert.equal(M.reaction("return", { fullscreen: true }), null);
  assert.equal(M.reaction("nonsense", {}), null);
  const still = M.plan("wave", geo(), { how: "still" });
  assert.equal(still.frames.length, 2); // no movement at all, just the bubble
  assert.equal(still.fx[0].kind, "bubble");
});

function fakeTimers() {
  const list = [];
  return {
    list,
    setTimeout: (fn, ms) => { const t = { fn, ms }; list.push(t); return t; },
    clearTimeout: (t) => { const i = list.indexOf(t); if (i >= 0) list.splice(i, 1); },
  };
}

test("the main process's timer sends no move in calm mode, under reduce motion or while chatting", async () => {
  for (const ctx of [{ calm: true }, { reducedMotion: true }, { chatOpen: true }]) {
    const sent = [];
    const life = lifeCore.create({ motion: M, send: (c) => sent.push(c), context: () => ctx, check: async () => ({}), random: seeded(1), timers: fakeTimers() });
    for (let i = 0; i < 50; i += 1) await life.tick();
    assert.deepEqual(sent, [], JSON.stringify(ctx));
  }
  // Typing (found by the check just before a move) keeps it still too.
  const sent = [];
  const life = lifeCore.create({ motion: M, send: (c) => sent.push(c), context: () => ({}), check: async () => ({ typing: true }), random: seeded(1), timers: fakeTimers() });
  for (let i = 0; i < 50; i += 1) await life.tick();
  assert.deepEqual(sent, []);
  // Otherwise it does something now and then.
  const moves = [];
  const free = lifeCore.create({ motion: M, send: (c) => moves.push(c), context: () => ({}), check: async () => ({}), random: seeded(1), timers: fakeTimers() });
  for (let i = 0; i < 20; i += 1) await free.tick();
  assert.equal(moves.length, 20);
  // Reactions follow the same rules.
  assert.equal(lifeCore.create({ motion: M, send: () => {}, context: () => ({ chatOpen: true }) }).react("chat"), "gentle");
});

test("the timer waits once, and starts again after a settings change", () => {
  const timers = fakeTimers();
  const life = lifeCore.create({ motion: M, send: () => {}, context: () => ({ energy: "normal" }), random: () => 0.5, timers });
  life.start();
  const waits = timers.list.map((t) => t.ms);
  assert.ok(waits.includes(75000), waits); // the move timer: halfway between 30 and 120 s
  life.restart();
  assert.equal(timers.list.filter((t) => t.ms === 75000).length, 1);
  life.stop();
  assert.equal(timers.list.length, 0);
});

// ---------------------------------------------------------------- the overlay

test("click-through: only the robot (or a drag) takes the mouse, and the window is told only on change", () => {
  const calls = [];
  const win = { setIgnoreMouseEvents: (...a) => calls.push(a), isDestroyed: () => false };
  const gate = new overlay.MouseGate(win);
  assert.deepEqual(calls, [[true, { forward: true }]]);
  gate.set({ over: false });
  assert.equal(calls.length, 1);
  gate.set({ over: true });
  assert.deepEqual(calls[1], [false]);
  gate.set({ dragging: true });
  gate.set({ over: false }); // still dragging
  assert.equal(calls.length, 2);
  gate.set({ dragging: false });
  assert.deepEqual(calls[2], [true, { forward: true }]);
  assert.equal(M.hit({ left: 10, top: 10, right: 20, bottom: 20 }, { x: 15, y: 15 }), true);
  assert.equal(M.hit({ left: 10, top: 10, right: 20, bottom: 20 }, { x: 25, y: 15 }), false);
  assert.equal(M.hit({ left: 10, top: 10, right: 20, bottom: 20 }, { x: 22, y: 15 }, 2), true);
});

test("home stays inside the work area (never the menu bar or the Dock), and Pilot 1.0's spot carries over", () => {
  const area = { x: 0, y: 25, width: 1440, height: 800 };
  const h = overlay.clampHome({ x: -50, y: 0 }, area, 110);
  assert.ok(h.x >= 66 && h.y >= 25 + 121, JSON.stringify(h));
  const low = overlay.clampHome({ x: 5000, y: 5000 }, area, 110);
  assert.ok(low.x <= 1440 - 66 && low.y <= 825 - 4);
  assert.deepEqual(overlay.homeFromLegacy({ x: 100, y: 200 }, 110), { x: 164, y: 318 });
  assert.equal(overlay.homeFromLegacy(null), null);
});

test("full screen in front, typing and coming back are guessed sensibly", () => {
  const display = { bounds: { x: 0, y: 0, width: 1440, height: 900 } };
  const info = (w) => ({ pid: 42, windows: [w] });
  assert.equal(overlay.fullscreenFront(info({ pid: 42, layer: 0, x: 0, y: 0, w: 1440, h: 900 }), display, 7), true);
  assert.equal(overlay.fullscreenFront(info({ pid: 42, layer: 0, x: 0, y: 25, w: 1440, h: 800 }), display, 7), false);
  assert.equal(overlay.fullscreenFront(info({ pid: 9, layer: 0, x: 0, y: 0, w: 1440, h: 900 }), display, 7), false); // not the front app
  assert.equal(overlay.fullscreenFront(info({ pid: 7, layer: 0, x: 0, y: 0, w: 1440, h: 900 }), display, 7), false); // Pilot itself
  assert.equal(overlay.fullscreenFront(null, display, 7), false);
  assert.equal(overlay.typingGuess(0, { x: 1, y: 1 }, { x: 1, y: 1 }), true);
  assert.equal(overlay.typingGuess(0, { x: 1, y: 1 }, { x: 5, y: 1 }), false);
  assert.equal(overlay.typingGuess(30, { x: 1, y: 1 }, { x: 1, y: 1 }), false);
  assert.equal(overlay.backFromIdle(600, 1), true);
  assert.equal(overlay.backFromIdle(20, 1), false);
});

// ---------------------------------------------------------------- plans

test("plans stay on the page and end where they say", () => {
  const g = geo();
  for (const name of ["walk", "run", "fly", "climb", "backflip", "spin", "bounce", "peek", "wave", "football", "soccer", "tennis",
    "celebrate", "slide", "point", "power", "love", "wait", "land"]) {
    const plan = M.plan(name, geo({ random: seeded(name.length) }));
    const last = plan.frames[plan.frames.length - 1];
    assert.deepEqual({ x: last.x, y: last.y }, plan.end, name);
    for (let i = 1; i < plan.frames.length; i += 1) assert.ok(plan.frames[i].t >= plan.frames[i - 1].t, name);
    if (name !== "peek") for (const f of plan.frames) assert.ok(f.x >= g.left - g.u * 0.1 && f.x <= g.right + g.u * 0.1, `${name} x ${f.x}`);
    for (const f of plan.frames) assert.ok(f.y <= g.floor + 1 || name === "peek", `${name} y ${f.y}`);
  }
  // Walking needs the floor; in the air it flies instead.
  assert.equal(M.plan("walk", geo({ pos: { x: 700, y: 400 } })), null);
  // Soccer lasts about 4 to 6 seconds.
  const soccer = M.plan("soccer", geo());
  assert.ok(soccer.duration >= 3800 && soccer.duration <= 6500, soccer.duration);
  // The web robot always ends at home.
  const web = { pos: { x: 0, y: 0 }, home: { x: 0, y: 0 }, floor: 0, left: -1200, right: 40, top: -600, u: 88, poses: ALL, profile: "web", sky: 260, random: seeded(4), energy: "playful" };
  for (const name of ["stroll", "football", "soccer", "tennis", "climb", "fly", "peek"]) {
    const plan = M.plan(name, web);
    assert.ok(plan, name);
    assert.ok(Math.abs(plan.end.x) < 2 && Math.abs(plan.end.y) < 2, `${name} ends at ${JSON.stringify(plan.end)}`);
  }
  // On the web, soccer and tennis only on Playful.
  const normal = { ...web, energy: "normal" };
  for (let i = 0; i < 30; i += 1) assert.equal(M.plan("sport", { ...normal, random: seeded(i + 1) }).name, "football");
});

// ---------------------------------------------------------------- the actor

function domWithAnimations() {
  const dom = new JSDOM("<!doctype html><div id=stage></div>", { pretendToBeVisual: true });
  const w = dom.window;
  const made = [];
  w.Element.prototype.animate = function animate(keyframes, opts) {
    const a = { el: this, keyframes, opts, currentTime: 0, cancelled: false, cancel() { this.cancelled = true; }, pause() {}, onfinish: null };
    made.push(a);
    return a;
  };
  w.Element.prototype.getAnimations = () => [];
  return { dom, made };
}

function loadActor(w) {
  // The actor finds pilot-motion.js on its global object, as in a page.
  global.PilotMotion = M;
  delete require.cache[require.resolve("../../src/core/pilot-actor")];
  const A = require("../../src/core/pilot-actor");
  return A;
}

test("a trick's props live only while it plays: gone when it ends, and when it's stopped", async () => {
  const { dom, made } = domWithAnimations();
  const w = dom.window;
  global.getComputedStyle = w.getComputedStyle.bind(w);
  const A = loadActor(w);
  const stage = w.document.getElementById("stage");
  const actor = A.create({ doc: w.document, stage, art: { body: "b.webp", head: "h.webp", eyes: "e.webp" }, poses: { standing: "s.webp", wave: "w.webp" }, x: 700, y: 892 });
  const plan = M.plan("soccer", geo({ poses: ["standing", "wave", "run1", "run2"] }));
  assert.ok(plan.props.length >= 3);
  // Shortened so the test is quick; the props are the same.
  const quick = { ...plan, duration: 40, frames: plan.frames.map((f) => ({ ...f, t: Math.min(f.t, 40) })), poses: [plan.poses[0]], fx: [],
    props: plan.props.map((p) => ({ ...p, frames: p.frames.map((f) => ({ ...f, t: Math.min(f.t, 40) })) })) };
  const done = actor.play(quick);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(stage.querySelectorAll(".pa-prop").length, plan.props.length);
  assert.ok(stage.querySelector(".pa-prop-goal svg") && stage.querySelector(".pa-prop-soccer svg"));
  for (const p of stage.querySelectorAll(".pa-prop")) assert.equal(p.getAttribute("style"), null); // placed by animations only
  const end = await done;
  assert.deepEqual(end, plan.end);
  assert.equal(stage.querySelectorAll(".pa-prop").length, 0);
  assert.equal(actor.props, 0);
  assert.ok(made.every((a) => a.cancelled || a.opts.duration !== 40));

  // Stopped half way (a drag, a click): the props go too.
  const tennis = M.plan("tennis", geo({ poses: ["standing", "wave"] }));
  const playing = actor.play(tennis);
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(stage.querySelectorAll(".pa-prop").length >= 3);
  assert.ok(actor.el.querySelector(".pa-body .pa-prop-racket")); // held: it moves with the robot
  actor.stop();
  const res = await playing;
  assert.equal(res.stopped, true);
  assert.equal(stage.querySelectorAll(".pa-prop").length, 0);

  // Held still for pictures, then ended: the same.
  const scrub = await actor.scrub(M.plan("football", geo({ poses: ["standing", "wave"] })));
  scrub.seek(1200);
  assert.equal(stage.querySelectorAll(".pa-prop-football").length, 1);
  scrub.end();
  assert.equal(stage.querySelectorAll(".pa-prop").length, 0);
  actor.destroy();
});

test("the actor shows a pose picture when there is one, and the resting robot otherwise", async () => {
  const { dom } = domWithAnimations();
  const w = dom.window;
  global.getComputedStyle = w.getComputedStyle.bind(w);
  const A = loadActor(w);
  const stage = w.document.getElementById("stage");
  const actor = A.create({ doc: w.document, stage, art: {}, poses: { standing: "s.webp" } });
  actor.show("standing", 0);
  assert.equal(actor.pose, "standing");
  assert.ok(stage.querySelector('.pa-pose.pa-on[data-pose="standing"]'));
  assert.ok(stage.querySelector(".pa-rest.pa-off"));
  actor.show("rest", 0);
  assert.equal(stage.querySelector(".pa-pose.pa-on"), null);
  assert.equal(stage.querySelector(".pa-rest.pa-off"), null);
  actor.setPoses({ standing: "s.webp", wave: "w.webp" });
  assert.deepEqual(actor.poses().sort(), ["standing", "wave"]);
  actor.destroy();
});
