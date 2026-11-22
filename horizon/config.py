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

# The address the home page shows for questions while MTRX_CONTACT_EMAIL is
# not set. Only shown on the page: nothing is ever sent to it from here
# (emails to the owner still go only to MTRX_CONTACT_EMAIL or the alert
# address). The one email address written into the site.
HELP_EMAIL = "help@mtrxhorizyn.com"


def version() -> str:
    """The number in VERSION: which version of the site this is."""
    try:
        return (ROOT / "VERSION").read_text().strip() or "dev"
    except OSError:
        return "dev"


@dataclass(frozen=True)
class Settings:
    db_path: Path
    knock: tuple[str, ...]
    setup_token: str
    dev: bool
    trust_proxy: bool
    stats_key: str
    app_urls: dict
    demo_urls: dict
    open_apps: frozenset
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
    noindex: bool
    genesis_ai_key: str
    genesis_ai_model: str
    genesis_ai_effort: str
    genesis_ai_daily_cap_usd: float
    genesis_ai_per_hour: int
    genesis_ai_per_day: int
    genesis_ai_input_price: float
    genesis_ai_output_price: float
    vortex_per_hour: int
    vortex_per_day: int
    genesis_pro_enabled: bool
    stripe_secret_key: str
    genesis_pro_webhook_secret: str
    genesis_pro_price: str
    genesis_pro_yearly_price: str
    genesis_pro_price_text: str
    genesis_pro_per_hour: int
    genesis_pro_per_day: int
    genesis_pro_monthly_ai_usd: float
    genesis_pro_email_from: str
    early_access_enabled: bool
    founder_codes: dict
    founder_percent_off: int
    postal_address: str
    growth_email_from: str
    early_access_send_per_minute: int
    creators_enabled: bool
    creator_percent: int
    creator_months: int


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


def _money(raw: str | None, default: float) -> float:
    """A setting that should be a number of dollars, 0 or more."""
    try:
        value = float((raw or "").strip())
    except ValueError:
        return default
    return value if value >= 0 and value == value and value != float("inf") else default


# A Stripe price id, such as price_1Abc...: letters, digits and _ only, so
# nothing that could change the address it is sent to.
_PRICE_ID = re.compile(r"price_[A-Za-z0-9_]{1,200}")


def _price_id(raw: str | None) -> str:
    value = (raw or "").strip()
    return value if _PRICE_ID.fullmatch(value) else ""


# A monthly price as written on the page, such as $4.99 or 4,99 €: a currency
# sign or letters, digits, one separator. Anything else falls back to the default.
_PRICE_TEXT = re.compile(r"[^\W\d_]{0,3}[$€£¥]?\s?\d{1,4}(?:[.,]\d{2})?\s?[$€£¥]?[^\W\d_]{0,3}")


def _price_text(raw: str | None, default: str) -> str:
    value = " ".join((raw or "").split())
    return value if value and len(value) <= 16 and _PRICE_TEXT.fullmatch(value) else default


# A Stripe promotion code as a customer types it at checkout, such as
# FOUNDER20: letters, digits, - and _ only.
_PROMO_CODE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,39}")


def _promo_code(raw: str | None) -> str:
    value = (raw or "").strip()
    return value if _PROMO_CODE.fullmatch(value) else ""


def _percent(raw: str | None, default: int) -> int:
    """A whole percentage from 1 to 100, or `default` (0 means not set)."""
    try:
        value = int((raw or "").strip())
    except ValueError:
        return default
    return value if 1 <= value <= 100 else default


def _one_line(raw: str | None, limit: int = 300) -> str:
    """Plain text on one line: no control characters, spaces tidied."""
    text = "".join(" " if ord(c) < 32 or ord(c) == 127 else c for c in (raw or ""))
    return " ".join(text.split())[:limit]


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


