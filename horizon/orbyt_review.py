"""Orbyt Pitch Review: an optional, paid extra after a pitch is sent.

Orbyt stays free. Pitching, partnering and business enquiries never cost
anything, and every pitch gets a reply either way. A Pitch Review is a
one-time add-on to a pitch that has already been sent: a real person at
MTRX Horizyn writes a personal review of the idea (what's strong, what to
fix, the next 3 steps, and whether it might fit Orbyt) and emails it within
ORBYT_REVIEW_DAYS days (5). If it's late, or the idea can't be reviewed, the
buyer gets a full refund, which the owner makes by hand in Stripe.

How it is bought, without accounts:
1. Sending a pitch (vortex.send) answers with a one-time ticket for that
   pitch, while Pitch Review is on. Only its SHA-256 is kept, for two days.
2. A grown-up ticks "I'm 18 or over" and presses Get a Pitch Review. POST
   /api/orbyt/review/checkout makes a Stripe Checkout page for the one price
   id in the settings (Stripe holds the amount), and the browser goes there.
   Stripe takes the payment and the buyer's email; card details never reach
   this server.
3. Stripe tells this server through its own signed webhook
   (/api/orbyt/review/stripe, with its own signing secret) that the checkout
   is paid. That is the only thing that makes an order. The order is kept,
   the buyer is emailed a confirmation with the date the review is due, and
   the owner is emailed a short notice. The console lists open reviews with
   their due dates and a Mark sent button.

Who writes it (1.23.0): in AI mode (orbyt_review_ai.py; the default once
its three AI settings are there) the review is written by AI and emailed by
itself, usually within minutes, after the grown-up agreed at checkout that
the idea is sent to an AI service. The days are still the promise. If the
AI can't write it in time, the order is handed to the owner as in person
mode. The console shows every review, with Resend and Refund.

Genesis Pro's Stripe plumbing is reused (genesis_pro: the API call, the
signature check, the limits table), but this has its own webhook endpoint,
signing secret and event table: Genesis Pro's endpoint answers "page not
found" while Pro is off, and Stripe sends the same event, with the same id,
to every endpoint that asks for it.

Off until ORBYT_REVIEW_ENABLED=1, STRIPE_SECRET_KEY,
ORBYT_REVIEW_STRIPE_WEBHOOK_SECRET and ORBYT_REVIEW_STRIPE_PRICE are all set,
email works (MTRX_SMTP_*) and the owner's alert address is set (so the owner
always hears about a paid review). Until then every address here answers
"page not found" and no page mentions it. docs/ORBYT-PITCH-REVIEW.md has the
owner's steps.
"""

import hashlib
import json
import logging
import re
import secrets
import threading
import time

from . import config, db, genesis_pro, health, orbyt_review_ai

LOG = logging.getLogger("horizon")

# Written on every checkout and payment this makes, so events about anything
# else in the same Stripe account (Genesis Pro included) are left alone.
PRODUCT = "orbyt_review"
CHECKOUT_EVENTS = genesis_pro.CHECKOUT_EVENTS

# How long the ticket from sending a pitch can start a checkout.
TICKET_SECONDS = 2 * 86400
# The buyer's email and the idea's name are cleared this long after the
# review is sent or refunded; the rest of the order (dates and amount, no
# words, no address) goes after ORDER_DAYS.
FORGET_EMAIL_DAYS = 90
ORDER_DAYS = 400

# (most, per seconds), counted in the failed-tries table like Genesis Pro's.
RATES = {
    "review_checkout": (10, 3600),      # per address
    "review_webhook_bad": (60, 3600),   # unsigned or wrongly signed, per address
}

OFF = "Pitch Review isn't available right now."
BUSY = genesis_pro.BUSY
STRIPE_DOWN = genesis_pro.STRIPE_DOWN
ADULT = "Please tick to say you're 18 or over. If you're not, ask a parent or guardian to buy it for you."
EXPIRED = ("This Pitch Review offer has run out. Your pitch is still sent, and we'll reply as usual. "
           "To add a review, send your pitch again.")
ALREADY = "This pitch already has a Pitch Review."
AI_OK = "Please tick to agree that the idea is sent to an AI service to write the review."

_TICKET = re.compile(r"[A-Za-z0-9_-]{20,64}")
_SESSION = re.compile(r"cs_[A-Za-z0-9_]{1,250}")
_EMAIL = genesis_pro._EMAIL
_DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December")


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


