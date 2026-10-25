"""Settings, read from environment variables.

Settings are read every time they are asked for, so tests can change them.
Nothing secret is ever sent to the browser.
"""

import os
from dataclasses import dataclass
from pathlib import Path

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


def get() -> Settings:
    env = os.environ
    return Settings(
        db_path=Path(env.get("MTRX_DB_PATH", str(ROOT / "data" / "horizon.db"))),
        knock=parse_knock(env.get("MTRX_KNOCK", "")),
        setup_token=env.get("MTRX_SETUP_TOKEN", "").strip(),
        dev=env.get("MTRX_DEV", "") == "1",
        trust_proxy=env.get("MTRX_TRUST_PROXY", "") == "1",
        stats_key=env.get("MTRX_STATS_KEY", "").strip(),
        app_urls={k: env.get(f"{k.upper()}_URL", "").strip() for k in APP_KEYS},
        stats_urls={k: env.get(f"{k.upper()}_STATS_URL", "").strip() for k in APP_KEYS},
        session_hours=int(env.get("MTRX_SESSION_HOURS", "12")),
        knock_minutes=int(env.get("MTRX_KNOCK_MINUTES", "5")),
        public_url=env.get("MTRX_PUBLIC_URL", "").strip().rstrip("/"),
    )
