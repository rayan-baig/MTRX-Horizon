// The Genesis storage rules, run in Node: `node --test tests/js/genesis_store.test.js`.
// tests/test_genesis.py runs this file too, so `python -m pytest` covers it.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const S = require(path.join(__dirname, "..", "..", "static", "js", "genesis-store.js"));

// A stand-in for localStorage that keeps its data between "page loads".
function memoryStorage(data = new Map()) {
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

// What a browser with blocked site data does: every touch throws.
const blocked = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("SecurityError"); },
  removeItem() { throw new Error("SecurityError"); },
};

const idea = { name: "Nova", pitch: "Homework reminders that work", audience: "Students", address: "nova.com" };

test("a project is saved and is there after a reload", () => {
  const data = new Map();
  const store = S.open(memoryStorage(data));
  assert.equal(store.usable, true);
  assert.deepEqual(store.load(), []);
  const { project } = S.create(idea, 1000);
  project.ticks.name = true;
  project.stage = "plan";
  project.notes = "Line one\nLine two";
  assert.equal(store.save([project]), true);

  const again = S.open(memoryStorage(data)).load(); // a new page load, the same browser
  assert.equal(again.length, 1);
  assert.equal(again[0].name, "Nova");
  assert.equal(again[0].stage, "plan");
  assert.deepEqual(again[0].ticks, { name: true });
  assert.equal(again[0].notes, "Line one\nLine two");
  assert.equal(again[0].id, project.id);
});

test("export then import brings the same projects back on another device", () => {
  const a = S.create(idea).project;
  const b = S.create({ ...idea, name: "Orbit", address: "" }).project;
  b.ticks = { name: true, problem: true };
  const file = S.exportText([a, b], Date.UTC(2026, 10, 5));
  const parsed = JSON.parse(file);
  assert.equal(parsed.app, "MTRX Horizyn Genesis");
  assert.equal(parsed.exported, "2026-11-05T00:00:00.000Z");

  const result = S.importText(file, []);
  assert.equal(result.added, 2);
  assert.deepEqual(result.projects.map((p) => p.name), ["Nova", "Orbit"]);
  assert.deepEqual(result.projects[1].ticks, { name: true, problem: true });

  // Importing the same file again updates them rather than doubling them.
  const twice = S.importText(file, result.projects);
  assert.equal(twice.projects.length, 2);
  assert.equal(twice.replaced, 2);
  assert.equal(twice.added, 0);
});

test("an import is cleaned: bad projects are skipped and bad fields dropped", () => {
  const file = JSON.stringify({ projects: [
    { name: "", pitch: "x", audience: "y" },                          // no name
    { name: "A".repeat(500), pitch: "x", audience: "y" },             // too long
    { name: "Ok", pitch: "x", audience: "y", stage: "space", address: "Not An Address!",
      ticks: { name: true, hacked: true, problem: "yes" }, notes: 42, id: "<b>" },
    "not a project",
  ] });
  const result = S.importText(file, []);
  assert.equal(result.projects.length, 1);
  assert.equal(result.skipped, 3);
  const p = result.projects[0];
  assert.equal(p.stage, "spark");
  assert.equal(p.address, "");
  assert.deepEqual(p.ticks, { name: true });
  assert.equal(p.notes, "");
  assert.notEqual(p.id, "<b>");
  assert.ok(S.importText("{not json", []).error);
  assert.ok(S.importText(JSON.stringify({ hello: 1 }), []).error);
  assert.ok(S.importText("x".repeat(S.LIMITS.file + 1), []).error);
});

test("an import never goes over the project limit", () => {
  const many = Array.from({ length: S.LIMITS.projects + 20 }, (_, i) => ({ ...idea, id: `p${i}` }));
  const result = S.importText(JSON.stringify(many), []);
  assert.equal(result.projects.length, S.LIMITS.projects);
});

test("blocked storage still works for the visit, and says it can't keep anything", () => {
  const store = S.open(blocked);
  assert.equal(store.usable, false);
  assert.deepEqual(store.load(), []);
  const { project } = S.create(idea);
  assert.equal(store.save([project]), false);
  assert.equal(store.load().length, 1); // kept in memory for this visit
  assert.equal(store.clear(), true);
  assert.deepEqual(store.load(), []);
  // No storage at all (an old browser, or a test).
  assert.equal(S.open(null).usable, false);
});

test("a full disk is reported, not thrown", () => {
  const full = memoryStorage();
  const store = S.open(full);
  full.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(store.save([S.create(idea).project]), false);
});

test("broken saved data does not break the page", () => {
  const data = new Map([[S.KEY, "{oops"]]);
  assert.deepEqual(S.open(memoryStorage(data)).load(), []);
  data.set(S.KEY, JSON.stringify({ projects: "nope" }));
  assert.deepEqual(S.open(memoryStorage(data)).load(), []);
});