# ---------------------------------------------------------------- switched on?

def enabled() -> bool:
    """The owner's switch only."""
    return config.get().orbyt_review_enabled


def email_ready() -> bool:
    s = config.get()
    return bool(s.smtp_host and (s.orbyt_review_email_from or s.alert_from or s.alert_email))


def ready() -> bool:
    """Switched on, every Stripe setting there, email working, and the owner's
    alert address set. It is offered only then: a buyer must get their
    confirmation, and the owner must hear about every paid review."""
    s = config.get()
    return bool(s.orbyt_review_enabled and s.stripe_secret_key and s.orbyt_review_webhook_secret
                and s.orbyt_review_price and email_ready() and s.alert_email)


def problems() -> list:
    """While it is switched on but not ready, what stops it, in plain words."""
    s = config.get()
    if not s.orbyt_review_enabled:
        return []
    out = []
    if not s.stripe_secret_key:
        out.append("Set STRIPE_SECRET_KEY to a restricted key from Stripe.")
    if not s.orbyt_review_webhook_secret:
        out.append("Set ORBYT_REVIEW_STRIPE_WEBHOOK_SECRET to the Pitch Review webhook endpoint's signing secret.")
    if not s.orbyt_review_price:
        out.append("Set ORBYT_REVIEW_STRIPE_PRICE to the one-time price id (price_...).")
    if not email_ready():
        out.append("Email isn't set up: set MTRX_SMTP_HOST (and its login) and ORBYT_REVIEW_EMAIL_FROM or "
                   "MTRX_ALERT_FROM, so each buyer gets their confirmation.")
    if not s.alert_email:
        out.append("Set MTRX_ALERT_EMAIL, so you're told about every paid review.")
    return out


def offer() -> dict | None:
    """What Orbyt shows about Pitch Review, or None when it is off."""
    if not ready():
        return None
    s = config.get()
    # ai: the review is written by AI (orbyt_review_ai.py) and sent within
    # about an hour; the days are still the promise (and the refund line).
    return {"price": s.orbyt_review_price_text, "days": s.orbyt_review_days,
            "ai": orbyt_review_ai.mode() == "ai", "ai_host": orbyt_review_ai.service_host()}


def due_text(at: float) -> str:
    """A due date in plain words, the same everywhere: "Friday 27 November 2026" (UTC)."""
    t = time.gmtime(at)
    return f"{_DAYS[t.tm_wday]} {t.tm_mday} {_MONTHS[t.tm_mon - 1]} {t.tm_year}"


# ---------------------------------------------------------------- tickets

def ticket_for(message_id: int, now: float | None = None) -> str | None:
    """A one-time ticket for a pitch just sent, or None while this is off.
    Only its hash is kept."""
    if not ready():
        return None
    now = time.time() if now is None else now
    ticket = secrets.token_urlsafe(24)
    with db.connect() as conn:
        conn.execute("INSERT INTO orbyt_review_tickets (token_hash, message_id, created_at) VALUES (?, ?, ?)",
                     (_hash(ticket), message_id, now))
    return ticket


def _pitch_for(conn, ticket) -> dict | None:
    if not isinstance(ticket, str) or not _TICKET.fullmatch(ticket):
        return None
    row = conn.execute("SELECT m.id, m.idea FROM orbyt_review_tickets t JOIN vortex_messages m "
                       "ON m.id = t.message_id WHERE t.token_hash = ? AND t.created_at > ? AND m.kind = 'pitch'",
                       (_hash(ticket), time.time() - TICKET_SECONDS)).fetchone()
    return dict(row) if row else None


def _has_review(conn, message_id: int) -> bool:
    return conn.execute("SELECT 1 FROM orbyt_reviews WHERE message_id = ? AND status IN ('open', 'sent')",
                        (message_id,)).fetchone() is not None


# ---------------------------------------------------------------- checkout

