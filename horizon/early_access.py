"""The early access list: people who want to hear the day an app opens, and
the owner's launch emails to them.

Joining (POST /api/early-access/join):
- A grown-up types an email address, ticks the apps they care about and
  ticks "I'm 18 or over". The form is on the home page and on /early-access.
- Double opt-in: they get an email with a link, and only once they open it
  and press Confirm are they on the list (opening it alone changes nothing,
  since mail checkers open links too). Until then the sign-up is
  "unconfirmed", and it is deleted 7 days after the last sign-up if it is
  never confirmed.
- What is kept: the email address and the apps. Nothing else about the
  person: no name, no address, no age (the 18+ box must be ticked, and is
  not stored). If they came through a creator's link, the creator's code is
  kept until they confirm, then counted for the creator and cleared.
- Every email has a one-click unsubscribe link and a List-Unsubscribe
  header (with List-Unsubscribe-Post, so a mail app's own button works in one
  click). Unsubscribing deletes the person from the list.
- The form is limited by address, and confirmation emails by address and by
  email address, and in all each day.

Founding members:
- The page promises founding members a launch discount. Each app's code is
  a setting (FOUNDER_CODE_RANKUP, FOUNDER_CODE_CYBERLOGIX,
  FOUNDER_CODE_OMNIARMOR), a Stripe promotion code the owner makes. The
  percent (FOUNDER_PERCENT_OFF) is shown only for an app that has a code.

Launch emails (the console's Early access section):
- The owner writes a subject and a short message for one app, previews it,
  and sends it to the people confirmed for that app, with that app's founder
  code. A campaign is named by its app, subject and words, so sending the
  same one again reaches only people who haven't had it: each person gets a
  campaign once.
- Sending is throttled: one email at a time, at most
  EARLY_ACCESS_SEND_PER_MINUTE a minute, from a background thread that
  carries on after a restart.
- Blocked, with a clear message, until MTRX_POSTAL_ADDRESS (printed at the
  foot of every launch email), email and the app's founder code are set.

Off until EARLY_ACCESS_ENABLED=1, with email set up (MTRX_SMTP_*). Until
then no page mentions it and every address of it is "page not found",
except an unsubscribe link from an email already sent, which always works.
"""

import re
import secrets
import threading
import time

from . import catalog, config, db, growth

KEEP_UNCONFIRMED = 7 * 86400

# Every limit: (most, per seconds).
RATES = {
    "ea_join": (5, 3600),            # sign-ups per address an hour
    "ea_join_day": (20, 86400),      # and a day
    "ea_email": (3, 86400),          # confirmation emails to one email address a day
    "ea_email_all": (500, 86400),    # confirmation emails a day, everyone together
    "ea_bad_link": (30, 3600),       # wrong confirm or unsubscribe links per address
}

SUBJECT_MAX = 120
MESSAGE_MAX = 3000

JOINED = "Nearly there! Check your email and tap the link to confirm. (Look in spam too.)"
NOT_OPEN = "Early access isn't open right now. Please try again soon."

_EMAIL = re.compile(r"[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+")
_TOKEN = re.compile(r"([0-9a-f]{16})\.([0-9a-f]{32})")
_CODE = re.compile(r"[a-z0-9]{4,12}")

# The honeypot: a field people never see, which simple bots fill in.
TRAP = "website"


def enabled() -> bool:
    """The owner's switch only."""
    return config.get().early_access_enabled


def ready() -> bool:
    """Switched on and able to send the confirmation email. The form shows only then."""
    return enabled() and growth.email_ready()


def _apps(text: str) -> list:
    return growth.app_list(text)


def _join(keys) -> str:
    return ",".join(growth.app_list(list(keys)))


# ---------------------------------------------------------------- the offer

def offer() -> dict | None:
    """What a page shows: each app, and the percent off for founding members
    for an app with a code. None while early access is not ready."""
    if not ready():
        return None
    s = config.get()
    apps = []
    for key, name in growth.APP_NAMES.items():
        code = s.founder_codes.get(key, "")
        apps.append({"key": key, "name": name,
                     "percent": s.founder_percent_off if code and s.founder_percent_off else None})
    percents = {a["percent"] for a in apps}
    return {"apps": apps,
            # One number for every app, when every app has a code and a percent.
            "percent": apps[0]["percent"] if len(percents) == 1 and None not in percents else None}


# ---------------------------------------------------------------- links

