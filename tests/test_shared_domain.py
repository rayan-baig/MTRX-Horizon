"""MTRX Horizyn owns the domain; its apps live on subdomains of it.

The site is on the domain itself (and www), and RankUp, CyberLogix and
OmniArmor each on their own subdomain. Each is its own origin, so nothing
the console sets may reach an app, and nothing an app's page does may act
on the console. Two things would break that: a cookie with a Domain (sent
to every subdomain) and trusting a request because it came from the same
site, which every subdomain is.
"""

from http.cookies import SimpleCookie

import pytest

from tests.test_lock import (  # noqa: F401
    ORIGIN, SETUP, Device, client, enroll, knock, make_client, owner)

# The site runs at https://testserver in these tests; these are its siblings.
SIBLINGS = (
    "https://rankup.testserver",
    "https://cyberlogix.testserver",
    "https://omniarmor.testserver",
    "https://www.testserver",
)


def test_no_cookie_reaches_another_subdomain(client):
    """Host-only: no Domain attribute, on every cookie, deletions included.
    The names stay as they are, so nobody already signed in is signed out."""
    headers = []

    def seen(response):
        headers.extend(response.headers.get_list("set-cookie"))
        return response

    device = Device()
    seen(enroll(client, device, SETUP))
    challenge = seen(client.post("/api/unlock/challenge", headers=ORIGIN)).json()["challenge"]
    seen(client.post("/api/unlock", headers=ORIGIN, json={
        "challenge": challenge, "signature": device.sign("mtrx-unlock:" + challenge)}))
    seen(client.post("/api/console/signout", headers=ORIGIN))
    seen(knock(client))

    names = set()
    for line in headers:
        jar = SimpleCookie()
        jar.load(line)
        (name, morsel), = jar.items()
        names.add(name)
        assert not morsel["domain"], line
        assert "domain=" not in line.lower(), line
    assert names == {"mh_d", "mh_s", "mh_k"}


@pytest.mark.parametrize("origin", SIBLINGS)
def test_an_app_on_a_subdomain_cannot_act_on_the_console(client, origin):
    owner(client)
    sibling = {"Origin": origin}
    assert client.post("/api/console/invite", headers=sibling).status_code == 403
    assert client.post("/api/console/signout", headers=sibling).status_code == 403
    assert client.post("/api/knock", json={"taps": ["logo"] * 4}, headers=sibling).status_code == 403
    # The owner's own page still can.
    assert client.post("/api/console/invite", headers=ORIGIN).status_code == 200


@pytest.mark.parametrize("origin", SIBLINGS)
def test_no_sibling_is_granted_cross_origin_reads(client, origin):
    owner(client)
    for path in ("/", "/healthz", "/console", "/api/console/overview"):
        response = client.get(path, headers={"Origin": origin})
        assert "access-control-allow-origin" not in response.headers, path
        assert "access-control-allow-credentials" not in response.headers, path
    preflight = client.options("/api/console/invite", headers={
        "Origin": origin, "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in preflight.headers


def test_pages_cannot_be_framed_by_a_sibling(client):
    assert "frame-ancestors 'none'" in client.get("/").headers["Content-Security-Policy"]


def test_open_app_buttons_go_to_the_app_subdomains(client, monkeypatch):
    for key in ("rankup", "cyberlogix", "omniarmor"):
        monkeypatch.setenv(f"{key.upper()}_URL", f"https://{key}.example.com")
    page = client.get("/").text
    for key in ("rankup", "cyberlogix", "omniarmor"):
        assert f'href="https://{key}.example.com"' in page
