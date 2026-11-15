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

  function setup(form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = form.elements.namedItem("email").value.trim();
      const apps = [...form.querySelectorAll('input[name="apps"]:checked')].map((box) => box.value);
      const adult = form.elements.namedItem("adult").checked;
      if (!email || !email.includes("@")) { say(form, "Type your email address."); return; }
      if (!apps.length) { say(form, "Tick at least one app."); return; }
      if (!adult) { say(form, "Please tick the box to say you're 18 or over."); return; }
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
