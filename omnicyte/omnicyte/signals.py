"""What Omnicyte noticed, how much it counts, and how a person can spot it next time.

Every warning shows its signals, so each alert also teaches: it backs up the
company's security training at the moment it matters. The tip is written so
someone could find the same sign themselves without Omnicyte.
"""

from dataclasses import asdict, dataclass

# Scores at or above these make a warning. The weights below are set so that
# one strong sign alone (a lookalike domain, a link that says one address and
# goes to another) is "danger", and weak signs only add up to "caution".
DANGER = 60
CAUTION = 25

TIPS = {
    "scheme": "Real links start with https://. A link that runs code (javascript:) or carries a whole page "
              "inside it (data:) is never something a colleague needs you to open.",
    "text-mismatch": "Hover over a link before clicking: the address your mail app or browser shows at the "
                     "bottom is where it really goes. If it differs from the words you clicked, stop.",
    "brand-lookalike": "Read the address right to left from the first single slash: the part just before "
                       ".com (or .co.uk etc.) is who you are really talking to. Brand names elsewhere mean nothing.",
    "org-lookalike": "Attackers register addresses one letter off from ours. Compare it with your own email "
                     "address letter by letter, especially rn/m, l/1 and o/0.",
    "userinfo": "Anything before an @ in a web address is ignored by the browser. The real site is what comes "
                "after the @.",
    "ip-address": "Real companies use names, not bare numbers, for their sign-in pages.",
    "punycode": "This address uses letters from another alphabet that look like ours. Type the company's "
                "address yourself instead of following the link.",
    "shortener": "A short link hides where it goes. If you weren't expecting it, ask the sender what it is.",
    "risky-tld": "Cheap address endings like this are popular with scammers. Not proof, but look twice.",
    "deep-subdomain": "Long chains of words before the real domain are used to push the real name out of view.",
    "login-path": "This link goes straight to a sign-in or verify page. Go to the site yourself instead and "
                  "sign in from there.",
    "no-https": "This sign-in page is not encrypted. Never type a password into a page without https.",
    "redirect": "This link bounces you on to a different site. The first address is not where you end up.",
    "download": "This link downloads a program or script. Real invoices, documents and shared files don't.",
    "sender-brand": "The name in the From line can say anything. Look at the address after the name: is it "
                    "really that company's?",
    "sender-lookalike": "The sender's address is one or two letters away from a real one. Check it letter by letter.",
    "reply-to": "Replies to this message would go to a different address than the one it came from.",
    "credential-request": "No real IT team or service will ask you to confirm your password by email or chat. "
                          "If unsure, go to the site directly or call IT.",
    "mfa-code": "Never share a one-time code. Anyone who asks for one is trying to sign in as you.",
    "urgency": "Pressure to act fast (\"within 24 hours\", \"suspended\") is how scammers stop you checking. "
               "Slow down.",
    "payment-change": "Changes to bank details or urgent payments must be confirmed by phone on a number you "
                      "already have, never one in the message.",
    "attachment": "Programs, scripts and web pages sent as attachments are a common way in. Don't open it; "
                  "ask the sender through another channel if you were expecting it.",
    "double-extension": "Names like invoice.pdf.exe hide what a file really is. The last part is the real type.",
    "secret-shared": "Passwords and keys pasted into chat or mail stay in the history forever and can be "
                     "read by anyone with access. Rotate it and share it with a password manager instead.",
    "page-password": "This page asks for a password but its address doesn't match the company it looks like.",
    "gateway-flagged": "Your company's email security already marked this as suspicious.",
}


@dataclass
class Signal:
    code: str        # one of TIPS' keys
    title: str       # one line, what was seen
    detail: str      # the exact evidence (an address, a phrase)
    weight: int

    @property
    def tip(self) -> str:
        return TIPS.get(self.code, "")

    def to_dict(self) -> dict:
        d = asdict(self)
        d["tip"] = self.tip
        return d


def level(score: int) -> str:
    if score >= DANGER:
        return "danger"
    if score >= CAUTION:
        return "caution"
    return "safe"
