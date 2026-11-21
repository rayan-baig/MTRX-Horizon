// The robot's overlay window. It shows the robot (pilot-actor.js), plays the
// moves the main process asks for (pilot-motion.js plans them here, where
// the robot's size and the window are known; roam.js the Always moving
// ones, which link into each other standing up), and tells the main process:
// - when the pointer is over the robot, so the overlay takes the mouse only
//   then and lets every other click through to the apps underneath;
// - where the robot is after each move, for the chat window's place;
// - drags (wherever it's dropped becomes home) and clicks (open the chat);
// - when "reduce motion" changes.
"use strict";

(function () {
  const P = window.pilot.robot;
  const M = window.PilotMotion;
  const R = window.PilotRoam;
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

  function makeActor(poses) {
    actor = window.PilotActor.create({
      stage, poses, extra: [dot], reduced: reduce.matches,
      art: { body: "../../assets/robot-rest-body.webp", head: "../../assets/robot-rest-head.webp", eyes: "../../assets/robot-rest-eyes.webp" },
    });
    actor.idle(!reduce.matches);
  }

  function rectOf() {
    const r = actor.rect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  function report(moving) {
    const at = actor.at;
    P.at({ x: at.x, y: at.y, rect: rectOf(), moving: Boolean(moving) });
  }

  // The window in the robot's terms: x, y is the point between its feet.
  function geometry(extra) {
    const u = actor.geometry().u;
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
      u, pos: actor.at, home: state ? state.home : null, floor: h - 8, left: u * 0.62, right: w - u * 0.62, top: u * 1.7,
      poses: actor.poses(), profile: "desktop", random: Math.random, pointer: extra && extra.at, sky: h * 0.6,
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
      let plan = skip ? null : roaming ? R.plan(cmd.move, g, actor.pose)
        : M.plan(cmd.move, g, { how: cmd.how, at: cmd.at, say: typeof cmd.say === "string" ? cmd.say.slice(0, 40) : undefined });
      plan = R.fromPose(plan, actor.pose, g);
      if (!plan) {
        // Nothing to play: say so at once, so the main process's timer carries on.
        if (roaming) { report(true); report(false); }
        return;
      }
      await play(plan, roaming);
      checkOver(lastPoint);
    }).catch(() => {});
  }

  async function play(plan, roaming) {
    clearTimeout(settleTimer);
    report(true);
    // Fewer glow effects while travelling (cheaper to draw every frame).
    document.documentElement.classList.toggle("travel", Boolean(roaming));
    const end = await actor.play(plan);
    document.documentElement.classList.remove("travel");
    report(false);
    if (!(end && end.stopped)) settleLater();
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

  let lastPoint = null;
  function checkOver(point) {
    if (!actor || !point) return;
    const now = dragging || M.hit(actor.rect(), point, 2);
    if (now !== over) { over = now; P.hover(over); }
  }
  // Mouse moves arrive even while the window lets clicks through.
  window.addEventListener("mousemove", (ev) => { lastPoint = { x: ev.clientX, y: ev.clientY }; checkOver(lastPoint); });
  document.addEventListener("mouseleave", () => { if (over && !dragging) { over = false; P.hover(false); } });

  // ------------------------------------------------------------ drag and click

  stage.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || !actor) return;
    clearTimeout(settleTimer);
    actor.stop();
    const at = actor.at;
    down = { x: ev.clientX, y: ev.clientY, ox: ev.clientX - at.x, oy: ev.clientY - at.y, id: ev.pointerId };
    dragging = false;
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
      actor.place(x, y);
    }
  });

  async function release(ev) {
    if (!down) return;
    try { stage.releasePointerCapture(down.id); } catch (_) { /* fine */ }
    const d = down;
    down = null;
    if (!dragging) { if (ev.type === "pointerup") P.click(); return; }
    dragging = false;
    document.body.classList.remove("dragging");
    const at = actor.at;
    const res = await P.drop({ x: at.x, y: at.y, ox: d.ox, oy: d.oy });
    if (res && Number.isFinite(res.x)) actor.place(res.x, res.y);
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
    if (actor) actor.play(R.fromPose(M.plan("nod", geometry()), actor.pose, geometry())).catch(() => {});
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
    stage.title = SAY[s.status] || "Pilot";
    if (!actor) makeActor(s.poses || {});
    else if (posesChanged) actor.setPoses(s.poses || {});
    // The chat opened while he was travelling: he stops right there, next to it.
    if (s.chatOpen && actor.busy && !first && !dragging) { actor.stop(); report(false); settleLater(); }
    // Nobody at the Mac (idle or locked): not even a blink until they're back.
    const idleOk = !reduce.matches && !hidden && !s.away;
    if (idleOk !== idleWas) { idleWas = idleOk; actor.idle(idleOk); }
    // Only in the smoke test: a handle to hold a move still for pictures.
    if (s.test && !window.__pilotRobot) {
      window.__pilotRobot = { actor, geometry, plan: (move, extra) => (move.startsWith("roam")
        ? R.plan(move, geometry(extra), actor.pose) : M.plan(move, geometry(extra), extra || {})) };
    }
    if (first) {
      actor.place(s.home.x, s.home.y);
      requestAnimationFrame(() => report(false));
    } else if (!actor.busy && !dragging) {
      // Keep the robot inside the window if the screen changed size.
      const g = geometry();
      const at = actor.at;
      const x = Math.min(Math.max(at.x, g.left), g.right);
      const y = Math.min(Math.max(at.y, g.top), g.floor + 4);
      if (x !== at.x || y !== at.y) { actor.place(x, y); report(false); }
    }
  });

  P.onDo((cmd) => perform(cmd));
  P.onShow((shown) => {
    hidden = !shown;
    if (actor) { if (hidden) { clearTimeout(settleTimer); actor.stop(); } idleWas = shown && !reduce.matches; actor.idle(idleWas); }
  });

  function env() { P.env({ reducedMotion: reduce.matches }); if (actor) { idleWas = !reduce.matches && !hidden; actor.idle(idleWas); } }
  if (reduce.addEventListener) reduce.addEventListener("change", env);
  env();
})();
