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
  // Genesis and Orbyt on their own addresses (1.26.0, horizon/hosts.py):
  // where each is ("/genesis", or https://genesis.mtrxhorizyn.com once
  // moved), and the main site's address once they have.
  const GENESIS = d.genesis || "/genesis";
  const ORBYT = d.orbyt || "/orbyt";
  const SITE = d.site || "";
  const whole = (u) => /^https?:\/\//.test(u);
  const originOf = (u) => { try { return new URL(u).origin; } catch (_) { return ""; } };
  const here = (u) => whole(u) && originOf(u) === window.location.origin;
  // A link into Genesis or Orbyt: a path where the page is on that address.
  const into = (base, rest) => {
    if (!whole(base)) return base + rest;
    const tail = rest.startsWith("/") ? rest : `/${rest}`;
    return here(base) ? tail : base + tail;
  };
  const onApp = here(GENESIS) || here(ORBYT);
  // This page, named as it is on the main site ("/genesis" on genesis.*'s "/").
  let path = (window.location.pathname.replace(/\/+$/, "") || "/");
  if (here(GENESIS)) path = path === "/" ? "/genesis" : `/genesis${path}`;
  else if (here(ORBYT)) path = path === "/" ? "/orbyt" : `/orbyt${path}`;
  // The answers below are written with main-site paths ("/genesis#new",
  // "/orbyt#pitch", "/privacy"); each is sent to its right address here.
  function addressOf(target) {
    if (target === "/genesis" || /^\/genesis[#/?]/.test(target)) return into(GENESIS, target.slice(8));
    if (target === "/orbyt" || /^\/orbyt[#/?]/.test(target)) return into(ORBYT, target.slice(6));
    return onApp && SITE ? SITE + target : target;
  }
  const links = (text) => String(text).replace(/\]\((\/(?![/\\])[^\s)]*)\)/g, (_, target) => `](${addressOf(target)})`);
  const answered = (answer) => (typeof answer === "function" ? (...a) => links(answer(...a)) : links(answer));

  // The apps, as Orbyt's "Our apps" lists them (main.pilot_facts: from the
  // catalog, an address only once an app is open).
  let APPS = [];
  try { APPS = JSON.parse(d.apps || "[]").filter((a) => a && typeof a.name === "string"); } catch (_) { APPS = []; }
  const early = d.early === "on";
  // Words from the catalog, kept as plain words in Pilot's markdown.
  const words = (t) => String(t || "").replace(/[*_`[\]#<>]/g, "").replace(/\s+/g, " ").trim();

  // Core 1.4.0: answers Pilot gives at once, with no AI key and nothing sent
  // anywhere. Only facts the site itself shows (the catalog, templates/vortex.html).
  // ctx.label is what was typed when a typed question matched (core 1.4.2):
  // "When does RankUp open?" gets a first line about RankUp (1.27.0).
  const nameKey = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  function appsAnswer(ctx) {
    if (!APPS.length) return "MTRX Horizyn's apps are listed on the [home page](/).";
    const typed = nameKey(ctx && ctx.label);
    const named = typed ? APPS.find((a) => { const k = nameKey(String(a.name).split(/[\s.]/)[0]); return k.length > 2 && typed.includes(k); }) : null;
    const lead = !named ? ""
      : named.open ? `**${words(named.name)}** is open now.\n\n`
        : `**${words(named.name)}** is still in development.\n\n`;
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
    return `${lead}${head}\n\n${list.join("\n")}${hear}`;
  }

  // On Orbyt itself there's no "Open Orbyt" (1.22.0): the visitor is there.
  const onOrbyt = path === "/orbyt";
  const ORBYT_TEXT = "**Orbyt** is the official place to work with MTRX Horizyn. Pick the path that fits you:\n\n"
    + "- [Pitch an idea](/orbyt#pitch): a business or app idea, or one from Genesis\n"
    + (early ? "- [Early access](/early-access): be first to try the apps\n" : "")
    + "- [Partner with us](/orbyt#partner): for businesses\n"
    + "- [Investors](/orbyt#invest) and [buying the company or an app](/orbyt#buy): these only start a conversation\n\n"
    + "It takes about 2 minutes, a real person reads every message, and we reply by email within 7 days, even if the answer is no."
    + (onOrbyt ? "" : " [Open Orbyt](/orbyt)");

  // Orbyt's "Which form is for me?" (1.22.0): a chooser, one line per kind
  // of visitor, each jumping straight to its form on this page.
  // 1.27.0: it starts by saying what Orbyt is, since on Orbyt it also
  // answers a typed "What is Orbyt?" (Orbyt has no pill of its own there).
  const FORM_CHOOSER = "**Orbyt** is where you work with MTRX Horizyn. Pick the line that sounds most like you:\n\n"
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
    // What costs nothing, from the site's own settings: Genesis Pro and the
    // Pitch Review are named as optional extras only while they're on.
    const pro = d.pro === "on";
    const paidReview = d.review === "on";
    const free = `**Free:** Genesis${pro ? " (Genesis Pro is an optional paid extra)" : ""}, sending a pitch in Orbyt`
      + `${paidReview ? " (a Pitch Review is an optional paid extra)" : ""}, and answers like this one from Pilot.`;
    return `${text}\n\n${free}\n\nGenesis turns your idea into a plan, Orbyt is where you pitch it or work with us, and Pilot (me) answers questions.`;
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
  // Orbyt's "Who owns my idea?" (1.27.0): the page's own two answers from
  // "Before you send" (templates/vortex.html), nothing more.
  const OWN_IDEA = "**Who owns my idea?** You do. Your idea stays yours: we never take a share of it without a written "
    + "agreement that you (and a parent or guardian, if you're under 18) sign. Sending it doesn't create a partnership, "
    + "an agreement or any obligation for either of us.\n\n"
    + "**Will you build it without me?** No. We won't publish or pass on what you send. We may already be working on "
    + "something similar; if we are, we'll tell you when we reply, so you know where you stand.\n\n"
    + "[Pitch an idea](/orbyt#pitch)";

  // Orbyt Pitch Review (horizon/orbyt_review.py): only while the server says
  // it is offered (main.pilot_facts), with its price and days from the
  // settings. Nothing beyond what the terms promise.
  const review = d.review === "on";
  const reviewDays = Number(d.reviewDays) || 0;
  // "ai": the review is written by AI and sent usually within an hour; the
  // idea goes to an AI service, which the grown-up agrees to at checkout.
  const reviewAi = review && d.reviewMode === "ai";
  const REVIEW = reviewAi
    ? "A **Pitch Review** is an optional extra you can add after sending a pitch in Orbyt: an **AI-written review** of your idea, "
      + "usually within an hour. It says what's strong, what to fix, your next 3 steps, and whether it might fit Orbyt. "
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

  // Genesis's "Help with today's spark" (1.25.0): a tip, and a jump to the
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
      + "- Write it in one line. It doesn't need to be perfect: you can change it later.\n\n"
      // 1.27.0: one example answer to today's very spark (genesis-store.js SPARK_EXAMPLES).
      + (s.example ? `For today's spark, one line could be: “${words(s.example)}”\n\n` : "")
      + `[Write my spark](/genesis#spark)\n\n${PRIVATE}`;
  }

  // ---------------------------------------------------------------- 1.28.0: more built-in answers
  // Questions visitors type with no AI key, answered from the site's own
  // words (the privacy page, the terms, Orbyt's "Before you send", the
  // Genesis page). Nothing here is sent anywhere.
  const pro = d.pro === "on";
  const proPrice = words(d.proPrice);
  const PRIVACY = "**Yes, MTRX Horizyn keeps very little:**\n\n"
    + "- No accounts, no cookies for visitors, and no tracking or ads.\n"
    + "- **Genesis** keeps your projects in this browser only. The only words that leave it are the ones you choose to send with Ask Genesis.\n"
    + "- **Orbyt** keeps what you send only to reply to you, for up to 365 days, and never passes it on.\n"
    + "- **Pilot** (me): answers like this one stay on your device. With your own AI key, what you send goes straight from this browser to the AI company you chose, never to us.\n\n"
    + "[Read the privacy page](/privacy)";
  const MADE = "**MTRX Horizyn** made this site: a small independent software company, and the parent company of "
    + "RankUp, CyberLogix AI and OmniArmor.ai. It made Genesis, Orbyt and me, Pilot, too.\n\n"
    + "[About MTRX Horizyn](/#company), or [write to us in Orbyt](/orbyt).";
  const PILOT_TEXT = "I'm **Pilot**, the helper in the corner of every MTRX Horizyn page.\n\n"
    + "- **With no key**, I answer questions about this site, Genesis, Orbyt and the apps, right here: nothing you type leaves this browser.\n"
    + "- **With a grown-up's own AI key** (18+, added in my settings), I can answer anything, explain a page and help with your idea. "
    + "The key and what you send go straight to the AI company you chose, never to MTRX Horizyn.";
  // What a greeting gets: hello, and what works with no key on this page.
  const GREETINGS = {
    "/": "**Is Genesis free?** or **Which app fits me?** below, or tell me your idea",
    "/genesis": "**Show my projects** or **What's my next step?** below, or type \"Give me an idea\"",
    "/orbyt": "**Which form is for me?** or **Who owns my idea?** below, or type \"Can I pitch at 13?\"",
  };
  const greeting = () => `Hi! I'm **Pilot**. Even without an AI key I can help here: try ${GREETINGS[path] || "the buttons below"}.`;
  const IDEA = "Great, let's turn it into a plan! **Genesis** does that, free, one small step at a time:\n\n"
    + "1. Write it in three lines: a name, one line about it, and who it's for.\n2. Tick off easy steps from Spark to Launch.\n\n"
    + "Your idea stays in this browser. [Start my idea](/genesis#new)";
  // "Give me an idea" (Genesis): one of Genesis's own example ideas (the
  // ones "Try an example" fills the form with), and that button.
  function exampleIdea() {
    const S = window.GenesisStore;
    const e = S && typeof S.example === "function" ? S.example() : null;
    const one = e && e.name ? e : { name: "Plant Pal", pitch: "Reminds you to water your plants, and tells you how much", audience: "people who keep forgetting their houseplants" };
    return `Here's one to start from: **${words(one.name)}**. ${stop(words(one.pitch))} It's for ${stop(words(one.audience))}\n\n`
      + "[Try an example](/genesis#example) to see an idea like it as a plan, or [start your own](/genesis#new). "
      + "Stuck? Think of one small thing that annoyed you this week: making it easier is an idea.";
  }
  // Genesis's price (1.28.0): free, and Genesis Pro only while it's on (the
  // page shows nothing about Pro otherwise), with the price from the settings.
  const PRO_TEXT = `**Genesis Pro** is an optional extra for people who ask Genesis for help a lot: more Ask Genesis answers, `
    + "longer answers plus a four-week plan, website words and price ideas, a private cloud backup, and a project download as a tidy plan. "
    + `It's ${proPrice} a month, paid by a grown-up, and you can cancel any time. Genesis itself stays free. [See Genesis Pro](/genesis#pro)`;
  const ALSO_FREE = `**Also free:** sending a pitch in Orbyt${review ? " (a Pitch Review is an optional paid extra)" : ""}, and answers like this one from Pilot.`;
  function freeAnswer(ctx) {
    const asked = String((ctx && ctx.label) || "").toLowerCase();
    if (/\bpro\b/.test(asked)) {
      return pro ? `${PRO_TEXT}\n\n${ALSO_FREE}`
        : "**Genesis is free**, and there's nothing to buy for it right now: every project, step and spark costs nothing.\n\n[Start my idea](/genesis#new)";
    }
    if (/\bgenesis\b/.test(asked) || path === "/genesis") {
      return "**Yes, Genesis is free:** no account, nothing to pay, and your ideas stay in this browser."
        + (pro ? ` Genesis Pro (${proPrice} a month) is an optional extra for people who ask Genesis for help a lot.` : "")
        + `\n\n${ALSO_FREE}\n\n[Start my idea](/genesis#new)`;
    }
    // "Is it free?", "How much does it cost?": everything free first, then
    // the optional extras that are on.
    const extras = [pro ? `Genesis Pro (${proPrice} a month)` : "", review ? `a Pitch Review (${words(d.reviewPrice)}, once) after sending a pitch` : ""].filter(Boolean);
    return "**Free:** Genesis, sending a pitch in Orbyt, and answers like this one from Pilot."
      + (extras.length ? `\n\n**Optional paid extras:** ${extras.join(" and ")}. A grown-up pays.` : "")
      + "\n\n[Start my idea](/genesis#new), free.";
  }
  // "Is my idea saved?" (Genesis): where it is kept, from the privacy page.
  const SAVED = "**Your projects are saved in this browser**, as you go, with no account. They stay on this device until "
    + "you delete them or clear this site's data, so they aren't on your other devices or browsers. To keep a copy, use "
    + `**Download** under your projects${pro ? " (Genesis Pro adds a private cloud backup)" : ""}.\n\n${PRIVATE}`;
  // Orbyt's age rules, from the page and the terms: under 13, a parent or
  // guardian sends it; under 18, a grown-up signs any agreement (and pays
  // for a Pitch Review).
  function ageAnswer(ctx) {
    const asked = String((ctx && ctx.label) || "").toLowerCase().replace(/[’]/g, "'");
    const m = asked.match(/\b(?:i'?m|i am|im|age|aged)\s+(\d{1,2})\b/) || asked.match(/\b(\d{1,2})\s*(?:years?|yrs?|yo)\b/);
    const age = m ? Number(m[1]) : 0;
    const lead = !age ? "**You can pitch at any age.** If you're under 13, a parent or guardian sends it for you; from 13, you can send it yourself."
      : age < 13 ? `**At ${age}, ask a parent or guardian to send your pitch for you.** That's Orbyt's rule for anyone under 13.`
        : age < 18 ? `**Yes: at ${age} you can send a pitch yourself.** (Under 13, a parent or guardian sends it.)`
          : "**Yes, you can pitch.**";
    const young = age >= 18 ? ""
      : "\n\nWhile you're under 18, your idea stays yours, and any agreement about it needs a parent or guardian to sign it with you."
        + (review ? " A Pitch Review is bought by a grown-up (18+)." : "");
    return `${lead} A real person reads it and replies by email within 7 days, even if the answer is no.${young}\n\n[Pitch an idea](/orbyt#pitch)`;
  }
  const BUILD = "**We can't promise to build it, but you can pitch it.** A real person reads every idea and replies by email within "
    + "7 days, even if the answer is no; if we'd like to hear more, we'll ask in that email. Your idea stays yours, and sending it "
    + "doesn't create an agreement for either of us.\n\n[Pitch an idea](/orbyt#pitch), or plan it first in [Genesis](/genesis), free.";
  // The Pitch Review, asked about one part at a time (1.28.0): who writes it,
  // how long it takes, and what costs money.
  const reviewWho = () => (reviewAi
    ? "**No: a Pitch Review is written by an AI service**, following our instructions, and checked by our automatic rules before it's sent. "
      + "If the AI can't write it well, a person at MTRX Horizyn writes it instead. (Your pitch itself is always read by a real person.)"
    : "**Yes: a real person at MTRX Horizyn writes your Pitch Review**: what's strong, what to fix, your next 3 steps, and whether it might fit Orbyt.")
    + `\n\n${REVIEW}`;
  const reviewTime = () => (reviewAi
    ? `**Usually within an hour.** It's promised within ${reviewDays} day${reviewDays === 1 ? "" : "s"} of paying; if it's later, you get a full refund.`
    : `**Within ${reviewDays} day${reviewDays === 1 ? "" : "s"} of paying.** If it's later, you get a full refund.`)
    + `\n\n${REVIEW}`;
  const PITCH_FREE = review
    ? `**Pitching is free; the only paid thing is an optional ${words(d.reviewPrice)} Pitch Review.** Every pitch gets a reply with or without one.`
    : "**Pitching is free:** sending a pitch, or any Orbyt form, costs nothing.";
  const costAnswer = () => (review ? `${PITCH_FREE}\n\n${REVIEW}` : `${PITCH_FREE}\n\n${AFTER_SEND}`);

  // What "Explain this page" says with no key (1.28.0): a short built-in
  // summary of the page, so the button works for everyone. With a key it
  // stays the AI's own explanation of the screen.
  function homeSummary() {
    const names = APPS.map((a) => words(a.name));
    const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
    const open = APPS.filter((a) => a.open).length;
    return "**This is MTRX Horizyn's home page.**\n\n"
      + "- **Ready today:** [Genesis](/genesis) turns your idea into a plan, free, and [Orbyt](/orbyt) is where you pitch it or work with us.\n"
      + (names.length ? `- **The apps:** ${list(names)}${open === APPS.length ? ", open now" : open ? "" : ", all in development"}. Each card has **Learn more**, with pictures from its demo.\n` : "")
      + (early ? "- **Get early access** to hear the day each app opens.\n" : "")
      + "- **At the bottom:** About us, and Projects (everything MTRX Horizyn is making).\n\n"
      + "The quickest start: [Start my idea](/genesis#new), free.";
  }
  function genesisSummary() {
    const g = window.GenesisBridge && typeof window.GenesisBridge.screen === "function" ? window.GenesisBridge.screen() : null;
    const view = !g ? "" : g.project ? `You're looking at **${words(g.project)}**: its stages and checklist. Tick a step when it's done.\n\n`
      : /form/.test(g.view || "") ? "This is the form to start a new project: a name, one line about it, and who it's for.\n\n" : "";
    return `${view}**This is Genesis.** It turns an idea into a plan, free:\n\n`
      + "- **Start an idea** in three lines: a name, one line about it, and who it's for.\n"
      + "- **Tick off small steps** from Spark to Plan, Build and Launch.\n"
      + "- **Today's spark:** a new question every day; one line is enough, and it keeps your streak.\n"
      + "- **Your projects stay in this browser:** nothing is sent unless you press Ask Genesis.\n"
      + (pro ? `- **Genesis Pro** (${proPrice} a month) is an optional extra for people who ask Genesis for help a lot.\n` : "")
      + "\n[Start my idea](/genesis#new) or [try an example](/genesis#example).";
  }
  function orbytSummary() {
    return "**This is Orbyt**, where you work with MTRX Horizyn:\n\n"
      + `- **Pick a path:** Pitch an idea${early ? ", Early access" : ""}, Partner with us, or Business enquiries (investors, or buying the company or an app).\n`
      + "- **Write a short note:** about 2 minutes.\n"
      + "- **A real person replies** by email within 7 days, even if the answer is no.\n"
      + "- **Before you send** answers who owns your idea (you do) and what happens next.\n"
      + (review ? `- **Pitch Review:** an optional ${words(d.reviewPrice)} extra after sending. Pitching itself is free.\n` : "")
      + "\n[Pitch an idea](/orbyt#pitch)";
  }
  const SUMMARIES = { "/": homeSummary, "/genesis": genesisSummary, "/orbyt": orbytSummary };

  // Topics (1.28.0): what a typed question is about, checked first by every
  // built-in answer on the page. A typed question reaches one answer through
  // its `match` words (core 1.4.2); whichever it reaches, these make sure the
  // words get the right reply ("Is my data safe?", "I'm 13, can I pitch?").
  // A button pressed (or its own words typed) always gets its own answer.
  const TOPICS = {
    "/": [
      ["greet", /^(hi+|hello|hey+|hiya|howdy|yo|good (morning|afternoon|evening))\b[\s,!.]*(there|pilot)?[\s!.?]*$/, greeting],
      ["pilot", /\bpilot\b|^who are you\b/, () => PILOT_TEXT],
      ["made", /\bwho('s| is)? ?(made|makes|built|created|runs|is behind)\b|\b(made|built|created) (this|it|the (web)?site|mtrx)\b|\b(company|founder)\b/, () => MADE],
      ["privacy", /\b(data|privacy|private|safe|secure|security|track|tracking|tracked|cookies?)\b/, () => PRIVACY],
      ["example", /\b(give|suggest|need|want)\b.*\bideas?\b|\bany ideas\b|\bideas? (please|for me)\b|\bexample\b/, exampleIdea],
      ["free", /\bgenesis\b.*\b(free|cost|costs|price|pay|paid|much|pro|charge|money)\b|\b(free|cost|costs|price|pay|paid|much|charge|money)\b.*\bgenesis\b|\bpro\b/, freeAnswer],
      ["genesis", /\bgenesis\b/, () => START_IDEA],
      ["idea", /\b(i|we)('ve| have|'ve got| got| have got)\b.*\bideas?\b|\bidea for\b|^(my )?idea\b/, () => IDEA],
    ],
    "/genesis": [
      ["greet", /^(hi+|hello|hey+|hiya|howdy|yo|good (morning|afternoon|evening))\b[\s,!.]*(there|pilot)?[\s!.?]*$/, greeting],
      ["pilot", /\bpilot\b|^who are you\b/, () => PILOT_TEXT],
      ["example", /\b(give|suggest|need|want)\b.*\bideas?\b|\bany ideas\b|\bideas? (please|for me)\b|\bexample\b/, exampleIdea],
      ["free", /\bpro\b|\b(free|cost|costs|price|pay|paid|much|charge|money)\b/, freeAnswer],
      // "Is my idea saved?", "Will I lose my projects?"; "Where are my saved
      // projects?" is the list itself.
      ["saved", (t) => /\b(save|saved|saving|keep|kept|store|stored|lose|lost|backup|back up)\b/.test(t) && !/\b(where|show|list|see)\b/.test(t), () => SAVED],
      ["idea", /\b(i|we)('ve| have|'ve got| got| have got)\b.*\bideas?\b|\bidea for\b|^(my )?idea\b/, () => IDEA],
    ],
    "/orbyt": [
      ["greet", /^(hi+|hello|hey+|hiya|howdy|yo|good (morning|afternoon|evening))\b[\s,!.]*(there|pilot)?[\s!.?]*$/, greeting],
      ["pilot", /\bpilot\b|^who are you\b/, () => PILOT_TEXT],
      ["age", /\b(i'?m|i am|im|age|aged)\s+\d{1,2}\b|\b\d{1,2}\s*(years?|yrs?|yo)\b|\b(how old|old enough|age|young|younger|teen|teenager|kids?|child|children|under ?1[38])\b/, ageAnswer],
      ...(review ? [
        ["reviewWho", /\breview\b.*\b(person|human|people|real|written|writes|write|ai|robot|bot|who)\b|\b(person|human|real|written|writes|who|ai)\b.*\breview\b/, reviewWho],
        ["reviewTime", /\breview\b.*\b(long|take|takes|time|when|fast|quick|soon|hours?|days?)\b|\b(long|when|fast|soon)\b.*\breview\b/, reviewTime],
      ] : []),
      ["cost", /\b(cost|costs|price|pay|paid|much|free|charge|money|fee|fees)\b/, costAnswer],
      ["build", /\b(build|make|create|develop|code)\b.*\b(my|an?|the|our)\b.*\b(app|game|website|site|idea)\b(?!.*\bwithout\b)|\b(build|make) (it|this) for (me|us)\b/, () => BUILD],
    ],
  };
  // Every pill's and suggestion's own words on this page, made plain: a
  // button pressed, or its words typed, always gets that button's answer.
  const plainLabel = (t) => String(t || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const LABELS = new Set();
  function topical(answer) {
    return (ctx) => {
      const asked = ctx && typeof ctx.label === "string" ? ctx.label : "";
      if (asked && !LABELS.has(plainLabel(asked))) {
        const text = asked.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
        const hit = (TOPICS[path] || []).find(([, test]) => (typeof test === "function" ? test(text) : test.test(text)));
        if (hit) return hit[2](ctx);
      }
      return typeof answer === "function" ? answer(ctx) : answer;
    };
  }

  // `match` (core 1.4.2): more words a typed question may use for each of
  // these answers, with no AI key ("What is Genesis?", "Is it free?", "When
  // does RankUp open?", "Do you reply?"). One typed word that is listed is
  // enough, so a word is listed on one answer per page only, and never a
  // word another answer's label has ("idea" is "Help with my idea"'s),
  // except the few listed on purpose (below, and SHARED in
  // tests/js/site_pilot_answers.test.js).
  // 1.28.0: the topics above have their words here too (at most 20 an answer:
  // the core reads no more), so the typed question reaches one answer.
  const MATCH = {
    fit: ["family", "families", "kid", "kids", "child", "children", "parent", "chore", "business", "restaurant", "kitchen",
      "fridge", "freezer", "safety", "compliance", "suit", "best", "right", "choose", "pick"],
    ready: ["ready", "today", "now", "available", "use", "try", "live", "working"],
    // "Is Genesis free?" (home, 1.28.0): Genesis itself, and money.
    free: ["genesis", "free", "cost", "much", "price", "pay", "paid", "money", "pro", "charge", "subscription"],
    // "Help with my idea": starting, an idea of one's own, an example idea.
    idea: ["start", "begin", "game", "invent", "invention", "plan", "planner", "give", "suggest", "example", "app"],
    apps: ["rankup", "cyberlogix", "omniarmor", "open", "opening", "launch", "release", "coming", "soon", "date", "early", "access"],
    orbyt: ["orbyt", "pitch", "partner", "invest", "investor", "contact", "work"],
    projects: ["project", "projects", "saved", "save", "list", "mine", "progress", "stage", "done", "where", "keep", "lose", "lost", "backup"],
    next: ["next", "step", "steps", "todo", "continue", "tick", "task"],
    spark: ["spark", "sparks", "prompt", "daily", "today", "streak", "challenge"],
    // "Which form is for me?", and (1.28.0) who may pitch: "I'm 13, can I pitch?"
    form: ["form", "path", "investor", "invest", "buy", "business", "partner", "orbyt", "pitch",
      "im", "age", "old", "young", "younger", "teen", "kid", "child", "12", "13", "14"],
    after: ["reply", "replies", "person", "human", "real", "read", "answer", "email", "hear", "back", "long", "wait", "days", "keep", "delete"],
    review: ["review", "price", "cost", "pay", "paid", "money", "much", "free", "charge", "refund", "stripe", "take", "written", "writes", "ai"],
    own: ["own", "owns", "owner", "ownership", "mine", "build", "without", "steal", "copy", "publish", "share", "secret", "safe", "rights", "app", "make", "create"],
    // "Explain this page" with no key: the page itself, a hello, Pilot, and
    // (home) who made the site and what it keeps.
    explain: {
      "/": ["page", "here", "site", "website", "hi", "hello", "hey", "pilot", "made", "built", "created", "company", "founder",
        "data", "safe", "privacy", "private", "secure", "security", "track"],
      "/genesis": ["page", "here", "site", "hi", "hello", "hey", "hiya", "pilot", "genesis", "pro", "free", "cost", "much", "price",
        "pay", "paid", "money", "subscription"],
      "/orbyt": ["page", "here", "site", "hi", "hello", "hey", "hiya", "pilot"],
    },
  };
  // Words listed on purpose although another answer's label has them: "app"
  // ("I have an idea for an app", home and Genesis; "Can you build my app?"
  // on Orbyt, where "Help with my idea" doesn't list it); on Genesis "saved"
  // and "keep" are on "Show my projects" and "Help with my idea" both, so
  // "Is my idea saved?" and "Where are my saved projects?" each find theirs.
  const ideaMatch = path === "/orbyt" ? MATCH.idea.filter((w) => w !== "app") : MATCH.idea;
  // While Pitch Review is off, "Is it free?" and the like go to what happens
  // after sending, which says sending is free.
  const AFTER = review ? AFTER_SEND : `${AFTER_SEND} Sending is free.`;
  const CHIPS = {
    "/": [["Which app fits me?", { answer: fitAnswer, match: MATCH.fit }],
      ["What's ready today?", { answer: readyAnswer, match: MATCH.ready }],
      ["Is Genesis free?", { answer: freeAnswer, match: MATCH.free }]],
    "/genesis": [["Show my projects", { answer: projectsAnswer, match: MATCH.projects }],
      ["What's my next step?", { answer: nextAnswer, match: MATCH.next }],
      ["Help with today's spark", { answer: sparkAnswer, match: MATCH.spark }]],
    // At most three: while Pitch Review is on, its answer takes the third place.
    "/orbyt": [["Which form is for me?", { answer: FORM_CHOOSER, match: MATCH.form }],
      ["What happens after I send?", { answer: AFTER, match: review ? MATCH.after : MATCH.after.concat(["free", "cost", "much", "price", "pay", "money"]) }],
      review ? ["What's a Pitch Review?", { answer: REVIEW, match: MATCH.review }]
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

  // The page's own answers, each made once: its links sent to the right
  // address, and the topics above checked first (topical).
  const own = (answer) => answered(topical(answer));
  // "Help with my idea" (1.28.0): an answer on every address (it was a link
  // to Genesis's start form on the main site), so "I have an idea for a
  // game" or "Give me an idea" typed with no key gets its own reply. The
  // answer ends with that same link.
  const startPill = { icon: "spark", label: "Help with my idea", answer: own(START_IDEA),
    match: path === "/genesis" ? ideaMatch.concat(["saved", "keep"]) : ideaMatch };
  const secondPill = onOrbyt ? { icon: "chat", label: "Who owns my idea?", answer: own(OWN_IDEA), match: MATCH.own }
    : { icon: "chat", label: "What is Orbyt?", answer: own(ORBYT_TEXT), match: MATCH.orbyt };
  const appsPill = { icon: "bolt", label: "What apps are coming?", answer: own(appsAnswer), match: MATCH.apps };
  const keyPill = { icon: "key", label: "Add my AI key", action: "settings" };
  // "Explain this page" (1.28.0): with no key, on Home, Genesis and Orbyt,
  // the page's built-in summary (SUMMARIES), at once; with a key, the AI's
  // own explanation of the screen, as before. Read when the window is built
  // (and on every typed question), so a key added on another page counts.
  const summaryAnswer = SUMMARIES[path] ? own(SUMMARIES[path]) : null;
  const aiExplain = { icon: "bars", label: "Explain this page", action: "explain-screen" };
  const keySet = () => { try { return Boolean(window.Pilot.ready && window.Pilot.ready()); } catch (_) { return false; } };
  const explainPill = () => (summaryAnswer && !keySet()
    ? { icon: "bars", label: "Explain this page", answer: summaryAnswer, match: MATCH.explain[path] } : aiExplain);
  // This page's suggestions: an AI prompt (words), or an answer given at once (core 1.4.0).
  const pageChips = (CHIPS[path] || []).map(([label, what]) => (typeof what === "string" ? { label, prompt: what }
    : { label, ...what, ...(what.answer ? { answer: own(what.answer) } : {}) }));
  for (const item of [startPill, secondPill, aiExplain, appsPill, keyPill, ...pageChips]) LABELS.add(plainLabel(item.label));

  window.Pilot.mount({
    appName: "MTRX Horizyn",
    name: "Pilot",
    // Core 1.2.0: the welcome is this site's own (docs/PILOT.md). The Mac app
    // keeps the design's.
    tagline: "Help with ideas and MTRX apps",
    // Core 1.4.0: the pills that can work with no AI key do. "Help with my
    // idea", "What is Orbyt?" and "What apps are coming?" are answered at
    // once from the site's own facts.
    // 1.27.0: `match` words for typed questions (MATCH above). On Orbyt,
    // where "What is Orbyt?" is the page itself (and "Which form is for
    // me?" answers "orbyt"), the second pill is the page's first question
    // before sending, "Who owns my idea?".
    // 1.28.0: "Explain this page" works with no key (explainPill above).
    get welcomePills() { return [startPill, secondPill, explainPill(), appsPill, keyPill]; },
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
    privacyUrl: addressOf("/privacy"),
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
    // 1.28.0: on the home page the app cards (RankUp's is on a phone's first
    // screen) and the Projects tile; on Genesis each day of the spark week
    // with its letter; on Orbyt the three steps and the section headings.
    avoid: [".g-track", "#g-address", ".g-head .g-address", ".g-item-row", ".g-group-head", ".g-hidden-steps > summary",
      ".g-add-form", ".g-moves", "#g-week", ".g-week .g-day", ".v-path-go", ".page .app-card", ".fact-projects",
      ".v-how", ".v-h", ".v-kicker", ".v-catalog-head"],
    screen,
    // A suggestion is an AI prompt (words), or an answer given at once (core 1.4.0).
    chips: () => pageChips,
    taskPrompt: () => TASKS[path] || "Help me get started on this page.",
    facts: {
      ai: d.ai === "on", freeDay: Number(d.freeDay) || 0, freeHour: Number(d.freeHour) || 0,
      pro: d.pro === "on", proPrice: d.proPrice || "", early: d.early === "on", creators: d.makers === "on",
      review, reviewPrice: review ? d.reviewPrice || "" : "", reviewDays, reviewAi,
    },
  });
})();
