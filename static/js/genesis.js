// The Genesis page: a visitor's own projects, kept in their own browser.
// Nothing here talks to the server but Ask Genesis. Every word a visitor
// typed is placed with textContent, never as HTML. When Genesis Pro is on,
// static/js/genesis-pro.js (window.GenesisPro) handles the key and the
// backup; this file only asks it whether this browser has Pro.
// When the visitor has set their own AI key in Pilot (static/pilot/), Ask
// Genesis uses it from the browser instead (static/js/genesis-ask.js), and
// window.GenesisBridge lets Pilot's Genesis tools read and change projects
// through the same functions the page's own buttons use.
(() => {
  const S = window.GenesisStore;
  const $ = (id) => document.getElementById(id);
  const store = S.open((() => { try { return window.localStorage; } catch (_) { return null; } })());
  let projects = store.load();
  let current = null;
  let addressEdited = false;
  let notesTimer = null;
  const aiOn = $("genesis").dataset.ai === "on";
  // The visitor's own AI key, set in Pilot: Ask Genesis then runs in this
  // browser with it, with no free daily limit. Genesis Pro is unchanged.
  // Its words (static/js/genesis-ask.js) are fetched the first time they're needed.
  let Ask = window.GenesisAsk || null;
  const ownKey = () => Boolean(window.Pilot && window.Pilot.ready() && !isPro());
  function loadAsk() {
    if (Ask) return Promise.resolve(Ask);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = $("genesis").dataset.ask;
      s.onload = () => { Ask = window.GenesisAsk || null; if (Ask) resolve(Ask); else reject(new Error("missing")); };
      s.onerror = () => reject(new Error("load"));
      put(document.head, s);
    });
  }
  const aiUsable = () => aiOn || ownKey();
  const answers = {}; // the last Ask Genesis answer per project, for this visit only
  let asking = false;
  const Pro = window.GenesisPro || null; // only while Genesis Pro is switched on
  const isPro = () => Boolean(Pro && Pro.active());
  const proOffered = Boolean(document.getElementById("pro")); // Pro is switched on here
  const base = $("genesis").dataset.base || "";
  const local = (() => { try { return window.localStorage; } catch (_) { return null; } })();
  const daily = S.openDaily(local);
  let prefill = null; // what the form starts with next time it opens

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    return put(node, ...children);
  }

  // Every child added to the page goes through these two, so an empty spot
  // (a step with no hint, a button that isn't offered) is left out: never
  // drawn as the word "null". tests/js/genesis_page.test.js checks that
  // nothing in this file adds children any other way.
  function put(node, ...children) {
    node.append(...children.filter((child) => child != null));
    return node;
  }
  function fill(node, ...children) {
    node.replaceChildren(...children.filter((child) => child != null));
    return node;
  }

  function meter(done, total, cls = "") {
    const bar = el("progress", { class: `g-bar ${cls}`, max: String(total) });
    bar.value = done;
    bar.textContent = `${done} of ${total}`;
    return bar;
  }

  let toastTimer = null;
  function toast(text, bad = false) {
    const t = $("g-toast");
    t.textContent = text;
    t.classList.toggle("bad", bad);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  function persist() {
    const saved = store.save(projects);
    if (!saved && store.usable) toast("Your browser wouldn't save that. Download a copy to keep it.", true);
    drawStorageNote();
    if (Pro) Pro.changed(); // a Pro browser backs up a little later
  }

  function drawStorageNote() {
    $("g-storage-note").hidden = store.usable;
  }

  const stageOf = (key) => S.STAGES.find((s) => s.key === key) || S.STAGES[0];
  const when = (t) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

  // ---------------------------------------------------------------- list

  function drawList() {
    const sorted = projects.slice().sort((a, b) => b.updated - a.updated);
    $("g-count").textContent = projects.length ? `${projects.length} project${projects.length === 1 ? "" : "s"}` : "";
    $("g-empty").hidden = projects.length > 0;
    $("g-tools-data").hidden = projects.length === 0;
    // A first visit sees how Genesis works; a returning one, where their projects are.
    $("g-list-head").hidden = projects.length === 0;
    $("g-how").hidden = projects.length > 0;
    $("g-path").hidden = projects.length === 0;
    // A returning visitor's projects come first; a first visit starts at the top.
    const view = $("g-list-view");
    const mine = $("g-mine");
    const anchor = projects.length ? view.firstElementChild : $("g-storage-note").nextElementSibling;
    if (anchor !== mine) view.insertBefore(mine, anchor);
    drawDaily();
    drawPro();
    const cards = $("g-cards");
    cards.hidden = projects.length === 0;
    fill(cards, ...sorted.map(card));
    const path = $("g-path");
    fill(path, ...S.STAGES.map((s) => el("li", { class: `stage-${s.key}` },
      el("b", { text: String(projects.filter((p) => p.stage === s.key && !S.progress(p).launched).length) }),
      el("span", { text: s.name }))),
    el("li", { class: "stage-launched" },
      el("b", { text: String(projects.filter((p) => S.progress(p).launched).length) }), el("span", { text: "Launched" })));
  }

  // Genesis Pro shows only once it could matter: after a first project or a
  // first ask, in a browser that has a Pro key, or when the address asks
  // for it (#pro, as checkout's "back" link does).
  const ASKED_KEY = "genesis-asked";
  let askedNow = false;
  const askedOnce = () => { try { return Boolean(local && local.getItem(ASKED_KEY)); } catch (_) { return false; } };
  function noteAsked() {
    try { if (local) local.setItem(ASKED_KEY, "1"); } catch (_) { /* shown for this visit anyway */ }
    askedNow = true;
    drawPro();
  }
  function drawPro() {
    const section = document.getElementById("pro");
    if (!section) return;
    section.hidden = !(projects.length > 0 || askedNow || askedOnce() || isPro()
      || Boolean(S.readProKey(local)) || window.location.hash === "#pro");
  }

  function card(p) {
    const pr = S.progress(p);
    const look = pr.launched ? "launched" : p.stage;
    const segs = el("span", { class: "g-segs" }, ...pr.stages.map((s) =>
      el("span", { class: `g-seg stage-${s.key}${s.key === p.stage ? " here" : ""}` },
        meter(s.done, s.total), el("small", { text: s.name }))));
    return el("li", { class: `g-card stage-${look}` },
      el("a", { href: `#p/${p.id}` },
        el("span", { class: "g-card-top" },
          el("span", { class: `g-chip stage-${look}`, text: pr.launched ? "Launched" : stageOf(p.stage).name }),
          p.address ? el("span", { class: "g-address", text: p.address }) : null),
        el("b", { class: "g-card-name", text: p.name }),
        el("span", { class: "g-card-pitch", text: p.pitch }),
        el("span", { class: "g-card-for", text: `For ${p.audience}` }),
        segs,
        el("span", { class: "g-card-total" }, meter(pr.done, pr.total, "big"),
          el("small", { text: `${pr.percent}% · ${pr.done} of ${pr.total} done` }))));
  }

  // ---------------------------------------------------------------- today's spark
  // A new prompt every day, answered in one line. The answers and the streak
  // live only in this browser (GenesisStore.openDaily). It never nags: no
  // reminders, no countdowns, and a missed day is covered by a freeze.

  const DOT_WORDS = { done: "spark saved", frozen: "covered by your freeze", missed: "no spark", today: "today" };
  let editingDaily = false;
  const longDay = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  };

  function drawDaily() {
    const now = new Date();
    const today = S.dayKey(now);
    const days = daily.load();
    const answer = days[today] || "";
    const st = S.streak(days, today);
    $("g-daily").hidden = false;
    $("g-daily-date").textContent = `· ${now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}`;
    $("g-daily-title").textContent = S.promptFor(today).text;
    const writing = !answer || editingDaily;
    $("g-daily-form").hidden = !writing;
    $("g-daily-done").hidden = writing;
    $("g-daily-answer").textContent = answer;
    $("g-daily").classList.toggle("done", Boolean(answer) && !editingDaily);

    const streakLine = $("g-streak");
    streakLine.hidden = st.streak === 0;
    fill(streakLine, el("b", { text: String(st.streak) }),
      el("span", { text: st.streak === 1 ? " day streak" : " days in a row" }),
      ...(st.freezes ? [el("small", { class: "g-freeze", text: "1 freeze ready" })] : []));

    fill($("g-week"), ...S.lastDays(days, today, 7).map((d) => {
      const [y, m, dd] = d.key.split("-").map(Number);
      const letter = new Date(y, m - 1, dd).toLocaleDateString([], { weekday: "narrow" });
      return el("li", { class: `g-day ${d.state}`, title: `${longDay(d.key)}: ${DOT_WORDS[d.state]}` },
        el("span", { class: "g-day-dot", "aria-hidden": "true" }),
        el("small", { text: letter }),
        el("span", { class: "visually-hidden", text: `${longDay(d.key)}: ${DOT_WORDS[d.state]}` }));
    }));

    const yesterday = S.dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    let note;
    if (!answer && st.frozen.includes(yesterday)) note = "You had a day off yesterday, so your freeze covered it. Your streak is safe.";
    else if (answer && !st.freezes) note = `A new spark arrives tomorrow. Your freeze comes back after ${st.toEarn} more spark${st.toEarn === 1 ? "" : "s"}.`;
    else if (answer) note = "A new spark arrives tomorrow. Come back if you like: one day off is covered by your freeze.";
    else if (st.total) note = st.streak ? "One line is enough. Your answers stay in this browser."
      : "Start a new streak today. Every streak comes with a freeze for a day off.";
    else note = "One line is enough, and it stays in this browser. Answer on more days to build a streak; one day off won't reset it.";
    $("g-daily-note").textContent = note;

    const past = Object.keys(days).filter((k) => k !== today).sort().reverse().slice(0, 30);
    $("g-daily-more").hidden = past.length === 0;
    fill($("g-daily-past"), ...past.map((k) => el("li", {},
      el("small", { text: `${longDay(k)} · ${S.promptFor(k).text}` }), el("span", { text: days[k] }))));
  }

  $("g-daily-input").maxLength = S.DAILY_LIMIT;
  $("g-daily-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = S.line($("g-daily-input").value).slice(0, S.DAILY_LIMIT);
    if (!text) { $("g-daily-input").focus(); toast("Write one line first: any idea counts."); return; }
    const today = S.dayKey(new Date());
    const days = daily.load();
    const first = !days[today];
    days[today] = text;
    if (!daily.save(days) && daily.usable) toast("Your browser wouldn't save that.", true);
    editingDaily = false;
    $("g-daily-input").value = "";
    const st = S.streak(days, today);
    drawDaily();
    // Said inside the card, under the answer, where it covers nothing.
    $("g-daily-saved").textContent = first
      ? (st.streak > 1 ? `Spark saved. ${st.streak} days in a row!` : "Spark saved. Nice one.")
      : "Spark changed.";
  });
  $("g-daily-edit").addEventListener("click", () => {
    editingDaily = true;
    $("g-daily-saved").textContent = "";
    drawDaily();
    $("g-daily-input").value = daily.load()[S.dayKey(new Date())] || "";
    $("g-daily-input").focus();
  });
  $("g-daily-project").addEventListener("click", () => {
    const answer = daily.load()[S.dayKey(new Date())];
    if (!answer) return;
    prefill = { pitch: answer.slice(0, S.LIMITS.pitch), note: "From today's spark. Give it a name and say who it's for." };
    window.location.hash = "#new";
  });
  $("g-daily-clear").addEventListener("click", () => {
    if (!confirm("Clear all your sparks from this browser? Your streak starts again.")) return;
    daily.clear();
    editingDaily = false;
    toast("Sparks cleared from this browser.");
    drawDaily();
  });

  // ---------------------------------------------------------------- the form

  function count(input, out, limit) {
    out.textContent = `${input.value.length}/${limit}`;
    out.classList.toggle("over", input.value.length > limit);
  }

  function say(field, text, kind = "") {
    const out = $(`g-${field}-msg`);
    out.textContent = text || "";
    out.className = `g-msg${kind ? " " + kind : ""}`;
  }

  function drawAddress() {
    const v = $("g-address").value.trim();
    if (!v) { say("address", "Optional. You can decide later."); return; }
    const bad = S.addressProblem(v);
    if (bad) say("address", bad, "bad");
    else say("address", "Looks like a real address. Check it's free with a domain registrar.", "ok");
  }

  function showForm(start) {
    $("g-form").reset();
    addressEdited = false;
    $("g-example-note").textContent = "";
    for (const f of ["name", "pitch", "audience"]) {
      say(f, "");
      count($(`g-${f}`), $(`g-${f}-count`), S.LIMITS[f]);
    }
    drawAddress();
    $("g-form-error").textContent = "";
    if (start) fillForm(start);
    if (window.matchMedia("(min-width: 721px)").matches) $("g-name").focus({ preventScroll: true });
  }

  // Put an example (or today's spark) into the form. Nothing is saved until
  // Start is pressed, and every word can be changed first.
  function fillForm(start) {
    for (const f of ["name", "pitch", "audience"]) {
      if (typeof start[f] !== "string") continue;
      $(`g-${f}`).value = start[f].slice(0, S.LIMITS[f]);
      count($(`g-${f}`), $(`g-${f}-count`), S.LIMITS[f]);
      say(f, "");
    }
    if (!addressEdited) { $("g-address").value = S.suggestAddress($("g-name").value); drawAddress(); }
    $("g-example-note").textContent = start.note || "";
  }

  let exampleAt = -1;
  function nextExample() {
    exampleAt = exampleAt < 0 ? S.example().index : exampleAt + 1;
    const ex = S.example(exampleAt);
    return { ...ex, note: "An example to start from. Change any of it to make it yours." };
  }
  $("g-example").addEventListener("click", () => fillForm(nextExample()));

  for (const f of ["name", "pitch", "audience"]) {
    $(`g-${f}`).maxLength = S.LIMITS[f]; // the same limit the counter shows
    $(`g-${f}`).addEventListener("input", () => {
      count($(`g-${f}`), $(`g-${f}-count`), S.LIMITS[f]);
      if (f !== "name") say(f, "");
    });
  }
  $("g-name").addEventListener("input", () => {
    const warning = S.nameWarning($("g-name").value);
    say("name", warning || "", warning ? "warn" : "");
    if (!addressEdited) { $("g-address").value = S.suggestAddress($("g-name").value); drawAddress(); }
  });
  $("g-address").addEventListener("input", () => {
    addressEdited = $("g-address").value !== "";
    drawAddress();
  });

  $("g-form").addEventListener("submit", (event) => {
    event.preventDefault();
    $("g-form-error").textContent = "";
    if (projects.length >= S.LIMITS.projects) {
      $("g-form-error").textContent = `Genesis holds ${S.LIMITS.projects} projects. Delete one to start another.`;
      return;
    }
    const made = S.create({
      name: $("g-name").value, pitch: $("g-pitch").value,
      audience: $("g-audience").value, address: $("g-address").value,
    });
    if (made.errors) {
      let first = null;
      for (const [field, why] of Object.entries(made.errors)) {
        say(field, why, "bad");
        first = first || field;
      }
      $(`g-${first}`).focus();
      return;
    }
    projects.push(made.project);
    persist();
    toast("Project started.");
    window.location.hash = `#p/${made.project.id}`;
  });

  // ---------------------------------------------------------------- one project

  function update(p, change) {
    change(p);
    p.updated = Date.now();
    persist();
  }

  function track(p, pr) {
    const here = S.STAGES.findIndex((s) => s.key === p.stage);
    return el("ol", { class: "g-track" }, ...S.STAGES.map((s, i) =>
      el("li", { class: `stage-${s.key}${i < here ? " past" : ""}${i === here ? " here" : ""}` },
        el("span", { class: "g-dot" }), el("b", { text: s.name }),
        el("small", { text: `${pr.stages[i].done}/${pr.stages[i].total}` }))));
  }

  function drawProject(p) {
    // Notes still waiting to save go in first, so a redraw can't lose them.
    if (current && current.id === p.id) flushNotes();
    current = p;
    const pr = S.progress(p);
    const here = S.STAGES.findIndex((s) => s.key === p.stage);
    const look = pr.launched ? "launched" : p.stage;

    const head = el("section", { class: `panel g-head stage-${look}` },
      el("a", { class: "g-back", href: "#" }, "← All projects"),
      el("span", { class: "g-card-top" },
        el("span", { class: `g-chip stage-${look}`, text: pr.launched ? "Launched" : stageOf(p.stage).name }),
        p.address ? el("span", { class: "g-address", text: p.address }) : null),
      el("h1", { class: "g-name", text: p.name }),
      el("p", { class: "g-pitch", text: p.pitch }),
      el("p", { class: "g-for" }, el("span", { text: "For " }), el("b", { text: p.audience })),
      el("p", { class: "g-started", text: `Started ${when(p.created)}` }),
      nextBox(p, pr),
      el("div", { class: "g-head-actions" }, shareButton(p), vortexLink(p), planButton(p)));

    const moves = el("div", { class: "g-moves" });
    if (here > 0) {
      const back = el("button", { class: "btn btn-ghost btn-small", type: "button", text: `← Back to ${S.STAGES[here - 1].name}` });
      back.addEventListener("click", () => { update(p, (q) => { q.stage = S.STAGES[here - 1].key; }); drawProject(p); });
      put(moves, back);
    }
    if (here < S.STAGES.length - 1) {
      const next = S.STAGES[here + 1];
      const fwd = el("button", { class: "btn btn-genesis btn-small", type: "button", text: `Move to ${next.name} →` });
      fwd.addEventListener("click", () => { update(p, (q) => { q.stage = next.key; }); toast(`On to ${next.name}.`); drawProject(p); });
      put(moves, fwd);
    }
    const left = pr.total - pr.done;
    let note;
    if (pr.launched) note = "Launched. Every step is done: well done.";
    else if (p.stage === "launch") note = `${left} step${left === 1 ? "" : "s"} left before it's launched.`;
    else note = `You're at ${stageOf(p.stage).name}. Tick steps in any order; move on when it feels right.`;
    const stagePanel = el("section", { class: `panel g-progress${pr.launched ? " launched" : ""}` },
      el("h2", { class: "g-h2" }, "Stage"),
      track(p, pr), moves,
      el("div", { class: "g-overall" },
        el("strong", { text: `${pr.percent}%` }),
        el("span", {}, meter(pr.done, pr.total, "big"), el("small", { text: `${pr.done} of ${pr.total} steps done` }))),
      el("p", { class: "g-note", text: note }));

    const all = S.steps(p);
    const groups = pr.stages.map((s, at) => {
      const items = all.filter((i) => i.stage === s.key).map((item) => {
        const box = el("input", { type: "checkbox" });
        box.checked = Boolean(p.ticks[item.key]);
        box.addEventListener("change", () => {
          update(p, (q) => { if (box.checked) q.ticks[item.key] = true; else delete q.ticks[item.key]; });
          const after = S.progress(p);
          if (after.launched) toast(`${p.name} is launched!`);
          drawProject(p);
        });
        // Hide a step that doesn't fit this idea (it can come back), or
        // remove one of the visitor's own.
        const hide = el("button", { class: "g-item-hide", type: "button",
          "aria-label": `${item.custom ? "Remove" : "Hide"} “${item.label}”`, text: item.custom ? "Remove" : "Hide" });
        hide.addEventListener("click", () => {
          let result = null;
          update(p, (q) => { result = S.hideStep(q, item.key); });
          if (result.error) { toast(result.error, true); return; }
          toast(result.removed ? "Your step is removed." : "Step hidden. Bring it back under Hidden steps.");
          drawProject(p);
        });
        return el("li", { class: `g-item-row${item.custom ? " mine" : ""}` },
          el("label", { class: `g-item${box.checked ? " done" : ""}` },
            box, el("span", { class: "g-box" }),
            el("span", { class: "g-item-text" }, el("b", { text: item.label }),
              item.hint ? el("small", { text: item.hint }) : item.custom ? el("small", { text: "Your own step" }) : null)),
          hide);
      });
      // Later stages start folded, so the steps that matter now come first;
      // earlier ones stay open while they have steps left. A stage opened or
      // closed by hand stays that way for this visit.
      const remembered = folds[p.id] && folds[p.id][s.key];
      const open = remembered !== undefined ? remembered : at === here || (at < here && s.done < s.total);
      const group = el("details", { class: `g-group stage-${s.key}${s.key === p.stage ? " here" : ""}` },
        el("summary", { class: "g-group-head" },
          el("span", { class: "g-dot" }),
          el("span", {}, el("b", { text: s.name }), el("small", { text: s.line })),
          el("span", { class: "g-group-count", text: `${s.done}/${s.total}` })),
        meter(s.done, s.total),
        el("ul", { class: "g-items" }, ...items),
        addStepForm(p, s));
      group.open = open;
      group.addEventListener("toggle", () => { (folds[p.id] = folds[p.id] || {})[s.key] = group.open; });
      return group;
    });
    const hiddenOnes = S.hiddenSteps(p);
    const hiddenList = hiddenOnes.length ? el("details", { class: "g-hidden-steps" },
      el("summary", { text: `Hidden steps (${hiddenOnes.length})` }),
      el("ul", {}, ...hiddenOnes.map((item) => {
        const back = el("button", { class: "g-tool", type: "button", text: "Show again",
          "aria-label": `Show “${item.label}” again` });
        back.addEventListener("click", () => {
          update(p, (q) => { S.showStep(q, item.key); });
          toast("Step back in the checklist.");
          drawProject(p);
        });
        return el("li", {}, el("span", { text: item.label }), back);
      }))) : null;
    const checklist = el("section", { class: "panel g-checklist" },
      el("h2", { class: "g-h2" }, "Launch checklist"),
      el("p", { class: "g-checklist-note", text: "Every idea is different: hide steps that don't fit yours, and add your own. It all stays in this browser." }),
      ...groups, hiddenList);

    // Notes save themselves a moment after typing stops.
    const area = el("textarea", { class: "g-notes", rows: "8", placeholder: "Ideas, people to ask, links, what you learned…" });
    area.value = p.notes;
    area.maxLength = S.LIMITS.notes;
    const status = el("small", { class: "g-count" });
    const showCount = () => { status.textContent = `${area.value.length}/${S.LIMITS.notes}`; };
    showCount();
    area.addEventListener("input", () => {
      showCount();
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => {
        update(p, (q) => { q.notes = S.block(area.value).slice(0, S.LIMITS.notes); });
        status.textContent = `Saved · ${area.value.length}/${S.LIMITS.notes}`;
      }, 400);
    });
    const notes = el("section", { class: "panel g-notes-panel" },
      el("div", { class: "g-row" }, el("h2", { class: "g-h2" }, "Notes"), status), area);

    const ask = askPanel(p);

    const del = el("button", { class: "g-delete", type: "button", text: "Delete project" });
    del.addEventListener("click", () => {
      if (!confirm(`Delete "${p.name}"? Its checklist and notes go with it.`)) return;
      projects = projects.filter((q) => q.id !== p.id);
      persist();
      toast("Project deleted.");
      window.location.hash = "#";
    });
    const danger = el("section", { class: "panel g-danger" },
      el("p", { text: "Deleting can't be undone, unless you downloaded a copy." }), del);

    fill($("g-detail"), head, el("div", { class: "g-columns" },
      el("div", { class: "g-main" }, checklist),
      el("div", { class: "g-side" }, stagePanel, ask, notes, danger)));
  }

  // Which stages the visitor opened or folded by hand, per project, for this visit.
  const folds = {};

  // "Add a step" under a stage: a button that opens a one-line form.
  function addStepForm(p, s) {
    const input = el("input", { type: "text", class: "g-add-input", autocomplete: "off",
      placeholder: `A step of your own for ${s.name}`, "aria-label": `A step of your own for ${s.name}` });
    input.maxLength = S.LIMITS.step;
    const form = el("form", { class: "g-add-form" }, input,
      el("button", { class: "btn btn-genesis btn-small", type: "submit", text: "Add" }));
    form.hidden = true;
    const open = el("button", { class: "g-add-open", type: "button", text: "+ Add a step" });
    open.addEventListener("click", () => { form.hidden = false; open.hidden = true; input.focus(); });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const copy = { ...p, custom: (p.custom || []).slice() };
      const result = S.addStep(copy, s.key, input.value);
      if (result.error) { toast(result.error, true); input.focus(); return; }
      update(p, (q) => { q.custom = copy.custom; });
      (folds[p.id] = folds[p.id] || {})[s.key] = true;
      toast("Step added.");
      drawProject(p);
    });
    return el("div", { class: "g-add" }, open, form);
  }

  // ---------------------------------------------------------------- the next step
  // One clear thing to do now, at the top of the project, so nobody has to
  // read the whole checklist to know where they are.

  function nextBox(p, pr) {
    const here = S.STAGES.findIndex((s) => s.key === p.stage);
    const box = el("div", { class: `g-next${pr.launched ? " launched" : ""}` });
    if (pr.launched) {
      put(box, el("span", { class: "g-next-label", text: "Launched" }),
        el("b", { class: "g-next-step", text: "Every step is done. Well done!" }),
        el("small", { text: "Make an idea card to show people what you made." }));
      return box;
    }
    const step = S.nextStep(p);
    const stepAt = step ? S.STAGES.findIndex((s) => s.key === step.stage) : S.STAGES.length;
    if (stepAt > here) {
      const next = S.STAGES[here + 1];
      const go = el("button", { class: "btn btn-genesis btn-small", type: "button", text: `Move to ${next.name} →` });
      go.addEventListener("click", () => { update(p, (q) => { q.stage = next.key; }); toast(`On to ${next.name}.`); drawProject(p); });
      put(box, el("span", { class: "g-next-label", text: "Next step" }),
        el("b", { class: "g-next-step", text: `Every ${S.STAGES[here].name} step is done.` }),
        el("small", { text: next.line }), go);
      return box;
    }
    const done = el("button", { class: "btn btn-genesis btn-small", type: "button", text: "Done ✓" });
    done.addEventListener("click", () => {
      update(p, (q) => { q.ticks[step.key] = true; });
      toast(S.progress(p).launched ? `${p.name} is launched!` : "Ticked. On to the next one.");
      drawProject(p);
    });
    // Ask Genesis sits below the whole checklist on a phone; this goes
    // straight to it. Only while AI help is on.
    let ask = null;
    if (aiUsable()) {
      ask = el("button", { class: "btn btn-ghost btn-small g-next-ask", type: "button", text: "Ask Genesis" });
      ask.addEventListener("click", () => {
        const panel = document.querySelector(".g-ask");
        if (!panel) return;
        panel.scrollIntoView({ block: "start", behavior: "smooth" });
        const input = panel.querySelector(".g-question-input");
        if (input) input.focus({ preventScroll: true });
      });
    }
    put(box, el("span", { class: "g-next-label", text: "Your next step" }),
      el("b", { class: "g-next-step", text: step.label }),
      step.hint ? el("small", { text: step.hint }) : null,
      el("div", { class: "g-next-actions" }, done, ask));
    return box;
  }

  // ---------------------------------------------------------------- idea cards
  // A picture of the project to save or send, drawn here in the browser.
  // Only what the card shows leaves this page, and only if the visitor
  // saves or shares it: never the notes or ticks, and nothing is sent to us.

  const STAGE_COLOURS = { spark: "#fbbf24", plan: "#f472b6", build: "#a78bfa", launch: "#22d3ee", launched: "#34e89e" };
  let sharing = null;

  function shareButton(p) {
    const b = el("button", { class: "g-tool g-tool-strong g-card-btn", type: "button", text: "Make an idea card" });
    b.addEventListener("click", () => openShare(p));
    return b;
  }

  // Words broken into lines that fit `width`, at most `most` lines (the last
  // one ends "…" when cut).
  function wrap(ctx, text, width, most) {
    const words = text.split(" ");
    const lines = [];
    let now = "";
    for (const word of words) {
      const next = now ? `${now} ${word}` : word;
      if (ctx.measureText(next).width <= width || !now) now = next;
      else { lines.push(now); now = word; }
    }
    if (now) lines.push(now);
    if (lines.length > most) {
      const kept = lines.slice(0, most);
      let last = kept[most - 1];
      while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
      kept[most - 1] = `${last.replace(/\s+$/, "")}…`;
      return kept;
    }
    return lines.map((l) => {
      let cut = l;
      while (cut.length > 1 && ctx.measureText(cut).width > width) cut = cut.slice(0, -1);
      return cut === l ? l : `${cut}…`;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function star(ctx, cx, cy, size) {
    const k = size * 0.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + k, cy - k); ctx.lineTo(cx + size, cy); ctx.lineTo(cx + k, cy + k);
    ctx.lineTo(cx, cy + size); ctx.lineTo(cx - k, cy + k); ctx.lineTo(cx - size, cy); ctx.lineTo(cx - k, cy - k);
    ctx.closePath();
  }

  function drawCard(canvas, p) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height, pad = 84;
    const pr = S.progress(p);
    const look = pr.launched ? "launched" : p.stage;
    const colour = STAGE_COLOURS[look];
    ctx.clearRect(0, 0, W, H);
    // The night sky, with the dawn coming up in the corner.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#060a1e"); sky.addColorStop(1, "#140b33");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.85, H * 1.02, 10, W * 0.85, H * 1.02, W * 0.75);
    glow.addColorStop(0, "rgba(251,191,36,0.55)"); glow.addColorStop(0.45, "rgba(244,114,182,0.25)"); glow.addColorStop(1, "rgba(139,92,246,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    const edge = ctx.createLinearGradient(0, 0, W, 0);
    edge.addColorStop(0, "#fbbf24"); edge.addColorStop(0.45, "#f472b6"); edge.addColorStop(0.75, "#a78bfa"); edge.addColorStop(1, "#22d3ee");
    roundRect(ctx, 24, 24, W - 48, H - 48, 44);
    ctx.lineWidth = 4; ctx.strokeStyle = edge; ctx.stroke();

    // Genesis, with its spark.
    const sparkFill = ctx.createRadialGradient(pad + 26, pad + 26, 2, pad + 26, pad + 26, 30);
    sparkFill.addColorStop(0, "#ffffff"); sparkFill.addColorStop(0.35, "#fbbf24"); sparkFill.addColorStop(1, "#f472b6");
    star(ctx, pad + 26, pad + 26, 30); ctx.fillStyle = sparkFill; ctx.fill();
    ctx.fillStyle = "#eef3ff"; ctx.textBaseline = "middle";
    ctx.font = '700 34px "Montserrat", system-ui, sans-serif';
    ctx.fillText("GENESIS", pad + 74, pad + 28);

    // The stage, as a chip on the right.
    const chip = pr.launched ? "LAUNCHED" : S.STAGES.find((s) => s.key === p.stage).name.toUpperCase();
    ctx.font = '700 28px "Montserrat", system-ui, sans-serif';
    const cw = ctx.measureText(chip).width + 56;
    roundRect(ctx, W - pad - cw, pad + 2, cw, 52, 26);
    ctx.fillStyle = `${colour}26`; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = colour; ctx.stroke();
    ctx.fillStyle = colour; ctx.fillText(chip, W - pad - cw + 28, pad + 29);

    // The name, the pitch, and who it's for.
    const width = W - pad * 2;
    let y = pad + 170;
    ctx.textBaseline = "alphabetic";
    let size = 104;
    ctx.font = `800 ${size}px "Montserrat", system-ui, sans-serif`;
    while (size > 64 && ctx.measureText(p.name).width > width) {
      size -= 4;
      ctx.font = `800 ${size}px "Montserrat", system-ui, sans-serif`;
    }
    const nameLines = wrap(ctx, p.name, width, 2);
    const nameFill = ctx.createLinearGradient(pad, 0, pad + width, 0);
    nameFill.addColorStop(0, "#fbbf24"); nameFill.addColorStop(0.5, "#f472b6"); nameFill.addColorStop(1, "#a78bfa");
    ctx.fillStyle = nameFill;
    for (const l of nameLines) { y += size * 0.95; ctx.fillText(l, pad, y); y += size * 0.12; }
    y += 40;
    ctx.fillStyle = "#eef3ff";
    ctx.font = '500 50px "Inter", system-ui, sans-serif';
    for (const l of wrap(ctx, p.pitch, width, 4)) { y += 50; ctx.fillText(l, pad, y); y += 16; }
    y += 28;
    ctx.fillStyle = "#a9b6d8";
    ctx.font = '400 38px "Inter", system-ui, sans-serif';
    for (const l of wrap(ctx, `For ${p.audience}`, width, 2)) { y += 38; ctx.fillText(l, pad, y); y += 12; }

    // How far along it is: one bar per stage, and the percent.
    const barY = H - pad - 150, gap = 14, seg = (width - gap * 3) / 4;
    pr.stages.forEach((st, i) => {
      const x = pad + i * (seg + gap);
      roundRect(ctx, x, barY, seg, 16, 8); ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fill();
      if (st.done) {
        roundRect(ctx, x, barY, Math.max(16, seg * (st.done / st.total)), 16, 8);
        ctx.fillStyle = STAGE_COLOURS[st.key]; ctx.fill();
      }
      ctx.fillStyle = st.key === p.stage && !pr.launched ? STAGE_COLOURS[st.key] : "#a9b6d8";
      ctx.font = '600 26px "Inter", system-ui, sans-serif';
      ctx.fillText(st.name, x, barY + 56);
    });
    ctx.fillStyle = "#eef3ff";
    ctx.font = '700 30px "Inter", system-ui, sans-serif';
    const pct = `${pr.percent}% of the way to launch`;
    ctx.fillText(pct, pad, barY - 26);

    // Where it was made.
    const home = (/^https?:\/\/[^\s/]+$/.test(base) ? base.replace(/^https?:\/\//, "") : window.location.host) || "mtrxhorizyn.com";
    ctx.fillStyle = "#a9b6d8";
    ctx.font = '400 28px "Inter", system-ui, sans-serif';
    ctx.fillText(`Made with Genesis · ${home}/genesis`, pad, H - pad + 10);
  }

  function cardBlob(canvas) {
    return new Promise((resolve) => {
      try { canvas.toBlob((blob) => resolve(blob), "image/png"); } catch (_) { resolve(null); }
    });
  }

  async function openShare(p) {
    flushNotes();
    sharing = p;
    const dialog = $("g-share");
    $("g-share-msg").textContent = "";
    const canvas = $("g-share-canvas");
    // The card uses the site's own fonts; wait for them so it looks right.
    try {
      await Promise.all(['800 40px "Montserrat"', '700 40px "Montserrat"', '500 40px "Inter"', '400 40px "Inter"']
        .map((f) => document.fonts.load(f)));
    } catch (_) { /* the card still draws with the fallback font */ }
    drawCard(canvas, p);
    $("g-share-native").hidden = !(navigator.share && navigator.canShare);
    if (typeof dialog.showModal === "function") { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute("open", "");
  }

  function closeShare() {
    const dialog = $("g-share");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    sharing = null;
  }
  $("g-share-close").addEventListener("click", closeShare);
  $("g-share").addEventListener("click", (event) => { if (event.target === $("g-share")) closeShare(); });

  $("g-share-save").addEventListener("click", async () => {
    if (!sharing) return;
    const blob = await cardBlob($("g-share-canvas"));
    if (!blob) { $("g-share-msg").textContent = "Your browser couldn't make the picture."; return; }
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: S.cardFileName(sharing) });
    put(document.body, a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("g-share-msg").textContent = "Saved. Look in your downloads or photos.";
  });

  $("g-share-native").addEventListener("click", async () => {
    if (!sharing) return;
    const text = S.shareText(sharing, base);
    const blob = await cardBlob($("g-share-canvas"));
    const data = { title: sharing.name, text };
    if (blob) {
      const file = new File([blob], S.cardFileName(sharing), { type: "image/png" });
      if (navigator.canShare({ files: [file] })) data.files = [file];
    }
    try { await navigator.share(data); } catch (_) { /* closed without sharing */ }
  });

  $("g-share-copy").addEventListener("click", async () => {
    if (!sharing) return;
    try {
      await navigator.clipboard.writeText(S.shareText(sharing, base));
      $("g-share-msg").textContent = "Copied. Paste it anywhere.";
    } catch (_) {
      $("g-share-msg").textContent = "Your browser wouldn't copy. Save the picture instead.";
    }
  });

  // ---------------------------------------------------------------- Orbyt
  // Opens /orbyt with this project ready to pitch. Only its id is handed
  // over, through this tab's sessionStorage (GenesisStore.offerToVortex),
  // so the idea never goes into the address. Nothing is sent from here.

  function vortexLink(p) {
    const link = el("a", { class: "g-vortex", href: "/orbyt#pitch" },
      el("span", { class: "g-vortex-swirl", "aria-hidden": "true" }),
      el("span", { text: "Pitch this in Orbyt" }), el("span", { "aria-hidden": "true", text: " →" }));
    link.addEventListener("click", () => {
      flushNotes();
      let session = null;
      try { session = window.sessionStorage; } catch (_) { session = null; }
      S.offerToVortex(session, p.id);
    });
    return link;
  }

  // ---------------------------------------------------------------- Download plan (Pro)
  // One project as a plain text file, made here in the browser.

  function planButton(p) {
    if (!isPro()) return null;
    const b = el("button", { class: "g-tool g-plan", type: "button", text: "Download plan" });
    b.addEventListener("click", () => {
      flushNotes();
      const blob = new Blob([S.planText(p)], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: S.planFileName(p) });
      put(document.body, a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Plan downloaded.");
    });
    return b;
  }

  // ---------------------------------------------------------------- Ask Genesis
  // The only thing Genesis ever sends: when a button here is pressed, the
  // project's name, pitch, who it's for and stage, and the visitor's
  // question if they typed one. Nothing else, and never the notes.

  const HELPERS = [
    ["pitch", "Sharpen my pitch"], ["users", "Who might use this?"],
    ["first", "Simplest first version"], ["names", "Name ideas"],
    ["risks", "What could go wrong?"], ["next", "What should I do next?"],
  ];
  const QUESTION_LIMIT = 300;
  // Genesis Pro's extra helpers and longer question (horizon/genesis_ai.py).
  const PRO_HELPERS = [["plan", "Four-week plan"], ["page", "Words for my website"], ["price", "Price ideas"]];
  const PRO_QUESTION_LIMIT = 600;

  function askPanel(p) {
    const pro = isPro();
    const own = ownKey();
    const head = el("div", { class: "g-row" }, el("h2", { class: "g-h2" }, "Ask Genesis"),
      aiUsable() ? el("span", { class: `g-ai-badge${pro ? " pro" : own ? " own" : ""}`, text: pro ? "AI · Pro" : own ? "AI · your key" : "AI · free" }) : null);
    const note = el("p", { class: "g-ask-note", text: own
      ? `Don't type personal details. Your question goes straight from this browser to ${window.Pilot.providerLabel() || "your AI provider"} with your own key (set in Pilot), and your provider bills you. Nothing goes to us. AI answers can be wrong, so check what matters.`
      : "Don't type personal details. Your question is sent to our AI provider to answer it; we don't keep it. AI answers can be wrong, so check what matters." });
    if (!aiUsable()) {
      return el("section", { class: "panel g-ask off" }, head,
        el("p", { class: "g-note", text: window.Pilot && window.Pilot.store
          ? "AI help isn't switched on here yet. Everything else in Genesis works as usual, and you can use your own AI key: open Pilot, the robot in the corner, and add it."
          : "AI help isn't switched on yet. Everything else in Genesis works as usual." }));
    }
    const out = el("div", { class: "g-answer", "aria-live": "polite" });
    const buttons = (pro ? HELPERS.concat(PRO_HELPERS) : HELPERS).map(([key, label]) => {
      const b = el("button", { class: `g-helper${PRO_HELPERS.some(([k]) => k === key) ? " pro" : ""}`, type: "button", text: label });
      b.addEventListener("click", () => send(p, key, label, "", out, panel));
      return b;
    });
    const input = el("input", { type: "text", class: "g-question-input", placeholder: "Or ask a short question about your idea", autocomplete: "off" });
    input.maxLength = pro ? PRO_QUESTION_LIMIT : QUESTION_LIMIT;
    const go = el("button", { class: "btn btn-genesis btn-small", type: "submit", text: "Ask" });
    const form = el("form", { class: "g-question" }, input, go);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = input.value.trim();
      if (!q) { input.focus(); return; }
      send(p, "question", q, q, out, panel);
    });
    // The free answers left today, said plainly (free help only).
    const left = pro || own ? null : el("p", { class: "g-ask-left", role: "status", text: freeText() });
    // Ask Genesis or Pilot? One plain line, where both can be seen.
    const which = !pro && !own && document.getElementById("pilot-core")
      ? el("p", { class: "g-ask-which", text: "Ask Genesis is free here, with a daily limit. Pilot, the robot in the corner, uses your own AI key, with no limit." })
      : null;
    const panel = el("section", { class: "panel g-ask" }, head,
      el("div", { class: "g-helpers" }, ...buttons), form, left, which, note, out);
    drawAnswer(p, out);
    if (left && !freeAllowance) loadAllowance();
    return panel;
  }

  // ---- the free limit, honestly: "4 of 5 left today (up to 3 an hour)".
  // The two limits come with the page; how many are left comes from the
  // server, asked once per visit when Ask Genesis is first shown, then
  // from each answer.
  const freeDay = Number($("genesis").dataset.freeDay) || 0;
  const freeHour = Number($("genesis").dataset.freeHour) || 0;
  let freeAllowance = null;
  let allowanceAsked = false;
  const freeText = () => S.freeLine(freeAllowance, freeDay, freeHour);
  function drawAllowance() {
    document.querySelectorAll(".g-ask-left").forEach((line) => { line.textContent = freeText(); });
  }
  function keepAllowance(data) {
    if (!data || !Number.isFinite(Number(data.free_left))) return;
    freeAllowance = { free_left: data.free_left, free_day: data.free_day, free_hour: data.free_hour,
      hour_used: data.hour_used, wait: data.wait || "" };
    drawAllowance();
  }
  async function loadAllowance() {
    if (allowanceAsked || !aiOn) return;
    allowanceAsked = true;
    try {
      const res = await fetch("/api/genesis/ask", { credentials: "omit" });
      if (res.ok) keepAllowance(await res.json());
    } catch (_) { /* the limits alone are still shown */ }
  }

  function drawAnswer(p, out) {
    const last = answers[p.id];
    fill(out);
    if (!last) return;
    if (last.pending) {
      put(out, el("p", { class: "g-thinking", text: `Genesis is thinking about “${last.label}”…` }));
      return;
    }
    if (last.error) {
      put(out, el("p", { class: "g-msg bad", text: last.error }));
      // The free help is used up for now. Say plainly what Pro would change,
      // once, with no timer and no pressure: the free plan keeps working.
      if (last.limit && proOffered && !isPro()) {
        put(out, el("p", { class: "g-upgrade" },
          el("span", { text: "Everything else in Genesis keeps working. If you use Ask Genesis a lot, Genesis Pro has its own answers each day, never shared, " }),
          el("a", { href: "#pro", text: "and a grown-up can get it here" }), el("span", { text: "." })));
      }
      return;
    }
    const save = el("button", { class: "g-tool", type: "button", text: last.saved ? "Saved to notes" : "Save to notes" });
    save.disabled = Boolean(last.saved);
    save.addEventListener("click", () => {
      const block = `Ask Genesis · ${last.label}\n${last.text}`;
      const joined = p.notes ? `${p.notes.replace(/\s+$/, "")}\n\n${block}` : block;
      if (joined.length > S.LIMITS.notes) { toast("Your notes are full. Make room first.", true); return; }
      flushNotes();
      update(p, (q) => { q.notes = joined; });
      last.saved = true;
      toast("Saved to notes.");
      drawProject(p);
    });
    put(out,
      el("p", { class: "g-answer-label", text: last.label }),
      el("p", { class: "g-answer-text", text: last.text }),
      last.refused ? null : save);
  }

  async function send(p, helper, label, question, out, panel) {
    if (asking) return;
    asking = true;
    answers[p.id] = { label, pending: true };
    panel.classList.add("busy");
    panel.querySelectorAll("button, input").forEach((b) => { b.disabled = true; });
    drawAnswer(p, out);
    let result;
    if (ownKey()) {
      result = await askWithOwnKey(p, helper, label, question);
      asking = false;
      answers[p.id] = result;
      if (current && current.id === p.id && !$("g-detail").hidden) drawProject(current);
      return;
    }
    const headers = { "Content-Type": "application/json" };
    if (Pro && Pro.key()) headers["X-Genesis-Pro-Key"] = Pro.key();
    try {
      const res = await fetch("/api/genesis/ask", {
        method: "POST", credentials: "omit", headers,
        body: JSON.stringify({
          project: { name: p.name, pitch: p.pitch, audience: p.audience, stage: p.stage },
          helper, question,
        }),
      });
      let data = {};
      try { data = await res.json(); } catch (_) { /* not JSON */ }
      if (Pro) Pro.answered(data);
      keepAllowance(data);
      noteAsked();
      result = res.ok && data.answer
        ? { label, text: data.answer, refused: Boolean(data.refused) }
        : { label, error: data.error || "Genesis couldn't answer just now. Please try again in a minute.", limit: data.limit === "free" };
    } catch (_) {
      result = { label, error: "No connection. Check you're online and try again." };
    }
    asking = false;
    answers[p.id] = result;
    // Redraw only if the visitor is still on this project.
    if (current && current.id === p.id && !$("g-detail").hidden) drawProject(current);
  }

  // Ask Genesis with the visitor's own key, from this browser: the same
  // four fields and the same words as the server would send, no free limit.
  async function askWithOwnKey(p, helper, label, question) {
    try { await loadAsk(); } catch (_) { return { label, error: "No connection. Check you're online and try again." }; }
    const built = Ask.message({ name: p.name, pitch: p.pitch, audience: p.audience, stage: p.stage }, helper, question);
    if (built.error) return { label, error: built.error };
    try {
      const reply = await window.Pilot.complete({ system: Ask.SYSTEM, message: built.text, maxTokens: Ask.MAX_TOKENS });
      if (reply.stop === "refused" && !reply.text) {
        return { label, text: "Genesis can't help with that one. Try asking about your idea: who it's for, what to build first, or what to call it.", refused: true };
      }
      const text = Ask.tidy(reply.text, reply.stop);
      return text ? { label, text } : { label, error: "Your AI provider sent an empty answer. Please try again." };
    } catch (e) {
      return { label, error: (e && e.kind && e.message) || "Couldn't reach your AI provider. Check you're online and try again." };
    }
  }

  // Save any notes still waiting when the visitor leaves.
  function flushNotes() {
    if (!notesTimer || !current) return;
    clearTimeout(notesTimer);
    notesTimer = null;
    const area = document.querySelector(".g-notes");
    if (area) update(current, (q) => { q.notes = S.block(area.value).slice(0, S.LIMITS.notes); });
  }
  window.addEventListener("pagehide", flushNotes);

  // ---------------------------------------------------------------- moving data

  $("g-download").addEventListener("click", () => {
    const blob = new Blob([S.exportText(projects)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: `genesis-projects-${new Date().toISOString().slice(0, 10)}.json` });
    put(document.body, a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Downloaded. Import it on another device to carry on there.");
  });

  $("g-import").addEventListener("click", () => $("g-file").click());
  $("g-import-empty").addEventListener("click", () => $("g-file").click());
  $("g-file").addEventListener("change", async () => {
    const file = $("g-file").files[0];
    $("g-file").value = "";
    if (!file) return;
    if (file.size > S.LIMITS.file) { toast("That file is too big to be a Genesis file.", true); return; }
    let text;
    try { text = await file.text(); } catch (_) { toast("Couldn't read that file.", true); return; }
    const result = S.importText(text, projects);
    if (result.error) { toast(result.error, true); return; }
    projects = result.projects;
    persist();
    const parts = [];
    if (result.added) parts.push(`${result.added} added`);
    if (result.replaced) parts.push(`${result.replaced} updated`);
    if (result.skipped) parts.push(`${result.skipped} skipped`);
    toast(parts.length ? `Imported: ${parts.join(", ")}.` : "Nothing new in that file.");
    drawList();
  });

  $("g-delete-all").addEventListener("click", () => {
    if (!confirm(`Delete all ${projects.length} project${projects.length === 1 ? "" : "s"} from this browser? This can't be undone.`)) return;
    projects = [];
    store.clear();
    toast("All projects deleted from this browser.");
    drawList();
  });

  // ---------------------------------------------------------------- which view

  function route() {
    flushNotes();
    const hash = window.location.hash;
    const match = hash.match(/^#p\/([A-Za-z0-9-]{1,64})$/);
    const view = hash === "#new" || hash === "#example" ? "new" : match ? "project" : "list";
    let project = null;
    if (view === "project") {
      // Another tab may have changed things.
      projects = store.usable ? store.load() : projects;
      project = projects.find((p) => p.id === match[1]);
      if (!project) { window.location.replace("#"); return; }
    }
    $("g-list-view").hidden = view !== "list";
    $("g-new").hidden = view !== "new";
    $("g-detail").hidden = view !== "project";
    if (view === "list") { current = null; projects = store.usable ? store.load() : projects; drawList(); }
    else if (view === "new") {
      showForm(hash === "#example" ? nextExample() : prefill);
      prefill = null;
    }
    else drawProject(project);
    drawPro();
    const pro = hash === "#pro" && document.getElementById("pro");
    if (pro) pro.scrollIntoView();
    else window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", route);
  window.addEventListener("storage", (event) => {
    if ((event.key === S.KEY || event.key === S.DAILY_KEY) && $("g-detail").hidden && $("g-new").hidden) { projects = store.load(); drawList(); }
  });
  if (Pro) {
    Pro.connect({
      get: () => projects.slice(),
      set: (list) => { projects = list; persist(); if (!$("g-list-view").hidden) drawList(); },
    });
    // Pro turned on or off: redraw the project open now, for its Pro parts.
    Pro.onChange(() => { if (current && !$("g-detail").hidden) drawProject(current); });
  }
  // ---------------------------------------------------------------- Pilot
  // What Pilot's Genesis tools may do (static/js/pilot-mtrx-pack.js). Each one
  // goes through the same rules and saving as the page's own buttons, and
  // Pilot asks the visitor before anything here changes. Nothing is deleted.

  function findProject(ref) {
    const list = store.usable ? store.load() : projects;
    projects = list;
    const want = typeof ref === "string" ? ref.trim().toLowerCase() : "";
    if (want) {
      return list.find((q) => q.id === ref) || list.find((q) => q.name.toLowerCase() === want)
        || list.find((q) => q.name.toLowerCase().includes(want)) || null;
    }
    if (current && !$("g-detail").hidden) return list.find((q) => q.id === current.id) || null;
    return list.slice().sort((a, b) => b.updated - a.updated)[0] || null;
  }

  function summary(q) {
    const pr = S.progress(q);
    const step = S.nextStep(q);
    return { name: q.name, pitch: q.pitch, for: q.audience, stage: pr.launched ? "Launched" : stageOf(q.stage).name,
      done: `${pr.done} of ${pr.total} steps (${pr.percent}%)`, next: step ? step.label : "Every step is done" };
  }

  function redrawAfterPilot(q) {
    if (current && q && current.id === q.id && !$("g-detail").hidden) drawProject(q);
    else if (!$("g-list-view").hidden) drawList();
  }

  window.GenesisBridge = {
    screen() {
      const hash = window.location.hash;
      if (hash === "#new" || hash === "#example") return { view: "the form to start a new project" };
      if (current && !$("g-detail").hidden) return { view: "one project", project: current.name };
      return { view: "the list of projects", count: projects.length };
    },
    list() { return (store.usable ? store.load() : projects).slice().sort((a, b) => b.updated - a.updated).map(summary); },
    find(ref) { const q = findProject(ref); return q ? { id: q.id, name: q.name } : null; },
    next(ref) {
      const q = findProject(ref);
      if (!q) return { error: projects.length ? "I couldn't find that project." : "There are no projects yet." };
      return summary(q);
    },
    addStep(ref, stage, label) {
      const q = findProject(ref);
      if (!q) return { error: "I couldn't find that project." };
      const copy = { ...q, custom: (q.custom || []).slice() };
      const result = S.addStep(copy, stage, label);
      if (result.error) return { error: result.error };
      update(q, (r) => { r.custom = copy.custom; });
      (folds[q.id] = folds[q.id] || {})[stage] = true;
      redrawAfterPilot(q);
      return { ok: true, project: q.name, stage: stageOf(stage).name, step: result.step.label };
    },
    startProject(fields) {
      projects = store.usable ? store.load() : projects;
      if (projects.length >= S.LIMITS.projects) return { error: `Genesis holds ${S.LIMITS.projects} projects. Delete one first.` };
      const made = S.create({ name: fields.name, pitch: fields.pitch, audience: fields.audience, address: S.suggestAddress(fields.name) });
      if (made.errors) return { error: Object.entries(made.errors).map(([f, why]) => `${f}: ${why}`).join(" ") };
      projects.push(made.project);
      persist();
      window.location.hash = `#p/${made.project.id}`;
      return { ok: true, id: made.project.id, name: made.project.name };
    },
    spark() {
      const today = S.dayKey(new Date());
      const days = daily.load();
      return { prompt: S.promptFor(today).text, answer: days[today] || "", streak: S.streak(days, today).streak, limit: S.DAILY_LIMIT };
    },
    fillSpark(text) {
      const answer = S.line(text).slice(0, S.DAILY_LIMIT);
      if (!answer) return { error: "The answer was empty." };
      const today = S.dayKey(new Date());
      const days = daily.load();
      days[today] = answer;
      if (!daily.save(days) && daily.usable) return { error: "The browser wouldn't save that." };
      editingDaily = false;
      if (!$("g-list-view").hidden) drawDaily();
      return { ok: true, answer, streak: S.streak(days, today).streak };
    },
  };
  // Pilot starts after this page has drawn. Once it has, and whenever a key
  // is added or removed in it, Ask Genesis changes with it.
  function withPilot() {
    if (!window.Pilot || typeof window.Pilot.onChange !== "function") return;
    const redraw = () => { if (current && !$("g-detail").hidden && !asking) drawProject(current); };
    window.Pilot.onChange(redraw);
    redraw();
  }
  if (window.Pilot && window.Pilot.store) withPilot();
  else window.addEventListener("pilot-ready", withPilot, { once: true });

  drawStorageNote();
  route();
})();
