// Prove this is an approved device: sign a fresh challenge with its key.
(async () => {
  const status = document.getElementById("status");
  const fail = (text) => { status.textContent = text; status.classList.add("bad"); };
  try {
    const pair = await DeviceKey.load();
    if (!pair) {
      fail("This browser lost its device key (its stored data was cleared). Approve it again from another device.");
      return;
    }
    const challenge = await DeviceKey.post("/api/unlock/challenge");
    if (!challenge.ok) { fail("The door closed. Go back and knock again."); return; }
    const signature = await DeviceKey.sign(pair, "mtrx-unlock:" + challenge.data.challenge);
    const result = await DeviceKey.post("/api/unlock", {
      challenge: challenge.data.challenge, signature,
    });
    if (result.ok && result.data.go) {
      window.location.replace(result.data.go);
    } else {
      fail(result.data.error || "This device couldn't be checked.");
    }
  } catch (_) {
    fail("Something went wrong while checking this device. Try again.");
  }
})();
