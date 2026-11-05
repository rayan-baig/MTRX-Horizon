"""Chroma Vortex: the official place to partner with MTRX Horizyn, pitch an
idea, or reach the company as an investor.

A visitor picks one of three paths on /vortex and sends a short form. Each
message is checked here, kept in the `vortex_messages` table so the owner
can read it in the console and reply, and deleted after KEEP_DAYS.

What is kept is only what the visitor typed into the form, with the time and
the path they chose. Never their address, a cookie, or anything about their
browser. Each address may send a few messages an hour and a day (counted in
the failed-tries table, the same way, and gone after a day), a hidden field
catches simple bots, and a message that is mostly links is refused.

When email is set up, the owner gets a short notice: the path and the
organisation or idea name only. The full message, with the visitor's email
address, is read in the console, so no inbox keeps copies of it.
"""

import logging
import re
import threading
import time
import unicodedata

from . import config, db, health

LOG = logging.getLogger("horizon")

KEEP_DAYS = 365

KINDS = {"partner": "Partner with us", "pitch": "Pitch an idea", "invest": "Investors"}
APPS = {"rankup": "RankUp", "cyberlogix": "CyberLogix AI", "omniarmor": "OmniArmor.ai"}
PARTNERSHIPS = {
    "resell": "Resell or distribute",
    "integrate": "Integrate or build on",
    "refer": "Refer customers",
    "co-market": "Co-marketing or events",
    "other": "Something else",
}

# The longest each field may be. A whole message stays well under the
# site's 16 KB body limit even in a script that takes 4 bytes a letter.
LIMITS = {"name": 80, "organisation": 120, "email": 254, "idea": 60, "pitch": 140,
          "audience": 120, "message": 3000}
# Which fields each path has, and which of them must be filled in.
FIELDS = {
    "partner": {"required": ("name", "organisation", "email", "message"), "optional": ()},
    "pitch": {"required": ("name", "email", "idea", "pitch", "audience"), "optional": ("message",)},
    "invest": {"required": ("name", "email", "message"), "optional": ("organisation",)},
}
LABELS = {"name": "your name", "organisation": "your organisation", "email": "your email",
          "idea": "the idea's name", "pitch": "the one-line pitch", "audience": "who it's for",
          "message": "your message"}

# The honeypot: a field people never see (hidden by a CSS class) and simple
# bots fill in.
TRAP = "website"

# Emails to the owner a day at most, however many messages arrive.
NOTICES_PER_DAY = 30

_EMAIL = re.compile(r"[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+")
_LINK = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
_EMAIL_ANYWHERE = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")

SENT = "Sent."
BUSY = ("You've sent a few messages already. Please wait a while before sending another, "
        "or add anything you forgot when we reply.")
LINKY = "That message is mostly links. Tell us in your own words, with a link or two at most."


