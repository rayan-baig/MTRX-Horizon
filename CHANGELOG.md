# What changed

The newest version is at the top. The number in `VERSION` is shown at the
bottom of the home page and the console, and by `/healthz`, so you can tell
which version is live.

## 1.20.0 (22 November 2026)

Pilot core 1.4.1 (placement polish, the welcome stays, built-in answers stay on the device).

- **Pilot's built-in answers never leave your device.** Answers Pilot gives without an AI key (like
  "What is Orbyt?") are made from what the page shows. Before, once you added a key, they were sent
  to your AI company along with your next question. Now they stay in the chat on your screen only;
  the AI company just gets "(Pilot showed a built-in answer)" in their place.
- **Typing on a phone: Pilot steps out of the way.** Typing in a box low on the screen (Genesis's
  today's spark, Orbyt's Pitch and Partner forms) used to send the robot to the top left corner,
  over the logo and the Home link. Now, if the only place left would cover the header or a link, it
  fades out while you type and comes back when you're done.
- **Scrolling on a phone: Pilot stays put.** It used to change corners every 100 pixels or so, and
  sometimes sat full size in a top corner over the headline or a card. Now, once you scroll, it stays
  small in one bottom corner and only moves (or fades out for a moment) when a link or button would
  end up under it.
- **Pilot never sits on a link card.** At the top of Orbyt, the small robot used to sit on the
  corner of the big "Early access" and "Partner with us" cards, so tapping the card's corner opened
  Pilot. Now a link under the robot counts in full, however big the card, and when every corner has
  a link the robot waits out of sight until you scroll.
- **The welcome buttons stay.** After a built-in answer, the welcome's buttons used to disappear
  until "Clear chat". Now a small row of them sits under the answer, so the next question is one tap
  away. A long built-in answer opens at its first line, not its last.
- **Fewer words around Pilot's box.** The "Want more? Add your AI key" line shows once per chat,
  not under every built-in answer, and the grown-ups note above the message box stays one line
  with a "More" link to read all of it.
- **A sharper robot on phones.** The robot's pictures now also come in the exact sizes a phone
  shows them at, so it no longer looks a little soft. It looks the same.
- **For the apps:** other apps can recolour Pilot's window with a few CSS settings
  (docs/PILOT.md, "Theming the window"). Pilot for Mac is unchanged; its six shared core files are
  re-copied with the new version line.

## 1.19.0 (22 November 2026)

- **Home: the app screens show whole.** On a computer each card's screen used to hang off the
  bottom of the card and get cut off. Now the whole screen sits inside the card, with a small
  magnifier, and pressing it opens Learn more with two big screens. On a phone the screen is
  bigger (about twice the size) in its own space beside the app's name, and a tap opens Learn more.
- **Home: What's new says what you can do today.** One plain line at the top: you can plan your
  idea in Genesis, send it to us on Orbyt, or ask Pilot; the apps are in development. Each app's
  item has a "Preview" label (or "In the demo", if that app has a public demo), and every item
  shows an arrow, so it's clear they are links. On a computer, the newest item is one line under
  the main buttons, with "All updates" beside it.
- **Home: a demo link only where there is a demo.** Learn more shows "See the demo (pretend
  data)" for an app only when its public demo address is set (`RANKUP_DEMO_URL`,
  `CYBERLOGIX_DEMO_URL`, `OMNIARMOR_DEMO_URL`). None is set yet, so no such link shows.
- **Home: Orbyt stays in the top menu on a 1280-pixel laptop** (it moved into the Menu below
  1320 pixels). On a phone the second button says "Try Genesis free".
- **Genesis.** A first visit on a computer shows an example plan beside the welcome (a project
  with its first three steps, one ticked) instead of an empty half. Coming back, the heading says
  "Welcome back", with your project's name under it as a link. With one project, today's spark sits
  beside it instead of below a half-empty row. In a project, Notes go under whichever column is
  shorter, so there's no big empty gap under the checklist when Ask Genesis is tall (at the free
  limit, say). Ask Genesis's buttons are a full 44 pixels tall on touch screens, and "While you
  wait:" has its colon.
- **Orbyt.** Every place that says how long we keep your message now says "up to 365 days" (the
  Pitch form's "What happens after I send?" said "then delete it" with no number). "Will you build
  it without me?" is warmer: we won't publish or pass on your idea, and if we're already working on
  something similar we'll tell you when we reply. The Sent screen says the reply date once (it also
  said "within 7 days"). On a phone the three steps are three neat columns instead of two and one.
  On a computer the hero shows a short example pitch beside the words.
- **Orbyt: a link straight to a form always lands on it.** When the fonts arrived after the first
  jump, the text above the form reflowed and the form ended up lower than it should (54 pixels on
  a phone), and the check after loading only helped a visitor still at the top. Now, until a
  moment after loading, the form is put back under the top bar whenever it drifts, unless you have
  scrolled, tapped or pressed a key. A browser test makes the late fonts certain, and another
  checks it never pulls back someone who scrolled.

## 1.18.0 (22 November 2026)

- **Pilot is useful before you add an AI key (Pilot core 1.4.0).** Before, every button in
  Pilot's welcome led to "add your AI key". Now the ones that don't need the AI just work:
  "What is Orbyt?" and "What apps are coming?" are answered straight away, from the site's own
  facts (the app list is the same one Orbyt shows), with links to the right pages; "Help with my
  idea" opens Genesis's start form. A few page suggestions work the same way ("What's ready
  today?", "How do I start an idea?", and on Orbyt "Which form is for me?" and "What happens after
  I send?"). Nothing is sent anywhere for these. Under such an answer a small line says "Want more?
  Add your AI key to ask anything." The key is still needed for typed questions and "Explain this
  page", and those still wait in the box until a key is added.
- **Pilot's robot keeps off the phone header.** On a phone it sometimes tucked itself into a top
  corner: over the "Home" link on Genesis and Orbyt (so tapping Home opened Pilot instead), or
  over another app's logo. Now on phones it uses the bottom corners first, never tucks over a link
  or button while another corner is free of them, and treats a header that stays at the top as
  busy. On small phones its first glow plays tucked into the corner until you scroll, so it never
  lands on a card as the page opens. Something an app asks it to keep clear of now only stops its
  little strolls when that thing is along the bottom of the screen (before, one anywhere on the page
  kept it still all the time).
- **For the other apps (core 1.4.0):** a Pilot button or suggestion can now be a link to a page of
  the same site, or a ready answer the app writes itself, shown safely as Pilot's message (see
  "Pill actions" in docs/PILOT.md). Pilot for Mac's six shared core files are re-copied; the Mac
  app looks and works the same.

## 1.17.0 (22 November 2026)

