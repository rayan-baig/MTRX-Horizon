"""The creator program: YouTubers and other creators make videos about the
apps, and earn a share of what the people they send pay in their first year.

1. A creator applies on /creators: name, channel link, audience size, email,
   the app they'd like to make videos about, and a tick for "I'm 18 or over,
   or my parent or guardian is applying for me". The application is kept for
   the owner to read in the console, and the owner is emailed a copy (at
   MTRX_CONTACT_EMAIL, or the alert address).
2. The owner approves a creator in the console and picks the app. The
   creator gets a short link, /c/<code>, and a private dashboard key. The key
   is shown once in the console and emailed to the creator; only its SHA-256
   is kept.
3. The short link counts clicks and confirmed early access sign-ups, then
   forwards to the app with ?ref=<code>. Before an app opens, it forwards to
   that app's early access form on this site, so sign-ups can be counted.
   The address it forwards to is worked out here from the app, never from
   the request, and must be one of the allowed hosts (see `destination`).
4. The creator's dashboard (/creators/dashboard) shows their clicks, their
   sign-ups and what they've earned and been paid. The owner writes earnings
   and payouts down by hand in the console. Nothing here moves any money.

Clicks are counted without keeping anyone's address: each visitor becomes a
mark made with a key that changes every day (growth.visitor_mark), the same
visitor counts once a day, and the marks go after two days.

The share and how long it lasts are settings: CREATOR_PERCENT (20) and
CREATOR_MONTHS (12). Off until CREATORS_ENABLED=1; until then no page
mentions it and every address of it is "page not found".
"""

import base64
import re
import secrets
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from . import catalog, config, db, early_access, growth

RATES = {
    "cr_apply": (3, 3600),          # applications per address an hour
    "cr_apply_day": (10, 86400),    # and a day
    "cr_me": (120, 3600),           # dashboard loads per address
    "cr_bad_key": (20, 3600),       # wrong keys per address
    "cr_click": (120, 3600),        # link clicks per visitor mark an hour
}
NOTICES_PER_DAY = 30

AUDIENCES = {
    "under-1k": "Under 1,000",
    "1k-10k": "1,000 to 10,000",
    "10k-100k": "10,000 to 100,000",
    "100k-1m": "100,000 to 1 million",
    "over-1m": "Over 1 million",
}
LIMITS = {"name": 80, "channel": 300, "email": 254, "note": 140}
KEY_HEADER = "x-creator-key"
KEYS_PER_CREATOR = 3
SHOW_DAYS = 30
# Hosts a creator link may forward to, besides each app's own address setting.
SITE_DOMAIN = "mtrxhorizyn.com"

TRAP = "website"
APPLIED = "Thanks! We'll look at your channel and email you within a few days."
NO_KEY = "That key doesn't work. Check it, or ask us for a new one."

_EMAIL = re.compile(r"[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+")
_CODE = re.compile(r"[a-z0-9]{4,12}")
_KEY = re.compile(r"CR[A-Z2-7]{24}")
_ID = re.compile(r"[0-9a-f]{16}")
# Letters and digits that are hard to mix up, for a code people type.
CODE_LETTERS = "abcdefghjkmnpqrstuvwxyz23456789"


def enabled() -> bool:
    return config.get().creators_enabled


def program() -> dict:
    s = config.get()
    months = s.creator_months
    period = "first year" if months == 12 else ("first month" if months == 1 else f"first {months} months")
    return {"percent": s.creator_percent, "months": months, "period": period}


# ---------------------------------------------------------------- applying

class Refused(ValueError):
    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field


def _line(value, field: str, label: str) -> str:
    if not isinstance(value, str):
        raise Refused(f"Please fill in {label}.", field)
    text = config._one_line(value, 10_000)
    if not text:
        raise Refused(f"Please fill in {label}.", field)
    if len(text) > LIMITS[field]:
        raise Refused(f"Please keep {label} to {LIMITS[field]} characters.", field)
    return text


def _channel(value) -> str:
    text = _line(value, "channel", "your channel link")
    if not re.match(r"https?://", text, re.IGNORECASE):
        text = "https://" + text
    try:
        parts = urlsplit(text)
    except ValueError:
        parts = None
    if parts is None or parts.scheme.lower() not in ("http", "https") or "." not in (parts.hostname or "") \
            or " " in text:
        raise Refused("That channel link doesn't look right. Paste the address of your channel.", "channel")
    return text


