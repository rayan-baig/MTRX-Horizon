// Copy and paste in the chat (Pilot for Mac 1.3), and links.
//
// - Pasting a picture: a screenshot sent to the clipboard (Cmd+Ctrl+Shift+3
//   or 4), or a picture copied in a browser, Preview or Messages, attaches
//   straight away. The window gets the picture's bytes from memory: nothing
//   is written to disk. A picture or video copied in Finder attaches too
//   (read from where it already is).
// - Links: only https, http and mailto ever open, in the default browser,
//   after a small "Open this link?" that shows the address. Never inside
//   Pilot.
// - Right-click: Copy text, Copy link, Copy image, Save image, and the usual
//   Cut, Copy, Paste and Select All in the message box.
"use strict";

const path = require("node:path");

const IMAGE_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic",
  ".heif": "image/heif", ".tif": "image/tiff", ".tiff": "image/tiff", ".bmp": "image/bmp" };
const VIDEO_EXT = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v", ".webm": "video/webm", ".mkv": "video/x-matroska" };
const FILE_MOST = 200 * 1024 * 1024; // a copied Finder file, at most

// What's on the clipboard to attach, without writing anything anywhere.
// deps: {clipboard, fs}. Returns [{name, mime, data (base64)}] (may be empty)
// or {error}.
function readClipboard(deps) {
  const { clipboard, fs } = deps;
  const out = [];
  // Files copied in Finder (macOS puts their file:// addresses on the clipboard).
  let urls = [];
  try {
    const formats = clipboard.availableFormats ? clipboard.availableFormats() : [];
    if (formats.some((f) => /file-url|uri-list/.test(f))) {
      const raw = clipboard.read("public.file-url") || clipboard.read("text/uri-list") || "";
      urls = String(raw).split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith("file://"));
    }
  } catch (_) { urls = []; }
  for (const u of urls.slice(0, 8)) {
    let file;
    try { file = decodeURIComponent(new URL(u).pathname); } catch (_) { continue; }
    const ext = path.extname(file).toLowerCase();
    const mime = IMAGE_EXT[ext] || VIDEO_EXT[ext];
    if (!mime) continue;
    let st;
    try { st = fs.statSync(file); } catch (_) { continue; }
    if (!st.isFile()) continue;
    if (st.size > FILE_MOST) return { error: `${path.basename(file)} is too big to paste. Drag it onto the chat instead.` };
    out.push({ name: path.basename(file), mime, data: fs.readFileSync(file).toString("base64") });
  }
  if (out.length) return out;
  // A picture (a screenshot, or copied from a browser or Preview): straight from memory.
  const img = clipboard.readImage ? clipboard.readImage() : null;
  if (img && !img.isEmpty()) out.push({ name: "Pasted picture.png", mime: "image/png", data: img.toPNG().toString("base64") });
  return out;
}

// Only these open, and only in the user's browser.
function safeLink(raw) {
  let url;
  try { url = new URL(String(raw || "").trim()); } catch (_) { return null; }
  if (url.protocol === "mailto:") return /^mailto:[^\s<>"']+@[^\s<>"']+$/i.test(url.href) ? url.href : null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.href;
}

// "Open this link?", showing the address; then the default browser.
// deps: {confirm(url) → Promise<boolean>, openExternal(url)}.
async function openLink(raw, deps) {
  const url = safeLink(raw);
  if (!url) return { opened: false, reason: "unsafe" };
  if (!(await deps.confirm(url))) return { opened: false, reason: "cancelled" };
  await deps.openExternal(url);
  return { opened: true, url };
}

const shortUrl = (u) => (u.length > 300 ? `${u.slice(0, 299)}…` : u);
const confirmOptions = (url) => ({ type: "question", buttons: ["Open", "Cancel"], defaultId: 0, cancelId: 1, message: "Open this link?",
  detail: `${shortUrl(url)}\n\nIt opens in your web browser.`, noLink: true });

// A picture from a data: address (a picture in the chat), as bytes.
function dataUrlImage(src) {
  const m = /^data:(image\/(png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(src || ""));
  return m ? { mime: m[1], data: m[3] } : null;
}

// Copy a picture to the clipboard as a picture. deps: {clipboard, nativeImage}.
function copyImage(img, deps) {
  if (!img || !img.data) return false;
  const ni = deps.nativeImage.createFromBuffer(Buffer.from(img.data, "base64"));
  if (!ni || ni.isEmpty()) return false;
  deps.clipboard.writeImage(ni);
  return true;
}

// The right-click menu for what's under the pointer. info: {editable,
// selection, text (the whole message), link, image: true}. act: {copyText,
// openLink, copyImage, saveImage}.
function menuTemplate(info, act) {
  const i = info || {};
  const items = [];
  if (i.editable) {
    items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" });
    return items;
  }
  if (i.selection) items.push({ label: "Copy", click: () => act.copyText(i.selection) });
  if (i.text) items.push({ label: "Copy Text", click: () => act.copyText(i.text) });
  if (i.link && safeLink(i.link)) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: "Open Link…", click: () => act.openLink(i.link) }, { label: "Copy Link", click: () => act.copyText(safeLink(i.link)) });
  }
  if (i.image) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: "Copy Image", click: () => act.copyImage() }, { label: "Save Image…", click: () => act.saveImage() });
  }
  if (!items.length) items.push({ role: "selectAll" });
  return items;
}

module.exports = { IMAGE_EXT, VIDEO_EXT, FILE_MOST, readClipboard, safeLink, openLink, confirmOptions, dataUrlImage, copyImage, menuTemplate };
