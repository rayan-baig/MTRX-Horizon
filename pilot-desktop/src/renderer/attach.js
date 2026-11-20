// Pictures and videos dropped, pasted or picked into Pilot (the chat window
// and the robot both use this). Nothing is ever refused for being big:
//
// - Pictures (PNG, JPEG, HEIC, WebP, GIF) are shrunk and compressed here,
//   on a canvas, until each fits the chosen provider's limits (LIMITS below:
//   per provider, no model names). HEIC, which Chromium can't draw, is
//   turned into a JPEG by macOS first (the main process does that).
// - Videos go to the provider's own file upload when it has one (Google
//   Gemini: a resumable upload, sent a piece at a time with a progress bar).
//   Otherwise evenly spaced frames are taken here, with a hidden video
//   element and a canvas, and sent as pictures, and the chat says so.
// - A big file is never read into memory whole: a video plays from the
//   file on disk, and an upload reads one piece at a time.
//
// Files go only to the user's own AI provider, never to an MTRX server.
"use strict";

(function (root) {
  // What each provider takes in one message, kept a little under its
  // published limits. bytes: the most for one picture; edge: the longest
  // side worth sending; count: pictures in one message; upload: a video file
  // upload exists.
  const LIMITS = {
    anthropic: { bytes: 3.6e6, edge: 1568, count: 20, upload: false },
    openai: { bytes: 8e6, edge: 2048, count: 10, upload: false },
    gemini: { bytes: 3e6, edge: 3072, count: 16, upload: true },
    compatible: { bytes: 3e6, edge: 2048, count: 8, upload: false },
  };
  const FRAMES_MOST = 24;
  const CHUNK = 8 * 1024 * 1024; // upload pieces: 8 MB (a multiple of 256 KB)

  const IMAGE = /^image\/(png|jpe?g|webp|gif|heic|heif)$/i;
  const IMAGE_EXT = /\.(png|jpe?g|webp|gif|heic|heif)$/i;
  const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i;

  function limitsFor(provider) { return LIMITS[provider] || LIMITS.compatible; }

  // "image", "video" or null.
  function kindOf(file) {
    const type = String((file && file.type) || "");
    const name = String((file && file.name) || "");
    if (IMAGE.test(type) || IMAGE_EXT.test(name)) return "image";
    if (/^video\//i.test(type) || VIDEO_EXT.test(name)) return "video";
    return null;
  }

  const isHeic = (file) => /heic|heif/i.test(String(file.type || "")) || /\.(heic|heif)$/i.test(String(file.name || ""));

  function sizeWords(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }

  function durationWords(seconds) {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s}-second`;
    const m = Math.round(s / 60);
    return `${m}-minute`;
  }

  // Width and height with the longest side at most edge.
  function fitSize(width, height, edge) {
    const k = Math.min(1, edge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
  }

  // Shrinks a picture until it fits: first the longest side, then lower
  // JPEG quality, then smaller again, until it is under the provider's size.
  // encode(width, height, quality) → Promise<{size}> (a Blob in the app).
  async function shrinkToFit(source, limits, encode) {
    let { width, height } = fitSize(source.width, source.height, limits.edge);
    let quality = 0.86;
    for (let i = 0; i < 16; i += 1) {
      const blob = await encode(width, height, quality);
      if (blob.size <= limits.bytes) return { blob, width, height, quality };
      if (quality > 0.62) quality = Math.round((quality - 0.12) * 100) / 100;
      else { width = Math.max(1, Math.round(width * 0.8)); height = Math.max(1, Math.round(height * 0.8)); }
    }
    const blob = await encode(width, height, 0.5);
    return { blob, width, height, quality: 0.5 };
  }

  // Evenly spaced moments in a video (the middle of each equal part).
  function frameTimes(duration, count) {
    const n = Math.max(1, Math.floor(count));
    if (!(duration > 0)) return [0];
    return Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * duration / n) * 1000) / 1000);
  }

  // How many frames: about one every five seconds, 4 to 24, and no more
  // than the provider takes in one message.
  function frameCount(duration, limits) {
    return Math.max(1, Math.min(FRAMES_MOST, limits.count, Math.max(4, Math.ceil((duration || 0) / 5))));
  }

  function framesNote(count, duration) {
    return `I looked at ${count} frame${count === 1 ? "" : "s"} from your ${durationWords(duration)} video.`;
  }

  // Sends a file a piece at a time: file.slice() is read only for the piece
  // being sent, so even a huge video never sits in memory whole.
  // send(offset, bytes, last) → Promise; onProgress(sent, total).
  async function upload(file, send, opts) {
    const o = opts || {};
    const size = file.size;
    const chunk = o.chunk || CHUNK;
    let offset = 0;
    if (size === 0) { await send(0, new Uint8Array(0), true); return 0; }
    while (offset < size) {
      if (o.signal && o.signal.aborted) throw new Error("stopped");
      const end = Math.min(size, offset + chunk);
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      await send(offset, bytes, end >= size);
      offset = end;
      if (o.onProgress) o.onProgress(offset, size);
    }
    return offset;
  }

  // ------------------------------------------------------------ in the app (canvas, video)

  function canvasOf(doc, width, height) {
    const c = doc.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  }

  const toBlob = (canvas, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality);
  });

  const base64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(blob);
  });

  async function thumbOf(doc, drawable, width, height) {
    const t = fitSize(width, height, 240);
    const c = canvasOf(doc, t.width, t.height);
    c.getContext("2d").drawImage(drawable, 0, 0, t.width, t.height);
    return c.toDataURL("image/jpeg", 0.7);
  }

  async function loadImage(doc, src) {
    const img = doc.createElement("img");
    img.decoding = "async";
    img.src = src;
    await img.decode();
    return img;
  }

  // A picture file → {kind: "image", mime, data, thumb, name, size, width, height}.
  // deps.heic(arrayBuffer) → Promise<{mime, data}> (macOS converts HEIC).
  async function prepareImage(file, limits, deps) {
    const doc = (deps && deps.doc) || root.document;
    let drawable;
    let width;
    let height;
    if (isHeic(file)) {
      const out = await deps.heic(await file.arrayBuffer());
      if (!out || out.error) throw new Error((out && out.error) || "This HEIC picture couldn't be opened.");
      drawable = await loadImage(doc, `data:${out.mime};base64,${out.data}`);
      width = drawable.naturalWidth; height = drawable.naturalHeight;
    } else {
      drawable = await root.createImageBitmap(file);
      width = drawable.width; height = drawable.height;
    }
    const fit = await shrinkToFit({ width, height }, limits, async (w, h, q) => {
      const c = canvasOf(doc, w, h);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff"; // transparent parts become white, not black
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(drawable, 0, 0, w, h);
      return toBlob(c, q);
    });
    const thumb = await thumbOf(doc, drawable, width, height);
    if (drawable.close) drawable.close();
    return { kind: "image", mime: "image/jpeg", data: await base64(fit.blob), thumb, name: file.name || "Picture", size: file.size, width: fit.width, height: fit.height };
  }

  function seek(video, t) {
    return new Promise((resolve, reject) => {
      const done = () => { video.removeEventListener("seeked", done); video.removeEventListener("error", fail); resolve(); };
      const fail = () => { video.removeEventListener("seeked", done); reject(new Error("seek")); };
      video.addEventListener("seeked", done);
      video.addEventListener("error", fail);
      video.currentTime = t;
    });
  }

  // Opens a video from the file on disk (a blob: address; never read whole).
  async function openVideo(file, doc) {
    const video = doc.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("This video can't be opened here. Try an MP4, MOV or WebM file."));
    });
    return { video, close: () => { video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); } };
  }

  // Evenly spaced frames from a video → {kind: "frames", images, duration, note, thumb, name, size}.
  async function videoFrames(file, limits, deps) {
    const doc = (deps && deps.doc) || root.document;
    const { video, close } = await openVideo(file, doc);
    try {
      const duration = video.duration;
      const times = frameTimes(duration, frameCount(duration, limits));
      const size = fitSize(video.videoWidth || 1280, video.videoHeight || 720, Math.min(1024, limits.edge));
      const images = [];
      let thumb = "";
      for (let i = 0; i < times.length; i += 1) {
        await seek(video, times[i]);
        const c = canvasOf(doc, size.width, size.height);
        c.getContext("2d").drawImage(video, 0, 0, size.width, size.height);
        const fit = await shrinkToFit(size, { ...limits, bytes: Math.min(limits.bytes, 600 * 1024) }, async (w, h, q) => {
          if (w === size.width && h === size.height) return toBlob(c, q);
          const d = canvasOf(doc, w, h);
          d.getContext("2d").drawImage(c, 0, 0, w, h);
          return toBlob(d, q);
        });
        images.push({ mime: "image/jpeg", data: await base64(fit.blob), at: times[i] });
        if (!thumb) thumb = c.toDataURL("image/jpeg", 0.6);
        if (deps && deps.onProgress) deps.onProgress(i + 1, times.length);
      }
      return { kind: "frames", images, duration, note: framesNote(images.length, duration), thumb, name: file.name || "Video", size: file.size };
    } finally { close(); }
  }

  // A small picture of a video's first moments, for the message before sending.
  async function videoThumb(file, deps) {
    const doc = (deps && deps.doc) || root.document;
    try {
      const { video, close } = await openVideo(file, doc);
      try {
        await seek(video, Math.min(1, (video.duration || 2) / 2));
        const t = fitSize(video.videoWidth || 320, video.videoHeight || 180, 240);
        const c = canvasOf(doc, t.width, t.height);
        c.getContext("2d").drawImage(video, 0, 0, t.width, t.height);
        return { thumb: c.toDataURL("image/jpeg", 0.6), duration: video.duration };
      } finally { close(); }
    } catch (_) { return { thumb: "", duration: 0 }; }
  }

  // Takes dropped, pasted or picked files: shrinks pictures, uploads or
  // samples videos, and hands each to the app (bridge: window.pilot.attach).
  // hooks.update(list) shows what's still being prepared:
  // [{key, name, size, kind, progress, thumb}]; hooks.error(words).
  async function takeFiles(files, bridge, hooks) {
    const h = hooks || {};
    const working = [];
    const show = () => { if (h.update) h.update(working.slice()); };
    const info = (await bridge.info()) || {};
    const limits = limitsFor(info.provider);
    let n = 0;
    for (const file of Array.from(files || [])) {
      const kind = kindOf(file);
      if (!kind) { if (h.error) h.error(`Pilot takes pictures and videos. “${file.name}” is neither.`); continue; }
      const job = { key: `w${Date.now()}-${(n += 1)}`, name: file.name || (kind === "image" ? "Picture" : "Video"), size: file.size, kind, progress: 0, thumb: "" };
      working.push(job);
      show();
      try {
        if (kind === "image") {
          const out = await prepareImage(file, limits, { heic: bridge.heic });
          const res = await bridge.add(out);
          if (res && res.error) throw new Error(res.error);
        } else if (info.upload) {
          const t = await videoThumb(file);
          job.thumb = t.thumb;
          show();
          const started = await bridge.uploadStart({ name: job.name, size: file.size, mime: file.type || "video/mp4", thumb: t.thumb });
          if (!started || started.error) throw new Error((started && started.error) || "The upload didn't start.");
          working.splice(working.indexOf(job), 1); // the app shows its progress from here
          show();
          await upload(file, async (offset, bytes, last) => {
            const r = await bridge.uploadPiece(started.id, offset, bytes, last);
            if (r && r.error) throw new Error(r.error);
          });
          continue;
        } else {
          const out = await videoFrames(file, limits, { onProgress: (i, total) => { job.progress = i / total; show(); } });
          const res = await bridge.add(out);
          if (res && res.error) throw new Error(res.error);
        }
      } catch (e) {
        if (h.error) h.error(`${job.name}: ${(e && e.message) || "couldn't be read."}`);
      }
      const i = working.indexOf(job);
      if (i >= 0) working.splice(i, 1);
      show();
    }
  }

  const api = { takeFiles, LIMITS, FRAMES_MOST, CHUNK, limitsFor, kindOf, isHeic, sizeWords, durationWords, fitSize, shrinkToFit, frameTimes,
    frameCount, framesNote, upload, prepareImage, videoFrames, videoThumb };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PilotAttach = api;
})(typeof window !== "undefined" ? window : globalThis);