def _open_apps(raw: str | None) -> frozenset:
    """MTRX_OPEN_APPS: "rankup, cyberlogix", or "all"; anything else is ignored."""
    keys = {k for k in re.split(r"[\s,]+", (raw or "").strip().lower()) if k}
    if "all" in keys:
        return frozenset({"*"})
    return frozenset(k for k in keys if re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?", k))


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
        # Each app's public demo with pretend data ({APP}_DEMO_URL), if it has
        # one: Learn more links to it and What's new says "In the demo".
        # Unset, nothing links to a demo (no made-up links).
        demo_urls={k: _web_address(env.get(f"{k.upper()}_DEMO_URL")) for k in APP_KEYS},
        # Which apps are open to the public (launched): their keys, or "all".
        # Until an app is named here the site says it is in development and
        # shows no Open button, even with its address set (catalog.py).
        open_apps=_open_apps(env.get("MTRX_OPEN_APPS")),
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
        # A copy that is not the live site (staging) asks to be left out of
        # search results: every answer says noindex, robots.txt closes the
        # site and the sitemap is empty (docs/STAGING.md). Never on live.
        noindex=env.get("MTRX_NOINDEX", "") == "1",
        # Ask Genesis (genesis_ai.py). Off until both the key and the model
        # are set. The model is a setting so that no model name is written
        # into this public code; it can change without a deploy.
        genesis_ai_key=env.get("GENESIS_AI_KEY", "").strip(),
        genesis_ai_model=env.get("GENESIS_AI_MODEL", "").strip(),
        genesis_ai_effort=env.get("GENESIS_AI_EFFORT", "low").strip().lower(),
        # What the AI may cost in a day, all visitors together. The prices
        # are per million tokens and only used for that estimate; they
        # default high, so the estimate errs on the safe side.
        genesis_ai_daily_cap_usd=_money(env.get("GENESIS_AI_DAILY_CAP_USD"), 2.0),
        genesis_ai_per_hour=_whole_number(env.get("GENESIS_AI_PER_HOUR"), 3),
        genesis_ai_per_day=_whole_number(env.get("GENESIS_AI_PER_DAY"), 5),
        genesis_ai_input_price=_money(env.get("GENESIS_AI_INPUT_PRICE"), 10.0),
        genesis_ai_output_price=_money(env.get("GENESIS_AI_OUTPUT_PRICE"), 50.0),
        # Orbyt (vortex.py): messages each address may send.
        vortex_per_hour=_whole_number(env.get("VORTEX_PER_HOUR"), 5),
        vortex_per_day=_whole_number(env.get("VORTEX_PER_DAY"), 20),
        # Genesis Pro (genesis_pro.py): a paid upgrade to Genesis. Off, and
        # nothing about it shown, until GENESIS_PRO_ENABLED=1 and the Stripe
        # settings are all set. Stripe holds the prices; the code knows
        # only their ids.
        genesis_pro_enabled=env.get("GENESIS_PRO_ENABLED", "") == "1",
        stripe_secret_key=env.get("STRIPE_SECRET_KEY", "").strip(),
        genesis_pro_webhook_secret=env.get("GENESIS_PRO_STRIPE_WEBHOOK_SECRET", "").strip(),
        genesis_pro_price=_price_id(env.get("GENESIS_PRO_STRIPE_PRICE")),
        genesis_pro_yearly_price=_price_id(env.get("GENESIS_PRO_YEARLY_STRIPE_PRICE")),
        # The monthly price as written on the page while Stripe's own figure
        # can't be read (Stripe slow or down): so a buyer always sees a price.
        genesis_pro_price_text=_price_text(env.get("GENESIS_PRO_PRICE_TEXT"), "$4.99"),
        # Asks each Pro member may make (counted by member, not address).
        genesis_pro_per_hour=_whole_number(env.get("GENESIS_PRO_PER_HOUR"), 30),
        genesis_pro_per_day=_whole_number(env.get("GENESIS_PRO_PER_DAY"), 100),
        # The most one member's AI help may cost in any 31 days: the cap
        # that keeps a maxed-out member well under the price after fees
        # (docs/GENESIS-PRO.md has the sums).
        genesis_pro_monthly_ai_usd=_money(env.get("GENESIS_PRO_MONTHLY_AI_USD"), 1.5),
        genesis_pro_email_from=_email(env.get("GENESIS_PRO_EMAIL_FROM")),
        # The early access list (early_access.py). Off, and nothing about it
        # shown, until EARLY_ACCESS_ENABLED=1. Each app's founder code is a
        # Stripe promotion code the owner makes in Stripe; the percent it
        # takes off is shown only for an app that has a code.
        early_access_enabled=env.get("EARLY_ACCESS_ENABLED", "") == "1",
        founder_codes={k: _promo_code(env.get(f"FOUNDER_CODE_{k.upper()}")) for k in APP_KEYS},
        founder_percent_off=_percent(env.get("FOUNDER_PERCENT_OFF"), 0),
        # The company's postal address, printed at the foot of every launch
        # email. Launch emails can't be sent until it is set.
        postal_address=_one_line(env.get("MTRX_POSTAL_ADDRESS")),
        # Where early access and creator emails come from, through the
        # MTRX_SMTP_* mail server (empty uses MTRX_ALERT_FROM).
        growth_email_from=_email(env.get("EARLY_ACCESS_EMAIL_FROM")),
        # Launch emails are sent one by one, at most this many a minute.
        early_access_send_per_minute=_whole_number(env.get("EARLY_ACCESS_SEND_PER_MINUTE"), 20),
        # The creator program (creators.py). Off until CREATORS_ENABLED=1.
        creators_enabled=env.get("CREATORS_ENABLED", "") == "1",
        creator_percent=_percent(env.get("CREATOR_PERCENT"), 20),
        creator_months=_whole_number(env.get("CREATOR_MONTHS"), 12),
    )
