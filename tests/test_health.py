"""The console's health checks, and the alerts when an app stays down.

The apps are played by a small local web server whose answer each test
sets, and email by a small local mail server that keeps what it is sent.
"""

import socketserver
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from tests.test_lock import client, make_client, owner  # noqa: F401

ALERT_TO = "alerts@example.com"


@pytest.fixture
def fake_app():
    """An app's health address: answers with whatever status `state` says."""
    state = {"status": 200, "delay": 0, "headers": [], "location": None}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            state["headers"].append(dict(self.headers))
            if state["delay"]:
                time.sleep(state["delay"])
            self.send_response(state["status"])
            if state["location"]:
                self.send_header("Location", state["location"])
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok": true}')

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/api/health", state
    server.shutdown()


@pytest.fixture
def mail_server():
    """A mail server that keeps every message, and every login, it is sent.
    It offers no encryption, which the site allows only on this machine."""
    got = {"messages": [], "logins": []}

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            def say(line):
                self.wfile.write((line + "\r\n").encode())

            say("220 fake mail server")
            lines, in_data = [], False
            while True:
                raw = self.rfile.readline()
                if not raw:
                    return
                text = raw.decode().rstrip("\r\n")
                if in_data:
                    if text == ".":
                        got["messages"].append("\n".join(lines))
                        lines, in_data = [], False
                        say("250 kept")
                    else:
                        lines.append(text[1:] if text.startswith("..") else text)
                    continue
                verb = text.split(" ", 1)[0].upper()
                if verb == "EHLO":
                    say("250-fake")
                    say("250 AUTH PLAIN LOGIN")
                elif verb == "AUTH":
                    got["logins"].append(text)
                    say("235 fine")
                elif verb == "DATA":
                    in_data = True
                    say("354 go on")
                elif verb == "QUIT":
                    say("221 bye")
                    return
                else:
                    say("250 ok")

    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server.server_address[1], got
    server.shutdown()
    server.server_close()


def email_settings(monkeypatch, port, host="localhost"):
    monkeypatch.setenv("MTRX_ALERT_EMAIL", ALERT_TO)
    monkeypatch.setenv("MTRX_SMTP_HOST", host)
    monkeypatch.setenv("MTRX_SMTP_PORT", str(port))
    monkeypatch.setenv("MTRX_SMTP_USER", "console@example.com")
    monkeypatch.setenv("MTRX_SMTP_PASSWORD", "mail-password-not-for-logs")


def minute_by_minute(start, minutes, until=None):
    """Check the apps once a "minute" from `start`, as the upkeep loop does,
    and run the alerts after each check. Returns everything that was due."""
    from horizon import health
    due = []
    for m in range(minutes):
        now = start + 60 * m
        health.record(health.check_all(), now=now)
        due += [(m, key, kind) for key, kind in health.alert(now=now)]
        if until and until(m):
            break
    return due


def activity():
    from horizon import db
    with db.connect() as conn:
        return [(r["event"], r["detail"]) for r in conn.execute(
            "SELECT event, detail FROM activity ORDER BY id")]


# ---------------------------------------------------------------- the console

