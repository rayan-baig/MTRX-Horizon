"""Looking at one link: where it really goes, and what about it looks wrong.

Email security gateways rewrite links (Outlook Safe Links, Proofpoint, Google's
redirect), so the first job is to unwrap those and judge the real destination.
"""

import ipaddress
import re
import unicodedata
from urllib.parse import parse_qs, unquote, urlsplit

from . import brands
from .signals import Signal

# Endings that take two labels, so "shop.example.co.uk" belongs to
# "example.co.uk". Not the full public suffix list, but the common business ones.
TWO_PART_SUFFIXES = {
    "co.uk", "org.uk", "ac.uk", "gov.uk", "ltd.uk", "plc.uk", "me.uk", "com.au", "net.au", "org.au", "gov.au",
    "co.nz", "org.nz", "co.jp", "ne.jp", "or.jp", "co.in", "net.in", "org.in", "com.br", "com.mx", "co.za",
    "com.sg", "com.cn", "com.hk", "com.tr", "com.tw", "co.kr", "com.my", "com.ar", "com.co", "co.id",
    "com.ph", "com.vn", "com.pk", "com.ng", "co.il", "com.sa", "com.eg", "co.th", "github.io",
}

# Letters attackers swap in because they look alike at a glance.
_HOMOGLYPHS = (("rn", "m"), ("vv", "w"), ("cl", "d"), ("0", "o"), ("1", "l"), ("3", "e"), ("4", "a"),
               ("5", "s"), ("7", "t"), ("8", "b"), ("9", "g"), ("$", "s"), ("@", "a"), ("|", "l"))
# Letters from other alphabets that look like Latin ones.
_CONFUSABLES = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
    "ԁ": "d", "ɡ": "g", "һ": "h", "ӏ": "l", "ո": "n", "ս": "u", "ν": "v", "ο": "o", "α": "a", "і": "i",
    "к": "k", "м": "m", "т": "t", "в": "b", "н": "h",
})

LOGIN_WORDS = ("login", "log-in", "signin", "sign-in", "logon", "verify", "verification", "validate",
               "password", "passwd", "credential", "account-update", "update-account", "secure-login",
               "authenticate", "auth", "sso", "unlock", "reactivate", "wp-login", "owa")
DOWNLOAD_EXTENSIONS = (".exe", ".scr", ".msi", ".bat", ".cmd", ".ps1", ".vbs", ".vbe", ".js", ".jse", ".hta",
                       ".jar", ".iso", ".img", ".lnk", ".apk", ".dmg", ".pkg", ".wsf", ".cpl", ".reg")

URL_IN_TEXT = re.compile(r"""(?i)\b(?:https?://|www\.)[^\s<>"'`)\]}]+""")
DOMAIN_LIKE = re.compile(r"(?i)^(?:https?://)?(?:www\.)?([a-z0-9\-]+(?:\.[a-z0-9\-]+)+)(?:[/:?#].*)?$")


# ---------------------------------------------------------------- parsing

def find_links(text: str) -> list[str]:
    """Every web address written out in plain text, in order, without repeats."""
    seen, out = set(), []
    for m in URL_IN_TEXT.finditer(text or ""):
        url = m.group(0).rstrip(".,;:!?'\"")
        if url.lower().startswith("www."):
            url = "http://" + url
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def host_of(url: str) -> str:
    try:
        host = urlsplit(url.strip()).hostname or ""
    except ValueError:
        return ""
    return host.rstrip(".").lower()


def decode_host(host: str) -> str:
    """The host as a person would see it: punycode (xn--) turned back into letters."""
    try:
        return host.encode("ascii").decode("idna") if "xn--" in host else host
    except UnicodeError:
        return host


def registrable(host: str) -> str:
    """The part of a host someone actually bought: "login.mail.example.co.uk" -> "example.co.uk"."""
    host = host.rstrip(".").lower()
    if not host or _is_ip(host):
        return host
    parts = host.split(".")
    if len(parts) >= 3 and ".".join(parts[-2:]) in TWO_PART_SUFFIXES:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def belongs_to(host: str, domains) -> bool:
    """True if host is one of the domains or below one of them."""
    host = host.lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in domains if d)