def read_form(body: dict) -> dict:
    name = _line(body.get("name"), "name", "your name")
    channel = _channel(body.get("channel"))
    audience = body.get("audience")
    if audience not in AUDIENCES:
        raise Refused("Choose about how many people follow you.", "audience")
    email = body.get("email").strip() if isinstance(body.get("email"), str) else ""
    if len(email) > LIMITS["email"] or not _EMAIL.fullmatch(email):
        raise Refused("That email address doesn't look right. Please check it.", "email")
    app = body.get("app") if body.get("app") in growth.APP_NAMES else ""
    if body.get("grown_up") is not True:
        raise Refused("Please tick the box: you're 18 or over, or your parent or guardian is applying for you.",
                      "grown_up")
    return {"name": name, "channel": channel, "audience": audience, "email": email, "app": app}


def apply(who: str, body: dict) -> tuple[int, dict]:
    if body.get(TRAP):
        return 200, {"ok": True, "message": APPLIED}
    try:
        row = read_form(body)
    except Refused as why:
        return 400, {"error": str(why), "field": why.field}
    if not (growth.allow("cr_apply", who, *RATES["cr_apply"])
            and growth.allow("cr_apply_day", who, *RATES["cr_apply_day"])):
        return 429, {"error": growth.BUSY}
    now = time.time()
    with db.connect() as conn:
        conn.execute("INSERT INTO creators (id, status, name, channel, audience, email, app, created_at) "
                     "VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)",
                     (secrets.token_hex(8), row["name"], row["channel"], row["audience"], row["email"],
                      row["app"], now))
    db.log("Creator application", AUDIENCES[row["audience"]])
    tell_owner(row)
    return 200, {"ok": True, "message": APPLIED}


def notice(row: dict) -> tuple[str, str]:
    subject = "MTRX Horizyn: new creator application"
    body = (f"Someone applied to the creator program.\n\n"
            f"Name:      {row['name']}\n"
            f"Channel:   {row['channel']}\n"
            f"Audience:  {AUDIENCES[row['audience']]}\n"
            f"App:       {growth.APP_NAMES.get(row['app'], 'Not sure yet')}\n"
            f"Email:     {row['email']}\n\n"
            f"Approve or decline it in the console's Creators section.\n\n- MTRX Horizyn\n")
    return subject, body


def tell_owner(row: dict, wait: bool = False):
    s = config.get()
    to = s.contact_email or s.alert_email
    if not (to and growth.email_ready()):
        return None
    with db.connect() as conn:
        (today,) = conn.execute("SELECT COUNT(*) FROM creators WHERE created_at > ?",
                                (time.time() - 86400,)).fetchone()
    if today > NOTICES_PER_DAY:
        return None
    subject, body = notice(row)
    return growth.send_later(to, subject, body, wait=wait)


# ---------------------------------------------------------------- keys and codes

def new_key() -> str:
    """CR-ABCD-EFGH-...: 120 random bits, in groups of four."""
    raw = base64.b32encode(secrets.token_bytes(15)).decode()
    return "CR-" + "-".join(raw[i:i + 4] for i in range(0, 24, 4))


def _normal_key(raw) -> str | None:
    if not isinstance(raw, str) or len(raw) > 80:
        return None
    flat = re.sub(r"[^A-Za-z0-9]", "", raw).upper()
    return flat if _KEY.fullmatch(flat) else None


def key_hash(raw) -> str | None:
    """The SHA-256 of a key however it was typed, or None if it isn't one."""
    flat = _normal_key(raw)
    return growth.sha256(flat) if flat else None


def _issue_key(conn, creator_id: str) -> str:
    key = new_key()
    conn.execute("INSERT INTO creator_keys (key_hash, creator_id, created_at) VALUES (?, ?, ?)",
                 (key_hash(key), creator_id, time.time()))
    conn.execute("DELETE FROM creator_keys WHERE creator_id = ? AND key_hash NOT IN (SELECT key_hash FROM "
                 "creator_keys WHERE creator_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
                 (creator_id, creator_id, KEYS_PER_CREATOR))
    return key


def _new_code(conn) -> str:
    while True:
        code = "".join(secrets.choice(CODE_LETTERS) for _ in range(6))
        if conn.execute("SELECT 1 FROM creators WHERE code = ?", (code,)).fetchone() is None:
            return code


