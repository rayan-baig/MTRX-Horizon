"""What the early access list (early_access.py) and the creator program
(creators.py) share: limits, the site's own signing key, the daily key that
turns an address into a mark, app names, and email.

Limits are counted in the failed-tries table (lock.py), so each row goes
after a day. The creator links count visitors by a mark made with a key that
changes every day (see `visitor_mark`), never by their address.
"""

import hashlib
import hmac
import logging
import secrets
import threading
import time

from . import config, db, health

LOG = logging.getLogger("horizon")

# The apps people can ask about, in the site's order, with their names.
APP_NAMES = {"rankup": "RankUp", "cyberlogix": "CyberLogix AI", "omniarmor": "OmniArmor.ai"}

BUSY = "That's a lot of tries for now. Please wait a little and try again."

_counting = threading.Lock()


def allow(kind: str, who: str, limit: int, window: int) -> bool:
    """Count one use of `kind` by `who`, or say they have used it enough."""
    now = time.time()
    with _counting, db.connect() as conn:
        (count,) = conn.execute("SELECT COUNT(*) FROM attempts WHERE kind = ? AND who = ? AND at > ?",
                                (kind, who, now - window)).fetchone()
        if count >= limit:
            return False
        conn.execute("INSERT INTO attempts (kind, who, at) VALUES (?, ?, ?)", (kind, who, now))
        return True


def under(kind: str, who: str, limit: int, window: int) -> bool:
    """Whether `who` still has some of `kind` left, without using any."""
    with db.connect() as conn:
        (count,) = conn.execute("SELECT COUNT(*) FROM attempts WHERE kind = ? AND who = ? AND at > ?",
                                (kind, who, time.time() - window)).fetchone()
    return count < limit


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


# ---------------------------------------------------------------- the site's own keys

def _key(name: str) -> bytes:
    """A random key this site keeps for itself, made the first time it is asked for."""
    with db.connect() as conn:
        conn.execute("INSERT OR IGNORE INTO site_keys (name, value, at) VALUES (?, ?, ?)",
                     (name, secrets.token_hex(32), time.time()))
        (value,) = conn.execute("SELECT value FROM site_keys WHERE name = ?", (name,)).fetchone()
    return bytes.fromhex(value)


def sign(text: str) -> str:
    """A 128-bit signature of `text`, for the links in emails."""
    return hmac.new(_key("links"), text.encode(), hashlib.sha256).hexdigest()[:32]


def signed(text: str, signature: str) -> bool:
    return isinstance(signature, str) and hmac.compare_digest(sign(text), signature)


def day(at: float | None = None) -> str:
    """The UTC day of a time (now if none), as "YYYY-MM-DD"."""
    t = time.gmtime(time.time() if at is None else at)
    return f"{t.tm_year:04d}-{t.tm_mon:02d}-{t.tm_mday:02d}"


def today() -> str:
    return day()


def visitor_mark(who: str, extra: str = "") -> str:
    """A visitor's address turned into a mark with today's key. The same
    address gives the same mark all day, and a different one tomorrow; once
    a day's key is deleted (forget_old_keys) nobody can tell whose it was.
    The address itself is never written down."""
    key = _key("visitors:" + today())
    return hmac.new(key, f"{who}|{extra}".encode(), hashlib.sha256).hexdigest()[:32]


def forget_old_keys():
    """Run by the upkeep loop: every day's key older than yesterday goes."""
    yesterday = day(time.time() - 86400)
    with db.connect() as conn:
        conn.execute("DELETE FROM site_keys WHERE name LIKE 'visitors:%' AND name < ?",
                     ("visitors:" + yesterday,))


# ---------------------------------------------------------------- apps

def app_list(raw) -> list:
    """The apps ticked in a form: known keys only, in the site's order."""
    if isinstance(raw, str):
        raw = raw.split(",")
    if not isinstance(raw, list):
        return []
    picked = {a for a in raw[:10] if isinstance(a, str)}
    return [k for k in APP_NAMES if k in picked]


def names(keys) -> str:
    """["rankup", "omniarmor"] -> "RankUp and OmniArmor.ai"."""
    words = [APP_NAMES[k] for k in keys if k in APP_NAMES]
    if len(words) < 2:
        return "".join(words)
    return ", ".join(words[:-1]) + " and " + words[-1]


# ---------------------------------------------------------------- email

def link_base() -> str:
    """The site's address for links in emails: MTRX_PUBLIC_URL only, never
    the request's Host, which whoever sends a request can make up. "" while
    it is unset, and then no email with a link is sent."""
    return config.get().public_url


NO_LINK_BASE = ("Set MTRX_PUBLIC_URL (https://mtrxhorizyn.com on the live site): emails with links in them "
                "aren't sent without it, so a link can never come from a request's own address.")


def sender() -> str:
    s = config.get()
    return s.growth_email_from or s.alert_from or s.alert_email


def email_ready() -> bool:
    return bool(config.get().smtp_host and sender())


def send(to: str, subject: str, body: str, headers: dict | None = None) -> bool:
    """Send one email now. False if email isn't set up or sending failed;
    never logs the address or the words."""
    if not email_ready():
        return False
    try:
        return bool(health.send_email(subject, body, to=to, sender=sender(), headers=headers))
    except Exception as exc:  # its kind only: an SMTP error can quote the login
        LOG.warning("Email not sent: %s", type(exc).__name__)
        return False


def send_later(to: str, subject: str, body: str, headers: dict | None = None, wait: bool = False):
    """Send from its own thread, so the visitor is not kept waiting on the
    mail server. `wait` is for tests."""
    if not email_ready():
        return None
    thread = threading.Thread(target=send, args=(to, subject, body, headers), daemon=True)
    thread.start()
    if wait:
        thread.join(timeout=30)
    return thread
