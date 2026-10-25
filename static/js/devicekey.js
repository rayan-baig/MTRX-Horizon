// This device's key. The browser makes it and keeps it in its own storage,
// marked so that not even this page's code can read the private half.
// Only the public half ever leaves the device.
const DeviceKey = (() => {
  const DB_NAME = "mtrx-horizon";
  const STORE = "keys";
  const ID = "device";

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

  async function load() {
    return run("readonly", (s) => s.get(ID));
  }

  async function create() {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false, // the private key can never be exported
      ["sign", "verify"],
    );
    await run("readwrite", (s) => s.put(pair, ID));
    return pair;
  }

  async function publicKey(pair) {
    return b64(await crypto.subtle.exportKey("spki", pair.publicKey));
  }

  async function sign(pair, message) {
    const data = new TextEncoder().encode(message);
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data);
    return b64(sig);
  }

  async function post(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      credentials: "same-origin",
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* empty answer */ }
    return { ok: res.ok, data };
  }

  return { load, create, publicKey, sign, post };
})();