def normal_code(raw) -> str | None:
    if not isinstance(raw, str):
        return None
    code = raw.strip().lower()
    return code if _CODE.fullmatch(code) else None


# ---------------------------------------------------------------- the owner's side

def _creator(conn, creator_id: str):
    if not isinstance(creator_id, str) or not _ID.fullmatch(creator_id):
        return None
    return conn.execute("SELECT * FROM creators WHERE id = ?", (creator_id,)).fetchone()


def link(code: str, base: str) -> str:
    return f"{base}/c/{code}"


def welcome_email(name: str, url: str, key: str, base: str) -> tuple[str, str]:
    p = program()
    subject = "You're in: your MTRX Horizyn creator link"
    body = (f"Hi {name},\n\n"
            f"Welcome to the MTRX Horizyn creator program.\n\n"
            f"Your link:\n{url}\n\n"
            f"Put it in your videos and descriptions. You earn {p['percent']}% of what the people who come\n"
            f"through it pay in their {p['period']}.\n\n"
            f"Your private dashboard key:\n\n    {key}\n\n"
            f"Open {base}/creators/dashboard and paste it in to see your clicks, sign-ups and earnings.\n"
            f"Keep it private, like a password.\n\n- MTRX Horizyn\n")
    return subject, body


def approve(creator_id: str, app, base: str) -> tuple[int, dict]:
    """Approve a creator for an app: a code for their link and a key for their
    dashboard, shown once here and emailed to them."""
    if app not in growth.APP_NAMES:
        return 400, {"error": "Choose the app their link goes to."}
    with db.connect() as conn:
        row = _creator(conn, creator_id)
        if row is None:
            return 409, {"error": "That application isn't there any more."}
        code = row["code"] or _new_code(conn)
        conn.execute("UPDATE creators SET status = 'approved', app = ?, code = ?, "
                     "approved_at = COALESCE(approved_at, ?) WHERE id = ?", (app, code, time.time(), creator_id))
        key = _issue_key(conn, creator_id)
    url = link(code, base)
    subject, body = welcome_email(row["name"], url, key, base)
    emailed = growth.send_later(row["email"], subject, body) is not None
    db.log("Creator approved", f"/c/{code}")
    return 200, {"ok": True, "code": code, "link": url, "key": key, "emailed": emailed}


def new_dashboard_key(creator_id: str, base: str) -> tuple[int, dict]:
    with db.connect() as conn:
        row = _creator(conn, creator_id)
        if row is None or row["status"] != "approved":
            return 409, {"error": "Approve the creator first."}
        key = _issue_key(conn, creator_id)
    subject, body = welcome_email(row["name"], link(row["code"], base), key, base)
    emailed = growth.send_later(row["email"], subject, body) is not None
    return 200, {"ok": True, "key": key, "emailed": emailed}


def remove(creator_id: str) -> bool:
    """Decline an application, or end an approved creator's link. Everything
    about them goes."""
    with db.connect() as conn:
        gone = conn.execute("DELETE FROM creators WHERE id = ?", (creator_id,)).rowcount
        for table in ("creator_keys", "creator_days", "creator_ledger"):
            conn.execute(f"DELETE FROM {table} WHERE creator_id = ?", (creator_id,))
    if gone:
        db.log("Creator removed", "")
    return bool(gone)


def _cents(raw) -> int | None:
    text = raw.strip().lstrip("$") if isinstance(raw, str) else (str(raw) if isinstance(raw, (int, float))
                                                                  and not isinstance(raw, bool) else "")
    if not re.fullmatch(r"\d{1,6}(\.\d{1,2})?", text):
        return None
    cents = round(float(text) * 100)
    return cents if 0 < cents <= 10_000_000 else None


def record(creator_id: str, body: dict) -> tuple[int, dict]:
    """Write down money a creator earned, or was paid. Nothing is sent."""
    kind = body.get("kind")
    if kind not in ("earned", "paid"):
        return 400, {"error": "Choose earned or paid."}
    cents = _cents(body.get("amount"))
    if cents is None:
        return 400, {"error": "Type an amount in dollars, such as 12.50."}
    note = config._one_line(body.get("note") if isinstance(body.get("note"), str) else "", LIMITS["note"])
    with db.connect() as conn:
        row = _creator(conn, creator_id)
        if row is None or row["status"] != "approved":
            return 409, {"error": "That creator isn't approved."}
        conn.execute("INSERT INTO creator_ledger (creator_id, at, kind, cents, note) VALUES (?, ?, ?, ?, ?)",
                     (creator_id, time.time(), kind, cents, note))
    return 200, {"ok": True}


