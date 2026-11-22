"""Small jobs the server runs on its own, once a minute, whether or not
anyone is visiting.

One background thread, started when the server starts and stopped when it
stops. A job that fails is skipped until the next round; it never stops the
others or the site.

It is watched, so it can't stop without anyone noticing:

- The end of every round is noted (and written in the `heartbeats` table,
  "upkeep", so it is still there after a restart). The readiness check (/readyz) answers 503 when no round has finished for
  LATE_SECONDS, which an uptime monitor turns into an email to the owner.
- A job that fails FAILS_TO_REPORT rounds in a row is reported like a server
  error: in the console's activity list and, with email set up, by email.
  /readyz also answers 503 while it keeps failing.
- If the thread itself has died, the readiness check starts it again.
"""

import logging
import threading
import time

from . import (config, creators, db, early_access, errors, genesis_ai, genesis_pro, growth, health, lock,
               orbyt_review, orbyt_review_ai, vortex)

EVERY_SECONDS = 60
# No finished round for this long, and the jobs count as stopped. A round
# is usually well under a second; reading Stripe's prices or a slow app's
# health check can take some seconds, never minutes.
LATE_SECONDS = 5 * 60
FAILS_TO_REPORT = 3


def jobs() -> tuple:
    """Every job, looked up each round (so a test can swap one)."""
    return (lock.forget_old_tries, genesis_ai.forget_old_asks, vortex.forget_old,
            genesis_pro.forget_old, genesis_pro.refresh_prices, orbyt_review.forget_old, orbyt_review_ai.kick,
            early_access.forget_old,
            early_access.kick, creators.forget_old, growth.forget_old_keys, health.run_checks)


LOG = logging.getLogger("horizon")

_stop = threading.Event()
_thread: threading.Thread | None = None
_wanted = False                 # started and not stopped: the thread should be alive
_started_at: float | None = None
_last_round: float | None = None
_fails: dict = {}               # job name -> rounds in a row it has failed


def _name(job) -> str:
    return f"{job.__module__.rsplit('.', 1)[-1]}.{job.__name__}"


def run_once():
    """Every job, once. The loop calls this; so can a test."""
    for job in jobs():
        name = _name(job)
        try:
            job()
        except Exception as exc:
            LOG.exception("Upkeep job %s failed", name)
            _fails[name] = _fails.get(name, 0) + 1
            if _fails[name] == FAILS_TO_REPORT:
                errors.report("JOB", name, exc, config.version())
        else:
            if _fails.get(name, 0) >= FAILS_TO_REPORT:
                LOG.warning("Upkeep job %s works again", name)
                _log("Background job working again", name)
            _fails[name] = 0
    _beat()


def _log(event: str, detail: str):
    try:
        db.log(event, detail)
    except Exception:
        LOG.warning("Could not write to the activity list: %s", event)


def _beat():
    global _last_round
    _last_round = time.time()
    try:
        with db.connect() as conn:
            conn.execute("INSERT INTO heartbeats (name, at) VALUES ('upkeep', ?) "
                         "ON CONFLICT (name) DO UPDATE SET at = excluded.at", (_last_round,))
    except Exception as exc:
        LOG.warning("Upkeep: could not write down that the round finished (%s)", type(exc).__name__)


def last_round() -> float | None:
    """When this server's latest round finished; None if none has yet."""
    return _last_round


def failing() -> list:
    """The jobs that have failed FAILS_TO_REPORT rounds in a row or more."""
    return sorted(name for name, count in _fails.items() if count >= FAILS_TO_REPORT)


def state(now: float | None = None) -> str:
    """"ok", "late" (no round finished for LATE_SECONDS), "failing" (a job
    keeps failing) or "stopped" (the thread isn't running)."""
    now = time.time() if now is None else now
    if not (_thread is not None and _thread.is_alive()):
        return "stopped"
    # Just after a start, the first round is still to come.
    since = max(last_round() or 0, _started_at or 0)
    if now - since > LATE_SECONDS:
        return "late"
    return "failing" if failing() else "ok"


def ensure_running():
    """Start the thread again if it should be running and has died."""
    if _wanted and not (_thread is not None and _thread.is_alive()):
        LOG.warning("Upkeep: the background jobs had stopped; starting them again")
        _log("Background jobs restarted", "they had stopped; the readiness check started them again")
        start()


def _loop():
    # Wait first: the server has only just started, and the tests start and
    # stop it many times a second.
    while not _stop.wait(EVERY_SECONDS):
        run_once()


def start():
    global _thread, _wanted, _started_at
    _wanted = True
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _started_at = time.time()
    _thread = threading.Thread(target=_loop, name="horizon-upkeep", daemon=True)
    _thread.start()


def stop():
    global _thread, _wanted
    _wanted = False
    _stop.set()
    if _thread is not None:
        _thread.join(timeout=5)
    _thread = None