def token(kind: str, signup_id: str) -> str:
    return f"{signup_id}.{growth.sign(kind + ':' + signup_id)}"


def _read(kind: str, raw) -> str | None:
    """The sign-up id in a signed link, or None for anything else."""
    if not isinstance(raw, str):
        return None
    match = _TOKEN.fullmatch(raw)
    if not match or not growth.signed(kind + ":" + match.group(1), match.group(2)):
        return None
    return match.group(1)


def _links(base: str, signup_id: str) -> tuple[str, str]:
    return (f"{base}/early-access/confirm/{token('confirm', signup_id)}",
            f"{base}/early-access/unsubscribe/{token('unsubscribe', signup_id)}")


def _unsubscribe_headers(url: str) -> dict:
    # RFC 8058: a mail app's own unsubscribe button posts to this address.
    return {"List-Unsubscribe": f"<{url}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}


def _foot(unsubscribe: str) -> str:
    postal = config.get().postal_address
    return (f"Unsubscribe in one click: {unsubscribe}\n"
            f"MTRX Horizyn{(' · ' + postal) if postal else ''}\n")


# ---------------------------------------------------------------- joining

def confirmation_email(apps: list, confirm: str, unsubscribe: str) -> tuple[str, str]:
    s = config.get()
    coded = [k for k in apps if s.founder_codes.get(k)]
    if coded and s.founder_percent_off:
        perk = f"Founding members get {s.founder_percent_off}% off {growth.names(coded)} at launch.\n\n"
    else:
        perk = "Founding members get a launch discount.\n\n"
    subject = "Confirm your MTRX Horizyn early access"
    body = (f"Hi,\n\n"
            f"Someone (we hope you) asked to hear first when {growth.names(apps)} opens.\n\n"
            f"Tap this link, then press Confirm:\n{confirm}\n\n"
            f"{perk}"
            f"Didn't ask for this? Just ignore this email. We'll delete the request in 7 days.\n\n"
            f"- MTRX Horizyn\n\n"
            f"{_foot(unsubscribe)}")
    return subject, body


def _email(raw) -> str | None:
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    if len(value) > 254 or not _EMAIL.fullmatch(value):
        return None
    return value.lower()


def _inbox(email: str) -> str:
    """The inbox an address lands in, for counting the emails sent to it:
    most mail services ignore anything after a "+", and Gmail ignores dots,
    so fan+1@... and fan+2@... are one person's inbox."""
    local, _, domain = email.lower().partition("@")
    local = local.split("+", 1)[0]
    if domain in ("gmail.com", "googlemail.com"):
        local, domain = local.replace(".", ""), "gmail.com"
    return f"{local}@{domain}"


def join(who: str, body: dict, base: str) -> tuple[int, dict]:
    """A sign-up from the form. The answer is the same whether or not the
    address is already on the list, so nobody can use it to find out who is."""
    if not ready():
        return 503, {"error": NOT_OPEN}
    if body.get(TRAP):
        return 200, {"ok": True, "message": JOINED}
    email = _email(body.get("email"))
    if email is None:
        return 400, {"error": "That email address doesn't look right. Please check it.", "field": "email"}
    apps = growth.app_list(body.get("apps"))
    if not apps:
        return 400, {"error": "Tick at least one app.", "field": "apps"}
    if body.get("adult") is not True:
        return 400, {"error": "Please tick the box to say you're 18 or over.", "field": "adult"}
    ref = body.get("ref") if isinstance(body.get("ref"), str) else ""
    ref = ref.strip().lower() if _CODE.fullmatch(ref.strip().lower()) else ""
    if not (growth.allow("ea_join", who, *RATES["ea_join"])
            and growth.allow("ea_join_day", who, *RATES["ea_join_day"])):
        return 429, {"error": growth.BUSY}
    now = time.time()
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM early_signups WHERE email = ?", (email,)).fetchone()
        if row is None:
            signup_id = secrets.token_hex(8)
            conn.execute("INSERT INTO early_signups (id, email, pending, ref, created_at, pending_at) "
                         "VALUES (?, ?, ?, ?, ?, ?)", (signup_id, email, _join(apps), ref, now, now))
            wanted = apps
        else:
            signup_id = row["id"]
            have = set(_apps(row["apps"]))
            wanted = [k for k in apps if k not in have]
            if wanted:
                pending = _join(set(_apps(row["pending"])) | set(wanted))
                conn.execute("UPDATE early_signups SET pending = ?, pending_at = ?, "
                             "ref = CASE WHEN confirmed_at IS NULL AND ref = '' THEN ? ELSE ref END WHERE id = ?",
                             (pending, now, ref, signup_id))
                wanted = _apps(pending)
    if wanted and growth.allow("ea_email", growth.sha256(_inbox(email)), *RATES["ea_email"]) \
            and growth.allow("ea_email_all", "all", *RATES["ea_email_all"]):
        confirm, unsubscribe = _links(base, signup_id)
        subject, text = confirmation_email(wanted, confirm, unsubscribe)
        growth.send_later(email, subject, text, _unsubscribe_headers(unsubscribe))
    return 200, {"ok": True, "message": JOINED}


def confirm_check(who: str, raw) -> tuple[int, dict]:
    """What the confirm page shows when the link is opened, before Confirm
    is pressed. Opening it changes nothing: work and school mail often
    opens every link in an email to check it, before the person has."""
    if not growth.under("ea_bad_link", who, *RATES["ea_bad_link"]):
        return 429, {"error": growth.BUSY}
    signup_id = _read("confirm", raw)
    if signup_id is None:
        growth.allow("ea_bad_link", who, *RATES["ea_bad_link"])
        return 404, {}
    with db.connect() as conn:
        row = conn.execute("SELECT apps, pending FROM early_signups WHERE id = ?", (signup_id,)).fetchone()
    if row is None:
        return 410, {"error": "This link has run out. Sign up again and we'll send a new one."}
    apps = _apps(_join(set(_apps(row["apps"])) | set(_apps(row["pending"]))))
    return 200, {"apps": apps, "names": growth.names(apps), "first": False, "waiting": bool(_apps(row["pending"])),
                 "unsubscribe": token("unsubscribe", signup_id)}


def confirm(who: str, raw) -> tuple[int, dict]:
    """The Confirm button on the page the email's link opens. Returns
    (status, what the page shows)."""
    if not growth.under("ea_bad_link", who, *RATES["ea_bad_link"]):
        return 429, {"error": growth.BUSY}
    signup_id = _read("confirm", raw)
    if signup_id is None:
        growth.allow("ea_bad_link", who, *RATES["ea_bad_link"])
        return 404, {}
    now = time.time()
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM early_signups WHERE id = ?", (signup_id,)).fetchone()
        if row is None:
            return 410, {"error": "This link has run out. Sign up again and we'll send a new one."}
        apps = _apps(_join(set(_apps(row["apps"])) | set(_apps(row["pending"]))))
        first = row["confirmed_at"] is None
        conn.execute("UPDATE early_signups SET apps = ?, pending = '', pending_at = NULL, ref = '', "
                     "confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?", (_join(apps), now, signup_id))
    if first and row["ref"]:
        from . import creators  # it uses this module
        creators.count_signup(row["ref"])
    if first:
        db.log("Early access", "Someone confirmed")
    return 200, {"apps": apps, "names": growth.names(apps), "first": first,
                 "unsubscribe": token("unsubscribe", signup_id)}


def unsubscribe_check(who: str, raw) -> tuple[int, dict]:
    """What the unsubscribe page shows before the button is pressed."""
    if not growth.under("ea_bad_link", who, *RATES["ea_bad_link"]):
        return 429, {"error": growth.BUSY}
    signup_id = _read("unsubscribe", raw)
    if signup_id is None:
        growth.allow("ea_bad_link", who, *RATES["ea_bad_link"])
        return 404, {}
    with db.connect() as conn:
        row = conn.execute("SELECT apps, pending FROM early_signups WHERE id = ?", (signup_id,)).fetchone()
    if row is None:
        return 200, {"gone": True}
    apps = _apps(_join(set(_apps(row["apps"])) | set(_apps(row["pending"]))))
    return 200, {"gone": False, "names": growth.names(apps)}


def unsubscribe(who: str, raw) -> tuple[int, dict]:
    """Delete the person from the list: the button on the page, or a mail
    app's one-click unsubscribe."""
    if not growth.under("ea_bad_link", who, *RATES["ea_bad_link"]):
        return 429, {"error": growth.BUSY}
    signup_id = _read("unsubscribe", raw)
    if signup_id is None:
        growth.allow("ea_bad_link", who, *RATES["ea_bad_link"])
        return 404, {}
    with db.connect() as conn:
        gone = conn.execute("DELETE FROM early_signups WHERE id = ?", (signup_id,)).rowcount
        conn.execute("DELETE FROM early_sends WHERE signup_id = ?", (signup_id,))
    if gone:
        db.log("Early access", "Someone unsubscribed")
    return 200, {"gone": True}


def forget_old(now: float | None = None):
    """Run by the upkeep loop: sign-ups never confirmed go after 7 days, and
    so do apps added later that were never confirmed."""
    now = time.time() if now is None else now
    with db.connect() as conn:
        # Counted from the latest sign-up, whose email has a link that
        # must keep working for the whole seven days.
        old = [r[0] for r in conn.execute("SELECT id FROM early_signups WHERE confirmed_at IS NULL "
                                          "AND COALESCE(pending_at, created_at) < ?", (now - KEEP_UNCONFIRMED,))]
        for signup_id in old:
            conn.execute("DELETE FROM early_signups WHERE id = ?", (signup_id,))
            conn.execute("DELETE FROM early_sends WHERE signup_id = ?", (signup_id,))
        conn.execute("UPDATE early_signups SET pending = '', pending_at = NULL, ref = '' "
                     "WHERE confirmed_at IS NOT NULL AND pending_at < ?", (now - KEEP_UNCONFIRMED,))


# ---------------------------------------------------------------- counting

def counts() -> dict:
    """Confirmed and unconfirmed people for each app."""
    out = {k: {"confirmed": 0, "unconfirmed": 0} for k in growth.APP_NAMES}
    with db.connect() as conn:
        rows = conn.execute("SELECT apps, pending FROM early_signups").fetchall()
    for r in rows:
        for k in _apps(r["apps"]):
            out[k]["confirmed"] += 1
        for k in _apps(r["pending"]):
            out[k]["unconfirmed"] += 1
    return out


# SQL that is true for a sign-up whose confirmed apps hold the app given.
_HAS = "(',' || apps || ',') LIKE '%,' || ? || ',%'"


# ---------------------------------------------------------------- launch emails

class Refused(ValueError):
    pass


def _clean_subject(raw) -> str:
    if not isinstance(raw, str):
        raise Refused("Write a subject.")
    text = config._one_line(raw, 10_000)
    if not text:
        raise Refused("Write a subject.")
    if len(text) > SUBJECT_MAX:
        raise Refused(f"Keep the subject to {SUBJECT_MAX} characters.")
    return text


def _clean_message(raw) -> str:
    if not isinstance(raw, str):
        raise Refused("Write a short message.")
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(c for c in text if c == "\n" or (ord(c) >= 32 and ord(c) != 127))
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(line.rstrip() for line in text.split("\n"))).strip()
    if not text:
        raise Refused("Write a short message.")
    if len(text) > MESSAGE_MAX:
        raise Refused(f"Keep the message to {MESSAGE_MAX:,} characters.")
    return text


