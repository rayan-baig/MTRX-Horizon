// How the Mac app is packaged: one universal .dmg (Apple Silicon and Intel)
// with the usual "drag Pilot to Applications" window.
//
// Two editions come from this one config (src/main/edition.js):
//   PILOT_EDITION=pilot (or unset)  "Pilot", com.mtrxhorizyn.pilot,
//                                   Pilot-X.Y.Z-mac.dmg: own keys + Free mode
//   PILOT_EDITION=free              "Pilot Free", com.mtrxhorizyn.pilot.free,
//                                   Pilot-Free-X.Y.Z-mac.dmg: Free mode only
// The edition is written into the packaged package.json ("pilotEdition"),
// so the built app always knows what it is. Different names and bundle ids
// mean the two install side by side, each with its own settings folder and
// Keychain item.
//
// Signing and notarisation switch on by themselves once the repository has
// these secrets: CSC_LINK and CSC_KEY_PASSWORD (the Developer ID
// certificate), and APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID
// (for Apple's notary service). Until then the app is ad-hoc signed, which
// macOS needs to run it at all on Apple Silicon; people open it once with
// "Open Anyway" (see INSTALL.md).
"use strict";

const editions = require("./src/main/edition");

const ED = editions.EDITIONS[process.env.PILOT_EDITION === "free" ? "free" : "pilot"];
const signed = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD);
const notarize = signed && ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"].every((k) => Boolean(process.env[k]));

module.exports = {
  appId: ED.appId,
  productName: ED.appName,
  extraMetadata: { productName: ED.appName, pilotEdition: ED.id },
  copyright: "MTRX Horizyn",
  directories: { output: ED.id === "free" ? "dist-free" : "dist", buildResources: "build" },
  files: ["src/**/*", "assets/**/*", "package.json"],
  asar: true,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  mac: {
    target: [{ target: "dmg", arch: ["universal"] }],
    category: "public.app-category.productivity",
    icon: "build/icon.icns",
    identity: signed ? undefined : "-",
    hardenedRuntime: signed,
    gatekeeperAssess: false,
    notarize,
    entitlements: signed ? "build/entitlements.mac.plist" : undefined,
    entitlementsInherit: signed ? "build/entitlements.mac.plist" : undefined,
    minimumSystemVersion: "12.0",
    extendInfo: {
      LSUIElement: true, // a menu-bar app: no Dock icon
      NSScreenCaptureUsageDescription: ED.keys
        ? "Pilot looks at your screen only when you ask, and sends the picture only to your own AI provider (or keeps it on your Mac in Free mode)."
        : "Pilot Free looks at your screen only when you ask, and the picture stays on your Mac.",
    },
  },
  dmg: {
    title: ED.appName,
    format: "ULFO", // lzfse: a smaller download, for macOS 10.11 and newer
    icon: "build/icon.icns",
    background: "build/background.png",
    window: { width: 540, height: 380 },
    contents: [
      { x: 140, y: 200, type: "file" },
      { x: 400, y: 200, type: "link", path: "/Applications" },
    ],
  },
  artifactName: `${ED.artifact}-\${version}-mac.\${ext}`,
  publish: null,
};
