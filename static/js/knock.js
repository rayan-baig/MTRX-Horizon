// The secret knock. Taps on a few things on the home page are collected,
// and after a short pause they are sent to the server, which alone knows
// the right order. This file has no idea what the answer is.
(() => {
  const PAUSE_MS = 1600;
  let taps = [];
  let timer = null;

  async function send() {
    const sent = taps;
    taps = [];
    if (sent.length < 4) return;
    try {
      const res = await fetch("/api/knock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taps: sent }),
        credentials: "same-origin",
      });
      const data = await res.json();
      if (data.go) window.location.href = data.go;
    } catch (_) {
      // A failed knock looks exactly like a wrong one.
    }
  }

  // No visible reaction to a tap, on purpose: nothing should hint that
  // these are anything more than pictures.
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-knock]");
    if (!target) return;
    taps.push(target.dataset.knock);
    if (taps.length > 40) taps = taps.slice(-40);
    clearTimeout(timer);
    timer = setTimeout(send, PAUSE_MS);
  });
})();
