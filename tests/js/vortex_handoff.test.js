// The Genesis → Orbyt hand-off and the Vortex form rules, run in Node:
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

test("Pitch this in Orbyt pre-fills the idea fields on the Vortex page", () => {
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
  // The choices are what the page offers: the released apps.
  const released = ["rankup", "cyberlogix", "omniarmor"];
  assert.deepEqual(V.problems("partner", partner, released), {});
  assert.ok(V.problems("partner", { ...partner, apps: [] }, released).apps);
  assert.ok(V.problems("partner", { ...partner, apps: ["other-app"] }, released).apps);
  assert.ok(V.problems("partner", partner, ["rankup"]).apps); // cyberlogix not offered
  assert.ok(V.problems("partner", { ...partner, partnership: "merger" }, released).partnership);

  // Buying: the whole company, apps, or both; the organisation may be left out.
  const buy = { name: "Jo", email: "jo@example.com", message: "Hello", apps: ["company"] };
  const offered = [V.COMPANY, ...released];
  assert.deepEqual(V.problems("buy", buy, offered), {});
  assert.deepEqual(V.problems("buy", { ...buy, apps: ["company", "rankup"] }, offered), {});
  assert.ok(V.problems("buy", { ...buy, apps: [] }, offered).apps);
  assert.ok(V.problems("buy", { ...buy, apps: ["secret-app"] }, offered).apps);
  assert.ok(V.problems("buy", { ...buy, message: "" }, offered).message);
  assert.deepEqual(Object.keys(V.body("buy", { ...buy, partnership: "resell", idea: "x" })).sort(),
    ["apps", "email", "kind", "message", "name", "organisation", "website"]);

  // Investors may leave the organisation out.
  assert.deepEqual(V.problems("invest", { name: "Sam", email: "sam@example.com", message: "Hi" }), {});
});

test("only the chosen path's fields are sent, with the hidden field", () => {
  const body = V.body("pitch", { name: " Ada ", email: "ada@example.com", idea: "Nova", pitch: "p", audience: "a",
    organisation: "should not go", apps: ["rankup"], website: "" });
  assert.deepEqual(Object.keys(body).sort(), ["audience", "email", "idea", "kind", "message", "name", "pitch", "website"]);
  assert.equal(body.name, "Ada");
  assert.equal(V.sentLine("ada@example.com"), "We'll reply to ada@example.com, even if the answer is no.");
});

test("1.17.0: after sending, a reply-by date from the promised 7 days, in plain words", () => {
  assert.equal(V.REPLY_DAYS, 7);
  // 1.19.0: the Sent screen says when once, as a date (nextLine); the first
  // line no longer repeats "within 7 days".
  assert.ok(!/\d+ days/.test(V.sentLine("a@example.com")));
  assert.ok(V.nextLine(new Date(2026, 10, 22, 9, 30)).includes("by Sunday 29 November"));
  // Sunday 22 November 2026 + 7 days, at any time of day.
  assert.equal(V.replyBy(new Date(2026, 10, 22, 9, 30)), "Sunday 29 November");
  assert.equal(V.replyBy(new Date(2026, 11, 28, 23, 50)), "Monday 4 January");
  assert.equal(V.nextLine(new Date(2026, 10, 22)),
    "What happens next: a real person reads your message and emails you back by Sunday 29 November. "
    + "If it's a yes, or we have a question, that email is where we start.");
});
