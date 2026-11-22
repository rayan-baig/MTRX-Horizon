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
  // "What is Orbyt?" (a welcome pill) has no "Open Orbyt" on Orbyt either; elsewhere it keeps it.
  const pill = (c) => c.welcomePills.find((p) => p.label === "What is Orbyt?").answer;
  assert.doesNotMatch(pill(orbyt), /Open Orbyt/);
  assert.match(pill(mount("/", { apps: APPS })), /\[Open Orbyt\]\(\/orbyt\)$/);
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
  // Answered already: says so, and offers to change it.
  const done = mount("/genesis", {}, { mine: () => [], nextOf: () => null, spark: () => ({ ...today, answer: "Market *stalls* [x](y)" }) });
  const again = answer(done, "Help with today's spark");
  assert.match(again, /You've answered it already: “Market stalls x\(y\)”/);
  assert.match(again, /\[Open your spark\]\(\/genesis#spark\)/);
  // No page bridge (another page): still an answer with the way there.
  assert.match(answer(mount("/genesis", {}), "Help with today's spark"), /\[Genesis page\]\(\/genesis#spark\)/);
});
