"""Tests for the public site and the console's numbers."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from tests.test_lock import ORIGIN, make_client, client, owner  # noqa: F401


def test_home_page_shows_all_three_apps(client):
    page = client.get("/").text
    for name in ("RankUp", "CyberLogix AI", "OmniArmor.ai", "One Vision."):
        assert name in page


def test_home_page_has_no_made_up_numbers(client):
    page = client.get("/").text
    for fake in ("4.3M", "12,482,391", "$2.8M", "99.98%"):
        assert fake not in page


def test_home_page_has_no_inline_styles_or_scripts(client):
    """The security policy blocks inline styles and scripts, so any that
    sneak in would silently not work."""
    for path in ("/", "/console/add/x", "/no-such-page"):
        page = client.get(path).text
        assert 'style="' not in page and "<script>" not in page


def test_open_app_button_only_when_a_url_is_set(client, monkeypatch):
    assert "Open RankUp" not in client.get("/").text
    monkeypatch.setenv("RANKUP_URL", "https://rankup.example")
    page = client.get("/").text
    assert "Open RankUp" in page and "https://rankup.example" in page


def test_robots_hides_the_console(client):
    assert "Disallow: /console" in client.get("/robots.txt").text


@pytest.fixture
def stats_server():
    answers = {"body": {"users": 120, "active_users": 30}}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            answers["auth"] = self.headers.get("Authorization")
            body = json.dumps(answers["body"]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/stats", answers
    server.shutdown()


def test_connected_app_shows_real_numbers(client, monkeypatch, stats_server):
    url, answers = stats_server
    monkeypatch.setenv("RANKUP_STATS_URL", url)
    monkeypatch.setenv("MTRX_STATS_KEY", "shared-secret")
    owner(client)
    data = client.get("/api/console/overview").json()
    rankup = next(a for a in data["apps"] if a["key"] == "rankup")
    assert rankup["online"] is True and rankup["users"] == 120
    assert answers["auth"] == "Bearer shared-secret"
    assert data["history"]["rankup"]["uptime"] == 100.0
    other = next(a for a in data["apps"] if a["key"] == "omniarmor")
    assert other["connected"] is False and other["users"] is None


def test_bad_numbers_from_an_app_are_ignored(client, monkeypatch, stats_server):
    url, answers = stats_server
    answers["body"] = {"users": "lots", "active_users": -5}
    monkeypatch.setenv("CYBERLOGIX_STATS_URL", url)
    owner(client)
    app = next(a for a in client.get("/api/console/overview").json()["apps"] if a["key"] == "cyberlogix")
    assert app["online"] is True and app["users"] is None and app["active_users"] is None


def test_app_that_is_down_says_so(client, monkeypatch):
    monkeypatch.setenv("OMNIARMOR_STATS_URL", "http://127.0.0.1:9/stats")
    owner(client)
    app = next(a for a in client.get("/api/console/overview").json()["apps"] if a["key"] == "omniarmor")
    assert app["connected"] is True and app["online"] is False


def test_demo_build_links_each_app_and_leaves_out_the_knock(tmp_path, monkeypatch):
    """The demo builder copies each app's own demo and never ships the lock."""
    import sys
    monkeypatch.syspath_prepend("tools")
    import build_demo

    clx = tmp_path / "clx" / "docs"
    clx.mkdir(parents=True)
    (clx / "index.html").write_text('<title>x</title><a href="/legal">t</a>')
    (clx / "console.html").write_text("<title>y</title>")
    omni = tmp_path / "omni" / "dashboard"
    omni.mkdir(parents=True)
    (omni / "index.html").write_text("<title>z</title>")
    out = tmp_path / "out"
    monkeypatch.setattr(sys, "argv", ["build_demo", "--out", str(out),
                                      "--cyberlogix", str(clx.parent),
                                      "--omniarmor", str(omni.parent)])
    build_demo.main()

    home = (out / "index.html").read_text()
    assert 'href="cyberlogix/index.html"' in home and 'href="omniarmor/index.html"' in home
    assert "Demo coming soon" in home  # RankUp was not given
    assert "knock.js" not in home and "<html" not in home
    assert not (out / "static" / "js").exists()
    page = (out / "cyberlogix" / "index.html").read_text()
    assert page.startswith("<!doctype html>") and "MTRX Horizon</a>" in page
    assert 'href="/legal"' not in page


def test_demo_reads_rankup_themes_as_text(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend("tools")
    import build_demo

    data = tmp_path / "src" / "data"
    data.mkdir(parents=True)
    (data / "kidThemes.js").write_text(
        "export const KID_THEMES = [\n"
        "  {\n    id: 'one',\n    name: 'One',\n    currency: { name: 'Coins', icon: '🪙' },\n"
        "    colors: { bg: '#000000', accent: '#ff0000' },\n  },\n"
        "  {\n    id: 'two',\n    name: 'Two',\n    currency: { name: 'Gems', icon: '💎' },\n"
        "    colors: { bg: '#111111', accent: '#00ff00' },\n  },\n]\n")
    themes = build_demo.rankup_themes(tmp_path)
    assert [t["id"] for t in themes] == ["one", "two"]
    assert themes[1] == {"id": "two", "name": "Two", "icon": "💎", "bg": "#111111", "accent": "#00ff00"}
