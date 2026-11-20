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

  const CHIPS = {
    "/": [["Which app fits me?", "Which MTRX Horizyn app would fit me? Ask me one or two questions first."],
      ["What's ready today?", "Which MTRX Horizyn apps and features can I use today, and which are still in development?"],
      ["How do I start an idea?", "I have an idea. How can Genesis help me start it?"]],
    "/genesis": [["Show my projects", "Show my projects."], ["What's my next step?", "What's my next step?"],
      ["Help with today's spark", "Help me think of an answer for today's spark."]],
    "/orbyt": [["Which form is for me?", "Which Orbyt form should I use?"], ["What happens after I send?", "What happens after I send a message in Orbyt?"],
      ["Bring a Genesis idea", "How do I pitch a project from Genesis in Orbyt?"]],
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
    tagline: "Your AI copilot. Powered by you.",
    storagePrefix: "mtrx-pilot",
    pack: d.pack || "",
    // Exactly the hosts the site's security policy lets a browser reach for
    // an OpenAI-compatible API (main.PILOT_COMPATIBLE_HOSTS and the visitor's
    // own computer).
    compatibleHosts: (d.hosts || "").split(/\s+/).filter(Boolean),
    privacyUrl: "/privacy",
    // Visitors may be young: said once, plainly, with no nagging.
    keyNote: "Pilot uses your own AI key. AI keys are for grown-ups (the AI companies require 18+).",
    audienceNote: "Visitors to this site may be young people starting their first idea. Keep answers safe, kind and simple. For money, contracts, sign-ups or anything needing an adult, suggest asking a trusted adult.",
    // The MTRX site has no child accounts; RankUp's config says when a view is a child's.
    kidView: () => false,
    // On the Genesis project screen the robot keeps clear of the stage bar
    // and the web address (it moves to a free corner, or tucks away).
    avoid: [".g-track", "#g-address", ".g-head .g-address"],
    screen,
    chips: () => (CHIPS[path] || []).map(([label, prompt]) => ({ label, prompt })),
    taskPrompt: () => TASKS[path] || "Help me get started on this page.",
    facts: {
      ai: d.ai === "on", freeDay: Number(d.freeDay) || 0, freeHour: Number(d.freeHour) || 0,
      pro: d.pro === "on", proPrice: d.proPrice || "", early: d.early === "on", creators: d.makers === "on",
    },
  });
})();
