"""The console's Numbers section: each app's daily totals, month by month.

The fixtures in tests/fixtures/ are each app's /api/stats answer in the exact
shape its own code builds it: CyberLogix AI's usage.py (`usage.daily`, oldest
first), OmniArmor.ai's omniarmor_app/usage.py (`usage.days`, newest first)
and RankUp's api/stats.js with supabase/health.sql (`daily.days`, oldest
first, or `daily: null`). These check each is read right, odd answers are
left out rather than guessed at, the monthly totals survive an app that only
sends 30 days, the advice follows its rules, and only the owner sees any of it.
"""

import copy
import json
import threading
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from tests.test_lock import approved, client, make_client, owner  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"stats_{name}.json").read_text())


def today() -> date:
    return datetime.now(timezone.utc).date()


def days_of(key: str, body: dict) -> list:
    """The list of day rows in an answer, wherever that app keeps it."""
    from horizon import numbers
    outer, inner = numbers.APPS[key]["where"]
    return body[outer][inner]


def ending_today(key: str, body: dict) -> dict:
    """The same answer, moved so its newest day is today (the fixtures were
    made on one day; the console only shows the last 30)."""
    body = copy.deepcopy(body)
    rows = days_of(key, body)
    shift = today() - max(date.fromisoformat(r["day"]) for r in rows)
    for r in rows:
        r["day"] = (date.fromisoformat(r["day"]) + shift).isoformat()
    return body


def day_rows(n: int, end: date, **counts) -> list:
    """n days of the same counts, oldest first, ending on `end`."""
    return [{"day": (end - timedelta(days=b)).isoformat(), "counts": dict(counts)} for b in range(n - 1, -1, -1)]


def month_start(d: date) -> date:
    return d.replace(day=1)


def last_month_days(d: date) -> list:
    first_this = month_start(d)
    last = first_this - timedelta(days=1)
    return [last.replace(day=i) for i in range(1, last.day + 1)]


# ---------------------------------------------------------------- reading each app's answer

def test_cyberlogix_daily_totals_are_read_oldest_first():
    from horizon import numbers
    body = fixture("cyberlogix")
    got = numbers.parse("cyberlogix", body)
    sent = body["usage"]["daily"]
    assert len(got) == 30 and [d["day"] for d in got] == [r["day"] for r in sent]
    for d, r in zip(got, sent):
        assert d["counts"] == {k: v for k, v in r.items() if k != "day"}
    # The 8 counts the app keeps, and none of its extras (totals, meaning, note).
    assert set(got[0]["counts"]) == set(numbers.APPS["cyberlogix"]["labels"]) == set(body["usage"]["meaning"])


def test_omniarmor_newest_first_is_turned_round():
    from horizon import numbers
    body = fixture("omniarmor")
    sent = body["usage"]["days"]
    assert sent[0]["day"] > sent[-1]["day"]  # as the app sends it
    got = numbers.parse("omniarmor", body)
    assert [d["day"] for d in got] == sorted(r["day"] for r in sent)
    assert got[-1]["counts"] == {k: v for k, v in sent[0].items() if k != "day"}
    assert set(got[0]["counts"]) == set(numbers.APPS["omniarmor"]["labels"])


def test_rankup_daily_with_day_last_and_keys_in_any_order():
    from horizon import numbers
    body = fixture("rankup")
    got = numbers.parse("rankup", body)
    assert len(got) == 30 and got[0]["day"] == body["daily"]["days"][0]["day"]
    assert set(got[0]["counts"]) == set(numbers.APPS["rankup"]["labels"])
    assert sum(d["counts"]["chores_accepted"] for d in got) == body["daily"]["totals"]["chores_accepted"]


def test_rankup_without_daily_counts_has_none():
    from horizon import numbers
    assert numbers.parse("rankup", fixture("rankup_no_daily")) is None


