// The robot's overlay window. It shows the robot (pilot-actor.js), plays the
// moves the main process asks for (pilot-motion.js plans them here, where
// the robot's size and the window are known; roam.js the Always moving
// ones, which link into each other standing up), and tells the main process:
// - when the pointer is over the robot, so the overlay takes the mouse only
//   then and lets every other click through to the apps underneath;
// - where the robot is after each move, for the chat window's place;
// - drags (wherever it's dropped becomes home) and clicks (open the chat);
// - when "reduce motion" changes.
// Pilot for Mac 1.3: the 80 tricks (tricks.js) with their drawn props
// (props.js), sound effects for some of them (sounds.js), every pose picture
// fetched and decoded before it's first needed, and a gentle "talking" look
// while Pilot reads a reply aloud.
// Pilot for Mac 1.5: sharp and smooth (smooth.js: every move on the screen's
// pixel grid, and pictures that dissolve one over the other instead of both
// fading at once), and clickable while he moves: as long as a move plays,
// every frame checks whether the pointer is on him, and his place goes to
// the main process 20 times a second, so its own check of the cursor (which
// works even when macOS sends this window no mouse moves) follows him
// instead of the spot where the move began.
// Pilot for Mac 1.5.1: the pictures change on the move's own clock
// (smooth.js's poseClock), so a walk's body can move at the very moment its
// picture changes and his planted foot stays put; a dissolving picture is
// really seen (tricks.css); and the "Pilot needs your AI key." tooltip only
// comes up when you point at him, not when he walks under a still pointer.
"use strict";

