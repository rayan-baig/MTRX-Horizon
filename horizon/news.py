"""What's new on the home page (the bell's pop-up, and the page itself on a
phone): a short list, newest first, each item dated and linked.

Kept in step with the changelogs. An MTRX Horizyn item names the version of
this site it shipped in, and tests/test_site.py checks that version is in
CHANGELOG.md with the same date. An app's item names that app's version
(from its own CHANGELOG, in its own repo). The tests also refuse an item
much older than the newest CHANGELOG entry, so a stale line can't linger.
"""

from datetime import date

# Newest first. dot: the colour of the app it is about (see .dot in site.css).
# href: a page of this site, or the app's Learn more card on the home page.
NEWS = [
    {"date": "2026-11-22", "who": "Pilot", "dot": "violet", "source": "MTRX Horizyn 1.22.0",
     "text": "On Genesis, Pilot shows your projects and your next step straight away, read from this browser only.",
     "headline": "Your projects and next step, no key needed",
     "href": "/genesis"},
    {"date": "2026-11-22", "who": "Genesis", "dot": "violet", "source": "MTRX Horizyn 1.17.0",
     "text": "Coming back? Genesis opens on your project's next step, and cheers when you tick one.",
     "headline": "Opens on your project's next step",
     "href": "/genesis"},
    {"date": "2026-11-22", "who": "Orbyt", "dot": "blue", "source": "MTRX Horizyn 1.17.0",
     "text": "Short answers before you send: who owns your idea, and what happens next.",
     "headline": "Short answers before you send",
     "href": "/orbyt#pitch"},
    {"date": "2026-11-21", "who": "CyberLogix AI", "dot": "blue", "source": "CyberLogix AI 3.24.0",
     "text": "Pilot answers what a café asks most: which fridges need me, and is the food still OK?",
     "headline": "Pilot answers a café's top questions",
     "href": "/#learn-cyberlogix", "app": "cyberlogix"},
    {"date": "2026-11-21", "who": "OmniArmor.ai", "dot": "violet", "source": "OmniArmor.ai 1.14.0",
     "text": "Pilot tells you what's due or overdue, and explains any check in plain words.",
     "headline": "Pilot tells you what's due",
     "href": "/#learn-omniarmor", "app": "omniarmor"},
    {"date": "2026-11-21", "who": "RankUp", "dot": "green-dot", "source": "RankUp 0.28.0",
     "text": "Parents ask Pilot what's waiting for them, or start a new chore in one tap.",
     "headline": "Parents start a chore in one tap",
     "href": "/#learn-rankup", "app": "rankup"},
]

# The desktop "New" strip under the home page's buttons shows the newest
# item's headline (1.22.0): short enough to show whole, never cut off with
# "...". tests/test_site.py holds every headline to this many characters.
HEADLINE_MOST = 44

# How old the newest item may be next to the newest CHANGELOG entry, and the
# oldest item next to the newest: anything older is stale (tests check both).
FRESH_DAYS = 30
SPAN_DAYS = 45


def _shown(iso: str) -> str:
    """'22 Nov 2026', the same on every computer (no locale)."""
    d = date.fromisoformat(iso)
    return f"{d.day} {('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')[d.month - 1]} {d.year}"


def label(item: dict, open_urls: dict | None = None, demo_urls: dict | None = None) -> str:
    """What a visitor can do with an app's item today (1.19.0): nothing to
    say once the app is open; "In the demo" while it has a public demo
    with pretend data; otherwise "Preview" (the app is still in
    development). This site's own items (Genesis, Orbyt, Pilot) work today
    and have no label."""
    app = item.get("app")
    if not app or (open_urls or {}).get(app):
        return ""
    return "In the demo" if (demo_urls or {}).get(app) else "Preview"


def items(on_home: bool = True, open_urls: dict | None = None, demo_urls: dict | None = None) -> list:
    """The list for a page. On the home page itself, links to its own cards
    are just the anchor (#learn-...), so they open without a reload."""
    out = []
    for item in NEWS:
        href = item["href"]
        if on_home and href.startswith("/#"):
            href = href[1:]
        out.append({**item, "href": href, "shown": _shown(item["date"]),
                    "label": label(item, open_urls, demo_urls)})
    return out
