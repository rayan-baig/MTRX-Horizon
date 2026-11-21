// Pilot for Mac · links.js: web addresses in chat messages become links
// (both ways: yours and Pilot's), and the composer's "Read this link".
// Only https, http and mailto become links; nothing here sets HTML (text
// nodes and <a> elements only), and a click asks the app, which confirms
// and opens the user's browser.
(function (root) {
  "use strict";

  const URL_RE = /\b(?:https?:\/\/[^\s<>"'`]+|mailto:[^\s<>"'`]+@[^\s<>"'`]+)/gi;
  const TRAIL = /[.,;:!?)\]}'"]+$/;

  function safeLink(raw) {
    let url;
    try { url = new URL(String(raw || "")); } catch (_) { return null; }
    if (url.protocol === "mailto:") return url.href;
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) return null;
    return url.href;
  }

  // The http(s) and mailto addresses in some text, in order: [{start, end, href}].
  function find(text) {
    const out = [];
    const s = String(text || "");
    URL_RE.lastIndex = 0;
    let m;
    while ((m = URL_RE.exec(s))) {
      let raw = m[0];
      const trail = TRAIL.exec(raw);
      if (trail && !(trail[0].startsWith(")") && raw.includes("("))) raw = raw.slice(0, raw.length - trail[0].length);
      const href = safeLink(raw);
      if (href) out.push({ start: m.index, end: m.index + raw.length, href, text: raw });
    }
    return out;
  }
  // Just the web ones (for "Read this link").
  const webLinks = (text) => find(text).filter((l) => /^https?:/i.test(l.href)).map((l) => l.href);

  // Turn addresses in a node's text into links (not inside links or code).
  function linkify(node, doc) {
    const d = doc || node.ownerDocument;
    const walker = d.createTreeWalker(node, 4 /* text */);
    const texts = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (t.parentElement && t.parentElement.closest("a, code, pre")) continue;
      if (find(t.nodeValue).length) texts.push(t);
    }
    for (const t of texts) {
      const frag = d.createDocumentFragment();
      const s = t.nodeValue;
      let at = 0;
      for (const l of find(s)) {
        if (l.start > at) frag.appendChild(d.createTextNode(s.slice(at, l.start)));
        const a = d.createElement("a");
        a.setAttribute("href", l.href);
        a.setAttribute("rel", "noopener noreferrer");
        a.textContent = l.text;
        frag.appendChild(a);
        at = l.end;
      }
      if (at < s.length) frag.appendChild(d.createTextNode(s.slice(at)));
      t.parentNode.replaceChild(frag, t);
    }
    return node;
  }

  const api = { safeLink, find, webLinks, linkify };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PilotLinks = api;
})(typeof window !== "undefined" ? window : globalThis);