- **Pilot core 1.3.0: the robot never sits on the page to be noticed.** On the first page of a
  visit the robot glows for a few seconds so people see it. Before, it also showed itself whole for
  those seconds wherever it was, so it could cover a "Learn more" button, the last word of a
  heading or a form's box. Now it follows the same rules as the rest of the visit: a free corner if
  there is one, otherwise it glows where it is tucked away, in the corner where it covers least.
- **Pilot asks for your AI key once.** On this site the welcome already has an "Add my AI key"
  button, so the big "Bring Your Own API Key" card under it is gone, and the grown-ups note above
  the box is one short line on the welcome: "AI keys are for grown-ups (18+)." Website wording
  says "AI key", not "API key". The design's own welcome (and Pilot for Mac) is unchanged.
- **Pilot's buttons and suggestions all show.** On shorter screens (computers 700 to 900 pixels
  tall, phones 667 to 812) the welcome is a little tighter, so every button and suggestion is in
  full view above the message box instead of half hidden.
- **The tucked-away robot is easy to tap.** It never shrinks below 44 pixels (it was about 24 on
  phones).
- **Home shows the real apps.** Each app card has a real screen from that app's own demo (pretend
  data), and each Learn more card has two, with a line saying where they come from. On a phone the
  headline is two even lines, the spacing is tighter so the apps start sooner, and there's a second
  button, "Try Genesis now (free)" (the tour is in the menu). On a computer the cards' tags keep a
  dark fade behind them, so "Alarms" and "Records" read clearly over the artwork.
- **What's new is dated and linked**, newest first, from a small list kept in step with the
  changelogs (a test checks the dates and refuses stale lines). The old Block Craft line is gone.
- **Shorter footers on phones.** The links are three labelled groups (Your idea, Business, About)
  instead of a wall of links, on Home, Genesis and Orbyt.
- **Genesis.** Coming back, you see "Continue <your project>" with its next step instead of the
  welcome. On a computer, notes sit across the page under the checklist, so there's no big empty
  space beside it. At the free limit there's a "While you wait" line: tick your next step, use
  Pilot with your own AI key, or (softly) Pro. Free and Pro are two cards on a phone instead of a
  cramped table. Ticking a step, finishing a stage, moving on or growing your streak gets a short
  cheer with a few sparkles (words only if your device asks for less motion).