def _clean(app, subject, message) -> tuple[str, str, str]:
    if app not in growth.APP_NAMES:
        raise Refused("Choose an app.")
    return app, _clean_subject(subject), _clean_message(message)


def problems(app: str) -> list:
    """What stops launch emails for this app from going, in plain words."""
    s = config.get()
    out = []
    if not enabled():
        out.append("Early access is switched off. Set EARLY_ACCESS_ENABLED=1.")
    if not s.postal_address:
        out.append("Add the company's postal address first: set MTRX_POSTAL_ADDRESS. "
                   "Every launch email has to show it, so sending is blocked until it's there.")
    if not growth.email_ready():
        out.append("Email isn't set up yet: set MTRX_SMTP_HOST (and its login) and EARLY_ACCESS_EMAIL_FROM.")
    if app in growth.APP_NAMES and not s.founder_codes.get(app):
        out.append(f"Set FOUNDER_CODE_{app.upper()} to {growth.APP_NAMES[app]}'s Stripe promotion code first: "
                   "the sign-up page promised founding members a launch discount.")
    return out


def _app_url(app: str) -> str:
    return catalog.for_home()["urls"].get(app, "")


def launch_email(app: str, subject: str, message: str, unsubscribe: str) -> tuple[str, str]:
    s = config.get()
    name = growth.APP_NAMES[app]
    code = s.founder_codes.get(app, "")
    lines = [message, ""]
    if code:
        lines.append(f"Your founding member code for {name}: {code}")
        lines.append((f"It takes {s.founder_percent_off}% off. " if s.founder_percent_off else "")
                     + "Type it in at checkout.")
        lines.append("")
    url = _app_url(app)
    if url:
        lines += [f"Open {name}: {url}", ""]
    lines += ["--",
              f"You're getting this because you joined the MTRX Horizyn early access list for {name}."]
    body = "\n".join(lines) + "\n" + _foot(unsubscribe)
    return subject, body


