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
NOT_LOOKALIKES = {"finance", "romance", "outlooks", "dropbear", "workdays", "netflux", "applied", "salesforge",
                  "facebooks", "linkedln"}
_INTERNAL_TLDS = {"local", "lan", "corp", "internal", "intranet", "home", "localdomain", "test", "localhost",
                  "example", "invalid", "arpa", "private"}


def _squeeze(s: str) -> str:
    return re.sub(r"(.)\1+", r"\1", s)


def _match(token: str, name: str) -> str | None:
    """How token resembles a brand name: "exact", "disguised" (lookalike
    letters, doubled letters), "near" (one letter off), or not at all."""
    if not token:
        return None
    if token == name:
        return "exact"
    norm = normalize(token)
    if norm == name:
        return "disguised"
    if name in brands.EXACT_ONLY or norm in NOT_LOOKALIKES:
        return None
    if _squeeze(norm) == _squeeze(name) and 0 < len(norm) - len(name) <= 2:
        return "disguised"
    if len(name) >= 8 and _distance(norm, name, 1) <= 1:
        return "near"
    return None


def _close(token: str, name: str, exact_only: bool = False) -> bool:
    kind = _match(token, name)
    return kind is not None and (not exact_only or kind == "exact")


def is_internal(host: str) -> bool:
    """A private address on the company network: an intranet name, a printer,
    a router, this computer. Phishing comes from the internet, not from here."""
    host = host.strip("[]").lower()
    if not host or host == "localhost" or "." not in host:
        return bool(host)
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return host.rsplit(".", 1)[-1] in _INTERNAL_TLDS


def _platform(host: str, platforms) -> str | None:
    """The most specific platform a host sits on: app.box.com before box.com."""
    found = [p for p in platforms if host.endswith("." + p)]
    return max(found, key=len) if found else None


def _parts(host: str):
    """(labels someone chose, platform it sits on or None). For
    "paypal-login.web.app" that's (["paypal-login"], "web.app"); for
    "login.paypal.com.evil.co.uk" it's (["login", "paypal", "com", "evil"], None)."""
    dhost = decode_host(host)
    platform = _platform(dhost, brands.TENANT_PLATFORMS | brands.FREE_HOSTS)
    if platform:
        return dhost[: -len(platform) - 1].split("."), platform
    reg = registrable(dhost)
    suffix = reg.count(".")  # labels after the bought name
    labels = dhost.split(".")
    return labels[: len(labels) - suffix], None


def _words(labels) -> list[str]:
    return [w for label in labels for w in re.split(r"[\-_]", label) if w]


def brand_imitation(host: str) -> tuple[str, int] | None:
    """(brand, weight) if a host uses a brand's name without being that brand.

    The weight depends on how: disguised spellings and a brand dressed up as
    a whole domain (paypal.com.evil.io) are danger; the plain name only with
    words phishers pair it with; a brand name that's an everyday word, a fan
    or developer site, or a company's own space on a platform, not at all.
    """
    if not host or _is_ip(host) or is_internal(host):
        return None
    labels, platform = _parts(host)
    if not labels:
        return None
    words = _words(labels)
    best = None
    for name, real in brands.BRANDS.items():
        if belongs_to(host, real) or belongs_to(decode_host(host), real):
            continue
        for i, w in enumerate(words):
            kind = _match(w, name)
            others = words[:i] + words[i + 1:]
            if not kind and len(name) >= 5 and len(w) > len(name):
                # glued to a phishing word: microsoftonline, paypalsecure, appleidverify
                rest = w[len(name):] if w.startswith(name) else w[:-len(name)] if w.endswith(name) else ""
                if rest in brands.PHISHY_WORDS:
                    kind, others = "exact", others + [rest]
            if not kind:
                continue
            phishy = any(o in brands.PHISHY_WORDS for o in others)
            companion = phishy or any(o in brands.BRANDS for o in others)
            community = any(o in brands.COMMUNITY_WORDS for o in others) and not phishy
            dressed = any(lbl in ("com", "net", "org", "co") for lbl in labels[:-1]) or (
                len(labels) > 1 and labels[-1] not in ("www",) and name in labels[:-1])
            if platform in brands.TENANT_PLATFORMS and labels[-1] == name and len(labels) == 1:
                continue  # stripe.statuspage.io, google.github.io: the brand's own space
            if kind == "disguised" or dressed:
                weight = 60
            elif community and not kind == "near":
                weight = 0
            elif kind == "near":
                weight = 60 if companion else 30
            elif name in brands.COMMON_WORD_BRANDS:
                weight = 60 if companion else 0
            elif platform in brands.TENANT_PLATFORMS:
                weight = 60 if companion else 0
            else:
                weight = 60 if companion else 40
            if weight and (best is None or weight > best[1]):
                best = (name, weight)
    return best


def brand_imitated(host: str) -> str | None:
    found = brand_imitation(host)
    return found[0] if found and found[1] >= 40 else None


