"""Orbyt Pitch Review, written by AI (1.23.0).

In AI mode the review a grown-up paid for is written by an AI service that
speaks the OpenAI-compatible "chat completions" way (many have a free tier),
checked, and emailed by itself. These check: the settings and the mode; that
the grown-up agrees at checkout; webhook -> job -> email, without the webhook
ever waiting; the checks on the AI's answer, the one retry, and the hand-over
to the owner; the daily cap; the console's view, Resend and Refund; the
honest words in each mode; and that nothing reaches the AI for a pitch
without a paid, agreed review.

The AI service is a fake one on this computer, and Stripe is the fake one from
test_genesis_pro. No real request is made and no email is sent.
"""

import json
import re
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from tests.test_genesis_pro import SESSION, event, mail, stripe, wait_for  # noqa: F401
from tests.test_lock import ORIGIN, client, make_client, owner  # noqa: F401
from tests.test_orbyt_review import (BUYER, checkout, flat, last_message_id, orders, paid, pitch, review,  # noqa: F401
                                     send)
from tests.test_vortex import PITCH, SECRET

ROOT = Path(__file__).resolve().parent.parent
KEY = "test-free-tier-key"
MODEL = "test-review-model-from-a-setting"


def good_review(extra: str = "") -> str:
    """A review that passes every check: the four parts, 3 steps, ~300 words."""
    para = ("Your idea is clear and kind, and it solves a real problem that many students have every week. "
            "You explain who it is for in a few words, which makes it easy to picture someone using it. ")
    return (f"What's strong\n{para * 3}\n\n"
            f"What to fix\n{para * 2}Try to say what makes it different from a paper planner.{extra}\n\n"
            "Your next 3 steps\n"
            "1. Ask five classmates what they forget most often, and write their answers down.\n"
            "2. Draw the three main screens on paper and show them to two friends.\n"
            "3. Keep planning it for free at mtrxhorizyn.com/genesis and tick off the Spark steps.\n\n"
            f"Might it fit Orbyt?\nIt is close to the helpful tools MTRX Horizyn likes. {para}"
            "Any next step would come in a separate reply from the team.")


@pytest.fixture
def provider():
    """A fake OpenAI-compatible service. Put (status, body) pairs, or a
    review's words, in `answers` to choose what it says next; it says a
    good review once they run out. `requests` keeps what it was sent."""
    state = {"requests": [], "answers": [], "delay": 0.0}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("content-length", "0") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            state["requests"].append({"path": self.path, "auth": self.headers.get("authorization"), "body": body})
            if state["delay"]:
                time.sleep(state["delay"])
            answer = state["answers"].pop(0) if state["answers"] else good_review()
            status, payload = answer if isinstance(answer, tuple) else (200, {
                "id": "chatcmpl-test", "object": "chat.completion",
                "choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant", "content": answer}}]})
            raw = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    state["url"] = f"http://127.0.0.1:{server.server_port}/v1"
    yield state
    server.shutdown()


@pytest.fixture
def ai(monkeypatch, review, provider):  # noqa: F811
    """Pitch Review on, with AI mode's settings pointing at the fake service."""
    monkeypatch.setenv("ORBYT_REVIEW_AI_URL", provider["url"])
    monkeypatch.setenv("ORBYT_REVIEW_AI_KEY", KEY)
    monkeypatch.setenv("ORBYT_REVIEW_AI_MODEL", MODEL)
    for name in ("ORBYT_REVIEW_MODE", "ORBYT_REVIEW_AI_PER_DAY"):
        monkeypatch.delenv(name, raising=False)
    return {**review, "ai": provider}


def ai_paid(message_id, **extra):
    """A paid checkout whose grown-up ticked to agree to AI."""
    body = paid(message_id, **extra)
    body["metadata"] = {**body["metadata"], "ai": "1"}
    return body


def about(mail, words):
    return [m for m in mail if words in m["subject"]]


def job(order_id=None):
    from horizon import db
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM orbyt_review_jobs ORDER BY order_id DESC LIMIT 1" if order_id is None
                           else "SELECT * FROM orbyt_review_jobs WHERE order_id = ?",
                           () if order_id is None else (order_id,)).fetchone()
    return dict(row) if row else None


def buy_ai(client, ai, session=SESSION, intent="pi_test_review_1", body=PITCH):
    """Send a pitch, and pay for its AI review. Returns the order's id."""
    pitch(client, body)
    answer = send(client, event("checkout.session.completed", ai_paid(last_message_id(), id=session,
                                                                        payment_intent=intent)))
    assert answer.json()["result"] == "order added", answer.text
    return orders()[-1]["id"]


