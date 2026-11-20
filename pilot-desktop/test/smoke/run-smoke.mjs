// Starts the real app with Playwright for Electron, clicks the robot, and
// checks the chat window and the security settings. With --shots it also
// saves pictures of the robot and the chat window.
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
  await robot.waitForSelector("#robot");
  await wait(600);
  check(await robot.getAttribute("#robot", "data-status") === "nokey", "robot shows the amber 'no key yet' dot");

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
  const box = await robot.locator("#robot").boundingBox();
  await robot.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await robot.mouse.down();
  await robot.mouse.up();
  await wait(800);
  check(await app.evaluate(() => global.__pilotTest.chat().isVisible()), "clicking the robot opens the chat");
  const chat = await pageFor("chat.html");
  check((await chat.textContent(".greet")).includes("Hello! I'm Pilot."), "greeting bubble");
  check((await chat.locator(".chip").count()) === 5, "five pill buttons");
  check((await chat.textContent(".byok")).includes("Bring Your Own API Key"), "Bring Your Own API Key card");
  check((await chat.textContent(".tagline")) === "Your AI copilot. Powered by you.", "tagline");
  check(await chat.getAttribute("#input", "placeholder") === "Type a message...", "message box");
  check(await chat.evaluate(() => typeof require === "undefined" && Object.keys(window.pilot).join() === "robot,chat,settings,screen,app"), "chat window has only the small preload API");

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
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log("\nsmoke test passed");
