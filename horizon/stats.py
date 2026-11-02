"""The numbers on the console. Every one of them is real.

- Server health is read from this machine.
- App numbers come from each app's stats address, if one is set. An app
  that isn't connected says so instead of showing a made-up number.
- The chart is drawn from snapshots saved here, at most one per app per hour.
"""

import json
import threading
import os
import shutil
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait

from . import config, db

SNAPSHOT_EVERY = 3600
KEEP_DAYS = 400  # a little over the console's longest range (366 days)
# The longest an app gets to answer, start to finish.
FETCH_SECONDS = 4

APPS = {
    "rankup": {
        "name": "RankUp",
        "tags": ["Gamification", "Family", "Rewards"],
        "color": "green",
    },
    "cyberlogix": {
        "name": "CyberLogix AI",
        "tags": ["Monitoring", "Alerts", "Proof"],
        "color": "blue",
    },
    "omniarmor": {
        "name": "OmniArmor.ai",
        "tags": ["Compliance", "Deadlines", "Records"],
        "color": "violet",
    },
}

# Where each project really stands. Update this by hand as things move.
PROJECTS = [
    {"name": "MTRX Horizyn", "kind": "Website and console",
     "status": "In progress", "next": "Choose hosting and a domain"},
    {"name": "CyberLogix AI", "kind": "Equipment monitoring",
     "status": "Built", "next": "First real sensor reading at a test site"},
    {"name": "OmniArmor.ai", "kind": "Compliance",
     "status": "Built", "next": "Billing for the compliance service"},
    {"name": "RankUp", "kind": "Family chores game",
     "status": "Built", "next": "A week of use with a real family"},
]


# ---------------------------------------------------------------- this server

def _meminfo():
    try:
        with open("/proc/meminfo") as f:
            info = {line.split(":")[0]: int(line.split()[1]) for line in f}
        total, free = info["MemTotal"], info.get("MemAvailable", info["MemFree"])
        return round(100 * (total - free) / total)
    except (OSError, KeyError, ValueError, ZeroDivisionError):
        return None


def _cpu():
    try:
        load = os.getloadavg()[0]
        return min(100, round(100 * load / (os.cpu_count() or 1)))
    except (OSError, AttributeError):
        return None


# When this server process started. The console's "Server running for" used
# /proc/uptime, which on a hosting platform is how long the host machine has
# been up (often weeks), not how long this site has been running.
_STARTED = time.monotonic()


def _uptime_seconds():
    return int(time.monotonic() - _STARTED)


def server():
    disk = None
    try:
        usage = shutil.disk_usage(config.get().db_path.parent)
        disk = round(100 * usage.used / usage.total)
    except OSError:
        pass
    return {"cpu": _cpu(), "memory": _meminfo(), "storage": disk, "uptime": _uptime_seconds()}


# ---------------------------------------------------------------- the apps

def _int_or_none(value):
    # Above 2**63 - 1 the database cannot store it, and saving the snapshot
    # failed, which took the whole console down with it.
    ok = isinstance(value, int) and not isinstance(value, bool) and 0 <= value < 2 ** 63
    return value if ok else None


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    """Refuse to follow a redirect.

    urllib copies the Authorization header onto a redirect, even to another
    host or from https to plain http, so an app's stats address that answered
    with a redirect would have handed the stats key to wherever it pointed.
    """

    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirects)


def _blank(key: str) -> dict:
    settings = config.get()
    return {"key": key, **APPS[key], "connected": bool(settings.stats_urls.get(key)),
            "online": None, "users": None, "active_users": None,
            "url": settings.app_urls.get(key) or None}


def _read(response, deadline: float, limit: int = 64_000) -> bytes:
    """Read the answer, giving up at the deadline.

    The timeout given to open() is per read, not for the whole answer, so
    an app sending a byte every few seconds could hold the console for as
    long as it liked.
    """
    body = b""
    while len(body) < limit:
        if time.monotonic() > deadline:
            raise TimeoutError("the app took too long to answer")
        chunk = response.read1(limit - len(body))
        if not chunk:
            break
        body += chunk
    return body


def fetch_app(key: str) -> dict:
    """Ask one app for its numbers. Never raises."""
    settings = config.get()
    url = settings.stats_urls.get(key)
    result = _blank(key)
    if not url:
        return result
    deadline = time.monotonic() + FETCH_SECONDS
    try:
        # Building the request was outside the try, so an address missing
        # its https:// raised here and took the whole console down. And
        # only web addresses: urllib would also read file:// and ftp://.
        if urllib.parse.urlsplit(url).scheme not in ("http", "https"):
            raise ValueError("not a web address")
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        if settings.stats_key:
            request.add_header("Authorization", "Bearer " + settings.stats_key)
        with _OPENER.open(request, timeout=FETCH_SECONDS) as response:
            body = json.loads(_read(response, deadline))
        result["online"] = True
        if isinstance(body, dict):
            result["users"] = _int_or_none(body.get("users"))
            result["active_users"] = _int_or_none(body.get("active_users"))
    except Exception:
        result["online"] = False
    return result


