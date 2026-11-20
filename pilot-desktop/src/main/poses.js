// The robot's pose pictures: every <pose>.webp or .png in assets/poses/
// whose name is one of pilot-motion.js's poses (standing, sitting, wave,
// walk1, walk2, run1, run2, fly, climb1, climb2, flip). Adding a pose is just
// adding its picture there; a pose without one falls back (see FALLBACK in
// pilot-motion.js) and in the end to the resting design robot.
"use strict";

const fs = require("node:fs");
const motion = require("../core/pilot-motion");

// {pose: address the robot window loads it from}
function list(dir, base) {
  let files = [];
  try { files = fs.readdirSync(dir); } catch (_) { return {}; }
  const found = motion.posesFromFiles(files);
  const out = {};
  for (const [name, file] of Object.entries(found)) out[name] = `${base || "../../assets/poses/"}${file}`;
  return out;
}

module.exports = { list };
