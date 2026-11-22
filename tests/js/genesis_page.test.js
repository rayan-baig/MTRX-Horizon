// The Genesis page script, read as text and run in parts in Node:
// `node --test tests/js/genesis_page.test.js`. tests/test_genesis.py runs it too.
//
// 1.14.0: a step with no hint printed the word "null" under "Your next
// step", because `box.append(..., null, ...)` writes null as text. Every
// child the page adds now goes through put() or fill(), which leave empty
// spots out; these tests keep it that way.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "..", "static", "js", "genesis.js"), "utf8");

// The body of a function declared in genesis.js, by name.
function functionSource(name) {
  const plain = source.indexOf(`  function ${name}(`);
  const start = plain >= 0 ? plain : source.indexOf(`  async function ${name}(`);
  assert.ok(start >= 0, `genesis.js has no function ${name}`);
  const end = source.indexOf("\n  }\n", start);
  return source.slice(start, end + 4);
}

// A stand-in for a DOM node that records what it was given, as a browser
// would: null becomes the text "null".
function fakeNode() {
  const node = { kids: [] };
  node.append = (...kids) => { node.kids.push(...kids.map((k) => (k === null ? "null" : k === undefined ? "undefined" : k))); };
  node.replaceChildren = (...kids) => { node.kids = []; node.append(...kids); };
  node.text = () => node.kids.join("|");
  return node;
}

test("nothing in genesis.js adds children except through put() and fill()", () => {
  const helpers = functionSource("put") + functionSource("fill");
  const rest = source.replace(functionSource("put"), "").replace(functionSource("fill"), "");
  for (const call of [".append(", ".replaceChildren(", ".prepend(", ".before(", ".after(", ".appendChild(", ".replaceWith("]) {
    assert.equal(rest.split(call).length - 1, 0, `genesis.js calls ${call} outside put() and fill()`);
  }
  assert.equal(helpers.split(".append(").length - 1, 1);
  assert.equal(helpers.split(".replaceChildren(").length - 1, 1);
});

test("put() and fill() leave empty spots out, so null is never drawn", () => {
  // Run the two helpers exactly as written in genesis.js.
  const { put, fill } = new Function(`${functionSource("put")}\n${functionSource("fill")}\nreturn { put, fill };`)();
  const box = fakeNode();
  put(box, "Your next step", "Tell three people", null, undefined, "Done");
  assert.equal(box.text(), "Your next step|Tell three people|Done");
  assert.ok(!box.text().includes("null"));
  fill(box, null, "only this", undefined);
  assert.equal(box.text(), "only this");
  fill(box);
  assert.equal(box.text(), "");
  assert.equal(put(box, "x"), box, "put() returns the node, as el() needs");
});

test("el() adds its children through put()", () => {
  const el = functionSource("el");
  assert.match(el, /return put\(node, \.\.\.children\);/);
});

