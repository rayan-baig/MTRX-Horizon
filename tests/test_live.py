"""The owner's way in, against the real server.

The other tests use FastAPI's test client, whose address is the name
"testclient", not an IP, so a mistake in how real addresses are handled
(one already shipped once: every IPv4 visitor got a server error) cannot
show up there. These start uvicorn the way the Dockerfile does and talk to
it over real sockets, from 127.0.0.1 and from ::1.

A computer without IPv6 skips the ::1 run. CI sets MTRX_REQUIRE_IPV6=1, so
there it fails instead of quietly skipping.
"""

import os
import socket
import sqlite3
import subprocess
import sys
import time
from http.cookies import SimpleCookie
from pathlib import Path

import httpx
import pytest

from tests.test_lock import KNOCK, SETUP, Device

ROOT = Path(__file__).resolve().parent.parent
NEW_SETUP = "a-new-setup-code-for-a-fresh-start-789"


def _can_listen(host: str) -> bool:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    try:
        with socket.socket(family) as s:
            s.bind((host, 0))
        return True
    except OSError:
        return False


def _free_port(host: str) -> int:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


class Server:
    """uvicorn in its own process, started like the Dockerfile starts it."""

    def __init__(self, host: str, db_path: Path, log_path: Path, setup: str | None):
        self.host = host
        self.port = _free_port(host)
        shown = f"[{host}]" if ":" in host else host
        self.url = f"http://{shown}:{self.port}"
        self.db_path = db_path
        env = {k: v for k, v in os.environ.items()
               if not k.startswith("MTRX_") and not k.endswith("_URL")}
        # Plain http on the computer, as in the README's "Running it" steps.
        env.update(MTRX_DB_PATH=str(db_path), MTRX_KNOCK=" ".join(KNOCK), MTRX_DEV="1")
        if setup is not None:
            env["MTRX_SETUP_TOKEN"] = setup
        self.log_path = log_path
        self.log = open(log_path, "a")
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "horizon.main:app", "--host", host,
             "--port", str(self.port), "--no-proxy-headers"],
            cwd=ROOT, env=env, stdout=self.log, stderr=subprocess.STDOUT,
        )
        deadline = time.monotonic() + 20
        with httpx.Client(trust_env=False, timeout=2) as http:
            while True:
                try:
                    if http.get(self.url + "/healthz").status_code == 200:
                        return
                except httpx.TransportError:
                    pass
                if self.proc.poll() is not None or time.monotonic() > deadline:
                    self.stop()
                    raise AssertionError("the server did not start:\n" + log_path.read_text())
                time.sleep(0.05)

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        self.log.close()

    def tries_counted_for(self) -> list[str]:
        with sqlite3.connect(self.db_path) as conn:
            return [row[0] for row in conn.execute("SELECT DISTINCT who FROM attempts")]


@pytest.fixture
def start(tmp_path):
    servers = []

    def run(host="127.0.0.1", setup=SETUP):
        if servers:
            servers[-1].stop()  # a restart: the same database, a new process
        server = Server(host, tmp_path / "horizon.db", tmp_path / "server.log", setup)
        servers.append(server)
        return server

    yield run
    for server in servers:
        server.stop()
    log = (tmp_path / "server.log").read_text() if (tmp_path / "server.log").exists() else ""
    # Nothing crashed, and no one-time code reached the log.
    assert "Traceback" not in log and " 500" not in log, log
    assert "/console/add/" not in log, log


