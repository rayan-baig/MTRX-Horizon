# Pilot: the MTRX Horizyn assistant

Pilot is the AI assistant in every MTRX Horizyn app. It runs on **the user's own AI key**, from
their browser: MTRX Horizyn never sees the key, never sees the conversation, and pays nothing for
the AI. This file describes the shared core (**Pilot core 1.1.0**) and how it is used on the
MTRX Horizyn site, and how a later app (CyberLogix, OmniArmor, RankUp) adds it.

## What the user sees

- **The robot.** The owner's round robot (a halo ring, headphones, cyan smiling eyes and a "P" on
  its chest) sits in a corner of every public page. It glows blue while it thinks, and a dot on it
  says how it is: green ready, amber no key yet, pulsing thinking. It can be dragged to any corner
  and stays there (remembered on that device). It is a picture (`pilot-robot-128.webp`, 9 KB, and
  `pilot-robot-256.webp` for sharp screens, 23 KB, both transparent), fetched by the loader after
  the page has drawn. Once the page is idle it comes to life (see **The moving robot** below):
  it breathes and blinks, and now and then strolls along the bottom of the page, does a trick,
  peeks or waves. Under "reduce motion" none of that is even fetched, and it stays still.
- **The window.** Tapping the robot opens the Pilot window: the P-with-orbit logo, **Pilot**,
  "Your AI copilot. Powered by you.", a greeting ("Hello! I'm Pilot. How can I help you
  today?"), five pills (Ask anything…, Get things done…, Help with code…, Analyze & explain…,
  Customize with your API key), the "Type a message…" box with its send button, and the gear
  (settings), palette (a calmer look) and ? (help) buttons. On a computer it is a side window
  next to the robot; on a phone it is a full-width sheet. Answers stream in, with Copy on each,
  Stop while it runs, and Clear chat under the conversation.
