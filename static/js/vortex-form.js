// Chroma Vortex: the form rules, with nothing about the page in it.
//
// The same checks the server makes (horizon/vortex.py), so a visitor hears
// about a mistake before anything is sent; the server checks everything
// again. Also what a Genesis project fills in. The same file runs in Node
// for the tests (module.exports) and in the page (window.VortexForm).
(function (root) {
  "use strict";

  const KINDS = ["partner", "pitch", "invest"];
  const LIMITS = { name: 80, organisation: 120, email: 254, idea: 60, pitch: 140, audience: 120, message: 3000 };
  const FIELDS = {
    partner: { required: ["name", "organisation", "email", "message"], optional: [] },
    pitch: { required: ["name", "email", "idea", "pitch", "audience"], optional: ["message"] },
    invest: { required: ["name", "email", "message"], optional: ["organisation"] },
  };
  const APPS = ["rankup", "cyberlogix", "omniarmor"];
  const PARTNERSHIPS = ["resell", "integrate", "refer", "co-market", "other"];
  const LABELS = {
    name: "your name", organisation: "your organisation", email: "your email",
    idea: "the idea's name", pitch: "the one-line pitch", audience: "who it's for", message: "your message",
  };
  const EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
  const TRAP = "website";

  const fieldsOf = (kind) => FIELDS[kind].required.concat(FIELDS[kind].optional);

  // What goes to the server: this path's fields only, plus the hidden one.
  function body(kind, values) {
    const out = { kind };
    for (const f of fieldsOf(kind)) out[f] = typeof values[f] === "string" ? values[f].trim() : "";
    if (kind === "partner") {
      out.apps = Array.isArray(values.apps) ? values.apps.filter((a) => APPS.includes(a)) : [];
      out.partnership = typeof values.partnership === "string" ? values.partnership : "";
    }
    out[TRAP] = typeof values[TRAP] === "string" ? values[TRAP] : "";
    return out;
  }

  // Every mistake, as { field: why }. Empty when the form can go.
  function problems(kind, values) {
    const errors = {};
    if (!KINDS.includes(kind)) return { kind: "Choose one of the three paths first." };
    const b = body(kind, values);
    for (const f of fieldsOf(kind)) {
      if (!b[f] && FIELDS[kind].required.includes(f)) errors[f] = `Please fill in ${LABELS[f]}.`;
      else if (b[f].length > LIMITS[f]) errors[f] = `Please keep ${LABELS[f]} to ${LIMITS[f].toLocaleString("en")} characters.`;
    }
    if (!errors.email && !EMAIL.test(b.email)) errors.email = "That email address doesn't look right. Please check it.";
    if (kind === "partner") {
      if (!b.apps.length) errors.apps = "Choose which app or apps the partnership is about.";
      if (!PARTNERSHIPS.includes(b.partnership)) errors.partnership = "Choose the kind of partnership.";
    }
    return errors;
  }

  // The idea fields a Genesis project fills in. Genesis keeps the same
  // limits, so nothing is cut; the notes and checklist are never used.
  function fromGenesis(project) {
    const take = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
    return {
      idea: take(project && project.name, LIMITS.idea),
      pitch: take(project && project.pitch, LIMITS.pitch),
      audience: take(project && project.audience, LIMITS.audience),
    };
  }

  // Put values into inputs ({ name: element-like with .value }). Returns
  // the names it filled.
  function fill(inputs, values) {
    const filled = [];
    for (const [name, value] of Object.entries(values)) {
      if (inputs[name] && typeof value === "string") {
        inputs[name].value = value;
        filled.push(name);
      }
    }
    return filled;
  }

  // The project Genesis handed over in this tab ("Pitch this in Chroma
  // Vortex"), read from this browser's own Genesis storage, or null.
  function handedOver(store, session, local, now) {
    const id = store.takeVortexOffer(session, now);
    if (!id) return null;
    return store.open(local).load().find((p) => p.id === id) || null;
  }

  function sentLine(email) {
    return `We'll reply to ${email} as soon as we can.`;
  }

  const api = { KINDS, LIMITS, FIELDS, APPS, PARTNERSHIPS, TRAP, fieldsOf, body, problems, fromGenesis, fill, handedOver, sentLine };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VortexForm = api;
})(typeof window !== "undefined" ? window : globalThis);
