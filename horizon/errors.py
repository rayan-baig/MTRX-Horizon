"""Tell the owner when the site hits an unexpected error.

A short email to the same address as the "app is down" alerts
(MTRX_ALERT_EMAIL), when email is set up. It says when, which version, the
method and path, the kind of error and where in the code it happened.

Nothing about the visitor goes in it: no cookies, headers, body, address,
or query string. Anything in the error's own words that looks like an email
address, a long code or a device link is blanked out, since a message can
quote what it was given.

At most one email per kind of error an hour, and 20 a day, counted in the
database so a restart does not start the count again.
"""

import hashlib
import logging
import re
import sys
import threading
import time
import traceback

from . import config, db, health

PER_ERROR_SECONDS = 3600
PER_DAY = 20

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
# Long runs of letters and digits: setup codes, invite links, session tokens.
_TOKEN = re.compile(r"[A-Za-z0-9_\-+/=]{20,}")
_DEVICE_LINK = re.compile(r"/console/add/\S*")

def scrub(text: str) -> str:
    text = _DEVICE_LINK.sub("/console/add/[hidden]", text)
    text = _EMAIL.sub("[email]", text)
    return _TOKEN.sub("[hidden]", text)


def _relative(text: str) -> str:
    """File paths from the project or from installed packages, shortened."""
    for prefix in sorted({str(config.ROOT), *sys.path}, key=len, reverse=True):
        if prefix and len(prefix) > 1:
            text = text.replace(prefix.rstrip("/") + "/", "")
    return text


def fingerprint(exc: BaseException) -> str:
    """The same error at the same place gives the same fingerprint."""
    frames = traceback.extract_tb(exc.__traceback__)
    where = f"{frames[-1].filename}:{frames[-1].lineno}" if frames else ""
    return hashlib.sha256(f"{type(exc).__name__}|{_relative(where)}".encode()).hexdigest()[:12]


def build(method: str, path: str, exc: BaseException, version: str, now: float) -> tuple[str, str]:
    kind = type(exc).__name__
    trace = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    when = health._clock(now)
    subject = f"MTRX Horizyn: server error ({kind})"
    body = (
        f"The MTRX Horizyn site hit an error it did not expect.\n\n"
        f"When:     {when}\n"
        f"Version:  {version}\n"
        f"Request:  {method} {scrub(path)}\n"
        f"Error:    {kind}: {scrub(str(exc))[:500]}\n"
        f"Ref:      {fingerprint(exc)}\n\n"
        f"Where it happened:\n{scrub(_relative(trace))[-6000:]}\n"
        f"Nothing about the visitor is in this email. You get at most one\n"
        f"email an hour per error, and {PER_DAY} a day.\n"
    )
    return subject, body


def _claim(fp: str, now: float) -> bool:
    """Write this error down, and say whether it may be emailed."""
    with db.connect() as conn:
        conn.execute("DELETE FROM error_reports WHERE at < ?", (now - 2 * 86400,))
        recent = conn.execute(
            "SELECT 1 FROM error_reports WHERE fingerprint = ? AND sent = 1 AND at > ?",
            (fp, now - PER_ERROR_SECONDS)).fetchone()
        today = conn.execute(
            "SELECT COUNT(*) FROM error_reports WHERE sent = 1 AND at > ?",
            (now - 86400,)).fetchone()[0]
        send = recent is None and today < PER_DAY
        conn.execute("INSERT INTO error_reports (fingerprint, at, sent) VALUES (?, ?, ?)",
                     (fp, now, int(send)))
        return send


def _send(subject: str, body: str):
    try:
        health.send_email(subject, body)
    except Exception as exc:  # the reason's kind only: an SMTP error can quote the login
        logging.getLogger("horizon").warning("Error report not sent: %s", type(exc).__name__)


def report(method: str, path: str, exc: BaseException, version: str, wait: bool = False):
    """Record the error in the console's activity list, and email it if allowed.

    The email goes from its own thread so the visitor's error page is not
    held up by the mail server. `wait` is for tests.
    """
    now = time.time()
    try:
        db.log("Server error", f"{type(exc).__name__} on {method} {scrub(path)}")
        s = config.get()
        if not (s.alert_email and s.smtp_host) or not _claim(fingerprint(exc), now):
            return
        subject, body = build(method, path, exc, version, now)
    except Exception:
        logging.getLogger("horizon").exception("Could not record an error report")
        return
    thread = threading.Thread(target=_send, args=(subject, body), daemon=True)
    thread.start()
    if wait:
        thread.join(timeout=30)