def checkout(who: str, ticket, adult, page: str, ai_ok=None) -> tuple[int, dict]:
    """A Stripe Checkout page for one Pitch Review. Returns (status, JSON).
    `page` is the Orbyt page's address, with no slash at the end
    (hosts.root): https://orbyt.mtrxhorizyn.com, or the main site's address
    and /orbyt.
    In AI mode the grown-up must also agree that the idea is sent to an AI
    service to write it; the checkout is marked so (metadata ai=1), and only
    a checkout marked so is ever written by AI."""
    if adult is not True:
        return 400, {"error": ADULT, "field": "adult"}
    ai = orbyt_review_ai.mode() == "ai"
    if ai and ai_ok is not True:
        return 400, {"error": AI_OK, "field": "ai"}
    with db.connect() as conn:
        pitch = _pitch_for(conn, ticket)
        if pitch is None:
            return 410, {"error": EXPIRED}
        if _has_review(conn, pitch["id"]):
            return 409, {"error": ALREADY}
    if not genesis_pro.allow("review_checkout", who, RATES):
        return 429, {"error": BUSY}
    s = config.get()
    days = s.orbyt_review_days
    fields = {
        "mode": "payment",
        "line_items[0][price]": s.orbyt_review_price,
        "line_items[0][quantity]": "1",
        "success_url": f"{page}/review/thanks",
        # Back from cancelling: the page says the pitch was sent and nothing
        # was charged, and offers the review again (static/js/vortex.js).
        "cancel_url": f"{page}#review-cancelled",
        "metadata[product]": PRODUCT,
        "metadata[message]": str(pitch["id"]),
        "payment_intent_data[metadata][product]": PRODUCT,
        "payment_intent_data[metadata][message]": str(pitch["id"]),
        "payment_intent_data[description]": "Orbyt Pitch Review",
        "custom_text[submit][message]": (
            f"Checkout is for grown-ups (18+). The review is written by AI from the idea and emailed to the "
            f"address you give here, usually within an hour. If it isn't with you within {days} "
            f"day{'s' if days != 1 else ''}, you get a full refund." if ai else
            f"Checkout is for grown-ups (18+). The review is emailed to the address you give here within "
            f"{days} day{'s' if days != 1 else ''}, or you get a full refund."),
    }
    if ai:
        fields["metadata[ai]"] = "1"
        fields["payment_intent_data[metadata][ai]"] = "1"
    try:
        url = genesis_pro._stripe("checkout/sessions", fields).get("url")
    except genesis_pro.StripeError as e:
        LOG.warning("Pitch Review: checkout couldn't start (%s)", e)
        return 502, {"error": STRIPE_DOWN}
    if not isinstance(url, str) or not url.startswith("https://"):
        return 502, {"error": STRIPE_DOWN}
    return 200, {"url": url}


# ---------------------------------------------------------------- the webhook

def webhook(who: str, payload: bytes, header: str) -> tuple[int, dict]:
    """Check Stripe's signature with this endpoint's own secret, then apply
    the event. The same rules as Genesis Pro's: a bad signature is refused
    and counted, and anything signed is answered 200."""
    if not genesis_pro._under("review_webhook_bad", who, RATES):
        return 429, {"error": "Too many bad signatures."}
    if not genesis_pro.verify(payload, header, config.get().orbyt_review_webhook_secret):
        genesis_pro.allow("review_webhook_bad", who, RATES)
        LOG.warning("Pitch Review: a webhook arrived without a good Stripe signature")
        return 400, {"error": "Bad signature."}
    try:
        event = json.loads(payload)
    except (ValueError, RecursionError):
        return 400, {"error": "Not JSON."}
    if not isinstance(event, dict):
        return 400, {"error": "Not an event."}
    return 200, {"ok": True, "result": apply_event(event)}


_applying = threading.Lock()


def apply_event(event: dict) -> str:
    """One Stripe event: a paid checkout makes an order, a refund marks it
    refunded. An event seen before is skipped, so a retried one changes
    nothing and emails nobody twice."""
    event_id = event.get("id") if isinstance(event.get("id"), str) else ""
    kind = event.get("type") if isinstance(event.get("type"), str) else ""
    data = event.get("data")
    obj = data.get("object") if isinstance(data, dict) else None
    if not event_id or not isinstance(obj, dict):
        return "ignored"
    created = genesis_pro._int(event.get("created")) or int(time.time())
    tell = None
    with _applying, db.connect() as conn:
        if conn.execute("SELECT 1 FROM orbyt_review_events WHERE id = ?", (event_id[:255],)).fetchone():
            return "repeat"
        if kind in CHECKOUT_EVENTS:
            result, tell = _paid(conn, obj, created)
        elif kind == "charge.refunded":
            result = _refunded(conn, obj)
        else:
            result = "ignored"
        conn.execute("INSERT INTO orbyt_review_events (id, at) VALUES (?, ?)", (event_id[:255], time.time()))
    if result not in ("ignored", "not ours", "unknown", "unpaid"):
        db.log("Pitch Review", f"{kind}: {result}")
    if tell:
        send_emails(tell)
    return result


