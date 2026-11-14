// Genesis Pro on the Genesis page: the offer, the Pro key, and the cloud
// backup. Only on the page while Pro is switched on (horizon/genesis_pro.py).
//
// A browser that has Pro keeps its key in this site's storage and sends it,
// in a header, only with Pro requests to this site. The projects go to the
// server only for a backup, and only while this browser has Pro. Every word
// is placed with textContent, never as HTML.
(() => {
  const S = window.GenesisStore;
  const $ = (id) => document.getElementById(id);
  const root = $("pro");
  if (!root || !S) return;

  const storage = (() => { try { return window.localStorage; } catch (_) { return null; } })();
  let key = S.readProKey(storage);
  let state = null;        // the last answer from /api/genesis/pro/status
  let source = null;       // genesis.js: how to read and replace the projects
  const listeners = [];
  let backupTimer = null;
  let lastBackup = 0;
  const AUTO_BACKUP_WAIT = 8000;
  const AUTO_BACKUP_GAP = 60000;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) if (child != null) node.append(child);
    return node;
  }

  const when = (seconds) => new Date(seconds * 1000).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  const clock = (seconds) => new Date(seconds * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  async function call(path, body) {
    const headers = { "Content-Type": "application/json" };
    if (key) headers["X-Genesis-Pro-Key"] = key;
    try {
      const res = await fetch(path, {
        method: "POST", credentials: "omit", headers, body: JSON.stringify(body || {}),
      });
      let data = {};
      try { data = await res.json(); } catch (_) { /* not JSON */ }
      return { ok: res.ok, status: res.status, data };
    } catch (_) {
      return { ok: false, status: 0, data: { error: "No connection. Check you're online and try again." } };
    }
  }

  function say(id, text, kind = "") {
    const out = $(id);
    out.textContent = text || "";
    out.className = out.className.replace(/\s*\b(ok|bad)\b/g, "") + (kind ? ` ${kind}` : "");
  }

  function changed() { for (const cb of listeners) { try { cb(); } catch (_) { /* a redraw failing must not stop Pro */ } } }

  // ---------------------------------------------------------------- drawing

  function draw() {
    const pro = Boolean(state && state.pro);
    $("g-pro-offer").hidden = pro;
    $("g-pro-member").hidden = !pro;
    $("g-pro-on").hidden = !pro;
    root.classList.toggle("on", pro);
    const ended = $("g-pro-ended");
    ended.hidden = true;
    if (!state) return;
    if (!pro && state.known) {
      ended.hidden = false;
      ended.replaceChildren(
        el("span", { text: state.status === "past_due" || state.status === "unpaid"
          ? "Your last Pro payment didn't go through, so Pro is paused. A grown-up can fix it here: "
          : "The Pro on this browser has ended. You can get it again any time, or " }),
        manageButton(),
        el("span", { text: " · " }),
        forgetButton());
      return;
    }
    if (!pro) return;
    const parts = [state.plan === "year" ? "Yearly" : "Monthly"];
    if (state.ends_at) parts.push(`ends ${when(state.ends_at)}`);
    else if (state.renews_at) parts.push(`renews ${when(state.renews_at)}`);
    if (Number.isFinite(state.left_today)) parts.push(`${state.left_today} of ${state.per_day} AI answers left today`);
    $("g-pro-status").textContent = parts.join(" · ");
    drawBackups();
  }

  function manageButton() {
    const b = el("button", { class: "g-link", type: "button", text: "Manage subscription" });
    b.addEventListener("click", portal);
    return b;
  }

  function forgetButton() {
    const b = el("button", { class: "g-link", type: "button", text: "remove the key from this browser" });
    b.addEventListener("click", forget);
    return b;
  }

  function drawBackups() {
    const list = (state && state.backups) || [];
    const latest = list[0];
    $("g-pro-backup-line").textContent = latest
      ? `Last backup ${clock(latest.at)}: ${latest.projects} project${latest.projects === 1 ? "" : "s"}. Backs up by itself as you work.`
      : "No backup yet. It backs up by itself as you work, or press Back up now.";
    $("g-pro-restore").disabled = !latest;
    $("g-pro-backup-delete").disabled = !latest;
    const ul = $("g-pro-backups");
    ul.replaceChildren(...list.map((b) => {
      const go = el("button", { class: "g-tool", type: "button", text: "Restore this one" });
      go.addEventListener("click", () => restore(b.id));
      return el("li", {}, el("span", { text: `${clock(b.at)} · ${b.projects} project${b.projects === 1 ? "" : "s"}` }), go);
    }));
    if (!latest) ul.hidden = true;
  }

  // ---------------------------------------------------------------- the key

  async function refresh() {
    if (!key) { state = null; draw(); changed(); return; }
    const res = await call("/api/genesis/pro/status");
    if (res.status === 429) return;
    if (res.ok && res.data && res.data.known === false) {
      // A key this site doesn't know: not worth keeping.
      S.forgetProKey(storage);
      key = null;
      state = null;
    } else if (res.ok) {
      state = res.data;
    }
    draw();
    changed();
  }

  function forget() {
    if (!confirm("Turn off Pro in this browser? Your key still works: you can add it back any time.")) return;
    S.forgetProKey(storage);
    key = null;
    state = null;
    draw();
    changed();
  }

  async function portal() {
    const res = await call("/api/genesis/pro/portal");
    if (res.ok && res.data.url) { window.location.assign(res.data.url); return; }
    say("g-pro-error", res.data.error || "That page couldn't open just now.", "bad");
  }

  $("g-pro-key-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const tidy = S.proKey($("g-pro-key-input").value);
    if (!tidy) { say("g-pro-key-msg", "A Pro key looks like GP-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX.", "bad"); return; }
    const before = key;
    key = tidy;
    const res = await call("/api/genesis/pro/status");
    if (!res.ok || !res.data.known) {
      key = before;
      say("g-pro-key-msg", res.data.error || "That key doesn't work.", "bad");
      return;
    }
    S.keepProKey(storage, tidy);
    $("g-pro-key-input").value = "";
    state = res.data;
    say("g-pro-key-msg", state.pro ? "Pro is on in this browser." : "That key's Pro isn't active right now.", state.pro ? "ok" : "bad");
    draw();
    changed();
    if (state.pro && state.backups && state.backups.length && source && !source.get().length) {
      restore(state.backups[0].id);
    }
  });

  $("g-pro-resend-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("g-pro-email").value.trim();
    if (!email) { $("g-pro-email").focus(); return; }
    const res = await call("/api/genesis/pro/resend", { email });
    say("g-pro-key-msg", res.data.message || res.data.error || "Please try again.", res.ok ? "ok" : "bad");
  });

  $("g-pro-show-key").addEventListener("click", () => {
    const out = $("g-pro-key");
    out.hidden = !out.hidden;
    out.textContent = out.hidden ? "" : key || "";
    $("g-pro-show-key").textContent = out.hidden ? "Show my key" : "Hide my key";
  });
  $("g-pro-forget").addEventListener("click", forget);
  $("g-pro-portal").addEventListener("click", portal);

  // ---------------------------------------------------------------- buying

  for (const button of root.querySelectorAll(".g-pro-plan")) {
    button.addEventListener("click", async () => {
      say("g-pro-error", "");
      root.querySelectorAll(".g-pro-plan").forEach((b) => { b.disabled = true; });
      const res = await call("/api/genesis/pro/checkout", { plan: button.dataset.plan });
      if (res.ok && res.data.url) { window.location.assign(res.data.url); return; }
      root.querySelectorAll(".g-pro-plan").forEach((b) => { b.disabled = false; });
      say("g-pro-error", res.data.error || "Checkout couldn't start just now. Please try again in a minute.", "bad");
    });
  }

  // ---------------------------------------------------------------- backup

  async function backup(auto) {
    if (!state || !state.pro || !source) return;
    const projects = source.get();
    if (!projects.length) {
      if (!auto) say("g-pro-error", "There are no projects to back up yet.", "bad");
      return;
    }
    lastBackup = Date.now();
    const res = await call("/api/genesis/pro/backup", { projects });
    if (res.ok) {
      state.backups = res.data.backups;
      drawBackups();
      if (!auto) toast("Backed up.");
    } else if (!auto || res.status !== 429) {
      if (res.data && res.data.pro === false) refresh();
      toast(res.data.error || "The backup didn't save. It will try again.", true);
    }
  }

  // Called by genesis.js after every change: back up a little later, at most once a minute.
  function scheduleBackup() {
    if (!state || !state.pro) return;
    clearTimeout(backupTimer);
    const wait = Math.max(AUTO_BACKUP_WAIT, AUTO_BACKUP_GAP - (Date.now() - lastBackup));
    backupTimer = setTimeout(() => backup(true), wait);
  }

  async function restore(id) {
    const res = await call("/api/genesis/pro/restore", { id });
    if (!res.ok || !Array.isArray(res.data.projects)) {
      toast(res.data.error || "That backup couldn't be read.", true);
      return;
    }
    if (!source) return;
    // Merged in, never replacing: nothing in this browser is lost.
    const result = S.importText(JSON.stringify({ projects: res.data.projects }), source.get());
    if (result.error) { toast(result.error, true); return; }
    source.set(result.projects);
    const parts = [];
    if (result.added) parts.push(`${result.added} added`);
    if (result.replaced) parts.push(`${result.replaced} updated`);
    toast(parts.length ? `Restored: ${parts.join(", ")}.` : "Everything in that backup is already here.");
    $("g-pro-backups").hidden = true;
  }

  $("g-pro-backup-now").addEventListener("click", () => backup(false));
  $("g-pro-restore").addEventListener("click", () => {
    const ul = $("g-pro-backups");
    ul.hidden = !ul.hidden;
  });
  $("g-pro-backup-delete").addEventListener("click", async () => {
    if (!confirm("Delete every cloud backup of your projects? The projects in this browser stay.")) return;
    const res = await call("/api/genesis/pro/backup/delete");
    if (res.ok) { state.backups = []; drawBackups(); toast("Backups deleted."); }
    else toast(res.data.error || "Couldn't delete them just now.", true);
  });

  function toast(text, bad = false) {
    const t = $("g-toast");
    if (!t) return;
    t.textContent = text;
    t.classList.toggle("bad", bad);
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2800);
  }

  // ---------------------------------------------------------------- for genesis.js

  window.GenesisPro = {
    active: () => Boolean(state && state.pro),
    key: () => key,
    connect(projects) { source = projects; },
    onChange(cb) { listeners.push(cb); },
    changed: scheduleBackup,
    // What an Ask Genesis answer said about this browser's Pro.
    answered(data) {
      if (!data || !state) return;
      if (data.pro === false && state.pro) { refresh(); return; }
      if (Number.isFinite(data.left_today)) { state.left_today = data.left_today; draw(); }
    },
  };

  draw();
  refresh();
})();
