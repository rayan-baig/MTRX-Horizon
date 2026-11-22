// Pilot for Mac 1.3: the 80 tricks. Each is registered once with a name and
// a category, plays and cleans up after itself in a headless page, never
// mirrors a picture or faces away from where he goes, keeps to its season
// and time of day, and "Always moving" stays travel-first.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const M = require("../../src/core/pilot-motion");
const R = require("../../src/core/roam");
const T = require("../../src/core/tricks");
const lifeCore = require("../../src/main/life");
const Props = require("../../src/renderer/props");
const csp = require("../../src/main/csp");

const ROOT = path.join(__dirname, "..", "..");
const POSES = Object.keys(R.posesFromFiles(fs.readdirSync(path.join(ROOT, "assets", "poses"))));
const seeded = (seed) => { let s = seed || 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const geo = (extra) => ({ pos: { x: 700, y: 892 }, floor: 892, left: 68, right: 1372, top: 187, u: 110, poses: POSES, random: seeded(5),
  profile: "desktop", sky: 540, ...(extra || {}) });

test("80 new tricks, each with a unique short name, an id and a category", () => {
  assert.equal(T.LIST.length, 80);
  const ids = new Set(T.LIST.map((m) => m.id));
  const names = new Set(T.LIST.map((m) => m.name));
  assert.equal(ids.size, 80);
  assert.equal(names.size, 80);
  // Not the same as any of the classic moves.
  for (const old of ["walk", "run", "fly", "climb", "backflip", "spin", "bounce", "peek", "wave", "look", "nod", "football", "soccer", "tennis",
    "celebrate", "slide", "point", "power", "love", "wait", "land", "home", "trick", "sport", "stroll", "roam", "roam-trick", "roam-look", "roam-wave"]) {
    assert.ok(!ids.has(old), old);
  }
  const per = {};
  for (const m of T.LIST) {
    assert.ok(T.CATEGORIES.includes(m.cat), m.cat);
    assert.match(m.name, /^[A-Z][A-Za-z ,'-]{2,30}$/, m.name);
    assert.ok(m.poses.length >= 1, m.id);
    for (const p of m.poses) assert.ok(R.ALL_POSES.includes(p), `${m.id}: ${p}`);
    per[m.cat] = (per[m.cat] || 0) + 1;
  }
  assert.deepEqual(per, { Dances: 9, Sports: 12, "Fun and Tricks": 15, Moods: 15, Screen: 15, Seasonal: 14 });
});

test("every trick plans from anywhere, stays on screen, and ends on the floor ready for the next move", () => {
  for (const m of T.LIST) {
    for (const [x, y] of [[90, 892], [700, 892], [1350, 892], [700, 500], [300, 250]]) {
      const g = geo({ pos: { x, y }, random: seeded(x + m.id.length) });
      const plan = T.plan(m.id, g, x === 700 && y === 892 ? "rest" : "standing");
      assert.ok(plan && plan.duration > 500 && plan.duration <= R.MOST_MS, `${m.id} ${plan && plan.duration}`);
      assert.equal(plan.name, m.id);
      const fr = plan.frames;
      for (let i = 1; i < fr.length; i += 1) assert.ok(fr[i].t >= fr[i - 1].t, m.id);
      for (const f of fr) {
        assert.ok(f.x >= g.left - g.u * 0.9 && f.x <= g.right + g.u * 0.9, `${m.id} x ${f.x}`);
        assert.ok(f.y <= g.floor + 1 && f.y >= 0, `${m.id} y ${f.y}`);
      }
      assert.ok(Math.abs(plan.end.y - g.floor) < 1, `${m.id} ends on the floor`);
      assert.ok(plan.end.x >= g.left - 1 && plan.end.x <= g.right + 1, `${m.id} ends on screen`);
      assert.equal(plan.endPose, m.endRest ? "rest" : "standing", m.id);
      const times = new Set(fr.map((f) => f.t));
      for (const p of plan.poses) assert.ok(times.has(p.t) || p.t === 0, `${m.id}: a picture changes between steps`);
    }
  }
});

test("every trick uses the poses it says it does (with the owner's pictures there)", () => {
  for (const m of T.LIST) {
    const used = new Set();
    for (let i = 1; i <= 6; i += 1) for (const p of T.plan(m.id, geo({ random: seeded(i * 13) }), "standing").poses) used.add(p.pose);
    // (A climb shows climb1 on the right edge and its mirror image, climb1-left, on the left.)
    for (const p of m.poses) assert.ok(used.has(p) || used.has(`${p}-left`), `${m.id} never shows ${p}`);
  }
});

test("no picture is ever mirrored, and none faces away from where he's going", () => {
  for (const m of T.LIST) {
    for (let i = 1; i <= 4; i += 1) {
      const plan = T.plan(m.id, geo({ pos: { x: 200 + 300 * i, y: 892 }, random: seeded(i + 3) }), "standing");
      for (const f of plan.frames) assert.ok(f.sx > 0 && f.sy > 0, `${m.id}: sx ${f.sx} sy ${f.sy}`);
      for (const p of plan.props) for (const f of p.frames) assert.ok(f.sx > 0 && f.sy > 0, `${m.id}: prop ${p.kind} flipped`);
      const fr = plan.frames;
      for (let j = 1; j < fr.length; j += 1) {
        const dx = fr[j].x - fr[j - 1].x;
        if (Math.abs(dx) < 3 || Math.abs(fr[j].r) > 30) continue; // turning round (a cartwheel, a flip) faces no way
        const pose = plan.poses.filter((q) => q.t <= fr[j - 1].t).pop().pose;
        assert.ok(R.suits(pose, Math.sign(dx)), `${m.id}: ${pose} while going ${dx > 0 ? "right" : "left"}`);
      }
    }
  }
  for (const file of ["src/core/tricks.js", "src/renderer/props.js", "src/renderer/tricks.css", "src/renderer/sounds.js"]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(text, /scaleX\(\s*-|scale\(\s*-|rotateY\(|sx:\s*-|scale\(-1/, file);
  }
});

test("every prop and effect is drawn, and every prop has faded out before the move ends", () => {
  const kinds = new Set(Props.PROPS.concat(["soccer", "football", "goal", "net", "tennisball", "tennisnet", "court", "racket"]));
  const fx = new Set(Props.FX.concat(["dust", "trail", "sparkle", "bubble", "orb"]));
  for (const m of T.LIST) {
    const plan = T.plan(m.id, geo(), "standing");
    for (const p of plan.props) {
      assert.ok(kinds.has(p.kind), `${m.id}: no drawing for ${p.kind}`);
      const last = p.frames[p.frames.length - 1];
      assert.ok(!last || last.o === 0, `${m.id}: ${p.kind} still showing at the end`);
      for (const f of p.frames) assert.ok(f.t <= plan.duration, `${m.id}: ${p.kind} after the end`);
    }
    for (const f of plan.fx) assert.ok(fx.has(f.kind), `${m.id}: no effect ${f.kind}`);
    assert.ok(plan.fx.length <= 70, `${m.id}: ${plan.fx.length} effects`);
  }
  for (const name of Props.PICTURES) assert.ok(fs.existsSync(path.join(ROOT, "assets", "props", `${name}.webp`)), name);
});

// ---------------------------------------------------------------- headless: plays and cleans up

function page() {
  const dom = new JSDOM("<!doctype html><div id=stage></div>", { pretendToBeVisual: true });
  const w = dom.window;
  w.Element.prototype.animate = function animate(keyframes, opts) {
    return { keyframes, opts, currentTime: 0, cancel() {}, pause() {}, onfinish: null };
  };
  w.Element.prototype.getAnimations = () => [];
  global.getComputedStyle = w.getComputedStyle.bind(w);
  global.PilotMotion = M;
  delete require.cache[require.resolve("../../src/core/pilot-actor")];
  return { w, A: require("../../src/core/pilot-actor") };
}
const squeeze = (plan, ms) => {
  const k = ms / plan.duration;
  const by = (list) => list.map((x) => ({ ...x, t: Math.round(x.t * k) }));
  return { ...plan, duration: ms, frames: by(plan.frames), poses: by(plan.poses), fx: by(plan.fx), props: plan.props.map((p) => ({ ...p, frames: by(p.frames) })) };
};

test("headless: each trick plays, draws its props and effects, and leaves nothing behind", async () => {
  const { w, A } = page();
  const stage = w.document.getElementById("stage");
  Props.attach(stage);
  const poses = Object.fromEntries(POSES.map((p) => [p, `${p}.webp`]));
  const actor = A.create({ doc: w.document, stage, art: { body: "b.webp", head: "h.webp", eyes: "e.webp" }, poses, x: 700, y: 892 });
  for (const m of T.LIST) {
    const plan = T.plan(m.id, geo(), actor.pose);
    const playing = actor.play(squeeze(plan, 60));
    await new Promise((r) => setTimeout(r, 20));
    const props = [...stage.querySelectorAll(".pa-prop")];
    assert.equal(props.length, plan.props.length, m.id);
    for (const p of props) assert.ok(p.querySelector("svg, img"), `${m.id}: ${p.className} drawn`);
    for (const f of stage.querySelectorAll(".pa-fx")) {
      const own = Props.FX.some((k) => f.classList.contains(`pa-fx-${k}`));
      if (own) assert.ok(f.querySelector("svg"), `${m.id}: ${f.className} drawn`);
    }
    const end = await playing;
    assert.ok(!end.stopped, m.id);
    assert.equal(stage.querySelectorAll(".pa-prop").length, 0, `${m.id}: props left behind`);
    assert.equal(actor.props, 0);
  }
  // Stopped half way (a drag): its props go at once too.
  const run = actor.play(T.plan("basketball", geo(), actor.pose));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(stage.querySelectorAll(".pa-prop").length > 0);
  actor.stop();
  assert.equal((await run).stopped, true);
  assert.equal(stage.querySelectorAll(".pa-prop").length, 0);
  // Effects remove themselves (when their animation ends, or after 2.6 s at most).
  await new Promise((r) => setTimeout(r, 2700));
  assert.equal(stage.querySelectorAll(".pa-fx").length, 0, "effects left behind");
  actor.destroy();
});

// ---------------------------------------------------------------- seasons and times

test("seasonal tricks only in their season, by the Mac's date; morning and night ones only then", () => {
  const at = (iso) => new Date(iso);
  const has = (d, id) => T.eligible(d).includes(id);
  // A November afternoon: autumn leaves and the umbrella, nothing wintry, no fireworks, no pumpkin.
  const nov = at("2026-11-21T15:00:00");
  assert.ok(has(nov, "leaves") && has(nov, "umbrella"));
  for (const id of ["snowball", "snowman", "holiday-hat", "fireworks", "countdown", "pumpkin", "flowers", "sunglasses", "good-morning", "good-night"]) {
    assert.ok(!has(nov, id), id);
  }
  assert.ok(has(at("2026-10-15T15:00:00"), "pumpkin"));
  assert.ok(!has(at("2026-11-01T15:00:00"), "pumpkin"));
  assert.ok(has(at("2026-12-10T15:00:00"), "holiday-hat") && has(at("2026-12-10T15:00:00"), "snowball"));
  assert.ok(has(at("2027-01-20T15:00:00"), "snowman") && !has(at("2027-01-20T15:00:00"), "holiday-hat"));
  assert.ok(has(at("2026-12-31T15:00:00"), "fireworks") && has(at("2027-01-01T15:00:00"), "countdown"));
  assert.ok(!has(at("2027-01-05T15:00:00"), "fireworks"));
  assert.ok(has(at("2027-04-10T15:00:00"), "flowers") && has(at("2027-07-10T15:00:00"), "sunglasses"));
  assert.ok(!has(at("2027-07-10T15:00:00"), "umbrella"));
  assert.ok(has(at("2026-11-21T07:30:00"), "good-morning") && !has(at("2026-11-21T12:00:00"), "good-morning"));
  assert.ok(has(at("2026-11-21T22:00:00"), "good-night") && has(at("2026-11-21T02:00:00"), "good-night") && !has(at("2026-11-21T18:00:00"), "good-night"));
  // Any day: the cake and the party popper; and most tricks fit any time.
  assert.ok(has(nov, "cake") && has(nov, "party-popper"));
  assert.ok(T.eligible(nov).length >= 66);
  // Always moving never picks one out of season.
  const r = seeded(3);
  for (let i = 0; i < 500; i += 1) {
    const id = T.choose(nov, r);
    if (id) assert.ok(T.fits(T.BY[id], nov), id);
  }
});

// ---------------------------------------------------------------- the scheduler stays travel-first

function fakeTimers() {
  const list = [];
  return { list, setTimeout: (fn, ms) => { const t = { fn, ms }; list.push(t); return t; }, clearTimeout: (t) => { const i = list.indexOf(t); if (i >= 0) list.splice(i, 1); } };
}

test("Always moving stays travel-first: a trick every minute or two, mostly the new ones, never two in a row", async () => {
  const timers = fakeTimers();
  let clock = Date.parse("2026-11-21T15:00:00");
  const start = clock;
  const sent = [];
  const life = lifeCore.create({ motion: M, send: (c) => sent.push({ ...c, at: clock }), context: () => ({ level: "always" }), check: async () => ({}),
    random: seeded(11), now: () => clock, timers });
  life.start();
  // Two hours: each move "plays" for a typical time, then the pause.
  const LEN = { roam: 7000, "roam-look": 1500, "roam-wave": 1500, "roam-trick": 5000 };
  let busy = 0;
  let travel = 0;
  while (clock - start < 2 * 3600 * 1000) {
    const t = timers.list.shift();
    clock += t.ms;
    await t.fn();
    const last = sent[sent.length - 1];
    if (last && last.at === clock) {
      clock += LEN[last.move];
      busy += LEN[last.move];
      if (last.move === "roam") travel += LEN[last.move];
      life.settled();
    }
  }
  const tricks = sent.filter((c) => c.move === "roam-trick");
  const minutes = (clock - start) / 60000;
  assert.ok(tricks.length >= minutes / 2.2 && tricks.length <= minutes / 0.9, `${tricks.length} tricks in ${minutes} minutes`);
  for (let i = 1; i < tricks.length; i += 1) {
    const gap = tricks[i].at - tricks[i - 1].at;
    assert.ok(gap >= R.TRICK_GAP[0] && gap <= R.TRICK_GAP[1] + 30000, `gap ${gap}`);
  }
  for (let i = 1; i < sent.length; i += 1) assert.ok(!(sent[i].move === "roam-trick" && sent[i - 1].move === "roam-trick"));
  const fresh = tricks.filter((c) => c.trick).length;
  assert.ok(fresh / tricks.length > 0.65 && fresh / tricks.length < 0.95, `${fresh} of ${tricks.length} new`);
  assert.ok(travel / busy > 0.75, `travelling ${Math.round((100 * travel) / busy)}% of the time`);
  assert.ok(sent.filter((c) => c.move === "roam").length > 4 * tricks.length);
  for (const c of tricks) if (c.trick) assert.ok(T.fits(T.BY[c.trick], new Date(c.at)), c.trick);
  // No repeats close together.
  const ids = tricks.filter((c) => c.trick).map((c) => c.trick);
  for (let i = 1; i < ids.length; i += 1) assert.ok(!ids.slice(Math.max(0, i - 10), i).includes(ids[i]), `${ids[i]} again too soon`);
});

test("the robot window may load tricks.js and the prop pictures, and nothing else new", () => {
  for (const ok of ["src/core/tricks.js", "src/renderer/props.js", "src/renderer/sounds.js", "src/renderer/tricks.css", "assets/props/door.webp", "assets/poses/surf.webp"]) {
    assert.equal(csp.serve(ROOT, `pilot://app/${ok}`, []).status, 200, ok);
  }
  for (const bad of ["src/main/linkread.js", "assets/props/x.png", "assets/props/door.svg", "tools/poses.py"]) {
    assert.equal(csp.serve(ROOT, `pilot://app/${bad}`, []).status, 404, bad);
  }
  const html = fs.readFileSync(path.join(ROOT, "src", "renderer", "robot.html"), "utf8");
  assert.ok(html.indexOf("roam.js") < html.indexOf("tricks.js") && html.indexOf("tricks.js") < html.indexOf("robot.js"));
  assert.ok(html.indexOf("props.js") < html.indexOf("robot.js") && html.indexOf("sounds.js") < html.indexOf("robot.js"));
});

test("smoother: springs, anticipation, squash and stretch, arcs, and a walk whose steps match its speed", () => {
  assert.match(R.EASE.spring, /^linear\(0, .*, 1\)$/);
  const vals = R.EASE.spring.slice(7, -1).split(",").map(Number);
  assert.ok(Math.max(...vals) > 1.05 && Math.max(...vals) < 1.35, "a little overshoot");
  // Walk (1.5): a steady rhythm of 1.6 to 2 steps a second, one stride per
  // step in the middle of the walk (no sliding feet), no lean or squash.
  for (const pace of [0.88, 1, 1.14]) {
    const gt = R.gait({ u: 110, pace }, false);
    assert.ok(gt.cadence >= 1.6 && gt.cadence <= 2, `cadence ${gt.cadence}`);
    const plan = R.walkTo({ ...geo(), pace }, 1100, "standing");
    const steps = plan.poses.filter((p) => p.pose === "walk1" || p.pose === "walk2");
    assert.ok(steps.length >= 4);
    for (let i = 2; i < steps.length; i += 1) assert.ok(Math.abs(steps[i].t - steps[i - 1].t - gt.stepMs) < 1.5, `step ${steps[i].t - steps[i - 1].t} ms`);
    const xAt = (t) => plan.frames.find((f) => Math.abs(f.t - t) < 0.01).x;
    const mid = xAt(steps[3].t) - xAt(steps[2].t);
    assert.ok(Math.abs(mid - gt.stride) < gt.stride * 0.2, `a step covers ${mid}, the stride is ${gt.stride}`);
    assert.ok(plan.poses.some((p) => p.pose === "walk2"), "a real second walk frame");
    assert.ok(plan.frames.every((f) => Math.abs(f.r) <= 1 && f.sx === 1 && f.sy === 1), "no lean or squash while walking");
  }
  // A jump: a crouch before it, a stretch going up, a squash on landing.
  const k = R.track({ x: 700, y: 892 }, POSES, "standing");
  R.jump(k, geo(), { h: 50 });
  const plan = k.done("jump");
  assert.equal(plan.frames[1].e, R.EASE.anticipate);
  assert.ok(plan.frames[1].sy < 0.9);
  assert.ok(plan.frames.some((f) => f.sy > 1.05 && f.y < 880), "stretched in the air");
  assert.ok(plan.frames.some((f) => f.sy < 0.85 && f.y > 891), "squashed landing");
  assert.equal(plan.frames[plan.frames.length - 1].e, R.EASE.spring);
  const ys = plan.frames.map((f) => f.y);
  assert.ok(ys.filter((y) => y < 892 - 10).length >= 5, "on an arc (many points), not a straight line");
  // Flights: many sampled points along the curve.
  const fl = R.plan("roam", geo({ random: () => 0.6 }), "standing");
  assert.ok(fl.frames.length > 20);
});
