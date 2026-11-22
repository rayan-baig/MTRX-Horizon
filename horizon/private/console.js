// The console page: fetch the real numbers and draw them.
// All text from the server is placed with textContent, never as HTML.
(() => {
  const $ = (id) => document.getElementById(id);
  const ICONS = { rankup: "rankup", cyberlogix: "cyberlogix", omniarmor: "omniarmor" };
  const COLORS = { rankup: "#34e89e", cyberlogix: "#3b9bff", omniarmor: "#c26bff" };
  let days = 30;
  let inviteTimer = null;

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

  function svg(tag, attrs = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  const number = (n) => (n == null ? "–" : new Intl.NumberFormat().format(n));

  function ago(seconds) {
    const s = Math.max(0, Date.now() / 1000 - seconds);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function duration(seconds) {
    if (seconds == null) return "–";
    const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600);
    if (d) return `${d}d ${h}h`;
    return `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  function toast(text, bad = false) {
    const t = $("toast");
    t.textContent = text;
    t.classList.toggle("bad", bad);
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2600);
  }

  async function post(url) {
    const res = await fetch(url, { method: "POST", credentials: "same-origin" });
    let data = {};
    try { data = await res.json(); } catch (_) { /* nothing */ }
    if (res.status === 404) window.location.replace("/");
    return { ok: res.ok, data };
  }

  // ---------------------------------------------------------------- drawing

  function drawOverview(data) {
    const connected = data.apps.filter((a) => a.connected).length;
    $("ov-connected").textContent = `${connected} of ${data.apps.length}`;
    const counts = data.apps.map((a) => a.users).filter((n) => n != null);
    // No numbers can mean no app is connected, or that every connected app
    // is down right now; say which.
    $("ov-users").textContent = counts.length
      ? number(counts.reduce((a, b) => a + b, 0))
      : connected ? "No answer" : "Not connected";
    $("ov-devices").textContent = number(data.devices.length);
    const checked = data.apps.map((a) => data.health[a.key]).filter((h) => h.configured && h.up != null);
    $("ov-up").textContent = checked.length
      ? `${checked.filter((h) => h.up).length} of ${checked.length}`
      : "Not set up";
    $("ov-uptime").textContent = duration(data.server.uptime);
    const me = data.devices.find((d) => d.this);
    if (me) $("who-name").textContent = me.name;
    $("updated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("updated").classList.remove("stale");
  }

  // How long something lasted, to the minute.
  function span(seconds) {
    const s = Math.max(60, seconds);
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  }
  const since = (at) => span(Date.now() / 1000 - at);

  // Up or down: the health check when the app has one, else whether its
  // stats address answered.
  function statePill(app, health) {
    if (health.configured) {
      if (health.up == null) return el("span", { class: "pill off", text: "Not checked yet" });
      if (health.up) return el("span", { class: "pill ok", text: health.ms == null ? "Up" : `Up · ${health.ms} ms` });
      return el("span", { class: "pill down", text: `Down for ${since(health.down_since)}` });
    }
    if (!app.connected) return el("span", { class: "pill off", text: "Not connected" });
    if (app.online) return el("span", { class: "pill ok", text: "Online" });
    return el("span", { class: "pill down", text: "Not answering" });
  }

  // The last 24 hours in half hours: green all up, amber some down, red
  // all down, grey not checked.
  function strip(health) {
    const bars = el("div", { class: "bars", role: "img" });
    const down = health.bars.filter((b) => b != null && b < 1).length;
    bars.setAttribute("aria-label", health.configured
      ? `Last 24 hours: ${down ? `${down} half hour${down === 1 ? "" : "s"} with failed checks` : "no failed checks"}`
      : "No health checks");
    for (const b of health.bars) {
      bars.append(el("i", { class: b == null ? "none" : b >= 1 ? "up" : b <= 0 ? "down" : "part" }));
    }
    let note;
    if (!health.configured) note = "No health address set, so no up/down history.";
    else if (!health.outages.length) note = health.checked_at ? "No outages in the last 7 days." : "Checked once a minute.";
    else {
      const o = health.outages[0];
      const length = o.end == null ? "still down" : `down ${span(o.end - o.start)}`;
      note = `${health.outages.length === 5 ? "5+" : health.outages.length} outage${health.outages.length === 1 ? "" : "s"} in 7 days · last ${ago(o.start)}, ${length}`;
    }
    return el("div", { class: "pstrip" },
      bars,
      el("p", { class: "pnote" },
        el("span", { text: "Last 24 hours" }),
        el("span", { text: health.uptime_day == null ? "" : `${health.uptime_day}% up` }),
        el("span", { class: "pnote-wide", text: note })));
  }

  function drawPlatforms(data) {
    const list = $("platform-list");
    list.replaceChildren();
    const a = data.alerts;
    $("alert-hint").textContent = a.email
      ? `Emails you after ${a.minutes} min down`
      : `Alerts here after ${a.minutes} min down`;
    for (const app of data.apps) {
      const health = data.health[app.key];
      const uptime = health.configured ? health.uptime_week : data.history[app.key]?.uptime;
      list.append(el("li", { class: `platform ${app.color}` },
        el("img", { src: `/static/img/${ICONS[app.key]}-icon.svg`, alt: "" }),
        el("div", { class: "pname" }, el("b", { text: app.name }), statePill(app, health),
          data.admin_urls[app.key]
            ? el("a", { class: "padmin", href: data.admin_urls[app.key], target: "_blank", rel: "noopener", text: "Admin →" })
            : null),
        el("span", { class: "ptags", text: app.tags.join(" • ") }),
        el("div", { class: "pnums" },
          el("span", {}, el("strong", { text: number(app.users) }), "Users"),
          el("span", {}, el("strong", { text: uptime == null ? "–" : `${uptime}%` }),
            health.configured ? "Uptime 7d" : "Uptime")),
        strip(health),
      ));
    }
  }

  function drawChart(data) {
    const box = $("chart");
    box.replaceChildren();
    const series = Object.entries(data.history).filter(([, h]) => h.points.length > 1);
    if (!series.length) {
      box.append(el("div", { class: "empty" },
        el("p", { text: "No history yet." },
          el("small", { text: "Once an app is connected, its user count is saved every hour and drawn here." }))));
      return;
    }
    const W = 600, H = 220, L = 46, B = 24;
    const all = series.flatMap(([, h]) => h.points);
    const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
    const maxY = Math.max(1, ...all.map((p) => p[1])) * 1.1;
    const x = (t) => L + ((t - minX) / Math.max(1, maxX - minX)) * (W - L - 8);
    const y = (v) => (H - B) - (v / maxY) * (H - B - 8);
    const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": "Users over time for each app" });
    for (let i = 0; i <= 4; i++) {
      const v = (maxY / 4) * i;
      chart.append(svg("line", { class: "grid-line", x1: L, x2: W, y1: y(v), y2: y(v) }));
      const label = svg("text", { class: "axis", x: L - 8, y: y(v) + 4, "text-anchor": "end" });
      label.textContent = v >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v);
      chart.append(label);
    }
    for (const t of [minX, (minX + maxX) / 2, maxX]) {
      const label = svg("text", { class: "axis", x: x(t), y: H - 4, "text-anchor": "middle" });
      label.textContent = new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
      chart.append(label);
    }
    for (const [key, h] of series) {
      const d = h.points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
      chart.append(svg("path", { class: "series", d, stroke: COLORS[key], "vector-effect": "non-scaling-stroke" }));
    }
    box.append(chart);
  }

  const FEED_ICONS = {
    "Signed in": "ico-key", "Signed out": "ico-door", "Device approved": "ico-plus",
    "Device removed": "ico-devices", "Door opened": "ico-door", "Approval code made": "ico-plus",
    "App down": "ico-activity", "App back up": "ico-apps", "Alert email failed": "ico-activity",
    "Vortex message": "ico-vortex", "Vortex message deleted": "ico-vortex",
    "App added": "ico-plus", "App edited": "ico-apps", "App released": "ico-globe",
    "App back in development": "ico-apps", "App deleted": "ico-apps",
    "Early access": "ico-users", "Launch email": "ico-users", "Creator application": "ico-key",
    "Creator approved": "ico-key", "Creator removed": "ico-key",
  };

  function drawFeed(data) {
    const feed = $("feed");
    feed.replaceChildren();
    if (!data.activity.length) feed.append(el("li", {}, el("small", { text: "Nothing yet." })));
    for (const item of data.activity.slice(0, 6)) {
      feed.append(el("li", {},
        el("span", { class: "ico-wrap" }, el("span", { class: `ico ${FEED_ICONS[item.event] || "ico-activity"}` })),
        el("b", { text: item.event }),
        el("small", { text: item.detail }),
        el("time", { text: ago(item.at) })));
    }
  }

  function dial(label, value) {
    const r = 40, c = 2 * Math.PI * r;
    const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
    const ring = svg("svg", { viewBox: "0 0 100 100", role: "img", "aria-label": `${label} ${value == null ? "unknown" : pct + "%"}` });
    const defs = svg("defs");
    const id = `g-${label}`;
    const grad = svg("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "1" });
    grad.append(svg("stop", { offset: "0", "stop-color": "#22d3ee" }), svg("stop", { offset: "1", "stop-color": "#8b5cf6" }));
    defs.append(grad);
    ring.append(defs,
      svg("circle", { class: "track", cx: 50, cy: 50, r, fill: "none", "stroke-width": 8 }),
      svg("circle", {
        cx: 50, cy: 50, r, fill: "none", stroke: `url(#${id})`, "stroke-width": 8, "stroke-linecap": "round",
        "stroke-dasharray": `${(pct / 100) * c} ${c}`, transform: "rotate(-90 50 50)",
      }));
    const text = svg("text", { class: "value", x: 50, y: 57, "text-anchor": "middle" });
    text.textContent = value == null ? "–" : `${pct}%`;
    ring.append(text);
    return el("div", { class: "dial" }, ring, el("p", { text: label }));
  }

  function drawDials(data) {
    $("dials").replaceChildren(
      dial("CPU", data.server.cpu), dial("Memory", data.server.memory), dial("Storage", data.server.storage));
  }

  function drawProjects(data) {
    const list = $("project-list");
    list.replaceChildren();
    for (const p of data.projects) {
      list.append(el("li", {},
        el("b", { text: p.name }),
        el("small", { text: p.next ? `${p.kind} · Next: ${p.next}` : p.kind }),
        el("span", { class: `pill ${["Built", "Released"].includes(p.status) ? "ok" : "off"}`, text: p.status })));
    }
  }

  function money(low, high) {
    if (low === high) return low ? `$${low}` : "Free";
    return `$${low}–${high}`;
  }

  function drawCosts(data) {
    const c = data.costs;
    $("cost-total").textContent = `About ${money(c.total_low, c.total_high)} a month`;
    const list = $("cost-list");
    list.replaceChildren();
    for (const item of c.monthly) {
      list.append(el("li", {},
        el("b", { text: item.what }),
        item.note ? el("small", { text: item.note }) : null,
        el("span", { class: "cost", text: money(item.low, item.high) })));
    }
    for (const item of c.per_use) {
      list.append(el("li", {},
        el("b", { text: item.what }),
        el("small", { text: item.note }),
        el("span", { class: "cost", text: "Per use" })));
    }
  }

  function drawDevices(data) {
    const list = $("device-list");
    list.replaceChildren();
    for (const d of data.devices) {
      const seen = d.last_seen ? `last in ${ago(d.last_seen)}` : "not signed in yet";
      const item = el("li", {},
        el("b", { text: d.name }, d.this ? el("span", { class: "this", text: "  · this device" }) : null),
        el("small", { text: `Approved ${new Date(d.created_at * 1000).toLocaleDateString()} · ${seen}` }));
      if (!d.this) {
        const button = el("button", { type: "button", text: "Remove" });
        button.addEventListener("click", async () => {
          if (!confirm(`Remove "${d.name}"? It won't be able to open the console until you approve it again.`)) return;
          const result = await post(`/api/console/devices/${encodeURIComponent(d.id)}/remove`);
          toast(result.ok ? "Device removed." : result.data.error || "Couldn't remove it.", !result.ok);
          load();
        });
        item.append(button);
      }
      list.append(item);
    }
  }

  // ---------------------------------------------------------------- Orbyt
  // Messages visitors sent from /vortex. Everything they wrote is placed
  // with textContent. The reply address is shown as text to copy and as a
  // mailto link; the server only accepts plain addresses, with nothing in
  // them that means something in a link.

  let vxBox = "inbox";

  function drawUnread(count) {
    const badge = $("vx-unread");
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = !count;
    $("vx-count-inbox").textContent = count ? `· ${count} new` : "";
  }

  function vxField(label, value) {
    return value ? el("div", {}, el("dt", { text: label }), el("dd", { text: value })) : null;
  }

  async function vxAct(m, action, item) {
    const result = await post(`/api/console/vortex/${encodeURIComponent(m.id)}/${action}`);
    if (!result.ok) { toast(result.data.error || "Couldn't do that.", true); loadVortex(); return false; }
    if (typeof result.data.unread === "number") drawUnread(result.data.unread);
    return true;
  }

  function vxMessage(m) {
    const title = m.kind === "pitch" ? m.idea : m.organisation || m.name;
    const from = m.kind === "pitch" || !m.organisation ? `from ${m.name}` : `from ${m.name}, ${m.organisation}`;
    const item = el("li", { class: `vx-msg kind-${m.kind}${m.read ? "" : " unread"}` });
    const details = el("details", {});
    const summary = el("summary", {},
      el("span", { class: "vx-dot" }),
      el("span", { class: "vx-kind", text: m.kind_name }),
      el("span", { class: "vx-title" }, el("b", { text: title }), el("small", { text: from })),
      el("time", { text: ago(m.at) }));

    const mailto = `mailto:${m.email}?subject=${encodeURIComponent(
      m.kind === "pitch" ? `Your idea: ${m.idea}` : "Your message to MTRX Horizyn")}`;
    const reply = el("div", { class: "vx-reply" },
      el("span", { class: "vx-reply-label", text: "Reply to" }),
      el("span", { class: "vx-addr", text: m.email }),
      el("a", { class: "btn btn-primary btn-small", href: mailto, text: "Reply by email" }));

    const fields = el("dl", { class: "vx-fields" },
      vxField("Name", m.name), vxField("Organisation", m.organisation),
      vxField(m.kind === "buy" ? "Interested in buying" : "Apps", m.apps.join(", ")),
      vxField("Kind of partnership", m.partnership),
      vxField("Idea", m.idea), vxField("One-line pitch", m.pitch), vxField("Who it's for", m.audience));

    const actions = el("div", { class: "vx-actions" });
    const readButton = el("button", { type: "button", text: m.read ? "Mark unread" : "Mark read" });
    readButton.addEventListener("click", async () => {
      if (!(await vxAct(m, m.read ? "unread" : "read"))) return;
      m.read = !m.read;
      item.classList.toggle("unread", !m.read);
      readButton.textContent = m.read ? "Mark unread" : "Mark read";
    });
    const archive = el("button", { type: "button", text: m.archived ? "Move to inbox" : "Archive" });
    archive.addEventListener("click", async () => {
      if (!(await vxAct(m, m.archived ? "unarchive" : "archive"))) return;
      toast(m.archived ? "Moved to the inbox." : "Archived.");
      loadVortex();
    });
    const remove = el("button", { type: "button", class: "danger", text: "Delete" });
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete this message from ${m.name}? It can't be brought back.`)) return;
      if (!(await vxAct(m, "delete"))) return;
      toast("Message deleted.");
      loadVortex();
    });
    actions.append(readButton, archive, remove);

    details.append(summary, el("div", { class: "vx-body" },
      el("p", { class: "vx-when", text: `Received ${new Date(m.at * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` }),
      fields,
      m.message ? el("p", { class: "vx-text", text: m.message }) : null,
      reply, actions));
    // Opening a message marks it read.
    details.addEventListener("toggle", async () => {
      if (!details.open || m.read) return;
      if (!(await vxAct(m, "read"))) return;
      m.read = true;
      item.classList.remove("unread");
      readButton.textContent = "Mark unread";
    });
    item.append(details);
    return item;
  }

  async function loadVortex() {
    try {
      const res = await fetch(`/api/console/vortex?box=${vxBox}`, { credentials: "same-origin" });
      if (res.status === 404) { window.location.replace("/"); return; }
      const data = await res.json();
      drawUnread(data.unread);
      $("vx-count-archived").textContent = data.archived ? `· ${data.archived}` : "";
      $("vx-keep").textContent = data.keep_days;
      const list = $("vx-list");
      list.replaceChildren(...data.messages.map(vxMessage));
      if (!data.messages.length) {
        list.append(el("li", { class: "vx-empty", text: vxBox === "archived"
          ? "Nothing archived." : "No messages yet. They appear here when someone sends one from Orbyt." }));
      }
    } catch (_) {
      /* the overview says when the console can't refresh */
    }
  }

  document.querySelectorAll(".vx-boxes button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".vx-boxes button").forEach((b) => b.classList.toggle("on", b === button));
      vxBox = button.dataset.box;
      loadVortex();
    });
  });

  // ---------------------------------------------------------------- the app catalog
  // Every app MTRX Horizyn makes. Releasing one puts it on Orbyt at
  // once; one in development is shown nowhere. What the owner typed is
  // placed with textContent.

  let caAccents = [];
  let caCount = 0;
  let caEditing = null; // the key of the app being edited, or null when adding
  let caKeyTyped = false;
  const caForm = $("ca-form");
  const caInput = (name) => caForm.elements.namedItem(name);

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* nothing */ }
    if (res.status === 404) window.location.replace("/");
    return { ok: res.ok, data };
  }

  const slug = (text) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");

  function caBadge(a) {
    return a.icon ? el("img", { class: "ca-icon", src: a.icon, alt: "", width: "40", height: "40" })
      : el("span", { class: `ca-badge accent-${a.accent}`, text: a.letter });
  }

  function caSwatches(selected) {
    $("ca-swatches").replaceChildren(...caAccents.map((name) => {
      const input = el("input", { type: "radio", name: "accent", value: name });
      input.checked = name === selected;
      return el("label", { class: `ca-swatch accent-${name}` }, input, el("i", {}), el("span", { text: name }));
    }));
  }

  function caMsg(field, text) {
    const out = caForm.querySelector(`[data-ca-msg="${field}"]`);
    if (!out) return false;
    out.textContent = text || "";
    return true;
  }

  function caClear() {
    caForm.querySelectorAll("[data-ca-msg]").forEach((out) => { out.textContent = ""; });
    $("ca-error").textContent = "";
  }

  function caOpen(app) {
    caEditing = app ? app.key : null;
    caKeyTyped = false;
    caForm.reset();
    caClear();
    $("ca-form-title").textContent = app ? `Edit ${app.name}` : "Add an app";
    $("ca-save").textContent = app ? "Save changes" : "Add app";
    $("ca-key-field").hidden = Boolean(app);
    if (app) {
      caInput("name").value = app.name;
      caInput("line").value = app.line;
      caInput("url").value = app.own_url;
    }
    caSwatches(app ? app.accent : caAccents[caCount % caAccents.length]);
    caForm.hidden = false;
    caForm.scrollIntoView({ block: "nearest" });
    caInput("name").focus();
  }

  function caClose() {
    caForm.hidden = true;
    caEditing = null;
  }

  async function caAct(a, action, done) {
    const result = await post(`/api/console/apps/${encodeURIComponent(a.key)}/${action}`);
    if (!result.ok) { toast(result.data.error || "Couldn't do that.", true); loadCatalog(); return; }
    toast(done);
    drawCatalog(result.data);
  }

  function caRow(a) {
    const status = el("span", { class: `pill ${a.released ? "ok" : "off"}`, text: a.released ? "Released to the public" : "In development" });
    const where = el("p", { class: "ca-where" },
      a.url ? el("a", { href: a.url, target: "_blank", rel: "noopener", text: a.url.replace(/^https?:\/\//, "") })
        : el("span", { class: "ca-none", text: "No public address yet" }),
      a.url_from_setting ? el("small", { text: `from the ${a.key.toUpperCase()}_URL setting` }) : null);

    const edit = el("button", { type: "button", text: "Edit" });
    edit.addEventListener("click", () => caOpen(a));
    const flip = el("button", { type: "button", class: a.released ? "" : "go",
      text: a.released ? "Back to development" : "Release to the public" });
    flip.addEventListener("click", () => {
      if (a.released) {
        if (!confirm(`Take ${a.name} back into development? It leaves Orbyt at once.`)) return;
        caAct(a, "unrelease", `${a.name} is back in development and no longer public.`);
      } else {
        if (!confirm(`Release ${a.name} to the public? It appears on Orbyt at once.`)) return;
        caAct(a, "release", `${a.name} is now public on Orbyt.`);
      }
    });
    const actions = el("div", { class: "ca-actions" }, edit, flip);
    if (a.deletable) {
      const remove = el("button", { type: "button", class: "danger", text: "Delete" });
      remove.addEventListener("click", () => {
        if (!confirm(`Delete ${a.name}? It has never been released, and it can't be brought back.`)) return;
        caAct(a, "delete", `${a.name} deleted.`);
      });
      actions.append(remove);
    }
    return el("li", { class: `ca-app accent-${a.accent}${a.released ? " released" : ""}` },
      caBadge(a),
      el("div", { class: "ca-main" },
        el("div", { class: "ca-name" }, el("b", { text: a.name }), el("code", { text: a.key }), status),
        el("p", { class: "ca-line", text: a.line }),
        where),
      actions);
  }

  function drawCatalog(data) {
    caAccents = data.accents;
    caCount = data.apps.length;
    const list = $("ca-list");
    list.replaceChildren(...data.apps.map(caRow));
    if (!data.apps.length) list.append(el("li", { class: "vx-empty", text: "No apps yet. Add the first one." }));
  }

  async function loadCatalog() {
    try {
      const res = await fetch("/api/console/apps", { credentials: "same-origin" });
      if (res.status === 404) { window.location.replace("/"); return; }
      drawCatalog(await res.json());
    } catch (_) {
      /* the overview says when the console can't refresh */
    }
  }

  $("ca-new").addEventListener("click", () => caOpen(null));
  $("ca-cancel").addEventListener("click", caClose);
  caInput("name").addEventListener("input", () => {
    if (!caEditing && !caKeyTyped) caInput("key").value = slug(caInput("name").value);
  });
  caInput("key").addEventListener("input", () => { caKeyTyped = true; });
  caForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    caClear();
    const accent = caForm.querySelector('input[name="accent"]:checked');
    const body = { name: caInput("name").value, line: caInput("line").value,
      url: caInput("url").value.trim(), accent: accent ? accent.value : "" };
    if (!caEditing) body.key = caInput("key").value.trim();
    const url = caEditing ? `/api/console/apps/${encodeURIComponent(caEditing)}` : "/api/console/apps";
    const button = $("ca-save");
    button.disabled = true;
    const result = await postJSON(url, body).catch(() => ({ ok: false, data: { error: "No connection. Try again." } }));
    button.disabled = false;
    if (!result.ok) {
      const why = result.data.error || "Couldn't save that.";
      if (!(result.data.field && caMsg(result.data.field, why))) $("ca-error").textContent = why;
      return;
    }
    toast(caEditing ? "Saved." : `${result.data.app.name} added. It stays private until you release it.`);
    caClose();
    drawCatalog(result.data);
  });

  // ---------------------------------------------------------------- Numbers
  // What people did in each app, per day, as each app counts it
  // (horizon/numbers.py): the last 30 days as small bars, this month
  // against last, the three things done most and what to do next.

  const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString([], { month: "short", timeZone: "UTC" });

  // Thirty small bars, one a day. A day the console never heard about is
  // left blank; a quiet day is a thin line.
  function spark(series, days, label) {
    const W = 120, H = 28, step = W / series.length;
    const max = Math.max(1, ...series.filter((n) => n != null));
    const box = svg("svg", { class: "nu-spark", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none",
      role: "img", "aria-label": `${label}, the last ${series.length} days` });
    series.forEach((n, i) => {
      if (n == null) return;
      const h = n ? Math.max(2, (n / max) * (H - 2)) : 1;
      const bar = svg("rect", { x: (i * step + 0.5).toFixed(2), y: (H - h).toFixed(2),
        width: Math.max(1, step - 1).toFixed(2), height: h.toFixed(2), rx: 0.8, class: n ? "on" : "zero" });
      const tip = svg("title");
      tip.textContent = `${days[i]}: ${number(n)}`;
      bar.append(tip);
      box.append(bar);
    });
    return box;
  }

  function change(m) {
    if (m.trend === "up") return el("span", { class: "nu-change up", text: `▲ ${m.change}%` });
    if (m.trend === "down") return el("span", { class: "nu-change down", text: `▼ ${Math.abs(m.change)}%` });
    if (m.trend === "flat") return el("span", { class: "nu-change flat", text: "≈ same" });
    if (m.trend === "new") return el("span", { class: "nu-change up", text: "▲ new" });
    return el("span", { class: "nu-change none", text: "–" });
  }

  function nuMetric(m, app) {
    return el("li", { class: "nu-metric" },
      el("span", { class: "nu-label", text: m.label }),
      spark(m.days, app.days, m.label),
      el("span", { class: "nu-month" },
        el("strong", { text: number(m.this_month) }), change(m),
        el("small", { text: `${monthName(app.month.last)}: ${number(m.last_month)}` })));
  }

  function nuEmpty(app) {
    if (!app.connected) {
      return el("div", { class: "nu-empty" },
        el("p", { text: "Not connected yet." }),
        el("small", { text: `Set ${app.setting} here and STATS_KEY in the app, and its daily numbers show up within a minute.` }));
    }
    return el("div", { class: "nu-empty" },
      el("p", { text: "Connected, with no daily numbers yet." }),
      el("small", { text: app.advice ? app.advice.text : "They appear after the app next answers." }));
  }

  function nuApp(app) {
    const state = !app.connected ? el("span", { class: "pill off", text: "Not connected" })
      : app.has_data ? el("span", { class: "pill ok", text: "Connected" })
        : el("span", { class: "pill off", text: "No daily numbers yet" });
    const head = el("div", { class: "nu-head" },
      el("img", { src: `/static/img/${ICONS[app.key]}-icon.svg`, alt: "", width: "36", height: "36" }),
      el("b", { text: app.name }), state);
    const item = el("li", { class: `nu-app ${app.color}` }, head);
    if (!app.has_data) { item.append(nuEmpty(app)); return item; }
    item.append(
      el("p", { class: `nu-next rule-${app.advice.rule}` },
        el("span", { class: "nu-next-label", text: "What to do next" }), el("span", { text: app.advice.text })),
      el("div", { class: "nu-top" },
        el("span", { class: "nu-top-label", text: "Done most, last 30 days" }),
        app.top.length
          ? el("ol", {}, ...app.top.map((t) => el("li", {}, el("span", { text: t.label }), el("b", { text: number(t.total) }))))
          : el("small", { text: "Nothing yet." })),
      el("div", { class: "nu-cols", "aria-hidden": "true" },
        el("span", { text: "Count" }), el("span", { text: "Last 30 days" }),
        el("span", { text: `${monthName(app.month.this)} so far` })),
      el("ul", { class: "nu-metrics" }, ...app.metrics.map((m) => nuMetric(m, app))));
    return item;
  }

  // Genesis Pro (horizon/genesis_pro.py): members and money, from Stripe's
  // webhook. Hidden while Pro is off and nobody has ever had it.
  const usd = (n) => new Intl.NumberFormat([], { style: "currency", currency: "USD" }).format(n || 0);

  function nuPro(pro) {
    const box = $("nu-pro");
    box.hidden = !pro;
    if (!pro) { box.replaceChildren(); return; }
    const state = pro.ready ? el("span", { class: "pill ok", text: "Selling" })
      : el("span", { class: "pill off", text: pro.enabled ? "Switched on, not set up yet" : "Switched off" });
    const tile = (label, value, note) => el("li", { class: "nu-pro-tile" },
      el("span", { class: "nu-pro-label", text: label }), el("strong", { text: value }),
      note ? el("small", { text: note }) : null);
    // What keeps Pro off while it is switched on, such as email not set up.
    const notes = [...(pro.problems || [])];
    if (pro.disputed) notes.push(`${pro.disputed} member${pro.disputed === 1 ? "'s" : "s'"} Pro is paused by a disputed payment, until the dispute is won.`);
    if (pro.default_prices) {
      notes.push("The AI prices are still the safe defaults, so each answer is counted at ten times a small model's price and members get fewer answers than they should. Set GENESIS_AI_INPUT_PRICE and GENESIS_AI_OUTPUT_PRICE to the model's real prices.");
    }
    if (pro.other_currency) notes.push(`${pro.other_currency} member${pro.other_currency === 1 ? " pays" : "s pay"} in another currency, left out of the dollar figures.`);
    box.replaceChildren(
      el("div", { class: "nu-head" }, el("span", { class: "nu-pro-mark", "aria-hidden": "true" }),
        el("b", { text: "Genesis Pro" }), state),
      el("ul", { class: "nu-pro-tiles" },
        tile("Pro members", number(pro.members), `${number(pro.monthly)} monthly · ${number(pro.yearly)} yearly`),
        tile("Monthly revenue", usd(pro.mrr_usd), "Yearly plans counted as a twelfth"),
        tile("Collected this month", usd(pro.collected_usd), pro.refunded_usd ? `after ${usd(pro.refunded_usd)} refunded` : `Last month ${usd(pro.last_month_usd)}`),
        tile("New this month", number(pro.new_this_month), `${number(pro.ended_this_month)} ended · ${number(pro.cancelling)} cancelling`),
        tile("Payment failed", number(pro.past_due), "Pro paused until they pay"),
        tile("AI cost, 30 days", usd(pro.ai_30d_usd), `Cap ${usd(pro.ai_cap_usd)} per member a month`)),
      ...notes.map((n) => el("p", { class: "nu-pro-note", text: n })));
  }

  // The early access list and the creator program, as tiles like Pro's.
  // Hidden while each is off and has never been used.
  function nuTiles(id, data, title, state, tiles, notes = []) {
    const box = $(id);
    if (!box) return;
    box.hidden = !data;
    if (!data) { box.replaceChildren(); return; }
    box.replaceChildren(
      el("div", { class: "nu-head" }, el("span", { class: "nu-pro-mark", "aria-hidden": "true" }),
        el("b", { text: title }), state),
      el("ul", { class: "nu-pro-tiles" }, ...tiles.map(([label, value, note]) => el("li", { class: "nu-pro-tile" },
        el("span", { class: "nu-pro-label", text: label }), el("strong", { text: value }),
        note ? el("small", { text: note }) : null))),
      ...notes.map((n) => el("p", { class: "nu-pro-note", text: n })));
  }

  function nuEarly(ea) {
    if (!ea) { nuTiles("nu-early", null); return; }
    const state = ea.ready ? el("span", { class: "pill ok", text: "Open" })
      : el("span", { class: "pill off", text: ea.enabled ? "Switched on, not set up yet" : "Switched off" });
    nuTiles("nu-early", ea, "Early access", state, [
      ["Confirmed", number(ea.confirmed), `${number(ea.new_this_week)} this week`],
      ...ea.apps.map((a) => [a.name, number(a.confirmed), `${number(a.unconfirmed)} unconfirmed`]),
      ["Launch emails sent", number(ea.emails_sent), `${number(ea.unconfirmed)} waiting to confirm`],
    ], ea.problems || []);
  }

  function nuCreators(cr) {
    if (!cr) { nuTiles("nu-creators", null); return; }
    const state = cr.enabled ? el("span", { class: "pill ok", text: `${cr.percent}% for ${cr.months} months` })
      : el("span", { class: "pill off", text: "Switched off" });
    nuTiles("nu-creators", cr, "Creators", state, [
      ["Creators", number(cr.approved), `${number(cr.pending)} waiting for you`],
      ["Clicks, 30 days", number(cr.clicks_30), "Each visitor once a day"],
      ["Sign-ups, 30 days", number(cr.signups_30), "Confirmed early access"],
      ["Owed to creators", usd(cr.owed_usd), `${usd(cr.earned_usd)} earned · ${usd(cr.paid_usd)} paid`],
    ], cr.problems || []);
  }

  function drawNumbers(data) {
    nuPro(data.pro);
    nuEarly(data.early_access);
    nuCreators(data.creators);
    const list = $("nu-list");
    list.replaceChildren(...data.apps.map(nuApp));
  }

  async function loadNumbers() {
    try {
      const res = await fetch("/api/console/numbers", { credentials: "same-origin" });
      if (res.status === 404) { window.location.replace("/"); return; }
      drawNumbers(await res.json());
    } catch (_) {
      /* the overview says when the console can't refresh */
    }
  }

  // ---------------------------------------------------------------- early access
  // The list (horizon/early_access.py): counts per app, and the launch email,
  // previewed before it goes. Shown only while it is switched on.

  const eaForm = $("ea-send");
  let eaDraft = null;

  function eaWarn(data) {
    const notes = [];
    if (!data.email) notes.push("Email isn't set up, so nobody can confirm and the sign-up form is hidden. Set MTRX_SMTP_HOST and EARLY_ACCESS_EMAIL_FROM.");
    if (!data.postal) notes.push("Launch emails are blocked until you set MTRX_POSTAL_ADDRESS: every launch email has to show the company's postal address.");
    const missing = data.apps.filter((a) => !a.code).map((a) => a.setting);
    if (missing.length) notes.push(`No founder code yet for ${missing.join(", ")}. Make a promotion code in Stripe and set it, or launch emails for that app stay blocked.`);
    if (!data.percent) notes.push("FOUNDER_PERCENT_OFF isn't set, so the page promises a launch discount without a number.");
    $("ea-warn").replaceChildren(...notes.map((n) => el("li", { text: n })));
  }

  function eaCounts(data) {
    $("ea-counts").replaceChildren(...data.apps.map((a) => {
      const write = el("button", { type: "button", text: "Write launch email" });
      write.addEventListener("click", () => {
        $("ea-app").value = a.key;
        eaShowForm();
        eaForm.scrollIntoView({ block: "nearest" });
        eaForm.elements.namedItem("subject").focus();
      });
      return el("li", { class: `ea-count ${a.key}` },
        el("img", { src: `/static/img/${ICONS[a.key]}-icon.svg`, alt: "", width: "36", height: "36" }),
        el("b", { text: a.name }),
        el("span", { class: "ea-num" }, el("strong", { text: number(a.confirmed) }), el("small", { text: "confirmed" })),
        el("span", { class: "ea-num" }, el("strong", { text: number(a.unconfirmed) }), el("small", { text: "unconfirmed" })),
        el("span", { class: `pill ${a.code ? "ok" : "off"}`, text: a.code ? "Founder code set" : "No founder code" }),
        el("div", { class: "ca-actions" }, write));
    }));
  }

  function eaCampaigns(list) {
    const box = $("ea-campaigns");
    box.replaceChildren(...list.map((c) => el("li", {},
      el("b", { text: c.subject }),
      el("small", { text: `${c.app_name} · ${new Date(c.created_at * 1000).toLocaleDateString([], { dateStyle: "medium" })}` }),
      el("span", { class: "ea-states", text: [`${number(c.sent)} sent`, c.queued ? `${number(c.queued)} on the way` : "",
        c.failed ? `${number(c.failed)} failed` : "", c.skipped ? `${number(c.skipped)} left the list` : ""]
        .filter(Boolean).join(" · ") }))));
    if (!list.length) box.append(el("li", { class: "vx-empty", text: "None yet. Write one above when an app opens." }));
  }

  function eaShowForm() {
    $("ea-preview").hidden = true;
    eaForm.hidden = false;
  }

  async function loadEarly() {
    if (!eaForm) return;
    try {
      const res = await fetch("/api/console/early-access", { credentials: "same-origin" });
      if (res.status === 404) { window.location.replace("/"); return; }
      const data = await res.json();
      const select = $("ea-app");
      if (!select.options.length) {
        select.replaceChildren(...data.apps.map((a) => el("option", { value: a.key, text: a.name })));
      }
      eaWarn(data); eaCounts(data); eaCampaigns(data.campaigns);
    } catch (_) {
      /* the overview says when the console can't refresh */
    }
  }

  function eaBody() {
    return { app: $("ea-app").value, subject: eaForm.elements.namedItem("subject").value,
      message: eaForm.elements.namedItem("message").value };
  }

  if (eaForm) {
    eaForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      $("ea-error").textContent = "";
      eaDraft = eaBody();
      const result = await postJSON("/api/console/early-access/preview", eaDraft)
        .catch(() => ({ ok: false, data: { error: "No connection. Try again." } }));
      if (!result.ok) { $("ea-error").textContent = result.data.error || "Couldn't preview that."; return; }
      const d = result.data;
      $("ea-preview-to").textContent = d.can_send
        ? `Goes to ${number(d.to)} ${d.to === 1 ? "person" : "people"}${d.already ? ` (${number(d.already)} already had it)` : ""}.`
        : "This can't be sent yet:";
      $("ea-problems").replaceChildren(...d.problems.map((p) => el("li", { text: p })));
      $("ea-mail-from").textContent = d.from ? `From: ${d.from}` : "";
      $("ea-mail-subject").textContent = d.subject;
      $("ea-mail-body").textContent = d.body;
      $("ea-go").hidden = !d.can_send;
      $("ea-go").textContent = `Send to ${number(d.to)} ${d.to === 1 ? "person" : "people"}`;
      eaForm.hidden = true;
      $("ea-preview").hidden = false;
    });
    $("ea-edit").addEventListener("click", eaShowForm);
    $("ea-go").addEventListener("click", async () => {
      if (!eaDraft) return;
      if (!confirm("Send this launch email now? Each person gets it once.")) return;
      $("ea-go").disabled = true;
      const result = await postJSON("/api/console/early-access/send", eaDraft)
        .catch(() => ({ ok: false, data: { error: "No connection. Try again." } }));
      $("ea-go").disabled = false;
      if (!result.ok) { toast(result.data.error || "Couldn't send that.", true); return; }
      const d = result.data;
      toast(d.queued ? `On its way to ${number(d.queued)} ${d.queued === 1 ? "person" : "people"}, ${d.per_minute} a minute.`
        : "Everyone confirmed has already had this email.");
      eaForm.reset();
      eaDraft = null;
      eaShowForm();
      loadEarly();
    });
  }

  // ---------------------------------------------------------------- creators
  // The creator program (horizon/creators.py). What creators typed is placed
  // with textContent; a channel link is only made a link if it is http(s).

  const crList = $("cr-pending");
  let crApps = {};

  function crKey(data, name) {
    $("crk-key").value = data.key;
    $("crk-link").textContent = data.link ? `${name}'s link: ${data.link}` : "";
    $("crk-emailed").textContent = data.emailed ? "We've emailed it to them too." : "Email isn't set up, so send it to them yourself.";
    $("cr-key-dialog").showModal();
  }

  function crChannel(url) {
    return /^https?:\/\//i.test(url)
      ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: url.replace(/^https?:\/\//i, "") })
      : el("span", { text: url });
  }

  function crAppSelect(chosen) {
    const select = el("select", { "aria-label": "App their link goes to" },
      el("option", { value: "", text: "Choose the app" }),
      ...Object.entries(crApps).map(([key, name]) => el("option", { value: key, text: name })));
    select.value = chosen || "";
    return select;
  }

  async function crAct(c, action, body = {}) {
    const result = await postJSON(`/api/console/creators/${encodeURIComponent(c.id)}/${action}`, body)
      .catch(() => ({ ok: false, data: { error: "No connection. Try again." } }));
    if (!result.ok) toast(result.data.error || "Couldn't do that.", true);
    return result;
  }

  function crPending(c) {
    const select = crAppSelect(c.app);
    const approve = el("button", { type: "button", class: "go", text: "Approve" });
    approve.addEventListener("click", async () => {
      if (!select.value) { toast("Choose the app their link goes to.", true); select.focus(); return; }
      const result = await crAct(c, "approve", { app: select.value });
      if (!result.ok) return;
      crKey(result.data, c.name);
      loadCreators();
    });
    const decline = el("button", { type: "button", class: "danger", text: "Decline" });
    decline.addEventListener("click", async () => {
      if (!confirm(`Decline ${c.name}? Their application is deleted.`)) return;
      if ((await crAct(c, "remove")).ok) { toast("Declined and deleted."); loadCreators(); }
    });
    return el("li", { class: "cr-item" },
      el("div", { class: "cr-main" },
        el("b", { text: c.name }),
        el("p", { class: "cr-line" }, crChannel(c.channel)),
        el("small", { text: `${c.audience} followers · wants ${c.app_name} · ${c.email} · ${ago(c.created_at)}` })),
      el("div", { class: "ca-actions" }, select, approve, decline));
  }

  function crApproved(c) {
    const kind = el("select", { "aria-label": "Earned or paid" },
      el("option", { value: "earned", text: "Earned" }), el("option", { value: "paid", text: "Paid to them" }));
    const amount = el("input", { type: "text", inputmode: "decimal", placeholder: "Amount, $", "aria-label": "Amount in dollars", maxlength: "10" });
    const note = el("input", { type: "text", placeholder: "Note (optional)", "aria-label": "Note", maxlength: "140" });
    const save = el("button", { type: "button", class: "go", text: "Write it down" });
    save.addEventListener("click", async () => {
      const result = await crAct(c, "record", { kind: kind.value, amount: amount.value, note: note.value });
      if (result.ok) { toast("Written down."); loadCreators(); }
    });
    const key = el("button", { type: "button", text: "New key" });
    key.addEventListener("click", async () => {
      if (!confirm(`Make ${c.name} a new dashboard key? Their old one keeps working until it's one of the oldest.`)) return;
      const result = await crAct(c, "key");
      if (result.ok) crKey(result.data, c.name);
    });
    const remove = el("button", { type: "button", class: "danger", text: "Remove" });
    remove.addEventListener("click", async () => {
      if (!confirm(`Remove ${c.name}? Their link stops working and their numbers are deleted.`)) return;
      if ((await crAct(c, "remove")).ok) { toast("Removed."); loadCreators(); }
    });
    return el("li", { class: "cr-item approved" },
      el("div", { class: "cr-main" },
        el("b", { text: c.name }),
        el("p", { class: "cr-line" }, el("code", { text: c.link }), el("span", { text: ` → ${c.app_name}` })),
        el("small", { text: `${number(c.clicks_30)} clicks and ${number(c.signups_30)} sign-ups in 30 days · ${number(c.clicks)} and ${number(c.signups)} in all` }),
        el("small", { text: `Earned ${usd(c.earned_usd)} · paid ${usd(c.paid_usd)} · owed ${usd(c.owed_usd)}` })),
      el("div", { class: "cr-record" }, kind, amount, note, save),
      el("div", { class: "ca-actions" }, key, remove));
  }

  async function loadCreators() {
    if (!crList) return;
    try {
      const res = await fetch("/api/console/creators", { credentials: "same-origin" });
      if (res.status === 404) { window.location.replace("/"); return; }
      const data = await res.json();
      crApps = data.apps;
      $("cr-note").textContent = `Creators earn ${data.percent}% of what the people they send pay in their ${data.period}. Approve one to give them a short link and a private dashboard key. Write down what they earn and what you pay them here: nothing moves money by itself.`;
      crList.replaceChildren(...data.pending.map(crPending));
      if (!data.pending.length) crList.append(el("li", { class: "vx-empty", text: "No applications waiting." }));
      const approved = $("cr-approved");
      approved.replaceChildren(...data.approved.map(crApproved));
      if (!data.approved.length) approved.append(el("li", { class: "vx-empty", text: "Nobody approved yet." }));
      const badge = $("cr-waiting");
      badge.textContent = String(data.pending.length);
      badge.hidden = !data.pending.length;
    } catch (_) {
      /* the overview says when the console can't refresh */
    }
  }

  if (crList) {
    $("crk-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("crk-key").value); toast("Key copied."); }
      catch (_) { $("crk-key").select(); }
    });
  }

  // ---------------------------------------------------------------- Pitch Reviews
  // Orbyt Pitch Review (horizon/orbyt_review.py): paid reviews to write,
  // soonest due first. What visitors typed is placed with textContent.

  const rvList = $("rv-open");
  const when = (seconds) => new Date(seconds * 1000).toLocaleDateString([], { dateStyle: "medium" });

  // Resend (an AI-written review, emailed again) and Refund (in full,
  // through Stripe), each after a check.
  function rvAct(r, action, question, done) {
    const button = el("button", { type: "button", class: action === "refund" ? "danger" : "go",
      text: action === "refund" ? "Refund" : "Resend" });
    button.addEventListener("click", async () => {
      if (!confirm(question)) return;
      button.disabled = true;
      const result = await post(`/api/console/orbyt-reviews/${encodeURIComponent(r.id)}/${action}`)
        .catch(() => ({ ok: false, data: { error: "No connection. Try again." } }));
      if (!result.ok) { toast(result.data.error || "Couldn't do that.", true); loadReviews(); return; }
      toast(done);
      drawReviews(result.data);
    });
    return button;
  }

  // What the AI did (orbyt_review_ai.py): where it is, why it handed the
  // review to you, and its words once written.
  function rvAi(r) {
    if (!r.ai) return [];
    const out = [];
    const state = r.ai.state;
    if (state === "person") {
      out.push(el("small", { class: "rv-late", text: `Needs you: ${r.ai.note || "the AI couldn't write it"}. Write it yourself, or refund it.` }));
    } else if (state === "queued" || state === "writing") {
      out.push(el("small", { text: r.ai.tries
        ? `The AI is writing it (tried ${r.ai.tries} time${r.ai.tries === 1 ? "" : "s"}; it tries again by itself). Nothing to do.`
        : "The AI is writing it. It's emailed by itself; nothing to do." }));
    } else if (state === "written") {
      out.push(el("small", { text: "Written by AI; the email is being sent (it tries again by itself)." }));
    } else if (state === "sent" && r.ai.emailed_at) {
      out.push(el("small", { text: `Written by AI and emailed ${when(r.ai.emailed_at)}, ${new Date(r.ai.emailed_at * 1000).toLocaleTimeString([], { timeStyle: "short" })}` }));
    }
    if (r.ai.text) {
      out.push(el("details", { class: "rv-text" }, el("summary", { text: "Read the review it wrote" }),
        el("pre", { text: r.ai.text })));
    }
    return out;
  }

  function rvOpen(r) {
    const title = r.idea || "(the idea's name is gone)";
    const pitch = r.pitch_there
      ? el("p", { class: "cr-line", text: `Pitch #${r.message_id} from ${r.name}: ${r.pitch} · for ${r.audience}` })
      : el("p", { class: "cr-line", text: `Pitch #${r.message_id} is no longer there. Refund it.` });
    const due = el("small", { class: r.late ? "rv-late" : "", text: r.late
      ? `Late: was due ${r.due}. Send it now, or refund it.` : `Due by ${r.due}` });
    const yours = r.by === "person";
    const send = r.email && yours
      ? el("a", { class: "btn btn-primary btn-small", text: "Write the review",
        href: `mailto:${r.email}?subject=${encodeURIComponent(`Your Pitch Review: ${r.idea || "your idea"}`)}` })
      : null;
    const sent = yours ? el("button", { type: "button", class: "go", text: "Mark sent" }) : null;
    if (sent) sent.addEventListener("click", async () => {
      if (!confirm(`Mark the review of ${title} as sent?`)) return;
      const result = await post(`/api/console/orbyt-reviews/${encodeURIComponent(r.id)}/sent`)
        .catch(() => ({ ok: false, data: { error: "No connection. Try again." } }));
      if (!result.ok) { toast(result.data.error || "Couldn't do that.", true); loadReviews(); return; }
      toast("Marked sent.");
      drawReviews(result.data);
    });
    const resend = r.can_resend ? rvAct(r, "resend", `Email the AI's review of ${title} to ${r.email}?`, "Review emailed.") : null;
    const refund = r.can_refund ? rvAct(r, "refund", `Refund ${r.paid || "the payment"} for ${title} in full, through Stripe?`, "Refunded.") : null;
    return el("li", { class: `cr-item${r.late ? " rv-item-late" : ""}` },
      el("div", { class: "cr-main" },
        el("b", { text: title }), pitch,
        el("small", { text: `Send it to ${r.email || "(no email from Stripe: see the payment in Stripe)"}` }),
        el("small", { text: `Paid ${r.paid ? `${r.paid} ` : ""}${ago(r.paid_at)}` }), due, ...rvAi(r)),
      el("div", { class: "ca-actions" }, send, resend, sent, refund));
  }

  function rvDone(r) {
    const what = r.status === "refunded" ? `Refunded ${when(r.refunded_at)}`
      : `Sent ${when(r.sent_at)}${r.by === "ai" && r.ai && r.ai.state === "sent" ? " by AI" : ""}`;
    const resend = r.can_resend ? rvAct(r, "resend", `Email the AI's review of ${r.idea || "this idea"} to ${r.email} again?`, "Review emailed again.") : null;
    const refund = r.can_refund ? rvAct(r, "refund", `Refund ${r.paid || "the payment"} for ${r.idea || "this review"} in full, through Stripe?`, "Refunded.") : null;
    return el("li", { class: "cr-item" },
      el("div", { class: "cr-main" }, el("b", { text: r.idea || `Pitch #${r.message_id}` }),
        el("small", { text: `${what} · paid ${when(r.paid_at)}${r.paid ? `, ${r.paid}` : ""}` }),
        ...(r.ai && r.ai.text ? [el("details", { class: "rv-text" }, el("summary", { text: "Read the review it sent" }),
          el("pre", { text: r.ai.text }))] : [])),
      resend || refund ? el("div", { class: "ca-actions" }, resend, refund) : null);
  }

  function drawReviews(data) {
    const notes = [...data.problems, ...(data.ai_notes || [])];
    if (!data.enabled) notes.push("Pitch Review is switched off (ORBYT_REVIEW_ENABLED), so Orbyt doesn't offer it. These are the orders still kept.");
    $("rv-warn").replaceChildren(...notes.map((n) => el("li", { text: n })));
    const days = `due within ${data.days} day${data.days === 1 ? "" : "s"} of payment`;
    $("rv-note").textContent = data.mode === "ai"
      ? `Paid reviews of pitches sent in Orbyt (${data.price}, ${days}). AI mode is on: each review is written by AI and `
        + `emailed to the buyer by itself, usually within minutes (${data.ai_today} of ${data.ai_per_day} AI calls used today). `
        + "Read every one here. If the AI can't write one in time, it's handed to you with an email saying why: write it, "
        + "then press Mark sent. Refund gives the buyer their money back in full through Stripe."
      : `Paid reviews of pitches sent in Orbyt (${data.price}, ${days}). `
        + "Read the pitch, email your review to the buyer, then press Mark sent. A late review, or one you can't write, "
        + "gets a full refund: press Refund, or do it in Stripe (Payments, then Refund).";
    rvList.replaceChildren(...data.open.map(rvOpen));
    if (!data.open.length) rvList.append(el("li", { class: "vx-empty", text: "No reviews to write." }));
    const done = $("rv-done");
    done.replaceChildren(...data.done.map(rvDone));
    if (!data.done.length) done.append(el("li", { class: "vx-empty", text: "None yet." }));
    const badge = $("rv-badge");
    badge.textContent = String(data.open.length);
    badge.hidden = !data.open.length;
  }

  async function loadReviews() {
    if (!rvList) return;
    try {
      const res = await fetch("/api/console/orbyt-reviews", { credentials: "same-origin" });
      if (res.status === 404) { window.location.replace("/"); return; }
      drawReviews(await res.json());
    } catch (_) {
      /* the overview says when the console can't refresh */
    }
  }

  // ---------------------------------------------------------------- loading

  async function load() {
    try {
      const res = await fetch(`/api/console/overview?days=${days}`, { credentials: "same-origin" });
      if (res.status === 404) { window.location.replace("/"); return; }
      const data = await res.json();
      drawOverview(data); drawPlatforms(data); drawChart(data); drawFeed(data);
      drawDials(data); drawProjects(data); drawCosts(data); drawDevices(data);
      // The overview has just saved each app's daily totals; draw them.
      loadNumbers();
      // The inbox redraws only when nothing in it is open, so a message
      // being read doesn't close under the owner.
      if (!document.querySelector("#vx-list details[open]")) loadVortex();
      // The same for the app list while an app is being added or edited.
      if (caForm.hidden) loadCatalog();
      // And for early access and creators while the owner is typing there.
      if (eaForm && !eaForm.contains(document.activeElement) && $("ea-preview").hidden) loadEarly();
      if (crList && !document.querySelector("#creators input:focus, #creators select:focus")) loadCreators();
      loadReviews();
    } catch (_) {
      $("updated").textContent = "Couldn't refresh";
      $("updated").classList.add("stale");
    }
  }

  async function invite() {
    const result = await post("/api/console/invite");
    if (!result.ok) { toast("Couldn't make an approval code.", true); return; }
    $("inv-qr").src = result.data.qr;
    $("inv-url").value = result.data.url;
    $("inv-minutes").textContent = result.data.minutes;
    const ends = Date.now() + result.data.minutes * 60000;
    clearInterval(inviteTimer);
    const tick = () => {
      const left = Math.max(0, Math.round((ends - Date.now()) / 1000));
      $("inv-count").textContent = left ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Expired. Make a new one.";
      if (!left) clearInterval(inviteTimer);
    };
    tick();
    inviteTimer = setInterval(tick, 1000);
    $("invite-dialog").showModal();
    load();
  }

  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "invite") invite();
    if (action === "refresh") { load(); toast("Refreshed."); }
  });

  document.querySelectorAll(".range button[data-days]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".range button[data-days]").forEach((b) => b.classList.toggle("on", b === button));
      days = Number(button.dataset.days);
      load();
    });
  });

  $("inv-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("inv-url").value); toast("Link copied."); }
    catch (_) { $("inv-url").select(); }
  });
  $("invite-dialog").addEventListener("close", () => clearInterval(inviteTimer));

  $("signout").addEventListener("click", async () => {
    const result = await post("/api/console/signout");
    window.location.replace(result.data.go || "/");
  });

  // Keep the nav highlight on the section in view.
  const links = document.querySelectorAll(".sidebar nav a, .mainnav a");
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${entry.target.id}`));
    }
  }, { rootMargin: "-40% 0px -55% 0px" });
  document.querySelectorAll(".grid > section[id], #overview").forEach((s) => observer.observe(s));

  load();
  setInterval(load, 60000);
})();