# ---------------------------------------------------------------- settings and mode

def test_ai_mode_is_on_only_with_all_three_ai_settings(monkeypatch):
    from horizon import config, orbyt_review_ai
    for name in ("ORBYT_REVIEW_MODE", "ORBYT_REVIEW_AI_URL", "ORBYT_REVIEW_AI_KEY", "ORBYT_REVIEW_AI_MODEL",
                 "ORBYT_REVIEW_AI_PER_DAY"):
        monkeypatch.delenv(name, raising=False)
    assert orbyt_review_ai.mode() == "person" and orbyt_review_ai.notes() == []
    assert config.get().orbyt_review_ai_per_day == 20
    monkeypatch.setenv("ORBYT_REVIEW_AI_URL", "https://api.example.com/v1")
    monkeypatch.setenv("ORBYT_REVIEW_AI_KEY", KEY)
    # Two of three: still a person, and the console says what's missing.
    assert orbyt_review_ai.mode() == "person"
    assert "ORBYT_REVIEW_AI_MODEL" in orbyt_review_ai.notes()[0]
    monkeypatch.setenv("ORBYT_REVIEW_AI_MODEL", MODEL)
    assert orbyt_review_ai.mode() == "ai" and orbyt_review_ai.notes() == []
    assert orbyt_review_ai._endpoint() == "https://api.example.com/v1/chat/completions"
    monkeypatch.setenv("ORBYT_REVIEW_AI_URL", "https://api.example.com/v1/chat/completions/")
    assert orbyt_review_ai._endpoint() == "https://api.example.com/v1/chat/completions"
    # The owner can keep writing them by hand.
    monkeypatch.setenv("ORBYT_REVIEW_MODE", "person")
    assert orbyt_review_ai.mode() == "person" and orbyt_review_ai.notes() == []
    monkeypatch.setenv("ORBYT_REVIEW_MODE", "ai")
    assert orbyt_review_ai.mode() == "ai"
    monkeypatch.setenv("ORBYT_REVIEW_AI_PER_DAY", "50")
    assert config.get().orbyt_review_ai_per_day == 50


def test_an_address_that_isnt_safe_https_is_not_used(monkeypatch):
    from horizon import config
    for raw, kept in (("https://api.example.com/v1", True), ("http://api.example.com/v1", False),
                      ("http://127.0.0.1:11434/v1", True), ("http://localhost:1234/v1", True),
                      ("https://user:pw@api.example.com/v1", False), ("https://api.example.com/v1?x=1", False),
                      ("api.example.com/v1", False), ("ftp://api.example.com", False), ("", False)):
        monkeypatch.setenv("ORBYT_REVIEW_AI_URL", raw)
        assert bool(config.get().orbyt_review_ai_url) == kept, raw
    for raw, kept in (("some-model", True), ("org/some-model:free", True), ("two words", False), ("", False),
                      ("x" * 201, False)):
        monkeypatch.setenv("ORBYT_REVIEW_AI_MODEL", raw)
        assert bool(config.get().orbyt_review_ai_model) == kept, raw


def test_no_model_name_of_any_ai_company_is_written_into_the_code():
    """The review model comes only from ORBYT_REVIEW_AI_MODEL; the docs name
    services with free tiers, never a model."""
    pattern = re.compile(r"\b(gpt-\d|gpt-4o|o\d-mini|gemini-\d|gemma-?\d|llama-?\d|llama3|mixtral|mistral-\w+-\d|"
                         r"qwen-?\d|deepseek-(?:r|v)\d|claude-\d|claude-[a-z]+-\d)", re.IGNORECASE)
    files = [*ROOT.glob("horizon/*.py"), *ROOT.glob("static/js/*.js"), *ROOT.glob("templates/*.html"),
             ROOT / "README.md", ROOT / "CHANGELOG.md", ROOT / ".env.example", ROOT / "render.yaml",
             *ROOT.glob("docs/*.md")]
    hits = [str(p.relative_to(ROOT)) for p in files if p.exists() and pattern.search(p.read_text())]
    assert hits == [], hits


# ---------------------------------------------------------------- checkout

