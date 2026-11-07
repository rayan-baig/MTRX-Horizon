"""Reading email: turning a raw message into what the engine looks at, and
watching an inbox for new mail.

The inbox is read over IMAP with BODY.PEEK, so Omnicyte never marks anything
as read, moves or deletes it. Passwords are never kept in Omnicyte's files:
each mailbox names an environment variable that holds it (for Microsoft 365
and Google Workspace, an app password, or the token an admin issues).
"""

import email
import email.policy
import imaplib
import json
import logging
import os
import re
import threading
import time
from email.utils import parseaddr
from html.parser import HTMLParser

from . import policy as policy_mod
from .engine import Message

LOG = logging.getLogger("omnicyte")
POLL_SECONDS = 60
MAX_BYTES = 5 * 1024 * 1024


class _Links(HTMLParser):
    """Links with the words shown for them, and the page's visible text."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.text = [], []
        self._href, self._shown, self._skip = None, [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self._skip += 1
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._shown = []
        if tag in ("br", "p", "div", "tr", "li"):
            self.text.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head") and self._skip:
            self._skip -= 1
        if tag == "a" and self._href is not None:
            self.links.append((self._href.strip(), " ".join("".join(self._shown).split())))
            self._href = None

    def handle_data(self, data):
        if self._skip:
            return
        self.text.append(data)
        if self._href is not None:
            self._shown.append(data)


def parse_html(html: str) -> tuple[list, str]:
    p = _Links()
    try:
        p.feed(html or "")
        p.close()
    except Exception:  # broken HTML in the wild: keep what was read
        pass
    return p.links, re.sub(r"\n\s*\n+", "\n\n", "".join(p.text)).strip()


def from_bytes(raw: bytes, where: str = "") -> Message:
    msg = email.message_from_bytes(raw[:MAX_BYTES], policy=email.policy.default)
    name, address = parseaddr(str(msg.get("From", "")))
    _, reply = parseaddr(str(msg.get("Reply-To", "")))
    texts, links, attachments = [], [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        filename = part.get_filename()
        disposition = (part.get_content_disposition() or "").lower()
        if filename or disposition == "attachment":
            attachments.append(filename or "(unnamed)")
            continue
        ctype = part.get_content_type()
        try:
            content = part.get_content()
        except (LookupError, ValueError):
            content = part.get_payload(decode=True) or b""
            content = content.decode("utf-8", "replace") if isinstance(content, bytes) else str(content)
        if ctype == "text/html":
            found, text = parse_html(content)
            links += found
            texts.append(text)
        elif ctype == "text/plain":
            texts.append(content)
    gateway = ""
    for header in ("X-MS-Exchange-Organization-SCL", "X-Spam-Flag"):
        value = str(msg.get(header, "")).strip()
        if header.endswith("SCL") and value.isdigit() and int(value) >= 5:
            gateway = f"Spam confidence {value}"
        elif header == "X-Spam-Flag" and value.upper() == "YES":
            gateway = "Marked as spam"
    return Message(source="mail", sender_name=name, sender_address=address, reply_to=reply,
                   subject=str(msg.get("Subject", "")), text="\n".join(texts), links=links,
                   attachments=attachments, gateway_verdict=gateway, where=where)


class InboxWatcher(threading.Thread):
    """Checks one inbox every minute and hands each new message to on_message."""

    def __init__(self, box: dict, on_message, stop: threading.Event):
        super().__init__(daemon=True, name=f"inbox {box.get('user', '')}")
        self.box, self.on_message, self.stop = box, on_message, stop
        self.state_path = policy_mod.home() / f"inbox-{re.sub(r'[^a-z0-9]+', '-', str(box.get('user', '')).lower())}.json"

    def _last_uid(self) -> int | None:
        try:
            return int(json.loads(self.state_path.read_text())["uid"])
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _save_uid(self, uid: int):
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(json.dumps({"uid": uid}))

    def check_once(self):
        box = self.box
        password = os.environ.get(box.get("password_env", "OMNICYTE_IMAP_PASSWORD"), "")
        if not (box.get("host") and box.get("user") and password):
            raise RuntimeError("mailbox needs host, user and a password in its environment variable")
        conn = imaplib.IMAP4_SSL(box["host"], int(box.get("port", 993)), timeout=30)
        try:
            conn.login(box["user"], password)
            conn.select(box.get("folder", "INBOX"), readonly=True)
            last = self._last_uid()
            if last is None:
                # First run: start from now, don't alarm about the whole history.
                typ, data = conn.uid("search", None, "ALL")
                uids = [int(u) for u in (data[0] or b"").split()]
                self._save_uid(max(uids) if uids else 0)
                return
            typ, data = conn.uid("search", None, f"UID {last + 1}:*")
            uids = sorted(int(u) for u in (data[0] or b"").split() if int(u) > last)
            for uid in uids[-50:]:
                typ, fetched = conn.uid("fetch", str(uid), "(BODY.PEEK[])")
                raw = next((part[1] for part in fetched or () if isinstance(part, tuple)), None)
                if raw:
                    self.on_message(from_bytes(raw, where=box["user"]))
                self._save_uid(uid)
        finally:
            try:
                conn.logout()
            except Exception:
                pass

    def run(self):
        while not self.stop.is_set():
            try:
                self.check_once()
            except Exception as e:  # network blips, wrong password: say so, keep going
                LOG.warning("inbox %s: %s", self.box.get("user", "?"), e)
            self.stop.wait(int(self.box.get("every_seconds", POLL_SECONDS)))
