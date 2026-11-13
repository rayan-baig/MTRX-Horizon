"""Deciding whether a message, a link or a page is safe, and saying why.

One message is looked at as a whole: who it claims to be from, what it asks
for, what is attached, and every link in it. The verdict is the worst link
plus everything about the message itself, so a "please confirm your password"
email with a slightly odd link is worse than either alone.
"""

import re
import time
from dataclasses import dataclass, field

from . import brands, creds, urls
from .signals import Signal, level

# What people are asked to do in phishing, in the words used. Each group adds
# its weight once, however many of its phrases appear.
PHRASES = {
    "credential-request": (25, (
        r"verify your (?:account|identity|mailbox|credentials)", r"confirm your (?:password|account|identity|login|credentials)",
        r"(?:enter|provide|update|re-?enter|validate) your (?:password|credentials|login details|account details)",
        r"your password (?:will expire|has expired|expires)", r"mailbox (?:is full|storage|quota|will be (?:deactivated|deleted))",
        r"re-?activate your account", r"unusual sign-?in activity", r"sign in to (?:view|review|release|receive) (?:the )?(?:document|file|message|invoice|payment)s?",
        r"keep (?:your )?(?:same|current) password", r"re-?validate your (?:account|password|mailbox)",
        r"to avoid (?:account )?(?:suspension|deactivation|termination|losing access)",
    )),
    "mfa-code": (35, (
        r"(?:send|give|share|read|text|tell|forward) (?:me|us) (?:the|your|that) (?:verification|security|login|sign-?in|"
        r"one[- ]time|otp|2fa|mfa|authenticator|confirmation|6[- ]digit|six[- ]digit) (?:code|pin|passcode|number)",
        r"(?:send|give|share|read|text|tell|forward) (?:me|us) (?:the|that) (?:code|pin|passcode|number) (?:you|that|which) "
        r"(?:just )?(?:got|received|get|were sent|was sent|came|arrived)",
        r"(?:send|give|share|read|text|tell|forward) (?:me|us) (?:the|that) (?:code|pin|passcode) (?:on|from) your (?:phone|mobile|app)",
        r"(?:send|give|text|tell) (?:me|us) (?:the|that) (?:code|pin|passcode) so (?:i|we) can (?:fix|verify|unlock|reset|sign|log)",
        r"(?:approve|accept) the (?:sign-?in|login|mfa|push|authentication) (?:request|prompt|notification)s? (?:i|we) (?:just )?sent",
    )),
    "urgency": (15, (
        r"within (?:24|48|12|2|1) ?(?:hours?|hrs?)", r"\bimmediately\b", r"\burgent(?:ly)?\b", r"final (?:notice|warning|reminder)",
        r"(?:account|access|mailbox) (?:will be|has been) (?:suspended|locked|disabled|closed|terminated|limited)",
        r"\bact now\b", r"before (?:end of|close of) (?:day|business)", r"\btoday only\b",
    )),
    "payment-change": (25, (
        r"(?:change|update|new|updated) (?:of |to )?(?:our |my )?(?:bank(?:ing)? (?:details|account|information)|"
        r"payment (?:details|information|instructions)|remittance details)",
        r"(?:bank|account|banking) details have changed", r"\bgift ?cards?\b",
        r"(?:process|make|send) (?:a|the) (?:payment|transfer|wire) (?:today|now|urgently|quickly|right away)",
        r"keep this (?:confidential|between us|to yourself)", r"i(?:'m| am) (?:in a meeting|traveling|unavailable)(?:.{0,40})(?:payment|transfer|gift)",
    )),
}
_COMPILED = {code: (w, [re.compile(p, re.I) for p in pats]) for code, (w, pats) in PHRASES.items()}

DANGEROUS_ATTACHMENTS = (".exe", ".scr", ".com", ".pif", ".bat", ".cmd", ".js", ".jse", ".vbs", ".vbe", ".wsf",
                         ".hta", ".ps1", ".msi", ".jar", ".lnk", ".iso", ".img", ".vhd", ".vhdx", ".cpl", ".reg",
                         ".one", ".xll", ".svg")