def test_in_ai_mode_the_grown_up_agrees_to_ai_at_checkout(client, ai):
    ticket = pitch(client)["review"]
    # The 18+ tick alone isn't enough in AI mode.
    response = checkout(client, ticket)
    assert response.status_code == 400 and response.json()["field"] == "ai"
    assert "sent to an AI service" in response.json()["error"]
    response = client.post("/api/orbyt/review/checkout", json={"ticket": ticket, "adult": True, "ai": "yes"},
                           headers=ORIGIN)
    assert response.status_code == 400 and response.json()["field"] == "ai"
    assert ai["stripe"]["calls"] == []
    response = client.post("/api/orbyt/review/checkout", json={"ticket": ticket, "adult": True, "ai": True},
                           headers=ORIGIN)
    assert response.status_code == 200, response.text
    form = ai["stripe"]["calls"][-1]["form"]
    assert form["metadata[ai]"] == "1" and form["payment_intent_data[metadata][ai]"] == "1"
    assert "written by AI" in form["custom_text[submit][message]"]
    assert "within 5 days, you get a full refund" in form["custom_text[submit][message]"]
    # Nothing went to the AI: nothing is paid yet.
    assert ai["ai"]["requests"] == []


def test_in_person_mode_checkout_is_as_before(client, review):  # noqa: F811
    ticket = pitch(client)["review"]
    assert checkout(client, ticket).status_code == 200
    form = review["stripe"]["calls"][-1]["form"]
    assert "metadata[ai]" not in form and "written by AI" not in form["custom_text[submit][message]"]


# ---------------------------------------------------------------- webhook -> job -> email

def test_a_paid_review_is_written_by_ai_and_emailed_without_the_webhook_waiting(client, ai):
    from horizon import orbyt_review
    ai["ai"]["delay"] = 1.5     # a slow service
    pitch(client)
    message_id = last_message_id()
    started = time.monotonic()
    answer = send(client, event("checkout.session.completed", ai_paid(message_id)))
    assert answer.status_code == 200 and answer.json()["result"] == "order added"
    # Stripe got its answer before the AI had even answered.
    assert time.monotonic() - started < 1.2
    assert wait_for(lambda: about(ai["mail"], "Your Orbyt Pitch Review: Nova"), seconds=10)
    mail = ai["mail"]
    confirm = about(mail, "Your Orbyt Pitch Review is on its way")[0]
    notice = about(mail, "is being written by AI")[0]
    sent = about(mail, "Your Orbyt Pitch Review: Nova")[0]
    # The confirmation came first, then the review, both to the grown-up.
    assert mail.index(confirm) < mail.index(sent) and confirm["to"] == sent["to"] == BUYER
    body = " ".join(confirm["body"].split())
    for words in ("written by AI from the pitch that was sent", "usually within an hour",
                  "the idea's words (never anyone's name or email address) are sent to an AI service, as agreed at checkout",
                  f"If the review isn't with you by {orbyt_review.due_text(orders()[0]['due_at'])}",
                  "you get a full refund", "not a subscription"):
        assert words in body, words
    assert notice["to"] == "" and BUYER not in notice["body"] and "console" in notice["body"]
    review_body = sent["body"]
    assert "It was written by AI" in review_body and good_review().split("\n")[1].strip() in review_body
    assert "isn't an offer to invest in, buy, build or partner on the idea" in " ".join(review_body.split())
    # The order is closed as sent, and the job holds what it wrote.
    [order] = orders()
    assert order["status"] == "sent" and order["sent_at"]
    done = job(order["id"])
    assert done["state"] == "sent" and done["text"] == orbyt_review_ai_tidy(good_review()) and done["emailed_at"]
    # Exactly one call: the setting's model, the key, the pitch's words.
    [request] = ai["ai"]["requests"]
    assert request["path"] == "/v1/chat/completions" and request["auth"] == f"Bearer {KEY}"
    assert request["body"]["model"] == MODEL
    system, user = request["body"]["messages"]
    assert system["role"] == "system" and "What's strong" in system["content"]
    assert "Nova" in user["content"] and PITCH["pitch"] in user["content"] and PITCH["audience"] in user["content"]
    # Never who pitched, or the buyer.
    sent_words = json.dumps(request["body"])
    assert PITCH["name"] not in user["content"] and PITCH["email"] not in sent_words and BUYER not in sent_words


def orbyt_review_ai_tidy(text):
    from horizon import orbyt_review_ai
    return orbyt_review_ai.tidy(text)


def test_emails_phone_numbers_and_links_in_a_pitch_are_taken_out_before_it_is_sent(client, ai):
    body = {**PITCH, "message": f"Text me on +44 7700 900123 or mail ada.home@example.org, demo at "
                                f"https://nova.example/try. {SECRET}"}
    buy_ai(client, ai, body=body)
    assert wait_for(lambda: ai["ai"]["requests"], seconds=10)
    user = ai["ai"]["requests"][0]["body"]["messages"][1]["content"]
    assert "7700" not in user and "ada.home@example.org" not in user and "nova.example" not in user
    assert "[number]" in user and "[email]" in user and "[link]" in user


