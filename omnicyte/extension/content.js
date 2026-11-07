// Runs in every page. Collects the page's links (address and the words shown
// for them), asks Omnicyte about them, marks the dangerous ones and stops a
// click on one with a warning that shows why. Also checks the page itself,
// more strictly once it has a password box.
"use strict";

(() => {
  const MAIL = ["mail.google.com", "outlook.office.com", "outlook.office365.com", "outlook.live.com", "mail.yahoo.com"];
  const CHAT = ["app.slack.com", "teams.microsoft.com", "teams.live.com", "web.whatsapp.com", "discord.com",
                "chat.google.com", "web.telegram.org", "www.messenger.com"];
  const host = location.hostname;
  const kind = MAIL.includes(host) ? "mail" : CHAT.includes(host) ? "chat" : "browser";
  const verdicts = new Map(); // href -> verdict
  const asked = new Set();
  let pageChecked = false;
  let pagePassword = false;

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? { error: "gone" } : r || {}));
      } catch (e) {
        resolve({ error: "gone" });
      }
    });
  }

  function realHref(a) {
    const h = a.getAttribute("href");
    if (!h || h.startsWith("#") || /^(mailto|tel|sms):/i.test(h)) return "";
    try { return new URL(h, location.href).href; } catch (e) { return ""; }
  }

  function linkText(a) {
    return (a.innerText || a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200);
  }

  function mark(a, v) {
    if (!v || v.level === "safe") return;
    a.dataset.omnicyte = v.level;
    a.style.outline = v.level === "danger" ? "2px solid #ff5470" : "2px dashed #ffc145";
    a.style.outlineOffset = "1px";
    a.style.borderRadius = "2px";
    const first = (v.signals || [])[0];
    a.title = (v.level === "danger" ? "⚠ Omnicyte: don't click. " : "Omnicyte: take care. ") + (first ? first.title : "");
  }

  async function scan() {
    const anchors = Array.from(document.querySelectorAll("a[href]")).slice(0, 2000);
    const fresh = [];
    for (const a of anchors) {
      const href = realHref(a);
      if (!href) continue;
      if (verdicts.has(href)) { mark(a, verdicts.get(href)); continue; }
      const key = href + "\u0000" + linkText(a);
      if (asked.has(key)) continue;
      asked.add(key);
      fresh.push({ href, text: linkText(a) });
    }
    if (fresh.length) {
      const res = await send({ type: "links", links: fresh, site: host, kind });
      for (const [href, v] of Object.entries(res.links || {})) verdicts.set(href, v);
      for (const a of anchors) { const h = realHref(a); if (verdicts.has(h)) mark(a, verdicts.get(h)); }
    }
    const hasPassword = !!document.querySelector("input[type=password]");
    if (!pageChecked || (hasPassword && !pagePassword)) {
      pageChecked = true;
      pagePassword = hasPassword;
      const v = await send({ type: "page", url: location.href, password_field: hasPassword });
      if (v && v.level === "danger") warn(v, "This page looks like a fake.", null);
    }
  }

  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 800);
  });

  // A warning drawn in its own shadow root, so the page's styles can't hide or restyle it.
  function warn(v, headline, onContinue) {
    if (document.getElementById("omnicyte-warning")) return;
    const holder = document.createElement("div");
    holder.id = "omnicyte-warning";
    const root = holder.attachShadow({ mode: "closed" });
    const danger = v.level === "danger";
    const signals = (v.signals || []).slice(0, 5);
    const tip = (signals.find((s) => s.tip) || {}).tip || "";
    root.innerHTML = `
      <style>
        .back{position:fixed;inset:0;background:rgba(8,10,18,.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
        .card{background:#1b1f2b;color:#eef2f8;max-width:440px;width:calc(100% - 32px);border-radius:16px;padding:20px 22px;box-shadow:0 20px 60px rgba(0,0,0,.5);border:1px solid #3a4256}
        .top{display:flex;gap:12px;align-items:center}
        .cell{width:44px;height:40px;border-radius:50%;flex:none;background:${danger ? "#ff5470" : "#ffc145"};border:3px solid ${danger ? "#c4223f" : "#d18f12"};position:relative;animation:hop .5s ease-in-out 3}
        .cell:before,.cell:after{content:"";position:absolute;top:11px;width:9px;height:10px;border-radius:50%;background:#fff;box-shadow:inset 2px 2px 0 2px #14202b}
        .cell:before{left:9px}.cell:after{right:9px}
        @keyframes hop{50%{transform:translateY(-10px)}}
        h1{font-size:17px;margin:0;color:${danger ? "#ff8095" : "#ffd27a"}}
        .dest{color:#9aa6b8;font-size:12px;margin:8px 0 10px;word-break:break-all}
        ul{margin:6px 0 10px;padding-left:18px}li{margin:3px 0}
        .tip{background:#262c3c;border-radius:10px;padding:9px 11px;font-size:12.5px}
        .row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}
        button{font:600 13px system-ui,sans-serif;border:0;border-radius:9px;padding:8px 14px;cursor:pointer}
        .go{background:#3ad6c5;color:#0d1a1f}.risk{background:transparent;color:#9aa6b8;text-decoration:underline}
      </style>
      <div class="back"><div class="card" role="alertdialog" aria-modal="true" aria-labelledby="h">
        <div class="top"><div class="cell"></div><h1 id="h"></h1></div>
        <div class="dest"></div>
        <strong>Why I think so:</strong><ul></ul>
        <div class="tip"></div>
        <div class="row"><button class="risk" type="button">Open it anyway</button><button class="go" type="button">Keep me safe</button></div>
      </div></div>`;
    root.getElementById("h").textContent = headline;
    root.querySelector(".dest").textContent = v.destination ? "Really goes to: " + v.destination : (v.url || location.href);
    const ul = root.querySelector("ul");
    for (const s of signals) { const li = document.createElement("li"); li.textContent = s.title; ul.appendChild(li); }
    const tipBox = root.querySelector(".tip");
    if (tip) tipBox.textContent = "Spot it next time: " + tip; else tipBox.remove();
    const close = () => holder.remove();
    root.querySelector(".go").addEventListener("click", () => {
      close();
      if (!onContinue && danger) history.length > 1 ? history.back() : location.replace("about:blank");
    });
    const risk = root.querySelector(".risk");
    if (onContinue) risk.addEventListener("click", () => { close(); onContinue(); });
    else risk.addEventListener("click", close);
    document.documentElement.appendChild(holder);
    root.querySelector(".go").focus();
  }

  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    const href = realHref(a);
    const v = verdicts.get(href);
    if (!v || v.level !== "danger") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const newTab = e.ctrlKey || e.metaKey || a.target === "_blank";
    warn(v, "Don't click that link! It looks like phishing.", () => {
      if (newTab) window.open(href, "_blank", "noopener"); else location.href = href;
    });
  }, true);

  scan();
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