def _paid(conn, obj: dict, created: int):
    """A paid checkout for a Pitch Review: the order, and who to tell."""
    meta = genesis_pro._meta(obj)
    if obj.get("mode") != "payment" or meta.get("product") != PRODUCT:
        return "not ours", None
    if obj.get("payment_status") not in ("paid", "no_payment_required"):
        # A bank payment that takes days: its own "succeeded" event follows.
        return "unpaid", None
    session = genesis_pro._str(obj.get("id"))
    if not _SESSION.fullmatch(session):
        return "ignored", None
    message = genesis_pro._str(meta.get("message"))
    message_id = int(message) if message.isdigit() and len(message) <= 12 else 0
    email = (genesis_pro._str(genesis_pro._dict(obj.get("customer_details")).get("email"))
             or genesis_pro._str(obj.get("customer_email"))).strip()
    email = email if _EMAIL.fullmatch(email) and len(email) <= 254 else ""
    if conn.execute("SELECT 1 FROM orbyt_reviews WHERE session = ?", (session,)).fetchone():
        return "known", None
    found = conn.execute("SELECT idea FROM vortex_messages WHERE id = ? AND kind = 'pitch'",
                         (message_id,)).fetchone()
    idea = found["idea"] if found else ""
    cents = genesis_pro._int(obj.get("amount_total")) or 0
    currency = genesis_pro._str(obj.get("currency"), "usd").lower()[:8]
    paid_at = float(created)
    due_at = paid_at + config.get().orbyt_review_days * 86400
    conn.execute(
        "INSERT INTO orbyt_reviews (message_id, session, payment_intent, email, idea, cents, currency, paid_at, "
        "due_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
        (message_id, session, genesis_pro._id(obj.get("payment_intent")), email, idea, cents, currency,
         paid_at, due_at, time.time()))
    order = dict(conn.execute("SELECT * FROM orbyt_reviews WHERE session = ?", (session,)).fetchone())
    # Written by AI only when the grown-up agreed at checkout and AI mode is
    # still on now; otherwise a person writes it, as before.
    order["ai"] = bool(found) and meta.get("ai") == "1" and orbyt_review_ai.mode() == "ai"
    if order["ai"]:
        orbyt_review_ai.queue(conn, order["id"])
    return ("order added" if found else "order added, pitch not found"), order


def _refunded(conn, obj: dict) -> str:
    """A whole refund closes the order; a part refund is only noted."""
    intent = genesis_pro._id(obj.get("payment_intent"))
    if not intent:
        return "not ours"
    order = conn.execute("SELECT * FROM orbyt_reviews WHERE payment_intent = ?", (intent,)).fetchone()
    if order is None:
        return "not ours"
    if obj.get("refunded") is not True:
        return "part refunded"
    conn.execute("UPDATE orbyt_reviews SET status = 'refunded', refunded_at = COALESCE(refunded_at, ?) "
                 "WHERE id = ?", (time.time(), order["id"]))
    return "refunded"


# ---------------------------------------------------------------- email

