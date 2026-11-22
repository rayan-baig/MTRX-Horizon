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

  // On Orbyt itself there's no "Open Orbyt" (1.22.0): the visitor is there.
  const onOrbyt = path === "/orbyt";
  const ORBYT = "**Orbyt** is the official place to work with MTRX Horizyn. Pick the path that fits you:\n\n"
    + "- [Pitch an idea](/orbyt#pitch): a business or app idea, or one from Genesis\n"
    + (early ? "- [Early access](/early-access): be first to try the apps\n" : "")
    + "- [Partner with us](/orbyt#partner): for businesses\n"
    + "- [Investors](/orbyt#invest) and [buying the company or an app](/orbyt#buy): these only start a conversation\n\n"
    + "It takes about 2 minutes, a real person reads every message, and we reply by email within 7 days, even if the answer is no."
    + (onOrbyt ? "" : " [Open Orbyt](/orbyt)");

  // Orbyt's "Which form is for me?" (1.22.0): a chooser, one line per kind
  // of visitor, each jumping straight to its form on this page.
  const FORM_CHOOSER = "Pick the line that sounds most like you:\n\n"
    + "- **I have an idea** (a business or app, or a project from Genesis): [Pitch an idea](/orbyt#pitch)\n"
    + (early ? "- **I want to try the apps first**: [Early access](/early-access), and we email you the day one opens\n" : "")
    + "- **I run a business** and want to resell, connect with or recommend one of our apps: [Partner with us](/orbyt#partner)\n"
    + "- **I'd like to invest, or buy the company or an app**: [Investors](/orbyt#invest) or [Buying](/orbyt#buy). These only start a conversation.\n\n"
    + "Each form takes about 2 minutes. A real person reads it and replies by email within 7 days, even if the answer is no.";

  // The home page's Learn more cards, for the founding apps.
  const LEARN = { rankup: "/#learn-rankup", cyberlogix: "/#learn-cyberlogix", omniarmor: "/#learn-omniarmor" };
  const appLink = (a) => (a.open && /^https?:\/\//.test(a.url || "") ? `[${words(a.name)}](${a.url})`
    : LEARN[a.key] ? `[${words(a.name)}](${LEARN[a.key]})` : words(a.name));

  // Home's "What's ready today?" (1.22.0): what works today first (this
  // site's own tools, and any app that's open), then what's coming.
  function readyAnswer() {
    const open = APPS.filter((a) => a.open);
    const coming = APPS.filter((a) => !a.open);
    const ready = ["[Genesis](/genesis) (free)", "[Orbyt](/orbyt)", ...open.map(appLink)];
    const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`);
    let text = `**Ready today:** ${list([...ready, "Pilot"])}.`;
    if (coming.length) {
      text += `\n\n**Coming:** ${coming.map(appLink).join(", ")}.`;
      text += early ? " [Get early access](/#early-access) to hear the day each one opens." : " [Write to us in Orbyt](/orbyt) to hear more.";
    }
    return `${text}\n\nGenesis turns your idea into a plan, Orbyt is where you pitch it or work with us, and Pilot (me) answers questions.`;
  }

  // Home's "Which app fits me?" (1.22.0): a three-way chooser from the site's
  // own words, no AI needed.
  const FIT = {
    rankup: "**For a family**, to turn chores into points and games",
    cyberlogix: "**For a business with fridges or freezers**, alarms that call you",
    omniarmor: "**For a business with safety checks**, checklists that count the deadlines",
  };
  function fitAnswer() {
    const rows = APPS.filter((a) => FIT[a.key]).map((a) => `- ${FIT[a.key]}: ${appLink(a)}${a.open ? "" : " (in development)"}`);
    if (!rows.length) return "MTRX Horizyn's apps are on the [home page](/): a chores game for families, and alarms and checklists for businesses.";
    const soon = APPS.some((a) => FIT[a.key] && !a.open);
    return `Which sounds like you?\n\n${rows.join("\n")}`
      + (soon && early ? "\n\n[Get early access](/#early-access) to hear the day yours opens." : "")
      + "\n\nGot an idea of your own instead? [Genesis](/genesis) turns it into a plan, free.";
  }

  const AFTER_SEND = "A real person reads your message and emails you back within 7 days, even if the answer is no. "
    + "If we'd like to hear more, we'll ask in that email. We keep your message only to reply, for up to 365 days.";

  // Orbyt Pitch Review (horizon/orbyt_review.py): only while the server says
  // it is offered (main.pilot_facts), with its price and days from the
  // settings. Nothing beyond what the terms promise.
  const review = d.review === "on";
  const reviewDays = Number(d.reviewDays) || 0;
  // "ai": the review is written by AI and sent within about an hour; the
  // idea goes to an AI service, which the grown-up agrees to at checkout.
  const reviewAi = review && d.reviewMode === "ai";
  const REVIEW = reviewAi
    ? "A **Pitch Review** is an optional extra you can add after sending a pitch in Orbyt: an **AI-written review** of your idea, "
      + "sent within about an hour. It says what's strong, what to fix, your next 3 steps, and whether it might fit Orbyt. "
      + "To write it, the idea you sent (not your name or email) goes to an AI service, and the grown-up (18+) who pays agrees to that at checkout. "
      + `It's one payment of ${words(d.reviewPrice)} (not a subscription), through Stripe. `
      + `If it isn't with you within ${reviewDays} day${reviewDays === 1 ? "" : "s"}, or we can't review your idea, you get a full refund.\n\n`
      + "Pitching is free, and every pitch gets a reply with or without one. [Pitch an idea](/orbyt#pitch)"
    : review
    ? `A **Pitch Review** is an optional extra you can add after sending a pitch in Orbyt. A real person at MTRX Horizyn `
      + `writes you a personal review of your idea: what's strong, what to fix, your next 3 steps, and whether it might fit Orbyt. `
      + `It's emailed within ${reviewDays} day${reviewDays === 1 ? "" : "s"}, for one payment of ${words(d.reviewPrice)} (not a subscription). `
      + "A grown-up (18+) pays through Stripe. If it's late, or we can't review your idea, you get a full refund.\n\n"
      + "Pitching is free, and every pitch gets a reply with or without one. [Pitch an idea](/orbyt#pitch)"
    : "";

  const START_IDEA = "**Genesis** turns an idea into a plan, one small step at a time. It's free, needs no account, and your ideas stay in "
    + "this browser.\n\n1. Write it in three lines: a name, one line about it, and who it's for.\n2. Tick off easy steps from Spark to Launch.\n\n"
    + "[Start my idea](/genesis#new) or [try an example](/genesis#example).";

  // Genesis's "Show my projects" and "What's my next step?" (1.22.0):
  // answered at once from this browser's own Genesis data (the page's
  // window.GenesisBridge), with no AI key, and nothing is sent anywhere.
  const bridge = () => (path === "/genesis" && window.GenesisBridge && typeof window.GenesisBridge.mine === "function"
    ? window.GenesisBridge : null);
  const NONE_YET = "There are no projects in this browser yet. [Start my idea](/genesis#new), or [try an example](/genesis#example) to see how it works.";
  const PRIVATE = "This comes from this browser only: nothing was sent anywhere.";
  const stop = (t) => (/[.!?]$/.test(t) ? t : `${t}.`);
  const where = (p) => `${words(p.stage)}, ${words(p.done).replace(/\s*\(\d+%\)$/, "")} done`;
  const openLink = (p) => (/^[A-Za-z0-9-]{1,64}$/.test(p.id || "") ? ` [Open ${words(p.name)}](/genesis#p/${p.id})` : "");
  function projectsAnswer() {
    const g = bridge();
    if (!g) return "Your projects are on the [Genesis page](/genesis), kept in this browser.";
    const list = g.mine();
    if (!list.length) return NONE_YET;
    const shown = list.slice(0, 8).map((p) => `- **${words(p.name)}** (${where(p)}). Next: ${stop(words(p.next))}${openLink(p)}`);
    const more = list.length > shown.length ? `\n\n…and ${list.length - shown.length} more on the page.` : "";
    return `You have ${list.length} project${list.length === 1 ? "" : "s"} in this browser, most recent first:\n\n${shown.join("\n")}${more}\n\n${PRIVATE}`;
  }
  function nextAnswer() {
    const g = bridge();
    if (!g) return "Open a project on the [Genesis page](/genesis): its next step is at the top.";
    const p = g.nextOf("");
    if (!p) return NONE_YET;
    const id = /^[A-Za-z0-9-]{1,64}$/.test(p.id || "") ? p.id : "";
    const go = id ? ` [Open ${words(p.name)}](/genesis#p/${id}) to tick it off.` : "";
    if (p.next === "Every step is done") return `Every step of **${words(p.name)}** is done. Well done! [Start your next idea](/genesis#new).\n\n${PRIVATE}`;
    return `For **${words(p.name)}** (${where(p)}), your next step is:\n\n**${words(p.next)}**\n\n`
      + `One small step is enough for today.${go}\n\n${PRIVATE}`;
  }

  // Genesis's "Help with today's spark" (1.24.0): a tip, and a jump to the
  // spark box, from this page alone: no AI key, and nothing sent anywhere.
  // With a key added, the visitor can still ask Pilot for ideas.
  function sparkAnswer() {
    const g = bridge();
    const s = g && typeof g.spark === "function" ? g.spark() : null;
    if (!s) return "Today's spark is on the [Genesis page](/genesis#spark): one line is enough.";
    const prompt = `Today's spark: **${words(s.prompt)}**`;
    if (s.answer) {
      return `${prompt}\n\nYou've answered it already: “${words(s.answer)}”. Nice! `
        + `[Open your spark](/genesis#spark) to change it, or turn it into a project with 3 first steps.\n\n${PRIVATE}`;
    }
    return `${prompt}\n\nA quick way in:\n\n`
      + "- Think of one small thing that annoyed you, a friend or someone at home this week.\n"
      + "- Ask: what if it were easier? Your answer is the idea.\n"
      + "- Write it in one line, like “An app that…” or “A club for…”. It doesn't need to be perfect: you can change it later.\n\n"
      + `[Write my spark](/genesis#spark)\n\n${PRIVATE}`;
  }

  const CHIPS = {
    "/": [["Which app fits me?", { answer: fitAnswer }],
      ["What's ready today?", { answer: readyAnswer }],
      ["How do I start an idea?", { answer: START_IDEA }]],
    "/genesis": [["Show my projects", { answer: projectsAnswer }], ["What's my next step?", { answer: nextAnswer }],
      ["Help with today's spark", { answer: sparkAnswer }]],
    // At most three: while Pitch Review is on, its answer takes the third place.
    "/orbyt": [["Which form is for me?", { answer: FORM_CHOOSER }], ["What happens after I send?", { answer: AFTER_SEND }],
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
      review, reviewPrice: review ? d.reviewPrice || "" : "", reviewDays, reviewAi,
    },
  });
})();
