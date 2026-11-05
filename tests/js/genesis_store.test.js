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