def unwrap(url: str, depth: int = 0) -> str:
    """The real destination behind a security gateway's rewritten link."""
    if depth > 4:
        return url
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    host = (parts.hostname or "").lower()
    q = parse_qs(parts.query)
    inner = None
    if host.endswith("safelinks.protection.outlook.com"):
        inner = (q.get("url") or [None])[0]
    elif host == "urldefense.proofpoint.com" and "/v2/" in parts.path:
        raw = (q.get("u") or [None])[0]
        if raw:
            inner = unquote(raw.replace("-", "%").replace("_", "/"))
    elif host in ("urldefense.com", "urldefense.us") and parts.path.startswith("/v3/__"):
        inner = parts.path[len("/v3/__"):].split("__;", 1)[0]
        if parts.query:
            inner += "?" + parts.query.split("__;", 1)[0]
    elif host in ("www.google.com", "google.com") and parts.path == "/url":
        inner = (q.get("q") or q.get("url") or [None])[0]
    if inner and inner.lower().startswith(("http://", "https://")):
        return unwrap(inner, depth + 1)
    return url


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip("[]"))
        return True
    except ValueError:
        return bool(re.fullmatch(r"\d+", host)) or bool(re.fullmatch(r"0x[0-9a-f]+", host))


# ---------------------------------------------------------------- lookalikes

def normalize(label: str) -> str:
    """A name with lookalike characters swapped for what they imitate."""
    label = unicodedata.normalize("NFKC", label.lower()).translate(_CONFUSABLES)
    label = unicodedata.normalize("NFKD", label)
    label = "".join(c for c in label if not unicodedata.combining(c))
    for fake, real in _HOMOGLYPHS:
        label = label.replace(fake, real)
    return label


def _distance(a: str, b: str, limit: int) -> int:
    """Edit distance where swapping two neighbouring letters counts as one edit."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev2, prev = None, list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if prev2 is not None and i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        prev2, prev = prev, cur
    return prev[-1]


# Ordinary words one letter away from a brand name.
NOT_LOOKALIKES = {"finance", "romance", "outlooks", "dropbear", "workdays", "netflux"}


def _close(token: str, name: str, exact_only: bool = False) -> bool:
    """Is token the name, or a lookalike spelling of it?"""
    if not token:
        return False
    norm = normalize(token)
    if token == name or norm == name:
        return True
    if exact_only or norm in NOT_LOOKALIKES:
        return False
    # Doubled letters: gooogle, paypall.
    if _squeeze(norm) == _squeeze(name) and len(norm) - len(name) <= 2:
        return True
    limit = 2 if len(name) >= 10 else 1 if len(name) >= 7 else 0
    return limit > 0 and _distance(norm, name, limit) <= limit


def _squeeze(s: str) -> str:
    return re.sub(r"(.)\1+", r"\1", s)


def _tokens(host: str) -> list[str]:
    host = decode_host(host)
    return [t for t in re.split(r"[.\-_]", host) if t]


def brand_imitated(host: str) -> str | None:
    """The brand a host pretends to be, if it uses a brand's name (or a near
    spelling of it) without being on one of that brand's real domains."""
    if not host or _is_ip(host):
        return None
    for name, real in brands.BRANDS.items():
        if belongs_to(host, real):
            continue
        for tok in _tokens(host):
            if _close(tok, name, name in brands.EXACT_ONLY):
                return name
    return None


def org_imitated(host: str, org_domains) -> str | None:
    """Which of our own domains a host is a near copy of (but isn't)."""
    if not host or not org_domains or belongs_to(host, org_domains):
        return None
    # Our own space on a service we use: acme.sharepoint.com, acme.okta.com.
    if any(belongs_to(host, real) for real in brands.BRANDS.values()):
        return None
    reg = registrable(decode_host(host))
    label = reg.split(".")[0]
    for d in org_domains:
        own = d.split(".")[0]
        if len(own) < 4:
            continue
        if label != own and (normalize(label) == normalize(own) or _close(label, own)):
            return d
        # our name stuffed into somebody else's domain: acme-corp.com.evil.io, acme-sso.net
        if any(t == own for t in _tokens(host)) and registrable(host) != registrable(d):
            return d
    return None


# ---------------------------------------------------------------- one link