- **Orbyt.** A link straight to a form (/orbyt#pitch, #partner) now always lands on it: the first
  jump is instant, and it checks again once the page has loaded (a browser test loads it many
  times). The Pitch form has a short FAQ above Send (who owns my idea, what happens after I send,
  will you build it without me), answered from the terms and privacy page. After sending, it says
  what happens next and the date we'll reply by (from the 7 days the page already promises). On a
  phone, "How Orbyt works" is one line and "Our apps" folds behind one button; the examples in the
  boxes are short enough to read; on a computer the path cards line up at the top.

## 1.16.1 (22 November 2026)

- **Pilot stays put if you click him straight away (Pilot core 1.2.1).** On the first page of a
  visit, Pilot shows himself fully for a few seconds. If you opened his window in those seconds,
  he could slip out of place and the window looked a little off until they were up. That first
  look now has its own name inside Pilot, so it can't clash with the window's greeting. Pilot for
  Mac gets the same shared files (nothing changes in how it looks or works).

## 1.16.0 (21 November 2026)

Fixes from the next strict review of Home, Genesis and Orbyt, and Pilot core 1.2.0. Prices and the
free limits are unchanged, and Orbyt still never takes money.

- **Pilot greets visitors in this site's own words (Pilot core 1.2.0).** The owner approved
  app-specific welcome buttons for the websites (Pilot for Mac keeps the design's exactly). On this
  site the window says "Help with ideas and MTRX apps" under "Pilot", and its five buttons are
  "Help with my idea", "What is Orbyt?", "Explain this page", "What apps are coming?" and "Add my AI
  key". The suggestions for the page you're on are on the welcome too. The picture and video key
  settings are gone from this site (it has no use for them).
- **Nothing you type to Pilot is thrown away.** If you write a message (or press a button) before
  adding an AI key, it stays in the box, the key settings open with "Your message is waiting", and
  it is sent as soon as you add a key.
- **People notice the robot, and it stays out of the way.** On the first page of a visit the robot
  shows whole for a few seconds with a soft glow. After that, when it has to tuck away, it shrinks
  into its corner, fully on screen, instead of hanging off the edge. It hides while any pop-up is
  open, including the home page's cards (before, a slice of it showed on top of their blurred
  backdrop). It keeps a little more room from the ends of lines, and it no longer covers today's dot
  in Genesis's streak row.
- **Home.** On a phone, Genesis came twice in a row (its card, then a Genesis figure). The strip
  under the apps is now three big tiles, each one a link as a whole: Genesis (free: turn your idea
  into a plan), Orbyt (pitch your idea, or work with us) and Projects (1 live, 3 in development).
  The "Our apps: 3" and "CyberLogix: built for 12" figures are gone from it (the page already says
  both). Once an app reports real numbers, an Active users tile joins them.
- **Genesis.** The last stage tile says "Live" instead of a cut-off "Launch…". Once today's spark
  has become a project, its button says "Open Paw Board" (the project's name) and opens it, instead
  of starting another. The last Ask Genesis answer for each project is kept in your browser, so it
  is still there after a reload, and a new answer scrolls into view. "Delete all" moved under a
  smaller "More" button (it still asks first). The idea form's examples now say "e.g.", and on the
  smallest phones the welcome's buttons and today's spark fit inside their cards.
- **Orbyt.** App names no longer break in the middle ("OmniArmo / r.ai") on phones: the "In
  development" badge sits under the name. Two promises at the top instead of four ("Takes about 2
  minutes", "A real person replies"). Investors and buying are one "Business enquiries" row, with a
  button for each. The idea name's example reads "e.g. Nova". On a 320px phone the label at the top
  no longer runs into the swirl.
- **Pilot for Mac** carries the same six shared core files at 1.2.0 (only their version line
  changed for it). No new Mac version.
- **For the other apps:** docs/PILOT.md has the new options and the steps to move to core 1.2.0.

## 1.15.0 (21 November 2026)

Fixes from the next strict review of Home, Genesis and Orbyt. Prices and the free limits are
unchanged, and Orbyt still never takes money.

- **Pilot's robot stays off what you're reading, wherever you scroll (Pilot core 1.1.1).** Before,
  on a phone it only kept clear before you scrolled; after that it could cover the ends of lines,
  Genesis's "Hide" buttons, the step counts and arrows, and the Orbyt box you were typing in. Now
  it looks again as you scroll (at most once a frame, and cheaply), and moves to a free corner when
  your words or buttons are under it. If every corner is busy it tucks away at the edge, with only
  a thin slice showing, and on phones the page keeps a little room at the sides so line ends stop
  before that slice.
- **The robot never sits on a box you're typing in.** While a text box has focus it moves to a
  corner clear of it (a top corner when the box is low on the screen) or tucks away, and comes
  back when you're done.
- **Pilot's chat window.** On a phone, the note about AI keys was half hidden under the message
  box; it now sits just above the box, in full view. It now reads "Pilot uses a grown-up's AI key
  (the AI companies require 18+)." The five pills are still the greeting; once you start chatting,
  the suggestions for the page you're on come first.
- **Home.** The "Active Users: Soon" tile is gone: until an app reports real numbers, that tile is
  a link to Genesis (free). The Projects tile no longer hides that this website is one of the
  four: it says "1 live, 3 in development". Every status says "In development" (the Learn more
  cards and Orbyt's app cards too, instead of "opens soon" and "Opening soon"). The early access
  form says what's missing under the field itself, in plain words, instead of the browser's own
  pop-up bubbles.
- **Contact address.** help@mtrxhorizyn.com (shown on the home page while no business address is
  set) is now in the docs' list of mailboxes to create, and the README no longer says nothing is
  shown in that case.
- **Genesis at the free limit.** When the hourly (or daily) free answers are used up, the quick
  questions and Ask are greyed out, the line says "Back in 12 min" (the real minutes), and they
  switch back on by themselves when the wait is over. "Up to 3 an hour" is said up front: in the
  welcome, and in the first line of Ask Genesis, above the questions.
- **Genesis says things once.** A first visit no longer shows a second pair of "Start my idea" /
  "Try an example" buttons. Returning visitors get a smaller welcome, so their projects stay in
  view. The Free and Pro table now reads "5 a day, up to 3 an hour" and "Up to 100 a day, from a
  monthly allowance", with one plain line under it about that allowance (no daily promise).
- **Orbyt says things once.** "Within 7 days" is said once before you send (just above Send), and
  "We won't publish or pass on what you send" once, on the Pitch form. The under-13 note is only on
  Pitch and Partner (Investors and Buy don't need it; Early access has its own 18+ tick). Each app
  card has "Get early access" beside "Partner on this" while the early access list is open. The
  email box no longer shows a character count.
- **Pilot for Mac** carries the same six shared core files at 1.1.1 (only their version line
  changed for it).

## 1.14.0 (20 November 2026)

Fixes from a strict review of the main site. Prices and the free limits are unchanged.

- **Genesis no longer prints "null".** Some steps have no tip, and under "Your next step" the
  page wrote the word "null" where the tip would go. Empty spots are now left out everywhere on
  the Genesis page, and a test makes sure nothing on it can add one again.
- **The free AI limit is said honestly.** The limit is still 5 answers a day and 3 an hour. Ask
  Genesis now shows "4 of 5 left today (up to 3 an hour)" before you ask and after each answer.
  When the hourly limit is reached it says "You've used 3 this hour; more in 40 minutes" (with
  the real number of minutes), and when the day's are used, how long until more. The Free and Pro
  table says "5, up to 3 an hour".
- **Genesis puts things in a better order.** "nothing is sent to us" now reads "nothing is sent
  unless you press Ask". If you already have projects, "Your projects" comes first. Genesis Pro
  only appears after your first project or your first question. One line under Ask Genesis
  explains the difference: Ask Genesis is free here with a daily limit; Pilot uses your own AI
  key with no limit.
- **The Projects list says "In development", not "Built".** Each app's status comes from the app
  list, so it changes to "Open" by itself the day the app launches. The MTRX Horizyn row now says
  it is live, with "Next: Open the three apps to the public".
- **"Built for 12 Industries" now says whose figure it is:** "CyberLogix: built for 12".
- **The home page on a phone.** The three app cards are stacked, one per row, so they are easy to
  read. "What's new" is now on the page itself, with one plain line about who is behind the site
  ("A small independent software company") and where to write: the address in
  `MTRX_CONTACT_EMAIL`, or help@mtrxhorizyn.com while that isn't set.
- **Orbyt.** "Nobody pays or gets paid here" is now "Nothing is bought or sold on this page".
  Every place that talks about what you send says the same thing: "We won't publish or pass on
  what you send, but we can't promise we aren't working on something similar." Pitch an idea and
  Early access (while the list is open) come first; Investors and Buying are lower down. The
  "Work with MTRX Horizyn" label stays on one line on phones, and the Sent screen says "within 7
  days" once instead of twice.
- **Pilot's robot keeps clear.** On a computer, the home page's footer ("Version ...") was always
  under the robot; it now keeps its right end clear. On a phone, the app cards' lines keep clear
  of the robot's corner. Pilot core is unchanged (1.1.0).

## 1.13.0 (20 November 2026)

**Pilot's robot comes to life.** docs/PILOT.md has the details (Pilot core 1.1.0).

- **It moves around by itself, gently.** Once the page has loaded, the robot in the corner breathes
  and blinks, and every minute or two it strolls along the bottom of the page and back, does a
  backflip, a spin or a few bounces, peeks up from the bottom edge, cheers, or waves. Now and then it
  throws a football, sends a few hearts, or points up when you haven't added a key yet. It always comes back to its corner, and it keeps still while Pilot's window is open.
- **It looks like the owner's own robot.** At rest it is the original design picture, now in three
  layers so its head can tilt and look around and its eyes can blink. While it moves it uses the
  owner's 18 pose pictures (standing, waving, walking, running, flying, climbing, a backflip, a
  football throw, a kick, tennis, a cheer, a knee slide, pointing, an energy ball, a superhero landing,
  hearts, and a playful "waiting" pose).
- **You choose how lively it is.** Under "The robot" in Pilot's settings: Calm (stays put), Low,
  Normal or Playful. Playful adds flights, climbing, running, soccer, tennis, a knee slide and a
  glowing energy ball. If your device is
  set to reduce motion, the robot stays still and the moving parts aren't even downloaded.
- **Pages stay fast.** The moving robot loads only after the page is idle, and each pose picture
  only when a move needs it.
- **It stays out of the way.** On phones the robot is smaller, and it no longer sits on top of a
  pop-up: while one is open it steps back and taps go through. It keeps clear of the Genesis project
  screen's stage bar and web address, moving to a free corner (or tucking half away at the edge until
  tapped). Pages can keep their last lines clear of it. On a computer the Pilot window now opens
  beside the robot and uses the screen's height, so the "Bring Your Own API Key" card is never cut off.
- **Pilot for Mac 1.1.0** is out with the same robot, moving around your whole screen, plus a fix
  for typing in the chat (see pilot-desktop/RELEASE_NOTES.md).
- Every Pilot core file says 1.1.0. CyberLogix and OmniArmor still have core 1.0 and will get the new
  core copied in later.

## 1.12.1 (20 November 2026)

- **Pilot core 1.0.1.** Once a key was added, Pilot's window showed the word "nullnull" under the
  five buttons. Empty spots are now left out before anything is drawn. Every core file says 1.0.1.

## 1.12.0 (20 November 2026)

**Pilot, an AI assistant that runs on your own AI key.** docs/PILOT.md has the details.

- **A small robot sits in the corner of every public page** (home, Genesis, Orbyt, Partners, the
  bundle, privacy, terms, brand, and early access and creators while they're on). Tap it and the
  Pilot window opens. Drag it to any corner and it stays there. A dot on it says whether it's
  ready (green), needs a key (amber) or is thinking (pulsing).
- **Bring your own key.** Pilot works with Anthropic, OpenAI, Google Gemini, or any
  OpenAI-compatible service the site allows (including a model on your own computer). You can keep
  several keys and switch between them, and add separate keys for making pictures and videos.
  Pilot lists the models your key can use, or you type one. Keys stay in your browser, for the tab
  or on the device if you tick "Remember", and go only to that AI company. **Remove my keys**
  deletes them. Your AI company bills your key; MTRX Horizyn pays nothing and sees nothing.
- **It knows the site.** Ask how anything works, what each app does, what's ready today, or why
  Genesis or an app is better: it answers from a guide written from the real site and an honest
  list of real strengths, and says when it isn't sure. "Analyze & explain" and "Summarise this" send
  an outline of what's on the screen (never what's typed in boxes, hidden parts, or your Pro key),
  and show you exactly what was sent.
- **It can do things on Genesis.** "Show my projects" and "What's my next step" answer straight
  away. Adding a step, starting a project from an idea and filling in today's spark wait for you to
  press **Allow**. Several changes at once ("turn my spark into a project and add 3 steps") are
  shown first as a numbered plan: Approve all, Step through, or Cancel, and Stop works at any time.
  Pilot never pays, deletes or messages anyone.
- **Ask Genesis uses your key when you've set one**, from your browser, with no daily limit. The
  free help for everyone else is unchanged (5 a day, 3 an hour), and so is Genesis Pro.
- **It stays with you**: the chat and an open window follow you to the next page, and tabs of the
  site stay in step, with only one tab answering at a time.
- Optional voice input (where the browser has its own speech recognition) and optional memory
  ("remember that I like short answers", kept only in your browser, off unless you turn it on).
- **Pages stay fast**: a page loads one small Pilot script, which fetches the robot once the page
  has finished loading; the window and everything it needs load the first time you open it.
  Measured on a slow phone, the pages draw as fast as before.
- **Security**: the site's strict security policy stays. It now lets the browser reach exactly the
  AI companies' addresses Pilot needs (and your own computer, for a local model), play a video Pilot
  made from memory, and use the microphone on this site's own pages when you press the button.
  Nothing else changed. AI answers are shown as plain text: an answer can't inject anything into
  the page.
- The privacy page and the terms say what Pilot sends, to whom, and that AI keys are for grown-ups
  (the AI companies require 18+).

## 1.11.1 (20 November 2026)

- **The free plan has a smaller AI allowance.** Ask Genesis now gives free visitors 5 answers
  a day (3 an hour), down from 30 (10 an hour), so Genesis Pro's 100 a day means something.
  Everything else in free Genesis is unchanged. The limits are still the settings
  `GENESIS_AI_PER_DAY` and `GENESIS_AI_PER_HOUR`.

## 1.11.0 (19 November 2026)

Fixes from an honest review of the home page, Genesis and Orbyt: the site now says plainly what
is ready and what isn't, and nothing looks alive unless it is.

**Home page**

- **The apps are "in development" everywhere until launch.** The cards said "Early access",
  the figures said "Total Apps 3 Available" and Orbyt said "Released to the public". Now the
  figure says "Our apps: 3, In development", the opening line says "three apps, all in
  development", and Orbyt says "Our apps (opening soon)". One place decides (the app catalog),
  so it all changes together on launch day.
- **New setting, `MTRX_OPEN_APPS`.** An app counts as open only once its key is listed there
  (`rankup,cyberlogix,omniarmor`, or `all`) and it has an address. Until then there is no Open
  button or link to it anywhere, even if its address is set. **On launch day, set this.**
- **Nothing pretends.** The bell no longer shows a "3" that never goes away. The live-activity
  panel (an empty map with dashes) and its "Analytics" link are hidden until an app reports
  real numbers. "Settings" held only calm mode, so it is called **Calm mode** now. The round
  button that looked like a profile picture is a plain three-line **Menu** button.
- **Plain words.** The headline is "Three apps that watch, warn and motivate." The cards say
  what each app does: "Chores that turn into points and games", "Fridge and freezer alarms that
  call you", "Safety checklists that count the deadlines", and phones show that line too.
  "Global Reach: 12 Industries" is now "Built for 12 industries".
- **On phones**, Genesis and Orbyt have their own row under the apps, and the menu always fits
  on the screen (a long one scrolls inside itself).

**Genesis**

- **Genesis Pro is only offered while Ask Genesis is on.** Before, Pro could be shown and bought
  with AI help switched off, and its table promised daily answers that couldn't come. Ask
  Genesis is now part of Pro's own readiness check, and the console says when it is the missing
  piece. Prices and the free daily limit are unchanged.
- **The Pro price always shows.** When Stripe can't be reached, the button says "Get Pro ·
  $4.99 a month" from a new setting, `GENESIS_PRO_PRICE_TEXT`, instead of no price at all.
- **Ask Genesis is one tap away.** "Your next step" has an **Ask Genesis** button (only while AI
  help is on), and later stages of the checklist start folded so the steps that matter now come
  first.
- **Every checklist can fit its idea.** Hide steps that don't fit (and bring them back), and add
  your own to any stage. It stays in your browser like everything else, and Pro backups keep it.
- **Rough edges:** the name, pitch and "who it's for" boxes stop at the same limit their counters
  show; a day once "covered by your freeze" stays that way in the week of dots after a streak
  ends; "Spark saved" is said inside the spark card, and other messages appear at the top of the
  screen, so they no longer cover what you just used.

**Orbyt**

- "Our apps (opening soon)" until an app is open, each app marked "Opening soon", and no more
  "Ask about buying" link on every app (buying is still its own path).
- **Pitch and Partner come first;** Investors and Buy are a smaller "Other ways to talk to us"
  row below them. The home menu says "Orbyt: work with us".
- **Before you send:** the pitch form says ideas sent here aren't confidential and that we may
  already be working on something similar. Every form, and the Sent page, says we reply within 7
  days, even if the answer is no. Every form now has the under-13 note, not just Pitch.
- Orbyt always says what it is for: "Orbyt · Work with MTRX Horizyn" in every menu, footer and
  page title. Still: nobody pays or gets paid on Orbyt.

## 1.10.0 (19 November 2026)

Genesis and Orbyt are easier to understand on the first visit, and Genesis has a reason to come
back tomorrow:

- **Genesis says what it is straight away.** "Turn your idea into a real plan, one small step at
  a time", with **Start my idea**, **Try an example** and three "how it works" steps. Before,
  a first visit saw a row of five zeros and two Start buttons. The row of counts now shows only
  once you have projects.
- **No blank page.** **Try an example** (and "Stuck? Fill in an example" on the form) fills in one
  of eight example ideas to change and make your own. Nothing is saved until you press Start.
- **Today's spark: a new idea prompt every day.** Answer it in one line, see the last 7 days as
  dots, and build a streak. Every streak has one **freeze**, so one day off doesn't reset it; you
  earn it back after 7 more sparks. No reminders, no countdowns, no "don't lose your streak".
  **Turn it into a project** starts a project from your answer. Like projects, your sparks stay in
  your browser and are never sent to us; **Clear my sparks** deletes them.
- **Your next step**, at the top of every project: the first step still to do, with a **Done**
  button, or "Move to Plan" once a stage is finished. No more reading the whole checklist to
  know where you are.
- **Idea cards.** **Make an idea card** turns a project into a picture (its name, one-line pitch,
  who it's for and how far along it is) to save, send with your phone's share button, or copy as
  words. It is drawn in your browser; your notes and ticks are never on it, and it reminds you
  to leave out names, school, address and phone number. There is no link that shows someone's
  idea on our site, so nobody can use one to put words on a page of ours.
- **Free and Genesis Pro, side by side.** While Pro is on, its panel shows a small table of what
  is free and what Pro adds. When your free Ask Genesis answers run out for now, one calm line
  says what Pro would change and that a grown-up can get it. Nothing else changed about Pro, and
  the prices are the same.
- **Orbyt makes sense in five seconds.** "Want to work with MTRX Horizyn? Start here", three
  promises (about 2 minutes, a real person reads every message, nobody pays or gets paid here),
  each path saying who it's for ("I have an idea", "I run a business", "I'm an investor", "I'd
  like to buy"), and three "how it works" steps. Pitch an idea now comes first.
- **Orbyt on a phone:** one clear row per path instead of four squashed tiles, the swirl beside
  the title instead of behind it, and no blur effects in its animation, which is easier on a
  phone's battery.
- **Next steps after sending:** an idea gets "Keep building it in Genesis", a partner the partner
  page, investors and buyers the apps.
- **Plain words:** the investor and buying notices now say simply that no shares are sold, nobody
  is asked for money, and nothing can be bought or paid for on the page. "Ask about buying" under
  each app is a quiet link beside "Partner on this". If no app is released, Orbyt says so instead
  of leaving a gap.
- **Fixes:** Ask Genesis no longer shows an "AI · free" badge while AI help is switched off, and
  on a phone that panel moves below the checklist. The privacy page mentions daily sparks and idea
  cards (both stay in your browser), so its date is now 19 November 2026.
- Ask Genesis's "too busy" answer for free visitors now carries `"limit": "free"`, so the page
  knows when to show the Pro line. No new settings.

## 1.9.0 (19 November 2026)

Keeps working when something goes wrong, and tells you quickly when it can't:

- **A second health address, `/readyz`**, for a free uptime monitor. It answers 503 when the site
  can't write to its database, a setting it needs is missing, or its background jobs (checking the
  other apps, launch emails, tidying old data) stopped running. `/healthz` stays as it was, for
  Render. What to do for each alert: `docs/OPERATIONS.md`, "If the app is down". **Before
  launch:** add both addresses to an uptime monitor (that page says how).
- **The background jobs are watched.** If they stop, `/readyz` says so; if their thread dies, it
  is started again; a job that fails 3 times in a row is emailed to you like a server error.
- **A slow AI provider or Stripe can't slow the whole site down.** Measured before: with 45 asks
  stuck on an AI provider that never answered, the home page took 59 seconds to load. Now it takes
  0.04 seconds: at most 8 asks (and 8 Stripe calls) wait at once, and the rest are told to try
  again straight away. The AI provider now gets 5 seconds to connect, and a Stripe answer 15
  seconds in all, not 15 seconds for each piece.
- **The public pages keep loading if the database can't be read** (its disk gone, say). The home
  page, Orbyt, Partners and the Bundle used to show "Something went wrong"; now they load, with
  the three founding apps shown as "soon".
- **The live site checks its settings when it starts.** On Render it won't start without a
  working `MTRX_KNOCK` and an `https://` `MTRX_PUBLIC_URL`, or with `MTRX_DEV=1`, and the log
  says plainly what to set. Features switched on but not set up (Genesis Pro without Stripe, say)
  don't stop it; the log lists what they still need. The `Dockerfile` sets `MTRX_PRODUCTION=1`
  to turn this on; you never set it yourself.
- **Clearer logs**: every line from the site starts with the time (UTC) and how serious it is.

## 1.8.4 (17 November 2026)

Faster and easier on a phone, especially the first time:

- **The home page appears much sooner on a phone.** On a slow connection its big picture took
  about 3.5 seconds to show; now it takes about 2. The page asks for the picture straight away,
  and phones get a copy made for their screen. Every public page now loads in under 2.5 seconds
  on a slow phone, and nothing on them jumps while loading (`docs/PERFORMANCE.md`).
- **Every page is lighter**: a smaller logo picture in the top bar, a font file that holds only
  the weights the site uses, and a small logo picture on the brand page. About 20 KB less on
  every page, 125 KB less on the home page.
- **On a phone, the home page now says what MTRX Horizyn is, and shows both buttons.** To fit on
  one screen it used to hide the sentence about the company, and on smaller phones the buttons
  too. On a phone the page now scrolls a little instead. Computers and tablets still fit on one
  screen.
- **The first sentence says what each app does**: RankUp, a chores game for families; CyberLogix
  AI, equipment alarms for businesses; and OmniArmor.ai, compliance checklists for businesses.
- **"Watch Video" is now "Quick tour"**, because it is a short slideshow, not a video.
- **Buttons and links are easier to tap on a phone**: the app tiles' buttons, the search and
  bell buttons, the footer links, the Home link and logo at the top of each page, Genesis's
  Import and other small buttons, Orbyt's buttons under each app, the brand page's download
  links, the "I'm a grown-up" tick box, and the × and links in the home page's pop-ups are all
  at least 40 pixels tall.
- **Small fixes on narrow phones**: "Early access" on the app tiles no longer breaks over two
  lines, Genesis shows "Launched" in full instead of "Launc...", and the version number at the
  foot of the home page stays on one line.
- **New:** `tools/measure_pages.py` measures every public page on a slowed-down phone.

## 1.8.3 (17 November 2026)

More fixes from the check before launch:

- **A late checkout event can't give Pro to a subscription that has already ended.** Stripe can
  deliver the checkout's event after the subscription was cancelled or refunded. Before making a
  member, the site now asks Stripe for the subscription as it is now, and remembers a full refund
  that arrived first. If Stripe can't be asked, the event is answered "try again" and Stripe sends
  it again later.
- **Pro ends when the time paid for runs out**, even if Stripe's last "cancelled" event never
  arrives.
- **Links in emails never come from the request's address.** They use `MTRX_PUBLIC_URL` only.
  Without it, no email with a link is sent: the early access form stays hidden, launch emails are
  blocked, creators are approved without their welcome email, it is written to the log, and the
  console's Numbers cards say why.
- **A member whose payment failed can get a new key emailed**, so they can open Manage
  subscription and fix it.
- **Disputed payments (chargebacks) pause Pro**, as a failed payment does, until the dispute
  closes: won, Pro comes back; lost, it stays paused. Add `charge.dispute.created` and
  `charge.dispute.closed` to the Stripe webhook, and give the restricted key Subscriptions read
  and Charges read (`docs/GENESIS-PRO.md`, steps 2 and 3).
- **Genesis Pro stays off until email works**, like a missing Stripe setting, and the console says
  what is missing. Without email, a buyer who lost their key could never get it back.
- **The privacy page** says the early access and creator forms keep the address a request came
  from for 24 hours, and that a creator code is kept with a sign-up only until it is confirmed.
- **Docs:** limit each founder promotion code in Stripe to its own app's product, so the codes in
  launch emails don't take money off Genesis Pro.

## 1.8.2 (17 November 2026)

Fixes found in a check before launch:

- **Genesis Pro could be lost straight after paying.** Stripe often sends a subscription's
  "incomplete" moment, its payment and the finished checkout in the same second, and doesn't
  promise their order. If the "incomplete" one arrived last, a buyer who had paid had no Pro, and
  the welcome page said it wasn't active. A late "incomplete" now changes nothing.
- **Paying by bank debit never gave Pro.** For a payment that takes days, Checkout finishes
  "unpaid" and Stripe says `checkout.session.async_payment_succeeded` when the money arrives; that
  was ignored, so the buyer paid and got no key. It now makes them a member and emails the key.
  Add that event to the Stripe webhook (`docs/GENESIS-PRO.md`, step 3).
- **"Email a new key" could sign a member out.** Anyone who knows a member's email can ask for new
  keys (three a day), and each new key pushed out the member's oldest, so within two days the key
  their own browser used stopped working. Now a key that has never been used goes first, so a key
  a browser is using is kept.
- **Mail checkers confirmed early access sign-ups.** Work and school mail often opens every link in
  an email to check it, and opening the confirm link was enough to put an address on the list (and
  count a sign-up for a creator), so someone could sign up a stranger. The link now opens a page
  with a **Confirm** button, like unsubscribing.
- **One inbox could get far more than 3 confirmation emails a day**, as fan+1@..., fan+2@... or
  Gmail's dotted spellings each counted as a new address. The limit now counts the inbox.
- **Signing up again for early access gave a link that soon ran out.** Unconfirmed sign-ups were
  deleted 7 days after the first try, so a link from a second try on day six stopped working hours
  later. They now go 7 days after the last try.

## 1.8.1 (17 November 2026)

- **Chroma Vortex is now Orbyt.** The page lives at `/orbyt`; the old `/vortex` and `/chroma-vortex`
  addresses redirect there, so old links and bookmarks still work. Every page, email, the console
  and the sitemap use the new name. Behind the scenes the code, the database table and the form's
  `/api/vortex/send` address keep their old names, so nothing stored had to move.

## 1.8.0 (15 November 2026)

- **The early access list**, so the apps open with customers waiting. **Off by default**: until
  `EARLY_ACCESS_ENABLED=1` and email (`MTRX_SMTP_*`) works, no page mentions it and every address
  of it is "page not found". `docs/EARLY-ACCESS-AND-CREATORS.md` has everything.
- **Get early access** on the home page (the first button, each app's card and Learn more, each
  opening the form over the page with that app ticked) and on `/early-access`: an email address,
  tick boxes for the apps, and "I'm a grown-up (18+)". **Double opt-in**: we email a link and only
  people who press it count; the rest are deleted after 7 days. Only the email and the apps are
  kept. The answer is the same whether or not an address is already on the list.
- **Unsubscribing:** every email has a one-click unsubscribe link and `List-Unsubscribe` with
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), so a mail app's own button works
  in one click. Unsubscribing deletes the person. The links keep working if the list is switched
  off later.
- **Founding members** are promised a launch discount. Each app's code is a Stripe promotion code in
  `FOUNDER_CODE_RANKUP`, `FOUNDER_CODE_CYBERLOGIX` and `FOUNDER_CODE_OMNIARMOR`; the percent
  (`FOUNDER_PERCENT_OFF`) is shown only for an app that has a code.
- **Launch emails** from the console's new **Early access** section: counts per app (confirmed and
  unconfirmed), then write a subject and message for one app, preview it, and send it to the
  people confirmed for that app with its founder code, unsubscribe link and the company's postal
  address. Sent one at a time, at most `EARLY_ACCESS_SEND_PER_MINUTE` (20) a minute, carrying on
  after a restart. An email is known by its app, subject and words, so each person gets it once,
  however often Send is pressed, and each is marked before it goes so a crash can't send it twice.
  **Blocked**, with the reason in the console, until `MTRX_POSTAL_ADDRESS` is set, email works and
  the app has its founder code.
