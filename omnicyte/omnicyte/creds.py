"""Passwords and keys that have been pasted where they shouldn't be.

A secret in a chat or an email stays in its history for good. Omnicyte points
it out so it can be changed, and never repeats the secret in full: alerts and
the event log only ever show a masked form.
"""

import re

PATTERNS = (
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b")),
    ("Slack token", re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}\b")),
    ("Stripe secret key", re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("Anthropic API key", re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{20,}\b")),
    ("OpenAI API key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{32,}\b")),
    ("Private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----")),
    ("Access token (JWT)", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("Password", re.compile(r"(?i)\b(?:password|passwd|passcode|pw)\s*(?:is|=|:)\s*[\"']?([^\s\"'`]{6,})")),
)

# "password: reset" is a sentence, not a password.
_NOT_PASSWORDS = {"reset", "required", "expired", "expiring", "changed", "incorrect", "protected",
                  "manager", "policy", "please", "below", "attached", "hidden", "********"}


def _looks_like_password(value: str) -> bool:
    """A real password, not a word, a placeholder or code that reads one from
    somewhere ("os.environ['DB']", "$DB_PASS", "<your password>")."""
    v = value.strip(".,;")
    if v.lower() in _NOT_PASSWORDS or len(v) < 6:
        return False
    if v.startswith(("http", "{", "$", "%", "<", "[", "(", "/", "~", "*", "•", "process.", "os.", "env")):
        return False
    if any(c in v for c in "()[]") or re.search(r"(?i)getenv|environ|secret[s]?\.|vault|\{\{", v):
        return False
    classes = sum(bool(re.search(p, v)) for p in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]"))
    return classes >= 2 and not re.fullmatch(r"[A-Za-z]+[.!?]?", v)


def mask(secret: str) -> str:
    secret = secret.strip()
    if len(secret) <= 8:
        return "•" * len(secret)
    if len(secret) <= 16:
        return secret[:2] + "•" * (len(secret) - 2)
    return secret[:4] + "•" * min(12, len(secret) - 6) + secret[-2:]


def find(text: str) -> list[tuple[str, str]]:
    """Each secret found, as (what kind, masked), at most one per kind."""
    found, kinds = [], set()
    for kind, pattern in PATTERNS:
        if kind in kinds:
            continue
        for m in pattern.finditer(text or ""):
            value = m.group(1) if m.groups() else m.group(0)
            if kind == "Password" and not _looks_like_password(value):
                continue
            if kind == "OpenAI API key" and value.startswith("sk-ant-"):
                continue
            found.append((kind, "-----BEGIN … PRIVATE KEY-----" if kind == "Private key" else mask(value)))
            kinds.add(kind)
            break
    return found
