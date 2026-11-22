// Genesis moved to its own address (genesis.mtrxhorizyn.com, 1.25.0). This
// page stays at the old address, /genesis-move, because a browser keeps each
// address's saved data apart: only a page here can read what Genesis saved
// here. genesis.* sends a visitor here once, with a one-time code in the
// #part; this page reads Genesis's saved data (GenesisStore.packMove) and goes
// straight back with it in genesis.*'s #part, which a browser never sends to
// any server. The data stays here too (nothing is deleted). Too much for an
// address: the projects as a file to download, then Import on genesis.*.
(() => {
  const S = window.GenesisStore;
  const box = document.getElementById("g-move");
  const genesis = (box.dataset.genesis || "").replace(/\/+$/, "");
  const q = new URLSearchParams(window.location.hash.slice(1));
  const n = /^[a-f0-9]{16,64}$/.test(q.get("n") || "") ? q.get("n") : "";
  const then = /^(?:p\/[A-Za-z0-9-]{1,64}|new|example|pro|spark)$/.test(q.get("then") || "") ? q.get("then") : "";
  const back = (what) => `${genesis}/#move=${what}&n=${n}${then ? `&then=${encodeURIComponent(then)}` : ""}`;
  if (!/^https?:\/\/[^\s/]+$/.test(genesis)) return;
  // Not sent by genesis.*: nothing to hand over.
  if (!n) { window.location.replace(`${genesis}/`); return; }
  let local = null;
  try { local = window.localStorage; } catch (_) { local = null; }
  const packed = S.packMove(local);
  if (!packed) { window.location.replace(back("none")); return; }
  if (packed.length <= S.MOVE_MOST) { window.location.replace(back(packed)); return; }

  // Too big for an address: download, then Import there.
  document.getElementById("g-move-wait").hidden = true;
  document.getElementById("g-move-big").hidden = false;
  document.getElementById("g-move-go").href = back("file");
  document.getElementById("g-move-download").addEventListener("click", () => {
    const blob = new Blob([S.exportText(S.open(local).load())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `genesis-projects-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
