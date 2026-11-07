"""A record of what Omnicyte warned about, for the security team.

One JSON object per line, so a SIEM agent (Splunk forwarder, Elastic Agent,
Sentinel's AMA, a plain log shipper) can pick it up as it is. It holds what
was decided and why, never the message: no body text, no secrets, and links
only as their host name.
"""

import json
import socket
import threading
import time
from pathlib import Path

from . import __version__, urls

_lock = threading.Lock()


def record(path: Path, verdict, action: str = "warned") -> dict:
    worst_host = urls.host_of(verdict.links[0].destination) if verdict.links and verdict.links[0].score else ""
    entry = {
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(verdict.at)),
        "product": "omnicyte", "version": __version__,
        "computer": socket.gethostname(),
        "source": verdict.source, "where": verdict.where[:80],
        "level": verdict.level, "score": verdict.score,
        "signals": sorted({s.code for s in verdict.signals}),
        "link_host": worst_host,
        "sender_domain": verdict.sender.rsplit("@", 1)[-1].strip("> ") if "@" in verdict.sender else "",
        "action": action,   # warned, reported, dismissed, trusted
    }
    with _lock:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except OSError:
            pass
    return entry