WEB_ATTACHMENTS = (".html", ".htm", ".shtml", ".xhtml", ".mht")
MACRO_ATTACHMENTS = (".docm", ".xlsm", ".pptm", ".dotm", ".xlam", ".xlsb")
DOC_LOOKING = (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".png", ".txt", ".csv", ".zip")
_GATEWAY_HEADERS = re.compile(r"(?i)^\s*(?:\[external\]|\[suspicious\]|\[spam\]|\*\*\*spam\*\*\*|\[phish(?:ing)?\])")

SOURCES = ("mail", "chat", "browser", "clipboard", "manual")


@dataclass
class Message:
    source: str = "manual"                         # where it was seen
    sender_name: str = ""
    sender_address: str = ""
    reply_to: str = ""
    subject: str = ""
    text: str = ""
    links: list = field(default_factory=list)      # [(href, shown text)], from HTML; plain-text links are found too
    attachments: list = field(default_factory=list)
    gateway_verdict: str = ""                      # what an email gateway already stamped on it, if anything
    where: str = ""                                # a short label for the alert: an inbox, a page's site


@dataclass
class LinkVerdict:
    url: str
    destination: str
    score: int
    level: str
    signals: list

    def to_dict(self) -> dict:
        return {"url": self.url, "destination": self.destination, "score": self.score, "level": self.level,
                "signals": [s.to_dict() for s in self.signals]}


@dataclass
class Verdict:
    level: str
    score: int
    headline: str
    signals: list
    links: list
    source: str = "manual"
    where: str = ""
    subject: str = ""
    sender: str = ""
    worst_link: str = ""
    at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {"level": self.level, "score": self.score, "headline": self.headline, "source": self.source,
                "where": self.where, "subject": self.subject, "sender": self.sender, "worst_link": self.worst_link,
                "at": self.at, "signals": [s.to_dict() for s in self.signals],
                "links": [link.to_dict() for link in self.links]}


def _domain(address: str) -> str:
    address = (address or "").strip().strip("<>").lower()
    return address.rsplit("@", 1)[-1] if "@" in address else ""


def check_link(href: str, shown: str = "", policy=None) -> LinkVerdict:
    org, trusted = _domains(policy)
    dest, sigs = urls.analyze_link(href, shown, org, trusted)
    score = sum(s.weight for s in sigs)
    return LinkVerdict(href, dest, score, level(score), sigs)


def _domains(policy):
    if policy is None:
        return (), ()
    return tuple(policy.org_domains), tuple(policy.trusted_domains)


def _name_words(name: str) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9&]+", name.lower()) if w]


def _claims(words, key) -> bool:
    """Is a display name just this brand (or our name) plus service words?
    "Microsoft 365 Support" yes; "Salesforce Ben", "Chase Miller" no."""
    hits = [w for w in words if w == key or urls.normalize(w) == key]
    if not hits:
        return False
    rest = [w for w in words if w not in hits]
    return all(r in brands.SERVICE_WORDS or r in brands.BRANDS or r.isdigit() for r in rest)


def _role(name: str) -> bool:
    low = " " + re.sub(r"[^a-z0-9]+", " ", name.lower()) + " "
    return bool(re.search(r"\bIT\b", name)) or any(f" {r} " in low for r in brands.ROLE_WORDS)