def buyer_email(order: dict) -> tuple[str, str]:
    """The confirmation: what was bought, by when, and the refund promise."""
    idea = f" for “{order['idea']}”" if order["idea"] else ""
    paid = genesis_pro.money(order["cents"], order["currency"]) if order["cents"] else ""
    if order.get("ai"):
        subject = "Your Orbyt Pitch Review is on its way"
        body = (f"Thank you for buying a Pitch Review{idea}.\n\n"
                f"Your review is written by AI from the pitch that was sent, and emailed to this address,\n"
                f"usually within an hour: what's strong, what to fix, the next 3 steps, and whether the\n"
                f"idea might fit Orbyt. To write it, the idea's words (never anyone's name or email\n"
                f"address) are sent to an AI service, as agreed at checkout.\n\n"
                + (f"Paid: {paid}, once. It is not a subscription.\n\n" if paid else
                   "It is a one-time payment, not a subscription.\n\n")
                + f"If the review isn't with you by {due_text(order['due_at'])}, or we can't review the idea,\n"
                  "you get a full refund. Refunds are made by hand through Stripe, back to the card that\n"
                  "paid; just reply to ask.\n\n"
                  "A review is an opinion to help, not an offer to invest in, buy or partner on the idea.\n"
                  "The idea stays yours.\n\n"
                  "- MTRX Horizyn\n")
        return subject, body
    subject = "Your Orbyt Pitch Review is booked"
    body = (f"Thank you for buying a Pitch Review{idea}.\n\n"
            f"A real person at MTRX Horizyn will read the pitch and email a personal review to this\n"
            f"address by {due_text(order['due_at'])}: what's strong, what to fix, the next 3 steps,\n"
            f"and whether the idea might fit Orbyt.\n\n"
            + (f"Paid: {paid}, once. It is not a subscription.\n\n" if paid else
               "It is a one-time payment, not a subscription.\n\n")
            + "If the review is late, or we can't review the idea, you get a full refund. Refunds are\n"
              "made by hand through Stripe, back to the card that paid; just reply to ask.\n\n"
              "A review is our honest opinion, not an offer to invest in, buy or partner on the idea.\n"
              "The idea stays yours.\n\n"
              "- MTRX Horizyn\n")
    return subject, body


def owner_email(order: dict) -> tuple[str, str]:
    """The owner's short notice: the idea's name and the due date only.
    The buyer's address is read in the console, so no inbox keeps it."""
    idea = vortex_clean(order["idea"]) or "(the pitch is no longer there)"
    if order.get("ai"):
        subject = "MTRX Horizyn: a paid Pitch Review is being written by AI"
        body = (f"Someone bought a Pitch Review.\n\n"
                f"Idea:  {idea}\n"
                f"Due:   {due_text(order['due_at'])}\n\n"
                f"The AI writes it and emails it to the buyer by itself, usually within an hour. You can\n"
                f"read it in the console's Pitch Reviews section. You'll get another email only if it\n"
                f"needs you.\n\n- MTRX Horizyn\n")
        return subject, body
    subject = f"MTRX Horizyn: a paid Pitch Review is due by {due_text(order['due_at'])}"
    body = (f"Someone bought a Pitch Review.\n\n"
            f"Idea:  {idea}\n"
            f"Due:   {due_text(order['due_at'])}\n\n"
            f"Read the pitch and write the review from the console's Pitch Reviews section,\n"
            f"then press Mark sent. If it can't be done in time, refund it in Stripe.\n\n- MTRX Horizyn\n")
    return subject, body


def handover_email(order: dict, why: str) -> tuple[str, str]:
    """The AI couldn't do this one: the owner writes it (or refunds it), and why."""
    idea = vortex_clean(order.get("idea") or "") or "(the idea's name is gone)"
    subject = f"MTRX Horizyn: a Pitch Review needs you (due {due_text(order['due_at'])})"
    body = (f"The AI couldn't write and send the Pitch Review for this idea, so it's yours to do.\n\n"
            f"Idea:  {idea}\n"
            f"Due:   {due_text(order['due_at'])}\n"
            f"Why:   {why}\n\n"
            f"Write it from the console's Pitch Reviews section and press Mark sent, or refund it,\n"
            f"before it's due.\n\n- MTRX Horizyn\n")
    return subject, body


def vortex_clean(text: str) -> str:
    from . import vortex  # vortex imports this module
    return vortex._clean_for_email(text) if text else ""


def _send_both(order: dict):
    s = config.get()
    if order["email"]:
        subject, body = buyer_email(order)
        try:
            health.send_email(subject, body, to=order["email"], sender=s.orbyt_review_email_from)
        except Exception as exc:  # its kind only: never the address
            LOG.warning("Pitch Review confirmation not sent: %s", type(exc).__name__)
    subject, body = owner_email(order)
    try:
        health.send_email(subject, body)
    except Exception as exc:
        LOG.warning("Pitch Review notice not sent: %s", type(exc).__name__)
    if order.get("ai"):
        # After the confirmation, so the review never arrives before it.
        orbyt_review_ai.kick()


def send_emails(order: dict, wait: bool = False):
    """Both emails from their own thread, so Stripe never waits on the mail server."""
    thread = threading.Thread(target=_send_both, args=(order,), daemon=True)
    thread.start()
    if wait:
        thread.join(timeout=30)
    return thread