class Browser:
    """One browser: its own cookies, and the Origin header a page's fetch sends."""

    def __init__(self, server: Server):
        self.base = server.url
        self.cookies: dict[str, str] = {}
        # Every cookie value and puzzle this browser was given, to look for
        # in the server's log afterwards.
        self.secrets: set[str] = set()
        self.http = httpx.Client(base_url=server.url, trust_env=False, timeout=10)

    def _send(self, method, path, body=None):
        headers = {}
        if self.cookies:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        if method != "GET":
            headers["Origin"] = self.base
        response = self.http.request(method, path, json=body, headers=headers)
        self.http.cookies.clear()  # this class keeps the cookies itself
        for line in response.headers.get_list("set-cookie"):
            jar = SimpleCookie()
            jar.load(line)
            for name, morsel in jar.items():
                if morsel["max-age"] == "0" or not morsel.value:
                    self.cookies.pop(name, None)
                else:
                    assert morsel["httponly"] and morsel["samesite"].lower() == "strict", line
                    self.cookies[name] = morsel.value
                    self.secrets.add(morsel.value)
        return response

    def get(self, path):
        return self._send("GET", path)

    def post(self, path, body=None):
        return self._send("POST", path, body)

    def knock(self):
        return self.post("/api/knock", {"taps": KNOCK}).json()

    def approve(self, device, token, name):
        return self.post("/api/enroll", {
            "token": token, "name": name, "public_key": device.public,
            "signature": device.sign("mtrx-enroll:" + token),
        })

    def unlock(self, device):
        challenge = self.post("/api/unlock/challenge")
        assert challenge.status_code == 200, challenge.text
        c = challenge.json()["challenge"]
        self.secrets.add(c)
        return self.post("/api/unlock", {"challenge": c,
                                         "signature": device.sign("mtrx-unlock:" + c)})

    def devices(self):
        response = self.get("/api/console/overview")
        assert response.status_code == 200, response.text
        return response.json()["devices"]


def _ipv6_or_skip():
    if not _can_listen("::1"):
        if os.environ.get("MTRX_REQUIRE_IPV6") == "1":
            pytest.fail("::1 is not available, and MTRX_REQUIRE_IPV6=1 says it must be")
        pytest.skip("this computer has no IPv6 loopback")


@pytest.mark.parametrize("host, counted_as", [
    pytest.param("127.0.0.1", "127.0.0.1", id="ipv4"),
    pytest.param("::1", "::/64", id="ipv6"),
])
def test_the_whole_owner_flow_from_a_real_address(start, host, counted_as):
    if ":" in host:
        _ipv6_or_skip()
    server = start(host)
    laptop = Browser(server)

    # The home page, and a knock from a device that is not approved yet.
    assert laptop.get("/").status_code == 200
    assert laptop.knock() == {"go": None}
    assert laptop.get("/console").status_code == 404

    # A wrong code costs a try, counted against this real address.
    assert laptop.get("/console/add/not-the-setup-code").status_code == 404
    assert server.tries_counted_for() == [counted_as]

    # Approve with the setup code; the device is let straight in this once.
    assert laptop.get(f"/console/add/{SETUP}").status_code == 200
    key = Device()
    approved = laptop.approve(key, SETUP, "Laptop")
    assert approved.status_code == 200 and approved.json() == {"go": "/console"}
    assert {"mh_d", "mh_k"} <= laptop.cookies.keys()
    door = laptop.get("/console")
    assert door.status_code == 200 and "Checking this device" in door.text
    assert laptop.get("/console/assets/unlock.js").status_code == 200

    # Unlock: the console and its numbers.
    assert laptop.unlock(key).status_code == 200
    assert "mh_s" in laptop.cookies and "mh_k" not in laptop.cookies
    page = laptop.get("/console")
    assert page.status_code == 200 and "Control Console" in page.text
    assert laptop.get("/console/assets/console.js").status_code == 200
    overview = laptop.get("/api/console/overview")
    assert overview.status_code == 200
    assert {"apps", "server", "history", "activity", "devices"} <= overview.json().keys()
    assert [d["this"] for d in overview.json()["devices"]] == [True]

    # A QR code approves a second device.
    invite = laptop.post("/api/console/invite")
    assert invite.status_code == 200
    url = invite.json()["url"]
    assert url.startswith(server.url + "/console/add/")
    assert invite.json()["qr"].startswith("data:image/svg+xml;base64,")
    token = url.rsplit("/", 1)[1]
    phone, phone_key = Browser(server), Device()
    assert phone.get(f"/console/add/{token}").status_code == 200
    assert phone.approve(phone_key, token, "Phone").status_code == 200
    assert phone.unlock(phone_key).status_code == 200
    assert phone.get("/console").status_code == 200
    assert len(laptop.devices()) == 2

    # Remove it: it is locked out at once, knock or no knock.
    phone_id = next(d["id"] for d in laptop.devices() if not d["this"])
    assert laptop.post(f"/api/console/devices/{phone_id}/remove").json() == {"ok": True}
    assert phone.get("/api/console/overview").status_code == 404
    assert phone.knock() == {"go": None}
    assert phone.get("/console").status_code == 404
    assert len(laptop.devices()) == 1

    # Sign out: the console is a missing page again.
    assert laptop.post("/api/console/signout").json() == {"go": "/"}
    assert "mh_s" not in laptop.cookies
    assert laptop.get("/console").status_code == 404
    assert laptop.get("/api/console/overview").status_code == 404

    # The next day: knock, unlock, console.
    assert laptop.knock() == {"go": "/console"}
    assert laptop.get("/console").status_code == 200
    assert laptop.unlock(key).status_code == 200
    assert laptop.get("/console").status_code == 200
    assert laptop.post("/api/console/signout").status_code == 200

    # The server's log (uvicorn's access lines and the site's own) holds no
    # code, cookie, device id or puzzle from any of that.
    server.stop()
    log = server.log_path.read_text()
    assert '"GET / HTTP/1.1" 200' in log  # the access log was on
    secrets = laptop.secrets | phone.secrets | {SETUP, token}
    assert len(secrets) >= 8
    for secret in secrets:
        assert secret not in log, (secret, log)