def _recipients(conn, app: str, campaign_id: str) -> tuple[int, int]:
    """(people who would get it now, people who already have)."""
    (fresh,) = conn.execute(
        f"SELECT COUNT(*) FROM early_signups WHERE confirmed_at IS NOT NULL AND {_HAS} "
        "AND id NOT IN (SELECT signup_id FROM early_sends WHERE campaign_id = ?)", (app, campaign_id)).fetchone()
    (had,) = conn.execute("SELECT COUNT(*) FROM early_sends WHERE campaign_id = ?", (campaign_id,)).fetchone()
    return fresh, had


def campaign_id(app: str, subject: str, message: str) -> str:
    return growth.sha256(f"{app}\n{subject}\n{message}")[:16]


def preview(app, subject, message) -> tuple[int, dict]:
    """The email as it will arrive, who it will go to, and anything that
    stops it going."""
    try:
        app, subject, message = _clean(app, subject, message)
    except Refused as why:
        return 400, {"error": str(why)}
    cid = campaign_id(app, subject, message)
    with db.connect() as conn:
        fresh, had = _recipients(conn, app, cid)
    subject, body = launch_email(app, subject, message, "(each person's own unsubscribe link)")
    blocked = problems(app)
    if not fresh and not blocked:
        blocked = [f"Nobody new to send it to: {had} already had this email."] if had else \
                  [f"Nobody has confirmed for {growth.APP_NAMES[app]} yet."]
    return 200, {"subject": subject, "body": body, "to": fresh, "already": had,
                 "problems": blocked, "can_send": not blocked, "from": growth.sender()}