def test_the_console_shows_each_apps_health_users_and_history(client, monkeypatch, fake_app):
    import json
    import threading as _t
    from http.server import HTTPServer

    url, state = fake_app
    stats_body = json.dumps({"users": 42, "active_users": 7}).encode()

    class Stats(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(stats_body)

        def log_message(self, *args):
            pass

    stats_server = HTTPServer(("127.0.0.1", 0), Stats)
    _t.Thread(target=stats_server.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv("RANKUP_HEALTH_URL", url)
        monkeypatch.setenv("RANKUP_STATS_URL", f"http://127.0.0.1:{stats_server.server_port}/s")
        # CyberLogix is down: its health address is a dead port.
        monkeypatch.setenv("CYBERLOGIX_HEALTH_URL", "http://127.0.0.1:9/api/health")
        owner(client)
        data = client.get("/api/console/overview").json()
    finally:
        stats_server.shutdown()

    rankup, clx, omni = (data["health"][k] for k in ("rankup", "cyberlogix", "omniarmor"))
    assert rankup["configured"] and rankup["up"] is True and isinstance(rankup["ms"], int)
    assert rankup["status"] == 200 and rankup["down_since"] is None
    assert rankup["uptime_day"] == 100.0 and rankup["bars"][-1] == 1 and len(rankup["bars"]) == 48
    assert clx["configured"] and clx["up"] is False and clx["down_since"] is not None
    assert clx["bars"][-1] == 0 and clx["outages"][0]["end"] is None
    assert omni["configured"] is False and omni["up"] is None
    # Users come from the stats address, on the same screen.
    app = next(a for a in data["apps"] if a["key"] == "rankup")
    assert app["users"] == 42
    assert data["alerts"] == {"minutes": 5, "email": False}
    # The page has the places the script fills in.
    page = client.get("/console").text
    assert 'id="ov-up"' in page and 'id="alert-hint"' in page and 'id="platform-list"' in page


def test_history_shows_outages_and_the_last_day(client, monkeypatch, fake_app):
    from horizon import health
    url, state = fake_app
    monkeypatch.setenv("RANKUP_HEALTH_URL", url)
    now = time.time()
    # Up, then down for 10 minutes two hours ago, then up again.
    for m in range(180):
        at = now - 3 * 3600 + 60 * m
        up = not (60 <= m < 70)
        health.record([{"key": "rankup", "configured": True, "up": up, "ms": 50,
                        "status": 200 if up else 503}], now=at)
    entry = health.summary(now)["rankup"]
    assert entry["up"] is True and entry["down_since"] is None
    (outage,) = entry["outages"]
    assert outage["end"] - outage["start"] == 600
    assert entry["uptime_day"] == round(100 * 170 / 180, 2)
    assert 0 < min(b for b in entry["bars"] if b is not None) < 1  # a half hour with some down
    assert entry["bars"][0] is None  # nothing was checked 24 hours ago


def test_a_slow_health_address_cannot_hold_up_the_console(client, monkeypatch, fake_app):
    url, state = fake_app
    state["delay"] = 10
    monkeypatch.setenv("OMNIARMOR_HEALTH_URL", url)
    owner(client)
    started = time.monotonic()
    data = client.get("/api/console/overview").json()
    assert time.monotonic() - started < 8
    assert data["health"]["omniarmor"]["up"] is False


def test_a_health_check_sends_no_key_and_takes_no_redirect(client, monkeypatch, fake_app):
    from horizon import health
    url, state = fake_app
    monkeypatch.setenv("RANKUP_HEALTH_URL", url)
    monkeypatch.setenv("MTRX_STATS_KEY", "stats-key-for-the-stats-address-only")
    assert health.check_app("rankup")["up"] is True
    assert "Authorization" not in state["headers"][-1]
    # A redirect is not followed, and is not "up".
    state["status"], state["location"] = 302, "http://127.0.0.1:9/elsewhere"
    result = health.check_app("rankup")
    assert result["up"] is False and result["status"] == 302


@pytest.mark.parametrize("status, up", [(200, True), (204, True), (500, False), (503, False), (404, False)])
def test_only_a_2xx_answer_is_up(monkeypatch, fake_app, status, up):
    from horizon import health
    url, state = fake_app
    state["status"] = status
    monkeypatch.setenv("CYBERLOGIX_HEALTH_URL", url)
    assert health.check_app("cyberlogix")["up"] is up


def test_the_console_never_shows_the_mail_login(client, monkeypatch, mail_server):
    port, _ = mail_server
    email_settings(monkeypatch, port)
    owner(client)
    text = client.get("/api/console/overview").text
    assert "mail-password-not-for-logs" not in text and ALERT_TO not in text
    assert '"email":true' in text.replace(" ", "")


# ---------------------------------------------------------------- alerts

def test_the_owner_is_emailed_when_an_app_fails_for_n_minutes(client, monkeypatch, fake_app, mail_server):
    url, state = fake_app
    port, mail = mail_server
    email_settings(monkeypatch, port)
    monkeypatch.setenv("RANKUP_HEALTH_URL", url)
    monkeypatch.setenv("MTRX_ALERT_MINUTES", "5")
    state["status"] = 503
    start = time.time() - 3600

    # Failing from the first check: nothing for 4 minutes, then one email
    # at 5 minutes, and nothing more while it stays down.
    due = minute_by_minute(start, 12)
    assert due == [(5, "rankup", "down")]
    (message,) = mail["messages"]
    assert "Subject: RankUp is down" in message and f"To: {ALERT_TO}" in message
    assert "failed its health check for 5 minutes" in message and "it answered 503" in message
    assert mail["logins"], "the mail server's login was used"

    # Back up: one "back up" email.
    state["status"] = 200
    due = minute_by_minute(start + 12 * 60, 3)
    assert due == [(0, "rankup", "up")]
    assert len(mail["messages"]) == 2 and "Subject: RankUp is back up" in mail["messages"][1]
    events = [e for e, _ in activity()]
    assert events.count("App down") == 1 and events.count("App back up") == 1
    assert ("App down", "RankUp is down (emailed)") in activity()


def test_a_short_blip_sends_nothing(client, monkeypatch, fake_app, mail_server):
    url, state = fake_app
    port, mail = mail_server
    email_settings(monkeypatch, port)
    monkeypatch.setenv("RANKUP_HEALTH_URL", url)
    start = time.time() - 3600
    state["status"] = 500
    assert minute_by_minute(start, 3) == []
    state["status"] = 200
    assert minute_by_minute(start + 180, 3) == []
    assert mail["messages"] == []


def test_alerts_are_kept_to_a_few(client, monkeypatch, fake_app):
    """An app going up and down does not flood the inbox: no two "down"
    emails within the hour, a reminder only every few hours, and a cap a day."""
    from horizon import health
    url, state = fake_app
    monkeypatch.setenv("RANKUP_HEALTH_URL", url)
    sent = []
    monkeypatch.setattr(health, "send_email", lambda subject, body: sent.append(subject) or True)
    t = time.time() - 20 * 3600

    def run(status, minutes):
        nonlocal t
        state["status"] = status
        due = minute_by_minute(t, minutes)
        t += 60 * minutes
        return [kind for _, _, kind in due]

    assert run(500, 6) == ["down"]
    assert run(200, 2) == ["up"]
    # Down again within the hour: not told again.
    assert run(500, 20) == []
    # Still down an hour after the first email: told about this new outage.
    assert run(500, 40) == ["down"]
    # Still down: a reminder only after six hours, not every minute.
    assert run(500, 5 * 60) == []
    assert run(500, 65) == ["down"]
    assert sent == ["RankUp is down", "RankUp is back up", "RankUp is down", "RankUp is down"]

    # However many apps and outages, no more than a dozen emails a day.
    monkeypatch.setattr(health, "DAILY_CAP", 4)
    assert run(200, 1) == ["up"]
    assert sent[-1] == "RankUp is down"  # the "back up" was held back
    assert ("App back up", "RankUp is back up") in activity()


def test_with_no_email_set_up_the_alert_still_reaches_the_console(client, monkeypatch, fake_app):
    from horizon import db
    url, state = fake_app
    monkeypatch.setenv("CYBERLOGIX_HEALTH_URL", url)
    state["status"] = 500
    assert minute_by_minute(time.time() - 3600, 6) == [(5, "cyberlogix", "down")]
    assert ("App down", "CyberLogix AI is down") in activity()
    with db.connect() as conn:
        assert [tuple(r) for r in conn.execute("SELECT app, kind, sent FROM health_alerts")] == [
            ("cyberlogix", "down", 0)]


def test_mail_is_never_sent_unencrypted_across_the_network(client, monkeypatch, fake_app, mail_server, caplog):
    """The fake mail server offers no STARTTLS. On this machine that is
    allowed; anywhere else the email is refused rather than sent in the clear."""
    from horizon import health
    url, state = fake_app
    port, mail = mail_server
    email_settings(monkeypatch, port)
    # The same server, but as if it were somewhere else on the network.
    monkeypatch.setattr(health, "_local", lambda host: False)
    monkeypatch.setenv("OMNIARMOR_HEALTH_URL", url)
    state["status"] = 500
    due = minute_by_minute(time.time() - 3600, 6)
    assert due == [(5, "omniarmor", "down")]
    assert mail["messages"] == [] and mail["logins"] == []
    assert ("Alert email failed", "OmniArmor.ai is down (ConnectionError)") in activity()
    assert "mail-password-not-for-logs" not in caplog.text


def test_the_upkeep_loop_checks_the_apps_on_its_own(client, monkeypatch, fake_app):
    from horizon import db, upkeep
    url, state = fake_app
    monkeypatch.setenv("RANKUP_HEALTH_URL", url)
    upkeep.stop()
    monkeypatch.setattr(upkeep, "EVERY_SECONDS", 0.1)
    upkeep.start()
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with db.connect() as conn:
                (n,) = conn.execute("SELECT COUNT(*) FROM health_checks").fetchone()
            if n >= 2:
                break
            time.sleep(0.05)
    finally:
        upkeep.stop()
    assert n >= 2 and state["headers"]


def test_no_health_address_means_no_checks(client, monkeypatch):
    from horizon import db, health
    health.run_checks()
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM health_checks").fetchone()[0] == 0
    assert all(not v["configured"] for v in health.summary().values())


def test_old_checks_are_forgotten(client, monkeypatch):
    from horizon import db, health
    old = time.time() - 40 * 86400
    with db.connect() as conn:
        conn.execute("INSERT INTO health_checks (app, at, up) VALUES ('rankup', ?, 1)", (old,))
        conn.execute("INSERT INTO health_alerts (app, at, kind, sent) VALUES ('rankup', ?, 'down', 1)", (old,))
    health.record([{"key": "rankup", "configured": True, "up": True, "ms": 1, "status": 200}])
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM health_checks").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM health_alerts").fetchone()[0] == 0
