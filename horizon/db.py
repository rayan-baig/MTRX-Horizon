"""The database: one SQLite file.

Every function opens a short connection, so there is no shared state to
get wrong between threads.
"""

import sqlite3
import time
from contextlib import contextmanager

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    public_key BLOB NOT NULL,
    created_at REAL NOT NULL,
    last_seen REAL,
    removed_at REAL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS knocks (
    token_hash TEXT PRIMARY KEY,
    expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
    challenge TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
    token_hash TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    expires_at REAL NOT NULL,
    used_at REAL
);
CREATE TABLE IF NOT EXISTS used_setup_tokens (
    token_hash TEXT PRIMARY KEY,
    used_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
    kind TEXT NOT NULL,
    who TEXT NOT NULL,
    at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_lookup ON attempts (kind, who, at);
-- For the clean-up of old tries, which otherwise read the whole table.
CREATE INDEX IF NOT EXISTS attempts_age ON attempts (at);
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at REAL NOT NULL,
    event TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS app_snapshots (
    app TEXT NOT NULL,
    at REAL NOT NULL,
    online INTEGER NOT NULL,
    users INTEGER,
    active_users INTEGER
);
CREATE INDEX IF NOT EXISTS snapshots_lookup ON app_snapshots (app, at);
-- One row per health check of an app: up or not, and how long it took.
CREATE TABLE IF NOT EXISTS health_checks (
    app TEXT NOT NULL,
    at REAL NOT NULL,
    up INTEGER NOT NULL,
    ms INTEGER,
    status INTEGER
);
CREATE INDEX IF NOT EXISTS health_lookup ON health_checks (app, at);
-- Every alert about an app, sent or not, so they can be kept to a few.
CREATE TABLE IF NOT EXISTS health_alerts (
    app TEXT NOT NULL,
    at REAL NOT NULL,
    kind TEXT NOT NULL,
    sent INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_lookup ON health_alerts (app, at);
-- Server errors, so the owner gets at most one email an hour for each
-- and a few a day (see errors.py). Kept two days.
CREATE TABLE IF NOT EXISTS error_reports (
    fingerprint TEXT NOT NULL,
    at REAL NOT NULL,
    sent INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS error_reports_at ON error_reports (at);
-- Ask Genesis (genesis_ai.py): one row per question, so each visitor's asks
-- can be counted. Only who (the address, as the failed-tries table keeps
-- it) and when; never the question or the idea. Deleted after a day.
CREATE TABLE IF NOT EXISTS genesis_asks (
    who TEXT NOT NULL,
    at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS genesis_asks_lookup ON genesis_asks (who, at);
-- What each answer is estimated to have cost, for the daily cap. Kept two days.
CREATE TABLE IF NOT EXISTS genesis_spend (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at REAL NOT NULL,
    usd REAL NOT NULL
);
-- Chroma Vortex (vortex.py): what a visitor chose to send through the form,
-- for the owner to read and reply to. Only the form's own fields, the time
-- and the path; never the sender's address or a cookie. Deleted after 365 days.
CREATE TABLE IF NOT EXISTS vortex_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at REAL NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    organisation TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    apps TEXT NOT NULL DEFAULT '',
    partnership TEXT NOT NULL DEFAULT '',
    idea TEXT NOT NULL DEFAULT '',
    pitch TEXT NOT NULL DEFAULT '',
    audience TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    read_at REAL,
    archived_at REAL
);
CREATE INDEX IF NOT EXISTS vortex_messages_at ON vortex_messages (at);
-- The app catalog (catalog.py): every app MTRX Horizyn makes, and whether it
-- is released to the public. Only released apps are shown on the site. The
-- owner adds and changes them in the console. Nothing about any visitor.
CREATE TABLE IF NOT EXISTS apps (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    line TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    accent TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_development',
    -- The last time it was released. Never cleared, so an app that has ever
    -- been public cannot be deleted.
    released_at REAL,
    created_at REAL NOT NULL
);
-- The Numbers section (numbers.py): each app's daily totals of what people
-- do, as the app's stats address sends them (numbers only, never who), and
-- each month's totals added up from them, so this month can be set against
-- last month after last month has left the app's 30 days. Days are kept 100
-- days, months a little over three years.
CREATE TABLE IF NOT EXISTS usage_days (
    app TEXT NOT NULL,
    day TEXT NOT NULL,
    metric TEXT NOT NULL,
    n INTEGER NOT NULL,
    PRIMARY KEY (app, day, metric)
);
CREATE TABLE IF NOT EXISTS usage_months (
    app TEXT NOT NULL,
    month TEXT NOT NULL,
    metric TEXT NOT NULL,
    total INTEGER NOT NULL,
    -- How many days of the month the total is made of.
    days_counted INTEGER NOT NULL,
    at REAL NOT NULL,
    PRIMARY KEY (app, month, metric)
);
-- Genesis Pro (genesis_pro.py), the paid upgrade. Who is Pro is decided only
-- by Stripe's signed webhook. A member is a Stripe subscription: its ids, its
-- state, its price and when it renews or ends. No name, no card, and no email
-- address: only a SHA-256 fingerprint of the buyer's email, so a new key can
-- be sent to the same address, and of the checkout's id, so the page Stripe
-- sends the buyer back to can show their first key once.
CREATE TABLE IF NOT EXISTS genesis_pro_members (
    id TEXT PRIMARY KEY,
    customer TEXT NOT NULL DEFAULT '',
    subscription TEXT NOT NULL UNIQUE,
    email_hash TEXT NOT NULL DEFAULT '',
    checkout_hash TEXT NOT NULL DEFAULT '',
    claimed_at REAL,
    status TEXT NOT NULL,
    interval TEXT NOT NULL DEFAULT 'month',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'usd',
    renews_at REAL,
    ends_at REAL,
    event_at INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS genesis_pro_members_customer ON genesis_pro_members (customer);
CREATE INDEX IF NOT EXISTS genesis_pro_members_email ON genesis_pro_members (email_hash);
CREATE INDEX IF NOT EXISTS genesis_pro_members_checkout ON genesis_pro_members (checkout_hash);
-- Pro keys: only the SHA-256 of each, never the key. A member has a few.
CREATE TABLE IF NOT EXISTS genesis_pro_keys (
    key_hash TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    created_at REAL NOT NULL,
    last_used REAL
);
CREATE INDEX IF NOT EXISTS genesis_pro_keys_member ON genesis_pro_keys (member_id);
-- Stripe event ids already handled, so a retried event is applied once.
CREATE TABLE IF NOT EXISTS genesis_pro_events (
    id TEXT PRIMARY KEY,
    at REAL NOT NULL
);
-- Money in and out, for the console's numbers: each paid invoice and each
-- refund, in the currency's smallest unit. Kept about 13 months.
CREATE TABLE IF NOT EXISTS genesis_pro_payments (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    subscription TEXT NOT NULL DEFAULT '',
    customer TEXT NOT NULL DEFAULT '',
    cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    at REAL NOT NULL
);
-- Each Pro ask: which member and when, and what it cost, for the member's
-- daily asks and their 31-day AI allowance. Never the words. Kept 32 days.
CREATE TABLE IF NOT EXISTS genesis_pro_spend (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL,
    at REAL NOT NULL,
    usd REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS genesis_pro_spend_lookup ON genesis_pro_spend (member_id, at);
-- A Pro member's cloud backup of their Genesis projects: the last few copies,
-- private to them. Deleted on request, and 60 days after Pro ends.
CREATE TABLE IF NOT EXISTS genesis_pro_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL,
    at REAL NOT NULL,
    projects INTEGER NOT NULL,
    body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS genesis_pro_backups_member ON genesis_pro_backups (member_id, at);
-- Random keys this site makes for itself (growth.py): one that signs the
-- links in early access emails, and one a day that turns a visitor's address
-- into a mark that can't be turned back. A day's key is deleted two days on,
-- after which nobody can tell whose mark was whose.
CREATE TABLE IF NOT EXISTS site_keys (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    at REAL NOT NULL
);
-- The early access list (early_access.py): an email address and the apps it
-- wants news of. Nothing else about the person. `pending` holds apps waiting
-- for the person to press the link in their email, and `ref` the creator
-- code they came through until then (it is counted and cleared on confirming).
-- Never confirmed: deleted after 7 days. Unsubscribing deletes the row.
CREATE TABLE IF NOT EXISTS early_signups (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    apps TEXT NOT NULL DEFAULT '',
    pending TEXT NOT NULL DEFAULT '',
    ref TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    pending_at REAL,
    confirmed_at REAL
);
-- Launch emails the owner wrote, and who each one has gone to. A campaign's
-- id comes from its app, subject and words, so sending the same one again
-- only reaches people who haven't had it: each person gets it once.
CREATE TABLE IF NOT EXISTS early_campaigns (
    id TEXT PRIMARY KEY,
    app TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    base TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS early_sends (
    campaign_id TEXT NOT NULL,
    signup_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    at REAL NOT NULL,
    PRIMARY KEY (campaign_id, signup_id)
);
CREATE INDEX IF NOT EXISTS early_sends_state ON early_sends (state, at);
-- The creator program (creators.py): what a creator sent with their
-- application, and once approved, their short link's code. Only the SHA-256
-- of each private dashboard key is kept.
CREATE TABLE IF NOT EXISTS creators (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    name TEXT NOT NULL,
    channel TEXT NOT NULL,
    audience TEXT NOT NULL,
    email TEXT NOT NULL,
    app TEXT NOT NULL DEFAULT '',
    code TEXT UNIQUE,
    created_at REAL NOT NULL,
    approved_at REAL
);
CREATE TABLE IF NOT EXISTS creator_keys (
    key_hash TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL,
    created_at REAL NOT NULL,
    last_used REAL
);
-- Each creator's clicks and confirmed sign-ups, as counts per day. Never who.
CREATE TABLE IF NOT EXISTS creator_days (
    creator_id TEXT NOT NULL,
    day TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    signups INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (creator_id, day)
);
-- Which marks (a keyed hash of the address and the link, with that day's
-- key) have clicked today, so a visitor counts once a day. Kept two days.
CREATE TABLE IF NOT EXISTS creator_seen (
    day TEXT NOT NULL,
    mark TEXT NOT NULL,
    PRIMARY KEY (day, mark)
);
-- What each creator has earned and been paid, as the owner writes it down.
-- Nothing here moves any money.
CREATE TABLE IF NOT EXISTS creator_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id TEXT NOT NULL,
    at REAL NOT NULL,
    kind TEXT NOT NULL,
    cents INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS creator_ledger_creator ON creator_ledger (creator_id, at);
-- One-off jobs that have been done, such as filling the app catalog the
-- first time, so they are never done again.
CREATE TABLE IF NOT EXISTS done_once (
    job TEXT PRIMARY KEY,
    at REAL NOT NULL
);
"""


@contextmanager
def connect():
    path = config.get().db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init():
    from . import catalog  # it uses this module, so it is imported here

    with connect() as conn:
        conn.executescript(SCHEMA)
        catalog.seed(conn)


def log(event: str, detail: str = ""):
    """Write one line to the console's activity list."""
    with connect() as conn:
        conn.execute(
            "INSERT INTO activity (at, event, detail) VALUES (?, ?, ?)",
            (time.time(), event, detail[:200]),
        )
        # Keep the list from growing forever.
        conn.execute(
            "DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - 2000"
        )
