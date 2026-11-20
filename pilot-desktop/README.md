# Pilot for Mac

Pilot is the MTRX Horizyn AI assistant as a Mac app: a small robot that floats above every app, on every desktop and over full-screen apps. Click it and a chat window opens next to it. It runs on the user's own AI key (Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible API), so their provider bills them directly; there is no MTRX server in between.

People who just want the app: see [INSTALL.md](INSTALL.md).

## What it does

- **The robot**: the owner's robot artwork, 110 px wide at rest, with a soft glow and a status dot (green ready, amber no key yet, pulsing while thinking or looking). It moves around by itself (below). Drag it anywhere: where it's dropped becomes its home. Right-click it for Open Chat, Play a Trick, Trick, Calm Mode and Hide Pilot. No Dock icon; the menu bar shows the robot's head with Show/Hide Pilot, Open Chat, Settings, Play a Trick, Trick (Backflip, Football, Soccer, Tennis, Wave, Celebrate, Knee Slide, Point, Power Up, Superhero Landing, Love, Waiting), Calm Mode, Energy (Low, Normal, Playful), Start at Login, About Pilot and Quit Pilot.
- **Chat window**: matches the design: glass panel with a blue-violet edge, the P-with-orbit mark, "Pilot", the greeting, five pill buttons, the message box, the gear, palette and ? buttons, and the "Bring Your Own API Key" card. Closing it leaves the robot. The first time, a short welcome shows three steps.
- **Keys**: several chat keys can be saved and switched, plus separate image and video keys. Models come from the provider's own model list for the key, or the user types one. Keys are encrypted with Electron `safeStorage` (the encryption key lives in the macOS Keychain); without the Keychain, Pilot refuses to save a key. Keys stay in the main process: windows only ever see the last four characters.
- **Seeing the screen**: only when the user asks: the eye button ("Look at my screen", "Explain this screen", "Summarise what I'm looking at", and "Help with what's on screen", which sends a fresh screenshot with each message while it's on), or after the user presses Allow on Pilot's "look at the screen" card. The first time, Pilot explains Screen Recording in plain words and opens the right pane in System Settings. A "Pilot is looking at your screen…" banner shows while a screenshot is taken and sent; Pilot's own windows are left out of the picture. Nothing is captured in the background.
- **Actions, all asked first**: look at the screen, copy a reply or draft to the clipboard, open an https website in the browser, save a note, remember a fact (only with memory on), make a picture or video (only with those keys). Several actions become a numbered plan: Approve all, Step through, or Cancel. There is no tool for payments, deleting files, sending messages or email, or typing into other apps.
- **Memory** is off by default; remembered facts and saved notes can be viewed and deleted in settings. **Voice**: macOS Dictation works in the message box.
- **Start at login** is on by default, with a switch in settings and the menu bar. Quit always quits.

## The moving robot (1.1)

The engine is the web core's (`pilot-motion.js` and `pilot-actor.js`, copied into `src/core/`; docs/PILOT.md describes the moves, poses and fallbacks). On the Mac:

- **One overlay window.** The robot lives in one transparent window covering the **work area** of the display its home is on (so never the menu bar or the Dock). It is always on top, on every Space and over full-screen apps, never focusable, and click-through: `setIgnoreMouseEvents(true, { forward: true })`, turned off only while the pointer is over the robot (the robot window checks forwarded mouse moves; the main process also checks the cursor a few times a second, so a file dragged from Finder can be dropped on the robot) or while it's being dragged (`src/main/overlay.js`, `MouseGate`). Moving the robot inside one big window is smooth and cheap (the compositor moves a small layer), where moving a small window 60 times a second from the main process would stutter. With several displays the overlay covers one: drag the robot onto another display and the overlay moves there with it (its home is remembered with the display).
- **Moves**: walk and run along the bottom, fly anywhere on the display (with a superhero landing), climb the left or right edge, tricks (backflip, spin, bounce, peek, celebrate, knee slide, power up), waves, glances at the mouse, and the sports tricks (football, soccer, tennis). Reactions: it celebrates when an action you allowed is done, sends hearts when you say thanks or come back after half an hour, points up once at start if there's no key yet, and does a playful "waiting" pose once when the chat has been open with nothing happening for a couple of minutes. The main process decides when (`src/main/life.js`, with `pilot-motion.js`'s rules); the robot window plans and plays the move.
- **When**: every 30 to 120 seconds or so (Low: 70 to 160, Playful: 15 to 60), and most of the time it rests. Right before a move it checks once whether the user is typing (keys in use but the mouse still, from `powerMonitor`'s idle time and the cursor) and whether the front app has a full-screen window (window places from macOS, no permission needed, `src/main/frontmost.js`). Then, in **Calm Mode**, under **reduce motion** (Calm by default), while the chat is open, or while hidden or dragged, it keeps still. It waves when the user comes back after three minutes away (or unlocks the Mac), and gently when the chat opens.
- **Poses**: drop `<pose>.webp` or `.png` into `assets/poses/` with one of the pose names (docs/PILOT.md lists them and their fallbacks) and rebuild: no code change. `python3 tools/pilot_art.py` (in the repo root) scales the owner's pictures to the shared canvas.
- **Performance**: moves are Web Animations on transforms and opacity, on the compositor, with no script per frame. At rest nothing animates except a blink (170 ms every few seconds) and one slow breath every 25 to 45 seconds, both from timers; the main process wakes every 10 seconds (idle check) and checks the cursor every 300 ms (a cheap call). Measured under xvfb on Linux (software rendering, so a Mac with a GPU does better), see the commit notes.

## Screen access and dropped files (1.1)

- **Screen access** in settings: the live macOS permission (Allowed or Not allowed), Open Mac settings, Check again, and Relaunch Pilot when macOS needs a restart to apply it. Modes: **Off** (the eye is hidden and the screen action isn't offered), **Only when I ask** (default) and **Help with what's on screen** (a fresh screenshot with each message). Nothing between messages; the "Pilot is looking" banner every time. The first-run welcome offers to turn it on and notices when it's allowed.
- **Pictures and videos**, dropped on the chat or the robot, pasted, or picked with the paperclip, any size (`src/renderer/attach.js`). Pictures (PNG, JPEG, HEIC, WebP, GIF) are shrunk on a canvas until each fits the provider's limits (a per-provider table, no model names); HEIC is opened by macOS first. Videos use Google Gemini's resumable file upload (`src/main/uploads.js`, 8 MB pieces with a progress bar) with a Gemini key; with other providers Pilot takes up to 24 evenly spaced frames and says so ("I looked at 24 frames from your 3-minute video."). A video is read from disk a piece at a time, never whole. Each waits under the message box with a thumbnail, name, size and a remove button. A model that can't take pictures gets a plain message and a "Switch key or model" button.

## Typing in the chat (fixed in 1.1)

In 1.0 the chat was a non-activating panel in a menu-bar app, so it never became the key window and typing went to the app in front. Now the chat is an ordinary frameless window (still on top, on every Space and over full-screen apps); opening it brings Pilot forward (`app.focus({ steal: true })`, it's always the user's click), focuses the window and the message box; a click in it makes it key again; and closing it hands the keyboard back to the app that was in front. The app menu has the standard Edit items, so paste, copy, select all and undo work. The smoke test checks the focused window, the focused message box, the Edit menu, real keystrokes where the Mac allows them, and a full conversation against a pretend provider on the same computer.

## How it's built

```
src/main/       main process: windows, menu bar, IPC, key store, screen capture, CSP,
                the robot's overlay and timing, screen access, uploads
src/preload/    the small API the windows get (contextBridge)
src/renderer/   robot.html and chat.html (no inline scripts or styles), attach.js
src/core/       chat engine, providers, media, safe renderer, desktop tools, the moving robot
assets/         the robot artwork (and its three resting layers), poses/, its menu-bar head, the app icon
build/          icon.icns, the .dmg background, entitlements (for signing later)
test/unit/      node:test unit tests
test/smoke/     Playwright-for-Electron smoke test (also takes the screenshots)
```

### Shared core

`src/core/pilot-providers.js`, `pilot-media.js`, `pilot-render.js`, `pilot-motion.js`, `pilot-actor.js` and `pilot-actor.css` are copied unchanged from the web Pilot core **1.1.0** in `static/pilot/`; `src/core/core-version.json` records their checksums and a test checks them. The desktop layers `providers.js` and `media.js` build on the core's adapters, adding pictures (screenshots in messages and tool results) and running in Node. `engine.js` is the desktop's own engine with the same structure and host interface as the core's `pilot-engine.js`; it is separate because the Mac needs pictures in tool results, every action asked first, and older screenshots dropped from what is sent again.

To update the core: copy those files from `static/pilot/` over, update `core-version.json`, and run `npm test`.

### Security

- Every window: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a preload with a fixed list of calls, no navigation, no new windows, no webviews, all permission requests refused.
- Windows load only Pilot's own files from a `pilot://` scheme, each served with a strict Content-Security-Policy: no inline scripts or styles, no eval, `connect-src` limited to the three providers' API hosts plus the user's own compatible address. Any other request from a window is cancelled.
- AI calls run in the main process, only to those same addresses, without cookies.
- "Open a website" uses `shell.openExternal` with https only, after the user presses Allow.
- Electron fuses turn off `RunAsNode`, `NODE_OPTIONS` and the inspector flags, and only load the app from its checked asar.

## Develop

```
npm ci
npm start          # run Pilot
npm test           # unit tests
npm run smoke      # smoke test (on Linux: xvfb-run -a npm run smoke)
npm run dist       # build the universal .dmg (on a Mac)
```

## Releases

`.github/workflows/pilot-desktop.yml` runs on `macos-latest` for every push that changes `pilot-desktop/**`, and by hand. It runs the tests and the smoke test, builds a universal (Apple Silicon + Intel) `.dmg`, checks it, uploads it as a workflow artifact, and creates or updates the GitHub Release **Pilot for Mac vX.Y.Z** (tag `pilot-mac-vX.Y.Z`, from `version` in `package.json`) with the `.dmg` attached. The release text comes from `RELEASE_NOTES.md`.

### Signing (needs the owner)

The app is ad-hoc signed for now, so people press "Open Anyway" once (INSTALL.md). Signing and notarisation turn on by themselves when these repository secrets exist: `CSC_LINK` and `CSC_KEY_PASSWORD` (a Developer ID Application certificate as base64 .p12 and its password), and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. That needs a paid Apple Developer account, held by an adult.
