"""The app catalog: every app MTRX Horizyn makes, kept in the `apps` table.

The owner adds and changes apps in the console. An app is either in
development (private: shown nowhere on the public site) or released to the
public. The moment one is released it is listed in Chroma Vortex's "Our
apps", and can be chosen in the Partner and Buy forms; the server accepts
exactly the released apps' keys there.

The three founding apps are put in the table the first time the site starts,
once only (the `done_once` table remembers it), as released. Their
`RANKUP_URL`-style settings still work: when one is set, it is the address
used for that app, whatever the table says.
"""

import re
import time
import unicodedata

from . import config, db

# The three apps the company started with, in the order the site shows them.
FOUNDING = (
    ("rankup", "RankUp", "A chores game for families: jobs done become points, levels and games.", "green"),
    ("cyberlogix", "CyberLogix AI", "Equipment monitoring for businesses: sensors, alerts and a sealed record.", "blue"),
    ("omniarmor", "OmniArmor.ai", "Compliance for businesses: the checks that apply, deadlines counted, records kept.", "violet"),
)
SEED_JOB = "seed apps"

# The colours an app can take. Each one is a class in the stylesheets.
ACCENTS = ("green", "blue", "violet", "cyan", "magenta", "amber")
STATUSES = {"in_development": "In development", "released": "Released to the public"}

LIMITS = {"key": 24, "name": 40, "line": 140, "url": 300}
LABELS = {"key": "the short name for links", "name": "the app's name", "line": "the one line about it",
          "url": "the public address"}
# Lower-case letters, digits and dashes, starting and ending with a letter or
# digit. The key is used in the page's classes and in stored messages, so it
# can't be changed after the app is added.
_KEY = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?")
# Keys that mean something else on the site.
RESERVED = {"company", "all", "none", "new", "apps", "partner", "pitch", "invest", "buy", "website"}


