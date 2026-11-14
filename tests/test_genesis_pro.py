"""Genesis Pro: the paid upgrade to Genesis.

Every test talks to a fake Stripe on this computer (genesis_pro.STRIPE_API
is pointed at it) and, for Ask Genesis, the fake AI provider from
test_genesis_ai. No real request is ever made, and no email is sent.
"""

import hashlib
import hmac
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

import pytest

from tests.test_genesis_ai import PROJECT, ask, provider  # noqa: F401
from tests.test_lock import ORIGIN, client, make_client, owner  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
SECRET = "whsec_test_secret_for_tests"
BUYER = "grown.up@example.com"
SESSION = "cs_test_a1B2c3D4e5"
SUB = "sub_test_123"
CUSTOMER = "cus_test_123"
PRO_PATHS = ("/api/genesis/pro/checkout", "/api/genesis/pro/claim", "/api/genesis/pro/status",
             "/api/genesis/pro/resend", "/api/genesis/pro/portal", "/api/genesis/pro/backup",
             "/api/genesis/pro/backups", "/api/genesis/pro/restore", "/api/genesis/pro/backup/delete",
             "/api/genesis/pro/stripe")


@pytest.fixture
def stripe(monkeypatch):
    """A fake Stripe API. `state` keeps every request it got."""
    state = {"calls": [], "down": False}

    class Handler(BaseHTTPRequestHandler):
        def _answer(self, method):
            length = int(self.headers.get("content-length", "0") or 0)
            form = parse_qs(self.rfile.read(length).decode()) if length else {}
            state["calls"].append({"method": method, "path": self.path, "form": {k: v[0] for k, v in form.items()},
                                   "auth": self.headers.get("authorization")})
            if state["down"]:
                return self._send(500, {"error": {"message": "down"}})
            if self.path == "/v1/checkout/sessions":
                return self._send(200, {"id": SESSION, "url": f"https://checkout.stripe.com/c/pay/{SESSION}"})
            if self.path == "/v1/billing_portal/sessions":
                return self._send(200, {"url": "https://billing.stripe.com/p/session/test"})
            if self.path == "/v1/prices/price_month1":
                return self._send(200, {"id": "price_month1", "unit_amount": 499, "currency": "usd"})
            if self.path == "/v1/prices/price_year1":
                return self._send(200, {"id": "price_year1", "unit_amount": 4990, "currency": "usd"})
            return self._send(404, {"error": {"message": "no such thing"}})

        def do_GET(self):
            self._answer("GET")

        def do_POST(self):
            self._answer("POST")

        def _send(self, status, payload):
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
    from horizon import genesis_pro
    monkeypatch.setattr(genesis_pro, "STRIPE_API", f"http://127.0.0.1:{server.server_port}/v1")
    yield state
    server.shutdown()


@pytest.fixture
def mail(monkeypatch):
    """Emails "sent", kept here instead."""
    from horizon import health
    sent = []
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("GENESIS_PRO_EMAIL_FROM", "pro@example.com")
    monkeypatch.setattr(health, "send_email",
                        lambda subject, body, to="", sender="": sent.append(
                            {"subject": subject, "body": body, "to": to, "sender": sender}) or True)
    return sent