@pytest.mark.parametrize("key, body", [
    ("cyberlogix", None), ("cyberlogix", []), ("cyberlogix", "usage"), ("cyberlogix", {}),
    ("cyberlogix", {"usage": None}), ("cyberlogix", {"usage": "lots"}), ("cyberlogix", {"usage": {"daily": "x"}}),
    # Each app's daily totals are where that app puts them, not elsewhere.
    ("cyberlogix", {"daily": {"days": [{"day": "2026-11-01", "signups": 1}]}}),
    ("rankup", {"usage": {"daily": [{"day": "2026-11-01", "families_signed_up": 1}]}}),
    ("omniarmor", {"usage": {"daily": [{"day": "2026-11-01", "signups": 1}]}}),
    ("nosuchapp", {"usage": {"daily": [{"day": "2026-11-01", "signups": 1}]}}),
])
def test_an_answer_with_no_daily_totals_has_none(key, body):
    from horizon import numbers
    assert numbers.parse(key, body) is None


def test_odd_days_and_counts_are_left_out():
    from horizon import numbers
    tomorrow = (today() + timedelta(days=1)).isoformat()
    later = (today() + timedelta(days=5)).isoformat()
    body = {"usage": {"daily": [
        "not a day", 7, None,
        {"signups": 3},                                   # no day
        {"day": "2026-13-01", "signups": 1},              # no such month
        {"day": "2026-02-30", "signups": 1},              # no such day
        {"day": "1 Nov", "signups": 1},
        {"day": 20261101, "signups": 1},
        {"day": later, "signups": 1},                     # ahead of now
        {"day": "2026-11-02", "signups": -1, "sensors_added": True, "test_alerts": 2.5,
         "help_views": "9", "inspector_logs": 2 ** 63, "Bad Name": 4, "x" * 41: 4, "ok_one": 2 ** 63 - 1,
         "acknowledged_text": 0},
        {"day": "2026-11-03", "signups": None},           # nothing usable that day
        {"day": tomorrow, "signups": 2},                  # a clock a little ahead is fine
        {"day": "2026-11-01", "signups": 1},
        {"day": "2026-11-01", "signups": 5},              # the same day again: the last one counts
    ]}}
    got = numbers.parse("cyberlogix", body)
    assert got == [
        {"day": "2026-11-01", "counts": {"signups": 5}},
        {"day": "2026-11-02", "counts": {"ok_one": 2 ** 63 - 1, "acknowledged_text": 0}},
        {"day": tomorrow, "counts": {"signups": 2}},
    ]


def test_an_enormous_answer_is_cut_short():
    from horizon import numbers
    many = [{"day": (today() - timedelta(days=i)).isoformat(), **{f"m{j}": 1 for j in range(60)}}
            for i in range(600)]
    got = numbers.parse("omniarmor", {"usage": {"days": many}})
    assert len(got) == numbers.MAX_DAYS
    assert all(len(d["counts"]) == numbers.MAX_METRICS for d in got)


# ---------------------------------------------------------------- through the console

@pytest.fixture
def apps_server():
    """The three apps' stats addresses, answering with the fixtures."""
    answers = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            key = self.path.strip("/").split("/")[0]
            body = json.dumps(answers.get(key, {})).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}", answers
    server.shutdown()
    server.server_close()


def connect(monkeypatch, base, answers, **bodies):
    for key, body in bodies.items():
        answers[key] = body
        monkeypatch.setenv(f"{key.upper()}_STATS_URL", f"{base}/{key}/api/stats")