class Refused(ValueError):
    """Something in the form can't be used. The message says why, kindly."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field


# ---------------------------------------------------------------- checking

def _text(value, field: str, required: bool) -> str:
    """One field as plain text: control characters out, spaces tidied.
    The message keeps its line breaks; every other field is one line."""
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise Refused("Something in that form wasn't text.", field)
    value = unicodedata.normalize("NFC", value)
    if field == "message":
        value = value.replace("\r\n", "\n").replace("\r", "\n")
        value = "".join(c for c in value if c == "\n" or unicodedata.category(c) not in ("Cc", "Cf"))
        value = re.sub(r"[ \t ]+", " ", value)
        value = re.sub(r"\n{3,}", "\n\n", value)
        value = "\n".join(line.strip() for line in value.split("\n")).strip()
    else:
        value = "".join(" " if unicodedata.category(c) in ("Cc", "Cf", "Zl", "Zp") else c for c in value)
        value = " ".join(value.split())
    if required and not value:
        raise Refused(f"Please fill in {LABELS[field]}.", field)
    if len(value) > LIMITS[field]:
        raise Refused(f"Please keep {LABELS[field]} to {LIMITS[field]:,} characters.", field)
    if field in ("name", "organisation", "idea") and "://" in value:
        raise Refused(f"Please leave links out of {LABELS[field]}.", field)
    return value


def mostly_links(*texts: str) -> bool:
    """True when the words are mostly web links: more than five, or links
    making up over half of what was written."""
    words = " ".join(t for t in texts if t)
    links = _LINK.findall(words)
    if not links:
        return False
    if len(links) > 5:
        return True
    letters = len(re.sub(r"\s", "", words))
    linked = sum(len(link) for link in links)
    return letters > 0 and linked / letters > 0.5


def read_form(body: dict) -> dict:
    """The fields to keep, checked, built only from the fields this path has.
    Anything else in the body is ignored."""
    kind = body.get("kind")
    if not isinstance(kind, str) or kind not in KINDS:
        raise Refused("Choose one of the three paths first.", "kind")
    rules = FIELDS[kind]
    row = {"kind": kind, "name": "", "organisation": "", "email": "", "apps": "",
           "partnership": "", "idea": "", "pitch": "", "audience": "", "message": ""}
    for field in rules["required"]:
        row[field] = _text(body.get(field), field, required=True)
    for field in rules["optional"]:
        row[field] = _text(body.get(field), field, required=False)
    if not _EMAIL.fullmatch(row["email"]):
        raise Refused("That email address doesn't look right. Please check it.", "email")
    if kind == "partner":
        apps = body.get("apps")
        if not isinstance(apps, list) or not apps or len(apps) > len(APPS) \
                or any(not isinstance(a, str) or a not in APPS for a in apps):
            raise Refused("Choose which app or apps the partnership is about.", "apps")
        row["apps"] = ",".join(k for k in APPS if k in apps)
        partnership = body.get("partnership")
        if not isinstance(partnership, str) or partnership not in PARTNERSHIPS:
            raise Refused("Choose the kind of partnership.", "partnership")
        row["partnership"] = partnership
    if mostly_links(row["message"], row["pitch"], row["audience"]):
        raise Refused(LINKY, "message")
    return row


# ---------------------------------------------------------------- limits

_claiming = threading.Lock()


def claim(who: str) -> bool:
    """Count one send from this address, or say it has sent enough for now.

    Kept with the failed tries (lock.py): the address and the time only,
    deleted after a day.
    """
    settings = config.get()
    now = time.time()
    with _claiming, db.connect() as conn:
        conn.execute("DELETE FROM attempts WHERE at < ?", (now - 86400,))
        (hour,) = conn.execute(
            "SELECT COUNT(*) FROM attempts WHERE kind = 'vortex' AND who = ? AND at > ?",
            (who, now - 3600)).fetchone()
        (day,) = conn.execute(
            "SELECT COUNT(*) FROM attempts WHERE kind = 'vortex' AND who = ? AND at > ?",
            (who, now - 86400)).fetchone()
        if hour >= settings.vortex_per_hour or day >= settings.vortex_per_day:
            return False
        conn.execute("INSERT INTO attempts (kind, who, at) VALUES ('vortex', ?, ?)", (who, now))
        return True


# ---------------------------------------------------------------- storing

COLUMNS = ("kind", "name", "organisation", "email", "apps", "partnership", "idea", "pitch",
           "audience", "message")


def store(row: dict, now: float | None = None) -> int:
    now = time.time() if now is None else now
    with db.connect() as conn:
        cursor = conn.execute(
            f"INSERT INTO vortex_messages (at, {', '.join(COLUMNS)}) "
            f"VALUES (?, {', '.join('?' for _ in COLUMNS)})",
            (now, *(row[c] for c in COLUMNS)))
        return cursor.lastrowid


def forget_old():
    """Delete messages older than KEEP_DAYS. Run by the upkeep loop."""
    with db.connect() as conn:
        conn.execute("DELETE FROM vortex_messages WHERE at < ?", (time.time() - KEEP_DAYS * 86400,))


# ---------------------------------------------------------------- telling the owner

def _clean_for_email(text: str) -> str:
    """A name the visitor typed, safe to put in a short notice: no email
    address, and not too long."""
    text = _EMAIL_ANYWHERE.sub("[email]", text)
    return text[:80] + ("…" if len(text) > 80 else "")


def notice(row: dict) -> tuple[str, str]:
    """The short email: the path and the organisation or idea name only."""
    kind = KINDS[row["kind"]]
    if row["kind"] == "pitch":
        what = f"Idea: {_clean_for_email(row['idea'])}"
    else:
        what = f"Organisation: {_clean_for_email(row['organisation']) or '(none given)'}"
    subject = f"MTRX Horizyn: new Chroma Vortex message ({kind})"
    body = (f"A new message arrived through Chroma Vortex.\n\n"
            f"Path:  {kind}\n{what}\n\n"
            f"Read it and reply from the console's Chroma Vortex section. The sender's details\n"
            f"and message are kept there only, not in this email.\n\n- MTRX Horizyn\n")
    return subject, body


def _send(subject: str, body: str):
    try:
        health.send_email(subject, body)
    except Exception as exc:  # the reason's kind only: an SMTP error can quote the login
        LOG.warning("Chroma Vortex notice not sent: %s", type(exc).__name__)


def tell_owner(row: dict, wait: bool = False):
    """Email the owner a short notice from its own thread, so the visitor is
    not kept waiting on the mail server. `wait` is for tests."""
    s = config.get()
    if not (s.alert_email and s.smtp_host):
        return None
    with db.connect() as conn:
        (today,) = conn.execute("SELECT COUNT(*) FROM vortex_messages WHERE at > ?",
                                (time.time() - 86400,)).fetchone()
    if today > NOTICES_PER_DAY:
        return None
    subject, body = notice(row)
    thread = threading.Thread(target=_send, args=(subject, body), daemon=True)
    thread.start()
    if wait:
        thread.join(timeout=30)
    return thread


# ---------------------------------------------------------------- sending

def send(who: str, body: dict) -> tuple[int, dict]:
    """The whole send: check, count, store, tell. Returns (status, JSON).
    Never puts what the visitor wrote into a log."""
    if body.get(TRAP):
        # A bot filled in the hidden field. It is told "sent", so it learns
        # nothing, and nothing is kept.
        return 200, {"ok": True, "message": SENT}
    try:
        row = read_form(body)
    except Refused as why:
        return 400, {"error": str(why), "field": why.field}
    if not claim(who):
        return 429, {"error": BUSY}
    store(row)
    db.log("Vortex message", KINDS[row["kind"]])
    tell_owner(row)
    return 200, {"ok": True, "message": SENT, "email": row["email"]}


# ---------------------------------------------------------------- the console

def _public(r) -> dict:
    return {
        "id": r["id"], "at": r["at"], "kind": r["kind"], "kind_name": KINDS.get(r["kind"], r["kind"]),
        "name": r["name"], "organisation": r["organisation"], "email": r["email"],
        "apps": [APPS[a] for a in r["apps"].split(",") if a in APPS],
        "partnership": PARTNERSHIPS.get(r["partnership"], ""),
        "idea": r["idea"], "pitch": r["pitch"], "audience": r["audience"], "message": r["message"],
        "read": r["read_at"] is not None, "archived": r["archived_at"] is not None,
    }


def unread() -> int:
    with db.connect() as conn:
        (count,) = conn.execute(
            "SELECT COUNT(*) FROM vortex_messages WHERE read_at IS NULL AND archived_at IS NULL"
        ).fetchone()
    return count


def inbox(box: str = "inbox", limit: int = 200) -> dict:
    archived = box == "archived"
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM vortex_messages WHERE (archived_at IS NOT NULL) = ? "
            "ORDER BY at DESC, id DESC LIMIT ?", (int(archived), limit)).fetchall()
        (in_archive,) = conn.execute(
            "SELECT COUNT(*) FROM vortex_messages WHERE archived_at IS NOT NULL").fetchone()
    return {"box": "archived" if archived else "inbox", "messages": [_public(r) for r in rows],
            "unread": unread(), "archived": in_archive, "keep_days": KEEP_DAYS}


ACTIONS = ("read", "unread", "archive", "unarchive", "delete")


def act(message_id: int, action: str) -> bool:
    """Mark read or unread, archive or bring back, or delete one message.
    False if there is no such message."""
    now = time.time()
    sql, params = {
        "read": ("UPDATE vortex_messages SET read_at = COALESCE(read_at, ?) WHERE id = ?",
                 (now, message_id)),
        "unread": ("UPDATE vortex_messages SET read_at = NULL WHERE id = ?", (message_id,)),
        # Archiving a message also counts as reading it.
        "archive": ("UPDATE vortex_messages SET archived_at = COALESCE(archived_at, ?), "
                    "read_at = COALESCE(read_at, ?) WHERE id = ?", (now, now, message_id)),
        "unarchive": ("UPDATE vortex_messages SET archived_at = NULL WHERE id = ?", (message_id,)),
        "delete": ("DELETE FROM vortex_messages WHERE id = ?", (message_id,)),
    }[action]
    with db.connect() as conn:
        return conn.execute(sql, params).rowcount > 0
