// Looking at the screen, only when the user asks.
//
// macOS lets an app read the screen only after the user turns it on in
// System Settings → Privacy & Security → Screen Recording. Pilot explains
// that in plain words first, and opens the right pane when the user agrees.
// A screenshot is taken only for a message the user sends, or after the user
// presses Allow on Pilot's "look at the screen" card. Nothing is captured in
// the background, and Pilot's own windows are left out of the picture.
"use strict";

const SETTINGS_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
const LONGEST_EDGE = 1600; // plenty for the AI to read, and fewer of the user's tokens

function make(deps) {
  const { desktopCapturer, systemPreferences, shell, screen, platform } = deps;

  function status() {
    if (platform !== "darwin") return "granted";
    try { return systemPreferences.getMediaAccessStatus("screen"); } catch (_) { return "unknown"; }
  }

  // Shows macOS's own prompt (the first time) and opens the Screen Recording
  // pane, where the user turns Pilot on.
  async function openSettings() {
    if (platform === "darwin" && status() === "not-determined") {
      try { await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }); } catch (_) { /* prompt only */ }
    }
    await shell.openExternal(SETTINGS_PANE);
  }

  // One screenshot of the display Pilot is on: {mime, data, thumb} or
  // {needPermission: true} or {error}.
  async function capture(near, hideOwn) {
    if (status() !== "granted") return { needPermission: true };
    const point = near || screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const scale = display.scaleFactor || 1;
    let w = Math.round(display.size.width * scale);
    let h = Math.round(display.size.height * scale);
    const shrink = Math.min(1, LONGEST_EDGE / Math.max(w, h));
    w = Math.round(w * shrink);
    h = Math.round(h * shrink);
    const restore = typeof hideOwn === "function" ? hideOwn() : null;
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: w, height: h } });
      const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
      if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
        return { error: "macOS didn't let Pilot see the screen. Check Screen Recording in System Settings." };
      }
      const img = source.thumbnail;
      const data = img.toJPEG(82).toString("base64");
      const thumb = `data:image/jpeg;base64,${img.resize({ width: 280 }).toJPEG(70).toString("base64")}`;
      return { mime: "image/jpeg", data, thumb };
    } catch (_) {
      return { error: "The screenshot didn't work. Try again." };
    } finally {
      if (typeof restore === "function") restore();
    }
  }

  return { status, openSettings, capture, SETTINGS_PANE };
}

module.exports = { make, SETTINGS_PANE };