test("delete all empties storage", () => {
  const data = new Map();
  const store = S.open(memoryStorage(data));
  store.save([S.create(idea).project]);
  assert.equal(store.clear(), true);
  assert.equal(data.has(S.KEY), false);
  assert.deepEqual(S.open(memoryStorage(data)).load(), []);
});

test("fields are checked and cut to plain text", () => {
  assert.deepEqual(Object.keys(S.create({}).errors).sort(), ["audience", "name", "pitch"]);
  assert.ok(S.create({ ...idea, name: "x".repeat(S.LIMITS.name + 1) }).errors.name);
  assert.ok(S.create({ ...idea, pitch: "x".repeat(S.LIMITS.pitch + 1) }).errors.pitch);
  const tidy = S.create({ ...idea, name: "  Nova\u0000\n  App  " }).project;
  assert.equal(tidy.name, "Nova App");
});

test("web address ideas", () => {
  for (const ok of ["nova.com", "nova", "my-app.co.uk", "a1.io"]) assert.equal(S.addressProblem(ok), null, ok);
  for (const bad of ["https://nova.com", "Nova.com", "no va.com", "-nova.com", "nova-.com", "nova..com",
                     "nova.c0m", "nov@.com", "x".repeat(64) + ".com"]) {
    assert.ok(S.addressProblem(bad), bad);
  }
  assert.equal(S.suggestAddress("Café Rocket!"), "cafe-rocket.com");
  assert.equal(S.suggestAddress("!!!"), "");
});

test("progress per stage and overall, and launched only at Launch with every step done", () => {
  const p = S.create(idea).project;
  let pr = S.progress(p);
  assert.equal(pr.done, 0);
  assert.equal(pr.stages.map((s) => s.key).join(), "spark,plan,build,launch");
  assert.equal(pr.total, S.CHECKLIST.length);
  for (const item of S.CHECKLIST) p.ticks[item.key] = true;
  pr = S.progress(p);
  assert.equal(pr.percent, 100);
  assert.equal(pr.launched, false); // still at Spark
  p.stage = "launch";
  assert.equal(S.progress(p).launched, true);
});

test("a name close to one MTRX Horizyn uses gets a gentle warning", () => {
  assert.ok(S.nameWarning("RankUp"));
  assert.ok(S.nameWarning("Omni Armor"));
  assert.equal(S.nameWarning("Nova"), null);
});

// ---------------------------------------------------------------- Genesis Pro

test("a Pro key is tidied however it was typed, and odd ones are refused", () => {
  assert.equal(S.proKey("gp-abcd efgh ijkl-mnop-qrst-uvwx"), "GP-ABCD-EFGH-IJKL-MNOP-QRST-UVWX");
  assert.equal(S.proKey("GPABCDEFGHIJKLMNOPQRSTUVWX"), "GP-ABCD-EFGH-IJKL-MNOP-QRST-UVWX");
  for (const bad of ["", "GP-ABCD", "GP-ABCD-EFGH-IJKL-MNOP-QRST-UVW1", "XX-ABCD-EFGH-IJKL-MNOP-QRST-UVWX", null, 42, "G".repeat(200)]) {
    assert.equal(S.proKey(bad), null, String(bad));
  }
});

test("a Pro key is kept in storage, read back and forgotten, and blocked storage is survived", () => {
  const storage = memoryStorage();
  assert.equal(S.readProKey(storage), null);
  assert.equal(S.keepProKey(storage, "gp-abcd-efgh-ijkl-mnop-qrst-uvwx"), true);
  assert.equal(storage.getItem(S.PRO_KEY), "GP-ABCD-EFGH-IJKL-MNOP-QRST-UVWX");
  assert.equal(S.readProKey(storage), "GP-ABCD-EFGH-IJKL-MNOP-QRST-UVWX");
  assert.equal(S.keepProKey(storage, "not a key"), false);
  S.forgetProKey(storage);
  assert.equal(S.readProKey(storage), null);
  assert.equal(S.keepProKey(blocked, "GP-ABCD-EFGH-IJKL-MNOP-QRST-UVWX"), false);
  assert.equal(S.readProKey(blocked), null);
  assert.equal(S.forgetProKey(blocked), false);
});

