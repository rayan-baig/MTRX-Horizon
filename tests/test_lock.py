"""Tests for the console lock. Each one tries a way in that must fail,
or checks that the owner's own way in works."""

import base64
import time

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from fastapi.testclient import TestClient

KNOCK = ["logo", "logo", "omniarmor", "rankup", "cyberlogix"]
SETUP = "setup-code-that-is-long-enough-123"
ORIGIN = {"Origin": "https://testserver"}


class Device:
    """Plays the part of a browser: a P-256 key and the same signing format."""

    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())

    @property
    def public(self) -> str:
        raw = self.key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        return base64.b64encode(raw).decode()

    def sign(self, message: str) -> str:
        der = self.key.sign(message.encode(), ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        return base64.b64encode(r.to_bytes(32, "big") + s.to_bytes(32, "big")).decode()


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("MTRX_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("MTRX_KNOCK", " ".join(KNOCK))
    monkeypatch.setenv("MTRX_SETUP_TOKEN", SETUP)
    for key in ("RANKUP", "CYBERLOGIX", "OMNIARMOR"):
        monkeypatch.delenv(f"{key}_STATS_URL", raising=False)
    from horizon.main import app

    clients = []

    def make():
        client = TestClient(app, base_url="https://testserver")
        client.__enter__()
        clients.append(client)
        return client

    yield make
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client):
    return make_client()


def knock(client, taps=KNOCK):
    return client.post("/api/knock", json={"taps": taps}, headers=ORIGIN)


def enroll(client, device, token, name="Laptop"):
    return client.post("/api/enroll", headers=ORIGIN, json={
        "token": token, "name": name, "public_key": device.public,
        "signature": device.sign("mtrx-enroll:" + token),
    })


def unlock(client, device):
    challenge = client.post("/api/unlock/challenge", headers=ORIGIN)
    assert challenge.status_code == 200, challenge.text
    c = challenge.json()["challenge"]
    return client.post("/api/unlock", headers=ORIGIN,
                       json={"challenge": c, "signature": device.sign("mtrx-unlock:" + c)})


def owner(client):
    """Set up the first device and sign in. Returns the device."""
    device = Device()
    assert enroll(client, device, SETUP).status_code == 200
    assert unlock(client, device).status_code == 200
    return device


# ---------------------------------------------------------------- hidden by default

def test_console_is_a_plain_404_for_strangers(client):
    console = client.get("/console")
    missing = client.get("/no-such-page")
    assert console.status_code == missing.status_code == 404
    assert console.text == missing.text


def test_console_api_is_404_without_a_session(client):
    assert client.get("/api/console/overview").status_code == 404
    assert client.post("/api/console/invite", headers=ORIGIN).status_code == 404


def test_home_page_never_contains_the_knock(client):
    page = client.get("/").text
    assert " ".join(KNOCK) not in page
    script = client.get("/static/js/knock.js").text
    assert "omniarmor" not in script and "cyberlogix" not in script


# ---------------------------------------------------------------- the knock

def test_right_knock_opens_the_door(client):
    response = knock(client)
    assert response.json() == {"go": "/console"}
    assert "mh_k" in response.cookies


def test_wrong_knock_does_nothing(client):
    assert knock(client, ["logo", "logo", "logo", "logo"]).json() == {"go": None}
    assert knock(client, KNOCK[:-1]).json() == {"go": None}
    assert knock(client, KNOCK + ["logo"]).json() == {"go": None}


def test_knock_alone_is_not_enough(client):
    """An unapproved device that knows the knock still sees 404."""
    knock(client)
    assert client.get("/console").status_code == 404


def test_knock_guessing_is_rate_limited(client):
    for _ in range(8):
        knock(client, ["rankup"] * 5)
    # Even the right knock fails once the limit is hit.
    assert knock(client).json() == {"go": None}


def test_knock_setting_with_a_typo_is_off(monkeypatch):
    from horizon import config
    assert config.parse_knock("logo logo rankupp omniarmor") == ()
    assert config.parse_knock("logo rankup") == ()
    assert config.parse_knock("logo,logo, rankup omniarmor") == ("logo", "logo", "rankup", "omniarmor")


# ---------------------------------------------------------------- approving devices

def test_setup_code_approves_first_device_once(client, make_client):
    first = Device()
    assert enroll(client, first, SETUP).status_code == 200
    other = make_client()
    assert enroll(other, Device(), SETUP).status_code == 400


def test_setup_page_is_404_after_use(client):
    assert client.get(f"/console/add/{SETUP}").status_code == 200
    enroll(client, Device(), SETUP)
    assert client.get(f"/console/add/{SETUP}").status_code == 404


def test_short_setup_code_is_refused(client, monkeypatch):
    monkeypatch.setenv("MTRX_SETUP_TOKEN", "short")
    assert enroll(client, Device(), "short").status_code == 400


def test_enroll_needs_proof_of_the_key(client):
    device, impostor = Device(), Device()
    response = client.post("/api/enroll", headers=ORIGIN, json={
        "token": SETUP, "name": "x", "public_key": device.public,
        "signature": impostor.sign("mtrx-enroll:" + SETUP),
    })
    assert response.status_code == 400


def test_new_device_by_qr_invite(client, make_client):
    owner(client)
    url = client.post("/api/console/invite", headers=ORIGIN).json()["url"]
    token = url.rsplit("/", 1)[1]
    phone_client, phone = make_client(), Device()
    assert phone_client.get(f"/console/add/{token}").status_code == 200
    assert enroll(phone_client, phone, token, "Phone").status_code == 200
    # Approving lets it straight in this once, without knocking.
    assert unlock(phone_client, phone).status_code == 200
    assert phone_client.get("/console").status_code == 200
    # The invite works only once.
    assert enroll(make_client(), Device(), token).status_code == 400


def test_invite_expires(client, make_client, monkeypatch):
    owner(client)
    token = client.post("/api/console/invite", headers=ORIGIN).json()["url"].rsplit("/", 1)[1]
    real = time.time
    monkeypatch.setattr(time, "time", lambda: real() + 11 * 60)
    assert enroll(make_client(), Device(), token).status_code == 400


def test_invite_from_removed_device_is_dead(client, make_client):
    owner(client)
    phone_client, phone = make_client(), Device()
    t1 = client.post("/api/console/invite", headers=ORIGIN).json()["url"].rsplit("/", 1)[1]
    enroll(phone_client, phone, t1, "Phone")
    unlock(phone_client, phone)
    # The phone makes an invite, then the laptop removes the phone.
    t2 = phone_client.post("/api/console/invite", headers=ORIGIN).json()["url"].rsplit("/", 1)[1]
    phone_id = next(d["id"] for d in client.get("/api/console/overview").json()["devices"] if not d["this"])
    assert client.post(f"/api/console/devices/{phone_id}/remove", headers=ORIGIN).status_code == 200
    assert enroll(make_client(), Device(), t2).status_code == 400


# ---------------------------------------------------------------- signing in

def test_full_owner_flow(client):
    owner(client)
    page = client.get("/console")
    assert page.status_code == 200 and "Control Console" in page.text
    data = client.get("/api/console/overview").json()
    assert len(data["devices"]) == 1 and data["devices"][0]["this"]
    assert all(app["connected"] is False and app["users"] is None for app in data["apps"])


def test_returning_device_needs_the_knock(client):
    device = owner(client)
    client.post("/api/console/signout", headers=ORIGIN)
    assert client.get("/console").status_code == 404
    knock(client)
    assert client.get("/console").status_code == 200  # the unlock page
    assert unlock(client, device).status_code == 200


def test_copied_device_cookie_without_the_key_fails(client, make_client):
    owner(client)
    thief = make_client()
    thief.cookies.set("mh_d", client.cookies.get("mh_d"))
    knock(thief)
    assert thief.get("/console").status_code == 200  # reaches the unlock page...
    challenge = thief.post("/api/unlock/challenge", headers=ORIGIN).json()["challenge"]
    response = thief.post("/api/unlock", headers=ORIGIN, json={
        "challenge": challenge, "signature": Device().sign("mtrx-unlock:" + challenge)})
    assert response.status_code == 403  # ...but can't sign as the device
    assert thief.get("/api/console/overview").status_code == 404


def test_challenge_cannot_be_reused(client):
    device = owner(client)
    client.post("/api/console/signout", headers=ORIGIN)
    knock(client)
    c = client.post("/api/unlock/challenge", headers=ORIGIN).json()["challenge"]
    sig = device.sign("mtrx-unlock:" + c)
    assert client.post("/api/unlock", headers=ORIGIN, json={"challenge": c, "signature": sig}).status_code == 200
    knock(client)
    again = client.post("/api/unlock", headers=ORIGIN, json={"challenge": c, "signature": sig})
    assert again.status_code == 403


def test_session_only_works_on_its_own_device(client, make_client):
    owner(client)
    thief = make_client()
    thief.cookies.set("mh_s", client.cookies.get("mh_s"))
    assert thief.get("/api/console/overview").status_code == 404


def test_removed_device_is_signed_out_at_once(client, make_client):
    owner(client)
    phone_client, phone = make_client(), Device()
    token = client.post("/api/console/invite", headers=ORIGIN).json()["url"].rsplit("/", 1)[1]
    enroll(phone_client, phone, token, "Phone")
    unlock(phone_client, phone)
    phone_id = next(d["id"] for d in client.get("/api/console/overview").json()["devices"] if not d["this"])
    client.post(f"/api/console/devices/{phone_id}/remove", headers=ORIGIN)
    assert phone_client.get("/api/console/overview").status_code == 404
    knock(phone_client)
    assert phone_client.get("/console").status_code == 404


def test_cannot_remove_the_device_in_use(client):
    owner(client)
    me = client.get("/api/console/overview").json()["devices"][0]["id"]
    assert client.post(f"/api/console/devices/{me}/remove", headers=ORIGIN).status_code == 400


def test_new_setup_code_is_the_way_back_in(client, make_client, monkeypatch):
    """Every device lost: set a new setup code in the hosting settings."""
    owner(client)
    monkeypatch.setenv("MTRX_SETUP_TOKEN", "a-brand-new-recovery-code-456")
    rescued = make_client()
    assert enroll(rescued, Device(), "a-brand-new-recovery-code-456").status_code == 200


# ---------------------------------------------------------------- other sites

def test_posts_from_other_sites_are_refused(client):
    owner(client)
    evil = {"Origin": "https://evil.example"}
    assert client.post("/api/console/invite", headers=evil).status_code == 403
    assert client.post("/api/console/invite").status_code == 403  # no origin at all
    assert client.post("/api/knock", json={"taps": KNOCK}, headers=evil).status_code == 403


def test_cookies_are_locked_down(client):
    response = knock(client)
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "secure" in cookie


def test_security_headers(client):
    headers = client.get("/").headers
    assert "frame-ancestors 'none'" in headers["content-security-policy"]
    assert headers["x-content-type-options"] == "nosniff"
    assert client.get("/console").headers["cache-control"] == "no-store"


def test_session_cannot_move_to_another_approved_device(client, make_client):
    owner(client)
    phone_client, phone = make_client(), Device()
    token = client.post("/api/console/invite", headers=ORIGIN).json()["url"].rsplit("/", 1)[1]
    enroll(phone_client, phone, token, "Phone")
    # The phone is approved but not signed in. Hand it the laptop's session.
    phone_client.cookies.set("mh_s", client.cookies.get("mh_s"))
    assert phone_client.get("/api/console/overview").status_code == 404
