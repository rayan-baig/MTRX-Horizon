// Pilot's knowledge pack for the MTRX Horizyn site, and its Genesis tools.
// Fetched only when someone first opens Pilot. Written from the real site,
// its templates and docs: if something here stops being true, change it
// here (tests/test_pilot.py checks the main facts are present).
//
// Live facts (whether Ask Genesis and Genesis Pro are on, the free limits,
// Pro's price text) come from the server's settings through the config
// (static/js/pilot-mtrx.js), so the pack never states a number the site
// doesn't use.
(function () {
  "use strict";

  const KNOWLEDGE = `## MTRX Horizyn
MTRX Horizyn is a software company, the parent company of three apps: RankUp, CyberLogix AI and OmniArmor.ai. Its website is mtrxhorizyn.com; each app lives on its own subdomain (rankup., cyberlogix., omniarmor.mtrxhorizyn.com). The site also has Genesis (turn an idea into a plan, free) and Orbyt (the official place to work with MTRX Horizyn). Every number the site shows is real or absent; nothing is made up.
Status: until launch, all three apps are "in development" and the site says so everywhere. An app gets an "Open" button only on the day it opens. Never say an app is open unless the page shows an Open button for it.

## RankUp: a chores game for families
- A parent sets a chore; the child does it and snaps a photo as proof.
- A smart photo check gives its opinion, but the parent always makes the call.
- Approved chores earn points, levels and arcade tokens across 15 game worlds and 24 games.
- Free for one child. Standard and Elite plans add more.

## CyberLogix AI: fridge and freezer alarms that call you
- Wireless sensors watch freezers, fridges, vaccine fridges, server racks and more.
- When something goes wrong it sends a text, then makes a phone call, then tries the next person, until someone answers.
- Every reading is kept in a sealed record, ready for an insurance claim or an inspector.
- Built for 12 industries, from restaurants to data centers. The sensors read the temperature on their own, apart from the fridge's controls.

## OmniArmor.ai: safety checklists that count the deadlines
- 500 compliance checks across 50 industries, each naming the rule it comes from.
- Counts the days by itself and emails the team before anything is due.
- Keeps a record an inspector, auditor or insurer can be shown.
- Includes the Future Owner Academy, a business course for the next generation.

## Kitchen Safety Bundle (page: /bundle)
CyberLogix AI's alarms and OmniArmor.ai's inspection checklists together. Every day CyberLogix AI hands OmniArmor.ai the day's real readings, so the temperature checks fill themselves in. For restaurants, cafés, pharmacies and school kitchens. Price: the bundle adds $29 a month per location to CyberLogix AI, and OmniArmor.ai Pro for that location is included. The free trial starts in CyberLogix AI once it is open; until then the page offers a way to ask in Orbyt.

## Partners (page: /partners)
For fridge and refrigeration repair companies, food safety consultants and kitchen equipment sellers who recommend CyberLogix AI to shops they already visit.
- Apply in the Orbyt partner form; MTRX Horizyn replies by email. Once agreed, the partner gets a partner key for a partner portal.
- The portal shows the businesses they look after: units, where they are, when each last reported, battery and signal, and open alerts. Never staff, phone numbers or invoices, never a business that isn't theirs, and they can't change anything.
- Partners earn a share of what their customers actually paid in the last 30 days (a free trial, unpaid or cancelled invoice earns nothing). The share is agreed when they join and paid by bank transfer each month.

## Genesis (page: /genesis)
Free, with no account. Projects stay in the visitor's own browser (local storage) and are never sent to MTRX Horizyn. Only Ask Genesis sends anything, and only when its button is pressed.
- Start a project with three lines: a name, a one-line pitch and who it's for, plus an optional web address idea. "Try an example" fills the form with one to change.
- Four stages: Spark, Plan, Build, Launch, with a 19-step launch checklist in plain words. Tick steps in any order; move to the next stage when it feels right. Steps that don't fit can be hidden (and brought back), and a project can have up to 30 steps of its own.
- "Your next step" at the top of a project shows one clear thing to do now, with a Done button.
- Notes save themselves. "Make an idea card" draws a picture of the project to save or share (never the notes or ticks). "Pitch this in Orbyt" opens the Orbyt pitch form with the project ready.
- Today's spark: a new idea prompt every day, answered in one line (up to 140 characters). A streak counts days in a row; every streak has one freeze that covers a missed day, and it comes back after 7 more sparks. It never nags. "Turn it into a project" starts a project from the answer.
- Download saves every project as a file; Import loads it on another device. Clearing the browser's data deletes projects that weren't downloaded.
- Ask Genesis: short AI help with the open project. Buttons: Sharpen my pitch, Who might use this?, Simplest first version, Name ideas, What could go wrong?, What should I do next?, or a short question. It sends only the project's name, pitch, who it's for and stage (never the notes).
- With the visitor's own AI key set in Pilot, Ask Genesis runs from their browser on their key, with no daily limit, and nothing goes to MTRX Horizyn.

## Orbyt (page: /orbyt)
The official place to work with MTRX Horizyn. Four paths: Pitch an idea (a business or app idea, or bring one from Genesis), Partner with us (resell, integrate or build on, refer customers, or recommend CyberLogix AI), Investors (MTRX Horizyn is not selling shares or asking for money; nothing there is an investment), and Buy the company or an app (this only starts a conversation; no shares, apps or companies are bought or sold there).
- It takes about 2 minutes, a real person reads every message, and MTRX Horizyn replies by email within 7 days, even if the answer is no. Pitching, partnering and business enquiries are always free.
- Messages are kept only to reply, for up to 365 days. MTRX Horizyn won't publish or pass on what is sent. It may already be working on something similar; if so, it says so in its reply. Under-13s should ask a parent or guardian to send it.

## Privacy and terms (pages: /privacy, /terms)
No cookies for visitors, no tracking, no analytics, no ads, and nothing loaded from other companies' servers: every picture, font and script comes from this site under a strict security policy. Like every website, the server notes each request it answers. The privacy page has the details, including Genesis Pro and the forms.

## Brand (page: /brand)
The MTRX Horizyn name, logos and colours, for anyone writing about the company.

## Pilot (this assistant)
Pilot runs on the visitor's own AI key from Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible API (including a model on their own computer). The key is kept only in their browser (for this tab, or on this device if they choose "remember") and goes only to that provider; MTRX Horizyn never sees it or pays for it. The provider bills the key. AI keys are for grown-ups (the AI companies require 18+). Pilot can optionally make pictures or videos with a separate image or video key. On the Genesis page Pilot can show projects and the next step, and (after the visitor presses Allow) add a step, start a project or fill in today's spark. It never deletes, pays or messages anyone. Its settings are behind the gear button.`;

  // Genuine strengths, from the real features. No rival is named and there
  // are no made-up numbers.
  const STRENGTHS = [
    "Genesis is free, needs no account and no sign-up, and keeps every project in the visitor's own browser: ideas are never sent to MTRX Horizyn.",
    "Genesis's checklist is 19 plain-word steps from Spark to Launch, and it bends to each idea: hide steps that don't fit, add up to 30 of your own.",
    "Today's spark builds a habit without pressure: a streak with a freeze for a missed day, and no reminders, countdowns or nagging.",
    "Ask Genesis is made for first-time founders, many of them young: plain words, short answers, no personal details asked for, and unsafe requests refused. It's free each day, or unlimited with your own AI key.",
    "Your projects move with you as a file you own (Download and Import); nothing locks you in.",
    "The site sets no cookies for visitors, has no tracking, analytics or ads, and loads nothing from other companies.",
    "Orbyt promises a reply from a real person within 7 days, even when the answer is no, and pitching there is always free.",
    "CyberLogix AI keeps calling, a text then a phone call then the next person, until someone answers, and its sensors work apart from the fridge's own controls.",
    "OmniArmor.ai names the rule behind every check and counts the deadlines for you.",
    "With the Kitchen Safety Bundle the daily temperature checks fill themselves in from real readings.",
    "In RankUp a parent always makes the final call on a chore's photo proof, and it's free for one child.",
    "Pilot works with the AI provider you already use, on your own key, and asks before it changes anything.",
    "The site is honest about where things stand: the apps say \"in development\" until the day they open.",
  ];

  function liveFacts() {
    const f = (window.Pilot && window.Pilot.config && window.Pilot.config.facts) || {};
    const lines = [];
    lines.push(f.ai
      ? `Ask Genesis's free help is on: ${f.freeDay} answers a day per visitor (${f.freeHour} an hour), shared fairly. With their own Pilot key there is no limit.`
      : "Ask Genesis's free help isn't switched on right now; visitors can still use it with their own AI key set in Pilot.");
    lines.push(f.pro
      ? `Genesis Pro is on. It's a subscription a grown-up buys through Stripe (from ${f.proPrice} a month; the exact price shows before paying; cancel any time with Manage subscription). It gives up to 100 Ask Genesis answers a day of its own, longer answers, a four-week plan, website words and price ideas, a private cloud backup and a tidy plan download. Genesis stays free without it.`
      : "Genesis Pro isn't offered right now: everything in Genesis is free.");
    lines.push(f.review && f.reviewAi
      ? `Orbyt Pitch Review is on: an optional extra after sending a pitch in Orbyt, one payment of ${f.reviewPrice} (not a subscription), bought by a grown-up (18+) through Stripe. It is an AI-written review of the idea, sent within about an hour: what's strong, what to fix, the next 3 steps, and whether it might fit Orbyt. To write it, the idea's words (never a name or email) go to an AI service, and the grown-up agrees to that at checkout. Full refund if it isn't there within ${f.reviewDays} days or the idea can't be reviewed. Pitching stays free and every pitch gets a reply either way. Never push it, and never say a person writes it.`
      : f.review
      ? `Orbyt Pitch Review is on: an optional extra after sending a pitch in Orbyt, one payment of ${f.reviewPrice} (not a subscription), bought by a grown-up (18+) through Stripe. A real person at MTRX Horizyn emails a personal review of the idea within ${f.reviewDays} days: what's strong, what to fix, the next 3 steps, and whether it might fit Orbyt. Full refund if it's late or the idea can't be reviewed. Pitching stays free and every pitch gets a reply either way. Never push it.`
      : "Nothing in Orbyt costs anything: pitching, partnering and business enquiries are free.");
    if (f.early) lines.push("The early access list is open (page: /early-access): people can join to hear first about the apps; founding members get a launch discount.");
    if (f.creators) lines.push("The creator program is open (page: /creators): creators make videos about the apps and earn a share of what their viewers pay.");
    return lines.join("\n");
  }

  // ---------------------------------------------------------------- Genesis tools
  // Only on the Genesis page, where its own code (window.GenesisBridge) is
  // there to do the work through the page's own rules. Read-only tools run at
  // once; the others run only after the visitor presses Allow.

  const G = () => window.GenesisBridge;
  const onGenesis = () => Boolean(G());
  const STAGE_NAMES = { spark: "Spark", plan: "Plan", build: "Build", launch: "Launch" };

  function pick(args, ctx) {
    if (args.project) return args.project;
    if (ctx && ctx.lastProject) return ctx.lastProject;
    return "";
  }

  const TOOLS = [
    {
      name: "show_my_projects", kind: "read", available: onGenesis,
      description: "List the visitor's Genesis projects in this browser: name, pitch, who it's for, stage, progress and next step.",
      parameters: { type: "object", properties: {} },
      run: () => {
        const list = G().list();
        return list.length ? { projects: list.slice(0, 25) } : "There are no projects yet.";
      },
    },
    {
      name: "whats_my_next_step", kind: "read", available: onGenesis,
      description: "The next step for a Genesis project (the one open on screen, or the most recent, unless a name is given).",
      parameters: { type: "object", properties: { project: { type: "string", maxLength: 60, description: "The project's name, if not the current one." } } },
      run: (args) => G().next(args.project || ""),
    },
    {
      name: "add_step", kind: "change", available: onGenesis,
      description: "Add a step of the visitor's own to a stage of a Genesis project's checklist.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", maxLength: 60, description: "The project's name. Leave out for the project open now, or the one just started." },
          stage: { type: "string", enum: ["spark", "plan", "build", "launch"], description: "Which stage the step belongs to." },
          step: { type: "string", maxLength: 120, description: "The step, in a few plain words." },
        },
        required: ["stage", "step"],
      },
      describe: (args, info) => {
        const fresh = !args.project && info && Array.isArray(info.before) && info.before.includes("start_project");
        const found = fresh ? null : G().find(args.project || "");
        const where = fresh ? "the new project" : found ? found.name : args.project || "your project";
        return `add the step “${args.step}” to ${where} (${STAGE_NAMES[args.stage]})`;
      },
      run: (args, ctx) => G().addStep(pick(args, ctx), args.stage, args.step),
    },
    {
      name: "start_project", kind: "change", available: onGenesis,
      description: "Start a new Genesis project from an idea, with its name, one-line pitch and who it's for.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 60, description: "A short name." },
          pitch: { type: "string", maxLength: 140, description: "What it does, in one line." },
          audience: { type: "string", maxLength: 120, description: "Who it's for." },
        },
        required: ["name", "pitch", "audience"],
      },
      describe: (args) => `start a new project “${args.name}”: ${args.pitch} (for ${args.audience})`,
      run: (args, ctx) => {
        const r = G().startProject(args);
        if (r && r.ok && ctx) ctx.lastProject = r.id;
        return r;
      },
    },
    {
      name: "fill_spark", kind: "change", available: onGenesis,
      description: "Save the visitor's answer to today's spark (one line, up to 140 characters). Today's prompt is in the screen facts.",
      parameters: { type: "object", properties: { answer: { type: "string", maxLength: 140, description: "The one-line answer." } }, required: ["answer"] },
      describe: (args) => `save “${args.answer}” as today's spark answer`,
      run: (args) => G().fillSpark(args.answer),
    },
  ];

  window.PilotPack = {
    knowledge: KNOWLEDGE,
    get strengths() { return STRENGTHS; },
    tools: () => TOOLS,
    facts: () => {
      const lines = [liveFacts()];
      if (onGenesis()) {
        const s = G().spark();
        lines.push(`Today's spark prompt: “${s.prompt}”. ${s.answer ? "The visitor has answered it today." : "Not answered yet today."}`);
      }
      return lines.join("\n");
    },
  };
  if (typeof module === "object" && module.exports) module.exports = window.PilotPack;
})();