def queue(app, subject, message, base: str) -> tuple[int, dict]:
    """Queue the email for everyone confirmed for the app who hasn't had it."""
    try:
        app, subject, message = _clean(app, subject, message)
    except Refused as why:
        return 400, {"error": str(why)}
    blocked = problems(app)
    if blocked:
        return 409, {"error": blocked[0], "problems": blocked}
    cid = campaign_id(app, subject, message)
    now = time.time()
    with db.connect() as conn:
        conn.execute("INSERT OR IGNORE INTO early_campaigns (id, app, subject, message, base, created_at) "
                     "VALUES (?, ?, ?, ?, ?, ?)", (cid, app, subject, message, base, now))
        added = conn.execute(
            "INSERT OR IGNORE INTO early_sends (campaign_id, signup_id, state, at) "
            f"SELECT ?, id, 'queued', ? FROM early_signups WHERE confirmed_at IS NOT NULL AND {_HAS}",
            (cid, now, app)).rowcount
        (had,) = conn.execute("SELECT COUNT(*) FROM early_sends WHERE campaign_id = ?", (cid,)).fetchone()
    if added:
        db.log("Launch email", f"{growth.APP_NAMES[app]}: {added} queued")
        kick()
    return 200, {"ok": True, "campaign": cid, "queued": added, "already": had - added,
                 "per_minute": config.get().early_access_send_per_minute}


# ---------------------------------------------------------------- sending, throttled

_claiming = threading.Lock()


def _claim():
    """The next queued email, marked as being sent so it is never sent twice;
    None when there is none, or when something stops its campaign."""
    with _claiming, db.connect() as conn:
        row = conn.execute("SELECT s.campaign_id, s.signup_id, c.app, c.subject, c.message, c.base "
                           "FROM early_sends s JOIN early_campaigns c ON c.id = s.campaign_id "
                           "WHERE s.state = 'queued' ORDER BY s.at, s.rowid LIMIT 1").fetchone()
        if row is None or problems(row["app"]):
            return None
        conn.execute("UPDATE early_sends SET state = 'sending', at = ? WHERE campaign_id = ? AND signup_id = ?",
                     (time.time(), row["campaign_id"], row["signup_id"]))
        person = conn.execute("SELECT email, apps FROM early_signups WHERE id = ?", (row["signup_id"],)).fetchone()
    return dict(row), (dict(person) if person else None)