def test_nothing_is_sent_to_the_ai_unless_a_review_is_paid_for_and_agreed_to(client, ai):
    from horizon import orbyt_review_ai
    ticket = pitch(client)["review"]
    message_id = last_message_id()
    client.post("/api/orbyt/review/checkout", json={"ticket": ticket, "adult": True, "ai": True}, headers=ORIGIN)
    # Not paid yet.
    assert send(client, event("checkout.session.completed", ai_paid(message_id, payment_status="unpaid"))
                ).json()["result"] == "unpaid"
    # Paid, but checked out while a person wrote reviews: the grown-up never agreed to AI.
    assert send(client, event("checkout.session.completed", paid(message_id))).json()["result"] == "order added"
    orbyt_review_ai.work()
    orbyt_review_ai.kick()
    # The person-mode confirmation, and nothing for the AI.
    assert wait_for(lambda: about(ai["mail"], "Your Orbyt Pitch Review is booked"))
    time.sleep(0.3)
    assert ai["ai"]["requests"] == [] and job() is None


def test_a_review_waiting_after_a_restart_is_done_by_the_upkeep_loop(client, ai):
    from horizon import db, orbyt_review_ai, upkeep
    assert orbyt_review_ai.kick in upkeep.jobs()
    ai["ai"]["answers"] = [(503, {"error": "busy"})]
    order_id = buy_ai(client, ai)
    assert wait_for(lambda: job(order_id)["tries"] == 1 and job(order_id)["state"] == "queued", seconds=10)
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_review_jobs SET next_at = ?", (time.time() - 1,))
    upkeep.run_once()
    assert wait_for(lambda: job(order_id)["state"] == "sent", seconds=10)
    assert len(ai["ai"]["requests"]) == 2


# ---------------------------------------------------------------- checking, retrying, handing over

def test_the_checks_on_an_ai_review():
    from horizon import orbyt_review_ai as a
    assert a.check(a.tidy(good_review())) == (True, "")
    # Markdown is tidied away first, and still passes.
    marked = good_review().replace("What's strong", "## **What's strong**").replace("What to fix", "**What to fix:**")
    assert a.check(a.tidy(marked)) == (True, "")
    bad = {
        "too short": "What's strong\nNice.\nWhat to fix\nMore.\nYour next 3 steps\n1. a\n2. b\n3. c\nMight it fit Orbyt?\nMaybe.",
        "missing part": good_review().replace("What to fix\n", ""),
        "two steps": good_review().replace("3. Keep planning", "Keep planning"),
        "email": good_review(" Email help@other.example for help."),
        "phone": good_review(" Call 0207 946 0018 to talk."),
        "link": good_review(" See https://other.example/tips for more."),
        "bare link": good_review(" Look at besttips.com for ideas."),
        "promise": good_review(" We will invest in your idea."),
        "build": good_review(" MTRX Horizyn will build it for you."),
        "money": good_review(" You'll make money fast."),
        "asks": good_review(" Please send us your age and school."),
    }
    for name, text in bad.items():
        ok, why = a.check(a.tidy(text))
        assert not ok and why, name
    assert a.check("DECLINE") == (False, "the AI declined to review this idea")
    # Pages on this site may be named; saying what won't happen is fine.
    fine = good_review(" Read https://mtrxhorizyn.com/orbyt too. We will not invest, and that's normal.")
    assert a.check(a.tidy(fine)) == (True, "")


def test_a_bad_review_is_written_once_more(client, ai):
    ai["ai"]["answers"] = [good_review(" Visit besttips.com for more.")]
    order_id = buy_ai(client, ai)
    assert wait_for(lambda: job(order_id)["state"] == "sent", seconds=10)
    first, second = ai["ai"]["requests"]
    again = second["body"]["messages"]
    assert [m["role"] for m in again] == ["system", "user", "assistant", "user"]
    assert "a link to another website" in again[-1]["content"]
    sent = about(ai["mail"], "Your Orbyt Pitch Review: Nova")[0]
    assert "besttips.com" not in sent["body"]


