// The partner page's Apply button opens Chroma Vortex with the Partner form
// filled in: `node --test tests/js/vortex_prefill.test.js`.
// tests/test_offers.py runs it too.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const V = require(path.join(__dirname, "..", "..", "static", "js", "vortex-form.js"));

test("Apply's address picks CyberLogix AI and the new kind of partnership", () => {
  assert.deepEqual(V.fromHash("#partner/cyberlogix/refer-trade"),
    { kind: "partner", apps: ["cyberlogix"], partnership: "refer-trade" });
  assert.ok(V.PARTNERSHIPS.includes("refer-trade"));
});

test("the filled-in form passes the page's own checks once the visitor adds their details", () => {
  const asked = V.fromHash("#partner/cyberlogix/refer-trade");
  const values = { name: "Ray", organisation: "Coldline Service Co", email: "ray@example.com",
    message: "We service forty kitchens.", apps: asked.apps, partnership: asked.partnership };
  assert.deepEqual(V.problems("partner", values, ["rankup", "cyberlogix", "omniarmor"]), {});
  const body = V.body("partner", values);
  assert.deepEqual(body.apps, ["cyberlogix"]);
  assert.equal(body.partnership, "refer-trade");
});

test("a plain path, or one with nothing after it, picks nothing", () => {
  assert.deepEqual(V.fromHash("#partner"), { kind: "partner", apps: [], partnership: "" });
  assert.deepEqual(V.fromHash("#pitch/cyberlogix"), { kind: "pitch", apps: [], partnership: "" });
  assert.deepEqual(V.fromHash(""), { kind: null, apps: [], partnership: "" });
  assert.deepEqual(V.fromHash("#nowhere/cyberlogix/refer-trade"), { kind: null, apps: [], partnership: "" });
});

test("only well-formed app keys and known kinds are taken from an address", () => {
  const asked = V.fromHash("#partner/cyberlogix,<b>,CYBER,omniarmor,cyberlogix/merger");
  assert.deepEqual(asked.apps, ["cyberlogix", "omniarmor"]);
  assert.equal(asked.partnership, "");
  // Buying takes apps (and the company) but never a partnership kind.
  assert.deepEqual(V.fromHash("#buy/company,rankup/refer-trade"),
    { kind: "buy", apps: ["company", "rankup"], partnership: "" });
});

test("the bundle's ask link picks both of its apps", () => {
  assert.deepEqual(V.fromHash("#partner/cyberlogix,omniarmor"),
    { kind: "partner", apps: ["cyberlogix", "omniarmor"], partnership: "" });
});
