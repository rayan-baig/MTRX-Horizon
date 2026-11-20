"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const R = require("../../src/core/pilot-render");

const dom = new JSDOM("<!doctype html><div id=out></div>");
const doc = dom.window.document;
const show = (text) => { const out = doc.getElementById("out"); out.textContent = ""; out.appendChild(R.render(text, doc)); return out; };

test("script injection renders as text", () => {
  const out = show("<script>window.hacked=1</script><img src=x onerror=alert(1)> <b onclick=x>hi</b>");
  assert.equal(out.querySelector("script, img, b"), null);
  assert.ok(out.textContent.includes("<script>window.hacked=1</script>"));
  assert.equal(dom.window.hacked, undefined);
});

test("simple markdown becomes safe elements", () => {
  const out = show("# Title\n**bold** and *it* and `code`\n\n- one\n- two\n\n1. first\n\n```\n<tag>\n```");
  assert.equal(out.querySelector(".pilot-h").textContent, "Title");
  assert.equal(out.querySelectorAll("strong")[1].textContent, "bold");
  assert.equal(out.querySelector("em").textContent, "it");
  assert.equal(out.querySelectorAll("ul li").length, 2);
  assert.equal(out.querySelectorAll("ol li").length, 1);
  assert.equal(out.querySelector("pre code").textContent, "<tag>");
});

test("links only for web addresses; javascript: stays text", () => {
  const out = show("[ok](https://example.com) [bad](javascript:alert(1))");
  const links = out.querySelectorAll("a");
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("href"), "https://example.com/");
  assert.ok(!out.innerHTML.includes("javascript:alert(1)\""));
});

test("the copied core files are exactly the recorded core version", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const dir = path.join(__dirname, "..", "..", "src", "core");
  const record = JSON.parse(fs.readFileSync(path.join(dir, "core-version.json"), "utf8"));
  for (const [file, hash] of Object.entries(record.files)) {
    const text = fs.readFileSync(path.join(dir, file));
    assert.equal(crypto.createHash("sha256").update(text).digest("hex"), hash, file);
    assert.match(text.toString(), new RegExp(`Pilot core ${record.coreVersion.replace(/\./g, "\\.")}`), file);
  }
});