def _totals(conn, creator_id: str) -> dict:
    since = growth.day(time.time() - (SHOW_DAYS - 1) * 86400)
    (clicks, signups) = conn.execute("SELECT COALESCE(SUM(clicks), 0), COALESCE(SUM(signups), 0) FROM creator_days "
                                     "WHERE creator_id = ?", (creator_id,)).fetchone()
    (clicks30, signups30) = conn.execute("SELECT COALESCE(SUM(clicks), 0), COALESCE(SUM(signups), 0) FROM "
                                         "creator_days WHERE creator_id = ? AND day >= ?",
                                         (creator_id, since)).fetchone()
    money = {r["kind"]: r["c"] for r in conn.execute(
        "SELECT kind, SUM(cents) AS c FROM creator_ledger WHERE creator_id = ? GROUP BY kind", (creator_id,))}
    earned, paid = money.get("earned", 0), money.get("paid", 0)
    return {"clicks": clicks, "signups": signups, "clicks_30": clicks30, "signups_30": signups30,
            "earned_usd": earned / 100, "paid_usd": paid / 100, "owed_usd": (earned - paid) / 100}


def console(base: str) -> dict:
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM creators ORDER BY created_at DESC LIMIT 300").fetchall()
        out = {"pending": [], "approved": []}
        for r in rows:
            item = {"id": r["id"], "name": r["name"], "channel": r["channel"], "email": r["email"],
                    "audience": AUDIENCES.get(r["audience"], r["audience"]), "app": r["app"],
                    "app_name": growth.APP_NAMES.get(r["app"], "Not sure yet"), "created_at": r["created_at"]}
            if r["status"] == "approved":
                item.update(code=r["code"], link=link(r["code"], base), approved_at=r["approved_at"],
                            **_totals(conn, r["id"]))
                item["ledger"] = [dict(x) for x in conn.execute(
                    "SELECT at, kind, cents, note FROM creator_ledger WHERE creator_id = ? ORDER BY at DESC LIMIT 10",
                    (r["id"],))]
                out["approved"].append(item)
            else:
                out["pending"].append(item)
    return {"enabled": enabled(), **program(), "apps": growth.APP_NAMES, **out}


# ---------------------------------------------------------------- the short link

def _allowed_host(key: str, host: str) -> bool:
    """A creator link may forward only to this site's domain and its
    subdomains, or to the host of the app's own address setting."""
    host = (host or "").lower().rstrip(".")
    if host == SITE_DOMAIN or host.endswith("." + SITE_DOMAIN):
        return True
    own = urlsplit(config.get().app_urls.get(key, "")).hostname or ""
    return bool(own) and host == own.lower()


def _with_ref(url: str, code: str) -> str:
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "ref"] + [("ref", code)]
    return urlunsplit((parts.scheme, parts.netloc, parts.path or "/", urlencode(query), parts.fragment))


def destination(app: str, code: str) -> str:
    """Where a creator's link goes: the app's own address with ?ref=<code>
    once it is open, else its early access form here. Worked out only from
    the app; nothing in the request can change it."""
    if app in growth.APP_NAMES:
        url = catalog.for_home()["urls"].get(app, "")
        try:
            parts = urlsplit(url)
        except ValueError:
            parts = None
        if url and parts and parts.scheme in ("https", "http") and _allowed_host(app, parts.hostname or ""):
            return _with_ref(url, code)
    if early_access.ready():
        query = {"app": app, "ref": code} if app in growth.APP_NAMES else {"ref": code}
        return "/early-access?" + urlencode(query)
    return f"/#learn-{app}" if app in growth.APP_NAMES else "/"


def _bump(conn, creator_id: str, field: str):
    conn.execute(f"INSERT INTO creator_days (creator_id, day, {field}) VALUES (?, ?, 1) "
                 f"ON CONFLICT (creator_id, day) DO UPDATE SET {field} = {field} + 1", (creator_id, growth.today()))


