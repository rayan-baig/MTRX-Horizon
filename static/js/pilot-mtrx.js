// Pilot on the MTRX Horizyn site: the small per-app config (docs/PILOT.md).
// The shared core is in static/pilot/; this file only says who we are, where
// the visitor is, which suggestions fit each page, and where the knowledge
// pack and Genesis tools are (static/js/pilot-mtrx-pack.js, fetched only when
// Pilot is first opened). pilot.js loads this file once the page has
// loaded. The facts in data-* on Pilot's script tag come from the server's
// own settings (main.pilot_facts).
(function () {
  "use strict";
  if (!window.Pilot) return;
  // The facts and addresses are on Pilot's own script tag (templates/_pilot.html).
  const me = document.getElementById("pilot-core");
  const d = (me && me.dataset) || {};

  const PAGES = {
    "/": "Home page",
    "/genesis": "Genesis",
    "/orbyt": "Orbyt: work with MTRX Horizyn",
    "/partners": "Partners (recommend CyberLogix AI)",
    "/bundle": "Kitchen Safety Bundle",
    "/privacy": "Privacy",
    "/terms": "Terms",
    "/brand": "Brand",
    "/early-access": "Early access",
    "/creators": "Creators",
  };
  const path = (window.location.pathname.replace(/\/+$/, "") || "/");

  // The apps, as Orbyt's "Our apps" lists them (main.pilot_facts: from the
  // catalog, an address only once an app is open).
  let APPS = [];
  try { APPS = JSON.parse(d.apps || "[]").filter((a) => a && typeof a.name === "string"); } catch (_) { APPS = []; }
  const early = d.early === "on";
  // Words from the catalog, kept as plain words in Pilot's markdown.
  const words = (t) => String(t || "").replace(/[*_`[\]#<>]/g, "").replace(/\s+/g, " ").trim();

  // Core 1.4.0: answers Pilot gives at once, with no AI key and nothing sent
  // anywhere. Only facts the site itself shows (the catalog, templates/vortex.html).
  function appsAnswer() {
    if (!APPS.length) return "MTRX Horizyn's apps are listed on the [home page](/).";
    const open = APPS.filter((a) => a.open);
    const head = open.length === 0
      ? `MTRX Horizyn makes ${APPS.length} app${APPS.length === 1 ? "" : "s"}, all in development. None is open yet:`
      : open.length === APPS.length ? `MTRX Horizyn makes ${APPS.length} app${APPS.length === 1 ? "" : "s"}, all open now:`
        : `MTRX Horizyn makes ${APPS.length} apps: ${open.length} open, ${APPS.length - open.length} in development.`;
    const list = APPS.map((a) => {
      const link = a.open && /^https?:\/\//.test(a.url || "") ? ` [Open ${words(a.name)}](${a.url})` : a.open ? " (open)" : " (in development)";
      return `- **${words(a.name)}**: ${words(a.line)}${link}`;
    });
    const hear = open.length === APPS.length ? ""
      : early ? "\n\nTo hear the day one opens, [join early access](/early-access)."
        : "\n\nTo hear when one opens, [write to us in Orbyt](/orbyt).";
    return `${head}\n\n${list.join("\n")}${hear}`;
  }

  const ORBYT = "**Orbyt** is the official place to work with MTRX Horizyn. Pick the path that fits you:\n\n"
    + "- [Pitch an idea](/orbyt#pitch): a business or app idea, or one from Genesis\n"
    + (early ? "- [Early access](/early-access): be first to try the apps\n" : "")
    + "- [Partner with us](/orbyt#partner): for businesses\n"
    + "- [Investors](/orbyt#invest) and [buying the company or an app](/orbyt#buy): these only start a conversation\n\n"
    + "It takes about 2 minutes, a real person reads every message, and we reply by email within 7 days, even if the answer is no. "
    + "[Open Orbyt](/orbyt)";

  const AFTER_SEND = "A real person reads your message and emails you back within 7 days, even if the answer is no. "
    + "If we'd like to hear more, we'll ask in that email. We keep your message only to reply, for up to 365 days.";

  // Orbyt Pitch Review (horizon/orbyt_review.py): only while the server says
  // it is offered (main.pilot_facts), with its price and days from the
  // settings. Nothing beyond what the terms promise.
  const review = d.review === "on";
  const reviewDays = Number(d.reviewDays) || 0;
  const REVIEW = review
    ? `A **Pitch Review** is an optional extra you can add after sending a pitch in Orbyt. A real person at MTRX Horizyn `
      + `writes you a personal review of your idea: what's strong, what to fix, your next 3 steps, and whether it might fit Orbyt. `
      + `It's emailed within ${reviewDays} day${reviewDays === 1 ? "" : "s"}, for one payment of ${words(d.reviewPrice)} (not a subscription). `
      + "A grown-up (18+) pays through Stripe. If it's late, or we can't review your idea, you get a full refund.\n\n"
      + "Pitching is free, and every pitch gets a reply with or without one. [Pitch an idea](/orbyt#pitch)"
    : "";

  const START_IDEA = "**Genesis** turns an idea into a plan, one small step at a time. It's free, needs no account, and your ideas stay in "
    + "this browser.\n\n1. Write it in three lines: a name, one line about it, and who it's for.\n2. Tick off easy steps from Spark to Launch.\n\n"
    + "[Start my idea](/genesis#new) or [try an example](/genesis#example).";

  const CHIPS = {
    "/": [["Which app fits me?", "Which MTRX Horizyn app would fit me? Ask me one or two questions first."],
      ["What's ready today?", { answer: appsAnswer }],
      ["How do I start an idea?", { answer: START_IDEA }]],
    "/genesis": [["Show my projects", "Show my projects."], ["What's my next step?", "What's my next step?"],
      ["Help with today's spark", "Help me think of an answer for today's spark."]],
    // At most three: while Pitch Review is on, its answer takes the third place.
    "/orbyt": [["Which form is for me?", { answer: ORBYT }], ["What happens after I send?", { answer: AFTER_SEND }],
      review ? ["What's a Pitch Review?", { answer: REVIEW }]
        : ["Bring a Genesis idea", "How do I pitch a project from Genesis in Orbyt?"]],
    "/partners": [["How do partners earn?", "How do CyberLogix AI partners earn?"], ["What can partners see?", "What can a partner see in the partner portal?"],
      ["How do I apply?", "How do I apply to be a partner?"]],
    "/bundle": [["What does it do?", "What does the Kitchen Safety Bundle do?"], ["What does it cost?", "How much does the bundle cost?"],
      ["Who is it for?", "Who is the Kitchen Safety Bundle for?"]],
    "/privacy": [["What do you keep?", "In plain words, what does this site keep about me?"], ["What does Pilot send?", "What does Pilot send, and to whom?"]],
    "/terms": [["Terms in plain words", "Summarise the terms in plain words."]],
    "/brand": [["How do I write the name?", "How should I write the MTRX Horizyn name?"]],
    "/early-access": [["What do founding members get?", "What do early access founding members get?"]],
    "/creators": [["How does the program pay?", "How does the creator program work?"]],
  };

  const TASKS = {
    "/": "Help me pick the right MTRX Horizyn app for me: ",
    "/genesis": "Turn today's spark into a project and add 3 first steps",
    "/orbyt": "Help me write a short, clear note for the Orbyt form about: ",
    "/partners": "Help me write a partner application note for my business: ",
  };

  function screen() {
    let name = PAGES[path] || document.title;
    if (path === "/genesis" && window.GenesisBridge) {
      const g = window.GenesisBridge.screen();
      name = `Genesis, ${g.view}${g.project ? ` (“${g.project}”)` : ""}`;
    }
    return { name };
  }

  window.Pilot.mount({
    appName: "MTRX Horizyn",
    name: "Pilot",
    // Core 1.2.0: the welcome is this site's own (docs/PILOT.md). The Mac app
    // keeps the design's.
    tagline: "Help with ideas and MTRX apps",
    // Core 1.4.0: the pills that can work with no AI key do. "Help with my
    // idea" goes to Genesis's start form (free, and Genesis has its own free
    // AI help), "What is Orbyt?" and "What apps are coming?" are answered at
    // once from the site's own facts; "Explain this page" needs the AI.
    welcomePills: [
      { icon: "spark", label: "Help with my idea", link: "/genesis#new" },
      { icon: "chat", label: "What is Orbyt?", answer: ORBYT },
      { icon: "bars", label: "Explain this page", action: "explain-screen" },
      { icon: "bolt", label: "What apps are coming?", answer: appsAnswer },
      { icon: "key", label: "Add my AI key", action: "settings" },
    ],
    // Under an answer Pilot gives without a key.
    answerMore: "Want more? Add your AI key to ask anything.",
    // This site has no use for making pictures or videos.
    hideKeySections: ["image", "video"],
    // Tucked away, the robot shrinks into its corner instead of hanging off
    // the screen's edge.
    keepInViewport: true,
    // The home page's cards (Learn more, Projects, About...) are CSS :target
    // pop-ups, not dialogs: the robot steps back while one is open.
    modals: [".sheet:target"],
    storagePrefix: "mtrx-pilot",
    pack: d.pack || "",
    // Exactly the hosts the site's security policy lets a browser reach for
    // an OpenAI-compatible API (main.PILOT_COMPATIBLE_HOSTS and the visitor's
    // own computer).
    compatibleHosts: (d.hosts || "").split(/\s+/).filter(Boolean),
    privacyUrl: "/privacy",
    // Visitors may be young: said once, plainly, with no nagging. It sits
    // just above the message box until a key is added.
    keyNote: "Pilot uses a grown-up's AI key (the AI companies require 18+).",
    // Core 1.3.0: on the welcome, one short line, so the pills and this
    // page's suggestions keep their room (the full note is its tooltip and
    // sits beside the key settings).
    keyNoteShort: "AI keys are for grown-ups (18+).",
    audienceNote: "Visitors to this site may be young people starting their first idea. Keep answers safe, kind and simple. For money, contracts, sign-ups or anything needing an adult, suggest asking a trusted adult.",
    // The MTRX site has no child accounts; RankUp's config says when a view is a child's.
    kidView: () => false,
    // The core already keeps the robot off the page's words and buttons
    // wherever it is scrolled to. On top of that, the row of streak dots
    // under today's spark, and on the Genesis project
    // screen it keeps clear of the stage bar, the web address and the whole
    // launch checklist: each row with its Hide button, and each stage's
    // heading with its count and arrow (it moves to a free corner, or tucks
    // away beside them). On Orbyt, each path card's arrow (1.19.0: on a
    // phone it tucked over Partner's arrow, a big card being cheap to cover).
    avoid: [".g-track", "#g-address", ".g-head .g-address", ".g-item-row", ".g-group-head", ".g-hidden-steps > summary",
      ".g-add-form", ".g-moves", "#g-week", ".v-path-go"],
    screen,
    // A suggestion is an AI prompt (words), or an answer given at once (core 1.4.0).
    chips: () => (CHIPS[path] || []).map(([label, what]) => (typeof what === "string" ? { label, prompt: what } : { label, ...what })),
    taskPrompt: () => TASKS[path] || "Help me get started on this page.",
    facts: {
      ai: d.ai === "on", freeDay: Number(d.freeDay) || 0, freeHour: Number(d.freeHour) || 0,
      pro: d.pro === "on", proPrice: d.proPrice || "", early: d.early === "on", creators: d.makers === "on",
      review, reviewPrice: review ? d.reviewPrice || "" : "", reviewDays,
    },
  });
})();
