"""The lock on the owner's console.

There are three layers, and all of them are checked here on the server.
Nothing in the web page decides who gets in.

1. Approved devices. Each approved phone or laptop holds a private key that
   the browser made and will not hand out, not even to the page's own code.
   The server only keeps the matching public key. To get in, the device
   signs a fresh random challenge, which proves it is that device.
2. New devices are approved from a device that is already signed in, by
   scanning a QR code. The very first device uses a one-time setup code
   from the hosting settings, which is also the way back in if every
   device is lost.
3. The secret knock. The console has no link anywhere. Tapping things on
   the home page in a secret order opens the door for a few minutes. The
   order is kept on the server, never in the page.

A visitor who fails any layer sees the same "page not found" as for any
other address, so there is nothing to tell them the console exists.
"""

import base64
import hashlib
import hmac
import secrets
import sqlite3
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from . import config, db

INVITE_MINUTES = 10
CHALLENGE_SECONDS = 60

# How many tries are allowed before a caller has to wait.
LIMITS = {
    "knock": (8, 15 * 60),     # 8 wrong knocks per 15 minutes
    "enroll": (10, 60 * 60),   # 10 approval attempts per hour
    "unlock": (20, 15 * 60),
}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


# ---------------------------------------------------------------- rate limits

def allowed(kind: str, who: str) -> bool:
    """True if this caller still has tries left. Does not use one up."""
    limit, window = LIMITS[kind]
    with db.connect() as conn:
        conn.execute("DELETE FROM attempts WHERE at < ?", (time.time() - 24 * 3600,))
        (count,) = conn.execute(
            "SELECT COUNT(*) FROM attempts WHERE kind = ? AND who = ? AND at > ?",
            (kind, who, time.time() - window),
        ).fetchone()
    return count < limit


def record_failure(kind: str, who: str):
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO attempts (kind, who, at) VALUES (?, ?, ?)", (kind, who, time.time())
        )


# ---------------------------------------------------------------- the knock

def knock_matches(taps: list) -> bool:
    """Whether these taps are the secret knock, tap by tap.

    Each tap has to be exactly one of the names on the page. Joining whatever
    arrived with spaces and comparing the string used to accept a single "tap"
    that held the whole order, which also slipped past the counting of wrong
    tries.
    """
    secret = config.get().knock
    if (not secret or not isinstance(taps, list) or not 4 <= len(taps) <= 40
            or not all(isinstance(t, str) and t in config.KNOCK_TARGETS for t in taps)):
        return False
    return hmac.compare_digest(" ".join(taps).encode(), " ".join(secret).encode())


def open_door() -> str:
    """Make a short-lived token that says the knock was right."""
    token = new_token()
    minutes = config.get().knock_minutes
    with db.connect() as conn:
        conn.execute("DELETE FROM knocks WHERE expires_at < ?", (time.time(),))
        conn.execute(
            "INSERT INTO knocks (token_hash, expires_at) VALUES (?, ?)",
            (_hash(token), time.time() + minutes * 60),
        )
    return token


def door_open(token: str | None) -> bool:
    if not token:
        return False
    with db.connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM knocks WHERE token_hash = ? AND expires_at > ?",
            (_hash(token), time.time()),
        ).fetchone()
    return row is not None


def close_door(token: str | None):
    if token:
        with db.connect() as conn:
            conn.execute("DELETE FROM knocks WHERE token_hash = ?", (_hash(token),))


# ---------------------------------------------------------------- device keys

def load_public_key(raw: bytes):
    """Accept only a P-256 public key, which is what the browser makes."""
    key = serialization.load_der_public_key(raw)
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("not a P-256 key")
    return key


def signature_ok(public_key: bytes, message: str, signature_b64: str) -> bool:
    """Check a browser signature. Browsers give the two halves (r and s)
    side by side, 32 bytes each, so they are repacked before checking."""
    try:
        sig = base64.b64decode(signature_b64, validate=True)
        if len(sig) != 64:
            return False
        r = int.from_bytes(sig[:32], "big")
        s = int.from_bytes(sig[32:], "big")
        load_public_key(public_key).verify(
            encode_dss_signature(r, s), message.encode(), ec.ECDSA(hashes.SHA256())
        )
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def device(device_id: str | None):
    """The approved device with this id, or None."""
    if not device_id:
        return None
    with db.connect() as conn:
        return conn.execute(
            "SELECT * FROM devices WHERE id = ? AND removed_at IS NULL", (device_id,)
        ).fetchone()


def list_devices():
    with db.connect() as conn:
        return conn.execute(
            "SELECT id, name, created_at, last_seen FROM devices"
            " WHERE removed_at IS NULL ORDER BY created_at"
        ).fetchall()


def remove_device(device_id: str) -> bool:
    with db.connect() as conn:
        changed = conn.execute(
            "UPDATE devices SET removed_at = ? WHERE id = ? AND removed_at IS NULL",
            (time.time(), device_id),
        ).rowcount
        conn.execute("DELETE FROM sessions WHERE device_id = ?", (device_id,))
    return bool(changed)


# ---------------------------------------------------------------- approving devices