def _finish(job: dict, state: str):
    with db.connect() as conn:
        conn.execute("UPDATE early_sends SET state = ?, at = ? WHERE campaign_id = ? AND signup_id = ?",
                     (state, time.time(), job["campaign_id"], job["signup_id"]))


def deliver(limit: int | None = None, pause: float = 0.0, stop: threading.Event | None = None) -> int:
    """Send queued launch emails one at a time, `pause` seconds apart.
    Each is marked "sending" before it goes, so a crash can never send it
    twice. Returns how many were tried."""
    tried = 0
    while limit is None or tried < limit:
        claimed = _claim()
        if claimed is None:
            break
        job, person = claimed
        tried += 1
        if person is None or job["app"] not in _apps(person["apps"]):
            _finish(job, "skipped")  # unsubscribed since it was queued
            continue
        unsubscribe = f"{job['base']}/early-access/unsubscribe/{token('unsubscribe', job['signup_id'])}"
        subject, body = launch_email(job["app"], job["subject"], job["message"], unsubscribe)
        ok = growth.send(person["email"], subject, body, _unsubscribe_headers(unsubscribe))
        _finish(job, "sent" if ok else "failed")
        if pause and (stop.wait(pause) if stop else time.sleep(pause)):
            break
    return tried


_worker: threading.Thread | None = None
_starting = threading.Lock()
_stop = threading.Event()


def _queued() -> bool:
    with db.connect() as conn:
        return conn.execute("SELECT 1 FROM early_sends WHERE state = 'queued' LIMIT 1").fetchone() is not None


def _work():
    deliver(pause=60.0 / config.get().early_access_send_per_minute, stop=_stop)


def kick():
    """Start the sender if anything is waiting and it isn't running. Also run
    by the upkeep loop, so sending carries on after a restart."""
    global _worker
    if not enabled():
        return
    with _starting:
        if (_worker is not None and _worker.is_alive()) or not _queued():
            return
        _worker = threading.Thread(target=_work, name="horizon-launch-email", daemon=True)
        _worker.start()


# ---------------------------------------------------------------- the console

def campaigns() -> list:
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM early_campaigns ORDER BY created_at DESC LIMIT 30").fetchall()
        out = []
        for c in rows:
            states = {r["state"]: r["n"] for r in conn.execute(
                "SELECT state, COUNT(*) AS n FROM early_sends WHERE campaign_id = ? GROUP BY state", (c["id"],))}
            out.append({"id": c["id"], "app": c["app"], "app_name": growth.APP_NAMES.get(c["app"], c["app"]),
                        "subject": c["subject"], "created_at": c["created_at"],
                        "sent": states.get("sent", 0), "queued": states.get("queued", 0) + states.get("sending", 0),
                        "failed": states.get("failed", 0), "skipped": states.get("skipped", 0)})
    return out


def console() -> dict:
    s = config.get()
    count = counts()
    return {
        "enabled": enabled(), "ready": ready(), "email": growth.email_ready(),
        "postal": bool(s.postal_address), "percent": s.founder_percent_off or None,
        "per_minute": s.early_access_send_per_minute,
        "apps": [{"key": k, "name": n, **count[k], "code": bool(s.founder_codes.get(k)),
                  "setting": f"FOUNDER_CODE_{k.upper()}"} for k, n in growth.APP_NAMES.items()],
        "campaigns": campaigns(),
        "limits": {"subject": SUBJECT_MAX, "message": MESSAGE_MAX},
    }


def numbers() -> dict | None:
    """The console's Numbers card, or None while it is off and nobody is on the list."""
    count = counts()
    with db.connect() as conn:
        (people,) = conn.execute("SELECT COUNT(*) FROM early_signups WHERE confirmed_at IS NOT NULL").fetchone()
        (waiting,) = conn.execute("SELECT COUNT(*) FROM early_signups WHERE confirmed_at IS NULL").fetchone()
        (sent,) = conn.execute("SELECT COUNT(*) FROM early_sends WHERE state = 'sent'").fetchone()
        (week,) = conn.execute("SELECT COUNT(*) FROM early_signups WHERE confirmed_at > ?",
                               (time.time() - 7 * 86400,)).fetchone()
    if not enabled() and not (people or waiting):
        return None
    return {"enabled": enabled(), "ready": ready(), "confirmed": people, "unconfirmed": waiting,
            "new_this_week": week, "emails_sent": sent,
            "apps": [{"key": k, "name": n, **count[k]} for k, n in growth.APP_NAMES.items()]}
