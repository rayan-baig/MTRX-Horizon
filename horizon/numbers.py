"""The console's Numbers section: what people do in each app, month by month.

Each app's private stats address (stats.py) also answers with daily totals
of a few things people do, numbers only and never who:

- CyberLogix AI, under `usage`: `daily`, a list of days oldest first, each
  `{"day": "2026-11-13", "signups": 2, ...}` (its usage.py, `last_days`).
- OmniArmor.ai, under `usage`: `days`, the same kind of list but newest
  first (its omniarmor_app/usage.py, `last_days`).
- RankUp, under `daily`: `days`, oldest first, or null when its database
  has no daily counts yet (its api/stats.js and supabase/health.sql).

Every app sends only the last 30 days, so each day's totals are kept here
(`usage_days`), and each month's totals are added up from them and kept
(`usage_months`). This month can then be set against last month even when
last month has left the app's 30 days.

A month in progress is compared fairly: by the average per day counted, so
the 10th of the month is not "down 70%" on the whole of last month.

Nothing here is made up. An app that isn't connected, or that has not sent
daily totals yet, says so.
"""

import re
import time
from datetime import date, timedelta

from . import config, db

# Kept long enough to hold any month an app's 30 days can still reach.
KEEP_DAYS = 100
# A little over three years of monthly totals; a few rows a month.
KEEP_MONTHS = 37
SHOW_DAYS = 30

# The most an app's answer is read for, however much it sends.
MAX_DAYS = 400
MAX_METRICS = 40

_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
_METRIC = re.compile(r"[a-z][a-z0-9_]{0,39}")

# Each app: where its daily totals are, what each count is called here,
# and which counts the advice rules read.
APPS = {
    "rankup": {
        "where": ("daily", "days"),
        "labels": {
            "families_signed_up": "Families signed up",
            "chores_accepted": "Chores accepted",
            "rewards_bought": "Rewards bought",
            "games_played": "Games played",
            "schools_signed_up": "Schools signed up",
            "help_views": "Help pages viewed",
        },
        "signups": "families_signed_up",
        "first_step": "chores_accepted",
        "nudge": "No chores accepted yet: remind new families to approve their first chore",
    },
    "cyberlogix": {
        "where": ("usage", "daily"),
        "labels": {
            "signups": "Sign-ups",
            "sensors_added": "Sensors added",
            "test_alerts": "Test alerts sent",
            "acknowledged_button": "Alerts answered in the console",
            "acknowledged_text": "Alerts answered by text",
            "acknowledged_keypress": "Alerts answered on a call",
            "inspector_logs": "Inspector's logs made",
            "help_views": "Help pages viewed",
        },
        "signups": "signups",
        "first_step": "test_alerts",
        "nudge": "No test alerts sent: remind new customers to try one",
    },
    "omniarmor": {
        "where": ("usage", "days"),
        "labels": {
            "checks_updated": "Checks updated",
            "bulk_updates": "Bulk updates",
            "lessons_started": "Lessons started",
            "lessons_passed": "Lessons passed",
            "certificates": "Certificates earned",
            "help_views": "Help pages viewed",
            "signups": "Sign-ups",
        },
        "signups": "signups",
        "first_step": "checks_updated",
        "nudge": "No checks updated: show new teams how to tick off their first check",
    },
}

# How big a change has to be before the advice mentions it, and how many a
# month has to have had for a percentage to mean anything.
BIG_CHANGE = 25
SMALL_CHANGE = 5
ENOUGH = 3


def _today() -> date:
    """Today in UTC, the day the apps count in."""
    return date(*time.gmtime()[:3])


def _count(value):
    """A count, or None: a whole number from 0 up that the database can hold."""
    ok = isinstance(value, int) and not isinstance(value, bool) and 0 <= value < 2 ** 63
    return value if ok else None


def _day(value, latest: date):
    """A day as "YYYY-MM-DD", or None for anything else or a day ahead of now."""
    if not isinstance(value, str) or not _DAY.fullmatch(value):
        return None
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return None
    return value if day <= latest else None


def label(key: str, metric: str) -> str:
    known = APPS.get(key, {}).get("labels", {})
    return known.get(metric) or metric.replace("_", " ").capitalize()


# ---------------------------------------------------------------- reading an app's answer

