"""The organisation's settings, set once by IT and pushed to every computer.

Omnicyte reads, in order, and later files win field by field:
1. the organisation's policy file, deployed by IT (MDM, Intune, Group Policy, Jamf):
   - Windows: %PROGRAMDATA%\\Omnicyte\\policy.json
   - macOS:   /Library/Application Support/Omnicyte/policy.json
   - Linux:   /etc/omnicyte/policy.json
   or wherever OMNICYTE_POLICY points;
2. the person's own settings file (~/.omnicyte/settings.json), which may only
   add trusted domains, pause, or turn the clipboard watch off, and only if
   the policy allows people to change those.

Example policy.json:
{
  "org_name": "Acme Ltd",
  "org_domains": ["acme.com", "acme.co.uk"],
  "trusted_domains": ["acme.sharepoint.com", "acmepayroll.com"],
  "report_to": "security@acme.com",
  "event_log": "",
  "clipboard_watch": true,
  "allow_user_trust": true,
  "mailboxes": [{"host": "outlook.office365.com", "user": "me@acme.com", "password_env": "OMNICYTE_IMAP_PASSWORD"}]
}
"""

import json
import os
import platform
import secrets
from dataclasses import dataclass, field
from pathlib import Path

# The product's own web address. The domain is bought but not written here
# yet; this one setting is the only place to change it.
WEBSITE = os.environ.get("OMNICYTE_WEBSITE", "https://omnicyte.example")
PORT = 47321


def home() -> Path:
    return Path(os.environ.get("OMNICYTE_HOME") or Path.home() / ".omnicyte")


def org_policy_path() -> Path:
    if os.environ.get("OMNICYTE_POLICY"):
        return Path(os.environ["OMNICYTE_POLICY"])
    system = platform.system()
    if system == "Windows":
        return Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "Omnicyte" / "policy.json"
    if system == "Darwin":
        return Path("/Library/Application Support/Omnicyte/policy.json")
    return Path("/etc/omnicyte/policy.json")


@dataclass
class Policy:
    org_name: str = ""
    org_domains: list = field(default_factory=list)
    trusted_domains: list = field(default_factory=list)
    report_to: str = ""
    event_log: str = ""          # where to write the event log; empty means ~/.omnicyte/events.jsonl
    clipboard_watch: bool = True
    allow_user_trust: bool = True
    mailboxes: list = field(default_factory=list)
    alert_on: str = "danger"     # "danger", or "caution" to also pop up for the weaker warnings
    paused_until: float = 0.0

    @property
    def events_path(self) -> Path:
        return Path(self.event_log) if self.event_log else home() / "events.jsonl"


def _read(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _domains(values) -> list:
    out = []
    for v in values or ():
        if isinstance(v, str):
            v = v.strip().lower().lstrip("*.").rstrip(".")
            if v.startswith(("http://", "https://")):
                v = v.split("//", 1)[1].split("/", 1)[0]
            if v and "." in v and v not in out:
                out.append(v)
    return out


def load() -> Policy:
    org = _read(org_policy_path())
    mine = _read(home() / "settings.json")
    p = Policy(
        org_name=str(org.get("org_name", "")),
        org_domains=_domains(org.get("org_domains")),
        trusted_domains=_domains(org.get("trusted_domains")),
        report_to=str(org.get("report_to", "")),
        event_log=str(org.get("event_log", "")),
        clipboard_watch=bool(org.get("clipboard_watch", True)),
        allow_user_trust=bool(org.get("allow_user_trust", True)),
        mailboxes=[m for m in org.get("mailboxes", []) if isinstance(m, dict)],
        alert_on="caution" if org.get("alert_on") == "caution" else "danger",
    )
    if p.allow_user_trust:
        p.trusted_domains += [d for d in _domains(mine.get("trusted_domains")) if d not in p.trusted_domains]
    if "clipboard_watch" in mine and not mine["clipboard_watch"]:
        p.clipboard_watch = False   # a person may turn it off, never on against the policy
    p.mailboxes += [m for m in mine.get("mailboxes", []) if isinstance(m, dict)]
    p.paused_until = float(mine.get("paused_until", 0) or 0)
    return p


def save_user(**changes) -> None:
    """Change the person's own settings file (trusted domains, pause, clipboard)."""
    path = home() / "settings.json"
    data = _read(path)
    data.update(changes)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def trust_domain(domain: str) -> bool:
    p = load()
    if not p.allow_user_trust:
        return False
    current = _domains(_read(home() / "settings.json").get("trusted_domains"))
    for d in _domains([domain]):
        if d not in current:
            current.append(d)
    save_user(trusted_domains=current)
    return True


def token() -> str:
    """The pairing code the browser extension needs to ask this computer's Omnicyte.

    Made once and kept in a file only this user can read, so a web page can't
    talk to Omnicyte on its own.
    """
    path = home() / "token"
    try:
        value = path.read_text().strip()
        if len(value) >= 24:
            return value
    except OSError:
        pass
    value = secrets.token_urlsafe(24)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return value
