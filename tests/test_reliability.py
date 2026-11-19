"""Keeping working when something goes wrong, and saying so when it can't.

- /readyz: the readiness check an uptime monitor asks.
- The background jobs' watchdog.
- The settings check when the server starts on the live site.
- A slow or stuck outside service (the AI provider, Stripe) can't take the
  site's workers, and a call to one can't go on for ever.
- The public pages keep loading when the database can't be read.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from tests.test_lock import KNOCK, ORIGIN, SETUP, client, make_client  # noqa: F401


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    """Each test starts with no remembered readiness answer and no failing job."""
    from horizon import ready, upkeep
    monkeypatch.delenv("MTRX_PRODUCTION", raising=False)
    ready.forget()
    upkeep._fails.clear()
    yield
    ready.forget()
    upkeep._fails.clear()


# ---------------------------------------------------------------- /readyz

def test_readyz_says_ok_and_shows_nothing_private(client, monkeypatch):
    monkeypatch.setenv("GENESIS_AI_KEY", "sk-secret-value-123")
    monkeypatch.setenv("GENESIS_AI_MODEL", "some-model-id")
    answer = client.get("/readyz")
    assert answer.status_code == 200
    body = answer.json()
    assert body["ok"] is True
    assert body["checks"] == {"database": "ok", "settings": "ok", "background_jobs": "ok"}
    assert answer.headers["Cache-Control"] == "no-store"
    text = answer.text
    for private in ("version", "sk-secret-value-123", "some-model-id", SETUP, " ".join(KNOCK), "horizon.db"):
        assert private not in text
    # Many uptime monitors ask with HEAD.
    assert client.head("/readyz").status_code == 200


def test_readyz_writes_to_the_database(client):
    from horizon import db
    client.get("/readyz")
    with db.connect() as conn:
        row = conn.execute("SELECT at FROM heartbeats WHERE name = 'readyz'").fetchone()
    assert row is not None and time.time() - row["at"] < 30


def test_readyz_is_503_when_the_database_is_gone(client, monkeypatch, tmp_path):
    missing = tmp_path / "gone" / "horizon.db"
    monkeypatch.setenv("MTRX_DB_PATH", str(missing))
    answer = client.get("/readyz")
    assert answer.status_code == 503
    assert answer.json()["checks"]["database"] == "failing"
    # Asking must not make a new, empty database that hides the problem.
    assert not missing.exists()


def test_readyz_is_worked_out_at_most_every_few_seconds(client, monkeypatch):
    from horizon import ready
    calls = []
    real = ready._work_out
    monkeypatch.setattr(ready, "_work_out", lambda: calls.append(1) or real())
    for _ in range(20):
        assert client.get("/readyz").status_code == 200
    assert len(calls) == 1


def test_healthz_stays_cheap_and_up_when_the_database_is_gone(client, monkeypatch, tmp_path):
    monkeypatch.setenv("MTRX_DB_PATH", str(tmp_path / "gone" / "horizon.db"))
    assert client.get("/healthz").status_code == 200


# ---------------------------------------------------------------- the background jobs' watchdog

def test_readyz_is_503_when_the_background_jobs_stop_finishing(client, monkeypatch):
    from horizon import upkeep
    long_ago = time.time() - upkeep.LATE_SECONDS - 60
    monkeypatch.setattr(upkeep, "_started_at", long_ago)
    monkeypatch.setattr(upkeep, "_last_round", long_ago)
    answer = client.get("/readyz")
    assert answer.status_code == 503
    assert answer.json()["checks"]["background_jobs"] == "late"
    # A round finishing puts it right.
    upkeep.run_once()
    from horizon import ready
    ready.forget()
    answer = client.get("/readyz")
    assert answer.status_code == 200
    assert answer.json()["background_jobs_last_ran_seconds_ago"] <= 5


def test_a_dead_background_thread_is_started_again(client):
    from horizon import db, upkeep
    dead = threading.Thread(target=lambda: None)
    dead.start()
    dead.join()
    upkeep._thread = dead          # as if the thread had died
    answer = client.get("/readyz")
    assert answer.status_code == 200
    assert upkeep._thread is not dead and upkeep._thread.is_alive()
    with db.connect() as conn:
        events = [r["event"] for r in conn.execute("SELECT event FROM activity")]
    assert "Background jobs restarted" in events


def test_a_job_that_keeps_failing_is_reported_once_and_fails_readyz(client, monkeypatch):
    from horizon import db, errors, ready, upkeep
    reports = []
    monkeypatch.setattr(errors, "report", lambda method, path, exc, version, wait=False:
                        reports.append((method, path, type(exc).__name__)))
    broken = {"on": True}

    def flaky_job():
        if broken["on"]:
            raise RuntimeError("the job broke")

    others_ran = []
    monkeypatch.setattr(upkeep, "jobs", lambda: (flaky_job, lambda: others_ran.append(1)))
    for _ in range(upkeep.FAILS_TO_REPORT + 2):
        upkeep.run_once()
    assert reports == [("JOB", "test_reliability.flaky_job", "RuntimeError")]
    assert len(others_ran) == upkeep.FAILS_TO_REPORT + 2   # one failing job never stops the others
    answer = client.get("/readyz")
    assert answer.status_code == 503
    assert answer.json()["checks"]["background_jobs"] == "failing"
    assert "flaky_job" not in answer.text   # job names stay in the log

    broken["on"] = False
    upkeep.run_once()
    ready.forget()
    assert client.get("/readyz").status_code == 200
    with db.connect() as conn:
        events = [r["event"] for r in conn.execute("SELECT event FROM activity")]
    assert "Background job working again" in events


def test_each_round_writes_down_when_it_finished(client):
    from horizon import db, upkeep
    upkeep.run_once()
    with db.connect() as conn:
        row = conn.execute("SELECT at FROM heartbeats WHERE name = 'upkeep'").fetchone()
    assert row is not None and abs(row["at"] - upkeep.last_round()) < 1


# ---------------------------------------------------------------- the settings check at start

@pytest.fixture
def live(monkeypatch, tmp_path):
    """The live site's settings, all present."""
    monkeypatch.setenv("MTRX_PRODUCTION", "1")
    monkeypatch.setenv("MTRX_DB_PATH", str(tmp_path / "live.db"))
    monkeypatch.setenv("MTRX_PUBLIC_URL", "https://mtrxhorizyn.example")
    monkeypatch.setenv("MTRX_KNOCK", " ".join(KNOCK))
    monkeypatch.setenv("MTRX_TRUST_PROXY", "1")
    for name in ("MTRX_DEV", "GENESIS_PRO_ENABLED", "EARLY_ACCESS_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def _start():
    from horizon.main import app
    with TestClient(app, base_url="https://testserver") as c:
        return c.get("/readyz").status_code


def test_the_live_site_starts_with_its_settings(live):
    assert _start() == 200


@pytest.mark.parametrize("change, words", [
    (lambda m: m.delenv("MTRX_KNOCK"), "MTRX_KNOCK isn't set"),
    (lambda m: m.setenv("MTRX_KNOCK", "logo rankup"), "MTRX_KNOCK isn't a knock the site understands"),
    (lambda m: m.delenv("MTRX_PUBLIC_URL"), "MTRX_PUBLIC_URL must be the site's own https address"),
    (lambda m: m.setenv("MTRX_PUBLIC_URL", "http://mtrxhorizyn.example"), "MTRX_PUBLIC_URL must be"),
    (lambda m: m.setenv("MTRX_DEV", "1"), "MTRX_DEV is 1"),
])
def test_the_live_site_will_not_half_start_without_a_setting(live, caplog, change, words):
    from horizon import ready
    change(live)
    with pytest.raises(ready.StartupProblem) as stopped:
        _start()
    assert words in str(stopped.value)
    assert "can't start" in caplog.text and words in caplog.text


def test_the_start_message_never_shows_a_settings_value(live, caplog):
    from horizon import ready
    live.setenv("MTRX_KNOCK", "logo secretword rankup mark")
    with pytest.raises(ready.StartupProblem) as stopped:
        _start()
    assert "secretword" not in str(stopped.value) and "secretword" not in caplog.text


def test_off_the_live_site_a_missing_knock_does_not_stop_it(monkeypatch, tmp_path):
    monkeypatch.setenv("MTRX_DB_PATH", str(tmp_path / "dev.db"))
    monkeypatch.delenv("MTRX_KNOCK", raising=False)
    monkeypatch.delenv("MTRX_PUBLIC_URL", raising=False)
    assert _start() == 200


def test_a_feature_switched_on_but_not_set_up_is_logged_not_fatal(live, caplog):
    live.setenv("GENESIS_PRO_ENABLED", "1")
    live.delenv("STRIPE_SECRET_KEY", raising=False)
    assert _start() == 200
    assert "Genesis Pro is switched on but stays off" in caplog.text
    assert "STRIPE_SECRET_KEY" in caplog.text


def test_a_database_that_cannot_be_opened_stops_the_start_in_plain_words(monkeypatch, tmp_path):
    from horizon import ready
    blocker = tmp_path / "not-a-folder"
    blocker.write_text("x")
    monkeypatch.setenv("MTRX_DB_PATH", str(blocker / "horizon.db"))
    with pytest.raises(ready.StartupProblem) as stopped:
        _start()
    assert "can't open its database file" in str(stopped.value)


# ---------------------------------------------------------------- outside services

PROJECT = {"name": "Nova Notes", "pitch": "Homework reminders", "audience": "Students", "stage": "build"}


def test_a_stuck_ai_provider_cannot_take_every_worker(client, monkeypatch):
    """Measured before the fix: 45 asks stuck on a provider that never
    answered held the home page for 59 seconds."""
    from horizon import genesis_ai, outbound
    monkeypatch.setenv("GENESIS_AI_KEY", "test-key")
    monkeypatch.setenv("GENESIS_AI_MODEL", "test-model-from-a-setting")
    monkeypatch.setenv("GENESIS_AI_DAILY_CAP_USD", "100")
    inside, let_go = threading.Semaphore(0), threading.Event()

    def stuck(message, pro=False):
        inside.release()
        let_go.wait(20)
        raise ConnectionError("no answer")

    monkeypatch.setattr(genesis_ai, "_call", stuck)
    body = {"helper": "pitch", "project": PROJECT}
    places = outbound.AT_ONCE["ai"]
    waiting = [threading.Thread(target=genesis_ai.answer, args=(f"10.0.0.{i}", body)) for i in range(places)]
    for t in waiting:
        t.start()
    try:
        for _ in range(places):
            assert inside.acquire(timeout=5)
        got = {}

        def one_more():
            got["answer"] = client.post("/api/genesis/ask", headers=ORIGIN, json=body)

        extra = threading.Thread(target=one_more)
        started = time.monotonic()
        extra.start()
        extra.join(timeout=5)
        assert not extra.is_alive(), "the extra ask waited for the stuck provider"
        assert time.monotonic() - started < 3
        assert got["answer"].status_code == 503
        assert got["answer"].json()["error"] == genesis_ai.FAILED
        assert client.get("/").status_code == 200
    finally:
        let_go.set()
        for t in waiting:
            t.join(10)
    # Once the stuck asks are done, their places are free again.
    monkeypatch.setattr(genesis_ai, "_call", lambda message, pro=False: (_ for _ in ()).throw(ConnectionError()))
    assert client.post("/api/genesis/ask", headers=ORIGIN, json=body).status_code == 502


def test_the_ai_provider_is_given_a_short_time_to_connect(monkeypatch):
    import anthropic

    from horizon import genesis_ai
    made = {}

    class Fake:
        def __init__(self, **kwargs):
            made.update(kwargs)
            self.messages = self

        def create(self, **kwargs):
            return None

    monkeypatch.setattr(anthropic, "Anthropic", Fake)
    monkeypatch.setenv("GENESIS_AI_KEY", "test-key")
    monkeypatch.setenv("GENESIS_AI_MODEL", "test-model-from-a-setting")
    genesis_ai._call("hello")
    timeout = made["timeout"]
    assert timeout.connect == genesis_ai.CONNECT_SECONDS <= 5
    assert timeout.read == genesis_ai.TIMEOUT_SECONDS
    assert made["max_retries"] <= 1


def test_stripe_calls_beyond_their_places_fail_at_once(monkeypatch):
    from horizon import genesis_pro, outbound
    monkeypatch.setattr(genesis_pro, "STRIPE_API", "http://127.0.0.1:9/v1")  # never reached
    held = []
    try:
        for _ in range(outbound.AT_ONCE["stripe"]):
            held.append(outbound.place("stripe"))
            held[-1].__enter__()
        started = time.monotonic()
        with pytest.raises(genesis_pro.StripeError, match="busy"):
            genesis_pro._stripe("prices/price_x", method="GET")
        assert time.monotonic() - started < 0.5
    finally:
        for h in held:
            h.__exit__(None, None, None)


@pytest.fixture
def trickle():
    """A server that starts answering, then sends one byte at a time, slowly."""
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            try:
                for _ in range(60):
                    self.wfile.write(b" ")
                    self.wfile.flush()
                    time.sleep(0.2)
                self.wfile.write(json.dumps({"id": "x"}).encode())
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/v1"
    server.shutdown()


def test_a_trickling_stripe_answer_is_given_up_on_at_the_deadline(monkeypatch, trickle):
    """The timeout is per read; a byte every 0.2 s never trips it. The
    deadline for the whole answer does."""
    from horizon import genesis_pro
    monkeypatch.setattr(genesis_pro, "STRIPE_API", trickle)
    monkeypatch.setattr(genesis_pro, "STRIPE_TIMEOUT", 1)
    started = time.monotonic()
    with pytest.raises(genesis_pro.StripeError):
        genesis_pro._stripe("prices/price_x", method="GET")
    assert time.monotonic() - started < 3


# ---------------------------------------------------------------- the database can't be read

def test_public_pages_keep_loading_when_the_database_cannot_be_read(client, monkeypatch, tmp_path):
    # Which apps are released is in the database, so no Open button shows
    # until it can be read again, even for an app with an address setting.
    monkeypatch.setenv("RANKUP_URL", "https://rankup.example")
    blocker = tmp_path / "disk-gone"
    blocker.write_text("x")
    monkeypatch.setenv("MTRX_DB_PATH", str(blocker / "horizon.db"))
    for path in ("/", "/orbyt", "/partners", "/bundle", "/genesis", "/privacy"):
        answer = client.get(path)
        assert answer.status_code == 200, path
    page = client.get("/").text
    for name in ("RankUp", "CyberLogix AI", "OmniArmor.ai"):
        assert name in page
    assert "https://rankup.example" not in page
    assert "RankUp" in client.get("/orbyt").text
    assert client.get("/readyz").status_code == 503


def test_the_log_says_when_and_how_serious(client):
    import logging
    handlers = logging.getLogger("horizon").handlers
    assert handlers, "the horizon log has no handler, so warnings would print bare"
    line = handlers[0].formatter.format(logging.LogRecord("horizon", logging.WARNING, "", 0, "hello", (), None))
    assert line.endswith("WARNING horizon: hello") and line[:4].isdigit() and "Z " in line