def test_the_owner_sees_each_apps_real_numbers(client, monkeypatch, apps_server):
    from horizon import numbers
    base, answers = apps_server
    bodies = {key: ending_today(key, fixture(key)) for key in ("cyberlogix", "omniarmor", "rankup")}
    connect(monkeypatch, base, answers, **bodies)
    owner(client)
    overview = client.get("/api/console/overview").json()
    # The daily totals are saved, not sent with the overview.
    assert all("usage" not in a for a in overview["apps"])
    data = client.get("/api/console/numbers").json()
    assert [a["key"] for a in data["apps"]] == ["rankup", "cyberlogix", "omniarmor"]
    for app in data["apps"]:
        body = bodies[app["key"]]
        rows = sorted(days_of(app["key"], body), key=lambda r: r["day"])
        assert app["connected"] and app["has_data"]
        assert len(app["days"]) == numbers.SHOW_DAYS and app["days"][-1] == today().isoformat()
        assert [m["key"] for m in app["metrics"]] == list(numbers.APPS[app["key"]]["labels"])
        for m in app["metrics"]:
            assert m["days"] == [r[m["key"]] for r in rows]
            assert m["total30"] == sum(r[m["key"]] for r in rows)
            assert m["label"] == numbers.APPS[app["key"]]["labels"][m["key"]]
            this = today().strftime("%Y-%m")
            assert m["this_month"] == sum(r[m["key"]] for r in rows if r["day"].startswith(this))
        # The three things done most, largest first.
        totals = sorted(((m["total30"], m["key"]) for m in app["metrics"] if m["total30"]), key=lambda t: -t[0])
        assert [t["key"] for t in app["top"]] == [k for _, k in totals[:3]]
        assert [t["total"] for t in app["top"]] == [n for n, _ in totals[:3]]
        assert app["advice"]["text"]


def test_an_app_that_is_not_connected_gets_the_empty_state(client):
    owner(client)
    data = client.get("/api/console/numbers").json()
    for app in data["apps"]:
        assert app["connected"] is False and app["has_data"] is False
        assert app["metrics"] == [] and app["top"] == [] and app["advice"] is None
        assert app["setting"] == f"{app['key'].upper()}_STATS_URL"


def test_an_app_without_daily_counts_says_to_update_it(client, monkeypatch, apps_server):
    base, answers = apps_server
    connect(monkeypatch, base, answers, rankup=fixture("rankup_no_daily"))
    owner(client)
    overview = client.get("/api/console/overview").json()
    rankup = next(a for a in overview["apps"] if a["key"] == "rankup")
    assert rankup["online"] is True and rankup["users"] == 61
    app = next(a for a in client.get("/api/console/numbers").json()["apps"] if a["key"] == "rankup")
    assert app["connected"] and not app["has_data"]
    assert app["advice"]["rule"] == "no_data"


def test_a_broken_answer_does_not_break_the_console(client, monkeypatch, apps_server):
    base, answers = apps_server
    connect(monkeypatch, base, answers, cyberlogix={"users": 3, "usage": {"daily": [{"day": "x"}, 5, {"day": None}]}},
            omniarmor={"usage": {"days": [{"day": today().isoformat(), "signups": "lots"}]}})
    owner(client)
    assert client.get("/api/console/overview").status_code == 200
    data = client.get("/api/console/numbers").json()
    for app in data["apps"]:
        assert not app["has_data"]


def test_the_numbers_are_owner_only(client, make_client, monkeypatch, apps_server):
    base, answers = apps_server
    connect(monkeypatch, base, answers, cyberlogix=ending_today("cyberlogix", fixture("cyberlogix")))
    stranger_404 = client.get("/no-such-page")
    approved(client)  # approved but not signed in: still a stranger here
    stranger = make_client()
    for c in (client, stranger):
        response = c.get("/api/console/numbers")
        assert response.status_code == 404 and response.text == stranger_404.text
    # And no stranger's visit asked the apps for anything.
    from horizon import db
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM usage_days").fetchone()[0] == 0


# ---------------------------------------------------------------- month by month

def test_last_month_survives_an_app_that_only_sends_30_days(client):
    from horizon import numbers
    t = today()
    october = last_month_days(t)  # whichever month was last month
    # Earlier in the month: the app's 30 days still held all of last month
    # (or as much of it as the console saw then).
    numbers.save("cyberlogix", [{"day": d.isoformat(), "counts": {"signups": 2}} for d in october])
    # Now the app sends only its last 30 days, which may leave last month.
    numbers.save("cyberlogix", day_rows(30, t, signups=1))
    app = numbers.app_numbers("cyberlogix")
    window = {(t - timedelta(days=b)) for b in range(30)}
    expected_last = sum(1 if d in window else 2 for d in october)
    signups = next(m for m in app["metrics"] if m["key"] == "signups")
    assert signups["last_month"] == expected_last
    assert app["month"]["last_days"] == len(october)
    assert signups["this_month"] == min(t.day, 30) and app["month"]["this_days"] == min(t.day, 30)


