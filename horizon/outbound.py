"""How many calls to an outside service may wait at once.

Pages, Genesis's asks and Stripe's calls all share one small pool of
workers. When an outside service hangs (the AI provider, say), every ask
waits up to its timeout. Measured before this was added: with 45 asks stuck
on a provider that never answered, the home page took 59 seconds to load,
because every worker was waiting.

So each outside service gets a few places. A call that finds them all taken
is answered "busy, try again" straight away instead of waiting, and the rest
of the site keeps its workers. A place is held only while the call runs.
"""

import threading
from contextlib import contextmanager

# Places for each service. The site's shared pool has 40 workers, so even
# with every service stuck, more than half are left for pages. Pitch
# Review's AI (orbyt_review_ai.py) is called from its own background
# thread, one review at a time, so it needs only a couple.
AT_ONCE = {"ai": 8, "stripe": 8, "review_ai": 2}

_places = {name: threading.BoundedSemaphore(n) for name, n in AT_ONCE.items()}


class Busy(Exception):
    """Every place for this service is taken. Try again in a moment."""


@contextmanager
def place(service: str):
    """Hold one of `service`'s places for the length of the call, or raise
    Busy at once if there is none free."""
    places = _places[service]
    if not places.acquire(blocking=False):
        raise Busy(service)
    try:
        yield
    finally:
        places.release()
