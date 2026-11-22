"""Genesis and Orbyt on their own addresses (1.25.0, horizon/hosts.py).

genesis.mtrxhorizyn.com and orbyt.mtrxhorizyn.com are served by this same
app once MTRX_APP_SUBDOMAINS=1. These check each address's routing, the
main site's redirects, every link (pages, Pilot's facts, news, offers, the
sitemap, canonical and Open Graph tags), Stripe's return addresses, the
security headers and cookies on each address, and that nothing changes
while the switch is off. The move of a visitor's saved projects is checked
in a real browser (tests/test_site_browser.py) and in Node
(tests/js/genesis_store.test.js).
"""

import re
from http.cookies import SimpleCookie

import pytest
from fastapi.testclient import TestClient

from tests.test_genesis_pro import SESSION, mail, pro, stripe  # noqa: F401
from tests.test_lock import ORIGIN, client, make_client  # noqa: F401
from tests.test_orbyt_review import checkout, pitch, review  # noqa: F401

MAIN = "https://mtrxhorizyn.com"
GENESIS = "https://genesis.mtrxhorizyn.com"
ORBYT = "https://orbyt.mtrxhorizyn.com"


@pytest.fixture
def moved(monkeypatch, make_client):  # noqa: F811
    """The live site's settings, with the switch on."""
    monkeypatch.setenv("MTRX_APP_SUBDOMAINS", "1")
    monkeypatch.setenv("MTRX_PUBLIC_URL", MAIN)
    for name in ("MTRX_GENESIS_HOST", "MTRX_ORBYT_HOST", "MTRX_DEV"):
        monkeypatch.delenv(name, raising=False)
    make_client()  # the database, the knock and the setup code, as for every client

    def at(base):
        from horizon.main import app
        c = TestClient(app, base_url=base, follow_redirects=False)
        c.__enter__()
        return c
    clients = {"main": at(MAIN), "genesis": at(GENESIS), "orbyt": at(ORBYT)}
    yield clients
    for c in clients.values():
        c.__exit__(None, None, None)


def _links(page: str) -> list:
    return re.findall(r'href="([^"]+)"', page)


# ---------------------------------------------------------------- routing on each address

def test_each_app_is_at_the_root_of_its_own_address(moved):
    genesis = moved["genesis"].get("/")
    assert genesis.status_code == 200 and 'id="genesis"' in genesis.text
    orbyt = moved["orbyt"].get("/")
    assert orbyt.status_code == 200 and 'id="vortex"' in orbyt.text
    # HEAD too (uptime monitors), and the shared files and health checks.
    assert moved["genesis"].head("/").status_code == 200
    for c in (moved["genesis"], moved["orbyt"]):
        assert c.get("/healthz").json()["ok"] is True
        assert c.get("/static/css/site.css").status_code == 200
        assert c.get("/robots.txt").text.endswith(f"Sitemap: {MAIN}/sitemap.xml\n")
    # Each one's own API answers there (and the same-site check passes on its own address).
    asked = moved["genesis"].get("/api/genesis/ask")
    assert asked.status_code == 200
    sent = moved["orbyt"].post("/api/vortex/send", json={"kind": "pitch"}, headers={"Origin": ORBYT})
    assert sent.status_code == 400  # checked, not refused as another site's
    assert moved["orbyt"].post("/api/vortex/send", json={"kind": "pitch"}, headers={"Origin": GENESIS}).status_code == 403
    assert moved["orbyt"].post("/api/vortex/send", json={"kind": "pitch"}, headers={"Origin": MAIN}).status_code == 403


def test_the_console_and_other_apis_are_never_on_an_apps_address(moved):
    for c in (moved["genesis"], moved["orbyt"]):
        for path in ("/console", "/console/add/x", "/api/knock", "/api/console/overview", "/genesis-move"):
            answer = c.get(path)
            assert answer.status_code == 404 and "Location" not in answer.headers, path
        assert c.post("/api/knock", json={"taps": []}, headers={"Origin": str(c.base_url)}).status_code in (403, 404)
    # Each app's API only on its own address.
    assert moved["genesis"].get("/api/orbyt/review/checkout").status_code == 404
    assert moved["orbyt"].get("/api/genesis/ask").status_code == 404


