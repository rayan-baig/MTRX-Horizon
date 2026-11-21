// The early access form (horizon/early_access.py), on the home page and on
// /early-access. Nothing is sent until the button is pressed. Every message
// is placed with textContent.
(() => {
  function say(form, text, good) {
    const out = form.querySelector(".ea-msg");
    out.textContent = text;
    out.classList.toggle("good", Boolean(good));
    out.classList.toggle("bad", !good && Boolean(text));
  }

  // The same email check as Orbyt's forms (static/js/vortex-form.js).
  const EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

  // Every mistake, as { field: why }, in plain words. Empty when it can go.
  function problems(email, apps, adult) {
    const out = {};
    if (!email) out.email = "Please type your email address.";
    else if (!EMAIL.test(email)) out.email = "That email address doesn't look right. Please check it.";
    if (!apps.length) out.apps = "Tick at least one app.";
    if (!adult) out.adult = "Please tick the box to say you're 18 or over.";
    return out;
  }

  // A mistake goes under its own field, friendly and in place (as on
  // Orbyt), and the first one gets the focus.
  function mark(form, errors, focus = true) {
    let first = null;
    for (const out of form.querySelectorAll(".ea-field-msg")) {
      const name = out.dataset.msgFor;
      out.textContent = errors[name] || "";
      out.classList.toggle("bad", Boolean(errors[name]));
      const field = name === "apps" ? form.querySelector('input[name="apps"]') : form.elements.namedItem(name);
      const target = name === "apps" ? form.querySelector(".ea-apps") : field;
      if (target) target.toggleAttribute("aria-invalid", Boolean(errors[name]));
      if (errors[name] && !first) first = field;
    }
    if (first && focus) first.focus();
  }

  function setup(form) {
    // A fix clears that field's message.
    form.addEventListener("input", (event) => {
      const name = event.target && event.target.name;
      const out = name && form.querySelector(`.ea-field-msg[data-msg-for="${name}"]`);
      if (out && out.textContent) mark(form, Object.fromEntries([...form.querySelectorAll(".ea-field-msg.bad")]
        .map((m) => [m.dataset.msgFor, m.textContent]).filter(([k]) => k !== name)), false);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = form.elements.namedItem("email").value.trim();
      const apps = [...form.querySelectorAll('input[name="apps"]:checked')].map((box) => box.value);
      const adult = form.elements.namedItem("adult").checked;
      const errors = problems(email, apps, adult);
      mark(form, errors);
      say(form, "");
      if (Object.keys(errors).length) return;
      const ref = form.elements.namedItem("ref");
      const body = { email, apps, adult, website: form.elements.namedItem("website").value };
      if (ref) body.ref = ref.value;
      const button = form.querySelector(".ea-go");
      button.disabled = true;
      say(form, "Sending…", true);
      let res = null, data = {};
      try {
        res = await fetch("/api/early-access/join", {
          method: "POST", credentials: "omit",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        try { data = await res.json(); } catch (_) { /* not JSON */ }
      } catch (_) {
        button.disabled = false;
        say(form, "No connection. Please try again.");
        return;
      }
      button.disabled = false;
      if (res.ok) {
        form.classList.add("sent");
        say(form, data.message || "Check your email to confirm.", true);
        return;
      }
      say(form, data.error || "Something went wrong. Please try again.");
    });
  }

  document.querySelectorAll("form.ea-form").forEach(setup);
})();
