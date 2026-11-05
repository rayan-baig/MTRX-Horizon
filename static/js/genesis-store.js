// Genesis: the rules and the saving, with nothing about the page in it.
//
// Every project lives only in the visitor's own browser (localStorage). It
// is never sent to MTRX Horizyn. When the browser blocks storage, projects
// are kept for this visit only and the page says so. The same file runs in
// Node for the tests (module.exports) and in the page (window.GenesisStore).
(function (root) {
  "use strict";

  const KEY = "mtrx-genesis";
  const FORMAT = 1;
  const LIMITS = { projects: 100, name: 60, pitch: 140, audience: 120, address: 253, notes: 5000, file: 1000000 };
  const STAGES = [
    { key: "spark", name: "Spark", line: "The idea, and a name that's yours" },
    { key: "plan", name: "Plan", line: "Decide what the first version is" },
    { key: "build", name: "Build", line: "Make it, and try it on real people" },
    { key: "launch", name: "Launch", line: "Open the doors" },
  ];

  // In plain words, for anyone launching an app or a small business.
  // A key never changes once shipped: ticks are saved against it.
  const CHECKLIST = [
    { key: "name", stage: "spark", label: "Pick a name and check nobody else uses it",
      hint: "Search the web, the app stores and your country's trademark register." },
    { key: "problem", stage: "spark", label: "Say the problem it solves in one sentence" },
    { key: "people", stage: "spark", label: "Talk to 5 people it's for",
      hint: "Ask about their problem, not about your idea." },
    { key: "address", stage: "plan", label: "Get a web address",
      hint: "Check it's free with a domain registrar, then buy it." },
    { key: "first", stage: "plan", label: "Decide the simplest first version",
      hint: "The one thing it must do on day one. Everything else can wait." },
    { key: "price", stage: "plan", label: "Decide the price, or that it's free" },
    { key: "costs", stage: "plan", label: "Work out what it costs to run each month" },
    { key: "helper", stage: "plan", label: "Ask a trusted adult or mentor to look over money and sign-ups",
      hint: "Many services and payment accounts need someone over 18." },
    { key: "build", stage: "build", label: "Build the first version" },
    { key: "try", stage: "build", label: "Try it with 3 real people",
      hint: "Watch them use it and write down where they got stuck." },
    { key: "contact", stage: "build", label: "Give people a way to contact you",
      hint: "A help email or a contact page that you check every day." },
    { key: "privacy", stage: "build", label: "Write a privacy page in plain words",
      hint: "What you keep, why, and how someone can ask you to delete it." },
    { key: "terms", stage: "build", label: "Write simple terms of use" },
    { key: "backups", stage: "build", label: "Set up backups, and test getting something back" },
    { key: "devices", stage: "launch", label: "Check it works on a phone and a computer" },
    { key: "day", stage: "launch", label: "Pick a launch day" },
    { key: "tell", stage: "launch", label: "Tell people it's here",
      hint: "Friends, family, and the places the people it's for already go." },
    { key: "feedback", stage: "launch", label: "Plan how you'll hear what people think" },
    { key: "launch", stage: "launch", label: "Launch it", hint: "Then celebrate, and fix the first thing people ask about." },
  ];
  const CHECKLIST_KEYS = new Set(CHECKLIST.map((i) => i.key));
  const STAGE_KEYS = STAGES.map((s) => s.key);

  // Names already taken by MTRX Horizyn and its apps: a gentle nudge only.
  const KNOWN = ["rankup", "cyberlogix", "cyberlogixai", "omniarmor", "omniarmorai", "mtrxhorizyn", "horizyn"];

  // ---------------------------------------------------------------- text

  // One line of plain text: no control characters, spaces tidied.
  function line(value) {
    if (typeof value !== "string") return "";
    return value.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  // Notes: plain text that keeps its line breaks.
  function block(value) {
    if (typeof value !== "string") return "";
    return value.normalize("NFC").replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "");
  }

  // A web address idea: "nova.com", "nova.co.uk" or just "nova".
  function addressProblem(value) {
    if (!value) return null;
    if (value.length > LIMITS.address) return `Keep it to ${LIMITS.address} characters.`;
    if (/\s/.test(value)) return "A web address can't have spaces.";
    if (/^[a-z]+:\/\//i.test(value) || value.includes("/")) return "Just the name, like nova.com, without https:// or slashes.";
    if (/[A-Z]/.test(value)) return "Use lowercase letters.";
    if (!/^[a-z0-9.-]+$/.test(value)) return "Use only letters, numbers, hyphens and dots.";
    const parts = value.split(".");
    if (parts.some((p) => !p)) return "Each part between dots needs at least one letter or number.";
    for (const p of parts) {
      if (p.length > 63) return "Each part between dots can be at most 63 characters.";
      if (p.startsWith("-") || p.endsWith("-")) return "A part can't start or end with a hyphen.";
    }
    if (parts.length > 1 && !/^[a-z]{2,}$/.test(parts[parts.length - 1])) return "The ending (like .com) should be letters only.";
    return null;
  }

  function suggestAddress(name) {
    const base = line(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 59).replace(/-+$/, "");
    return base ? `${base}.com` : "";
  }

  function nameWarning(name) {
    const flat = line(name).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (flat.length < 4) return null;
    const hit = KNOWN.find((k) => k === flat || (flat.length >= 6 && (flat.includes(k) || k.includes(flat))));
    return hit ? "That's very close to a name MTRX Horizyn already uses. Pick one that's yours alone." : null;
  }

  // Every field, checked. Returns { fields, errors }: errors maps a field to why.
  function check(input) {
    const fields = {
      name: line(input && input.name), pitch: line(input && input.pitch),
      audience: line(input && input.audience), address: line(input && input.address),
    };
    const errors = {};
    for (const f of ["name", "pitch", "audience"]) {
      if (!fields[f]) errors[f] = "This can't be empty.";
      else if (fields[f].length > LIMITS[f]) errors[f] = `Keep it to ${LIMITS[f]} characters.`;
    }
    const bad = addressProblem(fields.address);
    if (bad) errors.address = bad;
    return { fields, errors };
  }

  // ---------------------------------------------------------------- projects

  function newId() {
    const c = root && root.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function create(input, now) {
    const { fields, errors } = check(input);
    if (Object.keys(errors).length) return { errors };
    const at = now || Date.now();
    return { project: { id: newId(), ...fields, stage: "spark", ticks: {}, notes: "", created: at, updated: at } };
  }

  function progress(project) {
    const stages = STAGES.map((s) => {
      const items = CHECKLIST.filter((i) => i.stage === s.key);
      return { ...s, total: items.length, done: items.filter((i) => project.ticks[i.key]).length };
    });
    const done = stages.reduce((n, s) => n + s.done, 0);
    const total = CHECKLIST.length;
    return { stages, done, total, percent: Math.round((100 * done) / total),
      launched: project.stage === "launch" && done === total };
  }

  // One project from anywhere (storage, an imported file), made safe, or null.
  function clean(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const { fields, errors } = check(raw);
    if (errors.name || errors.pitch || errors.audience) return null;
    if (errors.address) fields.address = "";
    const ticks = {};
    if (raw.ticks && typeof raw.ticks === "object") {
      for (const key of Object.keys(raw.ticks)) if (CHECKLIST_KEYS.has(key) && raw.ticks[key] === true) ticks[key] = true;
    }
    const id = typeof raw.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(raw.id) ? raw.id : newId();
    const time = (t) => (Number.isFinite(t) && t > 0 && t < 8.64e15 ? Math.floor(t) : Date.now());
    return {
      id, ...fields,
      stage: STAGE_KEYS.includes(raw.stage) ? raw.stage : "spark",
      ticks, notes: block(raw.notes).slice(0, LIMITS.notes),
      created: time(raw.created), updated: time(raw.updated),
    };
  }

  function cleanList(list) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      const p = clean(raw);
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
      if (out.length >= LIMITS.projects) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- files

  function exportText(projects, now) {
    return JSON.stringify({
      app: "MTRX Horizyn Genesis", format: FORMAT,
      exported: new Date(now || Date.now()).toISOString(), projects,
    }, null, 2);
  }

  // Load a downloaded file back in. A project with the same id is replaced
  // by the file's copy; the rest are added, up to the limit.
  function importText(text, existing) {
    if (typeof text !== "string" || text.length > LIMITS.file) return { error: "That file is too big to be a Genesis file." };
    let data;
    try { data = JSON.parse(text); } catch (_) { return { error: "That file isn't a Genesis file." }; }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.projects) ? data.projects : null;
    if (!list) return { error: "That file isn't a Genesis file." };
    const incoming = cleanList(list);
    const merged = existing.slice();
    let added = 0, replaced = 0, skipped = list.length - incoming.length;
    for (const p of incoming) {
      const at = merged.findIndex((q) => q.id === p.id);
      if (at >= 0) { merged[at] = p; replaced += 1; }
      else if (merged.length < LIMITS.projects) { merged.push(p); added += 1; }
      else skipped += 1;
    }
    return { projects: merged, added, replaced, skipped };
  }

  // ---------------------------------------------------------------- storage

  // Wraps localStorage (or anything shaped like it). Every touch is in a
  // try/catch: a private window, blocked site data or a full disk throws.
  function open(storage) {
    let usable = false;
    try {
      if (storage) {
        storage.setItem(KEY + ":test", "1");
        storage.removeItem(KEY + ":test");
        usable = true;
      }
    } catch (_) { usable = false; }
    let memory = [];

    function load() {
      if (!usable) return memory.slice();
      try {
        const raw = storage.getItem(KEY);
        if (!raw) return [];
        const data = JSON.parse(raw);
        return cleanList(data && data.projects);
      } catch (_) {
        return memory.slice();
      }
    }

    function save(projects) {
      memory = projects.slice();
      if (!usable) return false;
      try {
        storage.setItem(KEY, JSON.stringify({ format: FORMAT, projects }));
        return true;
      } catch (_) {
        return false;
      }
    }

    function clear() {
      memory = [];
      if (!usable) return true;
      try { storage.removeItem(KEY); return true; } catch (_) { return false; }
    }

    return { get usable() { return usable; }, load, save, clear };
  }

  // ---------------------------------------------------------------- Chroma Vortex
  // "Pitch this in Chroma Vortex" hands a project to /vortex through this
  // tab's sessionStorage. Only the project's id goes, never its words, so
  // the idea is never in an address or a server log; the Vortex page reads
  // the project back from this browser's own Genesis storage. The offer is
  // used once and lasts a few minutes. Nothing is sent until the visitor
  // presses Send there.

  const HANDOFF_KEY = "mtrx-vortex-handoff";
  const HANDOFF_MS = 10 * 60 * 1000;
  const ID = /^[A-Za-z0-9-]{1,64}$/;

  function offerToVortex(session, id, now) {
    if (!session || typeof id !== "string" || !ID.test(id)) return false;
    try {
      session.setItem(HANDOFF_KEY, JSON.stringify({ id, at: now || Date.now() }));
      return true;
    } catch (_) {
      return false;
    }
  }

  // The offered project's id, or null. Reading it removes it.
  function takeVortexOffer(session, now) {
    if (!session) return null;
    let raw = null;
    try {
      raw = session.getItem(HANDOFF_KEY);
      session.removeItem(HANDOFF_KEY);
    } catch (_) {
      return null;
    }
    let offer;
    try { offer = JSON.parse(raw); } catch (_) { return null; }
    if (!offer || typeof offer.id !== "string" || !ID.test(offer.id) || !Number.isFinite(offer.at)) return null;
    const age = (now || Date.now()) - offer.at;
    return age >= -60000 && age <= HANDOFF_MS ? offer.id : null;
  }

  const api = {
    KEY, LIMITS, STAGES, CHECKLIST, line, block, addressProblem, suggestAddress, nameWarning,
    check, create, progress, clean, cleanList, exportText, importText, open,
    HANDOFF_KEY, offerToVortex, takeVortexOffer,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GenesisStore = api;
})(typeof window !== "undefined" ? window : globalThis);
