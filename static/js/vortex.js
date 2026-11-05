// The Chroma Vortex page: three paths, each a short form. A form is sent
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
    const bad = V.problems(kind, vals);
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
      showSent(kind, data.email || vals.email.trim());
      form.reset();
      $("v-genesis-note").textContent = "";
      return;
    }
    const why = res ? data.error || "That didn't send. Please try again in a minute."
      : "No connection. Check you're online and try again.";
    if (!(data.field && say(form, data.field, why))) form.querySelector("[data-error]").textContent = why;
    if (data.field) focusField(form, data.field);
  }

  function showSent(kind, email) {
    sentKind = kind;
    for (const k of V.KINDS) $(`v-${k}`).hidden = true;
    $("v-sent-line").textContent = V.sentLine(email);
    $("v-sent").hidden = false;
    $("v-sent").scrollIntoView({ block: "center" });
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

  function drawPicker() {
    const list = $("v-genesis-list");
    const projects = S.open(storage("localStorage")).load().sort((a, b) => b.updated - a.updated);
    if (!projects.length) {
      list.replaceChildren(el("p", { class: "v-genesis-empty" },
        el("span", { text: "No Genesis projects in this browser yet. " }),
        el("a", { href: "/genesis", text: "Start one in Genesis" }), el("span", { text: "." })));
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

  function route(smooth) {
    const hash = window.location.hash.slice(1);
    const kind = V.KINDS.includes(hash) ? hash : null;
    sentKind = null;
    $("v-sent").hidden = true;
    for (const k of V.KINDS) {
      $(`v-${k}`).hidden = k !== kind;
      const card = document.querySelector(`.v-path[data-path="${k}"]`);
      card.classList.toggle("on", k === kind);
      if (k === kind) card.setAttribute("aria-current", "true");
      else card.removeAttribute("aria-current");
    }
    document.querySelector(".v-paths").classList.toggle("chosen", Boolean(kind));
    $("v-choose").hidden = Boolean(kind);
    if (kind) $(`v-${kind}`).scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  }

  window.addEventListener("hashchange", () => route(true));
  // Pressing the path already open (after sending, say) opens its form again.
  document.querySelectorAll(".v-path").forEach((card) => {
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

  // Arrived from Genesis with a project ready to pitch.
  const offered = V.handedOver(S, storage("sessionStorage"), storage("localStorage"));
  if (offered && window.location.hash !== "#pitch") history.replaceState(null, "", "#pitch");
  route(false);
  if (offered) useProject(offered);
})();
