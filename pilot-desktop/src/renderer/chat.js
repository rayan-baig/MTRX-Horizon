// Pilot's chat window. Shows what the main process sends (messages, cards,
// settings) and passes the user's clicks back through window.pilot.
//
// Every word is placed with textContent, or built by render.js from text
// nodes: nothing here ever sets HTML. No style attributes either.
"use strict";

(function () {
  const P = window.pilot;
  const R = window.PilotRender;
  const $ = (id) => document.getElementById(id);

  const ui = {
    scroll: $("scroll"), chips: $("chips"), messages: $("messages"), input: $("input"), composer: $("composer"),
    send: $("send"), eye: $("eye"), eyeMenu: $("eye-menu"), looking: $("looking"), attach: $("attach"),
    attachX: $("attach-x"), helpState: $("help-state"), palette: $("palette"), paletteMenu: $("palette-menu"),
    chatView: $("view-chat"), settingsView: $("view-settings"), helpView: $("view-help"),
    tray: $("tray"), dropzone: $("dropzone"), clip: $("clip"), file: $("file"),
  };
  const A = window.PilotAttach;
  const L = window.PilotLinks;
  const SP = window.PilotSpeech;
  ui.linkbar = $("linkbar");
  ui.speak = $("speak");
  let working = []; // files still being prepared in this window
  let trayError = "";

  let state = { messages: [], busy: false, streaming: "", cards: [], looking: false, ready: false, helpScreen: false, screenHelp: false };
  let settings = null;
  let view = "chat";
  let lookNext = false;
  const mediaCache = new Map();

  // ---------------------------------------------------------------- helpers

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
    }
    return node;
  }

  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
  const atBottom = () => ui.scroll.scrollHeight - ui.scroll.scrollTop - ui.scroll.clientHeight < 40;
  // Answers are drawn by the shared core's safe renderer (text nodes only).
  // Bare web addresses become links too (https, http and mailto only).
  const rich = (text) => L.linkify(R.render(text, document), document);

  function closeMenus() {
    ui.eyeMenu.hidden = true; ui.eye.setAttribute("aria-expanded", "false");
    ui.paletteMenu.hidden = true; ui.palette.setAttribute("aria-expanded", "false");
  }

  // ---------------------------------------------------------------- views

  function show(next) {
    view = next;
    ui.chatView.hidden = next !== "chat";
    ui.settingsView.hidden = next !== "settings";
    ui.helpView.hidden = next !== "help";
    $("gear").setAttribute("aria-pressed", String(next === "settings"));
    $("helpbtn").setAttribute("aria-pressed", String(next === "help"));
    closeMenus();
    if (next === "settings") renderSettings();
    if (next === "help") renderHelp();
    if (next === "chat") setTimeout(() => ui.input.focus(), 0);
  }

  // ---------------------------------------------------------------- the chat

  function mediaBlock(m) {
    const box = el("div", { class: "media" });
    if (m.state === "working") {
      const pct = m.progress === null || m.progress === undefined ? null : Math.round(m.progress / 10) * 10;
      box.appendChild(el("div", { class: `progress${pct === null ? " unknown" : ""}` }, el("span", { class: pct === null ? "" : `p${pct}` })));
      box.appendChild(el("div", { class: "meta", text: m.kind === "video"
        ? `Making your video${pct === null ? "…" : ` (${m.progress}%)`}. This can take a few minutes.` : "Making your picture…" }));
      return box;
    }
    if (m.state === "failed") { box.appendChild(el("div", { class: "meta", text: m.message || "That didn't work." })); return box; }
    const holder = el("div");
    box.appendChild(holder);
    const put = (data) => {
      if (!data) return;
      if (m.kind === "image") holder.appendChild(el("img", { src: `data:${data.mime};base64,${data.data}`, alt: "The picture Pilot made", "data-media": m.id }));
      else {
        const bytes = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: data.mime }));
        holder.appendChild(el("video", { src: url, controls: true, playsinline: true }));
      }
    };
    if (mediaCache.has(m.id)) put(mediaCache.get(m.id));
    else P.chat.mediaGet(m.id).then((data) => { if (data && !data.error) { mediaCache.set(m.id, data); put(data); } });
    box.appendChild(el("div", { class: "msg-tools" }, el("button", { class: "mini", type: "button", text: "Save",
      onclick: () => P.chat.mediaSave(m.id) })));
    return box;
  }

  function messageNode(m) {
    if (m.role === "user") {
      const node = L.linkify(el("div", { class: "msg msg-user" }, m.text), document);
      if (m.shots && m.shots.length) node.appendChild(el("div", { class: "shots" }, m.shots.map((s) => el("img", { src: s, alt: "The screenshot Pilot was sent" }))));
      return node;
    }
    if (m.role === "assistant") {
      const node = el("div", { class: "msg msg-pilot bubble" });
      node.appendChild(rich(m.text));
      node.appendChild(el("div", { class: "msg-tools" }, el("button", { class: "mini", type: "button", text: "Copy",
        onclick: (ev) => { P.chat.copy(m.text).then(() => { ev.target.textContent = "Copied"; }); } })));
      return node;
    }
    if (m.role === "action") {
      const node = el("div", { class: "msg msg-action" }, m.text);
      if (m.shots && m.shots.length) node.appendChild(el("div", { class: "shots" }, m.shots.map((s) => el("img", { src: s, alt: "" }))));
      return node;
    }
    if (m.media) {
      const node = el("div", { class: "msg msg-pilot bubble" }, el("div", { class: "meta", text: `${m.media.kind === "video" ? "Video" : "Picture"}: ${m.text}` }));
      node.appendChild(mediaBlock(m.media));
      return node;
    }
    if (m.kind === "noimages") {
      return el("div", { class: "msg msg-note error" }, m.text,
        el("div", { class: "card-buttons" }, el("button", { class: "btn small", type: "button", text: "Switch key or model", onclick: () => show("settings") })));
    }
    return el("div", { class: `msg msg-note${m.kind === "error" ? " error" : ""}` }, m.text);
  }

  function cardNode(c) {
    if (c.type === "plan") {
      return el("div", { class: "card", role: "alertdialog", "aria-label": "Pilot's plan" },
        el("h3", { text: `Pilot's plan: ${c.labels.length} step${c.labels.length === 1 ? "" : "s"}` }),
        el("ol", {}, c.labels.map((l) => el("li", { text: l }))),
        el("div", { class: "card-buttons" },
          el("button", { class: "btn primary", type: "button", text: "Approve all", onclick: () => P.chat.answer(c.id, "all") }),
          el("button", { class: "btn", type: "button", text: "Step through", onclick: () => P.chat.answer(c.id, "step") }),
          el("button", { class: "btn", type: "button", text: "Cancel", onclick: () => P.chat.answer(c.id, "cancel") })));
    }
    return el("div", { class: "card", role: "alertdialog", "aria-label": "Pilot wants to do something" },
      el("h3", { text: c.step ? `Step ${c.step.step} of ${c.step.of}: Pilot wants to` : "Pilot wants to" }),
      el("p", { text: c.label }),
      el("div", { class: "card-buttons" },
        el("button", { class: "btn primary", type: "button", text: "Allow", onclick: () => P.chat.answer(c.id, true) }),
        el("button", { class: "btn", type: "button", text: c.step ? "Skip" : "Cancel", onclick: () => P.chat.answer(c.id, false) })));
  }

  function screenHelpNode() {
    return el("div", { class: "card", role: "alertdialog", "aria-label": "Screen Recording permission" },
      el("h3", { text: "Let Pilot see your screen" }),
      el("p", { text: "To look at your screen, your Mac needs your OK first. Pilot only takes a picture of the screen when you ask, and sends it only to your own AI provider." }),
      el("ol", {},
        el("li", { text: "Press “Open Settings”." }),
        el("li", { text: "In Screen Recording (or “Screen & System Audio Recording”), turn on Pilot." }),
        el("li", { text: "If your Mac asks, choose “Quit & Reopen”. Then try again." })),
      el("div", { class: "card-buttons" },
        el("button", { class: "btn primary", type: "button", text: "Open Settings", onclick: () => P.screen.openSettings() }),
        el("button", { class: "btn", type: "button", text: "Not now", onclick: () => P.screen.closeHelp() })));
  }

  // The first time: three short steps, then the usual pill buttons.
  function welcomeNode() {
    const done = Boolean(settings && settings.ready);
    return el("div", { class: "card welcome", role: "region", "aria-label": "Welcome to Pilot" },
      el("h3", { text: "Welcome! Three quick steps" }),
      el("ol", { class: "steps" },
        el("li", { class: done ? "done" : "" }, el("strong", { text: "Add your AI key. " }),
          done ? "Done!" : "Your own OpenAI, Claude, Gemini or compatible key.",
          done ? null : el("button", { class: "btn primary small", type: "button", text: "Add my key", onclick: () => show("settings") })),
        el("li", { class: settings && settings.screen && settings.screen.allowed ? "done" : "" }, el("strong", { text: "Screen access, if you like. " }),
          settings && settings.screen && settings.screen.allowed ? "Allowed. Pilot looks only when you ask."
            : "Let Pilot see your screen when you ask. In System Settings, turn on Pilot under Screen Recording.",
          settings && settings.screen && settings.screen.allowed ? null
            : el("button", { class: "btn small", type: "button", text: "Turn on screen access", onclick: () => { P.screen.setMode("ask"); P.screen.openSettings(); } }),
          settings && settings.screen && settings.screen.offerRelaunch
            ? el("button", { class: "btn small", type: "button", text: "Relaunch Pilot", onclick: () => P.app.relaunch() }) : null),
        el("li", {}, el("strong", { text: "That's it! " }), "Say hi, or pick an idea.",
          el("button", { class: done ? "btn primary small" : "btn small", type: "button", text: "Start chatting", "data-start": "1",
            onclick: () => P.settings.welcomeDone() }))));
  }

  // What goes with the next message: a thumbnail, the name and size, a
  // progress bar while it's prepared or uploaded, and a remove button.
  function trayItem(a, local) {
    const pct = a.progress === undefined || a.progress === null ? null : Math.round(a.progress * 100);
    const what = a.error ? a.error
      : local ? (a.kind === "video" ? `Taking frames… ${pct || 0}%` : "Shrinking to fit…")
        : a.kind === "video" ? (pct !== null && pct < 100 ? `Uploading… ${pct}%` : "Video, ready to send")
          : a.kind === "frames" ? `${a.count} frames from the video` : "Picture, ready to send";
    return el("div", { class: `tray-item${a.error ? " bad" : ""}` },
      a.thumb ? el("img", { src: a.thumb, alt: "" }) : el("span", { class: "ph" }),
      el("span", { class: "words" }, el("b", { text: a.name }), el("small", { text: `${A.sizeWords(a.size || 0)} · ${what}` }),
        (local || (pct !== null && pct < 100)) && !a.error ? el("progress", { class: "bar", max: "100", value: String(pct || 0) }) : null),
      local ? null : el("button", { class: "x", type: "button", "aria-label": `Remove ${a.name}`, text: "×", onclick: () => P.attach.remove(a.id) }));
  }

  function renderTray() {
    const items = [...(state.attachments || []).map((a) => trayItem(a, false)), ...working.map((a) => trayItem(a, true))];
    if (trayError) items.push(el("div", { class: "tray-item bad" }, el("span", { class: "words" }, el("small", { text: trayError })),
      el("button", { class: "x", type: "button", "aria-label": "Dismiss", text: "×", onclick: () => { trayError = ""; renderChat(); } })));
    clear(ui.tray);
    for (const n of items) ui.tray.appendChild(n);
    ui.tray.hidden = items.length === 0;
  }

  async function takeFiles(files) {
    if (!files || !files.length) return;
    show("chat");
    trayError = "";
    await A.takeFiles(files, P.attach, {
      update: (list) => { working = list; renderChat(); },
      error: (words) => { trayError = words; renderChat(); },
    });
  }

  function renderChat() {
    const stick = atBottom();
    clear(ui.messages);
    const list = state.messages || [];
    const welcome = Boolean(settings && !settings.welcomed && !list.length);
    ui.chips.hidden = list.length > 0 || welcome;
    if (welcome) ui.messages.appendChild(welcomeNode());
    for (const m of list) ui.messages.appendChild(messageNode(m));
    if (state.busy && state.streaming) {
      const node = el("div", { class: "msg msg-pilot bubble" });
      node.appendChild(rich(state.streaming));
      ui.messages.appendChild(node);
    } else if (state.busy && !(state.cards || []).length) {
      ui.messages.appendChild(el("div", { class: "msg msg-pilot bubble typing", "aria-label": "Pilot is thinking" }, el("i"), el("i"), el("i")));
    }
    for (const c of state.cards || []) ui.messages.appendChild(cardNode(c));
    if (state.screenHelp) ui.messages.appendChild(screenHelpNode());
    ui.looking.hidden = !state.looking;
    renderTray();
    ui.eye.hidden = Boolean(settings && settings.screenMode === "off");
    ui.send.classList.toggle("stop", Boolean(state.busy));
    ui.send.setAttribute("aria-label", state.busy ? "Stop" : "Send");
    ui.send.title = state.busy ? "Stop" : "Send";
    ui.eye.classList.toggle("on", Boolean(state.helpScreen || lookNext));
    const helpBtn = ui.eyeMenu.querySelector('[data-eye="help"]');
    helpBtn.setAttribute("aria-checked", String(Boolean(state.helpScreen)));
    ui.helpState.textContent = state.helpScreen ? "On: a fresh screenshot goes with each message" : "Off: turn on to send a fresh screenshot with each message";
    ui.attach.hidden = !(lookNext || state.helpScreen);
    $("attach-words").textContent = state.helpScreen ? "Helping with what's on screen: each message sends a fresh screenshot." : "A screenshot will be sent with your next message.";
    if (welcome) ui.scroll.scrollTop = 0;
    else if (stick || (state.cards || []).length) ui.scroll.scrollTop = ui.scroll.scrollHeight;
  }

  async function send(text, opts) {
    const words = String(text || "").trim();
    if (!words) return;
    const o = { ...(opts || {}) };
    if (lookNext) o.look = true;
    speaker.stop();
    // "Read this link": each link left on is read first (a page goes along as
    // text, a picture is attached like a pasted one).
    const toRead = L.webLinks(words).filter((u) => linkOn.get(u)).slice(0, 3);
    if (toRead.length) {
      reading = "Reading link…";
      renderLinks();
      const pages = [];
      for (const url of toRead) {
        const got = await P.chat.readLink(url);
        if (got && got.kind === "page") pages.push({ url: got.url, title: got.title, text: got.text });
        else if (got && got.kind === "image") await takeFiles([fileFrom(got.data, got.mime, "Picture from a link")]);
        else { trayError = `Pilot couldn't read ${url}: ${(got && got.error) || "it didn't answer."}`; }
      }
      reading = "";
      if (pages.length) o.pages = pages;
    }
    linkOn.clear();
    ui.input.value = "";
    sizeInput();
    renderLinks();
    const res = await P.chat.send(words, o);
    if (res && res.needPermission) { ui.input.value = words; return; }
    if (res && res.waiting) { ui.input.value = words; trayError = "Wait a moment: a video is still uploading."; renderChat(); return; }
    if (o.look) { lookNext = false; renderChat(); }
  }

  function sizeInput() {
    const lines = ui.input.value.split("\n").length + Math.floor(ui.input.value.length / 46);
    ui.input.rows = Math.max(1, Math.min(5, lines));
  }

  // Links in answers open in the user's browser (https only, checked by the
  // app), never inside Pilot's window.
  ui.messages.addEventListener("click", (ev) => {
    const a = ev.target.closest("a[href]");
    if (!a) return;
    ev.preventDefault();
    P.chat.openLink(a.getAttribute("href"));
  });

  ui.composer.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (state.busy) { P.chat.stop(); return; }
    send(ui.input.value);
  });
  ui.input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); ui.composer.requestSubmit(); }
  });
  ui.input.addEventListener("input", sizeInput);

  const CHIPS = {
    ask: { placeholder: "Ask anything…", text: "" },
    do: { placeholder: "What should we get done?", text: "Help me get this done: " },
    code: { placeholder: "Paste your code or describe the problem…", text: "Help me with this code:\n" },
    explain: { placeholder: "What should Pilot analyze or explain?", text: "Analyze and explain: " },
  };
  ui.chips.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-chip]");
    if (!btn) return;
    const kind = btn.dataset.chip;
    if (kind === "key") { show("settings"); return; }
    const c = CHIPS[kind];
    ui.input.placeholder = c.placeholder;
    ui.input.value = c.text;
    sizeInput();
    ui.input.focus();
    ui.input.setSelectionRange(ui.input.value.length, ui.input.value.length);
  });

  ui.eye.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const open = ui.eyeMenu.hidden;
    closeMenus();
    ui.eyeMenu.hidden = !open;
    ui.eye.setAttribute("aria-expanded", String(open));
  });
  ui.eyeMenu.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-eye]");
    if (!btn) return;
    const what = btn.dataset.eye;
    closeMenus();
    if (what === "look") { lookNext = true; renderChat(); ui.input.focus(); }
    else if (what === "explain") send("Explain what's on my screen.", { look: true, label: "Explain this screen" });
    else if (what === "summary") send("Summarise what I'm looking at.", { look: true, label: "Summarise what I'm looking at" });
    else if (what === "help") P.chat.helpScreen(!state.helpScreen);
  });
  ui.attachX.addEventListener("click", () => {
    if (state.helpScreen) P.chat.helpScreen(false);
    lookNext = false;
    renderChat();
  });

  // Pictures and videos: the paperclip, paste, and drag and drop.
  ui.clip.addEventListener("click", () => ui.file.click());
  ui.file.addEventListener("change", () => { const f = [...ui.file.files]; ui.file.value = ""; takeFiles(f); });
  // Pasting: files and pictures attach (a screenshot sent to the clipboard,
  // a picture copied in a browser, Preview or Messages, a file copied in
  // Finder), straight from memory; text and links paste as text. A single
  // pasted link gets "Read this link" turned on.
  const fileFrom = (b64, mime, name) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new File([bytes], name || "Pasted picture", { type: mime });
  };
  function insertText(text) {
    const i = ui.input;
    i.setRangeText(text, i.selectionStart, i.selectionEnd, "end");
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }
  async function pasteFromApp(text) {
    const got = await P.chat.paste();
    if (Array.isArray(got) && got.length) { await takeFiles(got.map((g) => fileFrom(g.data, g.mime, g.name))); return true; }
    if (got && got.error) { trayError = got.error; renderChat(); return true; }
    if (text) insertText(text);
    return false;
  }
  ui.input.addEventListener("paste", (ev) => {
    const cd = ev.clipboardData;
    const files = cd ? [...cd.files] : [];
    if (files.length) { ev.preventDefault(); takeFiles(files); return; }
    const text = cd ? cd.getData("text/plain") : "";
    const types = cd ? [...cd.types] : [];
    if (!text || types.includes("Files") || types.some((t) => t.startsWith("image/"))) { ev.preventDefault(); pasteFromApp(text); return; }
    const links = L.webLinks(text);
    if (links.length === 1 && !linkOn.has(links[0])) linkOn.set(links[0], true);
  });

  // ---------------------------------------------------------------- "Read this link"

  const linkOn = new Map(); // address → read it?
  let reading = "";
  function renderLinks() {
    const links = [...new Set(L.webLinks(ui.input.value))].slice(0, 3);
    clear(ui.linkbar);
    if (reading) ui.linkbar.appendChild(el("span", { class: "linkchip on", role: "status" }, el("span", { text: reading })));
    else {
      for (const url of links) {
        const on = Boolean(linkOn.get(url));
        let host = url;
        try { host = new URL(url).hostname; } catch (_) { /* as is */ }
        ui.linkbar.appendChild(el("label", { class: `linkchip${on ? " on" : ""}`, title: url },
          el("input", { type: "checkbox", checked: on, onchange: (ev) => { linkOn.set(url, ev.target.checked); renderLinks(); } }),
          el("span", { text: `Read this link (${host})` })));
      }
    }
    ui.linkbar.hidden = !ui.linkbar.firstChild;
  }
  ui.input.addEventListener("input", renderLinks);

  // ---------------------------------------------------------------- right-click

  ui.messages.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const a = ev.target.closest("a[href]");
    const img = ev.target.closest("img");
    const msg = ev.target.closest(".msg");
    const sel = String(window.getSelection ? window.getSelection() : "");
    let text = "";
    if (msg) {
      const idx = [...ui.messages.querySelectorAll(".msg")].indexOf(msg);
      const m = (state.messages || [])[idx];
      text = m && typeof m.text === "string" ? m.text : msg.textContent;
    }
    P.chat.context({ selection: sel, text, link: a ? a.getAttribute("href") : "", src: img ? img.getAttribute("src") : "",
      mediaId: img ? img.getAttribute("data-media") || "" : "" });
  });
  ui.input.addEventListener("contextmenu", (ev) => { ev.preventDefault(); P.chat.context({ editable: true }); });

  // ---------------------------------------------------------------- speaking replies

  const speaker = SP.create({
    synth: window.speechSynthesis, Utterance: window.SpeechSynthesisUtterance,
    say: (t, v, r) => P.voice.say(t, v, r), stopSay: () => P.voice.stop(),
    talking: (on) => { ui.speak.classList.toggle("talking", on); P.voice.talking(on); },
  });
  const voiceOn = () => Boolean(settings && settings.voice && settings.voice.speak);
  function syncVoice() {
    const v = (settings && settings.voice) || {};
    speaker.set({ on: Boolean(v.speak), voice: v.voice || "", rate: v.voiceRate || 1, ok: state.speakOk !== false });
    ui.speak.setAttribute("aria-pressed", String(Boolean(v.speak)));
    ui.speak.title = v.speak ? "Speak replies (on). Click to stop or turn off." : "Speak replies (off)";
  }
  // The speaker: stops him mid-sentence, or turns Speak replies on and off.
  ui.speak.addEventListener("click", () => {
    if (speaker.talking) { speaker.stop(); return; }
    P.voice.set({ speak: !voiceOn() });
  });
  P.voice.onStop(() => speaker.stop(true));
  let wasBusy = false;
  let lastReply = "";
  function followReply() {
    if (state.busy && !wasBusy) speaker.begin();
    if (state.busy && state.streaming) speaker.stream(state.streaming);
    if (!state.busy && wasBusy) {
      const last = (state.messages || []).filter((m) => m.role === "assistant").pop();
      if (last && last.text !== lastReply) { lastReply = last.text; speaker.finish(last.text); }
    }
    wasBusy = Boolean(state.busy);
  }
  let dragDepth = 0;
  const hasFiles = (ev) => ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");
  document.addEventListener("dragenter", (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); dragDepth += 1; ui.dropzone.hidden = false; });
  document.addEventListener("dragover", (ev) => { if (hasFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; } });
  document.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) ui.dropzone.hidden = true; });
  document.addEventListener("drop", (ev) => {
    ev.preventDefault();
    dragDepth = 0;
    ui.dropzone.hidden = true;
    if (ev.dataTransfer && ev.dataTransfer.files.length) takeFiles([...ev.dataTransfer.files]);
  });

  $("min").addEventListener("click", () => P.chat.hide());
  $("close").addEventListener("click", () => { show("chat"); P.chat.hide(); });
  $("byok").addEventListener("click", () => show(view === "settings" ? "chat" : "settings"));
  $("gear").addEventListener("click", () => show(view === "settings" ? "chat" : "settings"));
  $("helpbtn").addEventListener("click", () => show(view === "help" ? "chat" : "help"));
  ui.palette.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const open = ui.paletteMenu.hidden;
    closeMenus();
    ui.paletteMenu.hidden = !open;
    ui.palette.setAttribute("aria-expanded", String(open));
  });
  ui.paletteMenu.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-theme-pick]");
    if (!btn) return;
    P.settings.setTheme(btn.dataset.themePick);
    closeMenus();
  });
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".menu") && !ev.target.closest("#eye") && !ev.target.closest("#palette")) closeMenus();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!ui.eyeMenu.hidden || !ui.paletteMenu.hidden) { closeMenus(); return; }
    if (view !== "chat") { show("chat"); return; }
    P.chat.hide();
  });

  // ---------------------------------------------------------------- settings

  const providerLabel = (id) => ((settings && settings.providers.find((p) => p.id === id)) || { label: id }).label;

  function modelPicker(fieldValue) {
    const select = el("select", { "aria-label": "Model" }, el("option", { value: "", text: "Press “Find my models”, or type one below" }));
    const typed = el("input", { type: "text", placeholder: "Or type a model name", value: fieldValue || "", spellcheck: "false" });
    select.addEventListener("change", () => { if (select.value) typed.value = select.value; });
    return { select, typed, fill(list) {
      clear(select);
      select.appendChild(el("option", { value: "", text: list.length ? "Choose a model" : "No models found: type one below" }));
      for (const m of list) select.appendChild(el("option", { value: m.id, text: m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id, "data-method": m.method || "" }));
      if (typed.value) select.value = typed.value;
    } };
  }

  // A form for a chat key (kind "chat") or a picture / video key.
  function keyForm(kind, existing, done) {
    const isChat = kind === "chat";
    const options = isChat ? settings.providers : settings.providers.filter((p) => p.id !== "anthropic");
    const provider = el("select", { "aria-label": "Provider" }, options.map((p) => el("option", { value: p.id, text: p.label })));
    provider.value = (existing && existing.provider) || options[0].id;
    const label = el("input", { type: "text", maxlength: "40", placeholder: "For example: Work key", value: (existing && existing.label) || "" });
    const baseUrl = el("input", { type: "url", placeholder: "https://… (ends in /v1)", value: (existing && existing.baseUrl) || "", spellcheck: "false" });
    const key = el("input", { type: "password", autocomplete: "off", spellcheck: "false",
      placeholder: existing && existing.keyHint ? `Saved (${existing.keyHint}). Paste a new key to replace it.` : "Paste your API key" });
    const picker = modelPicker(existing && existing.model);
    const msg = el("p", { class: "form-msg", "aria-live": "polite" });
    const baseField = el("label", { class: "field" }, "Its address (base URL)", baseUrl);
    const sync = () => { baseField.hidden = provider.value !== "compatible"; };
    provider.addEventListener("change", sync);
    sync();
    const draft = () => ({ id: existing && existing.id, provider: provider.value, baseUrl: baseUrl.value, key: key.value,
      label: label.value, model: picker.typed.value.trim(),
      method: (picker.select.selectedOptions[0] && picker.select.selectedOptions[0].dataset.method) || (existing && existing.method) || "" });
    const say = (text, bad) => { msg.textContent = text; msg.className = `form-msg${bad ? " error" : ""}`; };
    const find = async () => {
      say("Asking your provider which models this key can use…");
      const res = isChat ? await P.settings.listModels(draft()) : await P.settings.mediaModels(kind, draft());
      if (res && res.error) { say(res.error, true); return; }
      picker.fill(res.models || []);
      say(res.models && res.models.length ? `Found ${res.models.length} model${res.models.length === 1 ? "" : "s"}. Choose one.` : "No models found. You can type a model name instead.");
    };
    const save = async () => {
      const d = draft();
      say("Saving…");
      const res = isChat ? await P.settings.saveProfile(d, d.key) : await P.settings.saveMedia(kind, d, d.key);
      if (res && res.error) { say(res.error, true); return; }
      key.value = "";
      done();
    };
    const who = () => (provider.value === "compatible" ? "that address" : providerLabel(provider.value));
    const note = el("p", { class: "small" });
    const syncNote = () => { note.textContent = `Your key is kept in your Mac's Keychain and sent only to ${who()}. They bill you directly; MTRX never sees it. AI keys are for grown-ups (the AI companies require 18+).`; };
    provider.addEventListener("change", syncNote);
    syncNote();
    return el("div", { class: "page-card" },
      el("h3", { text: existing ? `Change ${existing.label || "key"}` : isChat ? "Add an AI key" : `Add a ${kind} key` }),
      el("label", { class: "field" }, "Provider", provider),
      isChat ? el("label", { class: "field" }, "Name (so you can tell your keys apart)", label) : null,
      baseField,
      el("label", { class: "field" }, "API key", key),
      el("div", { class: "field" }, "Model", picker.select, picker.typed),
      msg,
      el("div", { class: "card-buttons" },
        el("button", { class: "btn", type: "button", text: "Find my models", onclick: find }),
        el("button", { class: "btn primary", type: "button", text: "Save", onclick: save }),
        el("button", { class: "btn", type: "button", text: "Cancel", onclick: done })),
      note);
  }

  let editing = null; // {kind, id}

  function renderSettings() {
    if (view !== "settings" || !settings) return;
    const page = ui.settingsView;
    const keep = page.scrollTop;
    clear(page);
    page.appendChild(el("div", { class: "page-title" }, el("h2", { text: "Settings" }),
      el("button", { class: "btn", type: "button", text: "Back to chat", onclick: () => show("chat") })));
    if (!settings.keychain) {
      page.appendChild(el("div", { class: "page-card" }, el("p", { class: "form-msg error", text: "Pilot can't reach your Mac's Keychain right now, so it can't save keys. Restart your Mac and try again." })));
    }

    // Chat keys
    const keysCard = el("div", { class: "page-card" }, el("h3", { text: "Your AI keys" }),
      el("p", { text: "Pilot works with your own key from Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible API. Your provider bills you; MTRX pays nothing and never sees your key." }));
    if (!settings.profiles.length) keysCard.appendChild(el("p", { class: "empty", text: "No key yet. Add one to start chatting." }));
    for (const p of settings.profiles) {
      const radio = el("input", { type: "radio", name: "active", "aria-label": `Use ${p.label}`, checked: p.id === settings.activeProfile,
        onchange: () => P.settings.activate(p.id) });
      keysCard.appendChild(el("div", { class: "row" }, radio,
        el("div", { class: "grow" }, el("div", { class: "name", text: p.label }),
          el("div", { class: "meta", text: `${providerLabel(p.provider)} · ${p.model || "no model"}${p.keyHint ? ` · key ${p.keyHint}` : ""}` })),
        el("button", { class: "mini", type: "button", text: "Change", onclick: () => { editing = { kind: "chat", id: p.id }; renderSettings(); } }),
        el("button", { class: "mini", type: "button", text: "Remove", onclick: () => P.settings.removeProfile(p.id) })));
    }
    keysCard.appendChild(el("div", { class: "card-buttons" }, el("button", { class: "btn primary", type: "button", text: "Add a key",
      onclick: () => { editing = { kind: "chat", id: null }; renderSettings(); } })));
    page.appendChild(keysCard);
    if (editing && editing.kind === "chat") {
      const existing = editing.id ? settings.profiles.find((p) => p.id === editing.id) : null;
      page.appendChild(keyForm("chat", existing, () => { editing = null; renderSettings(); }));
    }

    // Pictures and videos
    const mediaCard = el("div", { class: "page-card" }, el("h3", { text: "Pictures and videos" }),
      el("p", { text: "Optional. Add an image key or a video key (OpenAI, Google Gemini, or a compatible API) and Pilot can make pictures and videos for you. Each one is billed by your provider." }));
    for (const kind of ["image", "video"]) {
      const m = settings.media[kind];
      mediaCard.appendChild(el("div", { class: "row" },
        el("div", { class: "grow" }, el("div", { class: "name", text: kind === "image" ? "Image key" : "Video key" }),
          el("div", { class: "meta", text: m ? `${providerLabel(m.provider)} · ${m.model}${m.keyHint ? ` · key ${m.keyHint}` : ""}` : "Not set" })),
        el("button", { class: "mini", type: "button", text: m ? "Change" : "Add", onclick: () => { editing = { kind }; renderSettings(); } }),
        m ? el("button", { class: "mini", type: "button", text: "Remove", onclick: () => P.settings.removeMedia(kind) }) : null));
    }
    page.appendChild(mediaCard);
    if (editing && (editing.kind === "image" || editing.kind === "video")) {
      page.appendChild(keyForm(editing.kind, settings.media[editing.kind], () => { editing = null; renderSettings(); }));
    }

    // Screen
    page.appendChild(screenCard());

    // Memory
    const memCard = el("div", { class: "page-card" }, el("h3", { text: "Memory" }),
      el("label", { class: "toggle" }, "Let Pilot remember things you ask it to", el("input", { type: "checkbox", checked: settings.memoryOn,
        onchange: (ev) => P.settings.setMemory(ev.target.checked) })),
      el("p", { class: "small", text: "Off unless you turn it on. Kept only on this Mac, and sent to your AI provider with your messages so Pilot can use it." }));
    if (settings.memory.length) {
      for (const m of settings.memory) {
        memCard.appendChild(el("div", { class: "row" }, el("div", { class: "grow", text: m.text }),
          el("button", { class: "mini", type: "button", text: "Delete", onclick: () => P.settings.removeMemory(m.id) })));
      }
    } else memCard.appendChild(el("p", { class: "empty", text: "Nothing remembered." }));
    page.appendChild(memCard);

    // Notes
    const notesCard = el("div", { class: "page-card" }, el("h3", { text: "Notes Pilot saved" }));
    if (settings.notes.length) {
      for (const n of settings.notes) {
        notesCard.appendChild(el("div", { class: "row" },
          el("div", { class: "grow" }, el("div", { class: "name", text: n.title || "Note" }), el("div", { class: "meta", text: n.text })),
          el("button", { class: "mini", type: "button", text: "Copy", onclick: () => P.settings.copyNote(n.id) }),
          el("button", { class: "mini", type: "button", text: "Delete", onclick: () => P.settings.removeNote(n.id) })));
      }
    } else notesCard.appendChild(el("p", { class: "empty", text: "No notes yet. Ask Pilot to “make a note”." }));
    page.appendChild(notesCard);

    page.appendChild(voiceCard());

    // General
    page.appendChild(el("div", { class: "page-card" }, el("h3", { text: "Pilot on this Mac" }),
      el("label", { class: "toggle" }, "Start Pilot when I log in", el("input", { type: "checkbox", checked: settings.openAtLogin,
        onchange: (ev) => P.settings.setLogin(ev.target.checked) })),
      el("label", { class: "field" }, el("span", { text: "Energy: how much the robot moves around" }),
        el("select", { onchange: (ev) => P.settings.setEnergy(ev.target.value) },
          [["calm", "Calm: he rests"], ["relaxed", "Relaxed: a move now and then"], ["always", "Always moving: he wanders on his own"]]
            .map(([v, t]) => el("option", { value: v, text: t, selected: settings.energy === v })))),
      el("p", { class: "small", text: settings.reducedMotion && !settings.energyChosen
        ? "Your Mac is set to reduce motion, so he rests unless you pick another setting here."
        : settings.energy === "always"
          ? "He keeps still while this chat is open, while a video or game is full screen, and while you're away from your Mac."
          : "He keeps still while you type, while a video or game is full screen, and while this chat is open." }),
      el("p", { class: "small", text: `Pilot for Mac ${settings.version}. Hide Pilot or quit it any time from the robot head in the menu bar.` }),
      el("div", { class: "card-buttons" },
        el("button", { class: "btn", type: "button", text: "Clear this chat", onclick: () => { P.chat.clear(); show("chat"); } }),
        el("button", { class: "btn", type: "button", text: "About Pilot", onclick: () => P.app.about() }),
        el("button", { class: "btn danger", type: "button", text: "Quit Pilot", onclick: () => P.app.quit() }))));
    page.scrollTop = keep;
  }

  // Voice and sounds.
  function voiceCard() {
    const v = settings.voice || {};
    const all = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    const good = SP.goodVoices(all);
    const chosen = SP.pickVoice(all, v.voice);
    const hours = (val, onchange) => el("select", { onchange }, Array.from({ length: 24 }, (_, h) => el("option", { value: String(h),
      text: `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`, selected: h === val })));
    return el("div", { class: "page-card" }, el("h3", { text: "Voice and sounds" }),
      el("label", { class: "toggle" }, "Speak replies out loud", el("input", { type: "checkbox", checked: Boolean(v.speak),
        onchange: (ev) => P.voice.set({ speak: ev.target.checked }) })),
      el("p", { class: "small", text: "Off unless you turn it on. Pilot uses your Mac's own voices, on your Mac. Click the speaker or the robot to stop him. He stays quiet while your Mac is muted or locked, or a video is full screen." }),
      good.length ? el("label", { class: "field" }, el("span", { text: "Voice" }),
        el("select", { onchange: (ev) => P.voice.set({ voice: ev.target.value }) },
          good.slice(0, 12).map((x) => el("option", { value: x.name, text: `${x.name} (${x.lang})`, selected: chosen && chosen.name === x.name })))) : null,
      el("label", { class: "field" }, el("span", { text: `Speed: ${Number(v.voiceRate || 1).toFixed(1)}×` }),
        el("input", { class: "slider", type: "range", min: "0.8", max: "1.3", step: "0.1", value: String(v.voiceRate || 1),
          onchange: (ev) => P.voice.set({ voiceRate: Number(ev.target.value) }) })),
      el("div", { class: "card-buttons" }, el("button", { class: "btn", type: "button", text: "Try it",
        onclick: () => { speaker.set({ voice: v.voice || "", rate: v.voiceRate || 1, ok: true }); speaker.sample(); } })),
      SP.onlyBasic(all) ? el("p", { class: "small", text: "Want a nicer voice? System Settings → Accessibility → Spoken Content → System voice → Manage voices, then download an Enhanced or Premium English voice." }) : null,
      el("label", { class: "toggle" }, "Sounds with some of the robot's tricks", el("input", { type: "checkbox", checked: Boolean(v.sounds),
        onchange: (ev) => P.voice.set({ sounds: ev.target.checked }) })),
      el("label", { class: "field" }, el("span", { text: `Sound volume: ${Math.round((v.soundVolume || 0) * 100)}%` }),
        el("input", { class: "slider", type: "range", min: "0", max: "1", step: "0.05", value: String(v.soundVolume || 0),
          onchange: (ev) => P.voice.set({ soundVolume: Number(ev.target.value) }) })),
      el("div", { class: "field" }, el("span", { text: "Quiet hours: no sounds from" }),
        el("div", { class: "hours" }, hours(v.quietFrom, (ev) => P.voice.set({ quietFrom: Number(ev.target.value) })), el("span", { text: "to" }),
          hours(v.quietTo, (ev) => P.voice.set({ quietTo: Number(ev.target.value) })))),
      el("p", { class: "small", text: "Short, soft sounds made by Pilot itself: never while your Mac is muted, a video is full screen, you're away, or he's talking, and at most one every 20 seconds unless you pick a trick." }));
  }

  // Screen access: macOS's permission, live, and how Pilot may use it.
  function screenCard() {
    const sc = settings.screen || { allowed: false, words: "Not allowed", mode: "ask", offerRelaunch: false };
    const radio = (mode, title, words) => el("label", { class: "mode" },
      el("input", { type: "radio", name: "screen-mode", value: mode, checked: sc.mode === mode, onchange: () => P.screen.setMode(mode) }),
      el("span", {}, el("b", { text: title }), el("small", { text: words })));
    return el("div", { class: "page-card screen-access" },
      el("h3", {}, "Screen access ", el("span", { class: `badge${sc.allowed ? "" : " warn"}`, text: sc.allowed ? "Allowed" : "Not allowed" })),
      el("p", { class: "small", text: "Your Mac decides whether Pilot may see the screen (System Settings, Privacy & Security, Screen Recording). Pilot never watches in the background, and the “Pilot is looking” banner shows every time it looks." }),
      el("div", { class: "card-buttons" },
        el("button", { class: "btn", type: "button", text: "Open Mac settings", onclick: () => P.screen.openSettings() }),
        el("button", { class: "btn", type: "button", text: "Check again", onclick: () => P.screen.check() }),
        sc.offerRelaunch ? el("button", { class: "btn primary", type: "button", text: "Relaunch Pilot", onclick: () => P.app.relaunch() }) : null),
      sc.offerRelaunch ? el("p", { class: "small", text: "Turned Pilot on already? Your Mac may need Pilot to restart before it counts." }) : null,
      radio("off", "Off", "Pilot never looks, and the eye button is hidden."),
      radio("ask", "Only when I ask", "The eye button, or Allow on Pilot's “look at the screen” card."),
      radio("help", "Help with what's on screen", "A fresh screenshot goes with each message you send. Nothing in between."));
  }

  function renderHelp() {
    const page = ui.helpView;
    clear(page);
    page.appendChild(el("div", { class: "page-title" }, el("h2", { text: "Help" }),
      el("button", { class: "btn", type: "button", text: "Back to chat", onclick: () => show("chat") })));
    const card = (title, items) => el("div", { class: "page-card" }, el("h3", { text: title }), el("ul", {}, items.map((t) => el("li", { text: t }))));
    page.appendChild(card("Getting started", [
      "Press the gear (or “Bring Your Own API Key”) and add your key from Anthropic, OpenAI, Google Gemini, or any compatible API.",
      "Press “Find my models” and choose one, then Save.",
      "Type a message and press Enter. Shift+Enter makes a new line.",
    ]));
    page.appendChild(card("What Pilot can do", [
      "Chat, explain, help with code and writing.",
      "Look at your screen when you ask: the eye button.",
      "Write a reply or a draft and copy it to your clipboard, open a website, or save a note. It always asks first.",
      "Plan a few steps at once: you can approve all, step through, or cancel.",
      "Make pictures and videos if you add an image or video key.",
    ]));
    page.appendChild(card("What Pilot never does", [
      "Pay for anything, delete files, send messages or emails for you, or type into other apps.",
      "Do anything without asking you first, or look at your screen without you asking.",
    ]));
    page.appendChild(card("Good to know", [
      "Click the robot to open or close this chat. Drag it anywhere; it remembers the spot.",
      "The robot's dot: green is ready, amber means no key yet, and it pulses while Pilot thinks.",
      "Voice: use your Mac's Dictation in the message box (the Dictation key, or press Fn twice).",
      "Your provider bills you for what you use. MTRX pays nothing and never sees your key.",
      "Hide or quit Pilot from the robot head in the menu bar.",
    ]));
  }

  // ---------------------------------------------------------------- from the main process

  P.chat.onState((s) => {
    state = s;
    syncVoice();
    followReply();
    renderChat();
  });
  P.settings.onChange((s) => {
    settings = s;
    document.documentElement.dataset.theme = s.theme || "blue";
    for (const b of ui.paletteMenu.querySelectorAll("[data-theme-pick]")) b.setAttribute("aria-checked", String(b.dataset.themePick === s.theme));
    syncVoice();
    renderSettings();
    renderChat();
  });
  P.chat.onView((v) => { if (["chat", "settings", "help"].includes(v)) show(v); });
  // When the chat opens, the message box has the keyboard.
  P.chat.onFocus((v) => {
    if (v === "chat" || !v) { if (view !== "chat") show("chat"); }
    if (view === "chat") setTimeout(() => ui.input.focus(), 0);
  });
  // A click anywhere in the chat makes it the key window if it isn't.
  document.addEventListener("mousedown", () => { if (!document.hasFocus()) P.chat.focus(); }, true);
  P.settings.get().then((s) => { if (s && !s.error) { settings = s; document.documentElement.dataset.theme = s.theme || "blue"; syncVoice(); renderChat(); } });
  if (window.speechSynthesis && window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener("voiceschanged", () => renderSettings());
  renderChat();
})();