def test_bad_twice_hands_the_order_to_the_owner(client, ai):
    from horizon import orbyt_review
    ai["ai"]["answers"] = ["Too short.", good_review(" Call 0207 946 0018.")]
    order_id = buy_ai(client, ai)
    assert wait_for(lambda: job(order_id)["state"] == "person", seconds=10)
    assert len(ai["ai"]["requests"]) == 2
    assert "didn't pass the checks twice" in job(order_id)["note"]
    [order] = orders()
    assert order["status"] == "open"
    assert wait_for(lambda: about(ai["mail"], "a Pitch Review needs you"))
    note = about(ai["mail"], "a Pitch Review needs you")[0]
    assert note["to"] == "" and "Nova" in note["body"] and BUYER not in note["body"]
    assert orbyt_review.due_text(order["due_at"]) in note["subject"]
    # Nothing bad reached the buyer.
    assert about(ai["mail"], "Your Orbyt Pitch Review: Nova") == []


def test_a_declined_idea_goes_to_the_owner_after_one_call(client, ai):
    ai["ai"]["answers"] = ["DECLINE"]
    order_id = buy_ai(client, ai)
    assert wait_for(lambda: job(order_id)["state"] == "person", seconds=10)
    assert len(ai["ai"]["requests"]) == 1 and "declined" in job(order_id)["note"]


def test_a_refused_key_goes_to_the_owner_at_once_and_a_down_service_is_tried_again(client, ai):
    ai["ai"]["answers"] = [(401, {"error": {"message": "bad key"}})]
    order_id = buy_ai(client, ai)
    assert wait_for(lambda: job(order_id)["state"] == "person", seconds=10)
    assert "ORBYT_REVIEW_AI_KEY" in job(order_id)["note"]
    ai["ai"]["answers"] = [(500, {"error": "oops"})]
    second = buy_ai(client, ai, session="cs_test_second", intent="pi_test_review_2")
    assert wait_for(lambda: job(second)["tries"] == 1 and job(second)["state"] == "queued", seconds=10)
    assert 30 < job(second)["next_at"] - time.time() <= 60


def test_if_it_cant_be_written_in_time_the_owner_gets_it(client, ai):
    from horizon import db, orbyt_review_ai
    ai["ai"]["answers"] = [(500, {"error": "oops"})] * 3
    order_id = buy_ai(client, ai)
    assert wait_for(lambda: job(order_id)["tries"] == 1, seconds=10)
    # Due in two hours: waiting for another try would leave the owner no time.
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_reviews SET paid_at = ?, due_at = ?", (time.time() - 3600, time.time() + 600))
        conn.execute("UPDATE orbyt_review_jobs SET next_at = ?", (time.time() - 1,))
    orbyt_review_ai.work()
    assert job(order_id)["state"] == "person" and "in time" in job(order_id)["note"]


# ---------------------------------------------------------------- the daily cap

def test_the_daily_cap_queues_reviews_for_tomorrow_and_never_lets_one_be_late(client, ai, monkeypatch):
    from horizon import db, orbyt_review_ai
    monkeypatch.setenv("ORBYT_REVIEW_AI_PER_DAY", "1")
    first = buy_ai(client, ai)
    assert wait_for(lambda: job(first)["state"] == "sent", seconds=10)
    second = buy_ai(client, ai, session="cs_test_second", intent="pi_test_review_2")
    assert wait_for(lambda: job(second)["next_at"] > time.time() + 60, seconds=10)
    # Waiting for tomorrow, a minute after midnight UTC; nothing more was sent today.
    tomorrow = time.time() - time.time() % 86400 + 86400 + 60
    assert job(second)["state"] == "queued" and abs(job(second)["next_at"] - tomorrow) < 2
    assert len(ai["ai"]["requests"]) == 1 and orbyt_review_ai.calls_today() == 1
    # One due before tomorrow would be late: it goes to the owner instead.
    third = buy_ai(client, ai, session="cs_test_third", intent="pi_test_review_3")
    assert wait_for(lambda: job(third)["next_at"] > time.time() + 60, seconds=10)
    # Due in two hours, or before tomorrow's first try when that is sooner (late
    # in the UTC day two hours would reach past it, and it would rightly wait).
    now = time.time()
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_reviews SET paid_at = ?, due_at = ? WHERE id = ?",
                     (now, now + min(7200, tomorrow - now), third))
        conn.execute("UPDATE orbyt_review_jobs SET state = 'queued', next_at = ? WHERE order_id = ?",
                     (time.time() - 1, third))
    orbyt_review_ai.work()
    assert job(third)["state"] == "person" and "ORBYT_REVIEW_AI_PER_DAY" in job(third)["note"]
    assert len(ai["ai"]["requests"]) == 1
    # Call times go after two days.
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_review_ai_calls SET at = at - 3 * 86400")
    orbyt_review_ai.forget_old()
    assert orbyt_review_ai.calls_today() == 0