class Refused(ValueError):
    """Something the owner typed can't be used. The message says why."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field


# ---------------------------------------------------------------- the first run

def seed(conn):
    """Put the founding apps in the table, the first time only. Run by
    db.init with its connection, so the job and the apps are one change."""
    now = time.time()
    first = conn.execute("INSERT OR IGNORE INTO done_once (job, at) VALUES (?, ?)", (SEED_JOB, now)).rowcount
    if not first:
        return
    for i, (key, name, line, accent) in enumerate(FOUNDING):
        conn.execute(
            "INSERT OR IGNORE INTO apps (key, name, line, url, accent, status, released_at, created_at) "
            "VALUES (?, ?, ?, '', ?, 'released', ?, ?)", (key, name, line, accent, now, now + i / 1000))


# ---------------------------------------------------------------- reading

def _icon(key: str) -> str:
    # Only the founding apps have pictures; a new app gets its first letter.
    return f"/static/img/{key}-icon.svg" if key in config.APP_KEYS else ""


def _row(r, settings) -> dict:
    from_setting = settings.app_urls.get(r["key"], "")
    return {
        "key": r["key"], "name": r["name"], "line": r["line"],
        "url": from_setting or r["url"], "own_url": r["url"], "url_from_setting": bool(from_setting),
        "accent": r["accent"] if r["accent"] in ACCENTS else ACCENTS[0],
        "status": r["status"], "status_name": STATUSES.get(r["status"], r["status"]),
        "released": r["status"] == "released", "released_at": r["released_at"],
        "deletable": r["released_at"] is None, "icon": _icon(r["key"]),
        "letter": r["name"][:1].upper(), "founding": r["key"] in config.APP_KEYS,
    }


def everything() -> list:
    """Every app, released or not, oldest first. For the console."""
    settings = config.get()
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM apps ORDER BY created_at, key").fetchall()
    return [_row(r, settings) for r in rows]


def released() -> list:
    """The apps the public may see, oldest first."""
    return [a for a in everything() if a["released"]]


def released_keys() -> list:
    return [a["key"] for a in released()]


def names() -> dict:
    """Every app's name by its key, released or not: a message about an app
    later taken back into development still says which app it was about."""
    with db.connect() as conn:
        return {r["key"]: r["name"] for r in conn.execute("SELECT key, name FROM apps")}


def public(app: dict) -> dict:
    """What a page may show about a released app."""
    return {k: app[k] for k in ("key", "name", "line", "url", "accent", "icon", "letter")}


def get(key: str) -> dict | None:
    return next((a for a in everything() if a["key"] == key), None)


# ---------------------------------------------------------------- checking

def _text(value, field: str) -> str:
    """One line of plain text: control characters out, spaces tidied."""
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise Refused(f"Please type {LABELS[field]} as text.", field)
    value = unicodedata.normalize("NFC", value)
    value = "".join(" " if unicodedata.category(c) in ("Cc", "Cf", "Zl", "Zp") else c for c in value)
    value = " ".join(value.split())
    if len(value) > LIMITS[field]:
        raise Refused(f"Please keep {LABELS[field]} to {LIMITS[field]} characters.", field)
    return value


def _fields(body: dict) -> dict:
    """The name, line, address and colour from a form, checked."""
    name = _text(body.get("name"), "name")
    if not name:
        raise Refused("Please give the app a name.", "name")
    line = _text(body.get("line"), "line")
    if not line:
        raise Refused("Please write one line about what the app does.", "line")
    for field, value in (("name", name), ("line", line)):
        if "://" in value or "<" in value or ">" in value:
            raise Refused(f"Please leave links and angle brackets out of {LABELS[field]}.", field)
    url = _text(body.get("url"), "url")
    # The same rule as the RANKUP_URL-style settings (config._web_address):
    # a whole http or https address, or nothing. No spaces inside it.
    if url and (" " in url or not config._web_address(url)):
        raise Refused("The address needs to be a whole web address, starting with https://.", "url")
    accent = body.get("accent")
    if not isinstance(accent, str) or accent not in ACCENTS:
        raise Refused("Choose one of the colours.", "accent")
    return {"name": name, "line": line, "url": url, "accent": accent}


def _same_name(conn, name: str, but: str = "") -> bool:
    return conn.execute("SELECT 1 FROM apps WHERE lower(name) = lower(?) AND key != ?",
                        (name, but)).fetchone() is not None


# ---------------------------------------------------------------- changing

def add(body: dict) -> dict:
    """A new app, in development until the owner releases it."""
    key = body.get("key")
    if not isinstance(key, str) or not key.strip():
        raise Refused("Please give the app a short name for links, such as nova-notes.", "key")
    key = key.strip().lower()
    if len(key) > LIMITS["key"] or not _KEY.fullmatch(key):
        raise Refused("The short name may use only a to z, 0 to 9 and dashes, up to 24 characters, "
                      "and can't start or end with a dash.", "key")
    if key in RESERVED:
        raise Refused("That short name is used for something else on the site. Please pick another.", "key")
    fields = _fields(body)
    now = time.time()
    with db.connect() as conn:
        if conn.execute("SELECT 1 FROM apps WHERE key = ?", (key,)).fetchone():
            raise Refused("There's already an app with that short name.", "key")
        if _same_name(conn, fields["name"]):
            raise Refused("There's already an app with that name.", "name")
        conn.execute(
            "INSERT INTO apps (key, name, line, url, accent, status, released_at, created_at) "
            "VALUES (?, ?, ?, ?, ?, 'in_development', NULL, ?)",
            (key, fields["name"], fields["line"], fields["url"], fields["accent"], now))
    db.log("App added", f"{fields['name']} (in development)")
    return get(key)


def edit(key: str, body: dict) -> dict | None:
    """Change an app's name, line, address or colour. None if there is no
    such app. The key never changes."""
    fields = _fields(body)
    with db.connect() as conn:
        if _same_name(conn, fields["name"], but=key):
            raise Refused("There's already an app with that name.", "name")
        changed = conn.execute("UPDATE apps SET name = ?, line = ?, url = ?, accent = ? WHERE key = ?",
                               (fields["name"], fields["line"], fields["url"], fields["accent"], key)).rowcount
    if not changed:
        return None
    db.log("App edited", fields["name"])
    return get(key)


def release(key: str) -> dict | None:
    """Release an app to the public. From now it shows on Chroma Vortex."""
    with db.connect() as conn:
        changed = conn.execute("UPDATE apps SET status = 'released', released_at = ? WHERE key = ?",
                               (time.time(), key)).rowcount
    app = get(key) if changed else None
    if app:
        db.log("App released", f"{app['name']} is now public")
    return app


def unrelease(key: str) -> dict | None:
    """Take an app back into development. It leaves the public site at once;
    released_at is kept, so it still can't be deleted."""
    with db.connect() as conn:
        changed = conn.execute("UPDATE apps SET status = 'in_development' WHERE key = ?", (key,)).rowcount
    app = get(key) if changed else None
    if app:
        db.log("App back in development", f"{app['name']} is no longer public")
    return app


def delete(key: str) -> str:
    """Delete an app that was never released. Returns "deleted", "missing",
    or "released" for one that has been public (refused)."""
    app = get(key)
    if app is None:
        return "missing"
    if not app["deletable"]:
        return "released"
    with db.connect() as conn:
        gone = conn.execute("DELETE FROM apps WHERE key = ? AND released_at IS NULL", (key,)).rowcount
    if not gone:
        return "released"
    db.log("App deleted", app["name"])
    return "deleted"


# ---------------------------------------------------------------- the home page

def for_home() -> dict:
    """What the home page shows from the catalog.

    The three founding apps keep their own designed cards (and the owner's
    secret knock taps their icons), so they are always there; one that is
    in development shows "soon" instead of its Open button. Any other app
    joins the About list and the project list once it is released.
    """
    apps = everything()
    urls = {key: "" for key in config.APP_KEYS}
    for a in apps:
        if a["founding"] and a["released"]:
            urls[a["key"]] = a["url"]
    extra = [public(a) for a in apps if a["released"] and not a["founding"]]
    return {"urls": urls, "extra": extra, "count": len(config.APP_KEYS) + len(extra)}
