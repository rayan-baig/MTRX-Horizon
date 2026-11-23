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
  const LIMITS = { projects: 100, name: 60, pitch: 140, audience: 120, address: 253, notes: 5000, file: 1000000,
    custom: 30, step: 120 };
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
  // A step of the visitor's own: "c-" and a few letters and digits, so it
  // can never be mistaken for one of the CHECKLIST keys above.
  const CUSTOM_KEY = /^c-[a-z0-9]{1,12}$/;

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
    return { project: { id: newId(), ...fields, stage: "spark", ticks: {}, hidden: {}, custom: [], notes: "",
      created: at, updated: at } };
  }

  // ---------------------------------------------------------------- the project's own checklist
  // Every project starts with the same CHECKLIST, but no two ideas are the
  // same: a visitor can hide a step that doesn't fit (project.hidden) and add
  // steps of their own (project.custom). Both stay in this browser like
  // everything else, and both can be undone.

  // The steps this project shows, stage by stage: the built-in ones not
  // hidden, then the visitor's own.
  function steps(project) {
    const hidden = (project && project.hidden) || {};
    const custom = project && Array.isArray(project.custom) ? project.custom : [];
    const out = [];
    for (const s of STAGES) {
      for (const i of CHECKLIST) if (i.stage === s.key && !hidden[i.key]) out.push(i);
      for (const c of custom) if (c.stage === s.key) out.push({ key: c.key, stage: c.stage, label: c.label, custom: true });
    }
    return out;
  }

  // The built-in steps this project has hidden, to bring back.
  function hiddenSteps(project) {
    const hidden = (project && project.hidden) || {};
    return CHECKLIST.filter((i) => hidden[i.key]);
  }

  function stepKey(project) {
    const taken = new Set((project.custom || []).map((c) => c.key));
    for (;;) {
      const key = "c-" + Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, "");
      if (CUSTOM_KEY.test(key) && !taken.has(key)) return key;
    }
  }

  // Add a step of the visitor's own to a stage. Changes the project.
  function addStep(project, stage, label) {
    const text = line(label);
    if (!STAGE_KEYS.includes(stage)) return { error: "Choose a stage for the step." };
    if (!text) return { error: "Write the step first." };
    if (text.length > LIMITS.step) return { error: `Keep it to ${LIMITS.step} characters.` };
    const custom = Array.isArray(project.custom) ? project.custom : [];
    if (custom.length >= LIMITS.custom) return { error: `A project can have ${LIMITS.custom} steps of your own.` };
    const step = { key: stepKey(project), stage, label: text };
    project.custom = custom.concat([step]);
    return { step };
  }

  // Hide a built-in step, or remove one of the visitor's own. Changes the
  // project. At least one step always stays.
  function hideStep(project, key) {
    if (steps(project).length <= 1) return { error: "Keep at least one step." };
    if (CUSTOM_KEY.test(key)) {
      const custom = (project.custom || []).filter((c) => c.key !== key);
      if (custom.length === (project.custom || []).length) return { error: "That step isn't there." };
      project.custom = custom;
      if (project.ticks) delete project.ticks[key];
      return { removed: true };
    }
    if (!CHECKLIST_KEYS.has(key)) return { error: "That step isn't there." };
    project.hidden = { ...(project.hidden || {}), [key]: true };
    return { hidden: true };
  }

  // Bring a hidden built-in step back. Changes the project.
  function showStep(project, key) {
    if (!project.hidden || !project.hidden[key]) return false;
    const hidden = { ...project.hidden };
    delete hidden[key];
    project.hidden = hidden;
    return true;
  }

  function progress(project) {
    const all = steps(project);
    const ticks = (project && project.ticks) || {};
    const stages = STAGES.map((s) => {
      const items = all.filter((i) => i.stage === s.key);
      return { ...s, total: items.length, done: items.filter((i) => ticks[i.key]).length };
    });
    const done = stages.reduce((n, s) => n + s.done, 0);
    const total = all.length;
    return { stages, done, total, percent: total ? Math.round((100 * done) / total) : 0,
      launched: project.stage === "launch" && total > 0 && done === total };
  }

  // One project from anywhere (storage, an imported file), made safe, or null.
  function clean(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const { fields, errors } = check(raw);
    if (errors.name || errors.pitch || errors.audience) return null;
    if (errors.address) fields.address = "";
    const custom = [];
    for (const c of Array.isArray(raw.custom) ? raw.custom : []) {
      if (custom.length >= LIMITS.custom) break;
      if (!c || typeof c !== "object") continue;
      const label = line(c.label);
      if (typeof c.key !== "string" || !CUSTOM_KEY.test(c.key) || custom.some((d) => d.key === c.key)) continue;
      if (!STAGE_KEYS.includes(c.stage) || !label || label.length > LIMITS.step) continue;
      custom.push({ key: c.key, stage: c.stage, label });
    }
    let hidden = {};
    if (raw.hidden && typeof raw.hidden === "object") {
      for (const key of Object.keys(raw.hidden)) if (CHECKLIST_KEYS.has(key) && raw.hidden[key] === true) hidden[key] = true;
    }
    // Never an empty checklist: with every step hidden and none of their own,
    // the built-in steps come back.
    if (!custom.length && CHECKLIST.every((i) => hidden[i.key])) hidden = {};
    const mine = new Set(custom.map((c) => c.key));
    const ticks = {};
    if (raw.ticks && typeof raw.ticks === "object") {
      for (const key of Object.keys(raw.ticks)) {
        if ((CHECKLIST_KEYS.has(key) || mine.has(key)) && raw.ticks[key] === true) ticks[key] = true;
      }
    }
    const id = typeof raw.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(raw.id) ? raw.id : newId();
    const time = (t) => (Number.isFinite(t) && t > 0 && t < 8.64e15 ? Math.floor(t) : Date.now());
    return {
      id, ...fields,
      stage: STAGE_KEYS.includes(raw.stage) ? raw.stage : "spark",
      ticks, hidden, custom, notes: block(raw.notes).slice(0, LIMITS.notes),
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

  // ---------------------------------------------------------------- Orbyt
  // "Pitch this in Orbyt" hands a project to /orbyt through this
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

  // ---------------------------------------------------------------- Genesis Pro
  // A Pro key is kept in this browser's storage under PRO_KEY, so Pro stays on
  // here. It is sent only to MTRX Horizyn, in a header, with Pro requests.

  const PRO_KEY = "mtrx-genesis-pro";

  // A key as typed or pasted, tidied to GP-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX, or null.
  function proKey(raw) {
    if (typeof raw !== "string" || raw.length > 80) return null;
    const flat = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^GP[A-Z2-7]{24}$/.test(flat)) return null;
    return "GP-" + flat.slice(2).match(/.{4}/g).join("-");
  }

  function readProKey(storage) {
    try { return storage ? proKey(storage.getItem(PRO_KEY)) : null; } catch (_) { return null; }
  }

  function keepProKey(storage, key) {
    const tidy = proKey(key);
    if (!storage || !tidy) return false;
    try { storage.setItem(PRO_KEY, tidy); return true; } catch (_) { return false; }
  }

  function forgetProKey(storage) {
    try { if (storage) storage.removeItem(PRO_KEY); return true; } catch (_) { return false; }
  }

  // "Download plan": one project as a plain text file anyone can open.
  function planText(project, now) {
    const p = clean(project);
    if (!p) return "";
    const pr = progress(p);
    const stage = STAGES.find((s) => s.key === p.stage) || STAGES[0];
    const day = new Date(now || Date.now()).toISOString().slice(0, 10);
    const out = [
      `# ${p.name}`, "", p.pitch, "",
      `For: ${p.audience}`,
    ];
    if (p.address) out.push(`Web address idea: ${p.address}`);
    out.push(`Stage: ${pr.launched ? "Launched" : stage.name} (${pr.done} of ${pr.total} steps done, ${pr.percent}%)`, "");
    const all = steps(p);
    for (const s of STAGES) {
      const items = all.filter((i) => i.stage === s.key);
      out.push(`## ${s.name}: ${s.line}`, "");
      for (const item of items) out.push(`- [${p.ticks[item.key] ? "x" : " "}] ${item.label}`);
      out.push("");
    }
    if (p.notes.trim()) out.push("## Notes", "", p.notes.trim(), "");
    out.push(`Made with Genesis, MTRX Horizyn. ${day}`, "");
    return out.join("\n");
  }

  // A file name from a project's name: "nova-notes-plan.txt".
  function planFileName(project) {
    const base = suggestAddress(project && project.name).replace(/\.com$/, "") || "genesis";
    return `${base}-plan.txt`;
  }

  // ---------------------------------------------------------------- the first minute
  // Example ideas, so nobody starts at a blank page. "Try an example" fills
  // the form with one; nothing is saved until the visitor presses Start.

  const EXAMPLES = [
    { name: "Plant Pal", pitch: "Reminds you to water your plants, and tells you how much", audience: "people who keep forgetting their houseplants" },
    { name: "Swap Shelf", pitch: "Swap books you've finished for ones you haven't read", audience: "readers who'd rather trade than buy new" },
    { name: "Pocket Coach", pitch: "Ten-minute workouts you can do in a small room", audience: "busy people with no time for the gym" },
    { name: "Lunch Lab", pitch: "Healthy packed lunches planned in two minutes a week", audience: "families who run out of lunch ideas" },
    { name: "Pet Sitter Hub", pitch: "Find a trusted neighbour to feed your pet while you're away", audience: "pet owners going away for a few days" },
    { name: "Quiet Hours", pitch: "Shows which cafés and libraries near you are quiet right now", audience: "students and remote workers who need to focus" },
    { name: "Fix It Friday", pitch: "Short videos that show how to fix everyday things at home", audience: "people who'd rather fix than replace" },
    { name: "Club Kit", pitch: "Sign-ups, reminders and a shared calendar for small clubs", audience: "people who run a local club or team" },
  ];

  function example(n) {
    const i = Number.isInteger(n) ? ((n % EXAMPLES.length) + EXAMPLES.length) % EXAMPLES.length
      : Math.floor(Math.random() * EXAMPLES.length);
    return { ...EXAMPLES[i], index: i };
  }

  // ---------------------------------------------------------------- today's spark
  // A new idea prompt every day, the same for everyone on the same day. A
  // visitor's answers are kept only in their own browser, under DAILY_KEY,
  // like their projects. A streak counts the days in a row they answered.
  // Every streak starts with one freeze, which covers a single missed day so
  // one day off never resets it; once used, it comes back after FREEZE_EARN
  // more answered days. Nothing here ever nags: missing two days in a row
  // only means a new streak starts.

  const DAILY_KEY = "mtrx-genesis-daily";
  const DAILY_LIMIT = 140; // the same as a pitch, so an answer can become one
  const DAILY_KEEP = 400; // days of answers kept, newest first
  const FREEZE_EARN = 7;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;

  const PROMPTS = [
    "What takes too long every morning? How could an app make it quicker?",
    "Think of something you lose all the time. What would help you find it?",
    "What's a chore nobody likes? Invent a way to make it fun.",
    "Pick a hobby you love. What tool is missing for people who do it?",
    "What do people near you always complain about? Fix it in one line.",
    "Design something that helps a grandparent stay in touch.",
    "What could make a rainy day less boring?",
    "Invent a way to waste less food at home.",
    "What would help someone feel welcome on their first day somewhere new?",
    "Think of a small shop near you. What would bring them more customers?",
    "What's something you learned the hard way? Make it easier for the next person.",
    "Invent a game that gets people outside.",
    "What would make saving money feel like a win?",
    "Pets: what problem do their owners have that nobody has solved?",
    "What could help people sleep better?",
    "Think of a sport or team. What would make practice better?",
    "Invent something that helps people share instead of buying new.",
    "What's annoying about planning a trip? Make it simple.",
    "What would help someone learn a new language a little every day?",
    "Design a way for neighbours to help each other.",
    "What could make cooking dinner faster on a busy night?",
    "Invent something that makes a long journey more fun.",
    "What would help people drink more water?",
    "Think of a job someone you know does. What tool would save them an hour?",
    "What could make tidying up take five minutes, not fifty?",
    "Invent a way to keep track of things you've lent to friends.",
    "What would help a small club or group stay organised?",
    "What's one thing that's hard to do on a phone? Make it easy.",
    "Invent something that helps people be kinder online.",
    "What would make recycling easier to get right?",
    "Design something for people who love music but can't play an instrument.",
    "What could help someone remember birthdays?",
    "Invent a way to make homework or study less stressful.",
    "What do new parents need help with most?",
    "Think of the weather. What could you build that it makes useful?",
    "What would help people find a quiet place to think?",
    "Invent something that makes a garden or balcony easier to look after.",
    "What would make a queue less annoying?",
    "Design a way to help local artists sell their work.",
    "What could help people keep a habit going?",
    "Invent a better way to split chores fairly.",
    "What would make a museum or library visit more exciting?",
    "Think of something you'd pay a little for every month. Why?",
    "Invent a way to help people fix things instead of throwing them away.",
    "What's a problem only you seem to notice? Write the fix.",
  ];
  // One example answer for each prompt, in the same order (1.27.0): Pilot's
  // "Help with today's spark" shows today's, so a stuck visitor sees what a
  // one-line answer to that very spark can look like.
  const SPARK_EXAMPLES = [
    "An app that lays out tomorrow's clothes and bag list the night before.",
    "A tiny tag for my keys that beeps when I clap twice.",
    "A washing-up race where every clean plate scores a point for your team.",
    "An app for skateboarders that maps smooth, safe places to skate nearby.",
    "A map where neighbours flag broken streetlights and see when they're fixed.",
    "A photo frame that shows the grandchildren's newest pictures each morning.",
    "A box of indoor missions you open one at a time when it rains.",
    "An app that suggests a dinner from what's about to go off in the fridge.",
    "A buddy card that pairs each new person with someone who shows them around.",
    "One stamp card on your phone for all the shops on one street.",
    "A one-page guide for first-time bike riders, written by people who've done it.",
    "A treasure hunt app with clues hidden in real parks.",
    "A savings jar app that levels you up every time you skip a buy.",
    "An app that reminds owners when each pet's next vet check is due.",
    "A bedtime timer that dims the lights and plays rain sounds.",
    "A drills app where the coach sets 10-minute games the team ticks off.",
    "A street library for tools: borrow a drill instead of buying one.",
    "One page where friends vote on dates and see who has paid for what.",
    "A five-words-a-day language game you play while the kettle boils.",
    "A noticeboard app where neighbours offer and ask for small favours.",
    "A list of 15-minute dinners made from five things most kitchens have.",
    "A road-trip bingo app for things you spot out of the window.",
    "A bottle that glows when it's time for another sip.",
    "An app that writes a plumber's invoice from a photo of the job.",
    "A tidy-up timer that turns each room into a 5-minute race.",
    "An app that lists what you've lent, to whom, and reminds you after a month.",
    "One shared page for a club's dates, kit list and who's bringing snacks.",
    "A big-button helper that makes long sign-up forms easy on a phone.",
    "A button that suggests a kinder way to say a comment before you post it.",
    "An app that tells you which bin something goes in from a photo.",
    "An app that turns your humming into a beat you can share.",
    "A calendar that reminds you a week before each friend's birthday, with a gift idea.",
    "A homework planner that splits big projects into 20-minute steps.",
    "A night-feed log both parents can tick from their phones.",
    "A rain alert that tells gardeners when to skip watering.",
    "A map of quiet places to study nearby, rated by the people who use them.",
    "A plant tag that sends a text when your plants need water.",
    "A text that tells you when it's your turn, so you can wait anywhere.",
    "An app that lets local artists show and sell their work in nearby cafés.",
    "A habit tracker where friends cheer each day you keep it up.",
    "A chore wheel app that spins fairly and keeps score.",
    "A museum scavenger hunt where each find unlocks a story.",
    "A monthly box with a new craft kit, because I'd pay for a fresh project each month.",
    "A map of repair cafés that shows where to get things fixed for free.",
    "A sign that tells drivers when the school crossing is busy.",
  ];
  // Steps through every prompt before any comes round again, never two
  // neighbours on neighbouring days (17 shares no factor with 45 prompts).
  const PROMPT_STEP = 17;

  const pad = (n) => String(n).padStart(2, "0");

  // A day as "YYYY-MM-DD" in the visitor's own time zone.
  function dayKey(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Whole days since 1 Jan 1970 for a "YYYY-MM-DD" key, or NaN.
  function dayNumber(key) {
    if (typeof key !== "string" || !DAY.test(key)) return NaN;
    const [y, m, d] = key.split("-").map(Number);
    const t = Date.UTC(y, m - 1, d);
    const back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return NaN;
    return Math.round(t / 86400000);
  }

  function keyOfNumber(n) {
    const d = new Date(n * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  function promptFor(key) {
    const n = dayNumber(key);
    const i = Number.isFinite(n) ? (((n * PROMPT_STEP) % PROMPTS.length) + PROMPTS.length) % PROMPTS.length : 0;
    return { index: i, text: PROMPTS[i], example: SPARK_EXAMPLES[i] || "" };
  }

  // Answers from anywhere (storage), made safe: real days, one line each,
  // the newest DAILY_KEEP only.
  function cleanDays(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    const keys = Object.keys(raw).filter((k) => Number.isFinite(dayNumber(k))).sort().reverse().slice(0, DAILY_KEEP);
    for (const k of keys) {
      const text = line(raw[k]).slice(0, DAILY_LIMIT);
      if (text) out[k] = text;
    }
    return out;
  }

  // The streak on `today` from the days answered. Walks forward from the
  // first answer: an answered day adds one; a missed day uses the freeze if
  // it is there (the streak carries on), and otherwise starts it again. Today
  // not answered yet changes nothing: there's still time.
  function streak(days, today) {
    const t = dayNumber(today);
    const answered = new Set(Object.keys(days || {}).map(dayNumber).filter((n) => Number.isFinite(n) && n <= t));
    // `covered` is every day a freeze ever covered; `frozen` only those of
    // the streak running now. `covered` is never cleared, so a day once shown
    // as covered by a freeze stays that way in the row of days after a
    // streak ends.
    const covered = [];
    const out = { streak: 0, best: 0, freezes: 1, frozen: [], covered, today: answered.has(t), total: answered.size, toEarn: 0 };
    if (!answered.size || !Number.isFinite(t)) return out;
    let since = 0;
    for (let d = Math.max(Math.min(...answered), t - DAILY_KEEP); d <= t; d += 1) {
      if (answered.has(d)) {
        out.streak += 1;
        out.best = Math.max(out.best, out.streak);
        if (out.freezes === 0 && ++since >= FREEZE_EARN) { out.freezes = 1; since = 0; }
      } else if (d === t) {
        // Today isn't over.
      } else if (out.streak > 0 && out.freezes > 0) {
        out.freezes = 0;
        since = 0;
        out.frozen.push(keyOfNumber(d));
        covered.push(keyOfNumber(d));
      } else if (out.streak > 0) {
        // A fresh start, with its own freeze.
        out.streak = 0;
        out.frozen = [];
        out.freezes = 1;
        since = 0;
      }
    }
    out.toEarn = out.freezes ? 0 : FREEZE_EARN - since;
    return out;
  }

  // The last `n` days, oldest first, each "done", "frozen", "missed" or
  // "today" (today, not answered yet), for the little row of dots.
  function lastDays(days, today, n = 7) {
    const t = dayNumber(today);
    const s = streak(days, today);
    const out = [];
    for (let d = t - n + 1; d <= t; d += 1) {
      const key = keyOfNumber(d);
      const state = days && days[key] ? "done" : s.covered.includes(key) ? "frozen" : d === t ? "today" : "missed";
      out.push({ key, state });
    }
    return out;
  }

  // Wraps localStorage for the answers, like open() does for projects.
  function openDaily(storage) {
    let usable = false;
    try {
      if (storage) {
        storage.setItem(DAILY_KEY + ":test", "1");
        storage.removeItem(DAILY_KEY + ":test");
        usable = true;
      }
    } catch (_) { usable = false; }
    let memory = {};

    function load() {
      if (!usable) return { ...memory };
      try {
        const raw = storage.getItem(DAILY_KEY);
        if (!raw) return {};
        const data = JSON.parse(raw);
        return cleanDays(data && data.days);
      } catch (_) {
        return { ...memory };
      }
    }

    function save(days) {
      memory = cleanDays(days);
      if (!usable) return false;
      try {
        storage.setItem(DAILY_KEY, JSON.stringify({ format: FORMAT, days: memory }));
        return true;
      } catch (_) {
        return false;
      }
    }

    function clear() {
      memory = {};
      if (!usable) return true;
      try { storage.removeItem(DAILY_KEY); return true; } catch (_) { return false; }
    }

    return { get usable() { return usable; }, load, save, clear };
  }

  // ---------------------------------------------------------------- what Genesis remembers besides projects
  // Two small things kept in this browser only, like everything else here:
  //   links: which project today's (or an earlier day's) spark became,
  //     {day: project id}, so the spark can say "Open <project>";
  //   answers: the last Ask Genesis answer per project, {id: {label, text,
  //     at}}, so it is still there after a reload.
  // Nothing here is ever sent anywhere.

  const EXTRAS_KEY = "mtrx-genesis-extras";
  const ANSWER_LIMIT = 6000;
  const ANSWER_LABEL_LIMIT = 300;
  const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

  function cleanExtras(raw) {
    const out = { links: {}, answers: {} };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    const links = raw.links && typeof raw.links === "object" && !Array.isArray(raw.links) ? raw.links : {};
    for (const day of Object.keys(links).filter((k) => Number.isFinite(dayNumber(k))).sort().reverse().slice(0, DAILY_KEEP)) {
      if (typeof links[day] === "string" && ID_RE.test(links[day])) out.links[day] = links[day];
    }
    const answers = raw.answers && typeof raw.answers === "object" && !Array.isArray(raw.answers) ? raw.answers : {};
    const kept = Object.keys(answers).filter((id) => ID_RE.test(id) && answers[id] && typeof answers[id] === "object")
      .sort((a, b) => (Number(answers[b].at) || 0) - (Number(answers[a].at) || 0)).slice(0, LIMITS.projects);
    for (const id of kept) {
      const a = answers[id];
      const label = line(a.label).slice(0, ANSWER_LABEL_LIMIT);
      const text = block(a.text).slice(0, ANSWER_LIMIT);
      if (!label || !text) continue;
      out.answers[id] = { label, text, at: Number.isFinite(a.at) && a.at > 0 ? Math.floor(a.at) : 0,
        ...(a.refused === true ? { refused: true } : {}), ...(a.saved === true ? { saved: true } : {}) };
    }
    return out;
  }

  function openExtras(storage) {
    let usable = false;
    try {
      if (storage) {
        storage.setItem(EXTRAS_KEY + ":test", "1");
        storage.removeItem(EXTRAS_KEY + ":test");
        usable = true;
      }
    } catch (_) { usable = false; }
    let memory = cleanExtras(null);

    function load() {
      if (!usable) return cleanExtras(memory);
      try {
        const raw = storage.getItem(EXTRAS_KEY);
        return raw ? cleanExtras(JSON.parse(raw)) : cleanExtras(null);
      } catch (_) {
        return cleanExtras(memory);
      }
    }

    function save(extras) {
      memory = cleanExtras(extras);
      if (!usable) return false;
      try {
        storage.setItem(EXTRAS_KEY, JSON.stringify({ format: FORMAT, ...memory }));
        return true;
      } catch (_) {
        return false;
      }
    }

    // Change it in one step: change(extras) edits a fresh copy.
    function edit(change) {
      const x = load();
      change(x);
      return save(x);
    }

    // Forget a project's answer and any spark that pointed at it (or, with
    // no id, everything).
    function forget(id) {
      if (!id) { memory = cleanExtras(null); if (usable) { try { storage.removeItem(EXTRAS_KEY); } catch (_) { return false; } } return true; }
      return edit((x) => {
        delete x.answers[id];
        for (const day of Object.keys(x.links)) if (x.links[day] === id) delete x.links[day];
      });
    }

    return { get usable() { return usable; }, load, save, edit, forget };
  }

  // ---------------------------------------------------------------- sharing a card
  // A project as a few lines of words to paste anywhere. Only what the card
  // shows: never the notes, the ticks or anything about the visitor.

  // `where`: Genesis's own address once it has one (genesis.mtrxhorizyn.com).
  function shareText(project, base, where) {
    const p = clean(project);
    if (!p) return "";
    const pr = progress(p);
    const stage = pr.launched ? "Launched" : (STAGES.find((s) => s.key === p.stage) || STAGES[0]).name;
    return [`${p.name}: ${p.pitch}`, `For ${p.audience}`, `${stage} · ${pr.percent}% of the way to launch`,
      `Made with Genesis · ${madeAt(base, where)}`].join("\n");
  }

  // Where Genesis is, as words for the idea card: its own address, or the
  // site's address and /genesis.
  function madeAt(base, where) {
    if (typeof where === "string" && /^[a-z0-9.-]{1,253}(:\d{1,5})?$/.test(where)) return where;
    const home = typeof base === "string" && /^https?:\/\/[^\s/]+$/.test(base) ? base.replace(/^https?:\/\//, "") : "mtrxhorizyn.com";
    return `${home}/genesis`;
  }

  // A file name for the card picture: "nova-notes-card.png".
  function cardFileName(project) {
    const base = suggestAddress(project && project.name).replace(/\.com$/, "") || "genesis";
    return `${base}-card.png`;
  }

  // The first step not ticked yet, the stage it belongs to first, or null
  // when every step of the project is done.
  function nextStep(project) {
    const ticks = (project && project.ticks) || {};
    const here = (project && project.stage) || "spark";
    const open = steps(project).filter((i) => !ticks[i.key]);
    return open.find((i) => i.stage === here) || open[0] || null;
  }

  // The line under Ask Genesis about the free answers, true to the server's
  // limits (horizon/genesis_ai.py): before anything is known, the two
  // limits; once the server has said, how many are left today, and while a
  // limit is reached, how long until more. `info` is what the server sent
  // (free_left, free_day, free_hour, hour_used, wait), or null.
  // How long until the free answers come back, in plain words, from the
  // moment the server's wait runs out (info.wait_until, in ms): "12 min",
  // "about 3 hours". Without that moment, the server's own words.
  function waitWords(info, now) {
    const until = Number(info && info.wait_until);
    if (!until) return (info && info.wait) || "";
    const minutes = Math.max(1, Math.ceil((until - (now || Date.now())) / 60000));
    if (minutes < 90) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    return `about ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  // Is the free help used up for now (the hour's or the day's)? While it
  // is, the page greys out the quick questions and Ask, and switches them
  // back on by itself once the wait is over.
  function freeBlocked(info, perDay, perHour, now) {
    if (!info || !Number.isFinite(Number(info.free_left))) return false;
    const hour = Number(info.free_hour) || perHour;
    const used = Number(info.free_left) <= 0 || (Boolean(info.wait) && Number(info.hour_used) >= hour);
    if (!used) return false;
    const until = Number(info.wait_until);
    return !until || until > (now || Date.now());
  }

  function freeLine(info, perDay, perHour, now) {
    const day = Number(info && info.free_day) || perDay;
    const hour = Number(info && info.free_hour) || perHour;
    const limits = `Free: ${day} answer${day === 1 ? "" : "s"} a day, up to ${hour} an hour.`;
    if (!info || !Number.isFinite(Number(info.free_left))) return limits;
    const left = Math.max(0, Number(info.free_left));
    const until = Number(info.wait_until);
    const over = until && until <= (now || Date.now());
    if (left === 0 && !over) return `You've used all ${day} free answers for today. Back in ${waitWords(info, now)}.`;
    const today = `${left} of ${day} left today`;
    if (info.wait && Number(info.hour_used) >= hour && !over) {
      return `You've used ${hour} this hour. Back in ${waitWords(info, now)}. ${today}.`;
    }
    return `${today} (up to ${hour} an hour).`;
  }

  // ---------------------------------------------------------------- moving to genesis.* (1.26.0)
  // Genesis moved to its own address (genesis.mtrxhorizyn.com), and a
  // browser keeps each address's saved data apart. So, once, the old
  // address's page (/genesis-move, static/js/genesis-move.js) packs what
  // Genesis saved there into the new address's #part, which a browser never
  // sends to any server, and the new page unpacks it here. Too big for an
  // address: a file to download and import instead.

  const MOVE_KEYS = [KEY, DAILY_KEY, EXTRAS_KEY, PRO_KEY];
  // Characters in the packed #part: well inside what every browser takes.
  const MOVE_MOST = 60000;

  function toBase64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(text) {
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
    try {
      const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_) {
      return null;
    }
  }

  // Everything Genesis saved in `storage`, packed for an address's #part,
  // or "" when there is nothing.
  function packMove(storage) {
    const out = {};
    for (const key of MOVE_KEYS) {
      let raw = null;
      try { raw = storage ? storage.getItem(key) : null; } catch (_) { raw = null; }
      if (typeof raw === "string" && raw) out[key] = raw;
    }
    return Object.keys(out).length ? toBase64Url(JSON.stringify({ v: 1, data: out })) : "";
  }

  // The packed data back as { key: saved text }, only Genesis's own keys, or null.
  function unpackMove(packed) {
    if (typeof packed !== "string" || packed.length > MOVE_MOST * 2) return null;
    const text = fromBase64Url(packed);
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { return null; }
    if (!parsed || parsed.v !== 1 || !parsed.data || typeof parsed.data !== "object") return null;
    const out = {};
    for (const key of MOVE_KEYS) if (typeof parsed.data[key] === "string") out[key] = parsed.data[key];
    return out;
  }

  // Put moved data into this address's storage, without losing anything
  // already here: projects are merged as an import is, today's sparks fill
  // in days not answered here, and the extras and a Pro key only arrive
  // where there are none. Everything is checked as a downloaded file is.
  // Returns how many projects and sparks arrived.
  function applyMove(storage, data) {
    const result = { projects: 0, sparks: 0 };
    if (!data) return result;
    const json = (raw) => { try { return JSON.parse(raw); } catch (_) { return null; } };
    if (data[KEY]) {
      const store = open(storage);
      const moved = importText(data[KEY], store.load());
      if (!moved.error) {
        const before = store.load().length;
        store.save(moved.projects);
        result.projects = Math.max(0, moved.projects.length - before) + (moved.replaced || 0);
      }
    }
    if (data[DAILY_KEY]) {
      const daily = openDaily(storage);
      const mine = daily.load();
      const theirs = cleanDays((json(data[DAILY_KEY]) || {}).days);
      for (const [day, answer] of Object.entries(theirs)) {
        if (!(day in mine)) { mine[day] = answer; result.sparks += 1; }
      }
      if (result.sparks) daily.save(mine);
    }
    if (data[EXTRAS_KEY]) {
      const extras = openExtras(storage);
      const here = extras.load();
      if (!Object.keys(here.links).length && !Object.keys(here.answers).length) extras.save(cleanExtras(json(data[EXTRAS_KEY])));
    }
    if (data[PRO_KEY] && !readProKey(storage)) keepProKey(storage, data[PRO_KEY]);
    return result;
  }

  const api = {
    freeLine, freeBlocked, waitWords,
    KEY, LIMITS, STAGES, CHECKLIST, line, block, addressProblem, suggestAddress, nameWarning,
    check, create, progress, clean, cleanList, exportText, importText, open,
    steps, hiddenSteps, addStep, hideStep, showStep,
    HANDOFF_KEY, offerToVortex, takeVortexOffer,
    PRO_KEY, proKey, readProKey, keepProKey, forgetProKey, planText, planFileName,
    EXAMPLES, example, nextStep,
    DAILY_KEY, DAILY_LIMIT, FREEZE_EARN, PROMPTS, SPARK_EXAMPLES, dayKey, dayNumber, promptFor, cleanDays, streak, lastDays, openDaily,
    shareText, madeAt, cardFileName,
    EXTRAS_KEY, ANSWER_LIMIT, cleanExtras, openExtras,
    MOVE_KEYS, MOVE_MOST, packMove, unpackMove, applyMove,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GenesisStore = api;
})(typeof window !== "undefined" ? window : globalThis);