test("the next step card passes a missing hint and a missing Ask button as empty spots", () => {
  const next = functionSource("nextBox");
  assert.match(next, /step\.hint \? el\("small", \{ text: step\.hint \}\) : null/);
  assert.match(next, /put\(box, el\("span", \{ class: "g-next-label", text: "Your next step" \}\)/);
});

test("a returning visitor gets the Continue card, then their projects; a first visit starts with the hero", () => {
  const list = functionSource("drawList");
  // 1.17.0: the Continue card (in the hero's place) comes first, then the projects.
  assert.match(list, /const anchor = projects\.length \? \(hero\.nextElementSibling === mine \? mine : hero\.nextElementSibling\)/);
  assert.match(list, /view\.insertBefore\(mine, anchor\)/);
  assert.match(list, /drawContinue\(sorted\);/);
  assert.match(list, /drawPro\(\);/);
});

test("Genesis Pro shows only after a first project or a first ask", () => {
  const pro = functionSource("drawPro");
  for (const reason of ["projects.length > 0", "askedNow", "askedOnce()", "isPro()", "S.readProKey(local)", 'window.location.hash === "#pro"']) {
    assert.ok(pro.includes(reason), reason);
  }
  // Any answer from the server counts as a first ask.
  const send = functionSource("send");
  assert.match(send, /keepAllowance\(data\);\n\s+noteAsked\(\);/);
});

test("the free answers left today are shown from what the server says", () => {
  const panel = functionSource("askPanel");
  assert.match(panel, /el\("p", \{ class: "g-ask-left", role: "status", text: freeText\(\) \}\)/);
  assert.match(panel, /Ask Genesis is free here, with the limits above\. Pilot, the robot in the corner, works with a grown-up's own AI key, with no limit\./);
  assert.match(functionSource("loadAllowance"), /fetch\("\/api\/genesis\/ask", \{ credentials: "omit" \}\)/);
});

// 1.15.0: the limit is said up front, and at the limit the buttons wait.
test("the limit line comes first, above the quick questions and Ask", () => {
  const panel = functionSource("askPanel");
  assert.match(panel, /el\("section", \{ class: "panel g-ask" \}, head, left, wait,\n\s+el\("div", \{ class: "g-helpers" \}, \.\.\.buttons\), form,/);
  assert.match(panel, /if \(left\) \{ gate\(panel, freeBlockedNow\(\)\); setTimeout\(drawAllowance, 0\); \}/);
});

test("at the hourly limit the quick questions and Ask grey out, and come back by themselves", () => {
  // Run gate() as written, on a stand-in panel.
  const { gate } = new Function(`${functionSource("gate")}\nreturn { gate };`)();
  const buttons = [{ disabled: false }, { disabled: false }, { disabled: false }];
  const classes = new Set();
  const panel = {
    classList: { contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    querySelectorAll: (sel) => { assert.equal(sel, ".g-helper, .g-question input, .g-question button"); return buttons; },
  };
  gate(panel, true);
  assert.ok(buttons.every((b) => b.disabled) && classes.has("g-ask-wait"));
  gate(panel, false);
  assert.ok(buttons.every((b) => !b.disabled) && !classes.has("g-ask-wait"));
  // A panel busy sending is left alone (send() manages it).
  classes.add("busy");
  gate(panel, true);
  assert.ok(buttons.every((b) => !b.disabled));
  // The page keeps the server's wait as a moment, and looks again when it's over.
  const keep = functionSource("keepAllowance");
  assert.match(keep, /wait_until: seconds > 0 \? Date\.now\(\) \+ seconds \* 1000 : 0/);
  const draw = functionSource("drawAllowance");
  assert.match(draw, /allowanceAsked = false;\n\s+loadAllowance\(\)\.finally\(drawAllowance\);/);
  assert.match(draw, /line\.classList\.toggle\("wait", blocked\)/);
});

test("a returning visitor gets a smaller welcome", () => {
  assert.match(functionSource("drawList"), /classList\.toggle\("g-hero-small", projects\.length > 0\)/);
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "static", "css", "genesis.css"), "utf8");
  assert.match(css, /\.g-hero-small \.g-eyebrow, \.g-hero-small \.g-text \{ display: none; \}/);
});

// ---------------------------------------------------------------- 1.16.0 review fixes

test("1.16.0: a spark that became a project says Open <project> and opens it", () => {
  const draw = functionSource("drawDaily");
  assert.ok(draw.includes("const made = sparkProject(today);"));
  assert.ok(draw.includes('$("g-daily-project").textContent = made ? `Open ${made.name} →` : "Turn it into a project →";'));
  assert.ok(source.includes('if (made) { window.location.hash = `#p/${made.id}`; return; }'));
  // Starting the project from the spark records it.
  assert.ok(source.includes("sparkDay: today };"));
  assert.ok(source.includes("if (formSpark) { const day = formSpark; extras.edit((x) => { x.links[day] = made.project.id; }); formSpark = null; }"));
});

test("1.16.0: the last Ask answer is kept per project across reloads, and scrolled into view when it comes", () => {
  assert.ok(source.includes("for (const [id, a] of Object.entries(extras.load().answers)) answers[id] ="));
  const answered = functionSource("answered");
  assert.ok(answered.includes("if (result && result.text) keepAnswer(p.id, result);"));
  assert.ok(answered.includes('shown.scrollIntoView({ block: "nearest"'));
  assert.equal((source.match(/answered\(p, result\);/g) || []).length, 2); // the server's answer and the visitor's own key
  // Deleting forgets it too.
  assert.ok(source.includes("extras.forget(p.id);") && source.includes("extras.forget();"));
});

test("1.16.0: the last stage tile says Live (never cut short), and Delete all is under More", () => {
  assert.ok(source.includes('el("span", { text: "Live", title: "Launched: every step done" })'));
  assert.ok(!source.includes('el("span", { text: "Launched" })'));
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "templates", "genesis.html"), "utf8");
  const more = page.split('<details class="g-more" id="g-more">', 2)[1].split("</details>", 1)[0];
  assert.ok(more.includes("<summary class=\"g-tool\">More</summary>") && more.includes('id="g-delete-all"'));
  assert.ok(source.includes("if (!confirm(`Delete all ${projects.length} project"));
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "static", "css", "genesis.css"), "utf8");
  assert.ok(!/\.g-path span \{[^}]*text-overflow: ellipsis/.test(css));
});

// ---------------------------------------------------------------- 1.17.0

