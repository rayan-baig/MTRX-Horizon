"""Genesis Pro: a paid upgrade to Genesis for the people who use it most.

The free plan does not change. Pro adds:
- far more Ask Genesis help: GENESIS_PRO_PER_DAY answers a day (100) where
  the free plan has 30, longer and more detailed answers, three more helpers
  and room for a longer question. Pro asks have their own allowance, so they
  never wait on, or use up, the free plan's shared daily budget;
- a private cloud backup of the member's projects (the last few copies), so
  clearing the browser loses nothing;
- "Download plan": one project as a tidy text file (made in the browser).

Nothing a member makes is ever shown to anyone else. There is no publishing
or sharing, so there is nothing to moderate.

How someone becomes Pro, without accounts or passwords:
1. A grown-up presses Get Pro. POST /api/genesis/pro/checkout makes a Stripe
   Checkout page for the monthly or the yearly price, named only by the price
   ids in the settings (Stripe holds the amounts), and the browser goes there.
2. Stripe tells this server through its signed webhook that the checkout is
   paid. The webhook is the only thing that makes anyone Pro, or stops them
   being Pro: a cancelled subscription, a failed payment, a refund.
3. A Pro key is made and emailed to the address the buyer gave Stripe, and
   the page Stripe sends them back to shows a key once and keeps it in that
   browser. The page sends the key with each Pro request, in a header (no
   cookie). Only the SHA-256 of each key is kept, and of the email address;
   "Send me a new key" emails a fresh key to an address whose fingerprint
   matches a member's. Card details never reach this server.

Off until GENESIS_PRO_ENABLED=1 and STRIPE_SECRET_KEY,
GENESIS_PRO_STRIPE_WEBHOOK_SECRET and GENESIS_PRO_STRIPE_PRICE are all set.
Until then every Pro address answers "page not found" and no page mentions
Pro. docs/GENESIS-PRO.md has the cost sums and the owner's Stripe steps.
"""

import base64
import calendar
import hashlib
import hmac
import json
import logging
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config, db, health

LOG = logging.getLogger("horizon")

STRIPE_API = "https://api.stripe.com/v1"
STRIPE_TIMEOUT = 15
# Stripe's own advice: refuse a signature more than five minutes old, so a
# copied request can't be sent again later.
WEBHOOK_TOLERANCE = 300

# Written on every checkout and subscription this site makes, so events about
# anything else in the same Stripe account are left alone.
PRODUCT = "genesis_pro"
PLANS = ("month", "year")

# Stripe's subscription states in which a member has Pro. A cancelled
# subscription stays "active" until the time already paid for runs out.
PRO_STATES = ("active", "trialing")

KEY_HEADER = "x-genesis-pro-key"
KEYS_PER_MEMBER = 5
# The page Stripe sends a buyer back to can show their first key this long.
CLAIM_SECONDS = 2 * 86400

BACKUP_MAX_BYTES = 1_000_000
BACKUPS_KEPT = 3
# A member's backups are deleted this long after Pro ends.
BACKUP_KEEP_AFTER_END = 60 * 86400

# How long the prices read from Stripe are trusted before being read again.
PRICE_SECONDS = 3600

# Every new address is limited: (most, per seconds), counted in the
# failed-tries table (lock.py), so each row goes after a day.
RATES = {
    "pro_checkout": (10, 3600),       # per address
    "pro_claim": (90, 3600),          # per address; the welcome page asks every few seconds
    "pro_status": (120, 3600),        # per address
    "pro_bad_key": (20, 3600),        # wrong keys, per address
    "pro_resend": (5, 3600),          # per address
    "pro_resend_member": (3, 86400),  # emails to one member a day
    "pro_portal": (10, 3600),         # per member
    "pro_backup": (60, 3600),         # per member
    "pro_restore": (30, 3600),        # per member
    "pro_webhook_bad": (60, 3600),    # unsigned or wrongly signed, per address
}

OFF = "Genesis Pro isn't available right now."
BUSY = "That's a lot of tries for now. Please wait a little and try again."
NO_KEY = "That Pro key doesn't work. Check it, or ask for a new one to be emailed."
STRIPE_DOWN = "Checkout couldn't start just now. Please try again in a minute."
SENT = ("If that email address has Genesis Pro, a new key is on its way. "
        "Check the spam folder too.")
NO_EMAIL = "Emailing keys isn't set up yet. Please use the business enquiries link to ask for help."
PRO_DAY = "That's today's Pro answers used up. More are ready tomorrow."
PRO_ALLOWANCE = ("You've used Pro's AI help for this month. It tops up day by day, "
                 "so try again tomorrow.")

_EMAIL = re.compile(r"[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+")
_SESSION = re.compile(r"cs_[A-Za-z0-9_]{1,250}")
_KEY = re.compile(r"GP[A-Z2-7]{24}")
_STRIPE_ID = re.compile(r"[A-Za-z0-9_]{1,255}")


class StripeError(Exception):
    """Stripe could not be reached, or said no. Never holds its message."""


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def enabled() -> bool:
    """The owner's switch only."""
    return config.get().genesis_pro_enabled


def ready() -> bool:
    """Switched on and every Stripe setting there. Pro shows only then."""
    s = config.get()
    return bool(s.genesis_pro_enabled and s.stripe_secret_key and s.genesis_pro_webhook_secret
                and s.genesis_pro_price)


def email_ready() -> bool:
    s = config.get()
    return bool(s.smtp_host and (s.genesis_pro_email_from or s.alert_from or s.alert_email))


# ---------------------------------------------------------------- limits

