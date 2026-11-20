// Videos sent with Google Gemini's own file upload (a resumable upload), a
// piece at a time as the window reads them from the file, so a big video is
// never held in memory whole. The finished file is referred to in the
// message by its address. Only to Gemini's own API address, with the user's
// own key; never to an MTRX server.
"use strict";

const BASE = "https://generativelanguage.googleapis.com";

function fail(message) { return Object.assign(new Error(message), { kind: "upload" }); }

// Starts an upload: returns the address the pieces go to.
async function start(fetch, key, meta) {
  const res = await fetch(`${BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(meta.size),
      "X-Goog-Upload-Header-Content-Type": meta.mime,
      "content-type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: String(meta.name || "Pilot video").slice(0, 120) } }),
  });
  const url = res.ok && res.headers.get("x-goog-upload-url");
  if (!url || !url.startsWith(`${BASE}/`)) throw fail("Google Gemini didn't accept the video upload. Check your key, or try a shorter video.");
  return url;
}

// Sends one piece. On the last piece it returns the file Gemini made.
async function piece(fetch, key, url, offset, bytes, last) {
  if (!String(url).startsWith(`${BASE}/`)) throw fail("That upload address isn't Gemini's.");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "X-Goog-Upload-Command": last ? "upload, finalize" : "upload",
      "X-Goog-Upload-Offset": String(offset),
      "content-type": "application/octet-stream",
    },
    body: bytes,
  });
  if (!res.ok) throw fail(`The video upload stopped (error ${res.status}). Try again.`);
  if (!last) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.file || !data.file.uri) throw fail("Google Gemini didn't finish the video upload. Try again.");
  return data.file;
}

// Waits until Gemini has processed the video and it can be used.
async function ready(fetch, key, file, opts) {
  const o = opts || {};
  const wait = o.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let f = file;
  for (let i = 0; i < (o.tries || 90); i += 1) {
    if (!f.state || f.state === "ACTIVE") return f;
    if (f.state === "FAILED") throw fail("Google Gemini couldn't read that video.");
    await wait(o.every || 2000);
    const res = await fetch(`${BASE}/v1beta/${f.name}`, { headers: { "x-goog-api-key": key } });
    if (res.ok) f = await res.json();
  }
  throw fail("Google Gemini is taking a long time with that video. Try a shorter one.");
}

module.exports = { BASE, start, piece, ready };
