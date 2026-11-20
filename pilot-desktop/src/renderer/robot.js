// The robot window: a click opens or closes the chat; a drag moves Pilot
// (the main process moves the window and remembers the spot).
"use strict";

(function () {
  const robot = document.getElementById("robot");
  const words = document.getElementById("status-words");
  const SAY = { ready: "Pilot is ready.", nokey: "Pilot needs your AI key.", thinking: "Pilot is thinking.", looking: "Pilot is looking at your screen." };
  let down = null;
  let dragging = false;

  robot.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    down = { x: ev.screenX, y: ev.screenY };
    dragging = false;
    robot.setPointerCapture(ev.pointerId);
  });

  robot.addEventListener("pointermove", (ev) => {
    if (!down) return;
    if (!dragging && Math.hypot(ev.screenX - down.x, ev.screenY - down.y) > 4) {
      dragging = true;
      window.pilot.robot.dragStart();
    }
    if (dragging) window.pilot.robot.dragMove();
  });

  robot.addEventListener("pointerup", (ev) => {
    if (!down) return;
    robot.releasePointerCapture(ev.pointerId);
    if (dragging) window.pilot.robot.dragEnd();
    else window.pilot.robot.click();
    down = null;
    dragging = false;
  });

  robot.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); window.pilot.robot.click(); }
  });

  window.pilot.robot.onState((s) => {
    if (!s) return;
    robot.dataset.status = s.status;
    document.documentElement.dataset.theme = s.theme || "blue";
    words.textContent = SAY[s.status] || "";
    robot.title = SAY[s.status] || "Pilot";
  });
})();
