"""A tiny web service on this computer only, for the browser extension.

It listens on 127.0.0.1, so nothing outside the computer can reach it. A web
page in the browser could still try to, so every request must also:
- come from a browser extension (its Origin is chrome-extension:// or
  moz-extension://; a web page can't pretend to be one), or have no Origin at
  all (a script run by the person), and
- carry the pairing code (policy.token()), which only this user can read.

The extension sends only addresses (the links on a page, the page's own
address and whether it has a password box) and, for webmail and chat pages,
the sender and text of the message open on screen. None of it is stored.
"""

import hmac
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__, policy as policy_mod, urls
from .engine import Message, check_link
from .signals import Signal, level

LOG = logging.getLogger("omnicyte")
MAX_BODY = 512 * 1024
MAX_LINKS = 300
EXTENSION_ORIGINS = ("chrome-extension://", "moz-extension://", "safari-web-extension://", "extension://")


def make_handler(guardian, pairing_token: str):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Omnicyte"
        sys_version = ""

        def log_message(self, *args):  # never log what was asked about
            pass

        def _send(self, status: int, body: dict):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            origin = self.headers.get("Origin", "")
            if origin.startswith(EXTENSION_ORIGINS):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(data)

        def _allowed(self) -> bool:
            origin = self.headers.get("Origin")
            if origin is not None and not origin.startswith(EXTENSION_ORIGINS):
                return False
            given = self.headers.get("X-Omnicyte-Token", "")
            return hmac.compare_digest(given.encode(), pairing_token.encode())

        def do_OPTIONS(self):
            origin = self.headers.get("Origin", "")
            if not origin.startswith(EXTENSION_ORIGINS):
                self.send_response(403)
                self.end_headers()
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Omnicyte-Token")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Vary", "Origin")
            self.end_headers()

        def do_GET(self):
            if self.path != "/v1/status":
                return self._send(404, {"error": "not found"})
            if not self._allowed():
                return self._send(403, {"error": "not paired"})
            return self._send(200, {"ok": True, "version": __version__, "paused": guardian.paused,
                                    "org": guardian.policy.org_name})

        def do_POST(self):
            if not self._allowed():
                return self._send(403, {"error": "not paired"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if length < 0 or length > MAX_BODY:
                return self._send(413, {"error": "too big"})
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
                if not isinstance(body, dict):
                    raise ValueError
            except ValueError:
                return self._send(400, {"error": "send JSON"})
            if self.path == "/v1/links":
                return self._send(200, links(guardian, body))
            if self.path == "/v1/page":
                return self._send(200, page(guardian, body))
            if self.path == "/v1/message":
                return self._send(200, message(guardian, body))
            if self.path == "/v1/show":
                # Omnicyte was opened again while already running.
                guardian.notices.put("I'm already here! Right-click me for options.")
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "not found"})

    return Handler


def _s(v, n=2000) -> str:
    return v[:n] if isinstance(v, str) else ""


def links(guardian, body: dict) -> dict:
    """Judge the links on a page. Bad ones on a mail or chat page alert the buddy."""
    items = body.get("links") if isinstance(body.get("links"), list) else []
    site = _s(body.get("site"), 200)
    kind = body.get("kind") if body.get("kind") in ("mail", "chat") else "browser"
    out = {}
    for item in items[:MAX_LINKS]:
        if not isinstance(item, dict):
            continue
        href, shown = _s(item.get("href")), _s(item.get("text"), 200)
        if not href or href in out:
            continue
        v = check_link(href, shown, guardian.policy)
        out[href] = v.to_dict()
        if v.level == "danger" and kind in ("mail", "chat"):
            guardian.see(Message(source=kind, links=[(href, shown)], where=site))
    return {"links": out}


def page(guardian, body: dict) -> dict:
    """Judge the page the person is on, more strictly if it asks for a password."""
    url = _s(body.get("url"))
    v = check_link(url, "", guardian.policy)
    host = urls.host_of(v.destination)
    signals = list(v.signals)
    if body.get("password_field") and v.level != "safe":
        signals.append(Signal("page-password", "This page asks for your password", host, 30))
    score = sum(s.weight for s in signals)
    result = {"url": url, "level": level(score), "score": score, "signals": [s.to_dict() for s in signals]}
    if result["level"] == "danger":
        guardian.see(Message(source="browser", links=[(url, "")], where=host,
                             text="(password box on page)" if body.get("password_field") else ""))
    return result


def message(guardian, body: dict) -> dict:
    """A message open in webmail or a chat app, read from the page by the extension."""
    links_in = [(_s(i.get("href")), _s(i.get("text"), 200)) for i in body.get("links", [])[:MAX_LINKS]
                if isinstance(i, dict)] if isinstance(body.get("links"), list) else []
    msg = Message(source="mail" if body.get("kind") == "mail" else "chat",
                  sender_name=_s(body.get("sender_name"), 200), sender_address=_s(body.get("sender_address"), 200),
                  subject=_s(body.get("subject"), 500), text=_s(body.get("text"), 20000), links=links_in,
                  attachments=[_s(a, 200) for a in body.get("attachments", [])[:20]]
                  if isinstance(body.get("attachments"), list) else [],
                  where=_s(body.get("site"), 200))
    return guardian.see(msg).to_dict()


def serve(guardian, port: int = policy_mod.PORT) -> ThreadingHTTPServer:
    """Start listening in the background. Returns the server (call .shutdown() to stop)."""
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(guardian, policy_mod.token()))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True, name="omnicyte api").start()
    return httpd
