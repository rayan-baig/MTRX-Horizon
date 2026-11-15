// A creator's dashboard (horizon/creators.py). The key goes in a header,
// never a cookie, and is kept in this browser only if the creator says so.
// Every answer is placed with textContent; the chart is drawn as SVG.
(() => {
  const $ = (id) => document.getElementById(id);
  const STORE = "mtrx-creator-key";
  let storage = null;
  try { storage = window.localStorage; } catch (_) { storage = null; }
  const usd = (n) => new Intl.NumberFormat([], { style: "currency", currency: "USD" }).format(n || 0);
  const count = (n) => new Intl.NumberFormat().format(n || 0);

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

  function remembered() {
    try { return storage ? storage.getItem(STORE) || "" : ""; } catch (_) { return ""; }
  }

  function chart(days) {
    const W = 300, H = 90, step = W / days.length;
    const max = Math.max(1, ...days.map((d) => d.clicks));
    const box = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img",
      "aria-label": "Clicks and sign-ups, the last 30 days" });
    days.forEach((d, i) => {
      const h = d.clicks ? Math.max(2, (d.clicks / max) * (H - 4)) : 1;
      const bar = svg("rect", { class: d.clicks ? "on" : "zero", x: (i * step + 1).toFixed(1), y: (H - h).toFixed(1),
        width: Math.max(1, step - 2).toFixed(1), height: h.toFixed(1), rx: 1.5 });
      const tip = svg("title");
      tip.textContent = `${d.day}: ${count(d.clicks)} clicks, ${count(d.signups)} sign-ups`;
      bar.append(tip);
      box.append(bar);
      if (d.signups) {
        box.append(svg("circle", { class: "signup", cx: (i * step + step / 2).toFixed(1),
          cy: Math.max(5, H - h - 6).toFixed(1), r: 3 }));
      }
    });
    return box;
  }

  function draw(data) {
    $("cr-name").textContent = data.name;
    $("cr-deal").textContent = `You earn ${data.percent}% of what the people who come through your link pay in their ${data.period}. Your link goes to ${data.app_name || "our apps"}.`;
    $("cr-link").textContent = data.link;
    $("cr-clicks30").textContent = count(data.clicks_30);
    $("cr-clicks").textContent = `${count(data.clicks)} in all`;
    $("cr-signups30").textContent = count(data.signups_30);
    $("cr-signups").textContent = `${count(data.signups)} in all`;
    $("cr-earned").textContent = usd(data.earned_usd);
    $("cr-paid").textContent = `${usd(data.paid_usd)} paid`;
    $("cr-owed").textContent = usd(data.owed_usd);
    $("cr-chart").replaceChildren(chart(data.days));
    const list = $("cr-ledger");
    list.replaceChildren(...data.ledger.map((item) => el("li", { class: `cr-${item.kind}` },
      el("span", { text: new Date(item.at * 1000).toLocaleDateString([], { dateStyle: "medium" }) }),
      el("b", { text: item.kind === "paid" ? "Paid to you" : "Earned" }),
      item.note ? el("small", { text: item.note }) : null,
      el("strong", { text: usd(item.usd) }))));
    if (!data.ledger.length) list.append(el("li", { class: "cr-none", text: "Nothing yet. Earnings show here once people you sent start paying." }));
    $("cr-locked").hidden = true;
    $("cr-board").hidden = false;
  }

  async function open(key, remember) {
    const msg = $("cr-key-msg");
    msg.textContent = "Opening…";
    let res = null, data = {};
    try {
      res = await fetch("/api/creators/me", {
        method: "POST", credentials: "omit", headers: { "X-Creator-Key": key },
      });
      try { data = await res.json(); } catch (_) { /* not JSON */ }
    } catch (_) {
      msg.textContent = "No connection. Please try again.";
      return;
    }
    if (!res.ok) {
      msg.textContent = data.error || "That didn't work. Please try again.";
      if (res.status === 403) { try { if (storage) storage.removeItem(STORE); } catch (_) { /* fine */ } }
      $("cr-locked").hidden = false;
      $("cr-board").hidden = true;
      return;
    }
    msg.textContent = "";
    try { if (storage && remember) storage.setItem(STORE, key); } catch (_) { /* this browser won't keep it */ }
    draw(data);
  }

  $("cr-key-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    const key = form.elements.namedItem("key").value.trim();
    if (!key) { $("cr-key-msg").textContent = "Paste your key first."; return; }
    open(key, form.elements.namedItem("remember").checked);
  });

  $("cr-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("cr-link").textContent); $("cr-copy").textContent = "Copied"; }
    catch (_) { $("cr-copy").textContent = "Select the link to copy it"; }
  });

  $("cr-forget").addEventListener("click", () => {
    try { if (storage) storage.removeItem(STORE); } catch (_) { /* fine */ }
    window.location.reload();
  });

  const kept = remembered();
  if (kept) open(kept, true);
})();