def _sender_signals(msg: Message, org) -> list[Signal]:
    sigs = []
    dom = _domain(msg.sender_address)
    name = (msg.sender_name or "").strip()
    known = dom not in brands.FREEMAIL and (any(urls.belongs_to(dom, real) for real in brands.BRANDS.values())
             or urls.belongs_to(dom, brands.TENANT_PLATFORMS) or urls.belongs_to(dom, brands.REPLY_PLATFORMS))
    if dom and not urls.belongs_to(dom, org):
        found = urls.org_imitation(dom, org)
        if found and found[1] >= 25:
            sigs.append(Signal("sender-lookalike", f"The sender's address {dom} is made to look like our {found[0]}",
                               msg.sender_address, found[1]))
        else:
            brand = urls.brand_imitation(dom)
            if brand and brand[1] >= 40:
                sigs.append(Signal("sender-lookalike",
                                   f"The sender's address {dom} uses {brands.DISPLAY.get(brand[0], brand[0])}'s name "
                                   f"but isn't theirs", msg.sender_address, min(55, brand[1])))
    if name and dom and not sigs and not urls.belongs_to(dom, org):
        words = _name_words(name)
        for key, real in brands.BRANDS.items():
            if urls.belongs_to(dom, real):
                continue
            if _claims(words, key):
                sigs.append(Signal("sender-brand", f"It says it's from {brands.DISPLAY.get(key, key)}, but was sent from {dom}",
                                   f"{name} <{msg.sender_address}>", 45))
                break
        # Someone outside claiming to be us ("Acme IT Helpdesk" from gmail.com).
        if not sigs and org and not known:
            for d in org:
                own = d.split(".")[0]
                if len(own) >= 4 and (own in words) and (_claims(words, own) or _role(name)):
                    sigs.append(Signal("sender-brand", f"It uses our company's name, but was sent from outside: {dom}",
                                       f"{name} <{msg.sender_address}>", 40))
                    break
        # A boss or IT writing from a personal address: the gift-card scam.
        if not sigs and dom in brands.FREEMAIL and _role(name):
            sigs.append(Signal("sender-role", f"Someone claiming a senior or IT role is writing from a personal "
                                              f"{dom} address", f"{name} <{msg.sender_address}>", 30))
    reply = _domain(msg.reply_to)
    if reply and dom and urls.registrable(reply) != urls.registrable(dom) and not urls.belongs_to(reply, org) \
            and not urls.belongs_to(reply, brands.REPLY_PLATFORMS):
        to_personal = reply in brands.FREEMAIL and dom not in brands.FREEMAIL
        sigs.append(Signal("reply-to", f"Replies would go to {reply}, not to {dom}" +
                           (", a personal email account" if to_personal else ""), msg.reply_to, 30 if to_personal else 15))
    return sigs


def _wording_signals(msg: Message) -> list[Signal]:
    sigs = []
    text = f"{msg.subject}\n{msg.text}"
    titles = {"credential-request": "It asks you to sign in or confirm your password",
              "mfa-code": "It asks for a one-time code or to approve a sign-in",
              "urgency": "It pushes you to act fast or lose access",
              "payment-change": "It asks for a payment or a change of bank details"}
    for code, (weight, patterns) in _COMPILED.items():
        for p in patterns:
            m = p.search(text)
            if m:
                sigs.append(Signal(code, titles[code], f"“{m.group(0)[:80]}”", weight))
                break
    return sigs


def _attachment_signals(names) -> list[Signal]:
    sigs = []
    for name in names or ():
        low = (name or "").lower().strip()
        if not low:
            continue
        stem, _, ext = low.rpartition(".")
        ext = "." + ext if stem else ""
        if ext in DANGEROUS_ATTACHMENTS and any(stem.endswith(d) for d in DOC_LOOKING):
            sigs.append(Signal("double-extension", f"{name} pretends to be a document but is a {ext} file", name, 60))
        elif ext in DANGEROUS_ATTACHMENTS:
            sigs.append(Signal("attachment", f"The attachment {name} is a program or script", name, 45))
        elif ext in WEB_ATTACHMENTS:
            sigs.append(Signal("attachment", f"The attachment {name} is a web page, often a fake sign-in form", name, 35))
        elif ext in MACRO_ATTACHMENTS:
            sigs.append(Signal("attachment", f"The attachment {name} can run macros", name, 30))
    return sigs