# ---------------------------------------------------------------- the console

def test_the_console_shows_every_ai_review_with_resend_and_refund(client, ai, monkeypatch):
    from horizon import genesis_pro
    order_id = buy_ai(client, ai)
    assert wait_for(lambda: job(order_id)["state"] == "sent", seconds=10)
    owner(client)
    data = client.get("/api/console/orbyt-reviews").json()
    assert data["mode"] == "ai" and data["ai_today"] == 1 and data["ai_per_day"] == 20
    [done] = data["done"]
    assert done["by"] == "ai" and done["ai"]["state"] == "sent" and done["ai"]["emailed_at"]
    assert "What's strong" in done["ai"]["text"] and done["can_resend"] and done["can_refund"]
    # Resend: the same review, to the same grown-up.
    before = len(about(ai["mail"], "Your Orbyt Pitch Review: Nova"))
    assert client.post(f"/api/console/orbyt-reviews/{order_id}/resend", headers=ORIGIN).status_code == 200
    assert len(about(ai["mail"], "Your Orbyt Pitch Review: Nova")) == before + 1
    # Refund: a key without Refunds: write (the fake Stripe has no refunds) says what to do.
    response = client.post(f"/api/console/orbyt-reviews/{order_id}/refund", headers=ORIGIN)
    assert response.status_code == 502 and "Refunds: write" in response.json()["error"]
    calls = []
    monkeypatch.setattr(genesis_pro, "_stripe", lambda path, fields=None, method="POST": calls.append(
        (path, fields)) or {"id": "re_test", "status": "succeeded"})
    response = client.post(f"/api/console/orbyt-reviews/{order_id}/refund", headers=ORIGIN)
    assert response.status_code == 200 and response.json()["done"][0]["status"] == "refunded"
    assert calls == [("refunds", {"payment_intent": "pi_test_review_1", "metadata[product]": "orbyt_review",
                                  "metadata[order]": str(order_id)})]
    assert client.post(f"/api/console/orbyt-reviews/{order_id}/refund", headers=ORIGIN).status_code == 409
    assert client.post(f"/api/console/orbyt-reviews/{order_id}/resend", headers=ORIGIN).status_code == 409
    assert client.post(f"/api/console/orbyt-reviews/{order_id}/other", headers=ORIGIN).status_code == 409


def test_only_the_owner_can_resend_or_refund(client, ai):
    order_id = buy_ai(client, ai)
    assert wait_for(lambda: job(order_id)["state"] == "sent", seconds=10)
    for action in ("resend", "refund"):
        assert client.post(f"/api/console/orbyt-reviews/{order_id}/{action}", headers=ORIGIN).status_code == 404


def test_a_handed_over_review_shows_why_and_marking_it_sent_stops_the_ai(client, ai):
    ai["ai"]["answers"] = ["DECLINE"]
    order_id = buy_ai(client, ai)
    assert wait_for(lambda: job(order_id)["state"] == "person", seconds=10)
    owner(client)
    [item] = client.get("/api/console/orbyt-reviews").json()["open"]
    assert item["by"] == "person" and item["ai"]["state"] == "person" and "declined" in item["ai"]["note"]
    assert not item["can_resend"]
    assert client.post(f"/api/console/orbyt-reviews/{order_id}/sent", headers=ORIGIN).status_code == 200
    script = (ROOT / "horizon/private/console.js").read_text()
    for words in ("Needs you: ", "Read the review it wrote", "/${action}`", "AI mode is on: each review is written by AI"):
        assert words in script, words


def test_an_ai_review_is_forgotten_with_the_email_address(client, ai):
    from horizon import db, orbyt_review
    order_id = buy_ai(client, ai)
    assert wait_for(lambda: job(order_id)["state"] == "sent", seconds=10)
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_reviews SET sent_at = ?", (time.time() - 91 * 86400,))
    orbyt_review.forget_old()
    assert job(order_id)["text"] == "" and orders()[0]["email"] == ""
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_reviews SET paid_at = ?", (time.time() - 401 * 86400,))
    orbyt_review.forget_old()
    assert job(order_id) is None


# ---------------------------------------------------------------- honest words, in each mode

