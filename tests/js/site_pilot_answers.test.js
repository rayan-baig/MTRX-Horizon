// The MTRX site's own Pilot answers (static/js/pilot-mtrx.js, 1.22.0): the
// suggestions answered at once, with no AI key and nothing sent.
// `node --test tests/js/site_pilot_answers.test.js`; tests/test_site.py runs it too.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "..", "static", "js", "pilot-mtrx.js"), "utf8");
const APPS = JSON.stringify([
  { key: "rankup", name: "RankUp", line: "A chores game for families.", open: false, url: "" },
  { key: "cyberlogix", name: "CyberLogix AI", line: "Fridge alarms that call you.", open: false, url: "" },
  { key: "omniarmor", name: "OmniArmor.ai", line: "Compliance checklists.", open: false, url: "" },
]);

// The config as a page would mount it: its pathname, the data-* facts, and
// (on Genesis) the page's own bridge.
function mount(pathname, data, bridge) {
  let given = null;
  const window = { Pilot: { mount: (c) => { given = c; } }, location: { pathname } };
  if (bridge) window.GenesisBridge = bridge;
  vm.runInNewContext(source, { window, document: { getElementById: () => ({ dataset: data }), title: "" } });
  return given;
}
const chip = (config, label) => config.chips().find((c) => c.label === label);
const answer = (config, label) => {
  const c = chip(config, label);
  assert.ok(c, `no "${label}" suggestion`);
  assert.equal(c.prompt, undefined, `"${label}" is still an AI prompt`);
  return typeof c.answer === "function" ? c.answer({}) : c.answer;
};

