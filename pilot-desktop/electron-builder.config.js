// How the Mac app is packaged: one universal .dmg (Apple Silicon and Intel)
// with the usual "drag Pilot to Applications" window.
//
// Signing and notarisation switch on by themselves once the repository has
// these secrets: CSC_LINK and CSC_KEY_PASSWORD (the Developer ID
// certificate), and APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID
// (for Apple's notary service). Until then the app is ad-hoc signed, which
// macOS needs to run it at all on Apple Silicon; people open it once with
// "Open Anyway" (see INSTALL.md).
"use strict";

const signed = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD);
const notarize = signed && ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"].every((k) => Boolean(process.env[k]));

module.exports = {
  appId: "com.mtrxhorizyn.pilot",
  productName: "Pilot",
  copyright: "MTRX Horizyn",
  directories: { output: "dist", buildResources: "build" },
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
      NSScreenCaptureUsageDescription: "Pilot looks at your screen only when you ask, and sends the picture only to your own AI provider.",
    },
  },
  dmg: {
    title: "Pilot",
    icon: "build/icon.icns",
    background: "build/background.png",
    window: { width: 540, height: 380 },
    contents: [
      { x: 140, y: 200, type: "file" },
      { x: 400, y: 200, type: "link", path: "/Applications" },
    ],
  },
  artifactName: "Pilot-${version}-mac.${ext}",
  publish: null,
};