test("a returning visitor sees 'Welcome back', their project's name, and its next three steps to tick", () => {
  const cont = functionSource("drawContinue");
  assert.match(cont, /sorted\.find\(\(q\) => !S\.progress\(q\)\.launched\)/);
  // 1.19.0: "Continue <project>" looked like a button and wasn't; the
  // heading greets. 1.21.0: the name under it is plain words: a link there
  // too was a second way to the same place as the Continue button.
  assert.match(cont, /el\("h1", \{ class: "g-continue-title" \}, el\("span", \{ text: "Welcome " \}\), el\("b", \{ text: "back" \}\)\)/);
  assert.match(cont, /el\("b", \{ class: "g-continue-name", text: p\.name \}\)/);
  assert.doesNotMatch(cont.split('class: "g-continue-project"')[1].split("nextSteps(p)")[0], /href/);
  assert.equal(cont.split("href: `#p/${p.id}`").length - 1, 1, "one link to the project: the Continue button");
  assert.doesNotMatch(cont, /text: "Continue " \}/);
  assert.match(cont, /nextSteps\(p\),/);
  // The next three steps, each ticked through update(), like the checklist.
  const next = functionSource("nextSteps");
  assert.match(next, /const steps = openSteps\(p, 3\);/);
  assert.match(next, /el\("input", \{ type: "checkbox" \}\)/);
  assert.match(next, /update\(p, \(q\) => \{ q\.ticks\[item\.key\] = true; \}\);/);
  assert.match(next, /tickCheer\(p, item\.stage\);\n\s+drawList\(\);/);
  // This stage's steps first, then the stages after it.
  const open = functionSource("openSteps");
  const S = { STAGES: [{ key: "spark" }, { key: "plan" }, { key: "build" }, { key: "launch" }],
    steps: () => [{ key: "a", stage: "spark" }, { key: "b", stage: "plan" }, { key: "c", stage: "plan" }, { key: "d", stage: "build" }, { key: "e", stage: "launch" }] };
  const openSteps = new Function("S", `${open}; return openSteps;`)(S);
  assert.deepEqual(openSteps({ stage: "plan", ticks: { b: true } }, 3).map((i) => i.key), ["c", "d", "e"]);
  assert.deepEqual(openSteps({ stage: "build", ticks: {} }, 3).map((i) => i.key), ["d", "e", "a"]);
  assert.deepEqual(openSteps({ stage: "spark" }, 2).map((i) => i.key), ["a", "b"]);
  assert.match(cont, /classList\.toggle\("g-hero-back", sorted\.length > 0\)/);
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "static", "css", "genesis.css"), "utf8");
  assert.match(css, /\.g-hero\.g-hero-back \.g-hero-copy \{ display: none; \}/);
});

test("at the free limit: a 'While you wait' line with useful buttons, not only greyed-out ones", () => {
  const wait = functionSource("waitBox");
  assert.match(wait, /text: "Tick your next step"/);
  assert.match(wait, /el\("b", \{ text: "While you wait:" \}\)/);
  assert.match(wait, /text: "Use Pilot with your own AI key"/);
  assert.match(wait, /window\.Pilot\.open\(\)/);
  assert.match(wait, /"More answers a day with Genesis Pro"/);
  assert.match(wait, /document\.getElementById\("pro"\) && !isPro\(\)/);
  assert.match(functionSource("askPanel"), /const wait = left \? waitBox\(p\) : null;/);
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "static", "css", "genesis.css"), "utf8");
  assert.match(css, /\.g-wait \{ display: none;/);
  assert.match(css, /\.g-ask\.g-ask-wait \.g-wait \{ display: grid;/);
  // The wait box's buttons aren't the ones gate() greys out.
  assert.match(functionSource("gate"), /"\.g-helper, \.g-question input, \.g-question button"/);
});

test("small rewards: ticking a step or a stage, or a longer streak, cheers; never under reduce motion", () => {
  const stages = [{ key: "spark", name: "Spark", done: 3, total: 3 }, { key: "plan", name: "Plan", done: 1, total: 5 }];
  const run = (pr, stage) => {
    const out = [];
    const t = { textContent: "", classList: { add() {}, remove() {}, toggle() {} }, offsetWidth: 1 };
    const fns = new Function("$", "toast", "S", `${functionSource("cheer")}\n${functionSource("tickCheer")}\nreturn { tickCheer };`)(
      () => t, (x) => out.push(x), { progress: () => pr });
    fns.tickCheer({ name: "Plant Pal" }, stage);
    return out[0];
  };
  assert.equal(run({ launched: false, done: 4, total: 19, stages }, "spark"), "Spark done! Every Spark step is ticked.");
  assert.equal(run({ launched: false, done: 4, total: 19, stages }, "plan"), "Nice! 4 of 19 steps done.");
  assert.equal(run({ launched: true, done: 19, total: 19, stages }, "plan"), "Plant Pal is launched!");
  assert.match(source, /if \(box\.checked\) tickCheer\(p, item\.stage\);/);
  assert.match(source, /if \(first && st\.streak > 1\) cheer\(`\$\{st\.streak\} days in a row!`\);/);
  assert.equal((source.match(/cheer\(`On to \$\{next\.name\}!`\)/g) || []).length, 2);
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "static", "css", "genesis.css"), "utf8");
  const still = css.split("@media (prefers-reduced-motion: reduce)").pop();
  assert.match(still, /\.g-toast\.cheer::before, \.g-toast\.cheer::after \{ animation: none; display: none; \}/);
});

