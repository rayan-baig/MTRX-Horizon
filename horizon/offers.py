"""The partner page (/partners) and the Kitchen Safety Bundle (/bundle).

Both are about CyberLogix AI, and the bundle about OmniArmor.ai too. Their
addresses and whether they are public come from the app catalog
(catalog.py), read on every visit, so a button only links somewhere real.
An app with no public address shows "coming soon" and a way to ask in
Orbyt instead.

What the pages say about money is only what the apps' code does:

- Partners: CyberLogix AI's partners.py pays a share (a rate set for each
  partner) of what the partner's businesses actually paid in the last 30
  days. A free trial, an unpaid or a cancelled invoice earns nothing. No
  figure is printed here, because the rate is a setting.
- The bundle: CyberLogix AI's pricing.py charges the bundle as an add-on per
  location. BUNDLE_PRICE is that monthly price in US dollars; change both
  together. Set it to None and the page says "Ask about bundle pricing".
"""

from . import catalog, vortex

PARTNER_APP = "cyberlogix"
BUNDLE_APPS = ("cyberlogix", "omniarmor")
# The partnership kind the partner page's Apply button picks (vortex.py).
PARTNER_KIND = "refer-trade"
# Kept equal to CyberLogix AI's kitchen_safety_bundle add-on in pricing.py.
BUNDLE_PRICE = 29


def _apps() -> dict:
    """The released apps, by key."""
    return {a["key"]: catalog.public(a) for a in catalog.released()}


def _signup(url: str) -> str:
    # Both apps start a free account at /signup.
    return url.rstrip("/") + "/signup" if url else ""


def partner_context() -> dict:
    apps = _apps()
    app = apps.get(PARTNER_APP)
    # Apply opens the Partner form with CyberLogix AI picked and this kind
    # chosen (static/js/vortex-form.js, fromHash). If CyberLogix AI is not
    # public right now, the form opens with nothing picked.
    apply = f"/orbyt#partner/{PARTNER_APP}/{PARTNER_KIND}" if app else "/orbyt#partner"
    return {
        "app": app,
        "apply": apply,
        "kind_name": vortex.PARTNERSHIPS[PARTNER_KIND],
    }


def bundle_context() -> dict:
    apps = _apps()
    picked = [apps[k] for k in BUNDLE_APPS if k in apps]
    base = apps.get(BUNDLE_APPS[0])
    trial = _signup(base["url"]) if base else ""
    # With no address to send a visitor to, ask in Orbyt, with the
    # bundle's apps already picked.
    ask = "/orbyt#partner/" + ",".join(a["key"] for a in picked) if picked else "/orbyt#partner"
    return {
        "apps": picked,
        "complete": len(picked) == len(BUNDLE_APPS),
        "trial": trial,
        "ask": ask,
        "price": BUNDLE_PRICE,
    }
