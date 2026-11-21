// Pilot for Mac comes as two editions, built from this one codebase:
//
//   "Pilot"       (edition "pilot", the customers' edition): the user's own
//                 AI keys (every provider, image and video keys) and Free
//                 mode (AI that runs on the Mac) as an option.
//   "Pilot Free"  (edition "free", the owner's edition): Free mode only. No
//                 API key settings, no key slots, no provider list.
//
// The edition is picked at build time: electron-builder.config.js reads
// PILOT_EDITION and writes "pilotEdition" into the packaged package.json
// (extraMetadata). A packaged app always uses what it was built as; only a
// development run (npm start) reads PILOT_EDITION directly.
//
// The two have different app names, bundle ids, settings folders and
// Keychain items, so both can be installed side by side:
//   settings   ~/Library/Application Support/<app name>/settings.json
//   Keychain   "<app name> Safe Storage" (Electron's safeStorage names its
//              Keychain item after the app; Pilot Free never saves a key, so
//              it never creates one).
"use strict";

const EDITIONS = {
  pilot: {
    id: "pilot",
    appName: "Pilot",
    appId: "com.mtrxhorizyn.pilot",
    artifact: "Pilot",
    keys: true, // API keys, the provider list, image and video key slots
    subtitle: "Your AI copilot. Powered by you.",
  },
  free: {
    id: "free",
    appName: "Pilot Free",
    appId: "com.mtrxhorizyn.pilot.free",
    artifact: "Pilot-Free",
    keys: false,
    subtitle: "Free · runs on your Mac",
  },
};

const clean = (v) => (Object.prototype.hasOwnProperty.call(EDITIONS, String(v || "")) ? String(v) : "");

// The edition this run is: a packaged app only trusts what it was built as.
function resolve(o) {
  const opts = o || {};
  const pkg = opts.pkg || {};
  const built = clean(pkg.pilotEdition);
  const id = opts.packaged ? built || "pilot" : clean(opts.env && opts.env.PILOT_EDITION) || built || "pilot";
  return EDITIONS[id];
}

const keychainService = (ed) => `${ed.appName} Safe Storage`;

// Apple Silicon: Free mode is the default there when no key is saved.
function appleSilicon(o) {
  const opts = o || {};
  if (opts.platform !== "darwin") return false;
  if (opts.arch === "arm64") return true;
  // An Intel build running under Rosetta still reports the chip's name.
  return /apple/i.test(String(opts.cpuModel || ""));
}

// Where the AI runs: "free" (on this Mac) or "key" (the user's own key).
// Pilot Free is always free. In Pilot the user's pick wins; with no pick,
// Free mode is the default when no key is saved and the Mac is Apple Silicon.
function source(o) {
  const opts = o || {};
  if (!opts.edition || !opts.edition.keys) return "free";
  if (opts.saved === "free" || opts.saved === "key") return opts.saved;
  if (opts.hasKeys) return "key";
  return appleSilicon(opts) ? "free" : "key";
}

// Which settings sections the chat window shows, in order.
function sections(edition, src) {
  if (!edition.keys) return ["free", "screen", "memory", "notes", "voice", "general"];
  return ["source", ...(src === "free" ? ["free"] : ["keys", "media"]), "screen", "memory", "notes", "voice", "general"];
}

module.exports = { EDITIONS, resolve, keychainService, appleSilicon, source, sections };
