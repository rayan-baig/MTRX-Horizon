"""Small jobs the server runs on its own, once a minute, whether or not
anyone is visiting.

One background thread, started when the server starts and stopped when it
stops. A job that fails is skipped until the next round; it never stops the
others or the site.
"""

import logging
import threading

from . import genesis_ai, health, lock

EVERY_SECONDS = 60

_stop = threading.Event()
_thread: threading.Thread | None = None


def run_once():
    """Every job, once. The loop calls this; so can a test."""
    for job in (lock.forget_old_tries, genesis_ai.forget_old_asks, health.run_checks):
        try:
            job()
        except Exception:
            logging.getLogger("horizon").exception("Upkeep job %s failed", job.__name__)


def _loop():
    # Wait first: the server has only just started, and the tests start and
    # stop it many times a second.
    while not _stop.wait(EVERY_SECONDS):
        run_once()


def start():
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="horizon-upkeep", daemon=True)
    _thread.start()


def stop():
    global _thread
    _stop.set()
    if _thread is not None:
        _thread.join(timeout=5)
    _thread = None
