"""The parts around the engine: the local service the browser extension uses,
the policy file, alerts not repeating, and the security team's event log."""

import json
import time
import urllib.error
import urllib.request

import pytest

from omnicyte import policy as policy_mod, server
from omnicyte.core import Guardian
from omnicyte.engine import Message


@pytest.fixture
def running(omnicyte_home):
    g = Guardian()
    httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(g, policy_mod.token()))
    import threading
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield g, f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def call(base, path, body=None, token=None, origin="chrome-extension://abcdef"):
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["X-Omnicyte-Token"] = token
    if origin:
        headers["Origin"] = origin
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers=headers, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read()), r.headers
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), e.headers


def test_needs_the_pairing_code(running):
    _, base = running
    assert call(base, "/v1/status")[0] == 403
    assert call(base, "/v1/status", token="wrong")[0] == 403
    status, body, headers = call(base, "/v1/status", token=policy_mod.token())
    assert status == 200 and body["ok"]
    assert headers["Access-Control-Allow-Origin"] == "chrome-extension://abcdef"


def test_web_pages_cant_ask_even_with_the_code(running):
    _, base = running
    status, _, headers = call(base, "/v1/status", token=policy_mod.token(), origin="https://evil.example")
    assert status == 403
    assert "Access-Control-Allow-Origin" not in headers


def test_links_and_a_buddy_alert_from_webmail(running):
    g, base = running
    status, body, _ = call(base, "/v1/links", {"site": "mail.google.com", "kind": "mail", "links": [
        {"href": "https://micros0ft-login.xyz/verify", "text": "Sign in"},
        {"href": "https://github.com", "text": "GitHub"}]}, token=policy_mod.token())
    assert status == 200
    assert body["links"]["https://micros0ft-login.xyz/verify"]["level"] == "danger"
    assert body["links"]["https://github.com"]["level"] == "safe"
    alert = g.alerts.get_nowait()
    assert alert.source == "mail" and alert.where == "mail.google.com"


def test_ordinary_pages_dont_pop_the_buddy_for_every_link(running):
    g, base = running
    call(base, "/v1/links", {"site": "news.example", "links": [{"href": "https://paypa1.top/x", "text": ""}]},
         token=policy_mod.token())
    assert g.alerts.empty()


def test_fake_login_page(running):
    g, base = running
    status, body, _ = call(base, "/v1/page", {"url": "https://office365-login.top/owa/", "password_field": True},
                           token=policy_mod.token())
    assert body["level"] == "danger"
    assert "page-password" in {s["code"] for s in body["signals"]}
    assert not g.alerts.empty()


def test_big_or_bad_bodies(running):
    _, base = running
    req = urllib.request.Request(base + "/v1/links", data=b"not json", method="POST",
                                 headers={"X-Omnicyte-Token": policy_mod.token()})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req, timeout=5)
    assert e.value.code == 400


def test_alerts_dont_repeat_and_go_to_the_log(omnicyte_home):
    g = Guardian()
    phish = Message(source="mail", sender_address="a@micros0ft.top", subject="Verify",
                    text="Verify your account now: https://micros0ft.top/login")
    g.see(phish)
    g.see(phish)
    assert g.alerts.qsize() == 1
    lines = g.policy.events_path.read_text().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["level"] == "danger" and entry["link_host"] == "micros0ft.top"
    assert entry["sender_domain"] == "micros0ft.top"
    # The log never holds the message itself.
    assert "Verify your account" not in lines[0] and "/login" not in lines[0]


def test_pause(omnicyte_home):
    policy_mod.save_user(paused_until=time.time() + 60)
    g = Guardian()
    g.see(Message(text="https://micros0ft.top/login"))
    assert g.alerts.empty()


def test_policy_file(omnicyte_home):
    (omnicyte_home / "policy.json").write_text(json.dumps({
        "org_name": "Acme", "org_domains": ["https://Acme.com/", "acme.co.uk"], "allow_user_trust": False,
        "clipboard_watch": True, "report_to": "security@acme.com"}))
    policy_mod.save_user(trusted_domains=["sketchy.example"], clipboard_watch=False)
    p = policy_mod.load()
    assert p.org_domains == ["acme.com", "acme.co.uk"]
    assert p.trusted_domains == []          # the policy doesn't let people add their own
    assert p.clipboard_watch is False       # but they may turn the clipboard watch off
    assert policy_mod.trust_domain("x.example") is False


def test_people_can_trust_a_site_when_allowed(omnicyte_home):
    assert policy_mod.trust_domain("vendor-portal.example")
    assert "vendor-portal.example" in policy_mod.load().trusted_domains


def test_token_is_stable_and_private(omnicyte_home):
    a = policy_mod.token()
    assert a == policy_mod.token() and len(a) >= 24
    path = policy_mod.home() / "token"
    assert oct(path.stat().st_mode & 0o777) == "0o600"
