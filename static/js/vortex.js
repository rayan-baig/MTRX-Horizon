// The Orbyt page: four paths (investors and buying share one row,
// "Business enquiries"), each a short form, and the released
// apps, each with a button that opens the Partner form with that app picked. A form is sent
// only when Send is pressed, to /api/vortex/send, with no cookie. Every
// word a visitor typed is placed with textContent, never as HTML.
(() => {
  const S = window.GenesisStore;
  const V = window.VortexForm;
  const $ = (id) => document.getElementById(id);
  const forms = {};
  for (const kind of V.KINDS) forms[kind] = document.querySelector(`form[data-kind="${kind}"]`);
  let sending = false;
  let sentKind = null;

  const storage = (name) => { try { return window[name]; } catch (_) { return null; } };

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

  // ---------------------------------------------------------------- the form

  function inputs(form) {
    const out = {};
    for (const name of [...new Set(V.KINDS.flatMap(V.fieldsOf)), "partnership", V.TRAP]) {
      const input = form.elements.namedItem(name);
      if (input && "value" in input) out[name] = input;
    }
    return out;
  }

  function values(kind) {
    const form = forms[kind];
    const out = {};
    for (const [name, input] of Object.entries(inputs(form))) out[name] = input.value;
    out.apps = [...form.querySelectorAll('input[name="apps"]:checked')].map((box) => box.value);
    return out;
  }

  // What the form offers to pick from (the released apps, and the company).
  const choices = (form) => [...form.querySelectorAll('input[name="apps"]')].map((box) => box.value);

  function say(form, field, text) {
    const out = form.querySelector(`[data-msg-for="${field}"]`);
    if (!out) return false;
    out.textContent = text || "";
    out.classList.toggle("bad", Boolean(text));
    return true;
  }

  function clear(form) {
    form.querySelectorAll("[data-msg-for]").forEach((out) => { out.textContent = ""; out.classList.remove("bad"); });
    form.querySelector("[data-error]").textContent = "";
  }

  function counters(form) {
    form.querySelectorAll("[data-count-for]").forEach((out) => {
      const input = form.elements.namedItem(out.dataset.countFor);
      const limit = V.LIMITS[out.dataset.countFor];
      const draw = () => {
        out.textContent = input.value.length ? `${input.value.length}/${limit}` : "";
        out.classList.toggle("over", input.value.length > limit);
      };
      input.addEventListener("input", draw);
      form.addEventListener("reset", () => setTimeout(draw));
      draw();
    });
  }

  function focusField(form, field) {
    const input = form.elements.namedItem(field);
    const target = input && "focus" in input ? input : form.querySelector(`[name="${field}"]`);
    if (target) target.focus();
  }

  async function submit(kind, event) {
    event.preventDefault();
    const form = forms[kind];
    if (sending) return;
    clear(form);
    const vals = values(kind);
    const bad = V.problems(kind, vals, choices(form));
    const fields = Object.keys(bad);
    if (fields.length) {
      for (const f of fields) if (!say(form, f, bad[f])) form.querySelector("[data-error]").textContent = bad[f];
      focusField(form, fields[0]);
      return;
    }
    sending = true;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    form.classList.add("busy");
    let res = null;
    let data = {};
    try {
      res = await fetch("/api/vortex/send", {
        method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(V.body(kind, vals)),
      });
      try { data = await res.json(); } catch (_) { /* not JSON */ }
    } catch (_) {
      res = null;
    }
    sending = false;
    button.disabled = false;
    form.classList.remove("busy");
    if (res && res.ok && data.ok) {
      showSent(kind, data.email || vals.email.trim(), typeof data.review === "string" ? data.review : "");
      form.reset();
      $("v-genesis-note").textContent = "";
      return;
    }
    const why = res ? data.error || "That didn't send. Please try again in a minute."
      : "No connection. Check you're online and try again.";
    if (!(data.field && say(form, data.field, why))) form.querySelector("[data-error]").textContent = why;
    if (data.field) focusField(form, data.field);
  }

  function showSent(kind, email, ticket) {
    sentKind = kind;
    offerReview(kind === "pitch" ? ticket : "");
    for (const k of V.KINDS) $(`v-${k}`).hidden = true;
    $("v-sent-line").textContent = V.sentLine(email);
    $("v-next-step").textContent = V.nextLine(new Date());
    // A useful next step for this path, while the visitor waits for a reply.
    document.querySelectorAll("[data-next]").forEach((link) => {
      link.hidden = !link.dataset.next.split(" ").includes(kind);
    });
    showPanel();
  }

  // The Sent panel, its top just under the bar (its scroll-margin-top), so
  // "Sent." and where the reply goes are the first thing seen. It used to be
  // centred, and with the Pitch Review offer it is taller than a phone's
  // screen, so "Sent." ended up above the top (1.23.0).
  function showPanel() {
    $("v-sent").hidden = false;
    $("v-sent").scrollIntoView({ block: "start", behavior: "instant" });
  }

  // ---------------------------------------------------------------- Pitch Review
  // An optional paid extra (horizon/orbyt_review.py), on the Sent screen
  // only, for a pitch just sent, and only while it is switched on: the page
  // has the box then, and the server sends a one-time ticket for the pitch.
  // A grown-up ticks the 18+ box, and the browser goes to Stripe's checkout.

  const review = $("v-review");
  let reviewTicket = "";
  // The ticket is also kept in this tab's sessionStorage (with when the
  // pitch was sent), so cancelling at Stripe's checkout and coming back
  // (/orbyt#review-cancelled) can say the pitch was sent and offer the review
  // again. It goes when the tab is closed, or after two days (as on the server).
  const TICKET_KEY = "orbyt-review-ticket";
  const TICKET_MS = 2 * 86400 * 1000;
  // The Sent screen's first line then: the pitch went before checkout, and
  // cancelling took no money.
  const CANCELLED = "Your pitch was sent. Checkout was cancelled, and nothing was charged.";

  function keepTicket(ticket) {
    try {
      const tab = storage("sessionStorage");
      if (tab && ticket) tab.setItem(TICKET_KEY, JSON.stringify({ ticket, at: Date.now() }));
    } catch (_) { /* storage off: only the offer on return is lost */ }
  }

  function keptTicket() {
    try {
      const tab = storage("sessionStorage");
      const kept = JSON.parse((tab && tab.getItem(TICKET_KEY)) || "null");
      if (kept && typeof kept.ticket === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(kept.ticket)
          && typeof kept.at === "number" && Date.now() - kept.at < TICKET_MS) return kept;
    } catch (_) { /* nothing kept */ }
    return null;
  }

  function offerReview(ticket) {
    if (!review) return;
    reviewTicket = ticket || "";
    keepTicket(reviewTicket);
    review.hidden = !reviewTicket;
    $("v-review-adult").checked = false;
    if ($("v-review-ai")) $("v-review-ai").checked = false;
    $("v-review-error").textContent = "";
    $("v-review-buy").disabled = false;
  }

  if (review) {
    $("v-review-adult").addEventListener("change", () => { $("v-review-error").textContent = ""; });
    // AI mode only (the page has this box then): the grown-up agrees the
    // idea is sent to an AI service to write the review.
    const aiOk = $("v-review-ai");
    if (aiOk) aiOk.addEventListener("change", () => { $("v-review-error").textContent = ""; });
    $("v-review-buy").addEventListener("click", async () => {
      const error = $("v-review-error");
      const adult = $("v-review-adult");
      if (!adult.checked) {
        error.textContent = "Please tick to say you're 18 or over. If you're not, ask a parent or guardian to buy it for you.";
        adult.focus();
        return;
      }
      if (aiOk && !aiOk.checked) {
        error.textContent = "Please tick to agree that the idea is sent to an AI service to write the review.";
        aiOk.focus();
        return;
      }
      const button = $("v-review-buy");
      button.disabled = true;
      error.textContent = "";
      let res = null;
      let data = {};
      try {
        res = await fetch("/api/orbyt/review/checkout", {
          method: "POST", credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(aiOk ? { ticket: reviewTicket, adult: true, ai: true } : { ticket: reviewTicket, adult: true }),
        });
        try { data = await res.json(); } catch (_) { /* not JSON */ }
      } catch (_) {
        res = null;
      }
      if (res && res.ok && typeof data.url === "string" && data.url.startsWith("https://")) {
        window.location.assign(data.url);
        return;
      }
      button.disabled = false;
      error.textContent = res ? data.error || "Checkout couldn't start just now. Please try again in a minute."
        : "No connection. Check you're online and try again.";
    });
  }

  for (const kind of V.KINDS) {
    forms[kind].addEventListener("submit", (event) => submit(kind, event));
    forms[kind].addEventListener("input", (event) => {
      const name = event.target.name;
      if (name) say(forms[kind], name, "");
    });
    counters(forms[kind]);
  }

  // ---------------------------------------------------------------- Genesis
  // Projects are read from this browser's own Genesis storage, and only fill
  // in the form. Nothing is sent until Send is pressed.

  function useProject(project) {
    const filled = V.fill(inputs(forms.pitch), V.fromGenesis(project));
    filled.forEach((name) => say(forms.pitch, name, ""));
    $("v-genesis-list").hidden = true;
    $("v-genesis-note").textContent =
      `Filled in from your Genesis project “${project.name}”. Check it over: nothing is sent until you press Send.`;
  }

  // Genesis's address ("/genesis", or its own once moved, hosts.py). On
  // another address its saved projects can't be read from here: the
  // visitor brings one with its "Pitch this in Orbyt" button instead.
  const genesis = $("vortex").dataset.genesis || "/genesis";
  const genesisElsewhere = (() => { try { return new URL(genesis, window.location.href).origin !== window.location.origin; } catch (_) { return false; } })();

  function drawPicker() {
    const list = $("v-genesis-list");
    if (genesisElsewhere) {
      list.replaceChildren(el("p", { class: "v-genesis-empty" },
        el("span", { text: "Your Genesis projects are kept on Genesis's own address. Open one there and press " }),
        el("b", { text: "Pitch this in Orbyt" }), el("span", { text: ": it arrives here filled in. " }),
        el("a", { href: genesis, text: "Open Genesis" }), el("span", { text: "." })));
      return;
    }
    const projects = S.open(storage("localStorage")).load().sort((a, b) => b.updated - a.updated);
    if (!projects.length) {
      list.replaceChildren(el("p", { class: "v-genesis-empty" },
        el("span", { text: "No Genesis projects in this browser yet. " }),
        el("a", { href: genesis, text: "Start one in Genesis" }), el("span", { text: "." })));
      return;
    }
    list.replaceChildren(el("p", { class: "v-genesis-head", text: "Your Genesis projects, from this browser:" }),
      el("ul", {}, ...projects.map((p) => {
        const pick = el("button", { type: "button", class: "v-genesis-pick" },
          el("b", { text: p.name }), el("span", { text: p.pitch }));
        pick.addEventListener("click", () => useProject(p));
        return el("li", {}, pick);
      })));
  }

  $("v-from-genesis").addEventListener("click", () => {
    const list = $("v-genesis-list");
    if (list.hidden) drawPicker();
    list.hidden = !list.hidden;
  });

  // ---------------------------------------------------------------- which path

  // A link from another page can open a form with choices made (see
  // V.fromHash): only apps this form offers are picked.
  function preset(kind, asked) {
    const form = forms[kind];
    const offered = choices(form);
    const apps = asked.apps.filter((a) => offered.includes(a));
    if (apps.length) {
      form.querySelectorAll('input[name="apps"]').forEach((box) => { box.checked = apps.includes(box.value); });
      say(form, "apps", "");
    }
    const select = form.elements.namedItem("partnership");
    if (asked.partnership && select) {
      select.value = asked.partnership;
      say(form, "partnership", "");
    }
  }

  function route(smooth) {
    const asked = V.fromHash(window.location.hash);
    const kind = asked.kind;
    if (kind && (asked.apps.length || asked.partnership)) {
      preset(kind, asked);
      // The plain path stays in the address, so reloading keeps what the
      // visitor has changed since.
      history.replaceState(null, "", `#${kind}`);
    }
    sentKind = null;
    $("v-sent").hidden = true;
    for (const k of V.KINDS) {
      $(`v-${k}`).hidden = k !== kind;
      // A path's card, or its button in the Business enquiries row.
      const card = document.querySelector(`[data-path="${k}"]`);
      card.classList.toggle("on", k === kind);
      if (k === kind) card.setAttribute("aria-current", "true");
      else card.removeAttribute("aria-current");
    }
    // The Business enquiries row lights up for either of its two paths.
    document.querySelectorAll(".v-business").forEach((row) => row.classList.toggle("on", kind === "invest" || kind === "buy"));
    document.querySelectorAll(".v-paths").forEach((nav) => nav.classList.toggle("chosen", Boolean(kind)));
    $("v-choose").hidden = Boolean(kind);
    if (kind) jump(kind, smooth);
  }

  // To a form. On arrival (/orbyt#pitch) the jump is "instant": "auto"
  // follows the page's smooth-scroll style, and a smooth scroll that early
  // was often cut short by the page still settling, leaving the visitor at
  // the top (1.17.0). It is done again once the page has loaded, in case
  // fonts or pictures moved things.
  function jump(kind, smooth) {
    $(`v-${kind}`).scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "instant" });
  }

  // Our apps: folded on a phone (the page was long), open on a computer,
  // and opened whenever something points at it.
  const appsFold = $("v-apps-fold");
  function openApps() { if (appsFold) appsFold.open = true; }
  if (appsFold && window.matchMedia && window.matchMedia("(min-width: 721px)").matches) openApps();
  if (window.location.hash === "#our-apps") openApps();
  window.addEventListener("hashchange", () => { if (window.location.hash === "#our-apps") openApps(); });

  window.addEventListener("hashchange", () => route(true));

  // "Partner on this" on an app: open that form with only that app picked.
  document.querySelectorAll("[data-pick]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const kind = link.getAttribute("href").slice(1);
      const form = forms[kind];
      if (!form) return;
      form.querySelectorAll('input[name="apps"]').forEach((box) => { box.checked = box.value === link.dataset.pick; });
      say(form, "apps", "");
      if (window.location.hash === `#${kind}`) {
        event.preventDefault();
        route(true);
      }
    });
  });
  // Pressing the path already open (after sending, say) opens its form again.
  document.querySelectorAll("[data-path]").forEach((card) => {
    card.addEventListener("click", () => {
      if (window.location.hash === `#${card.dataset.path}` && sentKind) route(true);
    });
  });
  $("v-again").addEventListener("click", (event) => {
    event.preventDefault();
    const kind = sentKind;
    history.replaceState(null, "", kind ? `#${kind}` : window.location.pathname);
    route(true);
  });

  // Arrived from Genesis with a project ready to pitch, from this browser's
  // own Genesis storage.
  const offered = V.handedOver(S, storage("sessionStorage"), storage("localStorage"));
  if (offered && window.location.hash !== "#pitch") history.replaceState(null, "", "#pitch");
  // Genesis on its own address (1.26.0): its "Pitch this in Orbyt" opens
  // this page in a new tab, which says it's ready, and Genesis answers with
  // the project's three idea fields by message. Only from Genesis's own
  // address, and only from the tab that opened this one.
  if (genesisElsewhere && window.opener && window.location.hash === "#pitch") {
    const from = new URL(genesis, window.location.href).origin;
    const take = (e) => {
      if (e.origin !== from || e.source !== window.opener || !e.data || e.data.type !== "genesis-pitch") return;
      const p = e.data.project || {};
      const text = (v) => (typeof v === "string" ? v : "");
      if (text(p.name) || text(p.pitch)) useProject({ name: text(p.name), pitch: text(p.pitch), audience: text(p.audience) });
      window.removeEventListener("message", take);
    };
    window.addEventListener("message", take);
    try { window.opener.postMessage({ type: "orbyt-ready" }, from); } catch (_) { /* Genesis closed */ }
  }
  route(false);
  if (offered) useProject(offered);

  // Back from cancelling Stripe's checkout for a Pitch Review: the pitch was
  // sent before checkout, so say so, and that nothing was charged, then offer
  // the review again (when this tab still has its ticket). Not an empty form.
  if (window.location.hash === "#review-cancelled") {
    const kept = keptTicket();
    sentKind = "pitch";
    offerReview(kept ? kept.ticket : "");
    for (const k of V.KINDS) $(`v-${k}`).hidden = true;
    $("v-sent-line").textContent = CANCELLED;
    $("v-next-step").textContent = kept ? V.nextLine(new Date(kept.at)) : "";
    document.querySelectorAll("[data-next]").forEach((link) => {
      link.hidden = !link.dataset.next.split(" ").includes("pitch");
    });
    showPanel();
    // Once more when the page has loaded (fonts can move it), unless the
    // visitor has scrolled or tapped since.
    let moved = false;
    ["wheel", "touchstart", "keydown", "mousedown"].forEach((type) =>
      window.addEventListener(type, () => { moved = true; }, { passive: true, once: true }));
    const again = () => { if (!moved && !$("v-sent").hidden) showPanel(); };
    if (document.readyState === "complete") requestAnimationFrame(again);
    else window.addEventListener("load", () => requestAnimationFrame(again), { once: true });
  }

  // Arrived straight at a form: keep it in view while the page settles.
  // The first jump runs as soon as this script does, often before the fonts
  // have arrived; when they swap in, the text above the form reflows and the
  // form can end up well below the bar (a phone stopped 54 px short, and the
  // old check only helped a visitor still at the very top). So until a
  // moment after the page has loaded, whenever the layout changes, the form's
  // top is checked against the top of the screen (0 to 140 px, under the bar)
  // and put back, unless the visitor has scrolled, tapped or pressed a key
  // since: then the page is theirs (1.19.0).
  const arrived = V.fromHash(window.location.hash).kind;
  if (arrived) {
    let moved = false;
    let done = false;
    const visitor = () => { moved = true; };
    const touches = ["wheel", "touchstart", "keydown", "mousedown"];
    touches.forEach((type) => window.addEventListener(type, visitor, { passive: true, once: true }));
    const again = () => {
      if (done || moved || sentKind) return;
      const kind = V.fromHash(window.location.hash).kind;
      if (kind !== arrived) return;
      const top = $(`v-${kind}`).getBoundingClientRect().top;
      if (top < 0 || top > 140) jump(kind, false);
    };
    const watch = "ResizeObserver" in window ? new ResizeObserver(again) : null;
    if (watch) watch.observe(document.body);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(again, () => {});
    const settle = () => {
      again();
      setTimeout(again, 250);
      setTimeout(() => {
        again();
        done = true;
        if (watch) watch.disconnect();
        touches.forEach((type) => window.removeEventListener(type, visitor));
      }, 1500);
    };
    if (document.readyState === "complete") setTimeout(settle, 0);
    else window.addEventListener("load", settle, { once: true });
  }
})();