def test_other_pages_on_an_apps_address_go_to_the_main_site(moved):
    for c in (moved["genesis"], moved["orbyt"]):
        for path in ("/privacy", "/terms", "/partners", "/early-access?app=rankup"):
            answer = c.get(path)
            assert answer.status_code == 301 and answer.headers["location"] == MAIN + path, path
    # An old-style path on the new address: the page itself, without a reload loop.
    assert moved["genesis"].get("/genesis").headers["location"] == GENESIS + "/"
    assert moved["orbyt"].get("/orbyt/review/thanks").headers["location"] == ORBYT + "/review/thanks"


def test_the_main_site_sends_the_old_addresses_to_the_new_ones(moved):
    main = moved["main"]
    for path, where in (("/genesis", GENESIS + "/"), ("/orbyt", ORBYT + "/"),
                        ("/genesis/pro/welcome?session_id=cs_test_1", GENESIS + "/pro/welcome?session_id=cs_test_1"),
                        ("/orbyt/review/thanks", ORBYT + "/review/thanks"),
                        ("/vortex", ORBYT + "/"), ("/chroma-vortex", ORBYT + "/")):
        answer = main.get(path)
        assert answer.status_code == 301 and answer.headers["location"] == where, path
        # A day, not forever, and the same security headers as every answer.
        assert answer.headers["cache-control"] == "public, max-age=86400"
        assert "frame-ancestors 'none'" in answer.headers["content-security-policy"]
        assert answer.headers["strict-transport-security"] == "max-age=31536000"
    # The rest of the main site stays where it is; its APIs too (old tabs, webhooks).
    assert main.get("/").status_code == 200 and main.get("/privacy").status_code == 200
    assert main.get("/api/genesis/ask").status_code == 200
    # The move page is the one Genesis page left on the main site.
    move = main.get("/genesis-move")
    assert move.status_code == 200 and f'data-genesis="{GENESIS}"' in move.text
    assert move.headers["cache-control"] == "no-store" and move.headers["x-robots-tag"] == "noindex"


def test_while_off_nothing_moves(client, monkeypatch):  # noqa: F811
    monkeypatch.delenv("MTRX_APP_SUBDOMAINS", raising=False)
    assert client.get("/genesis").status_code == 200 and client.get("/orbyt").status_code == 200
    assert client.get("/genesis-move").status_code == 404
    page = client.get("/").text
    assert 'href="/genesis"' in page and 'href="/orbyt"' in page and "genesis.mtrxhorizyn.com" not in page
    genesis = client.get("/genesis").text
    assert 'data-move=""' in genesis and 'data-orbyt="/orbyt"' in genesis
    assert '<link rel="canonical" href="https://testserver/genesis">' in genesis
    # A Host header naming the app's address changes nothing while off.
    from horizon.main import app
    with TestClient(app, base_url=GENESIS, follow_redirects=False) as c:
        assert 'class="hero"' in c.get("/").text


# ---------------------------------------------------------------- links

def test_every_link_to_genesis_and_orbyt_uses_their_own_address(moved):
    for name, path in (("main", "/"), ("main", "/privacy"), ("main", "/terms"), ("main", "/partners"),
                       ("main", "/bundle"), ("main", "/brand"), ("genesis", "/"), ("orbyt", "/")):
        page = moved[name].get(path).text
        links = _links(page)
        assert not [h for h in links if re.match(r"/(genesis|orbyt)\b", h)], (name, path)
        assert any(h.startswith(GENESIS) for h in links) and any(h.startswith(ORBYT) for h in links), (name, path)
    partners = moved["main"].get("/partners").text
    assert f'href="{ORBYT}/#partner' in partners
    home = moved["main"].get("/").text
    assert f'<a class="ready-tile ready-genesis" href="{GENESIS}/">' in home


def test_on_an_apps_address_main_site_links_are_whole_addresses(moved):
    """On genesis.* "/" is Genesis itself, so Home, Privacy and the rest
    must name the main site in full."""
    for name in ("genesis", "orbyt"):
        links = _links(moved[name].get("/").text)
        local = [h for h in links if h.startswith("/") and not h.startswith("/static/")]
        assert local == [], (name, local)
        assert f"{MAIN}/" in links and f"{MAIN}/privacy" in links and f"{MAIN}/terms" in links


def test_pilot_knows_each_address(moved):
    page = moved["genesis"].get("/").text
    assert f'data-genesis="{GENESIS}"' in page and f'data-orbyt="{ORBYT}"' in page and f'data-site="{MAIN}"' in page


