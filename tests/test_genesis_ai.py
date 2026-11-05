"""Ask Genesis: free AI help with a visitor's idea.

Every test talks to a fake AI provider on this computer (the SDK is pointed
at it with ANTHROPIC_BASE_URL), so no real request is ever made.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from tests.test_lock import ORIGIN, client, make_client  # noqa: F401

SECRET = "zebra-lantern-7731"  # stands for a visitor's words; must never be kept
PROJECT = {"name": "Nova Notes", "pitch": f"Homework reminders {SECRET}", "audience": "Students",
           "stage": "build"}


@pytest.fixture
def provider(monkeypatch):
    """A fake AI provider. `state` says how it answers and keeps what it got."""
    state = {"calls": [], "mode": "ok", "usage": {"input_tokens": 300, "output_tokens": 120}}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("content-length", "0"))
            body = json.loads(self.rfile.read(length))
            state["calls"].append({"path": self.path, "body": body,
                                   "key": self.headers.get("x-api-key")
                                   or self.headers.get("authorization", "").removeprefix("Bearer ")})
            mode = state["mode"]
            if mode == "slow":
                time.sleep(1.5)
            if mode == "error":
                payload = {"type": "error", "error": {"type": "invalid_request_error",
                           "message": f"could not read: {body['messages'][0]['content']}"}}
                return self._send(400, payload)
            if mode == "down":
                return self._send(529, {"type": "error", "error": {"type": "overloaded_error",
                                                                   "message": "Overloaded"}})
            refused = mode == "refusal"
            self._send(200, {
                "id": "msg_test", "type": "message", "role": "assistant", "model": body["model"],
                "content": [] if refused else [{"type": "text", "text": "Try it with three classmates first."}],
                "stop_reason": "refusal" if refused else "end_turn", "stop_sequence": None,
                "usage": state["usage"],
            })

        def _send(self, status, payload):
            raw = json.dumps(payload).encode()
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *args):
            pass

    # One thread per request: a "slow" answer still sleeping must not hold up
    # the next request, which then timed out too and made the tests flaky.
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("ANTHROPIC_BASE_URL", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setenv("GENESIS_AI_KEY", "test-key")
    monkeypatch.setenv("GENESIS_AI_MODEL", "test-model-from-a-setting")
    for name in ("GENESIS_AI_PER_HOUR", "GENESIS_AI_PER_DAY", "GENESIS_AI_DAILY_CAP_USD",
                 "GENESIS_AI_INPUT_PRICE", "GENESIS_AI_OUTPUT_PRICE", "GENESIS_AI_EFFORT",
                 "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    yield state
    server.shutdown()


def ask(client, helper="first", question="", project=PROJECT, headers=ORIGIN, **extra):
    body = {"project": project, "helper": helper, "question": question, **extra}
    return client.post("/api/genesis/ask", json=body, headers=headers)


def test_without_a_key_or_model_ai_help_is_off(client, monkeypatch):
    from horizon import db
    monkeypatch.delenv("GENESIS_AI_KEY", raising=False)
    monkeypatch.delenv("GENESIS_AI_MODEL", raising=False)
    assert 'data-ai="off"' in client.get("/genesis").text
    response = ask(client)
    assert response.status_code == 503 and response.json()["enabled"] is False
    assert "isn't switched on yet" in response.json()["error"]
    # A key alone is not enough: the model has to be set too.
    monkeypatch.setenv("GENESIS_AI_KEY", "test-key")
    assert ask(client).status_code == 503
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM genesis_asks").fetchone()[0] == 0


def test_a_visitor_gets_an_answer_and_only_the_idea_is_sent(client, provider):
    assert 'data-ai="on"' in client.get("/genesis").text
    response = ask(client, notes="private notes", ticks={"name": True}, extra_field="x")
    assert response.status_code == 200, response.text
    assert response.json() == {"answer": "Try it with three classmates first.", "helper": "first"}
    assert "set-cookie" not in response.headers
    assert response.headers["cache-control"] == "no-store"
    (call,) = provider["calls"]
    sent = call["body"]
    assert call["path"] == "/v1/messages" and call["key"] == "test-key"
    assert sent["model"] == "test-model-from-a-setting"
    assert sent["max_tokens"] <= 1200
    assert set(sent) <= {"model", "max_tokens", "system", "messages", "output_config"}
    (message,) = sent["messages"]
    text = message["content"]
    for field in ("Nova Notes", SECRET, "Students", "Build"):
        assert field in text
    assert "private notes" not in json.dumps(sent) and "extra_field" not in json.dumps(sent)
    assert "personal" in sent["system"] and "only help" in sent["system"]


def test_every_helper_and_a_question(client, provider):
    from horizon import genesis_ai
    for helper in genesis_ai.HELPERS:
        assert ask(client, helper).status_code == 200
    assert ask(client, "question", "How do I find my first users?").status_code == 200
    assert "<question>\nHow do I find my first users?\n</question>" in provider["calls"][-1]["body"]["messages"][0]["content"]
    assert ask(client, "question", "   ").status_code == 400
    assert ask(client, "write-my-homework").status_code == 400


@pytest.mark.parametrize("change", [
    {"question": "x" * 301, "helper": "question"},
    {"project": {**PROJECT, "name": "n" * 61}},
    {"project": {**PROJECT, "pitch": "p" * 141}},
    {"project": {**PROJECT, "audience": "a" * 121}},
    {"project": {**PROJECT, "name": ""}},
    {"project": {**PROJECT, "name": ["not", "text"]}},
    {"project": "not a project"},
])
def test_oversized_or_odd_input_is_refused_before_any_call(client, provider, change):
    body = {"project": PROJECT, "helper": "first", "question": "", **change}
    response = client.post("/api/genesis/ask", json=body, headers=ORIGIN)
    assert response.status_code == 400 and response.json()["error"]
    assert provider["calls"] == []


def test_a_huge_body_is_not_read(client, provider):
    response = client.post("/api/genesis/ask", headers={**ORIGIN, "Content-Type": "application/json"},
                           content=json.dumps({"project": PROJECT, "helper": "first",
                                               "question": "x" * 20_000}))
    assert response.status_code == 400 and provider["calls"] == []


def test_another_site_cannot_ask(client, provider):
    for headers in ({}, {"Origin": "https://evil.example"}, {"Origin": "https://rankup.testserver"}):
        response = ask(client, headers=headers)
        assert response.status_code == 403
    assert provider["calls"] == []


def test_each_visitor_has_an_hourly_and_daily_limit(client, provider, monkeypatch):
    monkeypatch.setenv("MTRX_TRUST_PROXY", "1")
    monkeypatch.setenv("GENESIS_AI_PER_HOUR", "2")
    monkeypatch.setenv("GENESIS_AI_PER_DAY", "3")
    one = {**ORIGIN, "X-Forwarded-For": "203.0.113.5"}
    two = {**ORIGIN, "X-Forwarded-For": "198.51.100.9"}
    assert ask(client, headers=one).status_code == 200
    assert ask(client, headers=one).status_code == 200
    busy = ask(client, headers=one)
    assert busy.status_code == 429 and "a lot" in busy.json()["error"]
    # Someone else is not held back by it.
    assert ask(client, headers=two).status_code == 200
    assert len(provider["calls"]) == 3
    # The hour passes; the day's limit still holds.
    from horizon import db
    with db.connect() as conn:
        conn.execute("UPDATE genesis_asks SET at = at - 3700")
    assert ask(client, headers=one).status_code == 200
    assert ask(client, headers=one).status_code == 429


def test_the_daily_spend_cap_stops_asks_for_everyone(client, provider, monkeypatch):
    from horizon import genesis_ai
    # With the default prices one ask could cost 9 cents at most.
    monkeypatch.setenv("GENESIS_AI_DAILY_CAP_USD", "0.05")
    response = ask(client)
    assert response.status_code == 429 and "resting" in response.json()["error"]
    assert provider["calls"] == []
    monkeypatch.setenv("GENESIS_AI_DAILY_CAP_USD", "0.12")
    assert ask(client).status_code == 200
    # What was set aside is replaced by what the answer cost: 300 in, 120 out.
    assert genesis_ai.spent_today() == pytest.approx((300 * 10 + 120 * 50) / 1e6)
    assert ask(client).status_code == 200
    # A big answer uses the rest of the day's money.
    provider["usage"] = {"input_tokens": 1000, "output_tokens": 1500}
    assert ask(client).status_code == 200
    assert ask(client).status_code == 429
    assert len(provider["calls"]) == 3


def test_a_bad_cap_setting_falls_back_to_the_small_default(monkeypatch):
    from horizon import config
    for typed in ("lots", "-1", "nan", "inf"):
        monkeypatch.setenv("GENESIS_AI_DAILY_CAP_USD", typed)
        assert config.get().genesis_ai_daily_cap_usd == 2.0


def test_a_refusal_gets_a_kind_answer(client, provider):
    provider["mode"] = "refusal"
    response = ask(client, "question", "Something off topic")
    assert response.status_code == 200 and response.json()["refused"] is True
    assert "can't help with that one" in response.json()["answer"]


def test_a_slow_or_broken_provider_gets_a_friendly_message(client, provider, monkeypatch):
    from horizon import genesis_ai
    monkeypatch.setattr(genesis_ai, "TIMEOUT_SECONDS", 0.5)
    provider["mode"] = "slow"
    response = ask(client)
    assert response.status_code == 504 and "try again" in response.json()["error"]
    provider["mode"] = "down"
    monkeypatch.setattr(genesis_ai, "TIMEOUT_SECONDS", 10)  # this one is about the error, not the wait
    response = ask(client)
    assert response.status_code in (502, 503) and "try again" in response.json()["error"]
    # A failed ask costs nothing against the daily cap.
    assert genesis_ai.spent_today() == 0


def test_the_visitors_words_are_never_logged_or_stored(client, provider, monkeypatch, caplog):
    """Not in the database, the server log, or an error report: not after an
    answer, not when the provider quotes the request back in an error, and
    not when something unexpected breaks."""
    from horizon import db, errors, genesis_ai
    reports = []
    monkeypatch.setattr(errors, "report", lambda *a, **k: reports.append((a, k)))
    with caplog.at_level("DEBUG"):
        assert ask(client, "question", f"Is {SECRET} a good name?").status_code == 200
        provider["mode"] = "error"
        assert ask(client).status_code == 502
        monkeypatch.setattr(genesis_ai, "_call", lambda message: (_ for _ in ()).throw(ValueError(message)))
        broken = ask(client)
        assert broken.status_code == 502 and SECRET not in broken.text
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "Ask Genesis" in logged  # the failures were logged, by their kind only
    assert SECRET not in logged
    assert SECRET not in repr(reports)
    with db.connect() as conn:
        dump = "\n".join(conn.iterdump())
    assert SECRET not in dump and "Nova Notes" not in dump
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM genesis_asks").fetchone()[0] == 3


def test_who_asked_is_forgotten_after_a_day(client, provider):
    from horizon import db, upkeep
    assert ask(client).status_code == 200
    with db.connect() as conn:
        conn.execute("UPDATE genesis_asks SET at = at - 25 * 3600")
        conn.execute("UPDATE genesis_spend SET at = at - 49 * 3600")
    upkeep.run_once()
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM genesis_asks").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM genesis_spend").fetchone()[0] == 0


def test_no_model_name_is_written_into_the_code():
    """The model comes from GENESIS_AI_MODEL, so none is named in this
    public repository."""
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    pattern = re.compile(r"claude-[a-z0-9]+-\d|\b(opus|sonnet|haiku|fable|mythos)\b", re.IGNORECASE)
    files = [*root.glob("horizon/*.py"), *root.glob("static/js/*.js"), *root.glob("templates/*.html"),
             root / "README.md", root / "CHANGELOG.md", root / ".env.example", *root.glob("docs/*.md")]
    hits = [str(p.relative_to(root)) for p in files if p.exists() and pattern.search(p.read_text())]
    assert hits == [], hits
