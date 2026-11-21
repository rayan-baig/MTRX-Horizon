// Starts the real app with Playwright for Electron, clicks the robot, and
// checks the chat window, the robot's overlay and moves, screen access,
// dropped files and the security settings. With --shots it also saves
// pictures of the robot and the chat window.
//
//   node test/smoke/run-smoke.mjs [--shots <folder>]
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

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..", "..");
const shotsAt = process.argv.indexOf("--shots");
const shotsDir = shotsAt > 0 ? process.argv[shotsAt + 1] : "";
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-smoke-"));
const problems = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push(what); };

const args = [appDir];
if (process.platform === "linux") args.push("--no-sandbox");
const env = { ...process.env, PILOT_TEST: "1", PILOT_USER_DATA: userData };
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

try {
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
  await wait(6000);
  const after = await app.evaluate(() => global.__pilotTest.robotAt());
  check(after && before && Math.abs(after.x - before.x) > 20 && !after.moving, "the robot walks somewhere and rests");
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
  check(Math.max(...spots) - Math.min(...spots) > 40, "Always moving: he sets off on his own within seconds");
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
  check((await chat.textContent(".byok")).includes("Bring Your Own API Key"), "Bring Your Own API Key card");
  check((await chat.textContent(".tagline")) === "Your AI copilot. Powered by you.", "tagline");
  check(await chat.getAttribute("#input", "placeholder") === "Type a message...", "message box");
  check(await chat.evaluate(() => typeof require === "undefined" && Object.keys(window.pilot).join() === "robot,chat,settings,voice,attach,screen,app"), "chat window has only the small preload API");
  check(await app.evaluate(() => global.__pilotTest.context().chatOpen) === true, "the robot knows the chat is open (and stays calm)");
  check(await app.evaluate(() => global.__pilotTest.life().tick()) === null, "chat open: no wandering");
  check(await app.evaluate(() => global.__pilotTest.levelNow()) === "always" && await app.evaluate(() => global.__pilotTest.life().tick()) === null,
    "chat open: Always moving stays put next to it");

  // First launch: a short welcome with three steps.
  await chat.waitForSelector(".welcome");
  check((await chat.locator(".welcome .steps li").count()) === 3, "first-launch welcome has three steps");
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
  check((await chat.textContent("#messages")).includes("needs your own AI key"), "no key: Pilot says how to add one");

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
  check((await chat.textContent("#view-settings")).includes("Your AI keys"), "settings lists AI keys");

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
} catch (e) {
  problems.push(String(e && e.stack || e));
  console.error(e);
} finally {
  mock.close();
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log("\nsmoke test passed");
