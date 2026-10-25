// Approve this device: make its key, then send the public half to the
// server along with a signature that proves this device holds the key.
(() => {
  const form = document.getElementById("add");
  const status = document.getElementById("status");
  const button = form.querySelector("button");
  const nameBox = document.getElementById("name");

  if (!nameBox.value) {
    const ua = navigator.userAgent;
    nameBox.value = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad"
      : /Android/.test(ua) ? "Android phone" : /Mac/.test(ua) ? "Mac"
      : /Windows/.test(ua) ? "Windows computer" : "";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    status.classList.remove("bad");
    status.textContent = "Making this device's key…";
    try {
      const token = form.dataset.token;
      const pair = await DeviceKey.create();
      const result = await DeviceKey.post("/api/enroll", {
        token,
        name: nameBox.value,
        public_key: await DeviceKey.publicKey(pair),
        signature: await DeviceKey.sign(pair, "mtrx-enroll:" + token),
      });
      if (result.ok && result.data.go) {
        status.textContent = "Approved. Opening the console…";
        window.location.replace(result.data.go);
        return;
      }
      status.textContent = result.data.error || "That didn't work.";
    } catch (_) {
      status.textContent = "This browser couldn't make a device key. Use an up-to-date browser over https.";
    }
    status.classList.add("bad");
    button.disabled = false;
  });
})();
