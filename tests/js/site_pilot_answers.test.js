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
  const pill = (c, label) => c.welcomePills.find((p) => p.label === label);
  assert.match(pill(mount("/", { apps: APPS }), "What is Orbyt?").answer, /\[Open Orbyt\]\(\/orbyt\)$/);
  assert.equal(pill(orbyt, "What is Orbyt?"), undefined);
  assert.match(pill(orbyt, "Who owns my idea?").answer, /^\*\*Who owns my idea\?\*\* You do\./);
  const asked = chip(orbyt, "Which form is for me?").answer;
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
  const { pick, say } = typed("/", { apps: APPS, early: "on", pro: "on" });
  assert.equal(pick("What is Genesis?"), "How do I start an idea?");
  assert.match(say("what is genesis"), /\*\*Genesis\*\* turns an idea into a plan/);
  assert.equal(pick("Is it free?"), "What's ready today?");
  assert.match(say("Is it free?"), /\*\*Free:\*\* Genesis \(Genesis Pro is an optional paid extra\), sending a pitch in Orbyt/);
  assert.equal(pick("How much does it cost?"), "What's ready today?");
  assert.equal(pick("When does RankUp open?"), "What apps are coming?");
  assert.match(say("When does RankUp open?"), /^\*\*RankUp\*\* is still in development\.\n\n/);
  assert.match(say("when will omniarmor launch"), /^\*\*OmniArmor\.ai\*\* is still in development\./);
  assert.equal(pick("What is Orbyt?"), "What is Orbyt?");
  assert.equal(pick("which app is for my family"), "Which app fits me?");
  assert.equal(pick("I run a restaurant kitchen"), "Which app fits me?");
  assert.equal(pick("how do I start"), "How do I start an idea?");
  assert.equal(pick("what's ready"), "What's ready today?");
  // Pressed (not typed), "What apps are coming?" has no app's first line.
  assert.doesNotMatch(say("What apps are coming?"), /still in development\.\n\n/);
  for (const q of ["Write me a poem about the sea", "Tell me a joke", "What's the weather?", "How do I reset my password?", "ok"]) {
    assert.equal(pick(q), null, q);
  }
  // The free line says only what's on: no Genesis Pro or Pitch Review while they're off.
  const plain = typed("/", { apps: APPS, early: "on" }).say("Is it free?");
  assert.doesNotMatch(plain, /Genesis Pro|Pitch Review/);
  assert.match(typed("/", { apps: APPS, review: "on" }).say("Is it free?"), /a Pitch Review is an optional paid extra/);
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
  assert.match(off.say("Is it free?"), /Sending is free\.$/);
  for (const q of ["Write me a poem about the sea", "Tell me a joke", "ok"]) assert.equal(on.pick(q), null, q);
});

test("each page lists a `match` word on one of its answers only, never on another's label", () => {
  const P = panel();
  for (const pathname of ["/", "/genesis", "/orbyt"]) {
    for (const data of [{ apps: APPS, early: "on" }, { apps: APPS, early: "on", review: "on", reviewPrice: "$19", reviewDays: "5" }]) {
      const config = mount(pathname, data, { mine: () => [], nextOf: () => null, spark: () => null });
      const base = `https://mtrx.example${pathname}`;
      const items = P.ownPills(config.welcomePills, base).concat(P.cleanChips(config.chips(), base))
        .filter((i) => i.link || i.answer !== undefined);
      const seen = new Map();
      for (const item of items) {
        for (const w of item.match || []) {
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