- **Suggestions** under the conversation fit the page (on Genesis: "Show my projects", "What's my
  next step?"), plus **Summarise this**. **Analyze & explain…** explains the screen.
- **Voice**, where the browser has its own speech recognition: a microphone in the box. The words
  land in the box to check before sending. Hidden where the browser has none.
- **Memory**, off by default: "Remember that I prefer short answers" is kept in that browser
  only, listed under "What Pilot remembers" in settings, each with Delete. Turning it off forgets
  everything.
- **It follows the user.** The chat and whether the window is open carry over from page to page
  (sessionStorage). Tabs of the same site stay in step through a BroadcastChannel: a reply in one
  tab shows in the others, a new tab picks up the chat, and only one tab sends a request at a
  time (a Web Lock where the browser has them).

## The moving robot (core 1.1.0)

The robot moves around by itself, gently: most of the time it rests (a slow breath and a blink now
and then); every so often it does something. The engine is the same on the web and in Pilot for
Mac: `pilot-motion.js` (no DOM) decides what and when and turns a move into a plan;
`pilot-actor.js` plays the plan on the page; `pilot-actor.css` is its look.

**Moves.** Walk and run (a hop-walk along the bottom edge, with squash and stretch and a small dust
puff), fly (a soft arc with a blue glow trail), climb (up a side edge in small steps, a look around,
and back down), tricks (a backflip, a spin on the spot, three bounces, and a peek from behind a screen
edge), wave (the wave pose with a sway and a 👋 bubble), look (the head and eyes turn toward the
mouse), and three rarer sports tricks: **football** (a spiral throw across the screen, a bounce, gone),
**soccer** (a goal slides in at one side, the robot dribbles, kicks, the net ripples, "GOAL!", the goal
slides away; about 4 seconds) and **tennis** (a net and a court line by a side edge, a few rallies off
the screen edge, a smash, then everything fades). The props (balls, goal and net, racket, tennis net)
are small SVGs drawn in code in the robot's blue and violet, live only during their trick, never take
clicks, and are removed when it ends or is stopped. Every move eases in and out; nothing is frantic.

**The resting robot is the owner's design picture**, in three layers that stack exactly into it:
`pilot-rest-body.webp`, `pilot-rest-head.webp` (halo, headphones, visor; cut along the neck with a
little overlap, and a dark neck behind it so a tilt never shows a gap) and `pilot-rest-eyes.webp`
(just the glowing eyes). So the head can bob, tilt, nod and look, and the eyes can blink, with no new
drawing. `tools/pilot_art.py` makes these layers (and the pose canvases below) from the owner's art.

**Poses.** Each moment of a move names the pose picture it wants: `standing`, `sitting`, `wave`,
`walk1`, `walk2`, `run1`, `run2`, `fly`, `climb1`, `climb2`, `flip`, `throw`, `kick`, `tennis`. When a
move starts, the robot hops from the design picture into `standing` in about 150 ms with a little
squash, so the swap reads as standing up, and back again when it settles. A pose without a picture
falls back, and in the end to the resting design robot moved by transforms, so every move works
without any pose pictures at all:

| Pose | Without its picture |
|---|---|
| `walk2` | `standing` (walking alternates walk1 and standing, with a bob and a lean), else `walk1` |
| `run2` | `run1`, else `walk1` |
| `run1` | `walk1` |
| `climb2` | `climb1`, nudged a step higher |
| `throw` | `wave` (the football leaves the raised hand), else `standing` |
| `kick` | `run2` with a quick lean forward, else `run1` |
| `tennis` | `standing`, holding a drawn racket |
| any other | the resting design robot |

**Adding a pose picture needs no code change:** put `<pose>.webp` (or `.png`) with exactly one of
the names above in `static/pilot/poses/` (web) or `pilot-desktop/assets/poses/` (Mac). The server
lists the web folder into the loader's `data-poses`; the Mac app reads its folder at start. The
easiest way to keep every pose the same size and on the same baseline is to put the owner's PNGs in a
folder and run `python3 tools/pilot_art.py --design pilot-robot.png --poses that-folder`: it scales
each picture so the halo is the same width in every pose, centres it on the halo, puts the robot's
lowest point on one baseline, and writes both copies (300 × 340 for the Mac, 240 × 272 for the web).
Pictures are never mirrored (the "P" would come out backwards). Today these exist: standing, sitting,
wave, walk1, run1, run2, fly, climb1, flip. A sports prop is held at the hand positions in `HANDS` in
`pilot-motion.js`; a new throw, kick or tennis picture whose hand is elsewhere may want that adjusted.

**When.** About every 30 to 120 seconds (at random; Low waits longer, Playful less) the robot may
walk or run somewhere, fly, climb an edge, do a trick, wave or look around; sports tricks are rarer,
more common on Playful. It keeps still in **calm mode**, under **reduce motion** (calm by default),
**while the chat is open**, **while the user is typing**, while **something is full screen in front**
(a video, a game), and while it's hidden or dragged. It waves when the user comes back after being
away and (gently) when the chat opens.

**On the web** it is toned down: it stays near its corner (strolls along the bottom of the page and
back, tricks, a peek up from the bottom edge, waves, an occasional football throw), always ends back
at its corner, never moves while the window is open, and does nothing while the tab is hidden.
Flights, climbing, running, soccer and tennis only when the visitor picks **Playful** under "The
robot" in Pilot's settings (Calm, Low, Normal or Playful, kept on that device). Under
`prefers-reduced-motion` the moving robot isn't fetched at all. On the Mac there is more room: see
`pilot-desktop/README.md`.

**Speed.** `pilot-motion.js`, `pilot-actor.js`, `pilot-actor.css` and the three layers (about 18 KB of
pictures) are fetched once the page is idle, after load; a pose picture is fetched only when a move
first needs it (each under 21 KB). Everything moves with the Web Animations API on transforms and
opacity, on the compositor: no script runs per frame, and nothing animates while the robot rests
apart from a blink (170 ms every few seconds) and a slow breath every half a minute or so, from timers.

## Keys and providers

The user adds keys under the gear, in "Bring Your Own API Key". They can keep several chat keys and
switch between them, plus one **image generation** key and one **video generation** key. Keys stay
in that browser only: in sessionStorage (forgotten when the tab closes) unless they tick
"Remember my keys on this device" (then localStorage). **Remove my keys from this browser** deletes
them all, in every open tab of the site. A tab of the same site opened while Pilot is set up gets
the keys from an open tab over the browser's same-site BroadcastChannel, so Pilot carries on there;
nothing else can hear that channel.

After a key is entered, **Check key and list models** asks the provider which models that key may
use, and the user picks one; if listing fails they can type a model name. No model name is written
anywhere in Pilot's code or these docs.

| Provider | Chat | Pictures | Videos | From a browser |
|---|---|---|---|---|
| Anthropic | yes, streaming, tools | no (it doesn't make them) | no | yes, with its `anthropic-dangerous-direct-browser-access` header (checked: it answers browsers) |
| OpenAI | yes (Chat Completions), streaming, tools | Images API | Videos API | yes (its API answers browsers) |
| Google Gemini | yes, streaming, function calls | image models (`predict` or `generateContent` with pictures) | video models (a long-running job) | yes, key in the `x-goog-api-key` header (checked: it answers browsers) |
| Any compatible API | yes (OpenAI-style), streaming, tools | its `/images/generations` | its `/videos` | only at the addresses the site allows (below), if that service answers browsers |

**Any compatible API** means an OpenAI-compatible base URL plus key. The browser may only reach the
addresses in the site's security policy, so on the MTRX site these are: `openrouter.ai`,
`api.groq.com`, `api.mistral.ai`, `api.deepseek.com`, `api.together.xyz`, `api.fireworks.ai`,
`api.x.ai`, and the user's own computer (`http://localhost` and `http://127.0.0.1`, any port, for a
local model; that model must allow the site in its CORS setting, and some browsers ask before a
public page may reach the user's own computer). Another address gets a plain message instead of a
silent failure. Whether each of those services answers browser calls is up to it: if one doesn't,
Pilot says it couldn't reach it. **Nothing is proxied through our server**: there is no pass-through
for keys or content, so the owner pays nothing and no key can end up in a log.

Errors are said plainly: "Your key was refused by Anthropic. Check it in Pilot settings.", out of
credit, too many requests, an unknown model, the provider busy, or no connection.

The user's provider bills their key for everything Pilot uses. The window says so. AI keys are for
grown-ups: the MTRX site says "Pilot uses your own AI key. AI keys are for grown-ups (the AI
companies require 18+)." once, beside the key settings, and never nags.

## What is sent, and to whom

Only to the provider the user chose, only when they send a message:

- what they typed, and the conversation so far in that tab;
- Pilot's rules, the app's knowledge pack and "why it's better" list, the name of the screen, and a
  few facts about it (on Genesis: today's spark prompt);
- the notes in "What Pilot remembers", if memory is on;
- with **Analyze & explain** or **Summarise**: an outline of the words on the screen. It never
  reads inputs, text boxes or selects, anything hidden, anything marked `data-pilot-private` (the
  Genesis Pro key box), or Pilot's own window, and it blanks out email addresses and phone
  numbers. The message shows "What Pilot sent from this screen" with the exact text;
- the results of tools the user's request ran (on Genesis: their project names, pitches, stages and
  next steps; never the notes).

Nothing about other people, and no personal data, is sent unless the user types it or approves a
tool. MTRX Horizyn's server receives nothing at all from Pilot.

## Doing things (tools)

If the provider and model support tools, the app's tools are offered. If a model refuses tools,
Pilot remembers that for that key and just chats and explains.

- **Read-only tools** run straight away.
- **Tools that change anything** run only after the user presses **Allow** on a card that says
  exactly what will happen: "Pilot wants to: add the step “Ask 3 friends” to Plant Pal (Spark)".
  They run through the app's own functions with the user's own permissions.
- **Several changes** are shown first as a numbered plan: **Approve all**, **Step through** (a card
  per step) or **Cancel**. Stop works at any point and stops the plan before its next step. The
  chat then lists what was done.
- **Never**: payments, deleting anything, changing a plan or subscription, messaging other people.
  The engine refuses any tool whose name suggests one, and a change tool must describe itself.
- **No tools at all on a child's view**, and no Pilot there either: an app's `kidView()` hides
  Pilot completely (RankUp shows it only in Parent Mode).
- With an image key, Pilot can **make a picture** (shown in the chat with Download). With a video
  key it can **start a video** (after Allow, since videos cost more), shows its progress and then
  the video with Download. Pictures and videos stay on that page only. Without those keys, those
  abilities don't exist.

### On the MTRX site

On the Genesis page (where `window.GenesisBridge` from `static/js/genesis.js` does the work through
the page's own rules and saving):

| Tool | Kind |
|---|---|
| `show_my_projects` | read |
| `whats_my_next_step` | read |
| `add_step` (a step of the user's own, to a stage) | asks first |
| `start_project` (name, pitch, who it's for) | asks first |
| `fill_spark` (today's spark answer) | asks first |

"Turn my spark into a project and add 3 steps" becomes a four-step plan.

### Ask Genesis with the user's key

When a Pilot chat key is set, Ask Genesis (`static/js/genesis-ask.js`) sends the same four project
fields, with exactly the server's own words (a test checks they match `horizon/genesis_ai.py`),
straight from the browser to the user's provider, with **no free daily limit**. The badge says
"AI · your key". Without a key, the server's free help is unchanged (5 a day, 3 an hour), and
Genesis Pro members keep Pro's own answers either way.

## Speed and security

- A page loads one small script for Pilot (`pilot.js`, about 4 KB compressed, deferred). Only
  after the page has finished loading does it fetch the store, the robot and the app's config
  (about 10 KB more), `pilot.css` and the robot picture. The window, engine, providers, renderer,
  media and knowledge pack load only when Pilot is first opened. Measured on a slow phone
  (tools/measure_pages.py), the pages' LCP is unchanged.
- The strict security policy stays: no inline scripts or styles, no `style=` attributes (the P
  mark and icons are SVG built with attributes, the robot is a picture from this site; the look is
  classes). Pilot added only the provider
  addresses above to `connect-src`, `blob:` to `media-src` (for a video Pilot made, shown from
  memory), and `microphone=(self)` to the permissions policy (voice, only when its button is
  pressed).
- Answers are untrusted text. `pilot-render.js` turns markdown into elements and text nodes only:
  `<script>` in an answer shows as the letters `<script>`; links work only for http(s) and open
  without the page's address.

## The files

The core is the same in every app. Each file starts with `Pilot core 1.1.0 · <file name>`, so
copies in different repos can be compared.

| File | What it is | DOM |
|---|---|---|
| `static/pilot/pilot-store.js` | keys, chat, memory and window state in browser storage | none |
| `static/pilot/pilot-engine.js` | the chat engine: rules, tools, confirms, plans, stop | none |
| `static/pilot/pilot-providers.js` | the provider adapters (chat, streaming, tools, model lists, errors) | none |
| `static/pilot/pilot-media.js` | pictures and videos with the image and video keys | none |
| `static/pilot/pilot-render.js` | the safe markdown renderer (`parse` needs no DOM) | builds nodes |
| `static/pilot/pilot-mascot.js` | the robot picture (as an `<img>` with both sizes) and the P mark (SVG) | builds nodes |
| `static/pilot/pilot-robot-128.webp`, `pilot-robot-256.webp` | the owner's robot, transparent | — |
| `static/pilot/pilot-motion.js` | the moving robot: poses and fallbacks, moves as plans, when to move | none |
| `static/pilot/pilot-actor.js` | plays the plans: the layered robot, pose pictures, effects, props; the web robot's wandering | builds nodes |
| `static/pilot/pilot-actor.css` | the moving robot's look, effects and props | web |
| `static/pilot/pilot-rest-body.webp`, `-head.webp`, `-eyes.webp` | the design robot in three layers | — |
| `static/pilot/poses/<pose>.webp` | the pose pictures (any of the names above) | — |
| `static/pilot/pilot.js` | the web loader: robot in the corner, dragging, lazy loading, tabs | web |
| `static/pilot/pilot-panel.js` | the web window: chat, cards, settings, help, voice, screen outline | web |
| `static/pilot/pilot.css` | the robot's look and animations | web |
| `static/pilot/pilot-panel.css` | the window's look, side window and phone sheet | web |

The engine, providers, media and store have no DOM, so the **desktop app** can reuse them
unchanged with its own window, and reuse the robot pictures, `pilot-mascot.js` and
`pilot-panel.css` for the same robot and window look. It provides the same small `host` the web window gives the engine (`confirm`,
`plan`, `progress`, `update`, `exclusive`, `image`, `video`, `fetch`).

Per app (on the MTRX site):

| File | What it is |
|---|---|
| `templates/_pilot.html` | the one script tag, with fingerprinted addresses and the server's facts |
| `static/js/pilot-mtrx.js` | the small config (below), loaded by `pilot.js` after the page has loaded |
| `static/js/pilot-mtrx-pack.js` | the knowledge pack, "why it's better" list and Genesis tools, loaded on first open |

## Adding Pilot to another app

1. **Copy the thirteen core files, the two robot pictures, the three layers and the `poses/` folder** above into
   the app's static folder (keep them unchanged, and copy a newer core into every app together).
2. **Allow the providers** in the app's Content-Security-Policy `connect-src`:
   `https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com`,
   the compatible hosts the app wants (each `https://host`), and `http://localhost:* http://127.0.0.1:*`
   for local models; add `blob:` to `media-src` if the app wants videos, and `microphone=(self)` to
   its Permissions-Policy for voice. Nothing else needs widening.
3. **Load it** on the pages that should have Pilot (never a child's view), with one tag (use the
   app's fingerprinted addresses if it has them):

   ```html
   <script src="pilot/pilot.js" defer id="pilot-core"
     data-store="pilot/pilot-store.js" data-mascot="pilot/pilot-mascot.js"
     data-app="the-app-pilot-config.js" data-pack="the-app-pilot-pack.js"
     data-css="pilot/pilot.css" data-panel-css="pilot/pilot-panel.css"
     data-robot="pilot/pilot-robot-128.webp" data-robot2x="pilot/pilot-robot-256.webp"
     data-render="pilot/pilot-render.js" data-providers="pilot/pilot-providers.js"
     data-engine="pilot/pilot-engine.js" data-media="pilot/pilot-media.js"
     data-panel="pilot/pilot-panel.js"
     data-motion="pilot/pilot-motion.js" data-actor="pilot/pilot-actor.js" data-actor-css="pilot/pilot-actor.css"
     data-rest-body="pilot/pilot-rest-body.webp" data-rest-head="pilot/pilot-rest-head.webp"
     data-rest-eyes="pilot/pilot-rest-eyes.webp"
     data-poses="standing=pilot/poses/standing.webp wave=pilot/poses/wave.webp …"></script>
   ```

   Any other `data-*` on that tag is there for the app's config to read (the MTRX site passes its
   live facts and allowed hosts this way). An app's own code that wants Pilot (as Ask Genesis does)
   listens for the `pilot-ready` event.

4. **Write the config**, which calls `Pilot.mount({...})`:

   | Field | Meaning |
   |---|---|
   | `appName` | the app's name, used in Pilot's rules ("the assistant built into …") |
   | `name`, `tagline` | the window's title and tagline (default "Pilot", "Your AI copilot. Powered by you.") |
   | `storagePrefix` | the browser-storage prefix, e.g. `cyberlogix-pilot` (lowercase, digits, dashes) |
   | `pack` | the address of the knowledge-pack script, loaded on first open; it sets `window.PilotPack` |
   | `compatibleHosts` | the OpenAI-compatible hosts the app's policy allows, plus `localhost`, `127.0.0.1` |
   | `kidView()` | true on a child's view: Pilot isn't shown at all, and no tools are ever offered |
   | `screen()` | `{name, facts}`: the screen the user is on, and any short facts about it |
   | `chips(screen)` | up to 3 `{label, prompt}` suggestions for this screen |
   | `taskPrompt(screen)` | what "Get things done…" puts in the box on this screen |
   | `keyNote` | the one-line note beside key settings (e.g. the 18+ line) |
   | `audienceNote` | who may be using it, for Pilot's rules |
   | `privacyUrl` | the app's privacy page, linked from help |
   | `themeClass` | an optional class on Pilot's root, to restyle its colours from the app's CSS |
   | `facts` | any app data the pack needs (on the MTRX site: the server's live settings) |

   The pack (`window.PilotPack`) gives `knowledge` (plain-language guide to the app's screens,
   features, plans and FAQs, written from the real app), `strengths` (a short, true "why it's
   better" list: no rival named, no invented numbers), `tools()` and optionally `facts(screen)` and
   `screenText()`.

5. **Write the tools**, each `{name, kind: "read" | "change", description, parameters (JSON
   schema), run(args, ctx), describe(args) (for changes), available()}`. `run` must go through the
   app's normal API with the user's own session and permissions. A change's `describe` returns the
   words of its confirm card. Read tools for things like "what's due today" or "which fridges are
   warm"; never payments, deleting, plan changes, messaging people, or anything on a child's
   account without the parent confirming.
6. **Update the app's privacy page** to say what Pilot sends, to whom, and that keys stay in the
   browser, and its terms to say the user's AI company bills them and keys are for over-18s.
7. **Tests**: copy `tests/js/pilot.test.js` (the core's own tests) and add the app's checks: the
   security policy hosts, Pilot absent from kid views, the pack present.

### Apps still on an older core

CyberLogix and OmniArmor carry Pilot core 1.0.x. They keep working as they are; to get the moving
robot they need the 1.1.0 core files, the layers and the `poses/` folder copied in (and the new
`data-*` on their tag), in their own repos, later. This repo doesn't change them.

### Server-side AI in an app

Pilot itself never needs a server. Where an app's own AI feature runs on the server (CyberLogix's
AI-written alert line), that app lets a business save its own key in its settings, encrypted at rest
with a key from a server secret, shown again only as its last four characters, never logged, used
only for that business, removable, and falling back to the plain template wording if a call fails.
That is part of that app's phase, not the core.

## Tests

`python -m pytest` runs `tests/test_pilot.py` (pages, security policy, lazy loading, private pages,
no model names, version headers, Ask Genesis parity, the free limits) and the core's Node tests,
`node --test tests/js/pilot.test.js` (every provider mocked: streaming, tools, model lists, errors,
key storage and removal, several keys, image and video keys, memory, confirm before action, plans,
no tools on kid views, safe rendering, the robot picture and the P mark, the knowledge pack, and the
moving robot: pose fallbacks, reduce motion, when it moves, Playful-only moves on the web, every web
move ending at home). `tests/test_pilot.py` also checks a new pose picture is picked up, the moving
robot is fetched late and never under reduce motion, and its pictures stay small. The Mac app's own
tests are in `pilot-desktop/test/`.
