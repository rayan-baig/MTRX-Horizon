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
import urllib.request

from . import config, db

SNAPSHOT_EVERY = 3600

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
    {"name": "MTRX Horizon", "kind": "Website and console",
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


def _uptime_seconds():
    try:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    except (OSError, ValueError, IndexError):
        return None


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
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def fetch_app(key: str) -> dict:
    """Ask one app for its numbers. Never raises."""
    settings = config.get()
    url = settings.stats_urls.get(key)
    result = {"key": key, **APPS[key], "connected": bool(url), "online": None,
              "users": None, "active_users": None, "url": settings.app_urls.get(key) or None}
    if not url:
        return result
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    if settings.stats_key:
        request.add_header("Authorization", "Bearer " + settings.stats_key)
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            body = json.loads(response.read(64_000))
        result["online"] = True
        if isinstance(body, dict):
            result["users"] = _int_or_none(body.get("users"))
            result["active_users"] = _int_or_none(body.get("active_users"))
    except Exception:
        result["online"] = False
    return result


def snapshot(apps: list):
    """Save each connected app's numbers, at most once an hour."""
    now = time.time()
    with db.connect() as conn:
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
    if not settings.stats_urls or not _refreshing.acquire(blocking=False):
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
            snapshot([fetch_app(key) for key in APPS])
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
    latest = {}
    with db.connect() as conn:
        for key in APPS:
            row = conn.execute(
                "SELECT online, users, active_users FROM app_snapshots"
                " WHERE app = ? ORDER BY at DESC LIMIT 1",
                (key,),
            ).fetchone()
            if row is not None:
                latest[key] = row
    uptimes = [h["uptime"] for h in history(30).values() if h["uptime"] is not None]

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