def check_message(msg: Message, policy=None) -> Verdict:
    org, trusted = _domains(policy)
    signals: list[Signal] = []

    pairs = list(msg.links or [])
    known = {h for h, _ in pairs}
    pairs += [(u, "") for u in urls.find_links(msg.text) if u not in known]
    link_verdicts = []
    for href, shown in pairs[:200]:
        dest, sigs = urls.analyze_link(href, shown, org, trusted)
        if not dest or dest.lower().startswith(("mailto:", "tel:", "#")):
            continue
        score = sum(s.weight for s in sigs)
        link_verdicts.append(LinkVerdict(href, dest, score, level(score), sigs))
    link_verdicts.sort(key=lambda v: -v.score)

    sender_reg = urls.registrable(_domain(msg.sender_address))
    for lv in link_verdicts:
        # A program download is normal on a website, not in a message, unless
        # it comes from the sender's own site (a release note with its installer).
        if msg.source in ("mail", "chat") and urls.registrable(urls.host_of(lv.destination)) != sender_reg:
            for s in lv.signals:
                if s.code == "download":
                    s.weight = 45
            lv.score = sum(s.weight for s in lv.signals)
            lv.level = level(lv.score)
    link_verdicts.sort(key=lambda v: -v.score)

    signals += _sender_signals(msg, org)
    signals += _attachment_signals(msg.attachments)
    wording = _wording_signals(msg)

    # Words alone ("urgent", "verify your account", "invoice") are in plenty
    # of real mail. They count in full only when something technical is wrong
    # too: a lookalike sender, a bad link, a risky attachment. Without that,
    # they can't make a warning on their own, except a request for a one-time code.
    evidence = any(s.weight >= 20 for s in signals) or (link_verdicts and link_verdicts[0].score >= 20)
    if not evidence:
        allowance = 20
        for s in sorted(wording, key=lambda s: -s.weight):
            if s.code == "mfa-code":
                continue
            s.weight = min(s.weight, allowance)
            allowance -= s.weight
        wording = [s for s in wording if s.weight > 0]
    signals += wording
    # Replies going elsewhere matter most when the message wants something
    # sent back: a code or a payment.
    if any(s.code in ("payment-change", "mfa-code") for s in wording):
        for s in signals:
            if s.code == "reply-to":
                s.weight = max(s.weight, 40)

    if msg.gateway_verdict or _GATEWAY_HEADERS.match(msg.subject or ""):
        tag = msg.gateway_verdict or _GATEWAY_HEADERS.match(msg.subject).group(0).strip()
        if "external" not in tag.lower():
            signals.append(Signal("gateway-flagged", "Your email security already marked this as suspicious", tag, 30))

    for kind, masked in creds.find(f"{msg.subject}\n{msg.text}"):
        signals.append(Signal("secret-shared", f"A {kind.lower()} was shared here in plain text", masked, 50))

    worst = link_verdicts[0] if link_verdicts and link_verdicts[0].score > 0 else None
    score = sum(s.weight for s in signals) + (worst.score if worst else 0)
    all_signals = signals + (worst.signals if worst else [])
    all_signals.sort(key=lambda s: -s.weight)
    lvl = level(score)
    return Verdict(lvl, score, _headline(lvl, all_signals, worst, bool(link_verdicts)), all_signals, link_verdicts, msg.source, msg.where,
                   msg.subject, f"{msg.sender_name} <{msg.sender_address}>".strip() if msg.sender_address else msg.sender_name,
                   worst.url if worst else (link_verdicts[0].url if link_verdicts and lvl != "safe" else ""))


def _headline(lvl: str, signals, worst, has_links: bool = False) -> str:
    codes = {s.code for s in signals}
    if lvl == "safe":
        return "Looks fine to me."
    if codes == {"secret-shared"} or (codes and codes <= {"secret-shared", "urgency"}):
        return "Careful: a password or key was shared here."
    if lvl == "danger":
        if "mfa-code" in codes:
            return "Don't share that code! This looks like an attempt to sign in as you."
        if "payment-change" in codes and not worst:
            return "Stop before paying: this looks like payment fraud."
        if worst or (has_links and codes & {"credential-request", "sender-brand", "sender-lookalike"}):
            return "Don't click that link! It looks like phishing."
        if codes & {"attachment", "double-extension"}:
            return "Don't open that attachment! It looks dangerous."
        return "This looks like phishing. Don't reply or act on it."
    return "Hmm, take a second look at this one."