# ---------------------------------------------------------------- the console

# What the console says about an AI job, by its state.
AI_STATES = {"queued": "The AI is writing it", "writing": "The AI is writing it",
             "written": "Written by AI; the email is being sent", "sent": "Written by AI",
             "person": "Needs you", "stopped": "The AI stopped: it was closed first"}


def _public(r, now: float) -> dict:
    ai = None
    if r["job_state"]:
        ai = {"state": r["job_state"], "said": AI_STATES.get(r["job_state"], r["job_state"]),
              "note": r["job_note"] or "", "text": r["job_text"] or "", "tries": r["job_tries"] or 0,
              "next_at": r["job_next"], "written_at": r["job_written"], "emailed_at": r["job_emailed"]}
    return {"id": r["id"], "message_id": r["message_id"], "idea": r["idea"], "email": r["email"],
            "pitch": r["pitch"] or "", "audience": r["audience"] or "", "name": r["name"] or "",
            "pitch_there": r["name"] is not None, "paid_at": r["paid_at"], "due_at": r["due_at"],
            "due": due_text(r["due_at"]), "late": r["status"] == "open" and r["due_at"] < now,
            "status": r["status"], "sent_at": r["sent_at"], "refunded_at": r["refunded_at"],
            "paid": genesis_pro.money(r["cents"], r["currency"]) if r["cents"] else "",
            # Who writes it: the AI (with where it is, and its words once
            # written), or the owner.
            "by": "ai" if ai and ai["state"] != "person" else "person", "ai": ai,
            "can_resend": bool(ai and ai["text"] and r["email"] and r["status"] != "refunded"),
            "can_refund": bool(r["payment_intent"] and r["status"] != "refunded")}


def console(now: float | None = None) -> dict:
    """Open reviews, soonest due first, and the latest done or refunded."""
    now = time.time() if now is None else now
    query = ("SELECT o.*, m.name, m.pitch, m.audience, j.state AS job_state, j.note AS job_note, "
             "j.text AS job_text, j.tries AS job_tries, j.next_at AS job_next, j.written_at AS job_written, "
             "j.emailed_at AS job_emailed FROM orbyt_reviews o "
             "LEFT JOIN vortex_messages m ON m.id = o.message_id AND m.kind = 'pitch' "
             "LEFT JOIN orbyt_review_jobs j ON j.order_id = o.id ")
    with db.connect() as conn:
        open_rows = conn.execute(query + "WHERE o.status = 'open' ORDER BY o.due_at, o.id").fetchall()
        done_rows = conn.execute(query + "WHERE o.status != 'open' ORDER BY COALESCE(o.sent_at, o.refunded_at) "
                                 "DESC, o.id DESC LIMIT 20").fetchall()
    s = config.get()
    return {"enabled": s.orbyt_review_enabled, "ready": ready(), "problems": problems(),
            "days": s.orbyt_review_days, "price": s.orbyt_review_price_text,
            # Who writes new reviews, and the AI's day so far.
            "mode": orbyt_review_ai.mode(), "ai_notes": orbyt_review_ai.notes(),
            "ai_today": orbyt_review_ai.calls_today(), "ai_per_day": s.orbyt_review_ai_per_day,
            "open": [_public(r, now) for r in open_rows], "done": [_public(r, now) for r in done_rows],
            "late": sum(1 for r in open_rows if r["due_at"] < now)}


def shown_in_console() -> bool:
    """The console's section shows while this is switched on, or while any
    order is still kept."""
    if enabled():
        return True
    with db.connect() as conn:
        return conn.execute("SELECT 1 FROM orbyt_reviews LIMIT 1").fetchone() is not None


def mark_sent(order_id: int) -> bool:
    """The owner emailed the review. False if there is no open order. An AI
    job still waiting stops."""
    with db.connect() as conn:
        done = conn.execute("UPDATE orbyt_reviews SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'open'",
                            (time.time(), order_id)).rowcount > 0
        if done:
            conn.execute("UPDATE orbyt_review_jobs SET state = 'stopped' WHERE order_id = ? "
                         "AND state IN ('queued', 'written')", (order_id,))
    if done:
        db.log("Pitch Review", "marked sent")
    return done