def test_in_ai_mode_every_page_says_plainly_that_ai_writes_it(client, ai):
    page = flat(client.get("/orbyt").text)
    faq = page.split('id="faq-review"', 1)[1].split("</details>", 1)[0]
    for words in ("an AI-written review of your idea, usually within an hour",
                  "the idea you sent (not your name or email) goes to an AI service",
                  "the grown-up who pays agrees to that at checkout", "one payment of $19 (not a subscription)",
                  "If it isn't with you within 5 days, or we can't review your idea, you get a full refund"):
        assert words in faq, words
    assert "A real person" not in faq
    # 1.27.0: "usually within an hour" everywhere, never "within about an hour".
    for path in ("/orbyt", "/terms", "/privacy", "/orbyt/review/thanks"):
        assert "within about an hour" not in flat(client.get(path).text), path
    sent = page.split('<section class="panel v-sent"', 1)[1].split("</section>", 1)[0]
    for words in ("get an AI-written review", "(and whether it might fit Orbyt), usually within an hour", "Written by AI.",
                  "never your name or email) goes to an AI service", "I'm 18 or over, and I'm the one paying",
                  'id="v-review-ai"', "I agree the idea is sent to an AI service to write the review",
                  "Full refund if it isn't with you within 5 days", 'href="/privacy#pitch-review"'):
        assert words in sent, words
    assert "a real person at MTRX Horizyn writes one" not in sent
    terms = flat(client.get("/terms").text)
    for words in ("you get an AI-written review of your idea", "usually within an hour",
                  "reaches you within 5 days of the payment", "written by an AI service, following our instructions",
                  "not written by a person", "the adult ticks to agree that the idea is sent to an AI service",
                  "If the review isn't with you within 5 days"):
        assert words in terms, words
    privacy = flat(client.get("/privacy").text)
    for words in ("Written by AI.", "the common \"OpenAI-compatible\" way", "(right now, the service at 127.0.0.1)",
                  "only when, a review has been paid for, and the grown-up ticked to agree",
                  "with email addresses, phone numbers and links taken out",
                  "never send it the name or email address of the person who pitched",
                  "Nothing is sent to it for a pitch without a paid review",
                  "Some services' free plans may use what they are sent to improve their products",
                  "deleted with the email address, 90 days after", "It is never shared, except that a pitch's words"):
        assert words in privacy, words
    thanks = flat(client.get("/orbyt/review/thanks").text)
    assert "then your AI-written review, usually within an hour" in thanks
    assert "If it isn't with you within 5 days" in thanks and "A real person" not in thanks
    assert 'data-review-mode="ai"' in client.get("/orbyt").text
    # The site's rules still hold.
    raw = client.get("/orbyt").text
    assert 'style="' not in raw and not re.search(r"\son[a-z]+=", raw)


def test_in_person_mode_the_words_are_as_before(client, review):  # noqa: F811
    page = flat(client.get("/orbyt").text)
    assert "A real person at MTRX Horizyn writes you a personal review" in page
    assert "AI-written" not in page and 'id="v-review-ai"' not in page
    for path in ("/terms", "/privacy", "/orbyt/review/thanks"):
        text = flat(client.get(path).text)
        assert "AI-written" not in text and "Written by AI" not in text and "OpenAI-compatible" not in text, path
    assert "It is never shared." in flat(client.get("/privacy").text)
    assert 'data-review-mode="person"' in client.get("/orbyt").text


def test_while_off_pilot_hears_no_mode(client):
    assert 'data-review-mode=""' in client.get("/orbyt").text


def node_answer(data: dict) -> str:
    """Pilot's "What's a Pitch Review?" answer, as static/js/pilot-mtrx.js gives it."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("node isn't installed")
    script = f"""