def test_the_sitemap_canonical_and_previews_name_the_new_addresses(moved):
    sitemap = moved["main"].get("/sitemap.xml").text
    assert f"<loc>{GENESIS}/</loc>" in sitemap and f"<loc>{ORBYT}/</loc>" in sitemap
    assert f"<loc>{MAIN}/genesis</loc>" not in sitemap and f"<loc>{MAIN}/</loc>" in sitemap
    genesis = moved["genesis"].get("/").text
    assert f'<link rel="canonical" href="{GENESIS}/">' in genesis and f'<meta property="og:url" content="{GENESIS}/">' in genesis
    orbyt = moved["orbyt"].get("/").text
    assert f'<link rel="canonical" href="{ORBYT}/">' in orbyt and f'<meta property="og:url" content="{ORBYT}/">' in orbyt
    # The idea card says where Genesis is, and genesis.* knows where to ask for old projects.
    assert 'data-where="genesis.mtrxhorizyn.com"' in genesis and f'data-move="{MAIN}/genesis-move"' in genesis


# ---------------------------------------------------------------- Stripe

def test_genesis_pro_checkout_returns_to_genesis_own_address(moved, pro):  # noqa: F811
    c = moved["genesis"]
    response = c.post("/api/genesis/pro/checkout", json={"plan": "month"}, headers={"Origin": GENESIS})
    assert response.status_code == 200, response.text
    (call,) = [x for x in pro["stripe"]["calls"] if x["path"] == "/v1/checkout/sessions"]
    assert call["form"]["success_url"] == GENESIS + "/pro/welcome?session_id={CHECKOUT_SESSION_ID}"
    assert call["form"]["cancel_url"] == GENESIS + "#pro"
    # The welcome page is there; the old one on the main site redirects to it with its query.
    assert c.get("/pro/welcome?session_id=cs_x").status_code == 200
    # The key email names the address.
    from horizon import genesis_pro
    assert f"open Genesis at {GENESIS}," in genesis_pro._key_email("GP-AAAA")[1]


def test_pitch_review_checkout_returns_to_orbyt_own_address(moved, review):  # noqa: F811
    c = moved["orbyt"]
    sent = c.post("/api/vortex/send", json=__import__("tests.test_vortex", fromlist=["PITCH"]).PITCH,
                  headers={"Origin": ORBYT})
    assert sent.status_code == 200, sent.text
    ticket = sent.json()["review"]
    response = c.post("/api/orbyt/review/checkout", json={"ticket": ticket, "adult": True}, headers={"Origin": ORBYT})
    assert response.status_code == 200, response.text
    (call,) = [x for x in review["stripe"]["calls"] if x["path"] == "/v1/checkout/sessions"]
    assert call["form"]["success_url"] == ORBYT + "/review/thanks"
    # Cancelling comes back to the Orbyt page itself, where the tab's ticket is
    # (sessionStorage is per address), as #review-cancelled.
    assert call["form"]["cancel_url"] == ORBYT + "#review-cancelled"
    assert c.get("/review/thanks").status_code == 200
    # Stripe's webhook works on the new address and on the old one.
    for x in (c, moved["main"]):
        assert x.post("/api/orbyt/review/stripe", content=b"{}").status_code == 400


# ---------------------------------------------------------------- security

def test_no_cookies_cors_or_broader_rules_on_the_apps_addresses(moved):
    for name in ("genesis", "orbyt"):
        c = moved[name]
        for path in ("/", "/healthz", "/privacy"):
            answer = c.get(path, headers={"Origin": "https://evil.example"})
            assert "set-cookie" not in answer.headers, (name, path)
            assert not any(k.lower().startswith("access-control-") for k in answer.headers), (name, path)
        page = c.get("/")
        csp = page.headers["content-security-policy"]
        assert "default-src 'self'" in csp and "frame-ancestors 'none'" in csp and "form-action 'self'" in csp
        assert page.headers["strict-transport-security"] == "max-age=31536000"  # each address its own, no includeSubDomains
    # The console's cookies still belong only to the exact main address.
    from tests.test_lock import knock
    for line in knock(moved["main"]).headers.get_list("set-cookie"):
        jar = SimpleCookie()
        jar.load(line)
        (_, morsel), = jar.items()
        assert not morsel["domain"]


def test_host_settings_are_checked(monkeypatch):
    from horizon import config
    monkeypatch.setenv("MTRX_GENESIS_HOST", "evil.example/path")
    monkeypatch.setenv("MTRX_ORBYT_HOST", "Orbyt.Example.com")
    s = config.get()
    assert s.genesis_host == "genesis.mtrxhorizyn.com" and s.orbyt_host == "orbyt.example.com"
    monkeypatch.setenv("MTRX_APP_SUBDOMAINS", "yes")
    assert config.get().app_subdomains is False
