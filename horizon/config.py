"""Settings, read from environment variables.

Settings are read every time they are asked for, so tests can change them.
Nothing secret is ever sent to the browser.
"""

import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent

# The three apps, in the order the site shows them. Each one can be given a
# public web address (shown as "Open app") and a stats address (read by the
# console). Neither is required.
APP_KEYS = ("rankup", "cyberlogix", "omniarmor")

# Names the secret knock can use. Each one is something on the home page
# that can be tapped without going anywhere.
KNOCK_TARGETS = ("logo", "rankup", "cyberlogix", "omniarmor", "mark")


@dataclass(frozen=True)
class Settings:
    db_path: Path
    knock: tuple[str, ...]
    setup_token: str
    dev: bool
    trust_proxy: bool
    stats_key: str
    app_urls: dict
    stats_urls: dict
    session_hours: int
    knock_minutes: int
    public_url: str
    contact_email: str
    health_urls: dict
    admin_urls: dict
    alert_minutes: int
    alert_email: str
    alert_from: str
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str


def parse_knock(raw: str) -> tuple[str, ...]:
    """Turn "logo logo rankup" or "logo,logo,rankup" into a tuple.

    A knock with a name that isn't on the page, or shorter than 4 taps, is
    treated as not set: a typo would otherwise lock the owner out without
    saying why, and a short knock is easy to hit by accident or guess.
    """
    taps = tuple(raw.replace(",", " ").lower().split())
    if len(taps) < 4 or any(t not in KNOCK_TARGETS for t in taps):
        return ()
    return taps


def _whole_number(raw: str | None, default: int) -> int:
    """A setting that should be a whole number above 0.

    Every request reads the settings, so int() on a typo such as "12h"
    crashed every page, the public home page included.
    """
    try:
        value = int((raw or "").strip())
    except ValueError:
        return default
    return value if value > 0 else default


def _web_address(raw: str | None) -> str:
    """An app's public address, or "" if it isn't a whole web address.

    The home page shows an "Open" button for each app with an address. One
    typed without its https:// ("rankup.example") became a link to a page
    on this site that does not exist.
    """
    value = (raw or "").strip()
    try:
        parts = urlsplit(value)
    except ValueError:
        return ""
    return value if parts.scheme in ("http", "https") and parts.netloc else ""


# A plain address: letters, digits and . _ + - only, one @, and a dot in the
# part after it. Nothing that means something in a mailto: link ("?" starts
# extra headers, such as a hidden copy to someone else).
_EMAIL = re.compile(r"[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+")


def _email(raw: str | None) -> str:
    """An email address, or "" if the setting is not one."""
    value = (raw or "").strip()
    return value if len(value) <= 254 and _EMAIL.fullmatch(value) else ""


# Where each app's own admin page is, from its public address, when no
# {APP}_ADMIN_URL is set. OmniArmor has no separate admin page: its owner
# signs in to the app itself.
ADMIN_PATHS = {"rankup": "/#/operator", "cyberlogix": "/console", "omniarmor": "/"}


def _admin_urls(env, app_urls: dict) -> dict:
    urls = {}
    for key in APP_KEYS:
        own = _web_address(env.get(f"{key.upper()}_ADMIN_URL"))
        base = app_urls.get(key, "")
        urls[key] = own or (base.rstrip("/") + ADMIN_PATHS[key] if base else "")
    return urls


def get() -> Settings:
    env = os.environ
    app_urls = {k: _web_address(env.get(f"{k.upper()}_URL")) for k in APP_KEYS}
    return Settings(
        db_path=Path(env.get("MTRX_DB_PATH", str(ROOT / "data" / "horizon.db"))),
        knock=parse_knock(env.get("MTRX_KNOCK", "")),
        setup_token=env.get("MTRX_SETUP_TOKEN", "").strip(),
        dev=env.get("MTRX_DEV", "") == "1",
        trust_proxy=env.get("MTRX_TRUST_PROXY", "") == "1",
        stats_key=env.get("MTRX_STATS_KEY", "").strip(),
        app_urls=app_urls,
        stats_urls={k: env.get(f"{k.upper()}_STATS_URL", "").strip() for k in APP_KEYS},
        session_hours=_whole_number(env.get("MTRX_SESSION_HOURS"), 12),
        knock_minutes=_whole_number(env.get("MTRX_KNOCK_MINUTES"), 5),
        public_url=env.get("MTRX_PUBLIC_URL", "").strip().rstrip("/"),
        contact_email=_email(env.get("MTRX_CONTACT_EMAIL")),
        # Each app's public "am I up?" address, asked once a minute.
        health_urls={k: _web_address(env.get(f"{k.upper()}_HEALTH_URL")) for k in APP_KEYS},
        admin_urls=_admin_urls(env, app_urls),
        # Down this long before the owner is told.
        alert_minutes=_whole_number(env.get("MTRX_ALERT_MINUTES"), 5),
        alert_email=_email(env.get("MTRX_ALERT_EMAIL")),
        alert_from=_email(env.get("MTRX_ALERT_FROM")) or _email(env.get("MTRX_SMTP_USER")),
        smtp_host=env.get("MTRX_SMTP_HOST", "").strip(),
        smtp_port=_whole_number(env.get("MTRX_SMTP_PORT"), 587),
        smtp_user=env.get("MTRX_SMTP_USER", "").strip(),
        smtp_password=env.get("MTRX_SMTP_PASSWORD", ""),
    )