def org_imitation(host: str, org_domains) -> tuple[str, int] | None:
    """(our domain, weight) if a host is a copy of one of our own domains."""
    if not host or not org_domains or belongs_to(host, org_domains) or is_internal(host) or _is_ip(host):
        return None
    # Our own space on a service we use: acme.sharepoint.com, acme.atlassian.net.
    if any(belongs_to(host, real) for real in brands.BRANDS.values()):
        return None
    labels, platform = _parts(host)
    if platform in brands.TENANT_PLATFORMS and len(labels) == 1:
        return None
    words = _words(labels)
    reg_label = registrable(decode_host(host)).split(".")[0]
    for d in org_domains:
        own = d.split(".")[0]
        if len(own) < 4:
            continue
        others = [w for w in words if w != own]
        companion = any(o in brands.PHISHY_WORDS or o in brands.BRANDS for o in others)
        if reg_label != own and (normalize(reg_label) == normalize(own)
                                 or (_squeeze(normalize(reg_label)) == _squeeze(own) and len(reg_label) > len(own))):
            return d, 65                                   # acrne.com, acmme.com
        if reg_label != own and len(own) >= 6 and _distance(reg_label, own, 1) <= 1:
            return d, 65 if companion else 35              # one letter off a longer name
        if own in words and registrable(host) != registrable(d):
            dressed = own in labels[:-1] and any(lbl in ("com", "co", "net", "org") for lbl in labels)
            if dressed or companion:
                return d, 65                               # acme.com.evil.io, acme-sso.net
            return d, 15                                   # acme-bagels.com: just shares the word
    return None


def org_imitated(host: str, org_domains) -> str | None:
    found = org_imitation(host, org_domains)
    return found[0] if found and found[1] >= 40 else None


def _same_owner(a: str, b: str, also=()) -> bool:
    """Do two hosts belong to the same company (same domain, or both one brand's)?"""
    if registrable(a) == registrable(b):
        return True
    if also and belongs_to(a, also) and belongs_to(b, also):
        return True
    return any(belongs_to(a, real) and belongs_to(b, real) for real in brands.BRANDS.values())


def claimed_site(text: str) -> str | None:
    """The site a link's words name, if they name one: "www.chase.com/login" ->
    "www.chase.com". File names and product names (report.pdf, Node.js) don't."""
    text = (text or "").strip()
    m = DOMAIN_LIKE.match(text)
    if not m:
        return None
    claimed = m.group(1).lower()
    tld = claimed.rsplit(".", 1)[-1]
    explicit = text.lower().startswith(("http://", "https://", "www."))
    if tld in brands.FILE_EXTENSIONS and not explicit:
        return None
    if tld not in brands.GENERIC_TLDS and not explicit:
        return None
    if len(claimed.split(".")[0]) < 2:
        return None
    return claimed


def is_click_tracker(host: str) -> bool:
    return belongs_to(host, brands.CLICK_TRACKERS) or registrable(host) in brands.SHORTENERS or host in brands.SHORTENERS


# ---------------------------------------------------------------- one link

def analyze_link(href: str, shown: str = "", org_domains=(), trusted=()) -> tuple[str, list[Signal]]:
    """Look at one link. Returns (real destination, signals).

    shown is the text a person sees and clicks, if it differs from the address.
    Trusted domains, the company's own, the real domains of the brands we know
    and private network addresses are believed: no lookalike or wording checks.
    Nothing can make a link that runs code, or hides its site behind @, safe.
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
        parts.port  # noqa: B018 - raises on a malformed port
    except ValueError:
        return dest, [Signal("scheme", "The link is malformed in a way browsers may misread", dest[:80], 40)]
    host = host_of(dest)
    shown_host = decode_host(host)

    if parts.username or "@" in (parts.netloc or ""):
        signals.append(Signal("userinfo", f"The address hides its real site behind an @: it goes to {shown_host}",
                              dest[:120], 60))

    ours = tuple(trusted) + tuple(org_domains)

    # The words say one site, the link goes to another. A newsletter's click
    # counter or a short link never shows the real address, so it proves nothing.
    claimed = claimed_site(shown)
    if claimed and host and not is_click_tracker(host) and not _same_owner(claimed, host, ours):
        signals.append(Signal("text-mismatch", f"The link says {claimed} but really goes to {shown_host}",
                              f"{(shown or '').strip()[:60]} → {host}", 60))

    if belongs_to(host, ours) or is_internal(host) or any(belongs_to(host, real) for real in brands.BRANDS.values()):
        return dest, signals

    if _is_ip(host):
        signals.append(Signal("ip-address", "The link goes to a bare number (IP address), not a named site",
                              host, 40))
    else:
        org = org_imitation(host, org_domains)
        if org and org[1] >= 25:
            signals.append(Signal("org-lookalike", f"{shown_host} is made to look like our own {org[0]}",
                                  shown_host, org[1]))
        brand = brand_imitation(host)
        if brand and not (org and org[1] >= 25):
            name = brands.DISPLAY.get(brand[0], brand[0])
            signals.append(Signal("brand-lookalike", f"{shown_host} uses {name}'s name but isn't {name}",
                                  shown_host, brand[1]))
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
            signals.append(Signal("no-https", "A sign-in page that isn't encrypted (http, not https)", host, 20))
        else:
            signals.append(Signal("login-path", "It goes straight to a sign-in or verify page", login, 5))
    if (parts.path or "").lower().endswith(DOWNLOAD_EXTENSIONS):
        signals.append(Signal("download", "The link downloads a program or script",
                              (parts.path or "").rsplit("/", 1)[-1][:60], 20))
    for value in parse_qs(parts.query).values():
        inner = next((v for v in value if v.lower().startswith(("http://", "https://"))), None)
        if inner and registrable(host_of(inner)) not in ("", registrable(host)):
            signals.append(Signal("redirect", f"It bounces on to another site: {host_of(inner)}", host_of(inner), 10))
            break
    return dest, signals
