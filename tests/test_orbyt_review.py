"""Orbyt Pitch Review: the optional, one-time paid review of a pitch.

Orbyt stays free. These check that the review is off (and never mentioned)
until the owner switches it on and sets it up, that it is offered only after
a pitch is sent, that a grown-up pays through Stripe Checkout, that only
Stripe's signed webhook (its own endpoint and secret) makes an order, once,
that the buyer and the owner are told, that the owner can list and close
reviews in the console, and that the pages say honestly what is paid, what
you get, by when, and the refunds.

Stripe is the fake one from test_genesis_pro, on this computer. No real
request is made and no email is sent.
"""

import re
import time

import pytest

from tests.test_genesis_pro import (SESSION, event, mail, signed, stripe, wait_for)  # noqa: F401
from tests.test_lock import ORIGIN, client, make_client, owner  # noqa: F401
from tests.test_vortex import PARTNER, PITCH

SECRET = "whsec_review_test_secret"
PRO_SECRET = "whsec_test_secret_for_tests"
BUYER = "parent@example.com"
INTENT = "pi_test_review_1"
PATHS = ("/api/orbyt/review/checkout", "/api/orbyt/review/stripe")
REVIEW_SETTINGS = ("ORBYT_REVIEW_ENABLED", "ORBYT_REVIEW_STRIPE_WEBHOOK_SECRET", "ORBYT_REVIEW_STRIPE_PRICE",
                   "ORBYT_REVIEW_PRICE_TEXT", "ORBYT_REVIEW_DAYS", "ORBYT_REVIEW_EMAIL_FROM")


