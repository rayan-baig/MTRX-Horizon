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
        r"verify your (?:account|identity|email|mailbox|credentials)", r"confirm your (?:password|account|identity|login|credentials)",
        r"(?:enter|provide|update|re-?enter|validate) your (?:password|credentials|login details|account details)",
        r"your password (?:will expire|has expired|expires)", r"mailbox (?:is full|storage|quota|will be (?:deactivated|deleted))",
        r"re-?activate your account", r"unusual sign-?in activity", r"sign in to (?:view|review|release|receive) (?:the )?(?:document|file|message|invoice|payment)s?",
        r"(?:shared|sent) (?:a|the) (?:secure )?(?:document|file) with you", r"keep (?:your )?(?:same|current) password",
        r"to avoid (?:account )?(?:suspension|deactivation|termination|losing access)",
    )),
    "mfa-code": (35, (
        r"(?:send|give|share|read|text) (?:me|us) (?:the|your) (?:code|otp|verification code|one[- ]time (?:code|password|passcode))",
        r"(?:what|which) (?:is|was) the (?:code|otp)", r"approve the (?:sign-?in|login|mfa|push) (?:request|prompt|notification)",
        r"(?:authenticator|mfa|2fa|two-factor) code",
    )),
    "urgency": (15, (
        r"within (?:24|48|12|2|1) ?(?:hours?|hrs?)", r"\bimmediately\b", r"\burgent(?:ly)?\b", r"final (?:notice|warning|reminder)",
        r"(?:account|access|mailbox) (?:will be|has been) (?:suspended|locked|disabled|closed|terminated)",
        r"\bact now\b", r"\bas soon as possible\b", r"before (?:end of|close of) (?:day|business)", r"\btoday only\b",
    )),
    "payment-change": (25, (
        r"(?:change|update|new) (?:of )?(?:our |my )?(?:bank(?:ing)? (?:details|account|information)|payment (?:details|information|instructions)|remittance)",
        r"wire (?:transfer|the payment|the funds)", r"\bgift ?cards?\b", r"(?:overdue|outstanding|unpaid) invoice",
        r"(?:process|make) (?:a|the) (?:payment|transfer) (?:today|now|urgently|quickly)", r"\b(?:iban|swift|routing number)\b",
        r"keep this (?:confidential|between us)", r"i(?:'m| am) (?:in a meeting|traveling|unavailable)(?:.{0,40})(?:payment|transfer|gift)",
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


def _sender_signals(msg: Message, org) -> list[Signal]:
    sigs = []
    dom = _domain(msg.sender_address)
    name = (msg.sender_name or "").strip()
    if dom:
        lookalike_org = urls.org_imitated(dom, org)
        if lookalike_org:
            sigs.append(Signal("sender-lookalike", f"The sender's address {dom} is made to look like our {lookalike_org}",
                               msg.sender_address, 65))
        else:
            brand = urls.brand_imitated(dom)
            if brand:
                sigs.append(Signal("sender-lookalike",
                                   f"The sender's address {dom} uses {brands.DISPLAY.get(brand, brand)}'s name but isn't theirs",
                                   msg.sender_address, 55))
    if name and dom and not sigs:
        words = [w for w in re.split(r"[^a-z0-9]+", urls.normalize(name)) if w]
        joined = "".join(words)
        for brand_key, real in brands.BRANDS.items():
            if urls.belongs_to(dom, real) or urls.belongs_to(dom, org):
                continue
            standalone = words == [brand_key] or (len(words) <= 3 and brand_key in words)
            weak = brand_key in brands.WEAK_IN_DISPLAY_NAME
            if (weak and words == [brand_key]) or (not weak and (standalone or brand_key in joined)):
                sigs.append(Signal("sender-brand",
                                   f"It says it's from {brands.DISPLAY.get(brand_key, brand_key)}, but was sent from {dom}",
                                   f"{name} <{msg.sender_address}>", 45))
                break
        # Someone outside claiming to be us ("Acme IT Support" from gmail.com).
        if not sigs and org:
            own_names = {d.split(".")[0] for d in org if len(d.split(".")[0]) >= 4}
            if any(o in joined for o in own_names) and not urls.belongs_to(dom, org):
                sigs.append(Signal("sender-brand", f"It uses our company's name, but was sent from outside: {dom}",
                                   f"{name} <{msg.sender_address}>", 40))
    reply = _domain(msg.reply_to)
    if reply and dom and urls.registrable(reply) != urls.registrable(dom) and not urls.belongs_to(reply, org):
        sigs.append(Signal("reply-to", f"Replies would go to {reply}, not to {dom}", msg.reply_to, 20))
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

    signals += _sender_signals(msg, org)
    signals += _attachment_signals(msg.attachments)
    wording = _wording_signals(msg)
    # Asking for credentials only really matters if there's a way to hand them
    # over: a link, an attachment, or a request to reply with them.
    has_route = bool(link_verdicts) or bool(msg.attachments) or any(s.code == "mfa-code" for s in wording)
    for s in wording:
        if s.code in ("credential-request", "urgency") and not has_route:
            s.weight = s.weight // 2
    signals += wording
    # Replies going elsewhere matter most when the message wants something
    # sent back: a code, a password, a payment.
    if any(s.code in ("payment-change", "mfa-code", "credential-request") for s in wording):
        for s in signals:
            if s.code == "reply-to":
                s.weight = 40

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
