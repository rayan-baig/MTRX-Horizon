// The Genesis page: a visitor's own projects, kept in their own browser.
// Nothing here talks to the server. Every word a visitor typed is placed
// with textContent, never as HTML.
(() => {
  const S = window.GenesisStore;
  const $ = (id) => document.getElementById(id);
  const store = S.open((() => { try { return window.localStorage; } catch (_) { return null; } })());
  let projects = store.load();
  let current = null;
  let addressEdited = false;
  let notesTimer = null;
  const aiOn = $("genesis").dataset.ai === "on";
  const answers = {}; // the last Ask Genesis answer per project, for this visit only
  let asking = false;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child != null) node.append(child);
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
    const cards = $("g-cards");
    cards.hidden = projects.length === 0;
    cards.replaceChildren(...sorted.map(card));
    const path = $("g-path");
    path.replaceChildren(...S.STAGES.map((s) => el("li", { class: `stage-${s.key}` },
      el("b", { text: String(projects.filter((p) => p.stage === s.key && !S.progress(p).launched).length) }),
      el("span", { text: s.name }))),
    el("li", { class: "stage-launched" },
      el("b", { text: String(projects.filter((p) => S.progress(p).launched).length) }), el("span", { text: "Launched" })));
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

  function showForm() {
    $("g-form").reset();
    addressEdited = false;
    for (const f of ["name", "pitch", "audience"]) {
      say(f, "");
      count($(`g-${f}`), $(`g-${f}-count`), S.LIMITS[f]);
    }
    drawAddress();
    $("g-form-error").textContent = "";
    if (window.matchMedia("(min-width: 721px)").matches) $("g-name").focus({ preventScroll: true });
  }

  for (const f of ["name", "pitch", "audience"]) {
    $(`g-${f}`).maxLength = S.LIMITS[f] + 20; // a little over, so the counter can say so
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
      vortexLink(p));

    const moves = el("div", { class: "g-moves" });
    if (here > 0) {
      const back = el("button", { class: "btn btn-ghost btn-small", type: "button", text: `← Back to ${S.STAGES[here - 1].name}` });
      back.addEventListener("click", () => { update(p, (q) => { q.stage = S.STAGES[here - 1].key; }); drawProject(p); });
      moves.append(back);
    }
    if (here < S.STAGES.length - 1) {
      const next = S.STAGES[here + 1];
      const fwd = el("button", { class: "btn btn-genesis btn-small", type: "button", text: `Move to ${next.name} →` });
      fwd.addEventListener("click", () => { update(p, (q) => { q.stage = next.key; }); toast(`On to ${next.name}.`); drawProject(p); });
      moves.append(fwd);
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

    const groups = pr.stages.map((s) => {
      const items = S.CHECKLIST.filter((i) => i.stage === s.key).map((item) => {
        const box = el("input", { type: "checkbox" });
        box.checked = Boolean(p.ticks[item.key]);
        box.addEventListener("change", () => {
          update(p, (q) => { if (box.checked) q.ticks[item.key] = true; else delete q.ticks[item.key]; });
          const after = S.progress(p);
          if (after.launched) toast(`${p.name} is launched!`);
          drawProject(p);
        });
        return el("li", {}, el("label", { class: `g-item${box.checked ? " done" : ""}` },
          box, el("span", { class: "g-box" }),
          el("span", { class: "g-item-text" }, el("b", { text: item.label }), item.hint ? el("small", { text: item.hint }) : null)));
      });
      return el("div", { class: `g-group stage-${s.key}${s.key === p.stage ? " here" : ""}` },
        el("div", { class: "g-group-head" },
          el("span", { class: "g-dot" }),
          el("span", {}, el("b", { text: s.name }), el("small", { text: s.line })),
          el("span", { class: "g-group-count", text: `${s.done}/${s.total}` })),
        meter(s.done, s.total),
        el("ul", { class: "g-items" }, ...items));
    });
    const checklist = el("section", { class: "panel g-checklist" },
      el("h2", { class: "g-h2" }, "Launch checklist"), ...groups);

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

    $("g-detail").replaceChildren(head, el("div", { class: "g-columns" },
      el("div", { class: "g-main" }, checklist),
      el("div", { class: "g-side" }, stagePanel, ask, notes, danger)));
  }

  // ---------------------------------------------------------------- Chroma Vortex
  // Opens /vortex with this project ready to pitch. Only its id is handed
  // over, through this tab's sessionStorage (GenesisStore.offerToVortex),
  // so the idea never goes into the address. Nothing is sent from here.

  function vortexLink(p) {
    const link = el("a", { class: "g-vortex", href: "/vortex#pitch" },
      el("span", { class: "g-vortex-swirl", "aria-hidden": "true" }),
      el("span", { text: "Pitch this in Chroma Vortex" }), el("span", { "aria-hidden": "true", text: " →" }));
    link.addEventListener("click", () => {
      flushNotes();
      let session = null;
      try { session = window.sessionStorage; } catch (_) { session = null; }
      S.offerToVortex(session, p.id);
    });
    return link;
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

  function askPanel(p) {
    const head = el("div", { class: "g-row" }, el("h2", { class: "g-h2" }, "Ask Genesis"),
      el("span", { class: "g-ai-badge", text: "AI · free" }));
    const note = el("p", { class: "g-ask-note", text: "Don't type personal details. Your question is sent to our AI provider to answer it; we don't keep it. AI answers can be wrong, so check what matters." });
    if (!aiOn) {
      return el("section", { class: "panel g-ask off" }, head,
        el("p", { class: "g-note", text: "AI help isn't switched on yet. Everything else in Genesis works as usual." }));
    }
    const out = el("div", { class: "g-answer", "aria-live": "polite" });
    const buttons = HELPERS.map(([key, label]) => {
      const b = el("button", { class: "g-helper", type: "button", text: label });
      b.addEventListener("click", () => send(p, key, label, "", out, panel));
      return b;
    });
    const input = el("input", { type: "text", class: "g-question-input", placeholder: "Or ask a short question about your idea", autocomplete: "off" });
    input.maxLength = QUESTION_LIMIT;
    const go = el("button", { class: "btn btn-genesis btn-small", type: "submit", text: "Ask" });
    const form = el("form", { class: "g-question" }, input, go);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = input.value.trim();
      if (!q) { input.focus(); return; }
      send(p, "question", q, q, out, panel);
    });
    const panel = el("section", { class: "panel g-ask" }, head,
      el("div", { class: "g-helpers" }, ...buttons), form, note, out);
    drawAnswer(p, out);
    return panel;
  }

  function drawAnswer(p, out) {
    const last = answers[p.id];
    out.replaceChildren();
    if (!last) return;
    if (last.pending) {
      out.append(el("p", { class: "g-thinking", text: `Genesis is thinking about “${last.label}”…` }));
      return;
    }
    if (last.error) {
      out.append(el("p", { class: "g-msg bad", text: last.error }));
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
    out.append(
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
    try {
      const res = await fetch("/api/genesis/ask", {
        method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: { name: p.name, pitch: p.pitch, audience: p.audience, stage: p.stage },
          helper, question,
        }),
      });
      let data = {};
      try { data = await res.json(); } catch (_) { /* not JSON */ }
      result = res.ok && data.answer
        ? { label, text: data.answer, refused: Boolean(data.refused) }
        : { label, error: data.error || "Genesis couldn't answer just now. Please try again in a minute." };
    } catch (_) {
      result = { label, error: "No connection. Check you're online and try again." };
    }
    asking = false;
    answers[p.id] = result;
    // Redraw only if the visitor is still on this project.
    if (current && current.id === p.id && !$("g-detail").hidden) drawProject(current);
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
    document.body.append(a);
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
    const view = hash === "#new" ? "new" : match ? "project" : "list";
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
    else if (view === "new") showForm();
    else drawProject(project);
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", route);
  window.addEventListener("storage", (event) => {
    if (event.key === S.KEY && $("g-detail").hidden && $("g-new").hidden) { projects = store.load(); drawList(); }
  });
  drawStorageNote();
  route();
})();
