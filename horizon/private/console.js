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
        el("small", { text: `${p.kind} · Next: ${p.next}` }),
        el("span", { class: `pill ${p.status === "Built" ? "ok" : "off"}`, text: p.status })));
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

  // ---------------------------------------------------------------- Chroma Vortex
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
      vxField("Apps", m.apps.join(", ")), vxField("Kind of partnership", m.partnership),
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
          ? "Nothing archived." : "No messages yet. They appear here when someone sends one from Chroma Vortex." }));
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

  // ---------------------------------------------------------------- loading

  async function load() {
    try {
      const res = await fetch(`/api/console/overview?days=${days}`, { credentials: "same-origin" });
      if (res.status === 404) { window.location.replace("/"); return; }
      const data = await res.json();
      drawOverview(data); drawPlatforms(data); drawChart(data); drawFeed(data);
      drawDials(data); drawProjects(data); drawCosts(data); drawDevices(data);
      // The inbox redraws only when nothing in it is open, so a message
      // being read doesn't close under the owner.
      if (!document.querySelector("#vx-list details[open]")) loadVortex();
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