- **The creator program**, `/creators`: "Make videos about our apps, earn 20% of what your viewers
  pay in their first year" (`CREATOR_PERCENT`, `CREATOR_MONTHS`). **Off by default**
  (`CREATORS_ENABLED`). The application (name, channel link, audience size, email, app, and "I'm 18
  or over or my parent or guardian is applying for me") is emailed to `MTRX_CONTACT_EMAIL` and
  listed in the console's new **Creators** section.
- **Approving a creator** gives them a short link, `/c/<code>`, and a private dashboard key
  (`CR-XXXX-...`, 120 bits) shown once and emailed to them; only its SHA-256 is kept. The link
  counts clicks and confirmed early access sign-ups, then forwards to the app with `?ref=<code>`
  (before launch, to its early access form here). Where it goes is worked out from the creator's
  app alone, and only to `mtrxhorizyn.com`, its subdomains or the app's own address setting: no
  open redirect. Clicks are counted with a keyed hash whose key changes every day and is deleted
  after two, never the address.
- **The creator dashboard**, `/creators/dashboard`: clicks and sign-ups (30 days and in all, with a
  chart), and what the creator has earned, been paid and is owed, as the owner writes it down in
  the console. Nothing moves money by itself.
- **Limits on everything:** joining (5 an hour, 20 a day per address), confirmation emails (3 a
  day per email address, 500 a day in all), wrong links, applications (3 an hour, 10 a day),
  wrong dashboard keys (20 an hour) and link clicks (120 an hour per visitor mark).
- The console's **Numbers** section shows both. The privacy page gains one short line about each
  while it is on. `.env.example`, `render.yaml`, the README and `docs/RUNNING-MTRX-HORIZYN.md`
  list every new setting. `send_email` can add headers (for `List-Unsubscribe`).

## 1.7.0 (14 November 2026)

- **Genesis Pro**, a paid upgrade to Genesis for the people who use it most: about $4.99 a month,
  or $49.90 a year ("2 months free", ten months' price). **Off by default**: until
  `GENESIS_PRO_ENABLED=1` and `STRIPE_SECRET_KEY`, `GENESIS_PRO_STRIPE_WEBHOOK_SECRET` and
  `GENESIS_PRO_STRIPE_PRICE` are set, no page mentions Pro and every Pro address is "page not
  found". The free plan is unchanged. `docs/GENESIS-PRO.md` has the cost sums, the settings, how
  it works and the owner's Stripe steps.
- **What Pro adds:** up to `GENESIS_PRO_PER_DAY` (100) Ask Genesis answers a day and
  `GENESIS_PRO_PER_HOUR` (30) an hour per member, counted by member and never using the free
  plan's shared daily budget; answers up to 350 words (at most 1,000 tokens, `PRO_MAX_TOKENS`)
  from a more detailed prompt; three more helpers (a four-week plan, words for a one-page website,
  price ideas); a 600-character question; a private **cloud backup** of the member's projects
  (the last 3 copies, backed up by itself as they work, merged back in on **Restore**, deleted on
  request or 60 days after Pro ends); and **Download plan**, a project as a text file made in the
  browser. Nothing a member makes is ever published or shared.
- **The cap:** besides the daily asks, each member's AI help may cost at most
  `GENESIS_PRO_MONTHLY_AI_USD` ($1.50) in any 31 days. Each ask's worst case is set aside before
  the call, so the allowance can't be passed whatever the model's price. A maxed-out member costs
  at most $1.50 a month against $4.51 (monthly) or $3.98 (yearly) a month after Stripe's fees.
- **Paying:** a Stripe Checkout subscription (`POST /api/genesis/pro/checkout`), monthly or
  yearly, named only by the price ids in `GENESIS_PRO_STRIPE_PRICE` and
  `GENESIS_PRO_YEARLY_STRIPE_PRICE`; the page shows the amounts it reads from Stripe once an hour.
  The buy button says a grown-up pays and checkout is for adults, and Stripe's page says it again.
- **Stripe's signed webhook is the only source of truth** (`POST /api/genesis/pro/stripe`, the one
  `/api/` address without the same-site check): the signature is checked (at most 5 minutes old),
  each event applied once, and older subscription events ignored. Handles a paid checkout,
  subscription changes, cancelling (Pro lasts to the end of the time paid for), failed payments
  (Pro paused until paid), and refunds (a full refund ends Pro at once). Paid invoices and refunds
  are kept for the numbers.
- **No accounts:** a **Pro key** (`GP-XXXX-...`, 120 random bits) is emailed to the buyer and shown
  once on `/genesis/pro/welcome`, which keeps it in the browser; the browser sends it in an
  `X-Genesis-Pro-Key` header, never a cookie. **I have a Pro key** turns Pro on in another browser,
  **Email a new key** sends a fresh one to a member's address (the same answer either way), and
  **Manage subscription** opens Stripe's customer portal. Only SHA-256 fingerprints of keys, of the
  buyer's email and of the checkout's id are stored; no email address and no card details. The
  welcome page's address is kept out of the server log.
- New tables `genesis_pro_members`, `genesis_pro_keys`, `genesis_pro_events`,
  `genesis_pro_payments`, `genesis_pro_spend` and `genesis_pro_backups`, tidied by the upkeep loop.
  Every new address is rate-limited (`genesis_pro.RATES`).
- The console's **Numbers** section shows a Genesis Pro card while Pro is on: members (monthly and
  yearly), monthly revenue, money collected this month and last, new, ended and cancelling members,
  failed payments, and the AI cost against the cap, with a warning while the AI price settings are
  still the safe defaults. The costs list names Pro's AI help while Pro is on.