test("Download plan: a project as plain text with its checklist and notes", () => {
  const { project } = S.create(idea, Date.UTC(2026, 10, 1));
  project.ticks.name = true;
  project.notes = "Ask Sam about it";
  const text = S.planText(project, Date.UTC(2026, 10, 14));
  assert.match(text, /^# Nova\n\nHomework reminders that work\n\nFor: Students\nWeb address idea: nova.com\n/);
  assert.match(text, /Stage: Spark \(1 of 19 steps done, 5%\)/);
  assert.match(text, /- \[x\] Pick a name and check nobody else uses it/);
  assert.match(text, /- \[ \] Launch it/);
  assert.match(text, /## Notes\n\nAsk Sam about it/);
  assert.match(text, /2026-11-14\n$/);
  assert.equal(S.planFileName(project), "nova-plan.txt");
  assert.equal(S.planText({ name: "" }), "");
});

// ---------------------------------------------------------------- 1.10.0: the first minute, today's spark, idea cards

test("every example is a project that would start, and any number picks one", () => {
  assert.ok(S.EXAMPLES.length >= 6);
  for (const ex of S.EXAMPLES) {
    const made = S.create(ex);
    assert.ok(made.project, ex.name);
    assert.equal(S.nameWarning(ex.name), null, ex.name);
  }
  assert.equal(S.example(0).name, S.EXAMPLES[0].name);
  assert.equal(S.example(S.EXAMPLES.length + 1).name, S.EXAMPLES[1].name);
  assert.equal(S.example(-1).name, S.EXAMPLES[S.EXAMPLES.length - 1].name);
  for (let i = 0; i < 20; i += 1) {
    const any = S.example();
    assert.equal(any.name, S.EXAMPLES[any.index].name);
  }
});

test("the next step is the first open one in the stage the project is at", () => {
  const { project } = S.create(idea);
  assert.equal(S.nextStep(project).key, "name");
  project.ticks.name = true;
  assert.equal(S.nextStep(project).key, "problem");
  project.stage = "build";
  assert.equal(S.nextStep(project).key, "build");
  project.ticks = Object.fromEntries(S.CHECKLIST.filter((i) => i.stage === "build").map((i) => [i.key, true]));
  assert.equal(S.nextStep(project).stage, "spark"); // an earlier step still open
  project.ticks = Object.fromEntries(S.CHECKLIST.map((i) => [i.key, true]));
  assert.equal(S.nextStep(project), null);
});

test("days are the visitor's own calendar days, and real ones only", () => {
  assert.equal(S.dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(S.dayNumber("1970-01-02"), 1);
  assert.equal(S.dayNumber("2026-02-30"), NaN);
  assert.equal(S.dayNumber("2026-1-5"), NaN);
  assert.equal(S.dayNumber(null), NaN);
});

test("a new prompt every day, and every prompt before any comes round again", () => {
  const start = S.dayNumber("2026-11-19");
  const seen = new Set();
  let last = null;
  for (let d = 0; d < S.PROMPTS.length; d += 1) {
    const key = new Date((start + d) * 86400000).toISOString().slice(0, 10);
    const p = S.promptFor(key);
    assert.notEqual(p.index, last);
    assert.equal(p.text, S.PROMPTS[p.index]);
    seen.add(p.index);
    last = p.index;
  }
  assert.equal(seen.size, S.PROMPTS.length);
  assert.deepEqual(S.promptFor("2026-11-19"), S.promptFor("2026-11-19"));
  for (const text of S.PROMPTS) assert.ok(text.length <= 100, text);
});

const days = (...keys) => Object.fromEntries(keys.map((k) => [k, "an idea"]));

test("a streak counts days in a row, and today not answered yet breaks nothing", () => {
  assert.deepEqual(S.streak({}, "2026-11-19"), { streak: 0, best: 0, freezes: 1, frozen: [], today: false, total: 0, toEarn: 0 });
  let s = S.streak(days("2026-11-17", "2026-11-18", "2026-11-19"), "2026-11-19");
  assert.equal(s.streak, 3);
  assert.equal(s.today, true);
  assert.equal(s.freezes, 1);
  s = S.streak(days("2026-11-17", "2026-11-18"), "2026-11-19");
  assert.equal(s.streak, 2);
  assert.equal(s.today, false);
  assert.deepEqual(s.frozen, []);
});

test("one missed day uses the freeze and the streak carries on", () => {
  const s = S.streak(days("2026-11-15", "2026-11-16", "2026-11-18", "2026-11-19"), "2026-11-19");
  assert.equal(s.streak, 4);
  assert.deepEqual(s.frozen, ["2026-11-17"]);
  assert.equal(s.freezes, 0);
  assert.equal(s.toEarn, S.FREEZE_EARN - 2);
  // Yesterday missed and today not answered yet: the freeze already covers yesterday.
  const y = S.streak(days("2026-11-16", "2026-11-17"), "2026-11-19");
  assert.equal(y.streak, 2);
  assert.deepEqual(y.frozen, ["2026-11-18"]);
});

test("two missed days in a row start a new streak, with its own freeze", () => {
  const s = S.streak(days("2026-11-10", "2026-11-11", "2026-11-12", "2026-11-15"), "2026-11-15");
  assert.equal(s.streak, 1);
  assert.equal(s.best, 3);
  assert.equal(s.freezes, 1);
  assert.deepEqual(s.frozen, []);
  // A missed day after the freeze was used ends the streak too.
  const t = S.streak(days("2026-11-01", "2026-11-03", "2026-11-05"), "2026-11-05");
  assert.equal(t.streak, 1);
  assert.equal(t.best, 2);
});

test("the freeze comes back after enough answered days", () => {
  const keys = ["2026-11-01", "2026-11-03"]; // the 2nd is covered
  for (let d = 4; d < 4 + S.FREEZE_EARN; d += 1) keys.push(`2026-11-${String(d).padStart(2, "0")}`);
  const s = S.streak(days(...keys), keys[keys.length - 1]);
  assert.equal(s.freezes, 1);
  assert.equal(s.toEarn, 0);
  assert.equal(s.streak, keys.length);
  // ...so another single missed day is covered again.
  const later = S.streak(days(...keys, "2026-11-12"), "2026-11-12");
  assert.equal(later.streak, keys.length + 1);
  assert.deepEqual(later.frozen, ["2026-11-02", "2026-11-11"]);
});

test("the row of the last 7 days says what each day was", () => {
  const row = S.lastDays(days("2026-11-15", "2026-11-16", "2026-11-18"), "2026-11-19", 7);
  assert.deepEqual(row.map((d) => d.key), ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]);
  assert.deepEqual(row.map((d) => d.state), ["missed", "missed", "done", "done", "frozen", "done", "today"]);
});

test("answers are kept in storage, cleaned, and survive blocked storage", () => {
  const data = new Map();
  const first = S.openDaily(memoryStorage(data));
  assert.equal(first.usable, true);
  assert.equal(first.save({ "2026-11-19": "  A   plant\u0000 reminder  ", "not a day": "x", "2026-11-18": "" }), true);
  assert.deepEqual(S.openDaily(memoryStorage(data)).load(), { "2026-11-19": "A plant reminder" });
  assert.equal(JSON.parse(data.get(S.DAILY_KEY)).format, 1);
  // A long answer is cut to the length of a pitch.
  first.save({ "2026-11-19": "y".repeat(500) });
  assert.equal(first.load()["2026-11-19"].length, S.DAILY_LIMIT);
  assert.equal(S.DAILY_LIMIT <= S.LIMITS.pitch, true);
  // Junk in storage is no answers, not an error.
  data.set(S.DAILY_KEY, "{not json");
  assert.deepEqual(S.openDaily(memoryStorage(data)).load(), {});
  first.clear();
  assert.equal(data.has(S.DAILY_KEY), false);
  // Projects and answers live under different keys.
  assert.notEqual(S.DAILY_KEY, S.KEY);
  const off = S.openDaily(blocked);
  assert.equal(off.usable, false);
  assert.equal(off.save({ "2026-11-19": "kept for this visit" }), false);
  assert.deepEqual(off.load(), { "2026-11-19": "kept for this visit" });
});

test("only the newest answers are kept", () => {
  const many = {};
  for (let d = 0; d < 450; d += 1) many[new Date((20000 + d) * 86400000).toISOString().slice(0, 10)] = "idea";
  const kept = S.cleanDays(many);
  assert.equal(Object.keys(kept).length, 400);
  assert.ok(kept[new Date((20000 + 449) * 86400000).toISOString().slice(0, 10)]);
  assert.equal(kept[new Date(20000 * 86400000).toISOString().slice(0, 10)], undefined);
});

test("an idea card's words say only what the card shows: never the notes or ticks", () => {
  const { project } = S.create(idea);
  project.ticks.name = true;
  project.notes = "my secret note";
  const text = S.shareText(project, "https://mtrxhorizyn.com");
  assert.equal(text, "Nova: Homework reminders that work\nFor Students\nSpark · 5% of the way to launch\nMade with Genesis · mtrxhorizyn.com/genesis");
  assert.ok(!text.includes("secret") && !text.includes("nova.com\n"));
  // A strange base address falls back to the company's own.
  assert.match(S.shareText(project, "javascript:alert(1)"), /mtrxhorizyn\.com\/genesis$/);
  assert.match(S.shareText(project, ""), /mtrxhorizyn\.com\/genesis$/);
  assert.equal(S.shareText({ name: "" }), "");
  assert.equal(S.cardFileName(project), "nova-card.png");
  assert.equal(S.cardFileName({ name: "!!!" }), "genesis-card.png");
});
