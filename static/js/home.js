// The home page's few moving parts: search, the ⌘K shortcut, Escape to
// close a pop-up card, and remembering calm mode. The page works without
// it; the pop-ups and links are plain anchors.
(() => {
  const q = document.getElementById("search-q");
  const box = document.getElementById("search-results");
  const form = document.getElementById("search");

  // What can be found: each app (its Manage link when it has one) and each
  // pop-up. Built from the page itself, so it never lists anything the
  // page does not have.
  const items = [];
  document.querySelectorAll(".app-card").forEach((card) => {
    const name = card.querySelector("h2").textContent.trim();
    const full = card.querySelector(".app-icon img").alt;
    const link = card.querySelector("a.btn");
    items.push({
      title: full,
      hint: card.querySelector(".app-lede").textContent.trim(),
      words: [name, full, card.querySelector(".tags").textContent].join(" ").toLowerCase(),
      href: link ? link.getAttribute("href") : "#apps",
    });
  });
  [
    ["Projects", "Where everything stands", "#projects", "projects status roadmap"],
    ["Analytics", "Live activity across the apps", "#activity", "analytics numbers users uptime activity"],
    ["Team", "About MTRX Horizon and what we stand for", "#team", "team about values company"],
    ["What's new", "Latest updates", "#updates", "news updates notifications new"],
    ["Watch the video", "A quick tour of the three apps", "#tour", "video tour watch"],
    ["Settings", "Display and calm mode", "#settings", "settings calm motion display"],
  ].forEach(([title, hint, href, words]) => {
    items.push({ title, hint, href, words: (title + " " + words).toLowerCase() });
  });

  let found = [];
  let picked = 0;

  function paint() {
    const term = q.value.trim().toLowerCase();
    if (!term) { box.hidden = true; return; }
    found = items.filter((i) => i.words.includes(term) || i.title.toLowerCase().includes(term));
    picked = 0;
    box.textContent = "";
    if (!found.length) {
      const p = document.createElement("p");
      p.textContent = "Nothing matches that.";
      box.appendChild(p);
    }
    found.forEach((item, index) => {
      const a = document.createElement("a");
      a.href = item.href;
      a.setAttribute("role", "option");
      a.setAttribute("aria-selected", String(index === 0));
      a.textContent = item.title;
      const small = document.createElement("small");
      small.textContent = item.hint;
      a.appendChild(small);
      a.addEventListener("click", () => { q.value = ""; box.hidden = true; });
      box.appendChild(a);
    });
    box.hidden = false;
  }

  function choose(index) {
    picked = (index + found.length) % found.length;
    box.querySelectorAll("a").forEach((a, i) => a.setAttribute("aria-selected", String(i === picked)));
  }

  if (q && box && form) {
    q.addEventListener("input", paint);
    q.addEventListener("keydown", (event) => {
      if (!found.length) return;
      if (event.key === "ArrowDown") { event.preventDefault(); choose(picked + 1); }
      if (event.key === "ArrowUp") { event.preventDefault(); choose(picked - 1); }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const item = found[picked];
      if (!item) return;
      q.value = "";
      box.hidden = true;
      q.blur();
      window.location.href = item.href;
    });
    q.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 150));
  }

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && q) {
      event.preventDefault();
      q.focus();
    } else if (event.key === "Escape") {
      if (document.activeElement === q) { q.value = ""; box.hidden = true; q.blur(); }
      else if (location.hash.length > 1) location.hash = "";
    }
  });

  // The page never scrolls; if following a link ever nudged it, put it back.
  const page = document.querySelector(".page");
  window.addEventListener("hashchange", () => {
    if (page && getComputedStyle(page).overflow === "hidden") page.scrollTop = 0;
  });

  // Calm mode is a checkbox the stylesheet reads; this only remembers it.
  const calm = document.getElementById("calm");
  if (calm) {
    try { calm.checked = localStorage.getItem("mtrx.calm") === "1"; } catch (_) { /* private window */ }
    calm.addEventListener("change", () => {
      try { localStorage.setItem("mtrx.calm", calm.checked ? "1" : "0"); } catch (_) { /* fine */ }
    });
  }
})();