- The privacy page and the terms gain a short Genesis Pro section, shown only while Pro is on.
- New settings: `GENESIS_PRO_ENABLED`, `STRIPE_SECRET_KEY`, `GENESIS_PRO_STRIPE_WEBHOOK_SECRET`,
  `GENESIS_PRO_STRIPE_PRICE`, `GENESIS_PRO_YEARLY_STRIPE_PRICE`, `GENESIS_PRO_PER_HOUR`,
  `GENESIS_PRO_PER_DAY`, `GENESIS_PRO_MONTHLY_AI_USD` and `GENESIS_PRO_EMAIL_FROM`, in
  `.env.example`, `render.yaml`, the README, `docs/STAGING.md` and `docs/GENESIS-PRO.md`.

## 1.6.1 (14 November 2026)

- **The domain is chosen: mtrxhorizyn.com.** `render.yaml` now sets the live addresses:
  `MTRX_PUBLIC_URL=https://mtrxhorizyn.com`, the three apps' "Open" addresses
  (`https://rankup.mtrxhorizyn.com`, `https://cyberlogix.mtrxhorizyn.com`,
  `https://omniarmor.mtrxhorizyn.com`), their health addresses (RankUp and CyberLogix AI
  `/api/health`, OmniArmor.ai `/healthz`) and stats addresses (`/api/stats`), and asks for
  `MTRX_STATS_KEY` without storing it. Staging is made by hand and gets none of them.