test("the project on a computer: notes go under the shorter column, never leaving a big gap", () => {
  const project = functionSource("drawProject");
  assert.match(project, /fill\(\$\("g-detail"\), head, el\("div", \{ class: "g-columns" \}, main, side\)\);\n\s+balanceColumns\(main, side, notes, danger\);/);
  assert.doesNotMatch(project, /g-lower/);
  assert.match(functionSource("balanceColumns"), /extras\.some\(\(x\) => x\.contains\(document\.activeElement\)\)/);
});

// A tiny layout: each node's height is its own plus its children's.
function layoutNode(own, kids = []) {
  const node = { own, kids: [], isConnected: true, parent: null };
  node.getBoundingClientRect = () => ({ height: node.own + node.kids.reduce((h, k) => h + k.getBoundingClientRect().height, 0) });
  node.append = (...more) => { for (const k of more) { if (k.parent) k.remove(); k.parent = node; node.kids.push(k); } };
  node.remove = () => { if (node.parent) { node.parent.kids = node.parent.kids.filter((k) => k !== node); node.parent = null; } };
  node.contains = (x) => x === node;
  node.append(...kids);
  return node;
}

test("1.19.0: at the free limit (a tall Ask Genesis) the notes fill the space under the checklist", () => {
  const run = (checklistH, sideH) => {
    const notes = layoutNode(200);
    const danger = layoutNode(80);
    const main = layoutNode(0, [layoutNode(checklistH)]);
    const side = layoutNode(0, [layoutNode(sideH)]);
    const fns = new Function("put", "window", "document", "requestAnimationFrame",
      `let balanceWatch = null;\n${functionSource("balanceColumns")}\nreturn balanceColumns;`)(
      (n, ...k) => { n.append(...k); return n; }, {}, { activeElement: null }, () => {});
    fns(main, side, notes, danger);
    return { notes: notes.parent === main ? "main" : "side", danger: danger.parent === main ? "main" : "side" };
  };
  // Ask Genesis at the limit makes the side column far taller: notes go left.
  assert.deepEqual(run(600, 840), { notes: "main", danger: "main" });
  assert.deepEqual(run(600, 1100), { notes: "main", danger: "main" });
  assert.deepEqual(run(700, 840), { notes: "main", danger: "side" });
  // A long, open checklist: notes go to the side instead.
  assert.deepEqual(run(1200, 500), { notes: "side", danger: "side" });
});

// ---------------------------------------------------------------- 1.21.0

test("phones: a two-line intro and compact steps on a first visit, today's spark straight after 'Welcome back'", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "templates", "genesis.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "static", "css", "genesis.css"), "utf8");
  const late = css.split("/* ---------- 1.21.0 ---------- */")[1];
  assert.ok(late, "genesis.css has its 1.21.0 part");
  const intro = page.split('<p class="g-intro">')[1].split("</p>")[0];
  assert.ok(intro.length <= 70, "short enough for two lines on a phone");
  assert.match(intro, /Free, and it stays in this browser\./);
  const phone = late.split("@media (max-width: 720px) {")[1].split("\n}\n")[0];
  assert.match(phone, /\.g-hero:not\(\.g-hero-small\) \.g-line, \.g-hero:not\(\.g-hero-small\) \.g-text \{ display: none; \}/);
  assert.match(phone, /\.g-hero:not\(\.g-hero-small\) \.g-intro \{ display: block;/);
  assert.match(phone, /\.g-how strong \{ display: inline;/);
  assert.match(phone, /#g-list-view\.g-returning > \.g-hero \{ order: -2; \}/);
  assert.match(phone, /#g-list-view\.g-returning > \.g-daily \{ order: -1; \}/);
  // The view's class is its own: ".g-back" is the "← All projects" link's
  // (it greyed today's spark and the greeting when first tried).
  assert.match(functionSource("drawList"), /view\.classList\.toggle\("g-returning", projects\.length > 0\);/);
  assert.doesNotMatch(css, /#g-list-view\.g-back/);
  // A computer: the next steps fill the welcome's right half.
  const wide = late.split("@media (min-width: 901px) {")[1].split("\n}\n")[0];
  assert.match(wide, /\.g-hero\.g-hero-back \.g-continue > \.g-continue-next \{\n\s+grid-column: 2; grid-row: 1 \/ span 4;/);
});