test("home: \"What's ready today?\" says what works today, then what's coming, with links", () => {
  const text = answer(mount("/", { apps: APPS, early: "on" }), "What's ready today?");
  assert.match(text, /^\*\*Ready today:\*\* \[Genesis\]\(\/genesis\) \(free\), \[Orbyt\]\(\/orbyt\), and Pilot\./);
  assert.match(text, /\*\*Coming:\*\* \[RankUp\]\(\/#learn-rankup\), \[CyberLogix AI\]\(\/#learn-cyberlogix\), \[OmniArmor\.ai\]\(\/#learn-omniarmor\)\./);
  assert.match(text, /\[Get early access\]\(\/#early-access\)/);
  // The old answer led with "None is open yet", as if nothing worked today.
  assert.doesNotMatch(text, /None is open yet/);
  // Without early access, Orbyt instead; an open app moves up to "Ready today".
  assert.match(answer(mount("/", { apps: APPS, early: "off" }), "What's ready today?"), /\[Write to us in Orbyt\]\(\/orbyt\)/);
  const one = JSON.parse(APPS);
  one[1] = { ...one[1], open: true, url: "https://cyberlogix.example" };
  const opened = answer(mount("/", { apps: JSON.stringify(one), early: "on" }), "What's ready today?");
  assert.match(opened, /\[Orbyt\]\(\/orbyt\), \[CyberLogix AI\]\(https:\/\/cyberlogix\.example\), and Pilot\./);
  assert.match(opened, /\*\*Coming:\*\* \[RankUp\]\(\/#learn-rankup\), \[OmniArmor\.ai\]\(\/#learn-omniarmor\)\./);
});

test("home: \"Which app fits me?\" is a three-way chooser, answered at once", () => {
  const text = answer(mount("/", { apps: APPS, early: "on" }), "Which app fits me?");
  const rows = text.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(rows.length, 3);
  assert.match(rows[0], /For a family.*\[RankUp\]\(\/#learn-rankup\) \(in development\)/);
  assert.match(rows[1], /fridges or freezers.*\[CyberLogix AI\]\(\/#learn-cyberlogix\)/);
  assert.match(rows[2], /safety checks.*\[OmniArmor\.ai\]\(\/#learn-omniarmor\)/);
  assert.match(text, /\[Genesis\]\(\/genesis\)/);
  // No apps known: still an answer, never an empty one.
  assert.match(answer(mount("/", { apps: "[]" }), "Which app fits me?"), /\[home page\]\(\/\)/);
});

test("Orbyt: \"Which form is for me?\" jumps to each form, and never says \"Open Orbyt\" on Orbyt", () => {
  const orbyt = mount("/orbyt", { apps: APPS, early: "on" });
  const text = answer(orbyt, "Which form is for me?");
  for (const link of ["/orbyt#pitch", "/early-access", "/orbyt#partner", "/orbyt#invest", "/orbyt#buy"]) {
    assert.ok(text.includes(`](${link})`), link);
  }
  assert.doesNotMatch(text, /Open Orbyt/);
  assert.doesNotMatch(answer(mount("/orbyt", { apps: APPS, early: "off" }), "Which form is for me?"), /early-access/);
  // "What is Orbyt?" (a welcome pill elsewhere) keeps its "Open Orbyt"; on Orbyt
  // (1.27.0) that pill is "Who owns my idea?", and typed "What is Orbyt?" is
  // answered by "Which form is for me?", which starts with what Orbyt is.
  // 1.28.0: every answer is a function (typed words checked first), pressed here.
  const pill = (c, label) => c.welcomePills.find((p) => p.label === label);
  const press = (item) => item.answer({ label: item.label });
  assert.match(press(pill(mount("/", { apps: APPS }), "What is Orbyt?")), /\[Open Orbyt\]\(\/orbyt\)$/);
  assert.equal(pill(orbyt, "What is Orbyt?"), undefined);
  assert.match(press(pill(orbyt, "Who owns my idea?")), /^\*\*Who owns my idea\?\*\* You do\./);
  const asked = press(chip(orbyt, "Which form is for me?"));
  assert.match(asked, /^\*\*Orbyt\*\* is where you work with MTRX Horizyn\. Pick the line/);
  assert.doesNotMatch(asked, /Open Orbyt/);
});

test("Genesis: \"Show my projects\" and \"What's my next step?\" come from this browser, with no key", () => {
  const projects = [
    { id: "p-1", name: "Paw Board", pitch: "Lost pets", for: "Neighbours", stage: "Spark", done: "1 of 19 steps (5%)", next: "Say the problem it solves in one sentence" },
    { id: "p-2", name: "**Snack** [Swap](//x)", pitch: "Snacks", for: "Classmates", stage: "Plan", done: "6 of 19 steps (32%)", next: "Who is it for?" },
  ];
  const bridge = { mine: () => projects, nextOf: () => projects[0] };
  const g = mount("/genesis", {}, bridge);
  const list = answer(g, "Show my projects");
  assert.match(list, /^You have 2 projects in this browser/);
  assert.match(list, /- \*\*Paw Board\*\* \(Spark, 1 of 19 steps done\)\. Next: Say the problem it solves in one sentence\. \[Open Paw Board\]\(\/genesis#p\/p-1\)/);
  // A project's own words can't add markdown or links of their own.
  assert.match(list, /- \*\*Snack Swap\(\/\/x\)\*\* \(Plan, 6 of 19 steps done\)\. Next: Who is it for\? \[Open/);
  assert.match(list, /nothing was sent anywhere/);
  const next = answer(g, "What's my next step?");
  assert.match(next, /For \*\*Paw Board\*\* \(Spark, 1 of 19 steps done\), your next step is:\n\n\*\*Say the problem it solves in one sentence\*\*/);
  assert.match(next, /\[Open Paw Board\]\(\/genesis#p\/p-1\) to tick it off\./);
  // No projects yet: where to start.
  const none = mount("/genesis", {}, { mine: () => [], nextOf: () => null });
  assert.match(answer(none, "Show my projects"), /no projects in this browser yet.*\[Start my idea\]\(\/genesis#new\)/);
  assert.match(answer(none, "What's my next step?"), /\[Start my idea\]\(\/genesis#new\)/);
  // Every step done.
  const all = mount("/genesis", {}, { mine: () => projects, nextOf: () => ({ ...projects[0], next: "Every step is done" }) });
  assert.match(answer(all, "What's my next step?"), /Every step of \*\*Paw Board\*\* is done/);
  // An odd id never becomes a link.
  const odd = mount("/genesis", {}, { mine: () => [{ ...projects[0], id: "../x y" }], nextOf: () => null });
  assert.doesNotMatch(answer(odd, "Show my projects"), /\[Open/);
});

test("genesis: \"Help with today's spark\" gives a tip and a jump to the spark box, with no key (1.25.0)", () => {
  const today = { prompt: "Design a way to help local artists sell their work.", answer: "", streak: 0, limit: 140 };
  const g = mount("/genesis", {}, { mine: () => [], nextOf: () => null, spark: () => today });
  const text = answer(g, "Help with today's spark");
  assert.match(text, /^Today's spark: \*\*Design a way to help local artists sell their work\.\*\*/);
  assert.match(text, /Write it in one line/);
  assert.match(text, /\[Write my spark\]\(\/genesis#spark\)/);
  assert.match(text, /nothing was sent anywhere/);
  // No example given (an older page): no example line.
  assert.doesNotMatch(text, /one line could be/);
  // 1.27.0: one example line for today's very spark, from the page's own list.
  const store = fs.readFileSync(path.join(__dirname, "..", "..", "static", "js", "genesis-store.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(store, sandbox);
  const S = sandbox.window.GenesisStore;
  assert.equal(S.SPARK_EXAMPLES.length, S.PROMPTS.length, "one example for every spark");
  for (const e of S.SPARK_EXAMPLES) assert.ok(e.length > 20 && e.length <= S.DAILY_LIMIT && /[.!]$/.test(e), e);
  const p = S.promptFor("2026-11-22");
  assert.equal(p.text, "Design a way to help local artists sell their work.");
  const withExample = answer(mount("/genesis", {}, { mine: () => [], nextOf: () => null, spark: () => ({ ...today, example: p.example }) }), "Help with today's spark");
  assert.match(withExample, /For today's spark, one line could be: “An app that lets local artists show and sell their work in nearby cafés\.”\n\n\[Write my spark\]/);
  // Answered already: says so, and offers to change it.
  const done = mount("/genesis", {}, { mine: () => [], nextOf: () => null, spark: () => ({ ...today, answer: "Market *stalls* [x](y)" }) });
  const again = answer(done, "Help with today's spark");
  assert.match(again, /You've answered it already: “Market stalls x\(y\)”/);
  assert.match(again, /\[Open your spark\]\(\/genesis#spark\)/);
  // No page bridge (another page): still an answer with the way there.
  assert.match(answer(mount("/genesis", {}), "Help with today's spark"), /\[Genesis page\]\(\/genesis#spark\)/);
});

// ---------------------------------------------------------------- typed questions with no key (1.27.0)
// What a visitor types, matched in the browser with the core's own matchTyped
// against this site's pills and suggestions, as the panel does it.
const panelSource = fs.readFileSync(path.join(__dirname, "..", "..", "static", "pilot", "pilot-panel.js"), "utf8");
function panel() {
  const sandbox = { window: {}, document: {}, URL };
  vm.runInNewContext(panelSource, sandbox);
  return sandbox.window.PilotPanel;
}
// The label of the item a typed question gets on a page, or null; and what
// that answer says (ctx.label is the typed words, as the panel passes them).
function typed(pathname, data, bridge) {
  const P = panel();
  const config = mount(pathname, data, bridge);
  const base = `https://mtrx.example${pathname}`;
  const items = P.ownPills(config.welcomePills, base).concat(P.cleanChips(config.chips(), base));
  const pick = (words) => { const m = P.matchTyped(words, items); return m ? m.label : null; };
  const say = (words) => {
    const m = P.matchTyped(words, items);
    assert.ok(m, `"${words}" matched nothing`);
    return typeof m.answer === "function" ? m.answer({ label: words }) : m.answer || `[${m.label}](${m.link})`;
  };
  return { pick, say };
}

test("home: typed questions get the right answer with no key (match words)", () => {
  const { pick, say } = typed("/", { apps: APPS, early: "on", pro: "on", proPrice: "$4.99" });
  // 1.28.0: Genesis's questions go to "Is Genesis free?" (the third suggestion,
  // in place of "How do I start an idea?", which "Help with my idea" answers).
  assert.equal(pick("What is Genesis?"), "Is Genesis free?");
  assert.match(say("what is genesis"), /^\*\*Genesis\*\* turns an idea into a plan/);
  assert.equal(pick("Is it free?"), "Is Genesis free?");
  assert.match(say("Is it free?"), /^\*\*Free:\*\* Genesis, sending a pitch in Orbyt, and answers like this one from Pilot\.\n\n\*\*Optional paid extras:\*\* Genesis Pro \(\$4\.99 a month\)\./);
  assert.equal(pick("How much does it cost?"), "Is Genesis free?");
  assert.equal(pick("When does RankUp open?"), "What apps are coming?");
  assert.match(say("When does RankUp open?"), /^\*\*RankUp\*\* is still in development\.\n\n/);
  assert.match(say("when will omniarmor launch"), /^\*\*OmniArmor\.ai\*\* is still in development\./);
  assert.equal(pick("What is Orbyt?"), "What is Orbyt?");
  assert.equal(pick("which app is for my family"), "Which app fits me?");
  assert.equal(pick("I run a restaurant kitchen"), "Which app fits me?");
  assert.equal(pick("how do I start"), "Help with my idea");
  assert.equal(pick("what's ready"), "What's ready today?");
  // Pressed (not typed), "What apps are coming?" has no app's first line.
  assert.doesNotMatch(say("What apps are coming?"), /still in development\.\n\n/);
  for (const q of ["Write me a poem about the sea", "Tell me a joke", "What's the weather?", "How do I reset my password?", "ok"]) {
    assert.equal(pick(q), null, q);
  }
  // The free line says only what's on: no Genesis Pro or Pitch Review while they're off.
  const plain = typed("/", { apps: APPS, early: "on" }).say("Is it free?");
  assert.doesNotMatch(plain, /Genesis Pro|Pitch Review/);
  assert.match(typed("/", { apps: APPS, review: "on", reviewPrice: "$19" }).say("Is it free?"), /a Pitch Review \(\$19, once\) after sending a pitch/);
});

// ---------------------------------------------------------------- 1.28.0 (round 11): more built-in answers

test("home: Genesis's price, privacy, an idea, who made this, Pilot and hello, typed with no key", () => {
  const { pick, say } = typed("/", { apps: APPS, early: "on", pro: "on", proPrice: "$4.99" });
  assert.match(say("is genesis free"), /^\*\*Yes, Genesis is free:\*\* no account, nothing to pay/);
  assert.match(say("Is Genesis free?"), /Genesis Pro \(\$4\.99 a month\) is an optional extra/);
  for (const q of ["how much is genesis pro", "What is Genesis Pro?", "how much does genesis pro cost"]) {
    assert.match(say(q), /^\*\*Genesis Pro\*\* is an optional extra for people who ask Genesis for help a lot.*It's \$4\.99 a month, paid by a grown-up/, q);
  }
  // Pro switched off: never named, and Genesis is free.
  const off = typed("/", { apps: APPS, early: "on" });
  assert.match(off.say("how much is genesis pro"), /^\*\*Genesis is free\*\*, and there's nothing to buy/);
  assert.doesNotMatch(off.say("how much is genesis pro"), /\$|Pro is/);
  for (const q of ["is my data safe", "Is my data safe?", "is it private", "do you track me"]) {
    assert.match(say(q), /^\*\*Yes, MTRX Horizyn keeps very little:\*\*/, q);
  }
  assert.match(say("is my data safe"), /\[Read the privacy page\]\(\/privacy\)/);
  for (const q of ["i have an idea", "I have an idea for a game", "i have an idea for an app", "I've got an idea"]) {
    assert.equal(pick(q), "Help with my idea", q);
    assert.match(say(q), /^Great, let's turn it into a plan! \*\*Genesis\*\* does that, free.*\[Start my idea\]\(\/genesis#new\)/s, q);
  }
  for (const q of ["who made this", "Who made this website?", "who built this site"]) {
    assert.match(say(q), /^\*\*MTRX Horizyn\*\* made this site: a small independent software company/, q);
  }
  // Only the company: nothing about the person who runs it.
  assert.doesNotMatch(say("who made this"), /\b(he|she|his|her|years? old|founder is)\b/i);
  for (const q of ["what is pilot", "What's Pilot?", "who is pilot"]) assert.match(say(q), /^I'm \*\*Pilot\*\*, the helper in the corner/, q);
  for (const q of ["hi", "hello", "Hey!", "hi there", "Hello Pilot"]) {
    assert.match(say(q), /^Hi! I'm \*\*Pilot\*\*\. Even without an AI key I can help here: try \*\*Is Genesis free\?\*\*/, q);
  }
  // Pressed, each suggestion keeps its own answer (the topics are for typed words).
  const config = mount("/", { apps: APPS, early: "on", pro: "on", proPrice: "$4.99" });
  assert.match(chip(config, "Is Genesis free?").answer({ label: "Is Genesis free?" }), /^\*\*Yes, Genesis is free:\*\*/);
  const start = config.welcomePills.find((p) => p.label === "Help with my idea");
  assert.equal(start.link, undefined, "an answer, not a link, so typed ideas get a reply");
  assert.match(start.answer({ label: "Help with my idea" }), /^\*\*Genesis\*\* turns an idea into a plan.*\[Start my idea\]\(\/genesis#new\)/s);
});

test("genesis: how to start, is my idea saved, Genesis Pro, where my projects are and an example idea", () => {
  const projects = [{ id: "p-1", name: "Paw Board", stage: "Spark", done: "1 of 19 steps (5%)", next: "Say the problem it solves in one sentence" }];
  const bridge = { mine: () => projects, nextOf: () => projects[0], spark: () => null, screen: () => ({ view: "the list of projects" }) };
  const { pick, say } = typed("/genesis", { apps: APPS, pro: "on", proPrice: "$4.99" }, bridge);
  for (const q of ["how do I start", "How do I begin?"]) assert.match(say(q), /^\*\*Genesis\*\* turns an idea into a plan/, q);
  for (const q of ["is my idea saved", "Is my idea saved?", "will I lose my projects", "do you keep my ideas"]) {
    assert.match(say(q), /^\*\*Your projects are saved in this browser\*\*.*\*\*Download\*\* under your projects \(Genesis Pro adds a private cloud backup\)/s, q);
  }
  for (const q of ["what is genesis pro", "How much is Genesis Pro?"]) assert.match(say(q), /^\*\*Genesis Pro\*\* is an optional extra/, q);
  for (const q of ["where are my projects", "Where are my saved projects", "show my projects"]) {
    assert.equal(pick(q), "Show my projects", q);
    assert.match(say(q), /^You have 1 project in this browser/, q);
  }
  // "Give me an idea": one of Genesis's own examples, and "Try an example".
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "..", "static", "js", "genesis-store.js"), "utf8"), sandbox);
  const S = sandbox.window.GenesisStore;
  let given = null;
  const window = { Pilot: { mount: (c) => { given = c; } }, location: { pathname: "/genesis" }, GenesisBridge: bridge, GenesisStore: S };
  vm.runInNewContext(source, { window, document: { getElementById: () => ({ dataset: { apps: APPS } }), title: "" } });
  const P = panel();
  const items = P.ownPills(given.welcomePills, "https://mtrx.example/genesis").concat(P.cleanChips(given.chips(), "https://mtrx.example/genesis"));
  for (const q of ["give me an idea", "Give me an idea!", "can you suggest an idea"]) {
    const m = P.matchTyped(q, items);
    assert.ok(m, q);
    const text = m.answer({ label: q });
    const named = S.EXAMPLES.find((e) => text.includes(`**${e.name}**`));
    assert.ok(named, `${q}: ${text}`);
    // 1.29.0: the link fills the form with that very example (#example/N).
    const link = text.match(/\[Try this example\]\(\/genesis#example\/(\d+)\)/);
    assert.ok(link, `${q}: ${text}`);
    assert.equal(S.EXAMPLES[Number(link[1])].name, named.name, q);
  }
});

test("Orbyt: the review's time and writer, age rules, \"Can you build my app?\" and the price, typed with no key", () => {
  const ai = typed("/orbyt", { apps: APPS, early: "on", review: "on", reviewPrice: "$19", reviewDays: "5", reviewMode: "ai" });
  for (const q of ["how long does the review take", "How long does a Pitch Review take?", "when will I get my review"]) {
    assert.match(ai.say(q), /^\*\*Usually within an hour\.\*\* It's promised within 5 days of paying/, q);
  }
  for (const q of ["is the review written by a person", "Is the Pitch Review written by a real person?"]) {
    assert.match(ai.say(q), /^\*\*No: a Pitch Review is written by an AI service\*\*.*a person at MTRX Horizyn writes it instead/s, q);
  }
  assert.match(ai.say("who writes the review"), /^\*\*An AI service writes your Pitch Review\*\*/);
  const person = typed("/orbyt", { apps: APPS, review: "on", reviewPrice: "$19", reviewDays: "5", reviewMode: "person" });
  assert.match(person.say("is the review written by a person"), /^\*\*Yes: a real person at MTRX Horizyn writes your Pitch Review\*\*/);
  assert.match(person.say("how long does the review take"), /^\*\*Within 5 days of paying\.\*\*/);
  // Age rules, from the page: under 13 a grown-up sends it; under 18 a grown-up signs anything.
  for (const q of ["im 13 can i pitch", "I'm 13, can I pitch?", "I'm 14, can I pitch?", "how old do you have to be"]) {
    assert.equal(ai.pick(q) !== null, true, q);
  }
  assert.match(ai.say("im 13 can i pitch"), /^\*\*Yes: at 13 you can send a pitch yourself\.\*\*.*under 18.*parent or guardian to sign it with you.*Pitch Review is bought by a grown-up/s);
  assert.match(ai.say("I'm 10, can I pitch?"), /^\*\*At 10, ask a parent or guardian to send your pitch for you\.\*\*/);
  assert.match(ai.say("how old do I have to be"), /^\*\*You can pitch at any age\.\*\* If you're under 13, a parent or guardian sends it for you/);
  assert.match(ai.say("can kids pitch"), /^\*\*You can pitch at any age\.\*\*/);
  for (const q of ["can you build my app", "Can you build my app for me?", "can you make my app"]) {
    assert.match(ai.say(q), /^\*\*We can't promise to build it, but you can pitch it\.\*\*.*\[Pitch an idea\]\(\/orbyt#pitch\)/s, q);
  }
  // "Will you build it without me?" keeps the page's own answer.
  assert.match(ai.say("Will you build it without me?"), /\*\*Will you build it without me\?\*\* No\./);
  // The price leads with what's free, the review's price from the settings.
  for (const q of ["How much does it cost?", "Is it free?", "how much is it"]) {
    assert.match(ai.say(q), /^\*\*Pitching is free; the only paid thing is an optional \$19 Pitch Review\.\*\*/, q);
  }
  assert.match(typed("/orbyt", { apps: APPS, review: "on", reviewPrice: "$25", reviewDays: "5" }).say("How much does it cost?"), /optional \$25 Pitch Review/);
  const off = typed("/orbyt", { apps: APPS, early: "on" });
  assert.match(off.say("How much does it cost?"), /^\*\*Pitching is free:\*\* sending a pitch, or any Orbyt form, costs nothing\./);
  assert.doesNotMatch(off.say("How much does it cost?"), /Pitch Review|\$/);
  assert.match(off.say("I'm 12 can I pitch"), /^\*\*At 12, ask a parent or guardian/);
  assert.doesNotMatch(off.say("I'm 12 can I pitch"), /Pitch Review/);
});

test("\"Explain this page\" answers at once with no key on Home, Genesis and Orbyt, and stays the AI's with a key", () => {
  const data = { apps: APPS, early: "on", review: "on", reviewPrice: "$19", reviewDays: "5", pro: "on", proPrice: "$4.99" };
  const want = { "/": /^\*\*This is MTRX Horizyn's home page\.\*\*/, "/genesis": /\*\*This is Genesis\.\*\* It turns an idea into a plan, free/,
    "/orbyt": /^\*\*This is Orbyt\*\*, where you work with MTRX Horizyn/ };
  for (const [pathname, re] of Object.entries(want)) {
    const config = mount(pathname, data, { mine: () => [], nextOf: () => null, spark: () => null, screen: () => ({ view: "one project", project: "Paw Board" }) });
    const pill = config.welcomePills.find((p) => p.label === "Explain this page");
    assert.equal(pill.action, undefined, pathname);
    const text = pill.answer({ label: "Explain this page" });
    assert.match(text, re, pathname);
    // Typed, its own words get it too.
    assert.match(typed(pathname, data, { mine: () => [], nextOf: () => null, spark: () => null }).say("explain this page"), re, pathname);
  }
  assert.match(mount("/genesis", data, { screen: () => ({ view: "one project", project: "Paw Board" }) }).welcomePills[2].answer({ label: "Explain this page" }),
    /^You're looking at \*\*Paw Board\*\*/);
  assert.match(mount("/orbyt", data).welcomePills[2].answer({ label: "Explain this page" }), /\*\*Pitch Review:\*\* an optional \$19 extra/);
  // With a key, the AI explains the screen (read when the window is built).
  let given = null;
  const window = { Pilot: { mount: (c) => { given = c; }, ready: () => true }, location: { pathname: "/" } };
  vm.runInNewContext(source, { window, document: { getElementById: () => ({ dataset: data }), title: "" } });
  assert.equal(given.welcomePills[2].action, "explain-screen");
  assert.equal(given.welcomePills[2].answer, undefined);
  // Other pages keep the AI's explanation.
  assert.equal(mount("/partners", data).welcomePills[2].action, "explain-screen");
});

test("genesis: \"Show my projects\" and \"What's my next step?\" are found when typed (match words)", () => {
  const projects = [{ id: "p-1", name: "Paw Board", stage: "Spark", done: "1 of 19 steps (5%)", next: "Say the problem it solves in one sentence" }];
  const today = { prompt: "Invent a game that gets people outside.", answer: "", streak: 0, limit: 140 };
  const { pick, say } = typed("/genesis", { apps: APPS }, { mine: () => projects, nextOf: () => projects[0], spark: () => today });
  for (const q of ["Show my projects", "show my projects", "my projects", "projects?", "Where are my saved projects", "how is my progress"]) {
    assert.equal(pick(q), "Show my projects", q);
  }
  for (const q of ["What's my next step?", "what's my next step", "next step", "What should I do next?", "what do I tick next"]) {
    assert.equal(pick(q), "What's my next step?", q);
  }
  for (const q of ["Help with today's spark", "today's spark", "my streak", "what's the daily prompt"]) {
    assert.equal(pick(q), "Help with today's spark", q);
  }
  assert.match(say("my projects"), /^You have 1 project in this browser/);
  assert.equal(pick("Write me a poem"), null);
});

test("Orbyt: its FAQ answers are found when typed (own, reply, build, person, price)", () => {
  const on = typed("/orbyt", { apps: APPS, early: "on", review: "on", reviewPrice: "$19", reviewDays: "5", reviewMode: "ai" });
  for (const q of ["Who owns my idea?", "who owns my idea", "Will you build my idea?", "Will you build it without me?", "will you steal my idea", "is my idea safe"]) {
    assert.equal(on.pick(q), "Who owns my idea?", q);
  }
  assert.match(on.say("who owns my idea"), /^\*\*Who owns my idea\?\*\* You do\./);
  assert.match(on.say("who owns my idea"), /\*\*Will you build it without me\?\*\* No\./);
  for (const q of ["Do you reply?", "Is it a real person?", "how long until you reply", "Will a person read it?"]) {
    assert.equal(on.pick(q), "What happens after I send?", q);
  }
  for (const q of ["How much does it cost?", "What's the price?", "Is it free?", "Can I get a refund?"]) {
    assert.equal(on.pick(q), "What's a Pitch Review?", q);
  }
  assert.match(on.say("How much does it cost?"), /usually within an hour/);
  assert.equal(on.pick("What is Orbyt?"), "Which form is for me?");
  assert.match(on.say("What is Orbyt?"), /^\*\*Orbyt\*\* is where you work with MTRX Horizyn\./);
  assert.equal(on.pick("I want to invest"), "Which form is for me?");
  // Without Pitch Review, a price question gets "What happens after I send?", which says sending is free.
  const off = typed("/orbyt", { apps: APPS, early: "on" });
  assert.equal(off.pick("How much does it cost?"), "What happens after I send?");
  assert.match(off.say("Is it free?"), /^\*\*Pitching is free:\*\*/);
  for (const q of ["Write me a poem about the sea", "Tell me a joke", "ok"]) assert.equal(on.pick(q), null, q);
});

// Words listed on purpose although another answer on the page has them
// (1.28.0): "app" on "Help with my idea" ("I have an idea for an app") and on
// Orbyt's "Who owns my idea?" ("Can you build my app?"), "saved" on both
// "Help with my idea" and "Show my projects" on Genesis ("Is my idea saved?",
// "Where are my saved projects?"; "keep" too), and "pitch" on "Which form is for me?"
// ("I'm 13, can I pitch?").
// 1.29.0: "use" on home's "Which app fits me?" and "What's ready today?"
// ("Can kids use this?", "What can I use today?"); "lose" and "lost" on
// Genesis's "Help with my idea" too ("Will I lose my idea?"); "long" on
// Orbyt's "What happens after I send?" and "What's a Pitch Review?" ("How
// long does it take?", "How long until I get my review?").
const SHARED = { "/": ["app", "use"], "/genesis": ["app", "saved", "keep", "lose", "lost"], "/orbyt": ["app", "pitch", "long"] };

test("each page lists a `match` word on one of its answers only, never on another's label (but the few SHARED)", () => {
  const P = panel();
  for (const pathname of ["/", "/genesis", "/orbyt"]) {
    for (const data of [{ apps: APPS, early: "on" }, { apps: APPS, early: "on", review: "on", reviewPrice: "$19", reviewDays: "5", pro: "on" }]) {
      const config = mount(pathname, data, { mine: () => [], nextOf: () => null, spark: () => null });
      const base = `https://mtrx.example${pathname}`;
      const items = P.ownPills(config.welcomePills, base).concat(P.cleanChips(config.chips(), base))
        .filter((i) => i.link || i.answer !== undefined);
      const seen = new Map();
      for (const item of items) {
        for (const w of item.match || []) {
          if (SHARED[pathname].includes(w)) continue;
          assert.ok(!seen.has(w) || seen.get(w) === item.label, `${pathname}: "${w}" is on "${seen.get(w)}" and "${item.label}"`);
          seen.set(w, item.label);
          for (const other of items) {
            if (other !== item) assert.ok(!P.wordsOf(other.label).includes(w), `${pathname}: "${w}" (on "${item.label}") is in "${other.label}"`);
          }
        }
      }
    }
  }
});

test("no answer lists more than 20 match words (the core reads no more)", () => {
  const counted = [];
  for (const pathname of ["/", "/genesis", "/orbyt"]) {
    const config = mount(pathname, { apps: APPS, early: "on", review: "on", reviewPrice: "$19", reviewDays: "5", pro: "on" },
      { mine: () => [], nextOf: () => null, spark: () => null });
    for (const item of config.welcomePills.concat(config.chips())) {
      if (item.match) { assert.ok(item.match.length <= 20, `${pathname} "${item.label}": ${item.match.length}`); counted.push(item.match.length); }
    }
  }
  assert.ok(counted.length >= 15);
});

// ---------------------------------------------------------------- 1.29.0 (round 12)

test("Orbyt: \"Is the review AI?\" gets \"Yes\" in AI mode; only a question about a person gets the person answer", () => {
  const facts = { apps: APPS, review: "on", reviewPrice: "$19", reviewDays: "5" };
  const ai = typed("/orbyt", { ...facts, reviewMode: "ai" });
  for (const q of ["Is the review AI?", "is the review done by AI", "is the review written by AI", "is my review by a robot"]) {
    const text = ai.say(q);
    assert.match(text, /^\*\*Yes: a Pitch Review is written by an AI service\*\*/, q);
    assert.doesNotMatch(text, /^\*\*No/, q);
  }
  for (const q of ["is a human writing my review", "Is the review written by a person?", "does someone write my review"]) {
    assert.match(ai.say(q), /^\*\*No: a Pitch Review is written by an AI service\*\*/, q);
  }
  // In AI mode it still says what goes to the AI service, and who agrees.
  assert.match(ai.say("is the review AI"), /the idea you sent \(not your name or email\) goes to the AI service/);
  // Person mode: the other way round.
  const person = typed("/orbyt", { ...facts, reviewMode: "person" });
  for (const q of ["Is the review AI?", "is the review done by AI", "is my review by a robot"]) {
    assert.match(person.say(q), /^\*\*No, it isn't AI: a real person at MTRX Horizyn writes your Pitch Review\*\*/, q);
  }
  for (const q of ["is a human writing my review", "Is the review written by a person?", "does someone write my review"]) {
    assert.match(person.say(q), /^\*\*Yes: a real person at MTRX Horizyn writes your Pitch Review\*\*/, q);
  }
  assert.match(person.say("who writes the review"), /^\*\*A real person at MTRX Horizyn writes your Pitch Review\*\*/);
  assert.doesNotMatch(person.say("is the review AI"), /AI service/);
});

test("Orbyt: an age next to send or idea, how long it takes, \"Can you make my game?\" and a human review, typed", () => {
  const on = typed("/orbyt", { apps: APPS, early: "on", review: "on", reviewPrice: "$19", reviewDays: "5", reviewMode: "ai" });
  for (const [q, age] of [["I'm 11, can I send an idea?", 11], ["i am 10 can i send my idea", 10], ["I am 11", 11], ["im 12 can i submit my idea", 12]]) {
    assert.match(on.say(q), new RegExp(`^\\*\\*At ${age}, ask a parent or guardian to send your pitch for you\\.\\*\\*`), q);
  }
  assert.match(on.say("I'm 15 can I send my idea"), /^\*\*Yes: at 15 you can send a pitch yourself\.\*\*/);
  // The old ones still work.
  assert.match(on.say("im 13 can i pitch"), /^\*\*Yes: at 13 you can send a pitch yourself/);
  assert.match(on.say("can a 12 year old pitch"), /^\*\*At 12, ask a parent/);
  for (const q of ["how long does it take", "How long does it take?", "how fast"]) {
    const text = on.say(q);
    assert.match(text, /^\*\*Writing a pitch takes about 2 minutes\.\*\* A real person reads it and emails you back within 7 days/, q);
    assert.match(text, /Pitch Review \(an optional \$19 extra\) usually comes within an hour/, q);
  }
  for (const q of ["how long until i get my review", "how fast is the review", "How long does a Pitch Review take?"]) {
    assert.match(on.say(q), /^\*\*Usually within an hour\.\*\*/, q);
  }
  // A question about the reply keeps "What happens after I send?".
  assert.equal(on.pick("how long until you reply"), "What happens after I send?");
  assert.match(on.say("how long until you reply"), /^A real person reads your message/);
  for (const q of ["can you make my game", "Can you make my game?"]) {
    assert.match(on.say(q), /^\*\*We can't promise to build it, but you can pitch it\.\*\*/, q);
  }
  assert.match(on.say("I have an idea for a game"), /^Great, you can pitch it right here!.*\[Pitch an idea\]\(\/orbyt#pitch\)/s);
  assert.match(on.say("how do I submit my idea"), /^\*\*Use Pitch an idea on this page:\*\*/);
  assert.match(on.say("What happens after I send my idea"), /^A real person reads your message/);
  assert.match(on.say("is a human writing my review"), /^\*\*No: a Pitch Review is written by an AI service\*\*/);
  // Without Pitch Review: the time answer says nothing about one.
  const off = typed("/orbyt", { apps: APPS, early: "on" });
  assert.match(off.say("how long does it take"), /^\*\*Writing a pitch takes about 2 minutes\.\*\*/);
  assert.doesNotMatch(off.say("how long does it take"), /Pitch Review/);
  assert.match(off.say("I'm 11, can I send an idea?"), /^\*\*At 11, ask a parent/);
  for (const q of ["Write me a poem about the sea", "Tell me a joke", "ok"]) assert.equal(on.pick(q), null, q);
});

test("Orbyt: a specific answer about the review no longer repeats the whole \"What's a Pitch Review?\" paragraph", () => {
  const on = typed("/orbyt", { apps: APPS, review: "on", reviewPrice: "$19", reviewDays: "5", reviewMode: "ai" });
  const whole = /A \*\*Pitch Review\*\* is an optional extra you can add after sending a pitch/;
  for (const q of ["is the review AI", "who writes the review", "how long does the review take", "How much does it cost?", "how long does it take"]) {
    const text = on.say(q);
    assert.doesNotMatch(text, whole, q);
    // "Pitching is free" at most once.
    assert.ok((text.match(/[Pp]itching (itself )?is free/g) || []).length <= 1, `${q}: ${text}`);
    assert.ok(text.length < 700, `${q}: ${text.length}`);
  }
  // The button itself still gives the whole paragraph.
  const config = mount("/orbyt", { apps: APPS, review: "on", reviewPrice: "$19", reviewDays: "5", reviewMode: "ai" });
  assert.match(chip(config, "What's a Pitch Review?").answer({ label: "What's a Pitch Review?" }), whole);
});

test("Genesis: \"How do I start a project?\" and \"Will I lose my idea?\", typed with no key", () => {
  const projects = [{ id: "p-1", name: "Paw Board", stage: "Spark", done: "1 of 19 steps (5%)", next: "Say the problem it solves in one sentence" }];
  const { pick, say } = typed("/genesis", { apps: APPS, pro: "on", proPrice: "$4.99" }, { mine: () => projects, nextOf: () => projects[0], spark: () => null });
  for (const q of ["how do i start a project", "How do I start a new project?", "how do I start", "How do I begin?", "where do I start"]) {
    assert.match(say(q), /^\*\*Genesis\*\* turns an idea into a plan.*\[Start my idea\]\(\/genesis#new\)/s, q);
  }
  for (const q of ["will i lose my idea", "Will I lose my ideas?", "is my idea lost", "did i lose my idea", "will my idea disappear", "will I lose my projects"]) {
    assert.match(say(q), /^\*\*Your projects are saved in this browser\*\*/, q);
  }
  // The list itself is still the list.
  for (const q of ["my projects", "projects?", "show my projects", "Where are my saved projects"]) assert.equal(pick(q), "Show my projects", q);
  assert.match(say("my projects"), /^You have 1 project in this browser/);
});

test("Home: \"Is my info private?\", how old you have to be, \"Can kids use this?\" and more greetings, typed", () => {
  const { pick, say } = typed("/", { apps: APPS, early: "on", pro: "on", proPrice: "$4.99", review: "on", reviewPrice: "$19", reviewDays: "5" });
  for (const q of ["is my info private", "Is my information private?", "is my data safe", "do you track me", "is it safe"]) {
    assert.match(say(q), /^\*\*Yes, MTRX Horizyn keeps very little:\*\*/, q);
  }
  for (const q of ["how old do i have to be", "How old do you need to be?", "is there an age limit", "can kids use this", "Can children use it?"]) {
    const text = say(q);
    assert.match(text, /^\*\*Anyone can use this site, at any age\.\*\*/, q);
    // Orbyt's own rule, and what needs a grown-up.
    assert.match(text, /\*\*Orbyt's rule:\*\* under 13, a parent or guardian sends a pitch or message for you; from 13 you can send it yourself\./, q);
    assert.match(text, /\*\*For grown-ups \(18\+\):\*\* adding an AI key for me.*paying for Genesis Pro or a Pitch Review/, q);
    assert.match(text, /\[see Orbyt\]\(\/orbyt#pitch\)/, q);
  }
  assert.match(say("I'm 12 can I use this"), /^\*\*At 12, you can plan your idea in Genesis and ask me questions\.\*\* To send a pitch in Orbyt, ask a parent or guardian/);
  assert.match(say("im 15 can i use this"), /^\*\*At 15, you can use Genesis and send a pitch in Orbyt yourself\.\*\*/);
  // Paid extras that are off are never named.
  assert.doesNotMatch(typed("/", { apps: APPS, early: "on" }).say("how old do i have to be"), /Genesis Pro|Pitch Review/);
  for (const q of ["good morning", "Good morning!", "yo", "good evening", "morning!"]) {
    assert.match(say(q), /^Hi! I'm \*\*Pilot\*\*\./, q);
  }
  // "Which app is for my kids?" still picks the app.
  assert.equal(pick("which app is for my kids"), "Which app fits me?");
  assert.match(say("which app is for my kids"), /^Which sounds like you\?/);
  assert.equal(pick("what can I use today"), "What's ready today?");
  for (const q of ["Write me a poem about the sea", "Tell me a joke", "ok"]) assert.equal(pick(q), null, q);
});

test("Pilot keeps clear of Orbyt's \"Our apps\" heading and line, \"Other ways to talk to us\" and the Business enquiries card (1.29.0)", () => {
  const window = { Pilot: { mount: (c) => { given = c; } }, location: { pathname: "/orbyt" }, innerWidth: 1024 };
  let given = null;
  vm.runInNewContext(source, { window, document: { getElementById: () => ({ dataset: { apps: APPS } }), title: "" } });
  for (const sel of ["#v-apps-title", ".v-catalog-head .v-lede", ".v-paths-other", ".v-business", ".v-bundle", ".v-app-head", ".v-app-line",
    "#g-week", ".g-week .g-day"]) {
    assert.ok(given.avoid.includes(sel), sel);
  }
  // On a phone the two full-width ones are left out (the handle needs a free edge); read each time.
  window.innerWidth = 375;
  assert.ok(!given.avoid.includes(".v-business") && !given.avoid.includes(".v-paths-other"));
  assert.ok(given.avoid.includes("#v-apps-title") && given.avoid.includes(".v-bundle"));
  // Each one is on the page it is for.
  const orbyt = fs.readFileSync(path.join(__dirname, "..", "..", "templates", "vortex.html"), "utf8");
  for (const cls of ["v-apps-title", "v-lede", "v-paths-other", "v-business", "v-bundle", "v-app-head", "v-app-line"]) assert.ok(orbyt.includes(cls), cls);
});