@pytest.fixture
def off(monkeypatch):
    for name in REVIEW_SETTINGS:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def review(monkeypatch, stripe, mail):  # noqa: F811
    monkeypatch.setenv("ORBYT_REVIEW_ENABLED", "1")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_not_real")
    monkeypatch.setenv("ORBYT_REVIEW_STRIPE_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("ORBYT_REVIEW_STRIPE_PRICE", "price_review1")
    monkeypatch.setenv("MTRX_ALERT_EMAIL", "alerts@example.com")
    for name in ("ORBYT_REVIEW_PRICE_TEXT", "ORBYT_REVIEW_DAYS", "ORBYT_REVIEW_EMAIL_FROM"):
        monkeypatch.delenv(name, raising=False)
    return {"stripe": stripe, "mail": mail}


def pitch(client, body=PITCH):
    response = client.post("/api/vortex/send", json=body, headers=ORIGIN)
    assert response.status_code == 200, response.text
    return response.json()


def checkout(client, ticket, adult=True, headers=ORIGIN):
    return client.post("/api/orbyt/review/checkout", json={"ticket": ticket, "adult": adult}, headers=headers)


def paid(message_id, session=SESSION, email=BUYER, intent=INTENT, **extra):
    return {"id": session, "object": "checkout.session", "mode": "payment", "payment_status": "paid",
            "status": "complete", "customer": None, "customer_details": {"email": email},
            "payment_intent": intent, "amount_total": 1900, "currency": "usd",
            "metadata": {"product": "orbyt_review", "message": str(message_id)}, **extra}


def send(client, evt, secret=SECRET, at=None, path="/api/orbyt/review/stripe"):
    import json
    payload = json.dumps(evt).encode()
    # No Origin: Stripe's servers don't send one.
    return client.post(path, content=payload,
                       headers={"Stripe-Signature": signed(payload, secret, at), "Content-Type": "application/json"})


def orders():
    from horizon import db
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM orbyt_reviews ORDER BY id")]


def last_message_id():
    from horizon import db
    with db.connect() as conn:
        return conn.execute("SELECT MAX(id) FROM vortex_messages").fetchone()[0]


def flat(html: str) -> str:
    return " ".join(html.split()).replace("&#39;", "'").replace("&#34;", '"')


def review_mail(review):
    """The emails about Pitch Review (a pitch also sends the owner Orbyt's own notice)."""
    return [m for m in review["mail"] if "Pitch Review" in m["subject"]]


def buy(client, review):
    """A pitch is sent and its review is paid for. Returns the message id."""
    pitch(client)
    message_id = last_message_id()
    assert send(client, event("checkout.session.completed", paid(message_id))).json()["result"] == "order added"
    assert wait_for(lambda: len(review_mail(review)) == 2)
    return message_id


# ---------------------------------------------------------------- off by default

def test_the_settings_default_to_off(off):
    from horizon import config, orbyt_review
    s = config.get()
    assert s.orbyt_review_enabled is False
    assert (s.orbyt_review_price, s.orbyt_review_webhook_secret) == ("", "")
    assert (s.orbyt_review_price_text, s.orbyt_review_days) == ("$19", 5)
    assert not orbyt_review.ready() and orbyt_review.offer() is None and orbyt_review.problems() == []


def test_settings_that_dont_make_sense_fall_back(monkeypatch):
    from horizon import config
    for raw, days in (("7", 7), ("0", 5), ("40", 5), ("five", 5), ("30", 30)):
        monkeypatch.setenv("ORBYT_REVIEW_DAYS", raw)
        assert config.get().orbyt_review_days == days, raw
    for raw, text in (("£15", "£15"), ("19 €", "19 €"), ("<b>free</b>", "$19"), ("", "$19")):
        monkeypatch.setenv("ORBYT_REVIEW_PRICE_TEXT", raw)
        assert config.get().orbyt_review_price_text == text, raw
    monkeypatch.setenv("ORBYT_REVIEW_STRIPE_PRICE", "price_x/../../v1/customers")
    assert config.get().orbyt_review_price == ""


def test_while_off_nothing_about_it_shows_anywhere(client, off, stripe):  # noqa: F811
    for path in ("/", "/genesis", "/orbyt", "/privacy", "/terms", "/partners", "/bundle", "/brand"):
        page = client.get(path).text
        assert "Pitch Review" not in page and "v-review" not in page, path
        assert 'data-review="off"' in page and 'data-review-price=""' in page, path
    for path in PATHS:
        assert client.post(path, json={}, headers=ORIGIN).status_code == 404, path
    assert client.get("/orbyt/review/thanks").status_code == 404
    # A pitch is sent as always, with no ticket.
    assert "review" not in pitch(client)
    assert stripe["calls"] == []
    owner(client)
    console = client.get("/console").text
    assert "Pitch Reviews" not in console and 'id="reviews"' not in console


@pytest.mark.parametrize("missing", ["STRIPE_SECRET_KEY", "ORBYT_REVIEW_STRIPE_WEBHOOK_SECRET",
                                     "ORBYT_REVIEW_STRIPE_PRICE", "MTRX_SMTP_HOST", "MTRX_ALERT_EMAIL"])
def test_switched_on_without_every_setting_it_stays_off(client, review, monkeypatch, missing):
    from horizon import orbyt_review, ready
    monkeypatch.delenv(missing, raising=False)
    assert orbyt_review.enabled() and not orbyt_review.ready()
    assert orbyt_review.problems() and any("Pitch Review is switched on" in line for line in ready.worth_a_look())
    assert "Pitch Review" not in client.get("/orbyt").text
    assert "review" not in pitch(client)
    assert client.post("/api/orbyt/review/checkout", json={}, headers=ORIGIN).status_code == 404


# ---------------------------------------------------------------- the offer

def test_when_on_orbyt_offers_it_only_after_a_pitch_is_sent(client, review):
    page = client.get("/orbyt").text
    text = flat(page)
    # The FAQ answers "What's a Pitch Review?" with no more than the terms say.
    faq = text.split('<div class="v-faq" id="faq">', 1)[1].split("</div>", 1)[0]
    assert "What's a Pitch Review?" in faq
    for words in ("optional extra you can add after sending your pitch", "what's strong, what to fix, your next 3 steps",
                  "emailed within 5 days", "one payment of $19 (not a subscription)", "paid by a grown-up",
                  "If it's late, or we can't review your idea, you get a full refund",
                  "Pitching is free, and every pitch gets a reply with or without one"):
        assert words in faq, words
    # The offer sits on the Sent screen, hidden until a pitch is sent.
    sent = text.split('<section class="panel v-sent"', 1)[1].split("</section>", 1)[0]
    assert '<div class="v-review" id="v-review" hidden>' in sent
    assert "Your pitch is sent and gets a reply either way." in sent
    assert "A grown-up pays." in sent and "I'm 18 or over, and I'm the one paying" in sent
    assert "Get a Pitch Review ($19)" in sent and "Full refund if it's late or we can't review it." in sent
    assert 'href="/terms#pitch-review"' in sent
    # Never on the form itself, and no pressure: no countdowns or "only today".
    form = text.split('<form class="v-form" data-kind="pitch"', 1)[1].split("</form>", 1)[0]
    assert 'id="v-review' not in form
    for pushy in ("limited", "only today", "hurry", "spots left", "last chance", "sale"):
        assert pushy not in sent.lower(), pushy
    # The page keeps the site's rules.
    assert 'style="' not in page and not re.search(r"\son[a-z]+=", page)


def test_a_sent_pitch_gets_a_one_time_ticket_and_other_paths_dont(client, review):
    from horizon import db
    answer = pitch(client)
    assert re.fullmatch(r"[A-Za-z0-9_-]{20,64}", answer["review"])
    assert "review" not in pitch(client, PARTNER)
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM orbyt_review_tickets")]
    # Only its fingerprint is kept.
    assert len(rows) == 1 and rows[0]["token_hash"] != answer["review"] and len(rows[0]["token_hash"]) == 64


def test_the_legal_pages_say_what_is_paid_what_you_get_and_the_refunds(client, review, monkeypatch):
    from horizon import main
    terms = flat(client.get("/terms").text)
    assert '<h2 id="pitch-review">Orbyt Pitch Review</h2>' in terms
    for words in ("Pitching in Orbyt is free", "one payment of $19 (not a subscription",
                  "what's strong, what to fix, your next 3 steps and whether it might fit Orbyt",
                  "within 5 days of the payment", "bought by an adult (18 or over)",
                  "If the review is late, or we can't review your idea, you get a full refund.",
                  "Refunds are made by hand through Stripe", "isn't an offer to invest in, buy, build or partner",
                  "Your idea stays yours"):
        assert words in terms, words
    privacy = flat(client.get("/privacy").text)
    assert '<h2 id="pitch-review">Orbyt Pitch Review</h2>' in privacy
    for words in ("Card details never reach us", "we keep only a fingerprint of the code, for 2 days",
                  "the email address used at checkout (to send the review to)",
                  "isn't deleted before the review is done", "deleted 90 days after the review is sent or refunded",
                  "after 400 days"):
        assert words in privacy, words
    for page in (terms, privacy):
        assert f"Last updated {main.REVIEW_LEGAL_UPDATED}" in page
    # The days and the price follow the settings.
    monkeypatch.setenv("ORBYT_REVIEW_DAYS", "7")
    monkeypatch.setenv("ORBYT_REVIEW_PRICE_TEXT", "£15")
    terms = flat(client.get("/terms").text)
    assert "within 7 days of the payment" in terms and "one payment of £15" in terms


def test_pilot_is_told_only_while_it_is_on(client, review):
    page = client.get("/orbyt").text
    assert 'data-review="on" data-review-price="$19"' in page and 'data-review-days="5"' in page


# ---------------------------------------------------------------- checkout

def test_checkout_makes_a_one_time_stripe_payment_for_that_pitch(client, review):
    ticket = pitch(client)["review"]
    message_id = last_message_id()
    response = checkout(client, ticket)
    assert response.status_code == 200, response.text
    assert response.json() == {"url": f"https://checkout.stripe.com/c/pay/{SESSION}"}
    call = review["stripe"]["calls"][-1]
    assert call["path"] == "/v1/checkout/sessions" and call["auth"] == "Bearer sk_test_not_real"
    form = call["form"]
    assert form["mode"] == "payment"
    assert form["line_items[0][price]"] == "price_review1" and form["line_items[0][quantity]"] == "1"
    assert form["metadata[product]"] == "orbyt_review" and form["metadata[message]"] == str(message_id)
    assert form["payment_intent_data[metadata][product]"] == "orbyt_review"
    assert form["success_url"] == "https://testserver/orbyt/review/thanks"
    assert form["cancel_url"] == "https://testserver/orbyt#review-cancelled"
    assert "grown-ups (18+)" in form["custom_text[submit][message]"]
    # The pitcher may be young: the grown-up gives their own email at checkout.
    assert "customer_email" not in form and "subscription_data[metadata][product]" not in form


def test_checkout_needs_the_18_tick_a_live_ticket_and_this_sites_page(client, review):
    from horizon import db, orbyt_review
    ticket = pitch(client)["review"]
    for adult in (False, None, "yes"):
        response = checkout(client, ticket, adult=adult)
        assert response.status_code == 400 and response.json()["field"] == "adult"
    for bad in ("", "x", "nope" * 20, None, 12):
        assert checkout(client, bad).status_code == 410
    # Not from this site's own page: refused before anything else.
    assert checkout(client, ticket, headers={}).status_code == 403
    assert review["stripe"]["calls"] == []
    # A ticket runs out after two days.
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_review_tickets SET created_at = ?", (time.time() - orbyt_review.TICKET_SECONDS - 1,))
    response = checkout(client, ticket)
    assert response.status_code == 410 and "Your pitch is still sent" in response.json()["error"]


def test_checkout_is_limited_and_says_so_when_stripe_is_down(client, review):
    ticket = pitch(client)["review"]
    review["stripe"]["down"] = True
    response = checkout(client, ticket)
    assert response.status_code == 502 and "try again" in response.json()["error"]
    review["stripe"]["down"] = False
    for _ in range(9):
        assert checkout(client, ticket).status_code == 200
    assert checkout(client, ticket).status_code == 429


def test_a_pitch_with_a_review_cant_be_bought_twice(client, review):
    ticket = pitch(client)["review"]
    assert send(client, event("checkout.session.completed", paid(last_message_id()))).status_code == 200
    response = checkout(client, ticket)
    assert response.status_code == 409 and response.json()["error"] == "This pitch already has a Pitch Review."


def test_the_thanks_page_says_what_happens_next(client, review):
    response = client.get("/orbyt/review/thanks")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store" and response.headers["x-robots-tag"] == "noindex"
    page = flat(response.text)
    assert "with the date your review is due" in page and "within 5 days" in page
    assert "If it's late, or we can't review your idea, you get a full refund." in page
    assert "not a subscription" in page and "<script" not in page.split("<footer", 1)[0]


# ---------------------------------------------------------------- the webhook

def test_only_a_good_signature_from_its_own_secret_is_accepted(client, review):
    import json
    evt = event("checkout.session.completed", paid(1))
    payload = json.dumps(evt).encode()
    path = "/api/orbyt/review/stripe"
    assert client.post(path, content=payload).status_code == 400
    assert client.post(path, content=payload, headers={"Stripe-Signature": "t=1,v1=00"}).status_code == 400
    assert send(client, evt, secret="whsec_wrong").status_code == 400
    # Genesis Pro's secret is not this endpoint's.
    assert send(client, evt, secret=PRO_SECRET).status_code == 400
    # More than five minutes old: a copied request can't be sent again later.
    assert send(client, evt, at=time.time() - 600).status_code == 400
    assert orders() == []
    # Stripe sends no Origin, and that is fine here.
    assert send(client, evt).status_code == 200


def test_a_paid_checkout_makes_one_order_and_tells_the_buyer_and_the_owner(client, review):
    from horizon import db, orbyt_review
    pitch(client)
    message_id = last_message_id()
    evt = event("checkout.session.completed", paid(message_id))
    answer = send(client, evt)
    assert answer.status_code == 200 and answer.json()["result"] == "order added"
    [order] = orders()
    assert order["message_id"] == message_id and order["email"] == BUYER and order["idea"] == "Nova"
    assert order["status"] == "open" and order["cents"] == 1900 and order["payment_intent"] == INTENT
    assert order["due_at"] - order["paid_at"] == 5 * 86400
    assert wait_for(lambda: len(review_mail(review)) == 2)
    buyer = next(m for m in review_mail(review) if m["to"] == BUYER)
    note = next(m for m in review_mail(review) if m["to"] == "")
    due = orbyt_review.due_text(order["due_at"])
    assert buyer["subject"] == "Your Orbyt Pitch Review is booked"
    body = " ".join(buyer["body"].split())
    for words in (f"by {due}", "what's strong, what to fix, the next 3 steps", "Paid: $19.00, once. It is not a subscription.",
                  "If the review is late, or we can't review the idea, you get a full refund.",
                  "Refunds are made by hand through Stripe", "Nova"):
        assert words in body, words
    # The owner's note: the idea and the due date, never the buyer's address.
    assert note["subject"] == f"MTRX Horizyn: a paid Pitch Review is due by {due}"
    assert "Nova" in note["body"] and BUYER not in note["body"] and "@" not in note["body"]
    # Stripe sends each event at least once: a repeat changes nothing and emails nobody.
    assert send(client, evt).json()["result"] == "repeat"
    # The same checkout in another event (async payment succeeded) is known.
    assert send(client, event("checkout.session.async_payment_succeeded", paid(message_id))).json()["result"] == "known"
    time.sleep(0.2)
    assert len(orders()) == 1 and len(review_mail(review)) == 2
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM orbyt_review_events").fetchone()[0] == 2
        assert "Pitch Review" in [r[0] for r in conn.execute("SELECT event FROM activity")]


def test_other_events_and_unpaid_checkouts_make_no_order(client, review):
    pitch(client)
    message_id = last_message_id()
    genesis = paid(message_id, mode="subscription", metadata={"product": "genesis_pro", "interval": "month"})
    assert send(client, event("checkout.session.completed", genesis)).json()["result"] == "not ours"
    other = paid(message_id, metadata={"product": "something_else"})
    assert send(client, event("checkout.session.completed", other)).json()["result"] == "not ours"
    unpaid = paid(message_id, payment_status="unpaid")
    assert send(client, event("checkout.session.completed", unpaid)).json()["result"] == "unpaid"
    assert send(client, event("invoice.paid", {"id": "in_1"})).json()["result"] == "ignored"
    assert orders() == [] and review_mail(review) == []


def test_a_full_refund_closes_the_order(client, review):
    buy(client, review)
    part = {"id": "ch_1", "object": "charge", "payment_intent": INTENT, "refunded": False, "amount_refunded": 500}
    assert send(client, event("charge.refunded", part)).json()["result"] == "part refunded"
    assert orders()[0]["status"] == "open"
    whole = {**part, "refunded": True, "amount_refunded": 1900}
    assert send(client, event("charge.refunded", whole)).json()["result"] == "refunded"
    assert orders()[0]["status"] == "refunded" and orders()[0]["refunded_at"]
    other = {**whole, "payment_intent": "pi_someone_else"}
    assert send(client, event("charge.refunded", other)).json()["result"] == "not ours"


def test_genesis_pros_webhook_leaves_pitch_reviews_alone(client, review, monkeypatch):
    """With both on, Stripe may send a review's events to Pro's endpoint too
    (with the same event id): Pro ignores them, and its list of events seen
    doesn't stop this endpoint from applying them."""
    from horizon import db
    from tests.test_genesis_pro import send as pro_send
    monkeypatch.setenv("GENESIS_PRO_ENABLED", "1")
    monkeypatch.setenv("GENESIS_PRO_STRIPE_WEBHOOK_SECRET", PRO_SECRET)
    monkeypatch.setenv("GENESIS_PRO_STRIPE_PRICE", "price_month1")
    monkeypatch.setenv("GENESIS_AI_KEY", "test-key")
    monkeypatch.setenv("GENESIS_AI_MODEL", "test-model-from-a-setting")
    pitch(client)
    evt = event("checkout.session.completed", paid(last_message_id()))
    assert pro_send(client, evt).json()["result"] == "not ours"
    assert send(client, evt).json()["result"] == "order added"
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM genesis_pro_members").fetchone()[0] == 0


# ---------------------------------------------------------------- the console

def test_only_the_owner_can_see_or_close_reviews(client, review):
    buy(client, review)
    assert client.get("/api/console/orbyt-reviews").status_code == 404
    assert client.post("/api/console/orbyt-reviews/1/sent", headers=ORIGIN).status_code == 404
    assert orders()[0]["status"] == "open"


def test_the_console_lists_open_reviews_and_marks_them_sent(client, review):
    from horizon import db, orbyt_review
    message_id = buy(client, review)
    owner(client)
    page = client.get("/console").text
    assert '<section class="panel reviews" id="reviews"' in page and 'href="#reviews"' in page
    data = client.get("/api/console/orbyt-reviews").json()
    assert data["ready"] and data["problems"] == [] and data["late"] == 0
    [item] = data["open"]
    assert item["idea"] == "Nova" and item["email"] == BUYER and item["message_id"] == message_id
    assert item["pitch"] == PITCH["pitch"] and item["pitch_there"] and not item["late"]
    assert item["due"] == orbyt_review.due_text(item["due_at"]) and item["paid"] == "$19.00"
    # A pitch with a review still to write can't be deleted from the inbox.
    response = client.post(f"/api/console/vortex/{message_id}/delete", headers=ORIGIN)
    assert response.status_code == 409 and "Pitch Review" in response.json()["error"]
    # Overdue: flagged late, so it can be sent or refunded.
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_reviews SET due_at = ?", (time.time() - 60,))
    data = client.get("/api/console/orbyt-reviews").json()
    assert data["late"] == 1 and data["open"][0]["late"]
    # Mark sent: it moves to Done, and can't be marked twice.
    done = client.post(f"/api/console/orbyt-reviews/{item['id']}/sent", headers=ORIGIN)
    assert done.status_code == 200 and done.json()["open"] == []
    assert done.json()["done"][0]["status"] == "sent" and done.json()["done"][0]["sent_at"]
    assert client.post(f"/api/console/orbyt-reviews/{item['id']}/sent", headers=ORIGIN).status_code == 409
    assert client.post("/api/console/orbyt-reviews/abc/sent", headers=ORIGIN).status_code == 409
    # Now the pitch can be deleted as usual.
    assert client.post(f"/api/console/vortex/{message_id}/delete", headers=ORIGIN).status_code == 200
    data = client.get("/api/console/orbyt-reviews").json()
    assert data["done"][0]["idea"] == "Nova" and not data["done"][0]["pitch_there"]


def test_the_console_keeps_showing_orders_after_it_is_switched_off(client, review, monkeypatch):
    buy(client, review)
    monkeypatch.delenv("ORBYT_REVIEW_ENABLED")
    owner(client)
    assert 'id="reviews"' in client.get("/console").text
    data = client.get("/api/console/orbyt-reviews").json()
    assert not data["enabled"] and len(data["open"]) == 1


# ---------------------------------------------------------------- forgetting

def test_upkeep_forgets_tickets_and_a_done_orders_email(client, review):
    from horizon import db, orbyt_review
    buy(client, review)
    day = 86400
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_review_tickets SET created_at = ?", (time.time() - 3 * day,))
        conn.execute("UPDATE orbyt_reviews SET status = 'sent', sent_at = ?, paid_at = ?",
                     (time.time() - 91 * day, time.time() - 96 * day))
    orbyt_review.forget_old()
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM orbyt_review_tickets").fetchone()[0] == 0
    [order] = orders()
    assert order["email"] == "" and order["idea"] == "" and order["cents"] == 1900
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_reviews SET paid_at = ?", (time.time() - 401 * day,))
    orbyt_review.forget_old()
    assert orders() == []


def test_an_open_order_is_never_forgotten(client, review):
    from horizon import db, orbyt_review
    buy(client, review)
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_reviews SET paid_at = ?", (time.time() - 500 * 86400,))
    orbyt_review.forget_old()
    assert orders()[0]["email"] == BUYER
