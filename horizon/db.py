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
