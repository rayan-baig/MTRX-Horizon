// The creator application form on /creators (horizon/creators.py). Nothing
// is sent until the button is pressed. Every message is placed with
// textContent.
(() => {
  const form = document.getElementById("cr-form");
  if (!form) return;
  const result = document.getElementById("cr-result");
  const field = (name) => form.elements.namedItem(name);

  function clear() {
    form.querySelectorAll(".cr-msg").forEach((m) => { m.textContent = ""; });
    result.textContent = "";
    result.classList.remove("good", "bad");
  }

  function fieldMessage(name, text) {
    const out = form.querySelector(`.cr-msg[data-for="${name}"]`);
    if (!out) return false;
    out.textContent = text;
    return true;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clear();
    const body = {
      name: field("name").value, email: field("email").value.trim(), channel: field("channel").value.trim(),
      audience: field("audience").value, app: field("app").value, grown_up: field("grown_up").checked,
      website: field("website").value,
    };
    if (!body.grown_up) {
      fieldMessage("grown_up", "Please tick the box: you're 18 or over, or your parent or guardian is applying for you.");
      return;
    }
    const button = document.getElementById("cr-send");
    button.disabled = true;
    let res = null, data = {};
    try {
      res = await fetch("/api/creators/apply", {
        method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      try { data = await res.json(); } catch (_) { /* not JSON */ }
    } catch (_) {
      button.disabled = false;
      result.textContent = "No connection. Please try again.";
      result.classList.add("bad");
      return;
    }
    button.disabled = false;
    if (res.ok) {
      form.reset();
      form.classList.add("sent");
      result.textContent = data.message || "Thanks! We'll be in touch.";
      result.classList.add("good");
      return;
    }
    const why = data.error || "Something went wrong. Please try again.";
    if (!(data.field && fieldMessage(data.field, why))) {
      result.textContent = why;
      result.classList.add("bad");
    }
  });
})();
