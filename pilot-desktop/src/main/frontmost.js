// macOS only: the front app and the on-screen windows' places and owners,
// to tell when a video, game or presentation fills the screen, and which
// app to give focus back to when the chat closes. Window places
// and owners need no permission (only window titles would, and they aren't
// asked for). It runs only just before the robot would move, at most every
// half minute, never in the background.
"use strict";

const SCRIPT = `
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
function run() {
  var front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  var pid = front ? front.processIdentifier : -1;
  var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
  var out = [];
  for (var i = 0; i < list.length && out.length < 60; i++) {
    var w = list[i], b = w.kCGWindowBounds || {};
    out.push({ pid: w.kCGWindowOwnerPID, layer: w.kCGWindowLayer, x: b.X, y: b.Y, w: b.Width, h: b.Height });
  }
  return JSON.stringify({ pid: pid, windows: out });
}`;

// execFile: node's child_process.execFile. Resolves the parsed info, or null.
function read(execFile, platform) {
  if (platform !== "darwin" || typeof execFile !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", SCRIPT], { timeout: 1500, maxBuffer: 256 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(String(stdout).trim())); } catch (_) { resolve(null); }
    });
  });
}

// Brings an app back to the front by its process id (when Pilot's chat
// closes, the app the user was in gets focus back).
function activate(execFile, pid) {
  if (process.platform !== "darwin" || !Number.isInteger(pid) || pid <= 0) return;
  const script = `ObjC.import('AppKit'); var a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); if (a) a.activateWithOptions(0);`;
  execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeout: 1500 }, () => {});
}

module.exports = { read, activate, SCRIPT };
