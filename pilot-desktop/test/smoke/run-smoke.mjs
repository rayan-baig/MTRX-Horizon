// Starts the real app with Playwright for Electron, clicks the robot, and
// checks the chat window, the robot's overlay and moves, screen access,
// dropped files and the security settings. With --shots it also saves
// pictures of the robot and the chat window.
//
//   node test/smoke/run-smoke.mjs [--shots <folder>]
//   PILOT_EDITION=free node test/smoke/run-smoke.mjs   (Pilot Free)
//
// Both editions go through Free mode (1.4) against a pretend Ollama and a
// pretend Draw Things on this computer: the setup cards, "Download brain"
// with its progress bar, a chat on the Mac and a picture from Draw Things.
//
// On Linux it needs a display (xvfb-run). In CI it runs on macOS.
import { _electron as electron } from "playwright-core";
import electronPath from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { execFileSync } from "node:child_process";

// A pretend OpenAI-compatible provider on this computer, for the end-to-end
// check: it streams a reply, asks for one action, and records what it got.
const seen = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const data = body ? JSON.parse(body) : {};
    seen.push(data);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const last = (data.messages || []).slice(-1)[0] || {};
    const words = typeof last.content === "string" ? last.content : JSON.stringify(last.content || "");
    if (last.role === "user" && /copy/i.test(words)) {
      send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "copy_to_clipboard", arguments: "{\"text\":\"hi from Pilot\"}" } }] } }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    } else {
      for (const part of ["Hello! ", "This is ", "the test reply."]) send({ choices: [{ index: 0, delta: { content: part } }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    }
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}/v1`;

// Pilot for Mac 1.4: which edition, and the pretend Free mode apps.
const FREE = process.env.PILOT_EDITION === "free";
const here0 = path.dirname(fileURLToPath(import.meta.url));
const ROBOT_PNG = fs.readFileSync(path.join(here0, "..", "..", "assets", "robot-512.png")).toString("base64");
const ollamaModels = [];
const ollamaSeen = [];
const ollama = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const data = body ? JSON.parse(body) : {};
    ollamaSeen.push({ url: req.url, body: data });
    const json = (v, status) => { res.writeHead(status || 200, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (req.url === "/api/version") return json({ version: "0.12.0" });
    if (req.url === "/api/tags") return json({ models: ollamaModels.map((m) => ({ name: m, model: m, size: 4.7 * 1024 ** 3, details: { parameter_size: "7.6B" } })) });
    if (req.url === "/api/show") return json({ capabilities: ["completion", "tools"] });
    if (req.url === "/api/pull") {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      const total = 4.7 * 1024 ** 3;
      const lines = [{ status: "pulling manifest" }];
      for (let i = 0; i <= 40; i += 1) lines.push({ status: "pulling 3a5b", digest: "sha256:3a5b", total, completed: Math.round((total * i) / 40) });
      lines.push({ status: "verifying sha256 digest" }, { status: "writing manifest" }, { status: "success" });
      let i = 0;
      const next = () => {
        if (i >= lines.length) { if (!ollamaModels.includes(data.model)) ollamaModels.push(data.model); res.end(); return; }
        if (lines[i].status === "success" && !ollamaModels.includes(data.model)) ollamaModels.push(data.model);
        res.write(`${JSON.stringify(lines[i])}\n`);
        i += 1;
        setTimeout(next, 150);
      };
      return next();
    }
    if (req.url === "/v1/chat/completions") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const last = (data.messages || []).slice(-1)[0] || {};
      const words = typeof last.content === "string" ? last.content : JSON.stringify(last.content || "");
      if (last.role === "user" && /draw/i.test(words) && (data.tools || []).some((t) => t.function.name === "make_image")) {
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_d", type: "function", function: { name: "make_image", arguments: "{\"prompt\":\"a friendly robot waving\"}" } }] } }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else if (last.role === "tool") {
        for (const part of ["Here's your picture, ", "drawn right here on your Mac."]) send({ choices: [{ index: 0, delta: { content: part } }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      } else {
        for (const part of ["<think>short and friendly</think>", "Hi! I'm running ", "right here on your Mac, ", "so nothing you type leaves it. ", "What shall we do?"]) {
          send({ choices: [{ index: 0, delta: { content: part } }] });
        }
        send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      }
      return res.end("data: [DONE]\n\n");
    }
    return json({ error: "not found" }, 404);
  });
});
const drawSeen = [];
const drawThings = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    drawSeen.push({ url: req.url, body: body ? JSON.parse(body) : null });
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/sdapi/v1/txt2img") setTimeout(() => res.end(JSON.stringify({ images: [ROBOT_PNG] })), 2500);
    else res.end("{}");
  });
});
// Spare ports, not listened on yet: at first Ollama and Draw Things "aren't there".
const sparePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const ollamaPort = await sparePort();
const drawPort = await sparePort();
const appsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-apps-")); // no Ollama.app, no Draw Things.app

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..", "..");
const shotsAt = process.argv.indexOf("--shots");
const shotsDir = shotsAt > 0 ? process.argv[shotsAt + 1] : "";
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-smoke-"));
const problems = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push(what); };

const args = [appDir];
if (process.platform === "linux") args.push("--no-sandbox");
// (Pilot for Mac 1.5: PILOT_SMOKE_SCALE=2 draws it as on a Retina screen, to look at the frames.)
if (process.env.PILOT_SMOKE_SCALE) args.push(`--force-device-scale-factor=${Number(process.env.PILOT_SMOKE_SCALE) || 1}`);
const env = { ...process.env, PILOT_TEST: "1", PILOT_USER_DATA: userData, PILOT_TEST_OLLAMA: `http://127.0.0.1:${ollamaPort}`,
  PILOT_TEST_DRAWTHINGS: `http://127.0.0.1:${drawPort}`, PILOT_TEST_APPS_DIR: appsDir };
delete env.NODE_OPTIONS;
const app = await electron.launch({ executablePath: electronPath, args, env });

async function pageFor(part) {
  for (let i = 0; i < 100; i += 1) {
    const found = app.windows().find((w) => w.url().includes(part));
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no window for ${part}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const grabTo = async (name) => {
  if (!shotsDir) return;
  fs.mkdirSync(shotsDir, { recursive: true });
  const b64 = await app.evaluate(async () => (await global.__pilotTest.chat().webContents.capturePage()).toPNG().toString("base64"));
  fs.writeFileSync(path.join(shotsDir, name), Buffer.from(b64, "base64"));
};

// ---------------------------------------------------------------- Pilot for Mac 1.5

const robotNow = (robot) => robot.evaluate(() => {
  const a = window.__pilotRobot.actor;
  const r = a.rect();
  return { pose: a.pose, busy: a.busy, at: a.at, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
});
async function untilPose(robot, test, ms) {
  for (let i = 0; i < (ms || 15000) / 100; i += 1) {
    const n = await robotNow(robot);
    if (n.busy && test(n.pose)) return n;
    await wait(100);
  }
  return null;
}
async function settle(robot) {
  await robot.evaluate(() => window.__pilotRobot.actor.stop());
  await wait(300);
}

// Frames of one move held still at given moments, cropped around him (for
// looking at the walk cycle, the climb and so on): <prefix>-NN.png.
async function frames(robot, prefix, make, times) {
  if (!shotsDir) return 0;
  fs.mkdirSync(shotsDir, { recursive: true });
  await robot.evaluate(async (spec) => {
    const R = window.PilotRoam;
    const g = { ...window.__pilotRobot.geometry(), pace: 1 };
    const at = (x) => ({ x: x < 0 ? g.right + x * g.u : g.left + x * g.u, y: g.floor });
    let plan;
    if (spec.kind === "walk") plan = R.walkTo({ ...g, pos: at(spec.from) }, at(spec.to).x, "standing", spec.run);
    else {
      const k = R.track(at(spec.from), g.poses, "standing");
      if (spec.kind === "climb") { R.climbUp(k, g, spec.side, g.u * 2.4); R.climbDown(k, g, spec.side); }
      else R.flyTo(k, g, at(spec.to), false);
      plan = k.done(spec.kind);
    }
    window.__mac15 = await window.__pilotRobot.actor.scrub(window.__pilotRobot.refine(plan));
    window.__mac15plan = plan;
  }, make);
  const dur = await robot.evaluate(() => window.__mac15plan.duration);
  let n = 0;
  for (const t of times(dur)) {
    await robot.evaluate((ms) => window.__mac15.seek(ms), t);
    await wait(220); // any dissolve finishes
    const box = await robot.evaluate((side) => {
      // (Where he's drawn at that moment: the held animation, not his last resting place.)
      const r = window.__pilotRobot.actor.rect();
      const w = 230;
      const h = 250;
      // (A climb: framed on the screen's edge, to see him against it.)
      const x = side ? (side > 0 ? window.innerWidth - w : 0) : Math.round(Math.min(Math.max((r.left + r.right) / 2 - w / 2, 0), window.innerWidth - w));
      const y = Math.round(Math.min(Math.max(r.bottom - 225, 0), window.innerHeight - h));
      return { x, y, width: w, height: h };
    }, make.side || 0);
    const b64 = await app.evaluate(async (_e, r) => (await global.__pilotTest.robot().webContents.capturePage(r)).toPNG().toString("base64"), box);
    fs.writeFileSync(path.join(shotsDir, `${prefix}-${String(n).padStart(2, "0")}.png`), Buffer.from(b64, "base64"));
    n += 1;
  }
  await robot.evaluate(() => window.__mac15.end());
  await wait(200);
  return n;
}

async function motion15() {
  const robot = await pageFor("robot.html");
  await robot.evaluate(() => window.__pilotRobot.warmed());
  // Sharp at any screen scale: his boxes are whole points.
  const boxes = await robot.evaluate(() => {
    window.__pilotRobot.actor.show("standing", 0);
    const pose = getComputedStyle(document.querySelector('.pa-pose[data-pose="standing"]'));
    const rest = getComputedStyle(document.querySelector(".pa-rest"));
    const r = { pose: [pose.left, pose.width, pose.height, pose.bottom], rest: [rest.left, rest.width], dpr: window.devicePixelRatio, will: getComputedStyle(document.querySelector(".pa")).willChange };
    window.__pilotRobot.actor.show("rest", 0);
    return r;
  });
  check(boxes.pose.join() === "-75px,150px,170px,-2px" && boxes.rest.join() === "-49px,110px" && boxes.will === "transform",
    `the pose pictures' boxes are whole points, drawn pixel for pixel (${boxes.pose.join(" ")}, at ${boxes.dpr}x)`);
  check(await robot.evaluate(() => window.__pilotRobot.actor.poses().includes("walk1-left") && window.__pilotRobot.actor.poses().includes("climb1-left")),
    "the left-facing walk and climb pictures are picked up");

  // Clickable while he walks: the main process follows him (its own check of
  // the cursor, which works whatever macOS sends the window).
  await settle(robot);
  await app.evaluate(() => global.__pilotTest.move({ move: "walk", user: true }));
  const walking = await untilPose(robot, (p) => /^walk/.test(p));
  check(Boolean(walking), "he sets off walking, a walk picture showing");
  const area = await app.evaluate(() => global.__pilotTest.workArea());
  let followed = 0;
  let samples = 0;
  for (let i = 0; i < 6; i += 1) {
    const n = await robotNow(robot);
    if (!n.busy) break;
    const c = { x: area.x + (n.rect.left + n.rect.right) / 2, y: area.y + (n.rect.top + n.rect.bottom) / 2 };
    await app.evaluate((_e, p) => global.__pilotTest.pretendCursor(p), c);
    await wait(150);
    samples += 1;
    if (await app.evaluate(() => global.__pilotTest.gate().ignoring) === false) followed += 1;
  }
  check(samples >= 3 && followed === samples, `the cursor on him as he walks: the overlay takes the mouse every time (${followed}/${samples})`);
  const start = walking.rect;
  const later = await robotNow(robot);
  if (later.busy && Math.abs(later.rect.left - start.left) > 160) {
    await app.evaluate((_e, p) => global.__pilotTest.pretendCursor(p), { x: area.x + (start.left + start.right) / 2, y: area.y + (start.top + start.bottom) / 2 });
    await wait(150);
    check(await app.evaluate(() => global.__pilotTest.gate().ignoring) === true, "where his walk began, once he's gone: clicks go through to the apps again");
  }
  await app.evaluate(() => global.__pilotTest.pretendCursor(null));
  await settle(robot);

  // A click on him mid-walk, mid-climb and mid-trick opens the chat.
  for (const [what, cmd, pose, extraWait] of [["mid-walk", { move: "walk", user: true }, (p) => /^walk/.test(p), 300],
    ["mid-climb", { move: "climb", user: true }, (p) => /^climb/.test(p), 900], ["mid-trick", { move: "magic-hat", user: true }, (p) => p !== "rest", 1500]]) {
    await app.evaluate((_e, c) => global.__pilotTest.move(c), cmd);
    const n = await untilPose(robot, pose, 25000);
    if (n) await wait(extraWait);
    const m = await robotNow(robot);
    const ok0 = Boolean(n) && m.busy;
    await robot.mouse.click((m.rect.left + m.rect.right) / 2, (m.rect.top + m.rect.bottom) / 2);
    await wait(700);
    const open = await app.evaluate(() => global.__pilotTest.chat().isVisible());
    if (open && shotsDir && what === "mid-climb") {
      const b64 = await app.evaluate(async () => (await global.__pilotTest.robot().webContents.capturePage()).toPNG().toString("base64"));
      fs.mkdirSync(shotsDir, { recursive: true });
      fs.writeFileSync(path.join(shotsDir, "mac15-click-climb-robot.png"), Buffer.from(b64, "base64"));
    }
    check(ok0 && open, `clicking him ${what} opens the chat${ok0 ? "" : " (he wasn't moving)"}`);
    await app.evaluate(() => global.__pilotTest.hideChat());
    await wait(400);
    await settle(robot);
  }
  // The pointer goes away from him again (on him, he'd hold still for the click).
  await robot.mouse.move(4, 4);
  await wait(300);
  check(await robot.evaluate(() => window.__pilotRobot.over()) === false && await app.evaluate(() => global.__pilotTest.gate().ignoring) === true,
    "the pointer moved off him: clicks go through again");

  // Frames to look at (with --shots): the walk cycle both ways, a run, a climb on each side, a flight.
  const T = (d, k) => Array.from({ length: k }, (_v, i) => Math.round((d * (i + 0.5)) / k));
  const stepMs = await robot.evaluate(() => window.PilotRoam.gait({ u: 110, pace: 1 }, false).stepMs);
  const cycle = (d) => Array.from({ length: 8 }, (_v, i) => Math.round(stepMs * 2 + (stepMs * i) / 4)).filter((t) => t < d);
  let made = 0;
  // (Places in robot widths from the left edge, or from the right when negative.)
  made += await frames(robot, "mac15-walk-right", { kind: "walk", from: 1, to: 6 }, cycle);
  made += await frames(robot, "mac15-walk-left", { kind: "walk", from: -1, to: -6 }, cycle);
  made += await frames(robot, "mac15-run-right", { kind: "walk", from: 1, to: -1, run: true }, (d) => T(d, 8));
  made += await frames(robot, "mac15-climb-right", { kind: "climb", from: -0.01, side: 1 }, (d) => T(d, 12));
  made += await frames(robot, "mac15-climb-left", { kind: "climb", from: 0.01, side: -1 }, (d) => T(d, 12));
  made += await frames(robot, "mac15-fly", { kind: "fly", from: 1, to: -2 }, (d) => T(d, 10));
  if (shotsDir) check(made >= 50, `frames of the walk, run, climbs and a flight saved (${made})`);
}

// ---------------------------------------------------------------- Pilot for Mac 1.5.1: frame logs

// A move really played (the same path as any move: the pictures on the
// move's clock), with every animation frame logged from the robot window:
// where he's drawn (the computed transform), and each picture that is drawn
// at all (visibility visible, opacity above 0) with its opacity and layer.
// make: {kind: "walk" | "climb-drop" | "trick", ...}. Returns the log.
async function frameLog(robot, make) {
  await settle(robot);
  return robot.evaluate(async (spec) => {
    const R = window.PilotRoam;
    const T = window.PilotTricks;
    const P = window.__pilotRobot;
    const actor = P.actor;
    const g = { ...P.geometry(), pace: 1 };
    const at = (x) => (x < 0 ? g.right + x * g.u : g.left + x * g.u);
    // He starts standing where the move starts (placed there, not walked).
    actor.place(at(spec.from), g.floor);
    actor.show("standing", 0);
    await new Promise((r) => setTimeout(r, 300));
    const g0 = { ...g, pos: { x: at(spec.from), y: g.floor } };
    let plan;
    if (spec.kind === "walk") plan = R.walkTo(g0, at(spec.to), "standing", spec.run);
    else if (spec.kind === "climb-drop") {
      const k = R.track(g0.pos, g.poses, "standing", g);
      R.climbUp(k, g0, spec.side, g.u * 1.6);
      R.dropOff(k, g0, spec.side);
      plan = k.done("climb-drop");
    } else plan = T.plan(spec.trick, g0, "standing");
    const pics = [...document.querySelectorAll(".pa-pose, .pa-rest")];
    const rows = [];
    let on = true;
    const t0 = performance.now();
    const sample = () => {
      if (!on) return;
      const m = /matrix(?:3d)?\(([^)]+)\)/.exec(getComputedStyle(actor.el).transform || "");
      const v = m ? m[1].split(",").map(Number) : null;
      const x = v ? (v.length === 16 ? v[12] : v[4]) : actor.at.x;
      const y = v ? (v.length === 16 ? v[13] : v[5]) : actor.at.y;
      const drawn = [];
      for (const el of pics) {
        const cs = getComputedStyle(el);
        const o = Number(cs.opacity);
        if (cs.visibility !== "visible" || !(o > 0)) continue;
        drawn.push({ pose: el.classList.contains("pa-rest") ? "rest" : el.dataset.pose, o: Math.round(o * 1000) / 1000, z: cs.zIndex,
          cls: el.classList.contains("mac-out") ? "out" : el.classList.contains("mac-sync") ? "sync" : "" });
      }
      rows.push({ t: Math.round((performance.now() - t0) * 10) / 10, x, y, drawn });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    await P.play(plan);
    await new Promise((r) => setTimeout(r, 250));
    on = false;
    return { name: spec.name, u: g.u, floor: g.floor, dpr: window.devicePixelRatio, duration: plan.duration, feet: R.FEET, rows };
  }, make);
}

// What a frame log shows: for each walk or run picture while it shows (the
// one fully drawn and not fading), how far its planted foot moves on screen;
// how the pictures fading out look (seen, and how many frames); the
// standing (or wave) picture drawn up in the air; the frame times.
function readLog(log) {
  const foot = (pose) => {
    if (Number.isFinite(log.feet[pose])) return log.feet[pose];
    const m = /^(.*)-left$/.exec(pose);
    return m && Number.isFinite(log.feet[m[1]]) ? -log.feet[m[1]] : 0;
  };
  const step = /^(walk|run)\d+(-left)?$/;
  const segs = [];
  let cur = null;
  const fades = { frames: 0, seen: 0, minOpacity: 1, poses: new Set() };
  let midAir = 0;
  let maxAir = 0;
  const dts = [];
  log.rows.forEach((r, i) => {
    if (i) dts.push(r.t - log.rows[i - 1].t);
    const showing = r.drawn.filter((d) => d.o >= 0.99 && String(d.z) !== "2" && d.cls !== "out");
    const main = showing.length ? showing[showing.length - 1] : null;
    for (const d of r.drawn) {
      if ((String(d.z) === "2" || d.cls === "out") && d.o < 0.99) { fades.frames += 1; fades.minOpacity = Math.min(fades.minOpacity, d.o); fades.poses.add(d.pose); if (d.o > 0.03) fades.seen += 1; }
      if ((d.pose === "standing" || d.pose === "wave") && d.o > 0.5 && log.floor - r.y > log.u * 0.12) { midAir += 1; maxAir = Math.max(maxAir, log.floor - r.y); }
    }
    const name = main ? main.pose : null;
    if (!cur || cur.pose !== name) { cur = { pose: name, start: r.t, frames: 0, x0: r.x, y0: r.y, drift: 0 }; segs.push(cur); }
    cur.frames += 1;
    cur.end = r.t;
    if (name && step.test(name)) {
      const d = foot(name) * log.u;
      cur.drift = Math.max(cur.drift, Math.hypot(r.x + d - (cur.x0 + d), r.y - cur.y0));
    }
  });
  const stepSegs = segs.filter((s) => s.pose && step.test(s.pose));
  // (The first and last frame of a showing can straddle a change; the middle ones are the picture alone.)
  const drifts = stepSegs.map((s) => Math.round(s.drift * 100) / 100);
  dts.sort((a, b) => a - b);
  return {
    name: log.name, frames: log.rows.length, dtMedian: dts[dts.length >> 1], dtMax: dts[dts.length - 1],
    stepPictures: stepSegs.length, footDriftMax: drifts.length ? Math.max(...drifts) : 0, footDrifts: drifts,
    poses: segs.filter((s) => s.pose).map((s) => `${s.pose}:${s.frames}`),
    fadeFrames: fades.frames, fadeFramesSeen: fades.seen, fadeMinOpacity: fades.minOpacity, fadePoses: [...fades.poses],
    standingMidAirFrames: midAir, standingMidAirMaxPt: Math.round(maxAir),
    twoDrawnFrames: log.rows.filter((r) => r.drawn.length >= 2).length,
  };
}

async function frameLogs15() {
  const robot = await pageFor("robot.html");
  await robot.evaluate(() => window.__pilotRobot.warmed());
  const dir = shotsDir || fs.mkdtempSync(path.join(os.tmpdir(), "pilot-frames-"));
  fs.mkdirSync(dir, { recursive: true });
  const runs = [
    { name: "walk-right", kind: "walk", from: 1, to: 6 },
    { name: "walk-left", kind: "walk", from: -1, to: -6 },
    { name: "run-right", kind: "walk", from: 1, to: -1, run: true },
    { name: "climb-right-push-off", kind: "climb-drop", from: -0.01, side: 1 },
    { name: "climb-left-push-off", kind: "climb-drop", from: 0.01, side: -1 },
    { name: "climb-and-wave", kind: "trick", trick: "climb-wave", from: -2 },
  ];
  const summary = [];
  for (const spec of runs) {
    const log = await frameLog(robot, spec);
    fs.writeFileSync(path.join(dir, `mac151-frames-${spec.name}.json`), JSON.stringify(log));
    summary.push(readLog(log));
  }
  fs.writeFileSync(path.join(dir, "mac151-frames-summary.json"), JSON.stringify(summary, null, 1));
  console.log(`     (frame logs: ${dir})`);
  const walks = summary.filter((s) => /^(walk|run)/.test(s.name));
  for (const s of walks) {
    check(s.stepPictures >= 6 && s.footDriftMax <= 3, `frame log, ${s.name}: his planted foot moves at most ${s.footDriftMax} pt while each of ${s.stepPictures} pictures shows (${s.frames} frames)`);
  }
  const fadeSeen = summary.reduce((n, s) => n + s.fadeFramesSeen, 0);
  check(fadeSeen >= 10, `frame logs: the picture going out is drawn while it fades (${fadeSeen} frames, down to ${Math.min(...summary.map((s) => s.fadeMinOpacity))} opacity)`);
  const air = summary.filter((s) => /climb/.test(s.name));
  check(air.every((s) => s.standingMidAirFrames === 0), `frame logs: no standing picture up in the air pushing off the wall or waving from it (${air.map((s) => `${s.name} ${s.standingMidAirFrames}`).join(", ")})`);
  return summary;
}

// Pilot for Mac 1.5.1: on a Mac, with PILOT_REAL_CLICK set to the
// realclick helper (test/smoke/realclick.swift), real system clicks: the
// pointer moved and clicked by macOS's own mouse events, through the
// click-through overlay, the way a person clicks. First a control click on
// him standing still: if even that doesn't open the chat, this Mac doesn't
// deliver made-up clicks (no Accessibility permission for the helper), and
// the check says so instead of passing or failing. Then him walking.
async function realClicks15() {
  const helper = process.env.PILOT_REAL_CLICK;
  if (process.platform !== "darwin" || !helper) return null;
  const run = (...a) => execFileSync(helper, a.map(String), { encoding: "utf8" }).trim();
  const robot = await pageFor("robot.html");
  const area = await app.evaluate(() => global.__pilotTest.workArea());
  const centre = async () => {
    const n = await robotNow(robot);
    return { x: Math.round(area.x + (n.rect.left + n.rect.right) / 2), y: Math.round(area.y + n.rect.top + (n.rect.bottom - n.rect.top) * 0.45), busy: n.busy, pose: n.pose };
  };
  const chatOpen = () => app.evaluate(() => global.__pilotTest.chat().isVisible());
  console.log(`     (real clicks: the helper is ${run("trusted")})`);
  await app.evaluate(() => global.__pilotTest.pretendCursor(null));
  // The control: him standing still.
  await settle(robot);
  await wait(500);
  let c = await centre();
  run("move", c.x, c.y);
  await wait(300);
  const moved = run("where");
  run("click", c.x, c.y);
  await wait(900);
  const control = await chatOpen();
  if (control) { await app.evaluate(() => global.__pilotTest.hideChat()); await wait(400); }
  run("move", 5, 300);
  await wait(300);
  if (!control) {
    console.log(`SKIP a real system click on him standing still didn't open the chat (pointer at ${moved} after moving it to ${c.x} ${c.y}): this Mac doesn't deliver made-up clicks, so the click mid-walk can't be checked here. See RELEASE_NOTES.md for the 30-second check by hand.`);
    return { control: false };
  }
  check(true, "a real system click on him standing still opens the chat (macOS's own mouse events, through the overlay)");
  const results = [];
  for (const [what, run, test] of [["mid-walk", false, (p) => /^walk/.test(p)], ["mid-run", true, (p) => /^run/.test(p)]]) {
    await settle(robot);
    // A long walk (or run) across the screen, played like any move (at the
    // end of the smoke test the app's own state could hold a "walk" back).
    await robot.evaluate((r) => {
      const P = window.__pilotRobot;
      const g = { ...P.geometry(), pace: 1 };
      const x0 = g.left + g.u;
      P.actor.place(x0, g.floor);
      P.actor.show("standing", 0);
      P.play(window.PilotRoam.walkTo({ ...g, pos: { x: x0, y: g.floor } }, g.right - g.u, "standing", r));
    }, run);
    const n = await untilPose(robot, test, 15000);
    await wait(400);
    // The pointer comes onto him (as a hand would), rests a moment, and clicks where he is then.
    c = await centre();
    run("move", c.x, c.y);
    await wait(250);
    c = await centre();
    const busy = c.busy && Boolean(n);
    run("click", c.x, c.y);
    await wait(900);
    const open = await chatOpen();
    results.push({ what, busy, pose: c.pose, open });
    check(busy && open, `a real system click on him ${what} opens the chat${busy ? ` (${c.pose} showing)` : " (he wasn't moving)"}`);
    if (open) { await app.evaluate(() => global.__pilotTest.hideChat()); await wait(400); }
    run("move", 5, 300);
    await wait(300);
  }
  return { control: true, results };
}

try {
  // Which edition this is, and where its AI runs at first (once the app has started).
  for (let i = 0; i < 100 && !(await app.evaluate(() => Boolean(global.__pilotTest))); i += 1) await wait(100);
  const ed = await app.evaluate(() => global.__pilotTest.edition());
  check(ed.id === (FREE ? "free" : "pilot") && ed.appName === (FREE ? "Pilot Free" : "Pilot"), `the ${FREE ? "Pilot Free" : "Pilot"} edition starts`);
  check(await app.evaluate(({ app: a }) => a.getName()) === ed.appName, "the app is named after its edition");
  const appleSilicon = process.platform === "darwin" && (process.arch === "arm64" || /apple/i.test((os.cpus()[0] || {}).model || ""));
  const firstSource = await app.evaluate(() => global.__pilotTest.aiSource());
  check(firstSource === (FREE || appleSilicon ? "free" : "key"), `the AI source starts as ${firstSource} (Free mode on Apple Silicon with no key)`);
  // Pilot's key checks below run on "My AI key"; Free mode is checked after them.
  if (!FREE) await app.evaluate(() => global.__pilotTest.setSource("key"));
  const robot = await pageFor("robot.html");
  await robot.waitForSelector(".pa-rest");
  await wait(800);
  check(await robot.getAttribute("html", "data-status") === "nokey", "robot shows the amber 'no key yet' dot");

  // The overlay: one transparent window over the work area, click-through
  // except over the robot, never focusable.
  const ov = await app.evaluate(({ screen }) => {
    const w = global.__pilotTest.robot();
    const a = screen.getPrimaryDisplay().workArea;
    return { b: w.getBounds(), a, focusable: w.isFocusable(), ignoring: global.__pilotTest.gate().ignoring };
  });
  const near = (p, q) => Math.abs(p - q) <= 2; // Linux test displays can be a pixel short
  check(near(ov.b.width, ov.a.width) && near(ov.b.height, ov.a.height) && ov.b.x === ov.a.x && ov.b.y === ov.a.y, "the overlay covers the work area (not the menu bar)");
  check(ov.focusable === false, "the overlay never takes focus");
  check(ov.ignoring === true, "clicks go through the overlay at rest");
  await robot.evaluate(() => window.pilot.robot.hover(true));
  check(await app.evaluate(() => global.__pilotTest.gate().ignoring) === false, "over the robot, the overlay takes the mouse");
  await robot.evaluate(() => window.pilot.robot.hover(false));
  check(await app.evaluate(() => global.__pilotTest.gate().ignoring) === true, "away from the robot, clicks go through again");
  const poseCount = await robot.evaluate(() => Object.keys(window.__pilotRobot ? window.__pilotRobot.actor.poses() : []).length);
  check(poseCount >= 9, "the pose pictures in assets/poses/ are picked up");

  // A move: the robot walks and reports where it ended up.
  const before = await app.evaluate(() => global.__pilotTest.robotAt());
  await app.evaluate(() => global.__pilotTest.move({ move: "walk" }));
  // (1.5: a person's walking pace, so a walk can take several seconds.)
  await wait(1500);
  for (let i = 0; i < 60 && await robot.evaluate(() => window.__pilotRobot.actor.busy); i += 1) await wait(250);
  await wait(200);
  const after = await app.evaluate(() => global.__pilotTest.robotAt());
  check(after && before && Math.abs(after.x - before.x) > 20 && !after.moving, `the robot walks somewhere and rests (${before && Math.round(before.x)} → ${after && Math.round(after.x)})`);

  // Pilot for Mac 1.5: he can be clicked while he moves, and he moves like a person.
  await motion15();
  // Pilot for Mac 1.5.1: frame logs of real moves (not held-still frames).
  await frameLogs15();
  // Calm mode: the timer sends nothing.
  await app.evaluate(() => global.__pilotTest.setCalm(true));
  check(await app.evaluate(() => global.__pilotTest.life().tick()) === null, "calm mode: no wandering");
  await app.evaluate(() => global.__pilotTest.setCalm(false));

  // Always moving, the default: he travels on his own, with short pauses,
  // and holds still for the chat, full screen, the Mac idle and hiding.
  check(await app.evaluate(() => global.__pilotTest.levelNow()) === "always", "Always moving is the default");
  check(await app.evaluate(() => global.__pilotTest.settings().energy) === "always", "the Energy setting is saved as Always moving");
  // (A test display gets no keyboard or mouse, so it would soon count as "idle": someone's here.)
  await app.evaluate(() => global.__pilotTest.pretend("away", false));
  await app.evaluate(() => global.__pilotTest.startLife());
  const spots = [];
  for (let i = 0; i < 24; i += 1) { await wait(500); spots.push(await robot.evaluate(() => Math.round(window.__pilotRobot.actor.rect().left))); }
  const held = await app.evaluate(() => global.__pilotTest.hold());
  check(Math.max(...spots) - Math.min(...spots) > 40, `Always moving: he sets off on his own within seconds${held ? ` (held: ${held})` : ""}`);
  check(await robot.evaluate(() => [...document.querySelectorAll(".pa-pose.pa-on")].length <= 2), "one pose picture at a time (two only while they cross-fade)");
  // The rest is checked one tick at a time, from standing still (so it isn't
  // "mid-move" that holds him).
  await app.evaluate(() => global.__pilotTest.stopLife());
  // Still: not moving, and sat down to rest (he sits 6 s after his last move).
  const still = async () => {
    for (let i = 0; i < 60; i += 1) {
      const moving = (await app.evaluate(() => global.__pilotTest.robotAt()) || {}).moving;
      if (!moving && await robot.evaluate(() => window.__pilotRobot.actor.pose === "rest" && !window.__pilotRobot.actor.busy)) return;
      await wait(500);
    }
  };
  const MOVES = ["roam", "roam-look", "roam-wave", "roam-trick"];
  await still();
  // Pilot for Mac 1.3: a new trick from the menu plays, with its drawn props, and cleans up.
  await robot.evaluate(() => window.__pilotRobot.warmed());
  check(await robot.evaluate(() => window.__pilotRobot.actor.poses().length >= 59 && document.querySelectorAll(".pa-pose").length >= 59
    && [...document.querySelectorAll(".pa-pose")].every((i) => i.complete && i.naturalWidth > 0)), "every pose picture is decoded before it's first used");
  await app.evaluate((_e) => global.__pilotTest.playTrick("magic-hat"));
  let sawProps = false;
  for (let i = 0; i < 40 && !sawProps; i += 1) { await wait(150); sawProps = await robot.evaluate(() => document.querySelectorAll(".pa-prop svg").length >= 2); }
  check(sawProps, "a new trick (Magic Trick) plays with its drawn props");
  for (let i = 0; i < 60 && await robot.evaluate(() => window.__pilotRobot.actor.busy); i += 1) await wait(200);
  check(await robot.evaluate(() => document.querySelectorAll(".pa-prop").length === 0), "its props are gone when it ends");
  await still();
  const why = await app.evaluate(() => global.__pilotTest.hold());
  const first = await app.evaluate(() => global.__pilotTest.life().tick());
  check(MOVES.includes(first), `with nothing holding him, the next move goes${first ? "" : ` (held: ${why || "?"})`}`);
  await wait(300);
  await still();
  await app.evaluate(() => global.__pilotTest.pretend("fullscreen", true));
  check(await app.evaluate(() => global.__pilotTest.life().tick()) === null, "Always moving holds still: full screen in front");
  await app.evaluate(() => global.__pilotTest.pretend("fullscreen", null));
  await app.evaluate(() => global.__pilotTest.setHidden(true));
  check(await app.evaluate(() => global.__pilotTest.life().tick()) === null, "Always moving holds still: hidden");
  await app.evaluate(() => global.__pilotTest.setHidden(false));
  await app.evaluate(() => global.__pilotTest.pretend("away", true));
  check(await app.evaluate(() => global.__pilotTest.life().tick()) === null, "Always moving holds still: the Mac idle or locked");
  await app.evaluate(() => global.__pilotTest.pretend("away", false));
  check(await app.evaluate(() => global.__pilotTest.life().tick()) === "wave", "back at the Mac: he waves");
  await wait(300);
  await still();
  await app.evaluate(() => global.__pilotTest.setEnergy("calm"));
  check(await app.evaluate(() => global.__pilotTest.life().tick()) === null, "Calm: he only rests");
  check(await app.evaluate(() => global.__pilotTest.settings().energyChosen) === true, "picking an Energy level is remembered as the user's choice");
  await app.evaluate(() => global.__pilotTest.setEnergy("always"));
  check(MOVES.includes(await app.evaluate(() => global.__pilotTest.life().tick())), "back to Always moving: he goes again");
  await wait(300);
  await still();
  await app.evaluate(() => global.__pilotTest.pretend("away", null));
  await wait(300);

  // Security: every window is isolated and sandboxed, with no Node.js.
  const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
    const p = w.webContents.getLastWebPreferences();
    return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox,
      top: w.isAlwaysOnTop(), url: w.webContents.getURL() };
  }));
  check(prefs.length === 2, "two windows: the robot and the chat");
  check(prefs.every((p) => p.contextIsolation === true && p.nodeIntegration === false && p.sandbox === true), "contextIsolation on, nodeIntegration off, sandbox on");
  check(prefs.every((p) => p.top), "both windows stay on top");
  check(prefs.every((p) => p.url.startsWith("pilot://app/")), "windows load only Pilot's own files");
  check(await robot.evaluate(() => typeof require === "undefined" && typeof process === "undefined"), "no Node.js in the robot window");
  check(await robot.evaluate(() => {
    const b = document.createElement("button");
    b.setAttribute("onclick", "window.__handler = 1");
    document.body.appendChild(b);
    b.click();
    b.remove();
    return window.__handler === undefined;
  }), "CSP blocks inline event handlers");
  check(await robot.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__inline = 1";
    document.body.appendChild(s);
    return window.__inline === undefined;
  }), "CSP blocks inline scripts");
  check(await robot.evaluate(async () => { try { await fetch("https://example.com/"); return false; } catch (_) { return true; } }), "CSP blocks other web addresses");

  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true });
    const img = await app.evaluate(async () => (await global.__pilotTest.robot().webContents.capturePage()).toPNG().toString("base64"));
    fs.writeFileSync(path.join(shotsDir, "pilotmac-robot-raw.png"), Buffer.from(img, "base64"));
  }

  // Click the robot: the chat opens.
  const box = await robot.locator(".pa-rest").boundingBox();
  await robot.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await robot.mouse.down();
  await robot.mouse.up();
  await wait(800);
  check(await app.evaluate(() => global.__pilotTest.chat().isVisible()), "clicking the robot opens the chat");
  const chat = await pageFor("chat.html");

  // Free mode (1.4), end to end with the pretend Ollama and Draw Things.
  async function openSettings() {
    if (!(await chat.isVisible("#view-settings"))) await chat.click("#gear");
    await wait(300);
  }
  async function freeMode() {
    await chat.evaluate(() => window.pilot.chat.clear());
    await openSettings();
    await app.evaluate(() => global.__pilotTest.refreshFree());
    await wait(300);
    // 1. Nothing installed yet: friendly setup cards that open the download pages.
    check(await chat.isVisible('[data-setup="ollama"]'), "Free mode: the Ollama setup card shows when it isn't installed");
    check((await chat.textContent('[data-setup="ollama"]')).includes("Download Ollama (free)"), "the setup card has Download Ollama (free)");
    check(await chat.isVisible('[data-setup="drawthings"]') && (await chat.textContent('[data-setup="drawthings"]')).includes("API Server (HTTP, port 7860)"),
      "the Draw Things setup card names the one setting to turn on");
    check((await chat.textContent("[data-video-note]")).includes("Videos aren't available"), "videos: an honest note");
    check((await chat.textContent("#source-words")).startsWith("Free mode"), "the status line says Free mode");
    await grabTo("pilot14-setup-ollama-raw.png");
    await chat.evaluate(() => document.querySelector('[data-setup="drawthings"]').scrollIntoView());
    await wait(200);
    await grabTo("pilot14-setup-drawthings-raw.png");
    // 2. Ollama is running now: "Download brain", with a progress bar.
    await new Promise((r) => ollama.listen(ollamaPort, "127.0.0.1", r));
    await chat.click('.free-card .btn:text("Check again")');
    await chat.waitForSelector('.free-card .btn:text("Download brain")', { timeout: 8000 }).catch(() => {});
    check(await chat.isVisible('.free-card .btn:text("Download brain")'), "Ollama running with no brain: Download brain");
    const rec = await app.evaluate(() => global.__pilotTest.freeView().recommended);
    check(Boolean(rec && rec.model && rec.label), `a brain is recommended for this Mac's memory (${rec && rec.label})`);
    await chat.click('.free-card .btn:text("Download brain")');
    let mid = false;
    for (let i = 0; i < 60 && !mid; i += 1) {
      await wait(150);
      mid = await chat.evaluate(() => { const b = document.querySelector(".pullbox progress"); const v = b ? Number(b.getAttribute("value")) : 0; return v >= 30 && v <= 80; });
    }
    check(mid, "Download brain shows its progress bar");
    await chat.evaluate(() => { const b = document.querySelector(".pullbox"); if (b) b.scrollIntoView(); });
    await grabTo("pilot14-download-brain-raw.png");
    await chat.waitForSelector('input[name="free-model"]:checked', { timeout: 15000 }).catch(() => {});
    check(await chat.isVisible('input[name="free-model"]:checked'), "the downloaded brain is picked");
    check(ollamaSeen.some((r) => r.url === "/api/pull" && r.body.model === rec.model && r.body.stream === true), "Pilot asked Ollama to pull the recommended brain");
    const active = await app.evaluate(() => global.__pilotTest.activeSettings());
    check(active.provider === "local" && active.key === "" && active.model === rec.model && !active.noTools, "Free mode: no key, the brain can use tools");
    // 3. A chat on the Mac.
    await chat.click("#view-settings .btn");
    await wait(300);
    check((await chat.textContent("#source-words")) === "Free mode · on your Mac", "status line: Free mode · on your Mac");
    await wait(500);
    check(await robot.getAttribute("html", "data-status") === "ready", "the robot's dot is green: ready");
    await chat.fill("#input", "Hi Pilot! Are you really on my Mac?");
    await chat.press("#input", "Enter");
    await chat.waitForFunction(() => document.querySelector("#messages").textContent.includes("What shall we do?"), null, { timeout: 8000 }).catch(() => {});
    const said = await chat.textContent("#messages");
    check(said.includes("right here on your Mac") && !said.includes("think"), "a local chat streams in, without the brain's thinking");
    const sent = ollamaSeen.filter((r) => r.url === "/v1/chat/completions").pop();
    check(Boolean(sent && sent.body.stream && sent.body.model === rec.model && (sent.body.tools || []).length), "the chat went to Ollama's local server, with Pilot's tools");
    check(Boolean(sent && /# Free mode/.test(sent.body.messages[0].content)), "the brain is told it runs in Free mode");
    await wait(300);
    await grabTo("pilot14-local-chat-raw.png");
    // 4. A picture from Draw Things.
    await new Promise((r) => drawThings.listen(drawPort, "127.0.0.1", r));
    await app.evaluate(() => global.__pilotTest.refreshFree());
    check((await app.evaluate(() => global.__pilotTest.freeView().drawThings)) === "on", "Draw Things' API Server is found");
    await chat.evaluate(() => window.pilot.chat.clear());
    await chat.fill("#input", "Can you draw me a friendly robot waving?");
    await chat.press("#input", "Enter");
    await chat.waitForSelector(".card .btn.primary", { timeout: 8000 }).catch(() => {});
    check((await chat.textContent(".card").catch(() => "")).includes("Pilot wants to"), "making a picture asks first");
    await chat.click(".card .btn.primary").catch(() => {});
    await chat.waitForFunction(() => document.querySelector("#messages").textContent.includes("Drawing on your Mac"), null, { timeout: 4000 }).catch(() => {});
    check((await chat.textContent("#messages")).includes("Drawing on your Mac with Draw Things"), "the picture shows its progress while Draw Things draws");
    await chat.waitForSelector("#messages img[data-media]", { timeout: 10000 }).catch(() => {});
    check(await chat.isVisible("#messages img[data-media]"), "the picture from Draw Things shows in the chat");
    check(await chat.locator('#messages .media .mini:text("Save")').count() === 1, "with a Save button");
    check(drawSeen.some((r) => r.url === "/sdapi/v1/txt2img" && r.body && r.body.prompt === "a friendly robot waving"), "Draw Things got the prompt");
    await chat.waitForFunction(() => document.querySelector("#messages").textContent.includes("drawn right here"), null, { timeout: 8000 }).catch(() => {});
    await chat.evaluate(() => { const i = document.querySelector("#messages img[data-media]"); if (i) i.scrollIntoView({ block: "center" }); });
    await wait(400);
    await grabTo("pilot14-local-image-raw.png");
    await chat.evaluate(() => window.pilot.chat.clear());
    await wait(200);
  }
  // The chat must take the keyboard (Pilot 1.0 couldn't be typed into on a Mac).
  await wait(400);
  const focus = await app.evaluate(({ BrowserWindow }) => {
    const c = global.__pilotTest.chat();
    const f = BrowserWindow.getFocusedWindow();
    return { focused: c.isFocused(), same: Boolean(f && f.id === c.id), panel: c.webContents.getURL() };
  });
  check(focus.focused && focus.same, "the opened chat is the focused window");
  await chat.waitForFunction(() => document.activeElement && document.activeElement.id === "input" || document.querySelector(".welcome"), null, { timeout: 3000 }).catch(() => {});
  const roles = await app.evaluate(({ Menu }) => {
    const edit = Menu.getApplicationMenu().items.find((i) => i.label === "Edit");
    return edit ? edit.submenu.items.map((i) => i.role).filter(Boolean) : [];
  });
  check(["undo", "redo", "cut", "copy", "paste", "selectall"].every((r) => roles.map((x) => x.toLowerCase()).includes(r)), "the app menu has the Edit shortcuts (paste, copy, select all, undo)");
  check((await chat.textContent(".greet")).includes("Hello! I'm Pilot."), "greeting bubble");
  check((await chat.locator(".chip").count()) === 5, "five pill buttons");
  if (FREE) {
    check((await chat.textContent(".byok")).includes("Free mode · on your Mac"), "Pilot Free: the card says Free mode · on your Mac");
    check((await chat.textContent(".tagline")) === "Your AI copilot. Free, on your Mac.", "Pilot Free tagline");
  } else {
    check((await chat.textContent(".byok")).includes("Bring Your Own API Key"), "Bring Your Own API Key card");
    check((await chat.textContent(".tagline")) === "Your AI copilot. Powered by you.", "tagline");
  }
  check(await chat.getAttribute("#input", "placeholder") === "Type a message...", "message box");
  check(await chat.evaluate(() => typeof require === "undefined" && Object.keys(window.pilot).join() === "robot,chat,settings,voice,attach,screen,app"), "chat window has only the small preload API");
  check(await app.evaluate(() => global.__pilotTest.context().chatOpen) === true, "the robot knows the chat is open (and stays calm)");
  check(await app.evaluate(() => global.__pilotTest.life().tick()) === null, "chat open: no wandering");
  check(await app.evaluate(() => global.__pilotTest.levelNow()) === "always" && await app.evaluate(() => global.__pilotTest.life().tick()) === null,
    "chat open: Always moving stays put next to it");

  // First launch: a short welcome with three steps.
  await chat.waitForSelector(".welcome");
  check((await chat.locator(".welcome .steps li").count()) === 3, "first-launch welcome has three steps");
  check((await chat.textContent(".welcome")).includes(FREE ? "Set up Free mode" : "Add your AI key"), "the welcome's first step fits the edition");
  if (shotsDir) {
    await wait(300);
    const b64 = await app.evaluate(async () => (await global.__pilotTest.chat().webContents.capturePage()).toPNG().toString("base64"));
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, "pilotmac-welcome-raw.png"), Buffer.from(b64, "base64"));
  }
  await chat.click("[data-start]");
  await wait(300);
  check(await chat.isVisible("#chips") && !(await chat.isVisible(".welcome")), "Start chatting shows the pill buttons");
  // Reopened through the robot's own path, the message box has the keyboard.
  await app.evaluate(() => global.__pilotTest.hideChat());
  await wait(300);
  await app.evaluate(() => global.__pilotTest.showChat());
  await wait(600);
  check(await chat.evaluate(() => document.activeElement && document.activeElement.id === "input"), "the message box has the keyboard when the chat opens");
  check(await app.evaluate(() => global.__pilotTest.chat().isFocused()), "the chat window is key after reopening");
  // A real keystroke from the operating system, where the Mac allows it
  // (it needs Accessibility permission, which a CI runner may not have).
  if (process.platform === "darwin") {
    try {
      execFileSync("/usr/bin/osascript", ["-e", 'tell application "System Events" to keystroke "typed"'], { timeout: 5000 });
      await wait(400);
      check((await chat.inputValue("#input")).includes("typed"), "real keystrokes land in the message box");
      await chat.fill("#input", "");
    } catch (e) {
      console.log("skip real keystrokes: this Mac doesn't allow sending them here");
    }
  }

  // A message without a key explains what to do, and nothing is sent anywhere.
  await chat.fill("#input", "hello");
  await chat.press("#input", "Enter");
  await wait(400);
  check((await chat.textContent("#messages")).includes(FREE ? "needs a brain first" : "needs your own AI key"),
    FREE ? "no brain yet: Pilot says how to get one" : "no key: Pilot says how to add one");

  // Script injection in an answer shows as text.
  await app.evaluate(() => global.__pilotTest.seed([{ role: "assistant", text: "<img src=x onerror=alert(1)><script>window.__x=1</script> **safe**" }]));
  await wait(300);
  check(await chat.evaluate(() => !document.querySelector("#messages img[src='x'], #messages script") && window.__x === undefined
    && document.querySelector("#messages").textContent.includes("<script>")), "script injection renders as text");

  // Confirm cards: nothing runs until Allow.
  const answer = app.evaluate(() => global.__pilotTest.addCard({ type: "confirm", label: "Copy this text to your clipboard: “Hi”" }));
  await chat.waitForSelector(".card .btn.primary");
  check((await chat.textContent(".card")).includes("Pilot wants to"), "confirm card shows what Pilot wants to do");
  await chat.click(".card .btn:not(.primary)");
  check((await answer) === false, "Cancel answers no");

  // Settings open from the card.
  await chat.click("#byok");
  await wait(300);
  check(await chat.isVisible("#view-settings"), "the key card opens settings");
  if (FREE) {
    const page = await chat.textContent("#view-settings");
    check(page.includes("Free mode · on your Mac") && page.includes("Download Ollama (free)"), "Pilot Free settings: the Free mode setup card");
    check(!["Your AI keys", "API key", "Add a key", "Image key", "Video key", "AI source"].some((w) => page.includes(w))
      && await chat.locator("#view-settings input[type=password]").count() === 0, "Pilot Free settings: no key settings, slots or provider list");
  } else {
    check((await chat.textContent("#view-settings")).includes("Your AI keys"), "settings lists AI keys");
    check((await chat.textContent("#view-settings")).includes("AI source"), "Pilot settings: the AI source choice");
  }

  if (shotsDir) {
    await chat.click("#view-settings .btn");
    await app.evaluate(() => global.__pilotTest.engine.clear());
    await wait(300);
    const grab = async (name) => {
      const b64 = await app.evaluate(async () => (await global.__pilotTest.chat().webContents.capturePage()).toPNG().toString("base64"));
      fs.writeFileSync(path.join(shotsDir, name), Buffer.from(b64, "base64"));
    };
    await grab("pilotmac-chat-raw.png");
    await app.evaluate(() => global.__pilotTest.seed([
      { role: "user", text: "Can you explain what's on my screen?" },
      { role: "assistant", text: "Sure! You're looking at a **spreadsheet** of this month's costs.\n\n- Rent is the biggest line.\n- Two rows have no category yet.\n\nWant me to draft a short summary you can paste?" },
      { role: "user", text: "Yes please, and copy it." },
    ]));
    const pending = app.evaluate(() => global.__pilotTest.addCard({ type: "confirm", label: "Copy this text to your clipboard: “This month: rent is the biggest cost; two rows need a category.”" }));
    await app.evaluate(() => global.__pilotTest.setLooking(true));
    await wait(500);
    await grab("pilotmac-chat-messages-raw.png");
    await app.evaluate(() => global.__pilotTest.setLooking(false));
    await chat.click(".card .btn:not(.primary)");
    await pending;
    const plan = app.evaluate(() => global.__pilotTest.addCard({ type: "plan", labels: ["Open https://example.com in your web browser", "Save a note in Pilot: “Trip ideas”", "Copy this text to your clipboard: “Packing list…”"] }));
    await wait(400);
    await grab("pilotmac-chat-plan-raw.png");
    await chat.click(".card .btn:not(.primary)");
    await chat.click(".card .btn:not(.primary)").catch(() => {});
    await plan.catch(() => {});
    await chat.click("#gear");
    await wait(300);
    await grab("pilotmac-settings-raw.png");
  }

  // End to end with the pretend provider: type, Enter, a streamed reply; an
  // action card answered with Allow; a dropped picture sent with a message.
  const saved = await chat.evaluate((url) => window.pilot.settings.saveProfile({ provider: "compatible", baseUrl: url, model: "local-test", label: "Local" }, ""), mockUrl);
  if (FREE) {
    check(saved && /doesn't use API keys/.test(saved.error || ""), "Pilot Free refuses to save a key");
    check(Boolean((await chat.evaluate(() => window.pilot.settings.saveMedia("image", { provider: "openai", model: "x" }, "k"))).error), "Pilot Free refuses an image key");
    await freeMode();
  } else {
  check(saved && saved.ok, "a compatible key on this computer can be saved");
  await chat.click("#view-settings .btn").catch(() => {});
  await chat.evaluate(() => window.pilot.chat.clear());
  await wait(300);
  if (!(await chat.isVisible("#input"))) { await chat.click("#gear"); await wait(300); }
  await chat.click("#input");
  await chat.keyboard.type("hello there");
  await chat.keyboard.press("Enter");
  await chat.waitForFunction(() => document.querySelector("#messages").textContent.includes("This is the test reply."), null, { timeout: 8000 }).catch(() => {});
  check((await chat.textContent("#messages")).includes("This is the test reply."), "typing, Enter, and the streamed reply appears");
  check(await chat.inputValue("#input") === "", "the message box is empty after sending");
  await chat.fill("#input", "please copy hi");
  await chat.press("#input", "Enter");
  await chat.waitForSelector(".card .btn.primary", { timeout: 8000 }).catch(() => {});
  check(await chat.isVisible(".card .btn.primary"), "an action shows an Allow card");
  await chat.click(".card .btn.primary").catch(() => {});
  await wait(1500);
  check((await app.evaluate(({ clipboard }) => clipboard.readText())) === "hi from Pilot", "Allow runs the action");
  await chat.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 1200; c.height = 800;
    const x = c.getContext("2d"); x.fillStyle = "#3b82f6"; x.fillRect(0, 0, 1200, 800);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "chart.png", { type: "image/png" }));
    document.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    for (let i = 0; i < 50 && !document.querySelector(".tray-item .x"); i += 1) await new Promise((r) => setTimeout(r, 100));
  });
  const nSeen = seen.length;
  await chat.fill("#input", "what is in this picture?");
  await chat.press("#input", "Enter");
  await wait(2000);
  const withPic = seen.slice(nSeen).find((b) => JSON.stringify(b).includes("data:image/jpeg;base64,"));
  check(Boolean(withPic), "a dropped picture is sent with the message, to the provider only");
  // Stop and Clear.
  await chat.evaluate(() => window.pilot.chat.clear());
  await wait(300);
  check(!(await chat.textContent("#messages")).includes("test reply"), "Clear empties the chat");
  // Pilot: Free mode is there too, as the other AI source.
  await app.evaluate(() => global.__pilotTest.setSource("free"));
  await chat.click("#gear").catch(() => {});
  await wait(400);
  if (!(await chat.isVisible("#view-settings"))) { await chat.click("#gear"); await wait(300); }
  const freePage = await chat.textContent("#view-settings");
  check(freePage.includes("Download Ollama (free)") && freePage.includes("Videos aren't available in Free mode") && !freePage.includes("Your AI keys"),
    "Pilot with Free mode picked: the Free mode cards instead of the keys");
  check(await chat.isVisible("#source") && (await chat.textContent(".byok")).includes("Free mode · on your Mac"), "Pilot: the status line shows Free mode");
  if (shotsDir) await grabTo("pilot14-pilot-ai-source-raw.png");
  await chat.click('input[name="ai-source"][value="key"]');
  await wait(300);
  check((await chat.textContent("#view-settings")).includes("Your AI keys") && !(await chat.isVisible("#source")), "back to My AI key");
  await chat.click("#view-settings .btn").catch(() => {});
  await wait(200);
  }

  // Screen access: the mode hides the eye when off.
  await chat.click("#gear").catch(() => {});
  await wait(300);
  if (!(await chat.isVisible("#view-settings"))) { await chat.click("#gear"); await wait(300); }
  check((await chat.textContent("#view-settings")).includes("Screen access"), "settings has a Screen access section");
  await chat.click('input[name="screen-mode"][value="off"]');
  await wait(300);
  check(await chat.evaluate(() => document.getElementById("eye").hidden) === true, "screen access off hides the eye");
  if (shotsDir) {
    await chat.evaluate(() => document.querySelector(".screen-access").scrollIntoView());
    await wait(200);
    const b64 = await app.evaluate(async () => (await global.__pilotTest.chat().webContents.capturePage()).toPNG().toString("base64"));
    fs.writeFileSync(path.join(shotsDir, "pilotmove-screen-access-raw.png"), Buffer.from(b64, "base64"));
  }
  await chat.click('input[name="screen-mode"][value="ask"]');
  await wait(200);
  check(await chat.evaluate(() => document.getElementById("eye").hidden) === false, "only when I ask shows the eye");
  await chat.click("#gear");
  await wait(300);

  // Dropped files: a picture is shrunk and waits in the tray with a remove button.
  const added = await chat.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 3000; c.height = 2000;
    const ctx = c.getContext("2d"); const g = ctx.createLinearGradient(0, 0, 3000, 2000); g.addColorStop(0, "#38bdf8"); g.addColorStop(1, "#8b5cf6");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 3000, 2000);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const file = new File([blob], "big-photo.png", { type: "image/png" });
    const dt = new DataTransfer(); dt.items.add(file);
    document.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    for (let i = 0; i < 50 && !document.querySelector(".tray-item .x"); i += 1) await new Promise((r) => setTimeout(r, 100));
    return Boolean(document.querySelector(".tray-item .x"));
  });
  check(added, "a dropped picture waits in the tray, with a remove button");
  const item = await app.evaluate(() => global.__pilotTest.pending()[0]);
  check(item && item.kind === "image" && item.mime === "image/jpeg" && item.data.length < 5e6, "the picture was shrunk to a JPEG");
  if (shotsDir) {
    await app.evaluate(() => global.__pilotTest.addPending({ kind: "video", name: "Team presentation.mov", size: 2.7 * 1024 ** 3, thumb: "", progress: 0.42, mime: "video/quicktime" }));
    await wait(200);
    await chat.evaluate(() => { document.getElementById("dropzone").hidden = false; });
    await wait(200);
    let b64 = await app.evaluate(async () => (await global.__pilotTest.chat().webContents.capturePage()).toPNG().toString("base64"));
    fs.writeFileSync(path.join(shotsDir, "pilotmove-dropzone-raw.png"), Buffer.from(b64, "base64"));
    await chat.evaluate(() => { document.getElementById("dropzone").hidden = true; });
    await wait(200);
    b64 = await app.evaluate(async () => (await global.__pilotTest.chat().webContents.capturePage()).toPNG().toString("base64"));
    fs.writeFileSync(path.join(shotsDir, "pilotmove-upload-progress-raw.png"), Buffer.from(b64, "base64"));
  }
  await chat.click(".tray-item .x");
  await wait(200);
  check(await app.evaluate(() => global.__pilotTest.pending().every((a) => a.kind !== "image")), "remove takes it out");
  await app.evaluate(() => global.__pilotTest.takePending());

  // Hiding the chat leaves the robot.
  await chat.keyboard.press("Escape");
  await chat.keyboard.press("Escape");
  await wait(300);
  const vis = await app.evaluate(() => ({ chat: global.__pilotTest.chat().isVisible(), robot: global.__pilotTest.robot().isVisible() }));
  check(!vis.chat && vis.robot, "closing the chat leaves the robot");

  // Pilot for Mac 1.5.1: real system clicks, last (they move the real
  // pointer, and made-up system clicks can leave another app frontmost,
  // which would upset the focus checks above).
  await realClicks15();
} catch (e) {
  problems.push(String(e && e.stack || e));
  console.error(e);
} finally {
  mock.close();
  ollama.close();
  drawThings.close();
  fs.rmSync(appsDir, { recursive: true, force: true });
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log("\nsmoke test passed");