- The README, `docs/STAGING.md`, `docs/RUNNING-MTRX-HORIZYN.md` and `.env.example` name the
  real addresses instead of placeholders, with `hello@mtrxhorizyn.com` for business enquiries
  and `help@<app>.mtrxhorizyn.com` for each app. The code still reads every address from its
  setting, and works with them unset.

## 1.6.0 (13 November 2026)

- **Partners** (`/partners`): for fridge and refrigeration repair companies, food safety
  consultants and inspectors' trainers, and kitchen equipment sellers. "Recommend CyberLogix AI
  to the shops you already visit, and earn a share of what they pay." Three steps (apply, get a
  partner key, your customers sign up and you earn), what partners earn and see, exactly as
  CyberLogix AI's partner code works (a share of money actually collected, nothing for trials or
  unpaid or cancelled invoices, no rate printed since it is a setting), and a calm note on why a
  separate alarm matters. Linked from Chroma Vortex's Partner path and every footer.
- **Apply** opens the Chroma Vortex Partner form with CyberLogix AI picked and the new
  partnership kind **Refer my customers (repair / food safety)** (`refer-trade`) chosen. The
  server accepts the new kind; a Vortex address like `#partner/cyberlogix/refer-trade` fills in
  the form (`fromHash` in `static/js/vortex-form.js`), picking only apps the form offers.