(function () {
  const P = window.pilot.robot;
  const M = window.PilotMotion;
  const R = window.PilotRoam;
  const T = window.PilotTricks;
  const S = window.PilotSmooth;
  const sfx = window.PilotSounds.create({});
  const stage = document.getElementById("stage");
  const words = document.getElementById("status-words");
  const SAY = { ready: "Pilot is ready.", nokey: "Pilot needs your AI key.", thinking: "Pilot is thinking.", looking: "Pilot is looking at your screen." };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.setAttribute("aria-hidden", "true");

  let state = null;
  let actor = null;
  let over = false;
  let down = null;
  let dragging = false;
  let hidden = false;
  let queue = Promise.resolve();
  let settleTimer = null;
  // Standing still after a move with nothing coming next (a hold: the chat,
  // full screen, the Mac idle): sit down to the resting robot, which blinks
  // and breathes. In Always moving the next move normally comes first.
  const SETTLE_MS = 6000;

  // The drawn props and effects fill in as the actor adds them.
  window.PilotProps.attach(stage);
  // Each change of picture dissolves (a step of a walk or climb is a clean cut).
  let clock = null; // the pictures' clock while a move plays (smooth.js's poseClock)
  const dissolve = S.dissolver(stage, { sameCycle: R.sameCycle, reduced: () => reduce.matches, skip: () => Boolean(clock && clock.active) });
  const picture = (name) => (name === "rest" ? stage.querySelector(".pa-rest") : stage.querySelector(`.pa-pose[data-pose="${name}"]`));
  function stopClock() { if (clock) { clock.stop(); clock = null; } }
  // Stop whatever plays (the pictures' clock first, so stopping dissolves as usual).
  function halt() { stopClock(); return actor.stop(); }
  const dpr = () => window.devicePixelRatio || 1;
  const snap = (v) => S.snap(v, dpr());

  function makeActor(poses) {
    actor = window.PilotActor.create({
      stage, poses, extra: [dot], reduced: reduce.matches,
      art: { body: "../../assets/robot-rest-body.webp", head: "../../assets/robot-rest-head.webp", eyes: "../../assets/robot-rest-eyes.webp" },
    });
    actor.idle(!reduce.matches);
    warm(poses);
  }

  // Fetch and decode every pose picture (and the prop pictures) up front, so
  // a pose never stalls a frame the first time it shows. Pictures on the
  // big canvas get the bigger box.
  let warmed = Promise.resolve();
  const propPics = [];
  function warm(poses) {
    warmed = actor.preload(Object.keys(poses || {})).then(() => {
      for (const img of stage.querySelectorAll(".pa-pose")) img.classList.toggle("pt-big", img.naturalWidth > 400);
    }).catch(() => {});
    if (!propPics.length) {
      for (const name of window.PilotProps.PICTURES) {
        const img = new Image();
        img.src = `../../assets/props/${name}.webp`;
        if (img.decode) img.decode().catch(() => {});
        propPics.push(img);
      }
    }
    return warmed;
  }

  function rectOf() {
    const r = actor.rect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  // Where he is drawn now: mid-move, the animated place (not where it began).
  function liveAt() {
    const m = /matrix(?:3d)?\(([^)]+)\)/.exec(getComputedStyle(actor.el).transform || "");
    if (!m) return actor.at;
    const v = m[1].split(",").map(Number);
    const p = v.length === 16 ? { x: v[12], y: v[13] } : { x: v[4], y: v[5] };
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : actor.at;
  }

  function report(moving) {
    const at = moving && actor.busy ? liveAt() : actor.at;
    P.at({ x: at.x, y: at.y, rect: rectOf(), moving: Boolean(moving) });
  }

  // The window in the robot's terms: x, y is the point between its feet.
  function geometry(extra) {
    const u = actor.geometry().u;
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
      u, pos: actor.at, home: state ? state.home : null, floor: h - 8, left: u * 0.62, right: w - u * 0.62, top: u * 1.7,
      poses: actor.poses(), profile: "desktop", random: Math.random, pointer: extra && extra.at, sky: h * 0.6, wall: { left: 0, right: w }, dpr: dpr(),
    };
  }

  // A move from the main process: plan it here and play it.
  function perform(cmd) {
    queue = queue.then(async () => {
      if (!actor || dragging || hidden || !cmd || typeof cmd.move !== "string") return;
      const roaming = cmd.move.startsWith("roam");
      // Always moving's own moves wait while the chat is open or the Mac is idle.
      const skip = roaming && state && (state.chatOpen || state.away || state.level !== "always");
      const g = geometry(cmd);
      await warmed;
      let plan = null;
      if (skip) plan = null;
      else if (roaming && cmd.move === "roam-trick" && T.has(cmd.trick)) plan = T.plan(cmd.trick, g, actor.pose);
      else if (roaming) plan = R.plan(cmd.move, g, actor.pose);
      else if (T.has(cmd.move)) plan = T.plan(cmd.move, g, actor.pose);
      else plan = R.desktop(cmd.move, g, actor.pose) || R.mac(M.plan(cmd.move, g, { how: cmd.how, at: cmd.at, say: typeof cmd.say === "string" ? cmd.say.slice(0, 40) : undefined }), g);
      plan = R.fromPose(plan, actor.pose, g);
      if (!plan) {
        // Nothing to play: say so at once, so the main process's timer carries on.
        if (roaming) { report(true); report(false); }
        return;
      }
      await play(plan, roaming, Boolean(cmd.user));
      checkOver(lastPoint);
    }).catch(() => {});
  }

  // ------------------------------------------------------------ sounds

  // The classic moves' sounds (pilot-motion.js's plans carry none).
  function classicSounds(plan) {
    const goal = plan.fx.find((f) => f.kind === "bubble" && f.text === "GOAL!");
    switch (plan.name) {
      case "soccer": return goal ? [{ t: goal.t, kind: "applause" }] : [];
      case "celebrate": return [{ t: 200, kind: "applause" }];
      case "backflip": case "spin": return [{ t: 250, kind: "whoosh" }];
      default: return [];
    }
  }
  const soundState = (user, chain) => {
    const sd = (state && state.sound) || {};
    return { on: Boolean(sd.on), volume: sd.volume, muted: Boolean(sd.muted), fullscreen: Boolean(sd.fullscreen), away: Boolean(state && state.away),
      talking: Boolean(state && state.talking), hour: new Date().getHours(), quietFrom: sd.quietFrom, quietTo: sd.quietTo, user, chain };
  };
  const soundLog = [];
  function scheduleSounds(plan, user) {
    const cues = (plan.sounds && plan.sounds.length ? plan.sounds : classicSounds(plan)).slice().sort((a, b) => a.t - b.t);
    let played = false;
    return cues.map((c) => setTimeout(() => {
      const ok = sfx.play(c.kind, soundState(user, played));
      soundLog.push({ kind: c.kind, played: ok, move: plan.name });
      if (soundLog.length > 50) soundLog.shift();
      if (ok) played = true;
    }, c.t));
  }

  async function play(raw, roaming, user) {
    const plan = S.refine(raw, dpr());
    clearTimeout(settleTimer);
    report(true);
    document.documentElement.classList.toggle("travel", Boolean(roaming));
    const cues = scheduleSounds(plan, user);
    playing += 1;
    follow();
    hint(false);
    let end;
    stopClock();
    const running = actor.play(plan);
    const mine = S.poseClock(plan, { clock: actor.el, picture, sameCycle: R.sameCycle, reduced: () => reduce.matches });
    clock = mine;
    try { end = await running; } finally {
      playing -= 1;
      mine.stop();
      if (clock === mine) clock = null;
    }
    for (const t of cues) clearTimeout(t);
    if (end && end.stopped) sfx.stop();
    document.documentElement.classList.remove("travel");
    report(false);
    checkOver(lastPoint);
    if (!(end && end.stopped)) settleLater();
  }

  // ------------------------------------------------------------ following a move

  // While a move plays: every frame, is the pointer on him now (he may walk
  // under a still pointer, or away from it)? And 20 times a second, where
  // he is, for the main process's own check of the cursor.
  let playing = 0;
  let followRaf = 0;
  let lastReport = 0;
  function follow() {
    if (followRaf) return;
    const step = (now) => {
      followRaf = 0;
      if (!actor || (!playing && !actor.busy)) return;
      checkOver(lastPoint);
      if (now - lastReport >= S.REPORT_MS) { lastReport = now; report(true); }
      followRaf = requestAnimationFrame(step);
    };
    followRaf = requestAnimationFrame(step);
  }

  function settleLater() {
    clearTimeout(settleTimer);
    if (!actor || actor.pose === "rest") return;
    settleTimer = setTimeout(() => {
      queue = queue.then(async () => {
        if (!actor || actor.busy || dragging || hidden || actor.pose === "rest") return;
        const plan = R.sit(geometry(), actor.pose);
        if (plan) await play(plan, false);
      }).catch(() => {});
    }, SETTLE_MS);
  }

  // ------------------------------------------------------------ click-through

  // Pressed on him: the overlay keeps the mouse until the button is let go,
  // even if he sits down to the (smaller) resting robot under the pointer.
  // (In 1.4 the hover dropped right there, so the release went to the app
  // underneath and the click never landed.)
  let lastPoint = null;
  function checkOver(point) {
    if (!actor) return;
    const now = S.wantsMouse({ rect: point ? actor.rect() : null, point, down: Boolean(down), dragging, pad: 4 });
    if (now !== over) { over = now; P.hover(over); }
  }
  // Mouse moves arrive even while the window lets clicks through.
  window.addEventListener("mousemove", (ev) => {
    const moved = !lastPoint || lastPoint.x !== ev.clientX || lastPoint.y !== ev.clientY;
    lastPoint = { x: ev.clientX, y: ev.clientY };
    checkOver(lastPoint);
    // The pointer itself moved onto him while he stands still: the tooltip may come up.
    if (moved && over && actor && !actor.busy) hint(true);
    else if (!over) hint(false);
  });
  document.addEventListener("mouseleave", () => { lastPoint = null; hint(false); if (over && !dragging && !down) { over = false; P.hover(false); } });

  // 1.5.1: the tooltip with what Pilot needs ("Pilot needs your AI key.") is
  // there only when you point at him on purpose. macOS shows a tooltip under
  // a still pointer too, so when he walked under it, it popped up and stayed
  // while he moved. (The screen reader still hears it: status-words.)
  function hint(on) {
    const want = on && state ? SAY[state.status] || "Pilot" : "";
    if (stage.title !== want) stage.title = want;
  }

  // ------------------------------------------------------------ drag and click

  stage.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || !actor) return;
    clearTimeout(settleTimer);
    halt();
    const at = actor.at;
    down = { x: ev.clientX, y: ev.clientY, ox: ev.clientX - at.x, oy: ev.clientY - at.y, id: ev.pointerId };
    dragging = false;
    lastPoint = { x: ev.clientX, y: ev.clientY };
    checkOver(lastPoint);
    try { stage.setPointerCapture(ev.pointerId); } catch (_) { /* fine */ }
  });

  stage.addEventListener("pointermove", (ev) => {
    if (!down) return;
    if (!dragging && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) {
      dragging = true;
      document.body.classList.add("dragging");
      P.dragStart();
    }
    if (dragging) {
      const g = geometry();
      const x = Math.min(Math.max(ev.clientX - down.ox, g.left), g.right);
      const y = Math.min(Math.max(ev.clientY - down.oy, g.top), window.innerHeight - 4);
      actor.place(snap(x), snap(y));
    }
  });

  async function release(ev) {
    if (!down) return;
    try { stage.releasePointerCapture(down.id); } catch (_) { /* fine */ }
    const d = down;
    down = null;
    if (!dragging) {
      if (ev.type === "pointerup") P.click();
      checkOver({ x: ev.clientX, y: ev.clientY });
      return;
    }
    dragging = false;
    document.body.classList.remove("dragging");
    const at = actor.at;
    const res = await P.drop({ x: at.x, y: at.y, ox: d.ox, oy: d.oy });
    if (res && Number.isFinite(res.x)) actor.place(snap(res.x), snap(res.y));
    report(false);
    settleLater();
    checkOver({ x: ev.clientX, y: ev.clientY });
  }
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  stage.addEventListener("contextmenu", (ev) => { ev.preventDefault(); P.menu(); });

  // Pictures and videos dropped on the robot open the chat, ready to send.
  const hasFiles = (ev) => ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");
  document.addEventListener("dragover", (ev) => { if (hasFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; } });
  document.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const files = ev.dataTransfer ? [...ev.dataTransfer.files] : [];
    if (!files.length) return;
    window.pilot.attach.show();
    if (actor) play(R.fromPose(M.plan("nod", geometry()), actor.pose, geometry()), false).catch(() => {});
    window.PilotAttach.takeFiles(files, window.pilot.attach, {}).catch(() => {});
  });

  // ------------------------------------------------------------ state

  let idleWas = null;
  P.onState((s) => {
    if (!s) return;
    const first = !state;
    const posesChanged = !state || JSON.stringify(state.poses) !== JSON.stringify(s.poses);
    state = s;
    document.documentElement.dataset.status = s.status;
    document.documentElement.dataset.theme = s.theme || "blue";
    words.textContent = SAY[s.status] || "";
    if (stage.title) stage.title = SAY[s.status] || "Pilot";
    if (!actor) makeActor(s.poses || {});
    else if (posesChanged) { actor.setPoses(s.poses || {}); warm(s.poses || {}); }
    // Reading a reply aloud: a gentle talking look, and no sound effects.
    document.documentElement.classList.toggle("talking", Boolean(s.talking));
    if (s.talking) sfx.stop();
    // The chat opened while he was travelling: he stops right there, next to it.
    if (s.chatOpen && actor.busy && !first && !dragging) { halt(); report(false); settleLater(); }
    // Nobody at the Mac (idle or locked): not even a blink until they're back.
    const idleOk = !reduce.matches && !hidden && !s.away;
    if (idleOk !== idleWas) { idleWas = idleOk; actor.idle(idleOk); }
    // Only in the smoke test: a handle to hold a move still for pictures.
    if (s.test && !window.__pilotRobot) {
      window.__pilotRobot = { actor, halt, clock: () => clock, play: (plan) => play(plan, false, true), geometry, sounds: soundLog, warmed: () => warmed, perform, queue: () => queue, dissolve, refine: (p) => S.refine(p, dpr()),
        over: () => over, plan: (move, extra) => (move.startsWith("roam")
        ? R.plan(move, geometry(extra), actor.pose) : T.has(move) ? T.plan(move, geometry(extra), actor.pose)
          : R.desktop(move, geometry(extra), actor.pose, extra) || M.plan(move, geometry(extra), extra || {})) };
    }
    if (first) {
      actor.place(snap(s.home.x), snap(s.home.y));
      requestAnimationFrame(() => report(false));
    } else if (!actor.busy && !dragging) {
      // Keep the robot inside the window if the screen changed size.
      const g = geometry();
      const at = actor.at;
      const x = Math.min(Math.max(at.x, g.left), g.right);
      const y = Math.min(Math.max(at.y, g.top), g.floor + 4);
      if (x !== at.x || y !== at.y) { actor.place(snap(x), snap(y)); report(false); }
    }
  });

  P.onDo((cmd) => perform(cmd));
  P.onShow((shown) => {
    hidden = !shown;
    if (actor) { if (hidden) { clearTimeout(settleTimer); halt(); } idleWas = shown && !reduce.matches; actor.idle(idleWas); }
  });

  function env() { P.env({ reducedMotion: reduce.matches }); if (actor) { idleWas = !reduce.matches && !hidden; actor.idle(idleWas); } }
  if (reduce.addEventListener) reduce.addEventListener("change", env);
  env();
})();