def parse(key: str, body) -> list | None:
    """The daily totals in one app's stats answer, oldest day first:
    [{"day": "YYYY-MM-DD", "counts": {metric: n}}]. None when the answer
    has none (an older version of the app, or a database not set up for
    them yet). Anything odd is left out rather than guessed at."""
    spec = APPS.get(key)
    if spec is None or not isinstance(body, dict):
        return None
    outer, inner = spec["where"]
    block = body.get(outer)
    if not isinstance(block, dict):
        return None
    rows = block.get(inner)
    if not isinstance(rows, list):
        return None
    # A day or so of difference between the app's clock and this one.
    latest = _today() + timedelta(days=1)
    days: dict = {}
    for row in rows[:MAX_DAYS]:
        if not isinstance(row, dict):
            continue
        day = _day(row.get("day"), latest)
        if day is None:
            continue
        counts = {}
        for metric, value in row.items():
            if metric == "day" or not isinstance(metric, str) or not _METRIC.fullmatch(metric):
                continue
            n = _count(value)
            if n is not None and len(counts) < MAX_METRICS:
                counts[metric] = n
        if counts:
            days[day] = counts
    return [{"day": d, "counts": days[d]} for d in sorted(days)]


# ---------------------------------------------------------------- keeping it

def save(key: str, days: list, now: float | None = None):
    """Keep each day's totals, and add up each month the days touch.

    A day sent again replaces what was kept (today's totals grow through
    the day). A month's total never shrinks to fewer days than it had: once
    old days are gone from here, a month is not recounted from what is left.
    """
    if not days:
        return
    now = time.time() if now is None else now
    months = sorted({d["day"][:7] for d in days})
    with db.connect() as conn:
        for d in days:
            for metric, n in d["counts"].items():
                conn.execute(
                    "INSERT INTO usage_days (app, day, metric, n) VALUES (?, ?, ?, ?) "
                    "ON CONFLICT (app, day, metric) DO UPDATE SET n = excluded.n",
                    (key, d["day"], metric, n))
        for month in months:
            (counted,) = conn.execute(
                "SELECT COUNT(DISTINCT day) FROM usage_days WHERE app = ? AND substr(day, 1, 7) = ?",
                (key, month)).fetchone()
            (before,) = conn.execute(
                "SELECT MAX(days_counted) FROM usage_months WHERE app = ? AND month = ?",
                (key, month)).fetchone()
            if before is not None and counted < before:
                continue
            conn.execute("DELETE FROM usage_months WHERE app = ? AND month = ?", (key, month))
            conn.execute(
                "INSERT INTO usage_months (app, month, metric, total, days_counted, at) "
                "SELECT app, ?, metric, SUM(n), ?, ? FROM usage_days "
                "WHERE app = ? AND substr(day, 1, 7) = ? GROUP BY metric",
                (month, counted, now, key, month))
        oldest_day = (_today() - timedelta(days=KEEP_DAYS)).isoformat()
        conn.execute("DELETE FROM usage_days WHERE day < ?", (oldest_day,))
        conn.execute("DELETE FROM usage_months WHERE month < ?", (_months_back(_today(), KEEP_MONTHS),))


def _months_back(today: date, n: int) -> str:
    y, m = today.year, today.month - n
    while m < 1:
        y, m = y - 1, m + 12
    return f"{y:04d}-{m:02d}"


# ---------------------------------------------------------------- the dashboard

def _change(this_total, this_days, last_total, last_days):
    """This month against last, by the average per day counted. None when
    there is nothing to compare with."""
    if not this_days or not last_days:
        return None
    this_pace, last_pace = this_total / this_days, last_total / last_days
    if last_pace == 0:
        return None
    return round(100 * (this_pace - last_pace) / last_pace)


def _trend(change, this_total, last_total, last_days):
    if change is None:
        if last_days and last_total == 0 and this_total > 0:
            return "new"
        return None
    if change >= SMALL_CHANGE:
        return "up"
    if change <= -SMALL_CHANGE:
        return "down"
    return "flat"


def _month(conn, key: str, month: str) -> tuple[dict, int]:
    rows = conn.execute("SELECT metric, total, days_counted FROM usage_months WHERE app = ? AND month = ?",
                        (key, month)).fetchall()
    return {r["metric"]: r["total"] for r in rows}, max((r["days_counted"] for r in rows), default=0)