def analyze_link(href: str, shown: str = "", org_domains=(), trusted=()) -> tuple[str, list[Signal]]:
    """Look at one link. Returns (real destination, signals).

    shown is the text a person sees and clicks, if it differs from the address.
    trusted domains are believed (no lookalike or wording checks), but a
    trusted domain can still never run code or hide a different site behind @.
    """
    raw = (href or "").strip()
    signals: list[Signal] = []
    lower = raw.lower()
    if lower.startswith(("mailto:", "tel:", "#", "sms:", "callto:")) or not raw:
        return raw, signals
    if lower.startswith(("javascript:", "data:", "vbscript:", "file:")):
        signals.append(Signal("scheme", "The link runs code or opens a local file instead of a web page",
                              raw[:80], 70))
        return raw, signals

    dest = unwrap(raw)
    try:
        parts = urlsplit(dest)
    except ValueError:
        return dest, [Signal("scheme", "The link is malformed in a way browsers may misread", dest[:80], 40)]
    host = host_of(dest)
    shown_host = decode_host(host)

    if parts.username or "@" in (parts.netloc or ""):
        signals.append(Signal("userinfo", f"The address hides its real site behind an @: it goes to {shown_host}",
                              dest[:120], 60))

    all_trusted = tuple(trusted) + tuple(org_domains)
    is_trusted = belongs_to(host, all_trusted)

    # The text says one site, the link goes to another.
    shown_text = (shown or "").strip()
    m = DOMAIN_LIKE.match(shown_text)
    if m and host:
        claimed = m.group(1).lower()
        if "." in claimed and registrable(claimed) != registrable(host) \
                and not belongs_to(host, brands.BRANDS.get(registrable(claimed).split(".")[0], ())):
            signals.append(Signal("text-mismatch", f"The link says {claimed} but really goes to {shown_host}",
                                  f"{shown_text[:60]} → {host}", 60))

    if is_trusted:
        return dest, signals

    if _is_ip(host):
        signals.append(Signal("ip-address", "The link goes to a bare number (IP address), not a named site",
                              host, 35))
    else:
        org = org_imitated(host, org_domains)
        if org:
            signals.append(Signal("org-lookalike", f"{shown_host} is made to look like our own {org}",
                                  shown_host, 65))
        brand = brand_imitated(host)
        if brand and not org:
            signals.append(Signal("brand-lookalike",
                                  f"{shown_host} uses {brands.DISPLAY.get(brand, brand)}'s name but isn't "
                                  f"{brands.DISPLAY.get(brand, brand)}", shown_host, 60))
        if "xn--" in host:
            signals.append(Signal("punycode", f"The address uses lookalike letters from another alphabet: {shown_host}",
                                  host, 30))
        reg = registrable(host)
        if reg in brands.SHORTENERS or host in brands.SHORTENERS:
            signals.append(Signal("shortener", "A short link hides where it really goes", host, 15))
        tld = host.rsplit(".", 1)[-1]
        if tld in brands.RISKY_TLDS:
            signals.append(Signal("risky-tld", f"The address ends in .{tld}, an ending scammers use a lot", host, 10))
        if host.count(".") - reg.count(".") >= 3:
            signals.append(Signal("deep-subdomain", "A long chain of words pushes the real site out of view",
                                  host, 10))

    path = unquote((parts.path or "") + "?" + (parts.query or "")).lower()
    login = next((w for w in LOGIN_WORDS if re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", path)), None)
    if login:
        if parts.scheme == "http":
            signals.append(Signal("no-https", "A sign-in page that isn't encrypted (http, not https)", host, 25))
        else:
            signals.append(Signal("login-path", "It goes straight to a sign-in or verify page", login, 10))
    if (parts.path or "").lower().endswith(DOWNLOAD_EXTENSIONS):
        signals.append(Signal("download", "The link downloads a program or script",
                              (parts.path or "").rsplit("/", 1)[-1][:60], 45))
    for value in parse_qs(parts.query).values():
        inner = next((v for v in value if v.lower().startswith(("http://", "https://"))), None)
        if inner and registrable(host_of(inner)) not in ("", registrable(host)):
            signals.append(Signal("redirect", f"It bounces on to another site: {host_of(inner)}", host_of(inner), 15))
            break
    return dest, signals
