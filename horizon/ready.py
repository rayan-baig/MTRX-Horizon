"""Is the site set up to run on the internet, and ready to serve right now?

Two jobs:

- When the server starts (check_startup). On the live site and staging
  (MTRX_PRODUCTION=1, which the Dockerfile sets), a missing setting the site
  can't do without stops the start, with a plain message in the log saying
  what to set. Without them it would only half-work: an owner who can't get
  into the console, or emails with no links. Features switched on but not
  set up yet (Genesis Pro, say) don't stop it: they stay off, as before, and
  the log lists what they still need.
- The readiness check, /readyz (readiness). Asked by an uptime monitor once
  a minute or so. 200 when the database can be written to, the settings are
  complete and the background jobs are running; 503 with the name of what
  is wrong otherwise. It never shows a setting's value, a version or
  anything about a visitor, and it is worked out at most once every few
  seconds however often it is asked.
"""

import logging
import os
import sqlite3
import threading
import time

from . import config, early_access, genesis_pro, upkeep

LOG = logging.getLogger("horizon")

CACHE_SECONDS = 5
DB_SECONDS = 2


class StartupProblem(RuntimeError):
    """The server can't start; the message says why, in plain words."""


def production() -> bool:
    """The live site or staging: set by the Dockerfile, not by hand."""
    return os.environ.get("MTRX_PRODUCTION", "") == "1"


def _knock_problem() -> str:
    raw = os.environ.get("MTRX_KNOCK", "").strip()
    if config.get().knock:
        return ""
    if raw:
        return ("MTRX_KNOCK isn't a knock the site understands. It needs at least 4 taps, using only "
                f"these names: {', '.join(config.KNOCK_TARGETS)}. Without a working one you can't get "
                "into your console.")
    return "MTRX_KNOCK isn't set. Without it you can't get into your console."


def must_fix() -> list:
    """On the live site: the settings it can't do without, in plain words.
    Empty when all is well, and always empty off the live site."""
    if not production():
        return []
    s = config.get()
    out = []
    if s.dev:
        out.append("MTRX_DEV is 1. It lets sign-in work without https, so it must never be on a site "
                   "on the internet. Delete it.")
    if not (s.public_url.startswith("https://") and config._web_address(s.public_url)):
        out.append("MTRX_PUBLIC_URL must be the site's own https address, such as "
                   "https://mtrxhorizyn.com. Links in emails and the QR codes use it.")
    knock = _knock_problem()
    if knock:
        out.append(knock)
    return out


def worth_a_look() -> list:
    """Settings that don't stop the site, but leave something off or quiet.
    Written to the log when the server starts."""
    s = config.get()
    out = []
    if not production() and os.environ.get("MTRX_KNOCK", "").strip() and not s.knock:
        out.append(_knock_problem())
    out += [f"Genesis Pro is switched on but stays off until this is done: {p}" for p in genesis_pro.problems()]
    out += [f"Early access is switched on but stays hidden until this is done: {p}"
            for p in early_access.setup_problems()]
    if bool(s.genesis_ai_key) != bool(s.genesis_ai_model):
        out.append("Ask Genesis stays off until both GENESIS_AI_KEY and GENESIS_AI_MODEL are set.")
    if production():
        if not (s.alert_email and s.smtp_host):
            out.append("Alert email isn't set up (MTRX_ALERT_EMAIL and MTRX_SMTP_HOST), so you won't be "
                       "emailed about errors or apps that are down.")
        if not s.trust_proxy:
            out.append("MTRX_TRUST_PROXY isn't 1. Behind Render's proxy it should be (render.yaml sets "
                       "it), or every visitor shares one address and one set of limits.")
    return out


def check_startup():
    """Run once as the server starts. Raises StartupProblem when it can't."""
    for line in worth_a_look():
        LOG.warning("Setup: %s", line)
    problems = must_fix()
    if problems:
        message = ("MTRX Horizyn can't start, because of its settings:\n"
                   + "".join(f"  - {p}\n" for p in problems)
                   + "Fix them in the host's settings (on Render: the service's Environment page), and it "
                     "starts again by itself. docs/OPERATIONS.md has more.")
        LOG.critical(message)
        raise StartupProblem(message)


def database_problem(exc: BaseException) -> StartupProblem:
    """The plain message for a database that can't be opened at start."""
    message = (f"MTRX Horizyn can't start: it can't open its database file at {config.get().db_path} "
               f"({type(exc).__name__}). On Render, check the service still has its disk "
               "(the Disks page) and that MTRX_DB_PATH is /app/data/horizon.db.")
    LOG.critical(message)
    return StartupProblem(message)


# ---------------------------------------------------------------- readiness

_cache: dict = {"at": float("-inf"), "answer": None}
_cache_lock = threading.Lock()


def _database() -> str:
    """"ok" if the database can be written to now, else "failing"."""
    path = config.get().db_path
    try:
        if not path.is_file():
            # Connecting would make a new, empty database and hide the problem.
            raise FileNotFoundError("the database file is missing")
        conn = sqlite3.connect(path, timeout=DB_SECONDS)
        try:
            conn.execute("INSERT INTO heartbeats (name, at) VALUES ('readyz', ?) "
                         "ON CONFLICT (name) DO UPDATE SET at = excluded.at", (time.time(),))
            conn.commit()
        finally:
            conn.close()
        return "ok"
    except Exception as exc:
        LOG.warning("Readiness: the database can't be written to (%s)", type(exc).__name__)
        return "failing"


def _work_out() -> tuple[int, dict]:
    upkeep.ensure_running()
    checks = {
        "database": _database(),
        "settings": "missing" if must_fix() else "ok",
        "background_jobs": upkeep.state(),
    }
    if checks["background_jobs"] != "ok":
        LOG.warning("Readiness: background jobs are %s (%s)", checks["background_jobs"],
                    ", ".join(upkeep.failing()) or "no job named")
    last = upkeep.last_round()
    ok = all(v == "ok" for v in checks.values())
    return (200 if ok else 503), {
        "ok": ok,
        "checks": checks,
        "background_jobs_last_ran_seconds_ago": None if last is None else max(0, round(time.time() - last)),
    }


def readiness() -> tuple[int, dict]:
    """(status, answer) for /readyz, worked out at most every CACHE_SECONDS."""
    with _cache_lock:
        now = time.monotonic()
        if _cache["answer"] is None or now - _cache["at"] >= CACHE_SECONDS:
            _cache.update(at=now, answer=_work_out())
        return _cache["answer"]


def forget():
    """Drop the remembered answer (tests)."""
    with _cache_lock:
        _cache.update(at=float("-inf"), answer=None)