const vm = require("node:vm"); const fs = require("node:fs");
const src = fs.readFileSync({json.dumps(str(ROOT / "static/js/pilot-mtrx.js"))}, "utf8");
let given = null;
const window = {{ Pilot: {{ mount: (c) => {{ given = c; }} }}, location: {{ pathname: "/orbyt" }} }};
vm.runInNewContext(src, {{ window, document: {{ getElementById: () => ({{ dataset: {json.dumps(data)} }}), title: "" }} }});
const chip = given.chips().find((c) => c.label === "What's a Pitch Review?");
// 1.28.0: an answer is a function (a typed question is checked first); pressed:
process.stdout.write(JSON.stringify({{ answer: chip ? chip.answer({{ label: chip.label }}) : null, facts: given.facts }}));
"""
    out = subprocess.run([node, "-e", script], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_pilot_says_who_writes_it_in_each_mode():
    base = {"review": "on", "reviewPrice": "$19", "reviewDays": "5", "apps": "[]"}
    ai_mode = node_answer({**base, "reviewMode": "ai"})
    assert "**AI-written review**" in ai_mode["answer"] and "of your idea, usually within an hour" in ai_mode["answer"]
    assert "goes to an AI service" in ai_mode["answer"] and "agrees to that at checkout" in ai_mode["answer"]
    assert "If it isn't with you within 5 days" in ai_mode["answer"] and "real person" not in ai_mode["answer"]
    assert ai_mode["facts"]["reviewAi"] is True
    person = node_answer({**base, "reviewMode": "person"})
    assert "A real person at MTRX Horizyn" in person["answer"] and "AI" not in person["answer"]
    assert person["facts"]["reviewAi"] is False
    pack = (ROOT / "static/js/pilot-mtrx-pack.js").read_text()
    assert "f.review && f.reviewAi" in pack and "never say a person writes it" in pack


def test_the_owners_doc_has_the_free_steps():
    doc = (ROOT / "docs/ORBYT-PITCH-REVIEW.md").read_text()
    assert "## Make it automatic (free)" in doc
    for words in ("ORBYT_REVIEW_AI_URL", "ORBYT_REVIEW_AI_KEY", "ORBYT_REVIEW_AI_MODEL", "ORBYT_REVIEW_AI_PER_DAY",
                  "ORBYT_REVIEW_MODE", "Google AI Studio", "Groq", "OpenRouter", "free"):
        assert words in doc, words


# ---------------------------------------------------------------- the Sent screen and coming back (round 8)

def test_the_offer_comes_after_the_confirmation_and_while_you_wait(client, review):  # noqa: F811
    page = client.get("/orbyt").text
    sent = page.split('<section class="panel v-sent"', 1)[1].split("</section>", 1)[0]
    order = [sent.index(m) for m in ('class="v-sent-title"', 'id="v-sent-line"', 'id="v-next-step"', 'id="v-next"',
                                     'id="v-review"', 'class="cta-row"')]
    assert order == sorted(order), order
    script = (ROOT / "static/js/vortex.js").read_text()
    # Shown from its top, under the bar, never centred (that hid "Sent." on a phone).
    assert 'scrollIntoView({ block: "center" })' not in script
    assert 'sent.scrollIntoView({ block: "start", behavior: "instant" })' in script
    # 1.27.0: its scroll-margin-top is the bar's measured height, set again
    # once the fonts are in and a frame is drawn (the stylesheet's 96 px
    # stays only as the fallback before the script runs).
    assert "sent.style.scrollMarginTop = " in script and "document.fonts.ready" in script
    assert "requestAnimationFrame(() => {" in script.split("function showPanel()", 1)[1].split("\n  }\n", 1)[0]
    css = (ROOT / "static/css/vortex.css").read_text()
    assert "scroll-margin-top: 96px;" in css.split(".v-sent {", 1)[1].split("}", 1)[0]


def test_coming_back_from_a_cancelled_checkout_is_handled_and_honest(client, review):  # noqa: F811
    ticket = pitch(client)["review"]
    checkout(client, ticket)
    assert review["stripe"]["calls"][-1]["form"]["cancel_url"] == "https://testserver/orbyt#review-cancelled"
    script = (ROOT / "static/js/vortex.js").read_text()
    for words in ('window.location.hash === "#review-cancelled"', 'const TICKET_KEY = "orbyt-review-ticket"',
                  'storage("sessionStorage")', '$("v-sent-line").textContent = kept ? CANCELLED : CANCELLED_UNKNOWN;', "keptTicket()",
                  '"Your pitch was sent. Checkout was cancelled, and nothing was charged."'):
        assert words in script, words
    # Never the pitcher's email in the browser's storage: the ticket and the time only.
    assert "JSON.stringify({ ticket, at: Date.now() })" in script
    privacy = flat(client.get("/privacy").text)
    assert "Your browser keeps the code too, in this tab only" in privacy and "it goes when the tab is closed" in privacy


def test_early_access_says_what_it_keeps_like_orbyt_does(client, monkeypatch):
    monkeypatch.setenv("EARLY_ACCESS_ENABLED", "1")
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("EARLY_ACCESS_EMAIL_FROM", "news@example.com")
    monkeypatch.setenv("MTRX_PUBLIC_URL", "https://testserver")
    page = flat(client.get("/early-access").text)
    line = ("We keep only your email and the apps you picked, until you unsubscribe (one click, any time), and never "
            'pass them on. <a href="/privacy">Privacy</a>')
    assert line in page
    # The privacy page says the same: only the email and the apps, until unsubscribing.
    privacy = flat(client.get("/privacy").text)
    assert "The early access list keeps only your email and the apps you picked" in privacy
    assert "one-click unsubscribe that deletes you from the list" in privacy