def test_setup_code_stays_used_after_a_restart_and_a_new_one_works_once(start):
    server = start(setup=SETUP)
    assert Browser(server).approve(Device(), SETUP, "Laptop").status_code == 200

    # The same database, a new process: the code is still used up.
    server = start(setup=SETUP)
    stranger = Browser(server)
    assert stranger.get(f"/console/add/{SETUP}").status_code == 404
    assert stranger.approve(Device(), SETUP, "Stranger").status_code == 404

    # The setting changed to a new code: the new one works once, the old one never.
    server = start(setup=NEW_SETUP)
    fresh = Browser(server)
    assert fresh.get(f"/console/add/{SETUP}").status_code == 404
    assert fresh.get(f"/console/add/{NEW_SETUP}").status_code == 200
    assert fresh.approve(Device(), NEW_SETUP, "Fresh").status_code == 200
    second = Browser(server)
    assert second.get(f"/console/add/{NEW_SETUP}").status_code == 404
    assert second.approve(Device(), NEW_SETUP, "Second").status_code == 404

    # And it stays used after the next restart too.
    server = start(setup=NEW_SETUP)
    assert Browser(server).approve(Device(), NEW_SETUP, "Again").status_code == 404


def test_every_device_lost_the_readme_way_back_in(start):
    """The README: put a new MTRX_SETUP_TOKEN in the hosting settings, open
    /console/add/<it> and approve the device; then remove the lost devices
    and delete the setting again."""
    server = start(setup=SETUP)
    laptop, laptop_key = Browser(server), Device()
    assert laptop.approve(laptop_key, SETUP, "Lost laptop").status_code == 200
    assert laptop.unlock(laptop_key).status_code == 200
    token = laptop.post("/api/console/invite").json()["url"].rsplit("/", 1)[1]
    assert Browser(server).approve(Device(), token, "Lost phone").status_code == 200

    # Both are lost. The host restarts the site with the new setting.
    server = start(setup=NEW_SETUP)
    rescued, key = Browser(server), Device()
    assert rescued.get(f"/console/add/{NEW_SETUP}").status_code == 200
    assert rescued.approve(key, NEW_SETUP, "New laptop").status_code == 200
    assert rescued.unlock(key).status_code == 200
    assert rescued.get("/console").status_code == 200
    lost = [d for d in rescued.devices() if not d["this"]]
    assert sorted(d["name"] for d in lost) == ["Lost laptop", "Lost phone"]
    for d in lost:
        assert rescued.post(f"/api/console/devices/{d['id']}/remove").json() == {"ok": True}
    assert [d["name"] for d in rescued.devices()] == ["New laptop"]

    # The setting deleted again: no code works, and the owner is still in,
    # and gets back in with the knock.
    server = start(setup=None)
    assert Browser(server).get(f"/console/add/{NEW_SETUP}").status_code == 404
    rescued = _moved(rescued, server)
    assert rescued.get("/console").status_code == 200
    assert rescued.post("/api/console/signout").status_code == 200
    assert rescued.knock() == {"go": "/console"}
    assert rescued.unlock(key).status_code == 200
    assert rescued.get("/console").status_code == 200


def _moved(browser: Browser, server: Server) -> Browser:
    """The same browser after a restart: the site's port is new on each run."""
    again = Browser(server)
    again.cookies = dict(browser.cookies)
    return again