def fetch_all() -> list:
    """Ask every app at once, and stop waiting after FETCH_SECONDS.

    fetch_app keeps to its own deadline once an app starts answering, but
    an app can also be slow to send its headers, or its name slow to look
    up. Whatever has not answered in time counts as not answering, and the
    page goes ahead without it.
    """
    pool = ThreadPoolExecutor(max_workers=len(APPS))
    futures = {key: pool.submit(fetch_app, key) for key in APPS}
    done, _ = wait(futures.values(), timeout=FETCH_SECONDS + 1)
    pool.shutdown(wait=False)
    apps = []
    for key, future in futures.items():
        if future in done:
            apps.append(future.result())
        else:
            late = _blank(key)
            late["online"] = False
            apps.append(late)
    return apps


def snapshot(apps: list):
    """Save each connected app's numbers, at most once an hour."""
    now = time.time()
    with db.connect() as conn:
        # The console shows at most the last 366 days; older snapshots only
        # made the database grow for ever.
        conn.execute("DELETE FROM app_snapshots WHERE at < ?", (now - KEEP_DAYS * 86400,))
        for app in apps:
            if not app["connected"]:
                continue
            (last,) = conn.execute(
                "SELECT MAX(at) FROM app_snapshots WHERE app = ?", (app["key"],)
            ).fetchone()
            if last is None or now - last >= SNAPSHOT_EVERY:
                conn.execute(
                    "INSERT INTO app_snapshots (app, at, online, users, active_users)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (app["key"], now, 1 if app["online"] else 0, app["users"], app["active_users"]),
                )


def history(days: int = 30) -> dict:
    """Users over time per app, plus the share of checks each app was up."""
    since = time.time() - days * 86400
    out = {}
    with db.connect() as conn:
        for key in APPS:
            rows = conn.execute(
                "SELECT at, online, users FROM app_snapshots WHERE app = ? AND at > ?"
                " ORDER BY at",
                (key, since),
            ).fetchall()
            points = [[round(r["at"]), r["users"]] for r in rows if r["users"] is not None]
            uptime = round(100 * sum(r["online"] for r in rows) / len(rows), 2) if rows else None
            out[key] = {"points": points, "uptime": uptime}
    return out


# ---------------------------------------------------------------- the home page

_refreshing = threading.Lock()


def refresh_in_background():
    """Fetch fresh app numbers without making anybody wait for them.

    The home page shows the last saved numbers. If those are over an hour
    old, one background fetch is started and the next visitor sees the
    result. At most one runs at a time, and nothing happens when no app
    is connected.
    """
    settings = config.get()
    # stats_urls always names all three apps; what matters is whether any
    # of them has an address.
    if not any(settings.stats_urls.values()) or not _refreshing.acquire(blocking=False):
        return
    try:
        with db.connect() as conn:
            (last,) = conn.execute("SELECT MAX(at) FROM app_snapshots").fetchone()
    except Exception:
        _refreshing.release()
        return
    if last is not None and time.time() - last < SNAPSHOT_EVERY:
        _refreshing.release()
        return

    def run():
        try:
            snapshot(fetch_all())
        except Exception:
            pass
        finally:
            _refreshing.release()

    threading.Thread(target=run, daemon=True).start()


def public_numbers() -> dict:
    """What the home page may say about the apps: real, or nothing.

    Read from the saved snapshots only, so a slow or broken app can never
    slow the home page down. Every figure is None until an app is
    connected and has reported, and the page says so rather than guess.
    """
    # Only apps that are connected now. An app whose stats address was taken
    # away kept its old numbers on the home page forever.
    connected = [key for key in APPS if config.get().stats_urls.get(key)]
    latest = {}
    with db.connect() as conn:
        for key in connected:
            row = conn.execute(
                "SELECT online, users, active_users FROM app_snapshots"
                " WHERE app = ? ORDER BY at DESC LIMIT 1",
                (key,),
            ).fetchone()
            if row is not None:
                latest[key] = row
    recent = history(30)
    uptimes = [recent[k]["uptime"] for k in connected if recent[k]["uptime"] is not None]

    def total(field):
        values = [r[field] for r in latest.values() if r[field] is not None]
        return sum(values) if values else None

    return {
        "users_online": total("active_users"),
        "total_users": total("users"),
        "apps_online": sum(1 for r in latest.values() if r["online"]) if latest else None,
        "apps_total": len(APPS),
        "uptime": round(sum(uptimes) / len(uptimes), 2) if uptimes else None,
    }