def test_a_month_is_kept_in_the_console_database(client):
    from horizon import db, numbers
    t = today()
    numbers.save("omniarmor", day_rows(5, t, checks_updated=3))
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM usage_months WHERE app = 'omniarmor'")]
    by_month = {}
    for d in range(5):
        m = (t - timedelta(days=d)).strftime("%Y-%m")
        by_month[m] = by_month.get(m, 0) + 3
    assert {(r["month"], r["metric"], r["total"]) for r in rows} == {(m, "checks_updated", n) for m, n in by_month.items()}


def test_a_day_sent_again_replaces_and_never_doubles(client):
    from horizon import numbers
    t = today()
    numbers.save("rankup", day_rows(1, t, chores_accepted=4))
    numbers.save("rankup", day_rows(1, t, chores_accepted=9))  # later the same day
    numbers.save("rankup", day_rows(1, t, chores_accepted=9))
    app = numbers.app_numbers("rankup")
    (m,) = app["metrics"]
    assert m["this_month"] == 9 and m["days"][-1] == 9 and m["total30"] == 9


def test_a_month_never_shrinks_once_old_days_are_gone(client):
    from horizon import db, numbers
    t = today()
    october = last_month_days(t)
    numbers.save("cyberlogix", [{"day": d.isoformat(), "counts": {"signups": 1}} for d in october])
    # Its first days are cleared away (as after KEEP_DAYS), then the app
    # sends a window that holds only the end of that month.
    with db.connect() as conn:
        conn.execute("DELETE FROM usage_days WHERE day < ?", (october[10].isoformat(),))
    numbers.save("cyberlogix", [{"day": october[-1].isoformat(), "counts": {"signups": 1}}])
    signups = next(m for m in numbers.app_numbers("cyberlogix")["metrics"] if m["key"] == "signups")
    assert signups["last_month"] == len(october)


def test_old_days_and_months_are_cleared_away(client):
    from horizon import db, numbers
    t = today()
    old_day = (t - timedelta(days=numbers.KEEP_DAYS + 5)).isoformat()
    with db.connect() as conn:
        conn.execute("INSERT INTO usage_days VALUES ('rankup', ?, 'help_views', 1)", (old_day,))
        conn.execute("INSERT INTO usage_months VALUES ('rankup', '2019-01', 'help_views', 1, 31, 0)")
    numbers.save("rankup", day_rows(1, t, help_views=1))
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM usage_days WHERE day = ?", (old_day,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM usage_months WHERE month = '2019-01'").fetchone()[0] == 0


@pytest.mark.parametrize("this_total, this_days, last_total, last_days, change, trend", [
    (42, 10, 90, 30, 40, "up"),       # 4.2 a day against 3: up 40%, though fewer in all so far
    (10, 10, 60, 30, -50, "down"),
    (31, 10, 90, 30, 3, "flat"),
    (5, 10, 0, 30, None, "new"),      # nothing last month, something now
    (0, 10, 0, 30, None, None),
    (5, 10, 9, 0, None, None),        # last month never seen
    (0, 0, 9, 30, None, None),
])
def test_months_are_compared_by_the_average_per_day(this_total, this_days, last_total, last_days, change, trend):
    from horizon import numbers
    got = numbers._change(this_total, this_days, last_total, last_days)
    assert got == change
    assert numbers._trend(got, this_total, last_total, last_days) == trend


# ---------------------------------------------------------------- what to do next

def metric(key, label=None, total30=0, this_month=0, last_month=0, change=None):
    return {"key": key, "label": label or key, "total30": total30, "this_month": this_month,
            "last_month": last_month, "change": change}


