"use strict";

const state = document.getElementById("state");
const title = document.getElementById("title");
const detail = document.getElementById("detail");
const code = document.getElementById("code");

function refresh() {
  chrome.runtime.sendMessage({ type: "status" }, (r) => {
    r = r || { error: "app not running" };
    state.className = r.ok ? "ok" : "bad";
    if (r.ok) {
      title.textContent = r.paused ? "Omnicyte is paused" : "Omnicyte is watching";
      detail.textContent = r.org ? "Protecting you for " + r.org + "." : "Dangerous links will be stopped before you open them.";
    } else if (r.error === "not paired") {
      title.textContent = "Not paired yet";
      detail.textContent = "Right-click the Omnicyte buddy on your desktop, choose Pair, and paste the code below.";
    } else {
      title.textContent = "Omnicyte app not running";
      detail.textContent = "Start Omnicyte on this computer so links can be checked.";
    }
  });
}

chrome.storage.local.get("omnicyteToken", ({ omnicyteToken }) => { code.value = omnicyteToken || ""; });
document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.set({ omnicyteToken: code.value.trim() }, refresh);
});
refresh();