@pytest.fixture
def pro(monkeypatch, stripe, mail):
    from horizon import genesis_pro
    monkeypatch.setenv("GENESIS_PRO_ENABLED", "1")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_not_real")
    monkeypatch.setenv("GENESIS_PRO_STRIPE_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("GENESIS_PRO_STRIPE_PRICE", "price_month1")
    monkeypatch.setenv("GENESIS_PRO_YEARLY_STRIPE_PRICE", "price_year1")
    for name in ("GENESIS_PRO_PER_HOUR", "GENESIS_PRO_PER_DAY", "GENESIS_PRO_MONTHLY_AI_USD"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(genesis_pro, "_prices", {"at": 0.0, "for": (), "month": None, "year": None})
    return {"stripe": stripe, "mail": mail}


def wait_for(check, seconds=3.0):
    end = time.time() + seconds
    while time.time() < end:
        if check():
            return True
        time.sleep(0.02)
    return check()


def signed(payload: bytes, secret=SECRET, at=None):
    at = int(time.time() if at is None else at)
    sig = hmac.new(secret.encode(), f"{at}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={at},v1={sig}"


_events = [0]


def event(kind, obj, created=None):
    _events[0] += 1
    return {"id": f"evt_test_{_events[0]}_{time.time_ns()}", "type": kind,
            "created": int(time.time() if created is None else created), "data": {"object": obj}}


def send(client, evt, secret=SECRET, at=None):
    payload = json.dumps(evt).encode()
    # No Origin: Stripe's servers don't send one.
    return client.post("/api/genesis/pro/stripe", content=payload,
                       headers={"Stripe-Signature": signed(payload, secret, at), "Content-Type": "application/json"})


def completed(session=SESSION, sub=SUB, customer=CUSTOMER, email=BUYER, interval="month", **extra):
    return {"id": session, "object": "checkout.session", "mode": "subscription", "payment_status": "paid",
            "status": "complete", "subscription": sub, "customer": customer,
            "customer_details": {"email": email}, "amount_subtotal": 499 if interval == "month" else 4990,
            "amount_total": 499, "currency": "usd",
            "metadata": {"product": "genesis_pro", "interval": interval}, **extra}


def subscription(status="active", sub=SUB, **extra):
    return {"id": sub, "object": "subscription", "customer": CUSTOMER, "status": status,
            "items": {"data": [{"quantity": 1, "current_period_end": int(time.time()) + 30 * 86400,
                                "price": {"id": "price_month1", "unit_amount": 499, "currency": "usd",
                                          "recurring": {"interval": "month"}}}]},
            "metadata": {"product": "genesis_pro"}, **extra}


def buy(client, **kw):
    """Checkout completes, then the welcome page claims the first key."""
    assert send(client, event("checkout.session.completed", completed(**kw))).status_code == 200
    claim = client.post("/api/genesis/pro/claim", json={"session": kw.get("session", SESSION)}, headers=ORIGIN)
    assert claim.status_code == 200, claim.text
    return claim.json()["key"]


def pro_headers(key):
    return {**ORIGIN, "X-Genesis-Pro-Key": key}


def status(client, key):
    return client.post("/api/genesis/pro/status", headers=pro_headers(key)).json()


# ---------------------------------------------------------------- off by default

def test_pro_is_off_by_default_and_nothing_about_it_shows(client, monkeypatch, stripe):
    from horizon import costs, genesis_pro
    for name in ("GENESIS_PRO_ENABLED", "STRIPE_SECRET_KEY", "GENESIS_PRO_STRIPE_WEBHOOK_SECRET",
                 "GENESIS_PRO_STRIPE_PRICE", "GENESIS_PRO_YEARLY_STRIPE_PRICE"):
        monkeypatch.delenv(name, raising=False)
    assert not genesis_pro.ready()
    for path in ("/genesis", "/privacy", "/terms", "/"):
        page = client.get(path).text
        assert "Genesis Pro" not in page and "genesis-pro" not in page and "Pro key" not in page, path
    assert client.get("/genesis/pro/welcome?session_id=cs_test_x").status_code == 404
    for path in PRO_PATHS:
        assert client.post(path, json={}, headers=ORIGIN).status_code == 404, path
    assert all("Genesis Pro" not in c["what"] for c in costs.summary()["per_use"])
    assert stripe["calls"] == []
    owner(client)
    assert client.get("/api/console/numbers").json()["pro"] is None


@pytest.mark.parametrize("missing", ["STRIPE_SECRET_KEY", "GENESIS_PRO_STRIPE_WEBHOOK_SECRET",
                                     "GENESIS_PRO_STRIPE_PRICE"])
def test_switched_on_without_every_stripe_setting_it_stays_off(client, pro, monkeypatch, missing):
    monkeypatch.delenv(missing, raising=False)
    assert "Genesis <b>Pro</b>" not in client.get("/genesis").text
    assert client.post("/api/genesis/pro/checkout", json={"plan": "month"}, headers=ORIGIN).status_code == 404


def test_a_price_setting_that_is_not_a_price_id_is_ignored(monkeypatch):
    from horizon import config
    monkeypatch.setenv("GENESIS_PRO_STRIPE_PRICE", "price_x/../../v1/customers")
    assert config.get().genesis_pro_price == ""
    monkeypatch.setenv("GENESIS_PRO_STRIPE_PRICE", " price_1AbcDEF ")
    assert config.get().genesis_pro_price == "price_1AbcDEF"


# ---------------------------------------------------------------- the offer

def test_the_offer_shows_stripes_prices_and_says_a_grown_up_pays(client, pro):
    from horizon import genesis_pro, main
    page = client.get("/genesis").text
    assert "Genesis <b>Pro</b>" in page and "A grown-up pays." in page
    assert "Checkout is for adults" in page
    assert "You'll see the price before paying." in page  # not read from Stripe yet
    genesis_pro.refresh_prices()
    page = client.get("/genesis").text
    assert "Get Pro · $4.99 a month" in page
    assert "$49.90 a year · 2 months free" in page
    assert "100 AI answers a day" in page and "The free plan has 30" in page
    assert "genesis-pro.js" in page
    response = client.get("/genesis")
    assert response.headers["content-security-policy"] == main.CSP
    assert "set-cookie" not in response.headers
    assert 'style="' not in page and "<style" not in page and not re.search(r"\son[a-z]+=", page)
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", page)
    # Nothing public: no publishing, sharing or gallery of members' work.
    for word in ("publish", "gallery", "share your project", "public link"):
        assert word not in page.lower()


def test_prices_are_read_from_stripe_at_most_once_an_hour(client, pro):
    from horizon import genesis_pro
    genesis_pro.refresh_prices()
    genesis_pro.refresh_prices()
    reads = [c for c in pro["stripe"]["calls"] if c["path"].startswith("/v1/prices/")]
    assert len(reads) == 2 and all(c["method"] == "GET" for c in reads)
    assert reads[0]["auth"] == "Bearer sk_test_not_real"


def test_without_a_yearly_price_only_monthly_is_offered(client, pro, monkeypatch):
    monkeypatch.delenv("GENESIS_PRO_YEARLY_STRIPE_PRICE")
    assert 'data-plan="year"' not in client.get("/genesis").text
    response = client.post("/api/genesis/pro/checkout", json={"plan": "year"}, headers=ORIGIN)
    assert response.status_code == 400


# ---------------------------------------------------------------- checkout

def test_checkout_names_only_the_price_id_and_marks_the_session(client, pro):
    response = client.post("/api/genesis/pro/checkout", json={"plan": "month"}, headers=ORIGIN)
    assert response.status_code == 200, response.text
    assert response.json() == {"url": f"https://checkout.stripe.com/c/pay/{SESSION}"}
    (call,) = [c for c in pro["stripe"]["calls"] if c["path"] == "/v1/checkout/sessions"]
    form = call["form"]
    assert form["mode"] == "subscription"
    assert form["line_items[0][price]"] == "price_month1" and form["line_items[0][quantity]"] == "1"
    assert form["metadata[product]"] == "genesis_pro" == form["subscription_data[metadata][product]"]
    assert form["success_url"] == "https://testserver/genesis/pro/welcome?session_id={CHECKOUT_SESSION_ID}"
    assert form["cancel_url"] == "https://testserver/genesis#pro"
    assert "grown-ups" in form["custom_text[submit][message]"]
    # No amount is ever sent: Stripe holds the prices.
    assert not any("amount" in k or "unit" in k for k in form)
    client.post("/api/genesis/pro/checkout", json={"plan": "year"}, headers=ORIGIN)
    assert pro["stripe"]["calls"][-1]["form"]["line_items[0][price]"] == "price_year1"


def test_checkout_refuses_other_sites_odd_plans_and_too_many_tries(client, pro):
    assert client.post("/api/genesis/pro/checkout", json={"plan": "month"},
                       headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/genesis/pro/checkout", json={"plan": "lifetime"}, headers=ORIGIN).status_code == 400
    codes = [client.post("/api/genesis/pro/checkout", json={"plan": "month"}, headers=ORIGIN).status_code
             for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429


def test_stripe_being_down_gets_a_friendly_message(client, pro):
    pro["stripe"]["down"] = True
    response = client.post("/api/genesis/pro/checkout", json={"plan": "month"}, headers=ORIGIN)
    assert response.status_code == 502 and "try again" in response.json()["error"]


# ---------------------------------------------------------------- the webhook

def test_the_webhook_needs_stripes_signature(client, pro):
    from horizon import db
    evt = event("checkout.session.completed", completed())
    payload = json.dumps(evt).encode()
    hook = "/api/genesis/pro/stripe"
    assert client.post(hook, content=payload).status_code == 400
    assert client.post(hook, content=payload, headers={"Stripe-Signature": "t=1,v1=abc"}).status_code == 400
    assert send(client, evt, secret="whsec_wrong").status_code == 400
    assert send(client, evt, at=time.time() - 600).status_code == 400  # an old, replayed signature
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM genesis_pro_members").fetchone()[0] == 0
    response = send(client, evt)
    assert response.status_code == 200 and response.json()["result"] == "member added"
    # Stripe sends again: applied once.
    assert send(client, evt).json()["result"] == "repeat"
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM genesis_pro_members").fetchone()[0] == 1


def test_many_bad_signatures_from_one_address_are_refused_unread(client, pro):
    payload = b'{"id": "evt_x"}'
    for _ in range(60):
        client.post("/api/genesis/pro/stripe", content=payload, headers={"Stripe-Signature": "t=1,v1=bad"})
    assert send(client, event("checkout.session.completed", completed())).status_code == 429


def test_a_checkout_that_is_not_genesis_pro_or_unpaid_changes_nothing(client, pro):
    from horizon import db
    other = completed()
    other["metadata"] = {"product": "something_else"}
    assert send(client, event("checkout.session.completed", other)).json()["result"] == "not ours"
    assert send(client, event("checkout.session.completed", completed(payment_status="unpaid"))).json()[
        "result"] == "unpaid"
    assert send(client, event("customer.subscription.updated", subscription(sub="sub_other"))).json()[
        "result"] == "unknown"
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM genesis_pro_members").fetchone()[0] == 0


def test_a_paid_checkout_emails_a_key_and_keeps_no_email_or_key(client, pro):
    from horizon import db
    assert send(client, event("checkout.session.completed", completed())).status_code == 200
    assert wait_for(lambda: pro["mail"])
    (mail,) = pro["mail"]
    assert mail["to"] == BUYER and mail["sender"] == "pro@example.com"
    emailed = re.search(r"GP(-[A-Z2-7]{4}){6}", mail["body"]).group(0)
    assert status(client, emailed)["pro"] is True
    with db.connect() as conn:
        dump = "\n".join(conn.iterdump())
    assert BUYER not in dump and BUYER.lower() not in dump
    assert emailed not in dump and emailed.replace("-", "") not in dump
    assert SESSION not in dump
    assert hashlib.sha256(BUYER.encode()).hexdigest() in dump
    assert "4242" not in dump and "card" not in dump.lower()


# ---------------------------------------------------------------- the welcome page and keys

def test_the_welcome_page_shows_the_first_key_once(client, pro):
    page = client.get(f"/genesis/pro/welcome?session_id={SESSION}")
    assert page.status_code == 200 and page.headers["x-robots-tag"] == "noindex"
    assert page.headers["cache-control"] == "no-store"
    assert "genesis-pro-welcome.js" in page.text and 'style="' not in page.text
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", page.text)
    claim = lambda s=SESSION: client.post("/api/genesis/pro/claim", json={"session": s}, headers=ORIGIN)  # noqa: E731
    # Before Stripe's webhook arrives: wait.
    assert claim().status_code == 202 and claim().json() == {"pending": True}
    send(client, event("checkout.session.completed", completed()))
    first = claim()
    assert first.status_code == 200
    body = first.json()
    assert re.fullmatch(r"GP(-[A-Z2-7]{4}){6}", body["key"]) and body["pro"] is True and body["plan"] == "month"
    again = claim()
    assert again.status_code == 410 and "key" not in again.json()
    assert claim("not-a-session").status_code == 400
    assert status(client, body["key"])["pro"] is True


def test_the_welcome_address_is_kept_out_of_the_server_log():
    import logging
    from horizon.main import _HideSecretLinks
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0,
                               '%s - "GET /genesis/pro/welcome?session_id=cs_test_x HTTP/1.1" 200', ("1.2.3.4",), None)
    assert _HideSecretLinks().filter(record) is False


def test_a_key_works_however_it_is_typed_and_wrong_keys_are_limited(client, pro):
    key = buy(client)
    assert status(client, key.lower().replace("-", " "))["pro"] is True
    wrong = "GP-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA"
    answer = status(client, wrong)
    assert answer["pro"] is False and answer["known"] is False
    for _ in range(25):
        status(client, wrong)
    # Out of tries, even a good key waits a while.
    assert client.post("/api/genesis/pro/status", headers=pro_headers(key)).status_code == 429


def test_lost_keys_are_emailed_only_to_a_members_address(client, pro):
    key = buy(client)
    assert wait_for(lambda: len(pro["mail"]) == 1)
    resend = lambda e: client.post("/api/genesis/pro/resend", json={"email": e}, headers=ORIGIN)  # noqa: E731
    stranger = resend("someone.else@example.com")
    member = resend(BUYER.upper())
    # The same answer either way, so nobody can learn who has Pro.
    assert stranger.status_code == member.status_code == 200
    assert stranger.json() == member.json()
    assert wait_for(lambda: len(pro["mail"]) == 2)
    assert pro["mail"][-1]["to"] == BUYER.upper()
    new_key = re.search(r"GP(-[A-Z2-7]{4}){6}", pro["mail"][-1]["body"]).group(0)
    assert new_key != key and status(client, new_key)["pro"] is True and status(client, key)["pro"] is True
    assert resend("not an email").status_code == 400


def test_lost_key_emails_are_limited(client, pro):
    buy(client)
    codes = [client.post("/api/genesis/pro/resend", json={"email": BUYER}, headers=ORIGIN).status_code
             for _ in range(6)]
    assert codes == [200] * 5 + [429]
    time.sleep(0.2)
    # The first email, from the purchase, plus three new keys a day at most.
    assert len(pro["mail"]) == 4


def test_without_email_set_up_a_lost_key_cant_be_sent(client, pro, monkeypatch):
    monkeypatch.delenv("MTRX_SMTP_HOST")
    response = client.post("/api/genesis/pro/resend", json={"email": BUYER}, headers=ORIGIN)
    assert response.status_code == 503


# ---------------------------------------------------------------- Pro asks: the caps

def test_pro_asks_get_longer_answers_and_more_helpers(client, pro, provider):  # noqa: F811
    from horizon import genesis_ai
    key = buy(client)
    response = ask(client, "plan", headers=pro_headers(key))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["pro"] is True and body["left_today"] == 99
    sent = provider["calls"][-1]["body"]
    assert sent["max_tokens"] == genesis_ai.PRO_MAX_TOKENS == 1000
    assert "350 words" in sent["system"] and "personal" in sent["system"]
    assert ask(client, "question", "q" * 600, headers=pro_headers(key)).status_code == 200
    # The free plan is exactly as it was: no Pro helpers, the short limit.
    assert ask(client, "plan").status_code == 400
    assert ask(client, "question", "q" * 301).status_code == 400
    free = ask(client)
    assert free.json() == {"answer": "Try it with three classmates first.", "helper": "first"}
    assert provider["calls"][-1]["body"]["max_tokens"] == genesis_ai.MAX_TOKENS


def test_a_key_without_pro_gets_the_free_help(client, pro, provider):  # noqa: F811
    key = buy(client)
    send(client, event("customer.subscription.deleted", subscription(status="canceled")))
    response = ask(client, headers=pro_headers(key))
    assert response.status_code == 200 and response.json()["pro"] is False
    assert provider["calls"][-1]["body"]["max_tokens"] == 1200
    assert ask(client, "plan", headers=pro_headers(key)).status_code == 400
    assert ask(client, headers=pro_headers("GP-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA")).json()["pro"] is False


def test_each_member_has_a_daily_cap(client, pro, provider, monkeypatch):  # noqa: F811
    monkeypatch.setenv("GENESIS_PRO_PER_DAY", "3")
    key = buy(client)
    codes = [ask(client, headers=pro_headers(key)).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    assert "tomorrow" in ask(client, headers=pro_headers(key)).json()["error"]
    # Another member, and free visitors, are not held up by it.
    other = buy(client, session="cs_test_other", sub="sub_other", customer="cus_other", email="b@example.com")
    assert ask(client, headers=pro_headers(other)).status_code == 200
    assert ask(client).status_code == 200


def test_the_monthly_allowance_caps_what_one_member_can_cost(client, pro, provider, monkeypatch):  # noqa: F811
    from horizon import db, genesis_ai
    monkeypatch.setenv("GENESIS_AI_INPUT_PRICE", "1")
    monkeypatch.setenv("GENESIS_AI_OUTPUT_PRICE", "5")
    monkeypatch.setenv("GENESIS_PRO_MONTHLY_AI_USD", "0.02")
    key = buy(client)
    worst = genesis_ai.worst_case_cost(pro=True)
    assert worst == pytest.approx(0.008)
    provider["usage"] = {"input_tokens": 3000, "output_tokens": 1000}  # every answer at its most
    codes = [ask(client, headers=pro_headers(key)).status_code for _ in range(4)]
    assert codes == [200, 200, 429, 429]
    assert "this month" in ask(client, headers=pro_headers(key)).json()["error"]
    with db.connect() as conn:
        (spent,) = conn.execute("SELECT SUM(usd) FROM genesis_pro_spend").fetchone()
    assert spent <= 0.02
    # Spend more than 31 days old no longer counts.
    with db.connect() as conn:
        conn.execute("UPDATE genesis_pro_spend SET at = at - 32 * 86400")
    assert ask(client, headers=pro_headers(key)).status_code == 200


def test_pro_asks_do_not_use_the_free_daily_budget(client, pro, provider, monkeypatch):  # noqa: F811
    from horizon import db
    monkeypatch.setenv("GENESIS_AI_DAILY_CAP_USD", "0.0001")
    key = buy(client)
    assert ask(client).status_code == 429  # the free budget is spent
    assert ask(client, headers=pro_headers(key)).status_code == 200
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM genesis_asks").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM genesis_spend").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM genesis_pro_spend").fetchone()[0] == 1


def test_the_default_caps_keep_a_maxed_out_member_well_under_the_price():
    """The sums in docs/GENESIS-PRO.md, from the code's own numbers: the most
    a member can cost in AI in a month is the allowance, and that is well
    under what a month brings in after Stripe's fees, yearly plan included."""
    from horizon import config, genesis_ai
    s = config.get()
    assert (s.genesis_pro_per_day, s.genesis_pro_per_hour, s.genesis_pro_monthly_ai_usd) == (100, 30, 1.5)
    assert (genesis_ai.INPUT_GUESS, genesis_ai.PRO_MAX_TOKENS) == (3000, 1000)
    monthly_net = 4.99 - (4.99 * 0.029 + 0.30) - 4.99 * 0.007
    yearly_net_per_month = (49.90 - (49.90 * 0.029 + 0.30) - 49.90 * 0.007) / 12
    assert round(monthly_net, 2) == 4.51 and round(yearly_net_per_month, 2) == 3.98
    assert s.genesis_pro_monthly_ai_usd <= 0.4 * yearly_net_per_month
    doc = (ROOT / "docs/GENESIS-PRO.md").read_text()
    for figure in ("$1.50", "$4.51", "$3.98", "100", "1,000", "3,000", "$0.008"):
        assert figure in doc, figure


# ---------------------------------------------------------------- cancel, failed payment, refund

def test_cancelling_keeps_pro_until_the_time_paid_for_runs_out(client, pro):
    key = buy(client)
    ends = int(time.time()) + 20 * 86400
    result = send(client, event("customer.subscription.updated",
                                subscription(cancel_at_period_end=True, cancel_at=ends))).json()["result"]
    assert result == "cancelling"
    answer = status(client, key)
    assert answer["pro"] is True and answer["ends_at"] == ends
    send(client, event("customer.subscription.deleted", subscription(status="canceled")))
    answer = status(client, key)
    assert answer["pro"] is False and answer["known"] is True and answer["status"] == "canceled"


def test_a_failed_payment_pauses_pro_until_it_is_paid(client, pro):
    key = buy(client)
    now = int(time.time())
    invoice = {"id": "in_test_2", "subscription": SUB, "customer": CUSTOMER, "amount_paid": 499, "currency": "usd"}
    assert send(client, event("invoice.payment_failed", {**invoice, "amount_paid": 0}, now + 1)).json()[
        "result"] == "past_due"
    assert status(client, key)["pro"] is False and status(client, key)["status"] == "past_due"
    # A late copy of an older "active" event changes nothing.
    assert send(client, event("customer.subscription.updated", subscription(), now - 100)).json()["result"] == "old"
    assert status(client, key)["pro"] is False
    assert send(client, event("invoice.paid", invoice, now + 2)).json()["result"] == "paid, back on"
    assert status(client, key)["pro"] is True


def test_a_full_refund_ends_pro_and_is_counted(client, pro):
    from horizon import db
    key = buy(client)
    now = int(time.time())
    send(client, event("invoice.paid", {"id": "in_test_1", "subscription": SUB, "customer": CUSTOMER,
                                        "amount_paid": 499, "currency": "usd"}, now))
    charge = {"id": "ch_test_1", "customer": CUSTOMER, "amount": 499, "amount_refunded": 499,
              "refunded": True, "currency": "usd"}
    assert send(client, event("charge.refunded", charge, now + 1)).json()["result"] == "refunded"
    assert status(client, key)["pro"] is False and status(client, key)["status"] == "refunded"
    # Stripe still says the subscription is active: a refund stays a refund...
    send(client, event("customer.subscription.updated", subscription(), now + 2))
    assert status(client, key)["pro"] is False
    with db.connect() as conn:
        rows = {r["key"]: r["cents"] for r in conn.execute("SELECT key, cents FROM genesis_pro_payments")}
    assert rows == {"invoice:in_test_1": 499, "refund:ch_test_1": 499}
    # ...until they pay again.
    send(client, event("invoice.paid", {"id": "in_test_3", "subscription": SUB, "customer": CUSTOMER,
                                        "amount_paid": 499, "currency": "usd"}, now + 3))
    assert status(client, key)["pro"] is True


def test_a_part_refund_keeps_pro(client, pro):
    key = buy(client)
    charge = {"id": "ch_test_2", "customer": CUSTOMER, "amount": 499, "amount_refunded": 200,
              "refunded": False, "currency": "usd"}
    assert send(client, event("charge.refunded", charge)).json()["result"] == "part refunded"
    assert status(client, key)["pro"] is True


def test_an_invoice_for_genesis_pro_is_counted_even_before_the_checkout_event(client, pro):
    from horizon import db
    invoice = {"id": "in_early", "customer": CUSTOMER, "amount_paid": 499, "currency": "usd",
               "parent": {"subscription_details": {"subscription": "sub_early",
                                                   "metadata": {"product": "genesis_pro"}}}}
    assert send(client, event("invoice.paid", invoice)).json()["result"] == "paid"
    other = {"id": "in_other", "customer": "cus_x", "amount_paid": 999, "currency": "usd",
             "lines": {"data": [{"price": {"id": "price_someone_else"}}]}}
    assert send(client, event("invoice.paid", other)).json()["result"] == "not ours"
    with db.connect() as conn:
        assert [r[0] for r in conn.execute("SELECT key FROM genesis_pro_payments")] == ["invoice:in_early"]


# ---------------------------------------------------------------- the cloud backup

PROJECTS = [{"id": "p-1", "name": "Nova", "pitch": "Homework reminders", "audience": "Students",
             "address": "nova.com", "stage": "plan", "ticks": {"name": True, "evil": "yes"},
             "notes": "Ask Sam", "created": 1, "updated": 2, "script": "<img src=x>"},
            {"id": "bad id!", "name": "x"}]


def test_a_member_can_back_up_restore_and_delete_their_projects(client, pro):
    key = buy(client)
    saved = client.post("/api/genesis/pro/backup", json={"projects": PROJECTS}, headers=pro_headers(key))
    assert saved.status_code == 200, saved.text
    assert saved.json()["skipped"] == 1
    (latest,) = saved.json()["backups"]
    assert latest["projects"] == 1
    assert status(client, key)["backups"][0]["id"] == latest["id"]
    back = client.post("/api/genesis/pro/restore", json={"id": latest["id"]}, headers=pro_headers(key)).json()
    (project,) = back["projects"]
    assert project["notes"] == "Ask Sam" and project["ticks"] == {"name": True} and "script" not in project
    for _ in range(4):
        client.post("/api/genesis/pro/backup", json={"projects": PROJECTS}, headers=pro_headers(key))
    listed = client.post("/api/genesis/pro/backups", headers=pro_headers(key)).json()["backups"]
    assert len(listed) == 3  # the last three copies
    assert client.post("/api/genesis/pro/backup/delete", headers=pro_headers(key)).json()["backups"] == []
    assert client.post("/api/genesis/pro/restore", json={"id": latest["id"]},
                       headers=pro_headers(key)).status_code == 404


def test_a_backup_is_only_for_its_member_and_only_while_pro(client, pro):
    key = buy(client)
    saved = client.post("/api/genesis/pro/backup", json={"projects": PROJECTS}, headers=pro_headers(key)).json()
    other = buy(client, session="cs_test_other", sub="sub_other", customer="cus_other", email="b@example.com")
    stolen = client.post("/api/genesis/pro/restore", json={"id": saved["backups"][0]["id"]}, headers=pro_headers(other))
    assert stolen.status_code == 404
    assert client.post("/api/genesis/pro/backup", json={"projects": PROJECTS}, headers=ORIGIN).status_code == 403
    send(client, event("customer.subscription.deleted", subscription(status="canceled")))
    assert client.post("/api/genesis/pro/backup", json={"projects": PROJECTS},
                       headers=pro_headers(key)).status_code == 403
    assert client.post("/api/genesis/pro/backup", json={"projects": PROJECTS},
                       headers={**pro_headers(key), "Origin": "https://evil.example"}).status_code == 403


def test_a_huge_backup_is_not_read(client, pro):
    key = buy(client)
    big = [{**PROJECTS[0], "id": f"p-{i}", "notes": "n" * 5000} for i in range(100)]
    huge = json.dumps({"projects": big * 3})
    response = client.post("/api/genesis/pro/backup", content=huge,
                           headers={**pro_headers(key), "Content-Type": "application/json"})
    assert response.status_code == 400


def test_backups_go_sixty_days_after_pro_ends(client, pro):
    from horizon import db, upkeep
    key = buy(client)
    client.post("/api/genesis/pro/backup", json={"projects": PROJECTS}, headers=pro_headers(key))
    send(client, event("customer.subscription.deleted", subscription(status="canceled")))
    upkeep.run_once()
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM genesis_pro_backups").fetchone()[0] == 1
        conn.execute("UPDATE genesis_pro_members SET updated_at = updated_at - 61 * 86400")
    upkeep.run_once()
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM genesis_pro_backups").fetchone()[0] == 0


# ---------------------------------------------------------------- managing it, and the console

def test_manage_subscription_opens_stripes_page_for_that_customer(client, pro):
    key = buy(client)
    response = client.post("/api/genesis/pro/portal", headers=pro_headers(key))
    assert response.status_code == 200 and response.json()["url"].startswith("https://billing.stripe.com/")
    call = pro["stripe"]["calls"][-1]
    assert call["path"] == "/v1/billing_portal/sessions" and call["form"]["customer"] == CUSTOMER
    assert call["form"]["return_url"] == "https://testserver/genesis#pro"
    assert client.post("/api/genesis/pro/portal", headers=ORIGIN).status_code == 403


def test_the_console_numbers_show_pro_members_and_revenue(client, pro):
    key = buy(client)
    buy(client, session="cs_test_y", sub="sub_y", customer="cus_y", email="y@example.com", interval="year")
    send(client, event("customer.subscription.updated", {
        **subscription(sub="sub_y"), "customer": "cus_y",
        "items": {"data": [{"quantity": 1, "price": {"unit_amount": 4990, "currency": "usd",
                                                    "recurring": {"interval": "year"}}}]}}))
    send(client, event("invoice.paid", {"id": "in_a", "subscription": SUB, "customer": CUSTOMER,
                                        "amount_paid": 499, "currency": "usd"}))
    send(client, event("invoice.paid", {"id": "in_b", "subscription": "sub_y", "customer": "cus_y",
                                        "amount_paid": 4990, "currency": "usd"}))
    assert status(client, key)["pro"]
    assert client.get("/api/console/numbers").status_code == 404  # owner only
    owner(client)
    numbers = client.get("/api/console/numbers").json()["pro"]
    assert numbers["members"] == 2 and numbers["monthly"] == 1 and numbers["yearly"] == 1
    assert numbers["mrr_usd"] == round(4.99 + 49.90 / 12, 2)
    assert numbers["collected_usd"] == 54.89 and numbers["ready"] is True
    assert numbers["default_prices"] is True
    overview = client.get("/api/console/overview").json()
    assert any("Genesis Pro" in c["what"] for c in overview["costs"]["per_use"])


def test_privacy_and_terms_say_what_pro_keeps_only_while_it_is_on(client, pro):
    privacy = client.get("/privacy").text
    terms = client.get("/terms").text
    assert "<h2>Genesis Pro</h2>" in privacy and "<h2>Genesis Pro</h2>" in terms
    assert "Card details never reach us" in privacy and "fingerprint" in privacy
    assert "deleted 60 days after Pro ends" in privacy
    assert "bought\n  by an adult" in terms
    for page in (privacy, terms):
        lowered = page.lower()
        for clue in ("/console", "/api/", "knock"):
            assert clue not in lowered


def test_every_pro_address_is_limited():
    from horizon import genesis_pro, main
    paths = {getattr(r, "path", "") for r in main.app.routes}
    assert set(PRO_PATHS) <= paths
    assert {"pro_checkout", "pro_claim", "pro_status", "pro_bad_key", "pro_resend", "pro_portal",
            "pro_backup", "pro_restore", "pro_webhook_bad"} <= set(genesis_pro.RATES)
