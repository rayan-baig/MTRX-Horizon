# Pilot for Mac

Pilot is the MTRX Horizyn AI assistant as a Mac app: a small robot that floats above every app, on every desktop and over full-screen apps. Click it and a chat window opens next to it. It runs on the user's own AI key (Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible API), so their provider bills them directly; there is no MTRX server in between.

People who just want the app: see [INSTALL.md](INSTALL.md).

## What it does

- **Robot window**: the owner's robot artwork, 110 px, with a gentle float and a soft glow pulse while thinking. Drag it anywhere; the spot is remembered. A status dot: green ready, amber no key yet, pulsing while thinking or looking. No Dock icon; the menu bar shows the robot's head with Show/Hide Pilot, Open Chat, Settings, Start at Login, About Pilot and Quit Pilot.
- **Chat window**: matches the design: glass panel with a blue-violet edge, the P-with-orbit mark, "Pilot", the greeting, five pill buttons, the message box, the gear, palette and ? buttons, and the "Bring Your Own API Key" card. Closing it leaves the robot. The first time, a short welcome shows three steps.
- **Keys**: several chat keys can be saved and switched, plus separate image and video keys. Models come from the provider's own model list for the key, or the user types one. Keys are encrypted with Electron `safeStorage` (the encryption key lives in the macOS Keychain); without the Keychain, Pilot refuses to save a key. Keys stay in the main process: windows only ever see the last four characters.
- **Seeing the screen**: only when the user asks: the eye button ("Look at my screen", "Explain this screen", "Summarise what I'm looking at", and "Help with what's on screen", which sends a fresh screenshot with each message while it's on), or after the user presses Allow on Pilot's "look at the screen" card. The first time, Pilot explains Screen Recording in plain words and opens the right pane in System Settings. A "Pilot is looking at your screen…" banner shows while a screenshot is taken and sent; Pilot's own windows are left out of the picture. Nothing is captured in the background.
- **Actions, all asked first**: look at the screen, copy a reply or draft to the clipboard, open an https website in the browser, save a note, remember a fact (only with memory on), make a picture or video (only with those keys). Several actions become a numbered plan: Approve all, Step through, or Cancel. There is no tool for payments, deleting files, sending messages or email, or typing into other apps.
- **Memory** is off by default; remembered facts and saved notes can be viewed and deleted in settings. **Voice**: macOS Dictation works in the message box.
- **Start at login** is on by default, with a switch in settings and the menu bar. Quit always quits.

## How it's built

```
src/main/       main process: windows, menu bar, IPC, key store, screen capture, CSP
src/preload/    the small API the windows get (contextBridge)
src/renderer/   robot.html and chat.html (no inline scripts or styles)
src/core/       chat engine, providers, media, safe renderer, desktop tools
assets/         the robot artwork, its menu-bar head, the app icon
build/          icon.icns, the .dmg background, entitlements (for signing later)
test/unit/      node:test unit tests
test/smoke/     Playwright-for-Electron smoke test (also takes the screenshots)
```

### Shared core

`src/core/pilot-providers.js`, `pilot-media.js` and `pilot-render.js` are copied unchanged from the web Pilot core **1.0.0** in `static/pilot/` (commit `fc2500d`); `src/core/core-version.json` records their checksums and a test checks them. The desktop layers `providers.js` and `media.js` build on the core's adapters, adding pictures (screenshots in messages and tool results) and running in Node. `engine.js` is the desktop's own engine with the same structure and host interface as the core's `pilot-engine.js`; it is separate because the Mac needs pictures in tool results, every action asked first, and older screenshots dropped from what is sent again.

To update the core: copy the three files from `static/pilot/` over, update `core-version.json`, and run `npm test`.

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