@pytest.mark.parametrize("app, metrics, rule, text", [
    ("cyberlogix", [metric("signups", "Sign-ups", 0), metric("test_alerts", total30=0)], "quiet",
     "Nothing happened in the last 30 days: time to find the first customers."),
    ("cyberlogix", [metric("signups", "Sign-ups", 4, 4, 2, 100), metric("test_alerts", total30=0)], "first_step",
     "No test alerts sent: remind new customers to try one."),
    ("omniarmor", [metric("signups", "Sign-ups", 3), metric("checks_updated", total30=0)], "first_step",
     "No checks updated: show new teams how to tick off their first check."),
    ("rankup", [metric("families_signed_up", "Families signed up", 3), metric("chores_accepted", total30=0)],
     "first_step", "No chores accepted yet: remind new families to approve their first chore."),
    ("cyberlogix", [metric("signups", "Sign-ups", 20, 14, 10, 40), metric("test_alerts", total30=5, this_month=3)],
     "signups_up", "Sign-ups are up 40% this month: keep doing what's working."),
    ("rankup", [metric("families_signed_up", "Families signed up", 9, 2, 12, -45),
                metric("chores_accepted", total30=80, this_month=30)],
     "signups_down", "Families signed up are down 45% this month: ask happy customers to pass it on."),
    # Too few last month for a percentage to mean anything.
    ("cyberlogix", [metric("signups", "Sign-ups", 3, 2, 1, 100), metric("test_alerts", total30=1, this_month=1)],
     "steady", "Steady. Most done this month: sign-ups."),
    ("omniarmor", [metric("signups", "Sign-ups", 0), metric("checks_updated", "Checks updated", 40, 12, 30, 5)],
     "no_signups", "People use it, but nobody new joined in 30 days: share it somewhere new."),
    ("omniarmor", [metric("signups", "Sign-ups", 2, 0, 2, -100), metric("checks_updated", "Checks updated", 40, 0, 30)],
     "steady", "Steady. Nothing yet this month."),
])
def test_the_advice_follows_its_rules(app, metrics, rule, text):
    from horizon import numbers
    got = numbers.advice(app, metrics, has_days=True)
    assert got == {"rule": rule, "text": text}


def test_the_advice_for_an_app_with_no_daily_counts():
    from horizon import numbers
    assert numbers.advice("rankup", [], has_days=False)["rule"] == "no_data"


def test_signups_up_40_percent_end_to_end(client):
    """A real month against the one before: the line says so."""
    from horizon import numbers
    t = today()
    last = last_month_days(t)
    numbers.save("cyberlogix", [{"day": d.isoformat(), "counts": {"signups": 5, "test_alerts": 1}} for d in last])
    numbers.save("cyberlogix", [{"day": (month_start(t) + timedelta(days=i)).isoformat(),
                                 "counts": {"signups": 7, "test_alerts": 1}} for i in range(t.day)])
    app = numbers.app_numbers("cyberlogix")
    signups = next(m for m in app["metrics"] if m["key"] == "signups")
    assert signups["change"] == 40 and signups["trend"] == "up"
    assert app["advice"]["text"] == "Sign-ups are up 40% this month: keep doing what's working."


# ---------------------------------------------------------------- the page

def test_the_console_has_a_numbers_section(client):
    owner(client)
    page = client.get("/console").text
    side = page.split('<aside class="sidebar"', 1)[1].split("</aside>", 1)[0]
    assert 'href="#numbers"' in side and ">Numbers</a>" in side
    assert 'id="numbers"' in page and 'id="nu-list"' in page
    assert 'style="' not in page
    script = client.get("/console/assets/console.js").text
    assert 'fetch("/api/console/numbers"' in script and "function drawNumbers" in script
    for unsafe in (".innerHTML", "insertAdjacentHTML", "document.write", ".style."):
        assert unsafe not in script
    css = client.get("/console/assets/console.css").text
    assert ".nu-spark" in css and ".nu-empty" in css