def click(who: str, raw) -> str | None:
    """Count a visit to a creator's link and say where to send them, or None
    for a code that isn't an approved creator's. The visitor is counted once
    a day, by a mark made with today's key; their address is not kept."""
    code = normal_code(raw)
    if code is None:
        return None
    with db.connect() as conn:
        row = conn.execute("SELECT id, app FROM creators WHERE code = ? AND status = 'approved'", (code,)).fetchone()
    if row is None:
        return None
    mark = growth.visitor_mark(who, code)
    if growth.allow("cr_click", "mark:" + growth.visitor_mark(who), *RATES["cr_click"]):
        with db.connect() as conn:
            fresh = conn.execute("INSERT OR IGNORE INTO creator_seen (day, mark) VALUES (?, ?)",
                                 (growth.today(), mark)).rowcount
            if fresh:
                _bump(conn, row["id"], "clicks")
    return destination(row["app"], code)


def count_signup(raw):
    """A confirmed early access sign-up that came through a creator's link."""
    code = normal_code(raw)
    if code is None:
        return
    with db.connect() as conn:
        row = conn.execute("SELECT id FROM creators WHERE code = ? AND status = 'approved'", (code,)).fetchone()
        if row is not None:
            _bump(conn, row["id"], "signups")


# ---------------------------------------------------------------- the creator's dashboard

def dashboard(who: str, raw, base: str) -> tuple[int, dict]:
    if not growth.under("cr_bad_key", who, *RATES["cr_bad_key"]) or not growth.allow("cr_me", who, *RATES["cr_me"]):
        return 429, {"error": growth.BUSY}
    hashed = key_hash(raw)
    with db.connect() as conn:
        row = conn.execute("SELECT c.* FROM creator_keys k JOIN creators c ON c.id = k.creator_id "
                           "WHERE k.key_hash = ? AND c.status = 'approved'", (hashed or "",)).fetchone()
        if row is None:
            growth.allow("cr_bad_key", who, *RATES["cr_bad_key"])
            return 403, {"error": NO_KEY}
        conn.execute("UPDATE creator_keys SET last_used = ? WHERE key_hash = ?", (time.time(), hashed))
        days = [growth.day(time.time() - (SHOW_DAYS - 1 - i) * 86400)
                for i in range(SHOW_DAYS)]
        known = {r["day"]: (r["clicks"], r["signups"]) for r in conn.execute(
            "SELECT day, clicks, signups FROM creator_days WHERE creator_id = ? AND day >= ?", (row["id"], days[0]))}
        ledger = [{"at": r["at"], "kind": r["kind"], "usd": r["cents"] / 100, "note": r["note"]}
                  for r in conn.execute("SELECT at, kind, cents, note FROM creator_ledger WHERE creator_id = ? "
                                        "ORDER BY at DESC LIMIT 50", (row["id"],))]
        totals = _totals(conn, row["id"])
    return 200, {
        "name": row["name"], "code": row["code"], "link": link(row["code"], base),
        "app": row["app"], "app_name": growth.APP_NAMES.get(row["app"], ""), **program(), **totals,
        "days": [{"day": d, "clicks": known.get(d, (0, 0))[0], "signups": known.get(d, (0, 0))[1]} for d in days],
        "ledger": ledger,
    }


# ---------------------------------------------------------------- upkeep and numbers

def forget_old():
    """Run by the upkeep loop: yesterday's visitor marks and older go."""
    yesterday = growth.day(time.time() - 86400)
    with db.connect() as conn:
        conn.execute("DELETE FROM creator_seen WHERE day < ?", (yesterday,))


def numbers() -> dict | None:
    """The console's Numbers card, or None while it is off and nobody has applied."""
    since = growth.day(time.time() - (SHOW_DAYS - 1) * 86400)
    with db.connect() as conn:
        states = {r["status"]: r["n"] for r in conn.execute(
            "SELECT status, COUNT(*) AS n FROM creators GROUP BY status")}
        (clicks, signups) = conn.execute("SELECT COALESCE(SUM(clicks), 0), COALESCE(SUM(signups), 0) "
                                         "FROM creator_days WHERE day >= ?", (since,)).fetchone()
        money = {r["kind"]: r["c"] for r in conn.execute("SELECT kind, SUM(cents) AS c FROM creator_ledger GROUP BY kind")}
    if not enabled() and not states:
        return None
    earned, paid = money.get("earned", 0), money.get("paid", 0)
    return {"enabled": enabled(), **program(), "approved": states.get("approved", 0),
            "pending": states.get("pending", 0), "clicks_30": clicks, "signups_30": signups,
            "earned_usd": earned / 100, "paid_usd": paid / 100, "owed_usd": (earned - paid) / 100}

