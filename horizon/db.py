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
    with connect() as conn:
        conn.executescript(SCHEMA)


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