def make_invite(created_by: str) -> str:
    token = new_token()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO invites (token_hash, created_by, expires_at) VALUES (?, ?, ?)",
            (_hash(token), created_by, time.time() + INVITE_MINUTES * 60),
        )
    return token


def token_usable(token: str) -> bool:
    """True if this invite or setup code could still approve a device.
    Only looks; does not use it up."""
    if not token:
        return False
    setup = config.get().setup_token
    with db.connect() as conn:
        if len(setup) >= 16 and hmac.compare_digest(token.encode(), setup.encode()):
            used = conn.execute(
                "SELECT 1 FROM used_setup_tokens WHERE token_hash = ?", (_hash(token),)
            ).fetchone()
            return used is None
        row = conn.execute(
            "SELECT 1 FROM invites i JOIN devices d ON d.id = i.created_by"
            " WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > ?"
            " AND d.removed_at IS NULL",
            (_hash(token), time.time()),
        ).fetchone()
    return row is not None


def _claim_setup_token(conn, token: str) -> bool:
    setup = config.get().setup_token
    if len(setup) < 16 or not hmac.compare_digest(token.encode(), setup.encode()):
        return False
    try:
        conn.execute(
            "INSERT INTO used_setup_tokens (token_hash, used_at) VALUES (?, ?)",
            (_hash(token), time.time()),
        )
    except sqlite3.IntegrityError:  # already used once
        return False
    return True


def _claim_invite(conn, token: str) -> str | None:
    """Use up an invite. Returns the id of the device that made it."""
    row = conn.execute(
        "SELECT created_by FROM invites WHERE token_hash = ? AND used_at IS NULL"
        " AND expires_at > ?",
        (_hash(token), time.time()),
    ).fetchone()
    if row is None:
        return None
    # The device that made the invite must still be approved.
    maker = conn.execute(
        "SELECT 1 FROM devices WHERE id = ? AND removed_at IS NULL", (row["created_by"],)
    ).fetchone()
    if maker is None:
        return None
    used = conn.execute(
        "UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL",
        (time.time(), _hash(token)),
    ).rowcount
    return row["created_by"] if used else None


def enroll(token: str, name: str, public_key_b64: str, signature_b64: str) -> str | None:
    """Approve a new device. Returns its id, or None if anything is wrong.

    The device must sign the invite or setup code with its new key, which
    proves it really holds that key.
    """
    try:
        public_key = base64.b64decode(public_key_b64, validate=True)
        load_public_key(public_key)
    except Exception:
        return None
    if not token or not signature_ok(public_key, "mtrx-enroll:" + token, signature_b64):
        return None
    name = " ".join(str(name).split())[:60] or "Unnamed device"
    device_id = new_token()
    with db.connect() as conn:
        via = "setup code" if _claim_setup_token(conn, token) else None
        if via is None:
            maker = _claim_invite(conn, token)
            if maker is None:
                return None
            via = "QR approval"
        conn.execute(
            "INSERT INTO devices (id, name, public_key, created_at) VALUES (?, ?, ?, ?)",
            (device_id, name, public_key, time.time()),
        )
    db.log("Device approved", f"{name} (by {via})")
    return device_id


# ---------------------------------------------------------------- unlocking

def make_challenge(device_id: str) -> str:
    challenge = new_token()
    with db.connect() as conn:
        conn.execute("DELETE FROM challenges WHERE expires_at < ?", (time.time(),))
        conn.execute(
            "INSERT INTO challenges (challenge, device_id, expires_at) VALUES (?, ?, ?)",
            (challenge, device_id, time.time() + CHALLENGE_SECONDS),
        )
    return challenge


def unlock(device_id: str, challenge: str, signature_b64: str) -> str | None:
    """Check the signed challenge and start a session. Returns the session token."""
    dev = device(device_id)
    if dev is None or not challenge:
        return None
    with db.connect() as conn:
        # Each challenge works once, and only for the device it was made for.
        used = conn.execute(
            "DELETE FROM challenges WHERE challenge = ? AND device_id = ? AND expires_at > ?",
            (challenge, device_id, time.time()),
        ).rowcount
    if not used or not signature_ok(dev["public_key"], "mtrx-unlock:" + challenge, signature_b64):
        return None
    token = new_token()
    hours = config.get().session_hours
    with db.connect() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
        conn.execute(
            "INSERT INTO sessions (token_hash, device_id, created_at, expires_at)"
            " VALUES (?, ?, ?, ?)",
            (_hash(token), device_id, time.time(), time.time() + hours * 3600),
        )
        conn.execute("UPDATE devices SET last_seen = ? WHERE id = ?", (time.time(), device_id))
    db.log("Signed in", dev["name"])
    return token


def session_device(token: str | None, device_id: str | None):
    """The device behind a live session, or None.

    The session only counts on the device it was made on, and only while
    that device is still approved.
    """
    if not token or not device_id:
        return None
    with db.connect() as conn:
        row = conn.execute(
            "SELECT device_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
            (_hash(token), time.time()),
        ).fetchone()
    if row is None or not hmac.compare_digest(row["device_id"], device_id):
        return None
    return device(device_id)


def end_session(token: str | None):
    if token:
        with db.connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash(token),))
