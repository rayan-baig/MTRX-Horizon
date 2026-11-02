"""Is each app up? Asked once a minute, kept for a month, and the owner is
told by email when one stays down.

- Each app's public health address (RANKUP_HEALTH_URL and the like) is asked
  with a short deadline, the same way the console asks for the stats. Any
  2xx answer is "up"; anything else, or no answer in time, is "down".
- Every check is saved, so the console can draw the last day and list the
  last week's outages.
- An app down for MTRX_ALERT_MINUTES (5 by default) is reported in the
  console's activity list and, when email is set up, by email. Alerts are
  kept to a few: one per outage, a reminder every few hours while it lasts,
  one "back up" when it ends, never two "down" emails for the same app
  within an hour, and no more than a dozen emails a day in all.
"""

import logging
import smtplib
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait
from email.message import EmailMessage

from . import config, db, stats

# The longest an app gets to answer, start to finish.
CHECK_SECONDS = 4
KEEP_DAYS = 31

# Alerts, kept to a few.
SPACING_SECONDS = 3600          # never two "down" emails for one app within this
REMIND_SECONDS = 6 * 3600       # while an app stays down, a reminder this often
DAILY_CAP = 12                  # emails a day, every app together
SMTP_SECONDS = 15

# The console's strip: the last day in half hours.
BAR_SECONDS = 1800
BARS = 48

log = logging.getLogger("horizon")


# ---------------------------------------------------------------- checking

def check_app(key: str) -> dict:
    """Ask one app whether it is up. Never raises."""
    url = config.get().health_urls.get(key)
    result = {"key": key, "configured": bool(url), "up": None, "ms": None, "status": None}
    if not url:
        return result
    started = time.monotonic()
    try:
        if urllib.parse.urlsplit(url).scheme not in ("http", "https"):
            raise ValueError("not a web address")
        # A plain request with no key: the health address is public.
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        # Redirects are refused (see stats._NoRedirects): a health address
        # should be the final one, and a redirect counts as not answering.
        with stats._OPENER.open(request, timeout=CHECK_SECONDS) as response:
            stats._read(response, started + CHECK_SECONDS, limit=8_000)
            result["status"] = response.status
        result["up"] = 200 <= result["status"] < 300
    except urllib.error.HTTPError as error:
        result["status"] = error.code
        result["up"] = False
    except Exception:
        result["up"] = False
    result["ms"] = round((time.monotonic() - started) * 1000)
    return result


def check_all() -> list:
    """Ask every app at once; whatever has not answered in time is down."""
    pool = ThreadPoolExecutor(max_workers=len(stats.APPS))
    futures = {key: pool.submit(check_app, key) for key in stats.APPS}
    done, _ = wait(futures.values(), timeout=CHECK_SECONDS + 1)
    pool.shutdown(wait=False)
    results = []
    for key, future in futures.items():
        if future in done:
            results.append(future.result())
        else:
            results.append({"key": key, "configured": True, "up": False,
                            "ms": (CHECK_SECONDS + 1) * 1000, "status": None})
    return results


def record(results: list, now: float | None = None):
    """Save each configured app's check, and forget anything over a month old."""
    now = time.time() if now is None else now
    with db.connect() as conn:
        for table in ("health_checks", "health_alerts"):
            conn.execute(f"DELETE FROM {table} WHERE at < ?", (now - KEEP_DAYS * 86400,))
        for r in results:
            if r["configured"]:
                conn.execute(
                    "INSERT INTO health_checks (app, at, up, ms, status) VALUES (?, ?, ?, ?, ?)",
                    (r["key"], now, 1 if r["up"] else 0, r["ms"], r["status"]))


# ---------------------------------------------------------------- reading it back

def _state(conn, key: str):
    """The latest check, and since when the app has been down if it is."""
    last = conn.execute(
        "SELECT at, up, ms, status FROM health_checks WHERE app = ? ORDER BY at DESC LIMIT 1",
        (key,)).fetchone()
    if last is None:
        return None
    since = None
    if not last["up"]:
        (last_up,) = conn.execute(
            "SELECT MAX(at) FROM health_checks WHERE app = ? AND up = 1", (key,)).fetchone()
        (since,) = conn.execute(
            "SELECT MIN(at) FROM health_checks WHERE app = ? AND up = 0 AND at > ?",
            (key, last_up if last_up is not None else 0)).fetchone()
    return {"up": bool(last["up"]), "at": last["at"], "ms": last["ms"],
            "status": last["status"], "down_since": since}


def _uptime(rows) -> float | None:
    return round(100 * sum(r["up"] for r in rows) / len(rows), 2) if rows else None


