# Pilot: the MTRX Horizyn assistant

Pilot is the AI assistant in every MTRX Horizyn app. It runs on **the user's own AI key**, from
their browser: MTRX Horizyn never sees the key, never sees the conversation, and pays nothing for
the AI. This file describes the shared core (**Pilot core 1.4.0**) and how it is used on the
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
  Customize with your API key), the page's suggestions, the "Type a message…" box with its send
  button, and the gear
  (settings), palette (a calmer look) and ? (help) buttons. On a computer it is a side window
  next to the robot; on a phone it is a full-width sheet. Answers stream in, with Copy on each,
  Stop while it runs, and Clear chat under the conversation.
  That is the design, and Pilot for Mac keeps it exactly. Since core 1.2.0 a website can set its
  own tagline and pills (`tagline`, `welcomePills`, see **Each app's own welcome** below); the
  MTRX site does. Since core 1.3.0 a website whose pills include the key pill asks for the key
  once: no "Bring Your Own API Key" card as well (see **Asking for the key once** below). Since
  core 1.4.0 a pill or suggestion can work with no key at all: a link to a page, or the app's own
  answer (see **Pill actions** below).
- **Suggestions** are on the welcome too (before a key is added), and come first once a chat has
  started (the greeting and its pills are for starting, and fold away), and fit the page (on Genesis: "Show my projects", "What's my
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

## Each app's own welcome (core 1.2.0)

The design's welcome (the tagline "Your AI copilot. Powered by you." and the five pills) is the
default, and Pilot for Mac keeps it exactly. A website can make the welcome its own with four
config fields:

| Field | What it does | Default |
|---|---|---|
| `tagline` | the line under "Pilot" in the window's header | "Your AI copilot. Powered by you." |
| `welcomePills` | up to 5 `{icon, label, action, send}` pills (below; since 1.4.0 also `link` or `answer`, see **Pill actions**) | the design's five |
| `hideKeySections` | key settings to leave out: `["image", "video"]`, either or both | none hidden |
| `chips(screen)` | (already there) this page's suggestions: now also on the welcome, under the pills | none |

A pill's `icon` is one of the window's line icons: `chat`, `bolt`, `code`, `bars`, `gear`, `key`,
`spark`, `help`, `copy` (anything else shows `spark`). Its `label` is plain words (40 characters at
most). Its `action` is either a built-in:

| `action` | What the pill does |
|---|---|
| `ask` | puts the cursor in the message box |
| `task` | puts the app's `taskPrompt(screen)` in the box |
| `code` | puts "Help me with this code: " in the box |
| `explain-screen` | explains the screen (sends its outline, as "Analyze & explain…" does) |
| `summarise-screen` | summarises the screen |
| `settings` | opens key settings |
| `help` | opens help |

or any other words: a prompt put in the box for the visitor to finish and send (a trailing space is
kept, so "My idea: " leaves the cursor ready). With `send: true` the prompt is sent at once. The
core cleans what it is given (words only, a known icon, at most five); if nothing usable is left it
shows the design's five.

**Nothing typed is thrown away before there is a key.** A message sent (or a pill or suggestion
pressed) with no chat key yet stays in the box, key settings open with "Your message is waiting in
the box. It sends as soon as you add a key.", and it is sent the moment a key is saved, here or in
another tab of the site. Pressing "Explain this page" with no key does the same: the screen is
explained once the key is in.

### Asking for the key once (core 1.3.0)

Visitors were asked for a key two or three times in a row on the welcome (a key pill, the key card
and the note under them). Now:

- **An app's own key pill is the one ask.** When the app's `welcomePills` include the built-in
  `settings` pill, the welcome shows no key card. With the design's five pills (no app pills), the
  card stays exactly as it was; Pilot for Mac doesn't use this window at all and is unchanged.
- **Websites say "AI key".** With app pills, the key card (if shown), the key settings' heading and
  the key box say "AI key" ("Your own AI key", "Paste your AI key"). The design's words ("Bring Your
  Own API Key") stay for the default welcome.
- **One line for the grown-ups note on the welcome.** `keyNoteShort` (optional) is a one-line
  version of `keyNote` shown above the box while the welcome is up (the full note is its tooltip,
  and stays beside the key settings and in help). Without it, `keyNote` shows as before.
- **Everything on the welcome fits.** On shorter screens (computers up to 900 px tall, phones up
  to 760 px) the header, greeting, pills and suggestions are a little tighter and phone sheets a
  little taller, so every pill and suggestion shows whole above the note and the box at 700 to
  900 px on a computer and 667 to 812 px on a phone (checked in a real browser for the MTRX site).
  Suggestions are slightly smaller on phones and short computer screens, so two fit on a row.

On the MTRX site: the tagline is "Help with ideas and MTRX apps"; the pills are **Help with my idea**
(since 1.4.0 a link to Genesis's start form, `/genesis#new`: free, and Genesis has its own free AI
help), **What is Orbyt?** and **What apps are coming?** (since 1.4.0 answered at once with no key:
see **Pill actions**), **Explain this page** (`explain-screen`) and **Add my AI key** (`settings`);
the image and video key sections are hidden (the site has no use for pictures or videos);
`keepInViewport` is on (below); and the welcome's one-line note is "AI keys are for grown-ups
(18+)." (`keyNoteShort`).

### Pill actions (core 1.4.0)

Reviewers pressed "See it live" or "What does it cost?" and got "add an AI key": every welcome
button led to the key, and the key felt like a wall. Since 1.4.0 a pill (in `welcomePills`) or a
page suggestion (from `chips(screen)`) can need no AI at all. Instead of `action` (or `prompt`), it
has one of:

| Field | What it does |
|---|---|
| `link: "/demo"` | goes to that page. **This site only**: a path (`/demo`, `pricing`, `#faq`) or a full address on the same site; anything else (another site, `//elsewhere`, `javascript:`) is left out. Pilot closes first, so the page shows. |
| `answer: "text"` | Pilot shows the text at once as its own chat message, under the pill's words as the visitor's message. **No key, and no network call.** |
| `answer: (ctx) => text` | the same, from a function (it may return a promise; Pilot waits up to 8 seconds). `ctx` is `{ screen, facts, ready, label }`: this screen (`screen()`), the config's `facts`, whether a key is set, and the pill's words. A function that throws or returns nothing shows "Pilot couldn't find that answer just now." |

An answer is markdown, rendered by the same safe renderer as every AI answer (`pilot-render.js`:
elements and text nodes only, never HTML), so `<b>` in an answer shows as those letters. The one
difference: an app's own answer may link to **this site's pages**, `[Orbyt](/orbyt)`, and those links
open in the same tab (Pilot closes first). Links elsewhere open in a new tab without the page's
address, as in AI answers. AI answers never get path links. An answer is kept as part of the chat
(page to page, tab to tab, marked `local` in storage) and, once a key is added, is part of what the AI
sees, like any earlier message.

While there is no key, a line under an answer offers it: **"Want more? Add your AI key to ask
anything."** with a **Key settings** button. `answerMore` (optional) changes the words; `answerMore:
false` leaves the line out. The line goes once a key is added.

The existing pills are unchanged: a prompt (`action` words, `send`), and the built-ins (`ask`,
`task`, `code`, `explain-screen`, `summarise-screen`, `settings`, `help`). **The no-key "message
waiting" flow is only for AI**: an AI prompt, a typed question, or "Explain this page" pressed with no
key stays waiting and is sent once a key is added; a link or an answer just works.

```js
welcomePills: [
  { icon: "spark", label: "See it live", link: "/demo" },
  { icon: "bars", label: "What does it cost?", answer: "From $X a month per location. [See prices](/pricing)" },
  { icon: "chat", label: "What's due today?", answer: (ctx) => dueTodayText(ctx.facts) },
  { icon: "bolt", label: "Explain this page", action: "explain-screen" },
  { icon: "key", label: "Add my AI key", action: "settings" },
],
chips: (screen) => [{ label: "How do sensors connect?", link: "/help/sensors" }, { label: "Ask about my fridges", prompt: "…" }],
```

An answer function runs in the visitor's browser with what the page already has: it must not call
the network (use facts the server put on the page) and must never put another person's details in
the chat.

On the MTRX site: **What is Orbyt?** answers with Orbyt's paths (each a link to its form), the 2
minutes, the real person and the 7-day reply, and **Open Orbyt**; **What apps are coming?** is built
from the site's own app list (the catalog, as Orbyt's "Our apps" lists it, passed on Pilot's script
tag as `data-apps` by `main.pilot_facts`), says which are open, and links to early access (or Orbyt
when early access is off). The home page's "What's ready today?" and "How do I start an idea?", and
Orbyt's "Which form is for me?" and "What happens after I send?", are answers too; the other
suggestions are AI prompts.

### Moving an app to core 1.4.0

1. Copy the thirteen core files from `static/pilot/` over the app's copies (they all say `Pilot core
   1.4.0` on their first line). Pictures, layers and poses are unchanged.
2. Nothing else is required: with no new fields the welcome, pills and suggestions work as before.
   Placement changes for everyone (below): on phones the robot no longer tucks into a top corner over
   the header, and never tucks over a link or button while another corner is free of them.
3. Give the welcome buttons that need no AI a `link` or an `answer` (**Pill actions** above): "See it
   live" → `{ link: "/demo" }`, "What does it cost?" → a short answer with a link to the prices page,
   "What sensors do I need?" → `{ link: "/help/sensors" }` or an answer. Keep `action` for what really
   needs the AI. Page suggestions (`chips`) take `link` and `answer` too.
4. Optional: `answerMore` (the line under an answer while there is no key).
5. If the app's `avoid` list names a big area (a whole card), the robot may now tuck over its edge
   rather than over a header button: list the small things inside it instead where that matters.
6. Copy the new `tests/js/pilot.test.js` core tests, and Pilot for Mac's six shared files if the app
   ships them (`pilot-render.js` changed: an optional third argument; Pilot for Mac doesn't use it).

### Moving an app to core 1.3.0 (from 1.2.x)

1. Copy the thirteen core files from `static/pilot/` over the app's copies (they all say `Pilot core
   1.3.0` on their first line). Pictures, layers and poses are unchanged.
2. Nothing else is required. With no new fields: the first look of a visit no longer shows the
   robot whole on top of the page's words (it glows wherever placement puts it: a free corner, or
   tucked away); the tucked-away robot is never smaller than a 44 px tap target; and with the
   app's own key pill there is no key card on the welcome, and key wording says "AI key".
3. Optional: `keyNoteShort`, a one-line grown-ups note for the welcome.
4. If the app's own CSS sets `--pilot-peek-scale`, keep it at or above 0.52 on computers and 0.82
   on phones (placement uses at least that anyway, so a smaller number would only make the drawing
   and the placement disagree).
5. Copy the new `tests/js/pilot.test.js` core tests, and Pilot for Mac's six shared files if the
   app ships them.

### Moving an app to core 1.2.0

1. Copy the thirteen core files from `static/pilot/` over the app's copies (they all say `Pilot core
   1.2.0` on their first line). The robot pictures, layers and poses are unchanged.
2. Nothing else is required: with no new fields the app looks and works as before (the design's
   welcome, image and video keys offered), except that the robot now shows whole for 4 seconds on
   the first page of a visit, steps back for any page-covering pop-up, keeps a little more room from
   the page's words, and this page's suggestions also show on the welcome.
3. Optional, in the app's config (`Pilot.mount({...})`): `tagline`, `welcomePills`,
   `hideKeySections`; `keepInViewport: true` to have the tucked-away robot shrink into its corner
   instead of hanging off the edge; `modals: [selectors]` for pop-ups that aren't `<dialog>` or
   `role="dialog"` (a CSS `:target` sheet, say); `revealMs` (0 to turn the first look off).
4. Run the app's copy of `tests/js/pilot.test.js` (copy the new one: it checks all of the above).
5. If the app ships Pilot for Mac's six shared files (`pilot-desktop/src/core/`), copy them too and
   update `core-version.json`; the Mac app's own welcome doesn't use these fields.

## The moving robot (core 1.1.0)

The robot moves around by itself, gently: most of the time it rests (a slow breath and a blink now
and then); every so often it does something. The engine is the same on the web and in Pilot for
Mac: `pilot-motion.js` (no DOM) decides what and when and turns a move into a plan;
`pilot-actor.js` plays the plan on the page; `pilot-actor.css` is its look.

**Moves.** Walk and run (a hop-walk along the bottom edge, with squash and stretch and a small dust
puff), fly (a soft arc with a blue glow trail), climb (up a side edge in small steps, a look around,
and back down), tricks (a backflip, a spin on the spot, three bounces, and a peek from behind a screen
edge), wave (the wave pose with a sway and a 👋 bubble), look (the head and eyes turn toward the
mouse), **celebrate** (a jump with both arms up and sparkles: after a goal, after an action the user
allowed is done, or now and then), **knee slide** (out a little way and a slide back into place, and
after a goal), **point** (points up, toward the menu bar on the Mac, when it has something to say: no
key yet), **power** (charges a glowing energy ball that bursts into sparkles), a **superhero landing**
after a flight, **love** (hearts, rare: when the user says thanks in the chat, or comes back after half
an hour or more), **waiting** (arms crossed with a little foot tap and a "…", once, when the chat has
been open with nothing happening for a while; playful, not grumpy), and three rarer sports tricks: **football** (a spiral throw across the screen, a bounce, gone),
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
`walk1`, `walk2`, `run1`, `run2`, `fly`, `climb1`, `climb2`, `flip`, `throw`, `kick`, `tennis`,
`celebrate`, `slide`, `point`, `power`, `dash`, `love`, `land`, `arms-crossed`. When a
move starts, the robot hops from the design picture into `standing` in about 150 ms with a little
squash, so the swap reads as standing up, and back again when it settles. A pose without a picture
falls back, and in the end to the resting design robot moved by transforms, so every move works
without any pose pictures at all:

| Pose | Without its picture |
|---|---|
| `walk2` | `standing` (walking alternates walk1 and standing, with a bob and a lean), else `walk1` |
| `run2` | `walk1` (running alternates run1 and walk1), else `run1` |
| `run1` | `walk1` |
| `climb2` | `climb1`, nudged a step higher |
| `throw` | `wave` (the football leaves the raised hand), else `standing` |
| `kick` | `run2` with a quick lean forward, else `run1` |
| `tennis` | `standing`, holding a drawn racket |
| `celebrate` | `standing` (the cheer after a goal or a backflip) |
| `dash` | `run1` (the first stride of a run), else `walk1` |
| `power` | `standing` (the crouch before a backflip) |
| `land` | `standing` (the touchdown after a flight) |
| `slide`, `point`, `love`, `arms-crossed` | the resting robot with a bubble (💡, 💙, …) until their picture exists |
| any other | the resting design robot |

**Adding a pose picture needs no code change:** put `<pose>.webp` (or `.png`) with exactly one of
the names above in `static/pilot/poses/` (web) or `pilot-desktop/assets/poses/` (Mac). The server
lists the web folder into the loader's `data-poses`; the Mac app reads its folder at start. The
easiest way to keep every pose the same size and on the same baseline is to put the owner's PNGs in a
folder and run `python3 tools/pilot_art.py --design pilot-robot.png --poses that-folder`: it scales
each picture so the halo is the same width in every pose, centres it on the halo, puts the robot's
lowest point on one baseline, and writes both copies (300 × 340 for the Mac, 240 × 272 for the web).
Pictures are never mirrored (the "P" would come out backwards). Today the owner's 18-pose set is in
place: standing, sitting, wave, walk1, run1, fly, climb1, flip, throw, kick, tennis, celebrate, slide,
point, power, love, land and arms-crossed (walk2, run2, climb2 and dash fall back as above). The set is
drawn at one scale, so `tools/pilot_art.py` scales it once, from the standing robot's halo (with small
nudges in `SET_FIX` for a head drawn a little bigger or smaller), and a new set replaces the old one.
Three pictures hold their own prop: `throw` a football, `kick` a soccer ball and `tennis` a racket and
ball. The moves hand over to the code-drawn props at the right moment (the football appears in the hand
as the throw picture gives way to the follow-through; the code's soccer ball hides while the kick
picture shows its own, then flies; the tennis picture shows only at each swing, its ball where ours
arrives), and the code-drawn balls look like the drawn ones. A sports prop is held at the hand positions in `HANDS` in
`pilot-motion.js`; a new throw, kick or tennis picture whose hand is elsewhere may want that adjusted.

**When.** About every 30 to 120 seconds (at random; Low waits longer, Playful less) the robot may
walk or run somewhere, fly, climb an edge, do a trick, wave or look around; sports tricks are rarer,
more common on Playful. It keeps still in **calm mode**, under **reduce motion** (calm by default),
**while the chat is open**, **while the user is typing**, while **something is full screen in front**
(a video, a game), and while it's hidden or dragged. It waves when the user comes back after being
away and (gently) when the chat opens.

**On the web** it is toned down: it stays near its corner (strolls along the bottom of the page and
back, tricks, a peek up from the bottom edge, waves, a cheer, hearts, a point when there's no key yet,
an occasional football throw), always ends back
at its corner, never moves while the window is open, and does nothing while the tab is hidden.
Flights, climbing, running, soccer, tennis, the knee slide and the energy ball only when the visitor
picks **Playful** under "The
robot" in Pilot's settings (Calm, Low, Normal or Playful, kept on that device). Under
`prefers-reduced-motion` the moving robot isn't fetched at all. On the Mac there is more room: see
`pilot-desktop/README.md`. Pilot for Mac (1.2 and later) defaults to **Always moving**, its own
`pilot-desktop/src/core/roam.js` on top of this core (unchanged): he keeps travelling with short
pauses, and its Energy choices are Calm, Relaxed (the rules above) and Always moving. The web robot
is not affected.

**Out of the way (web).** On phones the robot is 56 px. While a pop-up of the page is open
(`<dialog open>`, `[aria-modal="true"]`, `[role="dialog"]`, `[role="alertdialog"]`; Pilot's own window
doesn't count) it steps back: hidden, and taps go through. An app lists in its config what the robot
must keep clear of: `avoid` (things it mustn't cover) and `yieldTo` (another helper character, like
OmniArmor's Armo). When one of those is showing where the robot sits, it moves to the first free
corner (the other side, then the other edge); if none is free it tucks half away at the edge until
tapped. It doesn't wander while it's yielding (since core 1.4.0, only while one of those is along the bottom of the screen, where it strolls: before, anything to avoid anywhere on the page kept it still). The visitor's own chosen corner is kept. While Pilot is
on a page, `<html>` has the class `pilot-on` and the CSS variable `--pilot-gutter` (the room the robot
needs at the bottom); a page can keep its last lines clear with `padding-bottom: var(--pilot-gutter)`
or the `.pilot-gutter` class.

**Noticed, then out of the way (core 1.2.0, 1.3.0).** On the first page of a visit (once per tab,
kept in sessionStorage) the robot glows softly for 4 seconds, so people notice it; `revealMs`
changes how long (0 for never). Since core 1.3.0 the first look follows exactly the same placement
rules as the rest of the visit: it shows whole in a free corner if there is one, and if every
corner has the page's words or buttons (or things the app asks it to avoid), the glow plays where it
is tucked away. (Core 1.2.x showed it whole wherever it was for those 4 seconds, which put it on a
"Learn more" button, a heading's last word or a form's box.) With no corner free at all, it tucks
in the corner where its tucked-away box covers least of the page's words and buttons. It steps back for any pop-up of the page, marked or not: the four dialog selectors above,
the app's own `modals` selectors, and anything fixed that covers the whole screen above the page
(a backdrop: on top at the middle of the screen and near the robot's corner, not behind the page,
and not see-through to taps, so scenery like a starry sky never counts). It looks again when the
address changes too, for `:target` pop-ups. It keeps a little room from the page's words
(`--pilot-clear-x`, 12 px across, where its hand reaches, and `--pilot-clear-y`, 4 px), and small
things that mean something without words count as content: anything with a tooltip (`title`), a
picture role, a progress bar or meter, or `data-pilot-clear` (Genesis's row of streak dots).

**Phones: top corners last, never over a link (core 1.4.0).** Core 1.3.0 on a phone could tuck the
robot into a top corner: CyberLogix's console on a brand-new account (top left, 3 px from the screen's
corner, over the logo), its `/help/sensors` page after a long scroll, and the MTRX site's Orbyt and
Genesis pages (top right, over the header's small **Home** link, so a tap on Home opened Pilot). The
cause was in `pilot-mascot.js`: (1) a header that stays put (sticky or fixed) had no words exactly
under the tucked robot's small box, so a top corner looked free and won the tucked-away pass, which
tried the top corners before giving up on the bottom ones; (2) with no corner free, "covers least"
counted only square pixels, and the same link found at several points of the grid counted again each
time, so most of a small "Home" link (or a logo) looked cheaper than the corner of a big card or a few
words; (3) on a phone nothing made a top corner the last choice. Now:

- **Phones** (up to 720 px wide, `isNarrow`) try the bottom corners first, whole and then tucked
  away, before any top corner (`cornerPasses`); a bottom corner tucked over a few words or a small
  picture still beats every top corner. A top corner the visitor dragged it to stays first.
- **A header or bar that stays put** (`position: fixed` or `sticky`, under 40% of the screen; never a
  whole-screen layer) counts as busy (`pinnedBar`, kind `pinned`), so its empty end is never "free".
- **What it would cover is weighed** (`costOf`, `WEIGHT`): a link, a button or a box costs
  1,000,000 times the share of it covered (at least a tenth), so it never tucks over one while another
  corner avoids one, and a big card's corner costs less than most of a small "Home" link; a bar that
  stays put 50,000; something the app asked it to avoid 100,000 plus its area; a busy top corner on a
  phone 10,000,000 more (only a box being typed in along the bottom sends it up); words and small
  pictures their area. Each thing found counts once.
- **The first look on a small screen** (360 px wide or less, or 700 px tall or less: `isCompact`)
  plays tucked away, and it stays tucked until the visitor scrolls (`tuck` in `placeNow`), so the
  whole robot never lands on a card the moment the page opens.
- Computers keep their order (the chosen corner, the other side, then the other edge).

**`keepInViewport` (an app's choice).** Tucked away, the robot doesn't hang off the edge: it shrinks
to `--pilot-peek-scale` (0.82 on phones, 0.52 on computers) in its corner, `--pilot-keep-margin` from
the edges (3 px on phones, 8 px on computers), fully on screen, and grows back on hover. Since core
1.3.0 it is never smaller than a **44 px tap target** each way (`TAP_LEAST` and `keepScale` in
`pilot-mascot.js`; core 1.2.x drew it about 24 px on phones). On phones `--pilot-side` is 30 px.
Placement measures the robot at its own size, not as drawn while shrunk. (Without `keepInViewport`,
the design's tucked robot is a slice at the screen's edge, as before; every app today uses
`keepInViewport`.)

**Clear of the page, wherever it's scrolled (core 1.1.1).** The robot also keeps off the page's own
words and buttons: line ends, links, buttons, form fields, checkboxes and small icons (big pictures are
scenery). `pilot-mascot.js` `contentIn` looks at a 4 × 4 grid of points over the robot's box (the top
element of the page at each one, never Pilot's own) and at the real lines of text there, so the empty
end of a short line doesn't count. It looks again on every scroll and resize (once a frame at most,
with `requestAnimationFrame`), when the page changes, and when its address changes. While the page is
scrolling it checks only its own spot, tucking away there or coming back out, so it never hops about;
once scrolling stops (160 ms) it may move to a free corner. If no corner is free it tucks away at the
edge, in the first corner where the slice that still shows (`--pilot-peek-show`: 20 px on phones, 36 px
on computers) covers nothing. An app can turn the text check off with `keepClearOfText: false`.

**A box being typed in comes first.** While an input, a textarea or an editable element of the page has
focus, the robot never sits on it: it moves to a corner clear of it (a top corner when the box is near
the bottom), or tucks away in one, until the box loses focus. A tap doesn't bring it back out over the
box, and it doesn't wander while someone types.

**Room at the side on phones.** Below 720 px wide, `--pilot-side` (24 px, a little more than the slice
that shows) is the room the tucked-away robot needs at the edge. Anything with the `.pilot-gutter-side`
class gets that as its right and left padding (the robot can tuck at either edge, and the page stays
even); `pilot.js` also puts the class on the app's gutter elements (`config.gutter`, `main` by default;
`false` for none), but only where their own right padding is narrower. So line ends stop before the
robot.

On the MTRX site the robot also keeps clear of the row of streak dots under today's spark, the Genesis
project screen's stage bar and web address,
and of the whole launch checklist (each row with its Hide button, each stage's heading with its count
and arrow, the add-a-step box and the stage buttons), and of the arrow on each of Orbyt's path cards. On a computer the chat window opens beside the robot, as tall as the
screen allows, so everything in it is in view; shorter screens get slightly tighter spacing.

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
grown-ups: the MTRX site says "AI keys are for grown-ups (18+)." on one line just above the message
box while the welcome shows (the full "Pilot uses a grown-up's AI key (the AI companies require
18+)." is its tooltip, and shows there once a chat has started), until a key is added; the full note
is also beside the key settings and in help. It never nags.

### Pilot for Mac 1.4: Free mode and two editions

The Mac app (not the web Pilot, which is unchanged) also has **Free mode**: AI that runs on the Mac
with no key. Chat goes to the local OpenAI-compatible server of a free app that runs models on the
Mac (named in `pilot-desktop/README.md`) at `http://127.0.0.1:11434`; pictures go to the free Draw Things app's API Server at
`http://127.0.0.1:7860` when the user turns it on (Draw Things → Settings → API Server, HTTP, port
7860); videos aren't offered, and the app says so. Setup cards open the download pages in the
browser, and a "Download brain" button asks that app to download the model recommended for the Mac's
memory, with a progress bar. The recommendations live in one editable data file in the Mac app
(`pilot-desktop/src/config/free-models.json`); no model name is written in code or these docs.
The Mac's CSP adds exactly those two local addresses (where the core lets a typed compatible address
be any `localhost` or `127.0.0.1` port). The Mac app ships as two editions built from one codebase:
**Pilot** (own keys plus Free mode) and **Pilot Free** (Free mode only, with no key settings at
all). See `pilot-desktop/README.md`.

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

The core is the same in every app. Each file starts with `Pilot core 1.4.0 · <file name>`, so
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
   | `welcomePills` | up to 5 `{icon, label, action, send}` pills for the welcome (default: the design's five; see **Each app's own welcome**); 1.4.0: `link` or `answer` instead of `action` (**Pill actions**) |
   | `answerMore` | (1.4.0) the line under an answer given with no key ("Want more? Add your AI key to ask anything."); `false` for none |
   | `hideKeySections` | `["image", "video"]` (either or both) to leave those key settings out |
   | `keepInViewport` | `true`: tucked away, the robot shrinks into its corner instead of hanging off the screen's edge |
   | `modals` | CSS selectors of the app's own pop-ups that aren't marked as dialogs; the robot steps back while one shows |
   | `revealMs` | how long the robot shows whole on a visit's first page (4000 by default; 0 for never) |
   | `storagePrefix` | the browser-storage prefix, e.g. `cyberlogix-pilot` (lowercase, digits, dashes) |
   | `pack` | the address of the knowledge-pack script, loaded on first open; it sets `window.PilotPack` |
   | `compatibleHosts` | the OpenAI-compatible hosts the app's policy allows, plus `localhost`, `127.0.0.1` |
   | `kidView()` | true on a child's view: Pilot isn't shown at all, and no tools are ever offered |
   | `screen()` | `{name, facts}`: the screen the user is on, and any short facts about it |
   | `chips(screen)` | up to 3 `{label, prompt}` suggestions for this screen (on the welcome too); 1.4.0: `{label, link}` or `{label, answer}` too |
   | `taskPrompt(screen)` | what "Get things done…" puts in the box on this screen |
   | `keyNote` | the note above the message box (until a key is added) and beside key settings (e.g. the 18+ line) |
   | `keyNoteShort` | (1.3.0) a one-line version of `keyNote` for the welcome, so the pills and suggestions keep their room |
   | `audienceNote` | who may be using it, for Pilot's rules |
   | `privacyUrl` | the app's privacy page, linked from help |
   | `themeClass` | an optional class on Pilot's root, to restyle its colours from the app's CSS |
   | `avoid` | CSS selectors of things the robot must not cover; it moves to a free corner or tucks away |
   | `yieldTo` | CSS selectors of another helper character on the page; the robot gives it room the same way |
   | `keepClearOfText` | `false` to stop the robot keeping off the page's own words and buttons (on by default) |
   | `gutter` | CSS selectors that get the phone side gutter where they need it (`main` by default; `false` for none) |
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

CyberLogix, OmniArmor and RankUp carried core 1.3.0 (or older) when 1.4.0 came out. They keep working
as they are; each moves to 1.4.0 in its own repo by the steps in **Moving an app to core 1.4.0** (core
files are only ever changed here and copied byte for byte). This repo doesn't change them.

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