def advice(key: str, metrics: list, has_days: bool) -> dict:
    """One short "what to do next" line, from simple rules, in this order:

    1. No daily totals yet: update the app.
    2. Nothing at all in 30 days: find the first customers.
    3. People signed up but none took the first step (the test alert, the
       first check, the first chore): the app's own nudge.
    4. Sign-ups up or down by BIG_CHANGE% or more this month (per day, with
       at least ENOUGH last month): say so.
    5. No sign-ups in 30 days, though people use it: share it.
    6. Otherwise: the most done thing this month.
    """
    spec = APPS[key]
    if not has_days:
        return {"rule": "no_data", "text": "No daily counts yet: update the app so its stats include them."}
    by_key = {m["key"]: m for m in metrics}
    if not any(m["total30"] for m in metrics):
        return {"rule": "quiet", "text": "Nothing happened in the last 30 days: time to find the first customers."}
    signups = by_key.get(spec["signups"])
    first = by_key.get(spec["first_step"])
    if signups and signups["total30"] and first is not None and first["total30"] == 0:
        return {"rule": "first_step", "text": spec["nudge"] + "."}
    if signups and signups["change"] is not None and signups["last_month"] >= ENOUGH:
        if signups["change"] >= BIG_CHANGE:
            return {"rule": "signups_up",
                    "text": f"{signups['label']} are up {signups['change']}% this month: keep doing what's working."}
        if signups["change"] <= -BIG_CHANGE:
            return {"rule": "signups_down",
                    "text": f"{signups['label']} are down {-signups['change']}% this month: "
                            "ask happy customers to pass it on."}
    if signups and signups["total30"] == 0:
        return {"rule": "no_signups",
                "text": "People use it, but nobody new joined in 30 days: share it somewhere new."}
    busiest = max(metrics, key=lambda m: m["this_month"])
    if busiest["this_month"]:
        return {"rule": "steady", "text": f"Steady. Most done this month: {busiest['label'].lower()}."}
    return {"rule": "steady", "text": "Steady. Nothing yet this month."}


def app_numbers(key: str, today: date | None = None) -> dict:
    """One app's card: the last 30 days per count, this month against last,
    the three things done most, and the advice."""
    from . import stats  # stats uses this module

    today = today or _today()
    info = stats.APPS[key]
    settings = config.get()
    out = {"key": key, "name": info["name"], "color": info["color"],
           "connected": bool(settings.stats_urls.get(key)),
           "setting": f"{key.upper()}_STATS_URL"}
    first = today - timedelta(days=SHOW_DAYS - 1)
    this_month = today.strftime("%Y-%m")
    last_month = _months_back(today, 1)
    with db.connect() as conn:
        rows = conn.execute("SELECT day, metric, n FROM usage_days WHERE app = ? AND day >= ? AND day <= ?",
                            (key, first.isoformat(), today.isoformat())).fetchall()
        this_totals, this_days = _month(conn, key, this_month)
        last_totals, last_days = _month(conn, key, last_month)
    days = [(first + timedelta(days=i)).isoformat() for i in range(SHOW_DAYS)]
    known = {(r["day"], r["metric"]): r["n"] for r in rows}
    seen_days = {r["day"] for r in rows}
    # Every count the app has sent: its own known ones first, in its order.
    names = set(m for _, m in known) | set(this_totals) | set(last_totals)
    order = [m for m in APPS[key]["labels"] if m in names] + sorted(names - set(APPS[key]["labels"]))
    metrics = []
    for metric in order:
        series = [known.get((d, metric), 0 if d in seen_days else None) for d in days]
        this_total, last_total = this_totals.get(metric, 0), last_totals.get(metric, 0)
        change = _change(this_total, this_days, last_total, last_days)
        metrics.append({
            "key": metric, "label": label(key, metric), "days": series,
            "total30": sum(n for n in series if n), "this_month": this_total, "last_month": last_total,
            "change": change, "trend": _trend(change, this_total, last_total, last_days),
        })
    has_days = bool(rows) or bool(this_days) or bool(last_days)
    top = sorted((m for m in metrics if m["total30"]), key=lambda m: (-m["total30"], order.index(m["key"])))[:3]
    out.update({
        "has_data": has_days,
        "days": days,
        "metrics": metrics,
        "top": [{"key": m["key"], "label": m["label"], "total": m["total30"]} for m in top],
        "month": {"this": this_month, "last": last_month, "this_days": this_days, "last_days": last_days},
        "advice": advice(key, metrics, has_days) if out["connected"] or has_days else None,
    })
    return out


def dashboard(today: date | None = None) -> dict:
    from . import stats

    today = today or _today()
    return {"today": today.isoformat(), "show_days": SHOW_DAYS,
            "apps": [app_numbers(key, today) for key in stats.APPS]}