_counting = threading.Lock()


def allow(kind: str, who: str) -> bool:
    """Count one use of `kind` by `who`, or say they have used it enough."""
    limit, window = RATES[kind]
    now = time.time()
    with _counting, db.connect() as conn:
        (count,) = conn.execute("SELECT COUNT(*) FROM attempts WHERE kind = ? AND who = ? AND at > ?",
                                (kind, who, now - window)).fetchone()
        if count >= limit:
            return False
        conn.execute("INSERT INTO attempts (kind, who, at) VALUES (?, ?, ?)", (kind, who, now))
        return True


def _under(kind: str, who: str) -> bool:
    """Whether `who` still has some of `kind` left, without using any."""
    limit, window = RATES[kind]
    with db.connect() as conn:
        (count,) = conn.execute("SELECT COUNT(*) FROM attempts WHERE kind = ? AND who = ? AND at > ?",
                                (kind, who, time.time() - window)).fetchone()
    return count < limit


# ---------------------------------------------------------------- Stripe

def _stripe(path: str, fields: dict | None = None, method: str = "POST") -> dict:
    """One call to Stripe's API with the secret key. Raises StripeError."""
    data = urllib.parse.urlencode(fields or {}).encode() if method == "POST" else None
    request = urllib.request.Request(f"{STRIPE_API}/{path}", data=data, method=method)
    request.add_header("Authorization", "Bearer " + config.get().stripe_secret_key)
    if data is not None:
        request.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(request, timeout=STRIPE_TIMEOUT) as response:
            body = json.loads(response.read(1_000_000).decode())
    except urllib.error.HTTPError as exc:
        raise StripeError(f"Stripe answered {exc.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        raise StripeError(type(exc).__name__) from None
    if not isinstance(body, dict):
        raise StripeError("not an object")
    return body


_SYMBOLS = {"usd": "$", "gbp": "£", "eur": "€", "cad": "CA$", "aud": "A$"}


def money(cents: int, currency: str) -> str:
    """499, "usd" -> "$4.99"."""
    amount = f"{cents / 100:,.2f}"
    symbol = _SYMBOLS.get(currency.lower())
    return f"{symbol}{amount}" if symbol else f"{amount} {currency.upper()}"


_prices: dict = {"at": 0.0, "for": (), "month": None, "year": None}
_pricing = threading.Lock()


def _read_price(price_id: str) -> dict | None:
    body = _stripe(f"prices/{price_id}", method="GET")
    cents, currency = body.get("unit_amount"), body.get("currency")
    if not isinstance(cents, int) or isinstance(cents, bool) or not isinstance(currency, str):
        return None
    return {"cents": cents, "currency": currency.lower(), "label": money(cents, currency)}


def refresh_prices(force: bool = False):
    """Read the two prices' amounts from Stripe, at most once an hour. Run by
    the upkeep loop, so a visitor never waits for it."""
    s = config.get()
    if not ready():
        return
    wanted = (s.genesis_pro_price, s.genesis_pro_yearly_price)
    if not force and _prices["for"] == wanted and time.time() - _prices["at"] < PRICE_SECONDS:
        return
    if not _pricing.acquire(blocking=False):
        return
    try:
        found = {}
        for plan, price_id in zip(PLANS, wanted):
            found[plan] = _read_price(price_id) if price_id else None
        _prices.update(found, at=time.time(), **{"for": wanted})
    except StripeError as e:
        LOG.warning("Genesis Pro: couldn't read the prices from Stripe (%s)", e)
    finally:
        _pricing.release()


def offer() -> dict | None:
    """What the Genesis page shows about Pro, or None when it is off."""
    if not ready():
        return None
    s = config.get()
    known = _prices["for"] == (s.genesis_pro_price, s.genesis_pro_yearly_price)
    month = _prices["month"] if known else None
    year = _prices["year"] if known and s.genesis_pro_yearly_price else None
    months_free = None
    if month and year and month["currency"] == year["currency"] and month["cents"] > 0:
        free = round(12 - year["cents"] / month["cents"])
        months_free = free if free >= 1 else None
    return {"month": month, "year": year, "yearly": bool(s.genesis_pro_yearly_price),
            "months_free": months_free, "per_day": s.genesis_pro_per_day,
            "free_per_day": s.genesis_ai_per_day}


def checkout(who: str, plan, base: str) -> tuple[int, dict]:
    """A Stripe Checkout page for the chosen plan. Returns (status, JSON)."""
    s = config.get()
    if plan not in PLANS:
        return 400, {"error": "Choose monthly or yearly."}
    price = s.genesis_pro_price if plan == "month" else s.genesis_pro_yearly_price
    if not price:
        return 400, {"error": "Yearly isn't offered yet. Choose monthly instead."}
    if not allow("pro_checkout", who):
        return 429, {"error": BUSY}
    fields = {
        "mode": "subscription",
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
        "success_url": f"{base}/genesis/pro/welcome?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base}/genesis#pro",
        "metadata[product]": PRODUCT,
        "metadata[interval]": plan,
        "subscription_data[metadata][product]": PRODUCT,
        "subscription_data[metadata][interval]": plan,
        "allow_promotion_codes": "true",
        "custom_text[submit][message]": ("Checkout is for grown-ups. If you're under 18, please ask a "
                                         "parent or carer to buy Genesis Pro for you."),
    }
    try:
        url = _stripe("checkout/sessions", fields).get("url")
    except StripeError as e:
        LOG.warning("Genesis Pro: checkout couldn't start (%s)", e)
        return 502, {"error": STRIPE_DOWN}
    if not isinstance(url, str) or not url.startswith("https://"):
        return 502, {"error": STRIPE_DOWN}
    return 200, {"url": url}


# ---------------------------------------------------------------- keys

def new_key() -> str:
    """GP-ABCD-EFGH-...: 120 random bits, in letters and digits that are
    hard to mix up, in groups of four so a grown-up can type it."""
    raw = base64.b32encode(secrets.token_bytes(15)).decode()
    return "GP-" + "-".join(raw[i:i + 4] for i in range(0, 24, 4))


def _normal(raw) -> str | None:
    """A key as typed or pasted (any case, spaces, dashes), or None."""
    if not isinstance(raw, str) or len(raw) > 80:
        return None
    flat = re.sub(r"[^A-Za-z0-9]", "", raw).upper()
    return flat if _KEY.fullmatch(flat) else None


def issue_key(conn, member_id: str, now: float | None = None) -> str:
    """A fresh key for a member. Only its hash is kept. Once they have more
    than KEYS_PER_MEMBER, the ones that go are those never used, oldest
    first, then those used longest ago: anyone who knows a member's email
    can ask for new keys to be sent, and that must never stop the key a
    member's own browser uses."""
    now = time.time() if now is None else now
    key = new_key()
    hashed = _hash(_normal(key) or "")
    conn.execute("INSERT INTO genesis_pro_keys (key_hash, member_id, created_at) VALUES (?, ?, ?)",
                 (hashed, member_id, now))
    conn.execute("DELETE FROM genesis_pro_keys WHERE member_id = ? AND key_hash != ? AND key_hash NOT IN "
                 "(SELECT key_hash FROM genesis_pro_keys WHERE member_id = ? AND key_hash != ? "
                 "ORDER BY last_used IS NULL, COALESCE(last_used, created_at) DESC, rowid DESC LIMIT ?)",
                 (member_id, hashed, member_id, hashed, KEYS_PER_MEMBER - 1))
    return key


def member_for_key(raw) -> dict | None:
    """The member a key belongs to, whatever their state, or None."""
    flat = _normal(raw)
    if flat is None:
        return None
    with db.connect() as conn:
        row = conn.execute("SELECT m.* FROM genesis_pro_keys k JOIN genesis_pro_members m "
                           "ON m.id = k.member_id WHERE k.key_hash = ?", (_hash(flat),)).fetchone()
        if row is None:
            return None
        conn.execute("UPDATE genesis_pro_keys SET last_used = ? WHERE key_hash = ?", (time.time(), _hash(flat)))
    return dict(row)


def is_pro(member: dict | None) -> bool:
    return member is not None and member["status"] in PRO_STATES


def pro_member(raw) -> dict | None:
    """The member for this key if Pro is on and they have it now, else None."""
    if not raw or not ready():
        return None
    member = member_for_key(raw)
    return member if is_pro(member) else None


# ---------------------------------------------------------------- the webhook

def verify(payload: bytes, header: str, secret: str, now: float | None = None) -> bool:
    """Stripe's signature: an HMAC-SHA256 of "timestamp.body" with the
    endpoint's secret, sent within WEBHOOK_TOLERANCE seconds."""
    if not secret or not header or len(header) > 2000:
        return False
    parts: dict = {}
    for item in header.split(","):
        key, _, value = item.partition("=")
        parts.setdefault(key.strip(), []).append(value.strip())
    try:
        stamp = int(parts.get("t", [""])[0])
    except ValueError:
        return False
    if abs((time.time() if now is None else now) - stamp) > WEBHOOK_TOLERANCE:
        return False
    expected = hmac.new(secret.encode(), f"{stamp}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in parts.get("v1", []))


def webhook(who: str, payload: bytes, header: str) -> tuple[int, dict]:
    """Check Stripe's signature, then apply the event. Returns (status, JSON).

    A bad signature is refused and counted; an address with many is refused
    without checking. Anything signed is answered 200, even an event this
    site has no use for, or Stripe would send it again for days.
    """
    if not _under("pro_webhook_bad", who):
        return 429, {"error": "Too many bad signatures."}
    if not verify(payload, header, config.get().genesis_pro_webhook_secret):
        allow("pro_webhook_bad", who)
        LOG.warning("Genesis Pro: a webhook arrived without a good Stripe signature")
        return 400, {"error": "Bad signature."}
    try:
        event = json.loads(payload)
    except (ValueError, RecursionError):
        return 400, {"error": "Not JSON."}
    if not isinstance(event, dict):
        return 400, {"error": "Not an event."}
    return 200, {"ok": True, "result": apply_event(event)}


def _id(value) -> str:
    """A Stripe id from a field that may be the id or the expanded object."""
    if isinstance(value, dict):
        value = value.get("id")
    return value if isinstance(value, str) and _STRIPE_ID.fullmatch(value) else ""


def _int(value) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _dict(value) -> dict:
    return value if isinstance(value, dict) else {}


def _str(value, default: str = "") -> str:
    return value if isinstance(value, str) else default


def _meta(obj: dict) -> dict:
    return _dict(obj.get("metadata"))


def _by_subscription(conn, subscription: str):
    if not subscription:
        return None
    return conn.execute("SELECT * FROM genesis_pro_members WHERE subscription = ?", (subscription,)).fetchone()


def _period_end(subscription: dict) -> int | None:
    """When the time paid for runs out. Newer Stripe versions keep it on the
    subscription's items."""
    value = _int(subscription.get("current_period_end"))
    if value is None:
        items = (subscription.get("items") or {}).get("data") or []
        value = next((_int(i.get("current_period_end")) for i in items
                      if isinstance(i, dict) and _int(i.get("current_period_end"))), None)
    return value


def _price_of(subscription: dict) -> tuple[int | None, str | None, str | None]:
    """(cents a period, currency, "month" or "year") from the first item."""
    items = _dict(subscription.get("items")).get("data") or []
    item = _dict(items[0]) if isinstance(items, list) and items else {}
    price = _dict(item.get("price"))
    cents = _int(price.get("unit_amount"))
    quantity = _int(item.get("quantity")) or 1
    interval = _str(_dict(price.get("recurring")).get("interval"))
    currency = _str(price.get("currency"))
    return ((cents * quantity if cents is not None else None), currency.lower()[:8] or None,
            interval if interval in PLANS else None)


def _invoice_subscription(invoice: dict) -> str:
    found = _id(invoice.get("subscription"))
    if not found:
        found = _id(_dict(_dict(invoice.get("parent")).get("subscription_details")).get("subscription"))
    return found


def _invoice_is_ours(invoice: dict) -> bool:
    """Whether an invoice is for Genesis Pro: its subscription's metadata or
    one of its lines' prices say so."""
    s = config.get()
    ours = {p for p in (s.genesis_pro_price, s.genesis_pro_yearly_price) if p}
    for details in (_dict(invoice.get("subscription_details")),
                    _dict(_dict(invoice.get("parent")).get("subscription_details"))):
        if _meta(details).get("product") == PRODUCT:
            return True
    lines = _dict(invoice.get("lines")).get("data")
    for line in (lines if isinstance(lines, list) else [])[:50]:
        line = _dict(line)
        listed = _dict(_dict(line.get("pricing")).get("price_details")).get("price")
        if _id(line.get("price")) in ours or _id(listed) in ours:
            return True
    return False


_applying = threading.Lock()


def apply_event(event: dict) -> str:
    """Change who is Pro from one Stripe event. Returns a word saying what
    happened, for the tests and Stripe's dashboard.

    Stripe sends each event at least once and not always in order, so an
    event seen before is skipped, and a subscription event older than the
    last one applied to that member changes nothing.
    """
    event_id = event.get("id") if isinstance(event.get("id"), str) else ""
    kind = event.get("type") if isinstance(event.get("type"), str) else ""
    obj = (event.get("data") or {}).get("object") if isinstance(event.get("data"), dict) else None
    if not event_id or not isinstance(obj, dict):
        return "ignored"
    created = _int(event.get("created")) or int(time.time())
    send = None
    with _applying, db.connect() as conn:
        if conn.execute("SELECT 1 FROM genesis_pro_events WHERE id = ?", (event_id[:255],)).fetchone():
            return "repeat"
        if kind in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
            # The second comes days later for a payment that takes time,
            # such as a bank debit: the checkout finished "unpaid".
            result, send = _checkout_completed(conn, obj, created)
        elif kind in ("customer.subscription.created", "customer.subscription.updated",
                      "customer.subscription.deleted"):
            result = _subscription_changed(conn, obj, created, kind.endswith("deleted"))
        elif kind in ("invoice.paid", "invoice.payment_succeeded"):
            result = _invoice_paid(conn, obj, created)
        elif kind == "invoice.payment_failed":
            result = _invoice_failed(conn, obj, created)
        elif kind == "charge.refunded":
            result = _refunded(conn, obj, created)
        else:
            result = "ignored"
        conn.execute("INSERT INTO genesis_pro_events (id, at) VALUES (?, ?)", (event_id[:255], time.time()))
    if result not in ("ignored", "not ours", "unknown", "old"):
        db.log("Genesis Pro", f"{kind}: {result}")
    if send:
        send_key_email(*send)
    return result


def _checkout_completed(conn, obj: dict, created: int):
    """A paid checkout makes a member (or brings one back) and a key to email."""
    if obj.get("mode") != "subscription" or _meta(obj).get("product") != PRODUCT:
        return "not ours", None
    if obj.get("payment_status") not in ("paid", "no_payment_required"):
        return "unpaid", None
    subscription, customer = _id(obj.get("subscription")), _id(obj.get("customer"))
    if not subscription:
        return "ignored", None
    email = (_str(_dict(obj.get("customer_details")).get("email")) or _str(obj.get("customer_email"))).strip()
    email = email if _EMAIL.fullmatch(email) else ""
    session = _str(obj.get("id"))
    session = session if _SESSION.fullmatch(session) else ""
    interval = _str(_meta(obj).get("interval"))
    interval = interval if interval in PLANS else "month"
    subtotal = _int(obj.get("amount_subtotal"))
    cents = subtotal if subtotal is not None else (_int(obj.get("amount_total")) or 0)
    currency = _str(obj.get("currency"), "usd")
    now = time.time()
    member = _by_subscription(conn, subscription)
    if member is not None:
        # Retried or late: fill in what the subscription's own events could
        # not say, and never undo a later cancel, refund or failed payment.
        conn.execute("UPDATE genesis_pro_members SET customer = COALESCE(NULLIF(customer, ''), ?), "
                     "email_hash = COALESCE(NULLIF(email_hash, ''), ?), "
                     "checkout_hash = COALESCE(NULLIF(checkout_hash, ''), ?), updated_at = ? WHERE id = ?",
                     (customer, _hash(email.lower()) if email else "", _hash(session) if session else "",
                      now, member["id"]))
        return "known", None
    member_id = secrets.token_hex(12)
    conn.execute(
        "INSERT INTO genesis_pro_members (id, customer, subscription, email_hash, checkout_hash, status, "
        "interval, amount_cents, currency, event_at, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)",
        (member_id, customer, subscription, _hash(email.lower()) if email else "",
         _hash(session) if session else "", interval, cents, currency.lower()[:8], created, now, now))
    key = issue_key(conn, member_id, now)
    return "member added", ((email, key) if email else None)


def _subscription_changed(conn, obj: dict, created: int, deleted: bool) -> str:
    member = _by_subscription(conn, _id(obj.get("id")))
    if member is None:
        return "unknown"
    if created < member["event_at"]:
        return "old"
    status = "canceled" if deleted else obj.get("status")
    if not isinstance(status, str) or not status:
        return "ignored"
    status = status[:32]
    if status in ("incomplete", "incomplete_expired"):
        # Only before the first payment: a member is made only once the
        # checkout is paid, so this is a late copy from the same moment
        # (Stripe's times are in whole seconds, its order not promised).
        return "old"
    if member["status"] == "refunded" and status in PRO_STATES:
        # Refunded stays refunded until a new payment arrives (invoice.paid).
        status = "refunded"
    period_end = _period_end(obj)
    cancel_at = _int(obj.get("cancel_at")) or (period_end if obj.get("cancel_at_period_end") else None)
    cents, currency, interval = _price_of(obj)
    pro = status in PRO_STATES
    now = time.time()
    renews: float | None
    ends: float | None
    if pro:
        # Cancelled in Stripe's page: still Pro until the time paid for ends.
        renews, ends = (None, cancel_at) if cancel_at else (period_end, None)
    elif status in ("canceled", "refunded"):
        renews, ends = None, member["ends_at"] or now
    else:
        renews, ends = None, None
    conn.execute(
        "UPDATE genesis_pro_members SET status = ?, renews_at = ?, ends_at = ?, "
        "amount_cents = COALESCE(?, amount_cents), currency = COALESCE(?, currency), "
        "interval = COALESCE(?, interval), customer = COALESCE(NULLIF(customer, ''), ?), "
        "event_at = ?, updated_at = ? WHERE id = ?",
        (status, renews, ends, cents, currency, interval,
         _id(obj.get("customer")), created, now, member["id"]))
    return ("cancelling" if pro and cancel_at else status)


def _invoice_paid(conn, obj: dict, created: int) -> str:
    subscription = _invoice_subscription(obj)
    member = _by_subscription(conn, subscription)
    if member is None and not _invoice_is_ours(obj):
        return "not ours"
    cents = _int(obj.get("amount_paid"))
    currency = _str(obj.get("currency"), "usd")
    invoice_id = _id(obj.get("id"))
    if invoice_id and cents is not None:
        conn.execute("INSERT OR IGNORE INTO genesis_pro_payments (key, kind, subscription, customer, cents, "
                     "currency, at) VALUES (?, 'paid', ?, ?, ?, ?, ?)",
                     ("invoice:" + invoice_id, subscription, _id(obj.get("customer")), cents,
                      currency.lower()[:8], created))
    if member is not None and member["status"] in ("past_due", "unpaid", "refunded") \
            and created >= member["event_at"]:
        conn.execute("UPDATE genesis_pro_members SET status = 'active', ends_at = NULL, event_at = ?, "
                     "updated_at = ? WHERE id = ?", (created, time.time(), member["id"]))
        return "paid, back on"
    return "paid"


def _invoice_failed(conn, obj: dict, created: int) -> str:
    member = _by_subscription(conn, _invoice_subscription(obj))
    if member is None:
        return "unknown"
    if created < member["event_at"] or member["status"] not in PRO_STATES:
        return "old"
    conn.execute("UPDATE genesis_pro_members SET status = 'past_due', event_at = ?, updated_at = ? "
                 "WHERE id = ?", (created, time.time(), member["id"]))
    return "past_due"


def _refunded(conn, obj: dict, created: int) -> str:
    """A refund is noted for the numbers; a whole refund ends Pro at once."""
    customer = _id(obj.get("customer"))
    if not customer:
        return "not ours"
    member = conn.execute("SELECT * FROM genesis_pro_members WHERE customer = ? "
                          "ORDER BY created_at DESC LIMIT 1", (customer,)).fetchone()
    if member is None:
        return "not ours"
    cents = _int(obj.get("amount_refunded"))
    charge = _id(obj.get("id"))
    currency = _str(obj.get("currency"), "usd")
    if charge and cents is not None:
        # amount_refunded is the charge's running total, so it replaces.
        conn.execute("INSERT OR REPLACE INTO genesis_pro_payments (key, kind, subscription, customer, cents, "
                     "currency, at) VALUES (?, 'refund', ?, ?, ?, ?, ?)",
                     ("refund:" + charge, member["subscription"], customer, cents, currency.lower()[:8], created))
    if obj.get("refunded") is True and created >= member["event_at"]:
        conn.execute("UPDATE genesis_pro_members SET status = 'refunded', renews_at = NULL, ends_at = ?, "
                     "event_at = ?, updated_at = ? WHERE id = ?",
                     (time.time(), created, time.time(), member["id"]))
        return "refunded"
    return "part refunded"


# ---------------------------------------------------------------- email

def _key_email(key: str) -> tuple[str, str]:
    subject = "Your Genesis Pro key"
    body = (f"Thank you for getting Genesis Pro.\n\n"
            f"Your Pro key:\n\n    {key}\n\n"
            f"Pro is already on in the browser you bought it from. To turn it on somewhere else,\n"
            f"open Genesis on the MTRX Horizyn website, choose \"I have a Pro key\" and paste it in.\n\n"
            f"Keep it private, like a password: anyone with it can use your Pro.\n"
            f"To cancel, or change how you pay, choose \"Manage subscription\" in Genesis.\n\n"
            f"- MTRX Horizyn\n")
    return subject, body


def _send(to: str, key: str):
    subject, body = _key_email(key)
    try:
        health.send_email(subject, body, to=to, sender=config.get().genesis_pro_email_from)
    except Exception as exc:  # its kind only: never the address or the key
        LOG.warning("Genesis Pro key email not sent: %s", type(exc).__name__)


def send_key_email(to: str, key: str, wait: bool = False):
    """Email a key from its own thread, so Stripe and the visitor never wait
    on the mail server. The address is used for this and not kept."""
    if not email_ready():
        return None
    thread = threading.Thread(target=_send, args=(to, key), daemon=True)
    thread.start()
    if wait:
        thread.join(timeout=30)
    return thread


def resend(who: str, email) -> tuple[int, dict]:
    """Email a new key to a member's address. The answer is the same whether
    or not the address has Pro, so nobody can use it to learn who does."""
    if not isinstance(email, str) or not _EMAIL.fullmatch(email.strip()) or len(email.strip()) > 254:
        return 400, {"error": "That email address doesn't look right. Please check it."}
    if not email_ready():
        return 503, {"error": NO_EMAIL}
    if not allow("pro_resend", who):
        return 429, {"error": BUSY}
    email = email.strip()
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM genesis_pro_members WHERE email_hash = ? ORDER BY created_at DESC",
                            (_hash(email.lower()),)).fetchall()
        member = next((r for r in rows if r["status"] in PRO_STATES), None)
        if member is not None and allow("pro_resend_member", member["id"]):
            key = issue_key(conn, member["id"])
        else:
            key = None
    if key:
        send_key_email(email, key)
    return 200, {"ok": True, "message": SENT}


# ---------------------------------------------------------------- the welcome page

def claim(who: str, session) -> tuple[int, dict]:
    """The page Stripe sends a buyer back to: their first key, shown once.

    It only finds a member the webhook has made; until then it says
    "pending" and the page asks again. The checkout's id is a one-time
    ticket: once a key has been shown for it, it shows no more.
    """
    if not isinstance(session, str) or not _SESSION.fullmatch(session):
        return 400, {"error": "This link isn't complete. Check your email for your key."}
    if not allow("pro_claim", who):
        return 429, {"error": BUSY}
    with db.connect() as conn:
        member = conn.execute("SELECT * FROM genesis_pro_members WHERE checkout_hash = ?",
                              (_hash(session),)).fetchone()
        if member is None:
            return 202, {"pending": True}
        if member["claimed_at"] is not None or time.time() - member["created_at"] > CLAIM_SECONDS:
            return 410, {"error": "This page has already shown its key. Your key is in your email, "
                                  "or ask Genesis for a new one."}
        if member["status"] not in PRO_STATES:
            return 403, {"error": "This Genesis Pro isn't active any more."}
        taken = conn.execute("UPDATE genesis_pro_members SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL",
                             (time.time(), member["id"])).rowcount
        if not taken:
            return 410, {"error": "This page has already shown its key."}
        key = issue_key(conn, member["id"])
    return 200, {"key": key, "email": email_ready(), **_describe(dict(member))}


# ---------------------------------------------------------------- what a member sees

def _describe(member: dict) -> dict:
    return {"pro": is_pro(member), "status": member["status"], "plan": member["interval"],
            "renews_at": member["renews_at"], "ends_at": member["ends_at"]}


def status(who: str, raw) -> tuple[int, dict]:
    """What the Genesis page shows a browser holding a key."""
    if not allow("pro_status", who) or not _under("pro_bad_key", who):
        return 429, {"error": BUSY}
    member = member_for_key(raw)
    if member is None:
        allow("pro_bad_key", who)
        return 200, {"pro": False, "known": False, "error": NO_KEY}
    out = {"known": True, **_describe(member), "email": email_ready()}
    if is_pro(member):
        s = config.get()
        out["per_day"] = s.genesis_pro_per_day
        out["left_today"] = max(0, s.genesis_pro_per_day - asks_today(member["id"]))
        out["backups"] = backups(member["id"])
    return 200, out


def _member_or_refusal(who: str, raw) -> dict | tuple[int, dict]:
    """The Pro member for a request's key, or the answer to send instead."""
    if not _under("pro_bad_key", who):
        return 429, {"error": BUSY}
    member = member_for_key(raw)
    if member is None:
        allow("pro_bad_key", who)
        return 403, {"error": NO_KEY, "pro": False}
    if not is_pro(member):
        return 403, {"error": "Genesis Pro isn't active on this key.", "pro": False}
    return member


def portal(who: str, raw, base: str) -> tuple[int, dict]:
    """Stripe's own page for cancelling or changing how to pay."""
    member = member_for_key(raw) if _under("pro_bad_key", who) else None
    if member is None:
        allow("pro_bad_key", who)
        return 403, {"error": NO_KEY}
    if not member["customer"]:
        return 409, {"error": "Stripe hasn't said who paid yet. Please try again in a minute."}
    if not allow("pro_portal", member["id"]):
        return 429, {"error": BUSY}
    try:
        url = _stripe("billing_portal/sessions", {"customer": member["customer"],
                                                  "return_url": f"{base}/genesis#pro"}).get("url")
    except StripeError as e:
        LOG.warning("Genesis Pro: the subscription page couldn't open (%s)", e)
        return 502, {"error": "That page couldn't open just now. Please try again in a minute."}
    if not isinstance(url, str) or not url.startswith("https://"):
        return 502, {"error": "That page couldn't open just now. Please try again in a minute."}
    return 200, {"url": url}


# ---------------------------------------------------------------- Pro asks

_claiming = threading.Lock()


def asks_today(member_id: str) -> int:
    with db.connect() as conn:
        (n,) = conn.execute("SELECT COUNT(*) FROM genesis_pro_spend WHERE member_id = ? AND at > ?",
                            (member_id, time.time() - 86400)).fetchone()
    return n


def claim_ask(member_id: str, worst: float) -> tuple[int | None, str | None]:
    """Count one Pro ask and set its worst-case cost aside against the
    member's 31-day allowance, or say which limit it hit."""
    s = config.get()
    now = time.time()
    with _claiming, db.connect() as conn:
        (hour,) = conn.execute("SELECT COUNT(*) FROM genesis_pro_spend WHERE member_id = ? AND at > ?",
                               (member_id, now - 3600)).fetchone()
        (day,) = conn.execute("SELECT COUNT(*) FROM genesis_pro_spend WHERE member_id = ? AND at > ?",
                              (member_id, now - 86400)).fetchone()
        if hour >= s.genesis_pro_per_hour or day >= s.genesis_pro_per_day:
            return None, PRO_DAY
        (spent,) = conn.execute("SELECT COALESCE(SUM(usd), 0) FROM genesis_pro_spend WHERE member_id = ? AND at > ?",
                                (member_id, now - 31 * 86400)).fetchone()
        if spent + worst > s.genesis_pro_monthly_ai_usd:
            return None, PRO_ALLOWANCE
        cursor = conn.execute("INSERT INTO genesis_pro_spend (member_id, at, usd) VALUES (?, ?, ?)",
                              (member_id, now, worst))
        return cursor.lastrowid, None


def settle_ask(spend_id: int, usd: float):
    with db.connect() as conn:
        conn.execute("UPDATE genesis_pro_spend SET usd = ? WHERE id = ?", (round(usd, 6), spend_id))


# ---------------------------------------------------------------- cloud backup

_PROJECT_ID = re.compile(r"[A-Za-z0-9-]{1,64}")
_TEXT = {"name": 60, "pitch": 140, "audience": 120, "address": 253, "notes": 5000}
_STAGES = ("spark", "plan", "build", "launch")


def _clean_project(raw) -> dict | None:
    """One project with only the fields Genesis has, each checked. The
    browser cleans them again when it reads a backup back."""
    if not isinstance(raw, dict):
        return None
    out: dict = {}
    if not isinstance(raw.get("id"), str) or not _PROJECT_ID.fullmatch(raw["id"]):
        return None
    out["id"] = raw["id"]
    for field, limit in _TEXT.items():
        value = raw.get(field, "")
        if not isinstance(value, str) or len(value) > limit:
            return None
        out[field] = value
    if not (out["name"] and out["pitch"] and out["audience"]):
        return None
    out["stage"] = raw.get("stage") if raw.get("stage") in _STAGES else "spark"
    ticks = _dict(raw.get("ticks"))
    out["ticks"] = {k: True for k, v in list(ticks.items())[:40]
                    if isinstance(k, str) and re.fullmatch(r"[a-z]{1,20}", k) and v is True}
    for field in ("created", "updated"):
        value = raw.get(field)
        out[field] = int(value) if (isinstance(value, (int, float)) and not isinstance(value, bool)
                                    and 0 < value < 8.64e15) else 0
    return out


def save_backup(who: str, raw, body: dict) -> tuple[int, dict]:
    member = _member_or_refusal(who, raw)
    if isinstance(member, tuple):
        return member
    projects = body.get("projects")
    if not isinstance(projects, list) or len(projects) > 100:
        return 400, {"error": "That isn't a list of Genesis projects."}
    clean = [p for p in (_clean_project(r) for r in projects) if p is not None]
    if not clean:
        return 400, {"error": "There are no projects to back up yet."}
    if not allow("pro_backup", member["id"]):
        return 429, {"error": BUSY}
    text = json.dumps({"format": 1, "projects": clean}, ensure_ascii=False, separators=(",", ":"))
    now = time.time()
    with db.connect() as conn:
        conn.execute("INSERT INTO genesis_pro_backups (member_id, at, projects, body) VALUES (?, ?, ?, ?)",
                     (member["id"], now, len(clean), text))
        conn.execute("DELETE FROM genesis_pro_backups WHERE member_id = ? AND id NOT IN "
                     "(SELECT id FROM genesis_pro_backups WHERE member_id = ? ORDER BY at DESC, id DESC LIMIT ?)",
                     (member["id"], member["id"], BACKUPS_KEPT))
    return 200, {"ok": True, "backups": backups(member["id"]), "skipped": len(projects) - len(clean)}


def backups(member_id: str) -> list:
    with db.connect() as conn:
        rows = conn.execute("SELECT id, at, projects FROM genesis_pro_backups WHERE member_id = ? "
                            "ORDER BY at DESC, id DESC", (member_id,)).fetchall()
    return [{"id": r["id"], "at": r["at"], "projects": r["projects"]} for r in rows]


def list_backups(who: str, raw) -> tuple[int, dict]:
    member = _member_or_refusal(who, raw)
    if isinstance(member, tuple):
        return member
    return 200, {"backups": backups(member["id"])}


def restore(who: str, raw, backup_id) -> tuple[int, dict]:
    member = _member_or_refusal(who, raw)
    if isinstance(member, tuple):
        return member
    if not isinstance(backup_id, int) or isinstance(backup_id, bool):
        return 400, {"error": "Choose a backup to restore."}
    if not allow("pro_restore", member["id"]):
        return 429, {"error": BUSY}
    with db.connect() as conn:
        row = conn.execute("SELECT body FROM genesis_pro_backups WHERE id = ? AND member_id = ?",
                           (backup_id, member["id"])).fetchone()
    if row is None:
        return 404, {"error": "That backup isn't there any more."}
    return 200, {"projects": json.loads(row["body"])["projects"]}


def delete_backups(who: str, raw) -> tuple[int, dict]:
    member = _member_or_refusal(who, raw)
    if isinstance(member, tuple):
        return member
    with db.connect() as conn:
        conn.execute("DELETE FROM genesis_pro_backups WHERE member_id = ?", (member["id"],))
    return 200, {"ok": True, "backups": []}


# ---------------------------------------------------------------- upkeep

def forget_old():
    """Run by the upkeep loop: old event ids, spend rows and payments go, and
    the backups of anyone whose Pro ended BACKUP_KEEP_AFTER_END ago."""
    now = time.time()
    with db.connect() as conn:
        conn.execute("DELETE FROM genesis_pro_events WHERE at < ?", (now - 60 * 86400,))
        conn.execute("DELETE FROM genesis_pro_spend WHERE at < ?", (now - 32 * 86400,))
        conn.execute("DELETE FROM genesis_pro_payments WHERE at < ?", (now - 400 * 86400,))
        conn.execute("DELETE FROM genesis_pro_backups WHERE member_id IN (SELECT id FROM genesis_pro_members "
                     f"WHERE status NOT IN {PRO_STATES!r} AND updated_at < ?)", (now - BACKUP_KEEP_AFTER_END,))
        old = [r[0] for r in conn.execute(
            f"SELECT id FROM genesis_pro_members WHERE status NOT IN {PRO_STATES!r} AND updated_at < ?",
            (now - 400 * 86400,))]
        for member_id in old:
            conn.execute("DELETE FROM genesis_pro_keys WHERE member_id = ?", (member_id,))
            conn.execute("DELETE FROM genesis_pro_members WHERE id = ?", (member_id,))


# ---------------------------------------------------------------- the console

def _month_start(now: float, back: int = 0) -> float:
    """Midnight UTC on the first of this month, or of `back` months before."""
    t = time.gmtime(now)
    year, month = t.tm_year, t.tm_mon - back
    while month < 1:
        year, month = year - 1, month + 12
    return float(calendar.timegm((year, month, 1, 0, 0, 0)))


def numbers(now: float | None = None) -> dict | None:
    """The console's Genesis Pro card, or None while Pro is off and nobody
    has ever had it. Money is in US dollars; anything paid in another
    currency is counted apart, not converted."""
    now = time.time() if now is None else now
    s = config.get()
    with db.connect() as conn:
        members = [dict(r) for r in conn.execute("SELECT * FROM genesis_pro_members")]
        this_month, last_month = _month_start(now), _month_start(now, 1)
        payments = [dict(r) for r in conn.execute("SELECT kind, cents, currency, at FROM genesis_pro_payments "
                                                  "WHERE at >= ?", (last_month,))]
        (spend,) = conn.execute("SELECT COALESCE(SUM(usd), 0) FROM genesis_pro_spend WHERE at > ?",
                                (now - 30 * 86400,)).fetchone()
    if not s.genesis_pro_enabled and not members:
        return None
    active = [m for m in members if m["status"] in PRO_STATES]
    usd = [m for m in active if m["currency"] == "usd"]
    mrr = sum(m["amount_cents"] if m["interval"] == "month" else m["amount_cents"] / 12 for m in usd)

    def total(kind, start, end):
        return sum(p["cents"] for p in payments
                   if p["kind"] == kind and p["currency"] == "usd" and start <= p["at"] < end)

    return {
        "enabled": s.genesis_pro_enabled,
        "ready": ready(),
        "members": len(active),
        "monthly": sum(1 for m in active if m["interval"] == "month"),
        "yearly": sum(1 for m in active if m["interval"] == "year"),
        "cancelling": sum(1 for m in active if m["ends_at"]),
        "past_due": sum(1 for m in members if m["status"] == "past_due"),
        "new_this_month": sum(1 for m in members if m["created_at"] >= this_month),
        "ended_this_month": sum(1 for m in members if m["status"] not in PRO_STATES + ("past_due",)
                                and m["updated_at"] >= this_month),
        "mrr_usd": round(mrr / 100, 2),
        "other_currency": len(active) - len(usd),
        "collected_usd": round((total("paid", this_month, now + 1) - total("refund", this_month, now + 1)) / 100, 2),
        "refunded_usd": round(total("refund", this_month, now + 1) / 100, 2),
        "last_month_usd": round((total("paid", last_month, this_month) - total("refund", last_month, this_month)) / 100, 2),
        "ai_30d_usd": round(spend, 2),
        "ai_cap_usd": s.genesis_pro_monthly_ai_usd,
        "per_day": s.genesis_pro_per_day,
        # Still the safe high defaults: every answer is counted at ten times
        # a small model's price, so members get fewer answers than they should.
        "default_prices": (s.genesis_ai_input_price, s.genesis_ai_output_price) == (10.0, 50.0),
    }