- **Kitchen Safety Bundle** (`/bundle`): CyberLogix AI's fridge and freezer alarms with
  OmniArmor.ai's inspection checklists, for restaurants, cafés, pharmacies and school kitchens.
  "Start with a free trial" goes to CyberLogix AI's sign-up when it has an address; an app with
  none says "coming soon" and offers Chroma Vortex. The price says "Ask about bundle pricing"
  until CyberLogix AI's pricing has a bundle add-on (`BUNDLE_PRICE` in `horizon/offers.py`).
  Linked from the home page's menu, About card and footer, from Chroma Vortex and its Our apps
  list, and from the home page's search.
- **Numbers**, a new console section: each app's daily usage counts from its stats address
  (CyberLogix AI's and OmniArmor.ai's `usage`, RankUp's `daily`), with the last 30 days as small
  bars per count, this month against last with an up or down arrow, the three things done most,
  and a "What to do next" line from simple rules. Each day is kept in `usage_days` and each
  month's totals in `usage_months`, so month-over-month works after last month has left an app's
  30 days. An app that isn't connected, or sends no daily counts yet, says so. Owner-only
  `GET /api/console/numbers`.

## 1.5.0 (5 November 2026)

- **Buy the company or an app**, a fourth Chroma Vortex path: name, organisation (optional),
  email, what the visitor is interested in (MTRX Horizyn as a whole, one or more released apps,
  or both) and a message, under a clear notice that it only starts a conversation, nothing is an
  offer to sell and no sale happens through the site. Stored in `vortex_messages` as the new
  `buy` kind, with the same checks, limits, hidden bot field, link check, owner email notice and
  console inbox as the other paths. The four path cards sit four across, or two by two on
  tablets and phones.
- **The app catalog**: a new `apps` table holding every app (key, name, one line, public
  address, colour, status and when it was released), filled once on the first start with
  RankUp, CyberLogix AI and OmniArmor.ai as released. `RANKUP_URL`, `CYBERLOGIX_URL` and
  `OMNIARMOR_URL` still work: when one is set, it is that app's address.
- The console's new **Manage apps** panel adds and edits apps, releases one to the public or
  takes it back into development, and deletes one that was never released. Every change is in
  the activity list. Owner-only routes under `/api/console/apps`.
- An app appears on Chroma Vortex the moment it is released: a card in the new **Our apps**
  section, with Open, **Partner on this** and **Ask about buying** (each opens that form with
  the app picked), and a choice in the Partner and Buy forms. The server accepts exactly the
  released apps. An app in development is shown nowhere.
- The home page counts released apps, lists newer ones in About and Projects, and takes the
  founding apps' Open buttons from the catalog.
- The privacy page and the terms cover the new path.

## 1.4.0 (5 November 2026)

- **Chroma Vortex** (`/vortex`, and `/chroma-vortex` redirects there): the official place to
  partner with MTRX Horizyn, pitch an idea, or get in touch as an investor, in its own swirl of
  colour. Three paths, each a short form, linked from the home page's menu and footer, the other
  pages and the sitemap.
- Pitch an idea can **bring a project from Genesis**, read from the visitor's own browser, and
  Genesis has **Pitch this in Chroma Vortex** on each project. Only the project's id is handed
  over, in the tab's own storage, never in an address. Nothing is sent until Send is pressed.
- The investors path says plainly that the page is not an offer of shares or any investment and
  that the company is not raising money through the site.
- Messages are checked field by field, kept in a new `vortex_messages` table without the
  sender's address or any cookie, and deleted after 365 days. Each address may send 5 an hour
  and 20 a day (`VORTEX_PER_HOUR`, `VORTEX_PER_DAY`); a hidden field catches bots; messages that
  are mostly links are refused.
- The owner gets a short email notice (path and organisation or idea name only) when email is
  set up, and reads, replies to, archives and deletes messages in the console's new **Chroma
  Vortex** section, with an unread count on the sidebar.
- The privacy page says what Chroma Vortex keeps, why and for how long; the terms say a message
  creates no agreement and nothing here is an investment offer.

## 1.3.0 (5 November 2026)

- **Genesis** (`/genesis`), a new feature for every visitor: turn an idea into a project with
  a name, a one-line pitch, who it's for and a web address idea, then take it from Spark to
  Plan, Build and Launch with a launch checklist in plain words, progress per stage and
  overall, and notes. Projects are cards in a list, with an empty state for the first idea.
  Linked from the home page's menu and footer, the other pages, the sitemap, and the console.
- Genesis keeps projects only in the visitor's own browser. Download and Import move them
  between devices; Delete all clears them. It still works, and says so, when the browser
  blocks storage.
- **Ask Genesis**: free, short AI help on a project (sharpen the pitch, who might use it, the
  simplest first version, name ideas, what could go wrong, what's next, or a short question),
  which can be saved to the project's notes. Off until `GENESIS_AI_KEY` and
  `GENESIS_AI_MODEL` are set. Limited per visitor (10 an hour, 30 a day, by address, no
  cookie) and by a daily spend cap (`GENESIS_AI_DAILY_CAP_USD`, 2 dollars by default). The
  idea text is passed to the AI provider and never stored or logged.
- The privacy page says what Genesis keeps (nothing on the server but counts) and what Ask
  Genesis sends.
- The home page's links close up a little on mid-sized screens so the new Genesis link fits.

## 1.2.1 (3 November 2026)

- `docs/STAGING.md`: how to run a second copy at `staging.<your domain>` on
  its own Render service and disk, with its own setup code, knock and stats
  key, mail off or to a test inbox, and a checklist for taking a tested
  commit to live. It is set up by hand, not in `render.yaml`, so syncing
  the live Blueprint never touches it.
- `MTRX_NOINDEX=1`, for that copy only: every answer says noindex,
  robots.txt closes the site and the sitemap is empty. Unset, nothing
  changes. Leave it unset on live.

## 1.2.0 (3 November 2026)

- When the site hits an error it did not expect, you get a short email (at
  the same address as the "app is down" alerts) with nothing about the
  visitor in it, and the console's activity list shows it.
- A load test tool and its results (`docs/LOAD-TEST.md`).

## 1.1.0 (2 November 2026)

- The company is now spelled **MTRX Horizyn** everywhere people see it.
- A friendly page when something goes wrong on the server, instead of a bare
  error.
- Share previews (the picture and text a link shows in a chat) work from
  any app, and the public pages are listed in a sitemap for search engines.
- Console: what each month costs to run, and a link to each app's own admin
  page.
- A brand page (`/brand`) with the logos, colours and the right spelling.

## 1.0.0 (2 November 2026)

- The home page presents MTRX Horizyn as the parent company of RankUp,
  CyberLogix AI and OmniArmor.ai, with an About card, contact, privacy and
  terms.
- Console: every app's health on one screen, and an email when one stays
  down.
- The owner's console is reached by a secret knock from an approved device
  only.
