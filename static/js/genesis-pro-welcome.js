// The Genesis Pro welcome page: where Stripe sends a buyer after paying.
//
// Stripe adds the checkout's id to the address. This page sends it to
// /api/genesis/pro/claim, which answers with the buyer's first Pro key once
// Stripe's webhook has made them a member, and keeps the key in this
// browser so Pro is on here. The id is taken out of the address straight
// away, and the key is placed with textContent.
(() => {
  const S = window.GenesisStore;
  const $ = (id) => document.getElementById(id);
  const SESSION = "mtrx-genesis-pro-checkout";
  const TRIES = 40;
  const GAP = 3000;

  let session = new URLSearchParams(window.location.search).get("session_id") || "";
  let tab = null;
  try { tab = window.sessionStorage; } catch (_) { tab = null; }
  try {
    if (session) { if (tab) tab.setItem(SESSION, session); }
    else if (tab) session = tab.getItem(SESSION) || "";
  } catch (_) { /* this tab can't keep it; a reload then needs the email */ }
  try { window.history.replaceState(null, "", window.location.pathname); } catch (_) { /* fine */ }
  let storage = null;
  try { storage = window.localStorage; } catch (_) { storage = null; }

  function show(which) {
    for (const id of ["w-wait", "w-done", "w-error"]) $(id).hidden = id !== which;
  }

  function fail(text) {
    $("w-error-text").textContent = text;
    show("w-error");
  }

  function done(data) {
    try { if (tab) tab.removeItem(SESSION); } catch (_) { /* fine */ }
    const kept = S.keepProKey(storage, data.key);
    $("w-key").textContent = data.key;
    $("w-saved").textContent = kept
      ? "Pro is on in this browser. You're all set."
      : "Your browser won't keep the key, so copy it now and paste it into Genesis when you need Pro.";
    $("w-email").textContent = data.email
      ? "We've emailed it to the address used at checkout too. Use it to turn on Pro in another browser, and keep it private, like a password."
      : "Copy it somewhere safe: it turns on Pro in another browser. Keep it private, like a password.";
    show("w-done");
  }

  $("w-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("w-key").textContent);
      $("w-copy").textContent = "Copied";
    } catch (_) {
      $("w-copy").textContent = "Select the key above to copy it";
    }
  });

  async function ask(tries) {
    let res, data = {};
    try {
      res = await fetch("/api/genesis/pro/claim", {
        method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session }),
      });
      try { data = await res.json(); } catch (_) { /* not JSON */ }
    } catch (_) {
      if (tries > 1) { setTimeout(() => ask(tries - 1), GAP); return; }
      fail("No connection. Your Pro key is in your email too.");
      return;
    }
    if (res.status === 200 && data.key) { done(data); return; }
    if (res.status === 202 && tries > 1) { setTimeout(() => ask(tries - 1), GAP); return; }
    if (res.status === 202) {
      fail("Your payment went through, but Pro is taking longer than usual to start. Your key will arrive by email; or try this page again in a few minutes.");
      return;
    }
    fail(data.error || "Something went wrong. Your Pro key is in your email too.");
  }

  if (!session) { fail("This page's link isn't complete. Your Pro key is in your email."); return; }
  ask(TRIES);
})();
