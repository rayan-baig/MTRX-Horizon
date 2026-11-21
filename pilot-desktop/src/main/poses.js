// The robot's pose pictures: every <pose>.webp or .png in assets/poses/
// whose name is one of pilot-motion.js's poses or the Mac's extra ones
// (roam.js's EXTRA: catch, baseball, surf, umbrella and the rest of the
// owner's 1.3 pose sheet). Adding a pose is just adding its picture there; a
// pose without one falls back (FALLBACK in pilot-motion.js, EXTRA in
// roam.js) and in the end to the resting design robot.
"use strict";

const fs = require("node:fs");
const roam = require("../core/roam");

// {pose: address the robot window loads it from}
function list(dir, base) {
  let files = [];
  try { files = fs.readdirSync(dir); } catch (_) { return {}; }
  const found = roam.posesFromFiles(files);
  const out = {};
  for (const [name, file] of Object.entries(found)) out[name] = `${base || "../../assets/poses/"}${file}`;
  return out;
}

module.exports = { list };
