// The Genesis → Chroma Vortex hand-off and the Vortex form rules, run in Node:
// `node --test tests/js/vortex_handoff.test.js`. tests/test_vortex.py runs it too.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const S = require(path.join(__dirname, "..", "..", "static", "js", "genesis-store.js"));
const V = require(path.join(__dirname, "..", "..", "static", "js", "vortex-form.js"));

function memoryStorage(data = new Map()) {
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}
const blocked = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("SecurityError"); },
  removeItem() { throw new Error("SecurityError"); },
};

// Form inputs as the page has them: anything with a value.
const inputs = () => ({ name: { value: "" }, email: { value: "" }, idea: { value: "" },
  pitch: { value: "" }, audience: { value: "" }, message: { value: "" } });

const idea = { name: "Nova", pitch: "Homework reminders that work", audience: "Students", address: "nova.com" };

function genesisWith(...projects) {
  const local = memoryStorage();
  S.open(local).save(projects);
  return local;
}

test("Pitch this in Chroma Vortex pre-fills the idea fields on the Vortex page", () => {
  const nova = S.create(idea).project;
  nova.notes = "my private notes";
  const other = S.create({ ...idea, name: "Orbit", pitch: "Cupcakes by bike" }).project;
  const local = genesisWith(other, nova);
  const session = memoryStorage();

  // On the Genesis page: the link hands over the project.
  assert.equal(S.offerToVortex(session, nova.id), true);
  // Only the id travels; never the idea's words (they'd be in no address either).
  const handed = session.data.get(S.HANDOFF_KEY);
  assert.ok(!handed.includes("Nova") && !handed.includes("Homework") && !handed.includes("Students"));
  assert.deepEqual(Object.keys(JSON.parse(handed)).sort(), ["at", "id"]);

  // On the Vortex page: the project is read back from this browser and fills the form.
  const project = V.handedOver(S, session, local);
  assert.equal(project.id, nova.id);
  const form = inputs();
  const filled = V.fill(form, V.fromGenesis(project));
  assert.deepEqual(filled, ["idea", "pitch", "audience"]);
  assert.equal(form.idea.value, "Nova");
  assert.equal(form.pitch.value, "Homework reminders that work");
  assert.equal(form.audience.value, "Students");
  // The visitor's own details, the message and the private notes are left alone.
  assert.equal(form.name.value, "");
  assert.equal(form.email.value, "");
  assert.equal(form.message.value, "");

  // The offer is used once: a reload does not fill the form again.
  assert.equal(session.data.has(S.HANDOFF_KEY), false);
  assert.equal(V.handedOver(S, session, local), null);
});

test("an old, broken or unknown hand-off fills nothing", () => {
  const nova = S.create(idea).project;
  const local = genesisWith(nova);
  const session = memoryStorage();

  S.offerToVortex(session, nova.id, 1000);
  assert.equal(V.handedOver(S, session, local, 1000 + 11 * 60 * 1000), null); // too old

  S.offerToVortex(session, "not-a-project", Date.now());
  assert.equal(V.handedOver(S, session, local), null);

  session.setItem(S.HANDOFF_KEY, "{broken");
  assert.equal(V.handedOver(S, session, local), null);
  session.setItem(S.HANDOFF_KEY, JSON.stringify({ id: "<b>x</b>", at: Date.now() }));
  assert.equal(V.handedOver(S, session, local), null);

  assert.equal(S.offerToVortex(session, "<script>"), false);
  // Blocked or missing storage: no hand-off, and no error.
  assert.equal(S.offerToVortex(blocked, nova.id), false);
  assert.equal(S.offerToVortex(null, nova.id), false);
  assert.equal(V.handedOver(S, blocked, local), null);
  assert.equal(V.handedOver(S, null, local), null);
});

test("the form is checked before anything is sent", () => {
  const good = { name: "Ada", email: "ada@example.com", idea: "Nova", pitch: "Reminders", audience: "Students" };
  assert.deepEqual(V.problems("pitch", good), {});
  assert.ok(V.problems("pitch", { ...good, email: "ada@" }).email);
  assert.ok(V.problems("pitch", { ...good, idea: "" }).idea);
  assert.ok(V.problems("pitch", { ...good, pitch: "x".repeat(V.LIMITS.pitch + 1) }).pitch);
  assert.ok(V.problems("nope", good).kind);

  const partner = { name: "Grace", organisation: "Example Ltd", email: "grace@example.com", message: "Hello",
    apps: ["cyberlogix"], partnership: "resell" };
  assert.deepEqual(V.problems("partner", partner), {});
  assert.ok(V.problems("partner", { ...partner, apps: [] }).apps);
  assert.ok(V.problems("partner", { ...partner, apps: ["other-app"] }).apps);
  assert.ok(V.problems("partner", { ...partner, partnership: "merger" }).partnership);

  // Investors may leave the organisation out.
  assert.deepEqual(V.problems("invest", { name: "Sam", email: "sam@example.com", message: "Hi" }), {});
});

test("only the chosen path's fields are sent, with the hidden field", () => {
  const body = V.body("pitch", { name: " Ada ", email: "ada@example.com", idea: "Nova", pitch: "p", audience: "a",
    organisation: "should not go", apps: ["rankup"], website: "" });
  assert.deepEqual(Object.keys(body).sort(), ["audience", "email", "idea", "kind", "message", "name", "pitch", "website"]);
  assert.equal(body.name, "Ada");
  assert.equal(V.sentLine("ada@example.com"), "We'll reply to ada@example.com as soon as we can.");
});