def summary(now: float | None = None) -> dict:
    """Per app: up or down now, the last day in half hours, the last week's outages."""
    now = time.time() if now is None else now
    settings = config.get()
    out = {}
    with db.connect() as conn:
        for key in stats.APPS:
            entry = {"configured": bool(settings.health_urls.get(key)), "up": None, "ms": None,
                     "status": None, "checked_at": None, "down_since": None,
                     "uptime_day": None, "uptime_week": None,
                     "bars": [None] * BARS, "outages": []}
            out[key] = entry
            if not entry["configured"]:
                continue
            state = _state(conn, key)
            if state is not None:
                entry.update(up=state["up"], ms=state["ms"], status=state["status"],
                             checked_at=state["at"], down_since=state["down_since"])
            week = conn.execute(
                "SELECT at, up FROM health_checks WHERE app = ? AND at > ? ORDER BY at",
                (key, now - 7 * 86400)).fetchall()
            day = [r for r in week if r["at"] > now - 86400]
            entry["uptime_week"], entry["uptime_day"] = _uptime(week), _uptime(day)
            slots = [[] for _ in range(BARS)]
            for r in day:
                slot = int((r["at"] - (now - BARS * BAR_SECONDS)) // BAR_SECONDS)
                slots[min(max(slot, 0), BARS - 1)].append(r["up"])
            entry["bars"] = [round(sum(s) / len(s), 2) if s else None for s in slots]
            outages, start = [], None
            for r in week:
                if not r["up"] and start is None:
                    start = r["at"]
                elif r["up"] and start is not None:
                    outages.append({"start": start, "end": r["at"]})
                    start = None
            if start is not None:
                outages.append({"start": start, "end": None})
            entry["outages"] = outages[::-1][:5]
    return out


# ---------------------------------------------------------------- telling the owner

def _local(host: str) -> bool:
    return host in ("localhost", "127.0.0.1", "::1")


def send_email(subject: str, body: str) -> bool:
    """Email the owner. False if email isn't set up; raises if sending fails.

    Port 465 is encrypted from the start; any other port must offer
    STARTTLS, so the password and the message never cross the internet in
    the clear. Only a mail server on this same machine may go without.
    """
    s = config.get()
    if not (s.alert_email and s.smtp_host and (s.alert_from or s.alert_email)):
        return False
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = s.alert_from or s.alert_email
    message["To"] = s.alert_email
    message.set_content(body)
    context = ssl.create_default_context()
    if s.smtp_port == 465:
        server = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=SMTP_SECONDS, context=context)
    else:
        server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=SMTP_SECONDS)
    with server:
        if s.smtp_port != 465:
            server.ehlo()
            if server.has_extn("starttls"):
                server.starttls(context=context)
                server.ehlo()
            elif not _local(s.smtp_host):
                raise ConnectionError("the mail server offers no encryption")
        if s.smtp_user:
            server.login(s.smtp_user, s.smtp_password)
        server.send_message(message)
    return True


_MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def _clock(at: float) -> str:
    """"14:02 UTC on 2 Nov": always UTC, whatever the server's own zone."""
    t = time.gmtime(at)
    return f"{t.tm_hour:02d}:{t.tm_min:02d} UTC on {t.tm_mday} {_MONTHS[t.tm_mon - 1]}"


def _minutes(seconds: float) -> str:
    m = max(1, round(seconds / 60))
    if m < 120:
        return f"{m} minute{'s' if m != 1 else ''}"
    return f"{m // 60} hours {m % 60} minutes"


def _wording(key: str, kind: str, state: dict, now: float) -> tuple[str, str]:
    name = stats.APPS[key]["name"]
    if kind == "down":
        since = state["down_since"]
        answer = f"it answered {state['status']}" if state["status"] else "it did not answer"
        return (f"{name} is down",
                f"{name} has failed its health check for {_minutes(now - since)}, since "
                f"{_clock(since)}. The last time it was asked, {answer}.\n\n"
                f"You will hear again when it is back up, or in {REMIND_SECONDS // 3600} hours "
                f"if it is still down.\n\n- MTRX Horizyn")
    return (f"{name} is back up",
            f"{name} is answering its health check again (checked {_clock(state['at'])}).\n\n"
            f"- MTRX Horizyn")


def _due(conn, key: str, state: dict, now: float) -> str | None:
    """Which alert this app is owed now, if any."""
    minutes = config.get().alert_minutes
    last = conn.execute(
        "SELECT at, kind FROM health_alerts WHERE app = ? ORDER BY at DESC LIMIT 1",
        (key,)).fetchone()
    if state["up"]:
        # One "back up" for each outage the owner was told about.
        return "up" if last is not None and last["kind"] == "down" else None
    if now - state["down_since"] < minutes * 60:
        return None
    (last_down,) = conn.execute(
        "SELECT MAX(at) FROM health_alerts WHERE app = ? AND kind = 'down'", (key,)).fetchone()
    if last_down is not None and now - last_down < SPACING_SECONDS:
        return None  # told within the hour (an app going up and down, say)
    if last is not None and last["kind"] == "down" and last["at"] >= state["down_since"]:
        # Already told about this outage: only a reminder, now and then.
        return "down" if now - last["at"] >= REMIND_SECONDS else None
    return "down"


def alert(now: float | None = None) -> list:
    """Tell the owner about any app that has been down too long, or is back.
    Returns what was due, for the tests."""
    now = time.time() if now is None else now
    settings = config.get()
    due = []
    with db.connect() as conn:
        for key in stats.APPS:
            if not settings.health_urls.get(key):
                continue
            state = _state(conn, key)
            if state is None:
                continue
            kind = _due(conn, key, state, now)
            if kind:
                due.append((key, kind, state))
        (sent_today,) = conn.execute(
            "SELECT COUNT(*) FROM health_alerts WHERE sent = 1 AND at > ?",
            (now - 86400,)).fetchone()
    for key, kind, state in due:
        subject, body = _wording(key, kind, state, now)
        sent = False
        if sent_today < DAILY_CAP:
            try:
                sent = send_email(subject, body)
            except Exception as error:
                # The reason's kind only: an SMTP error can quote the login.
                log.warning("Alert email for %s not sent: %s", key, type(error).__name__)
                db.log("Alert email failed", f"{subject} ({type(error).__name__})")
        sent_today += 1 if sent else 0
        with db.connect() as conn:
            conn.execute("INSERT INTO health_alerts (app, at, kind, sent) VALUES (?, ?, ?, ?)",
                         (key, now, kind, 1 if sent else 0))
        db.log("App down" if kind == "down" else "App back up",
               subject + (" (emailed)" if sent else ""))
    return [(key, kind) for key, kind, _ in due]


def run_checks():
    """The once-a-minute job: check, save, and tell the owner if needed."""
    if not any(config.get().health_urls.values()):
        return
    record(check_all())
    alert()