NOTHING_TO_RESEND = "There's no review written by AI to send again for that one."
NO_REFUND = "That one has no Stripe payment to refund, or is already refunded."
REFUND_FAILED = ("Stripe didn't make the refund. Refund it in Stripe (Payments, then the payment, then Refund); "
                 "for this button to work, your Stripe key needs Refunds: write.")


def resend(order_id: int) -> tuple[int, dict]:
    """Email an AI-written review to the buyer again (or for the first time,
    if its email failed). Returns (status, JSON)."""
    with db.connect() as conn:
        order = conn.execute("SELECT * FROM orbyt_reviews WHERE id = ?", (order_id,)).fetchone()
        job = conn.execute("SELECT * FROM orbyt_review_jobs WHERE order_id = ?", (order_id,)).fetchone()
    if order is None or job is None or not job["text"] or not order["email"] or order["status"] == "refunded":
        return 409, {"error": NOTHING_TO_RESEND}
    if not orbyt_review_ai.send_review(dict(order), job["text"]):
        return 502, {"error": "The email couldn't be sent just now. Check the mail settings, then try again."}
    now = time.time()
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_review_jobs SET state = 'sent', emailed_at = ?, claimed_at = NULL "
                     "WHERE order_id = ?", (now, order_id))
        conn.execute("UPDATE orbyt_reviews SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'open'",
                     (now, order_id))
    db.log("Pitch Review", "review emailed again")
    return 200, {"ok": True}


def refund(order_id: int) -> tuple[int, dict]:
    """Refund an order in full through Stripe, and close it. Stripe's own
    charge.refunded event follows and changes nothing more."""
    with db.connect() as conn:
        order = conn.execute("SELECT * FROM orbyt_reviews WHERE id = ?", (order_id,)).fetchone()
    if order is None or not order["payment_intent"] or order["status"] == "refunded":
        return 409, {"error": NO_REFUND}
    try:
        genesis_pro._stripe("refunds", {"payment_intent": order["payment_intent"],
                                        "metadata[product]": PRODUCT, "metadata[order]": str(order_id)})
    except genesis_pro.StripeError as e:
        LOG.warning("Pitch Review: refund not made (%s)", e)
        return 502, {"error": REFUND_FAILED}
    with db.connect() as conn:
        conn.execute("UPDATE orbyt_reviews SET status = 'refunded', refunded_at = COALESCE(refunded_at, ?) "
                     "WHERE id = ?", (time.time(), order_id))
        conn.execute("UPDATE orbyt_review_jobs SET state = 'stopped' WHERE order_id = ? "
                     "AND state IN ('queued', 'written', 'person')", (order_id,))
    db.log("Pitch Review", "refunded from the console")
    return 200, {"ok": True}


def open_for(message_id: int) -> bool:
    """Whether a pitch has a paid review still to write (it can't be deleted then)."""
    with db.connect() as conn:
        return conn.execute("SELECT 1 FROM orbyt_reviews WHERE message_id = ? AND status = 'open'",
                            (message_id,)).fetchone() is not None


# ---------------------------------------------------------------- upkeep

def forget_old():
    """Run by the upkeep loop: old tickets and event ids go; a done order's
    email address and idea name are cleared after FORGET_EMAIL_DAYS, and the
    order itself goes after ORDER_DAYS."""
    now = time.time()
    with db.connect() as conn:
        conn.execute("DELETE FROM orbyt_review_tickets WHERE created_at < ?", (now - TICKET_SECONDS,))
        conn.execute("DELETE FROM orbyt_review_events WHERE at < ?", (now - 60 * 86400,))
        old = now - FORGET_EMAIL_DAYS * 86400
        # The AI's review goes with the email address it was sent to.
        conn.execute("UPDATE orbyt_review_jobs SET text = '', note = '' WHERE order_id IN (SELECT id FROM "
                     "orbyt_reviews WHERE status != 'open' AND COALESCE(sent_at, refunded_at, paid_at) < ?)", (old,))
        conn.execute("UPDATE orbyt_reviews SET email = '', idea = '' WHERE status != 'open' "
                     "AND COALESCE(sent_at, refunded_at, paid_at) < ?", (old,))
        conn.execute("DELETE FROM orbyt_reviews WHERE status != 'open' AND paid_at < ?", (now - ORDER_DAYS * 86400,))
        conn.execute("DELETE FROM orbyt_review_jobs WHERE order_id NOT IN (SELECT id FROM orbyt_reviews)")
    orbyt_review_ai.forget_old()
