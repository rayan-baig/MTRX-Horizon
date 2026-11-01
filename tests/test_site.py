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
    # The figures in the design were examples, and stay examples.
    for fake in ("4.3M", "12,482,391", "$2.8M", "99.98%", "4,327,981", "1,248,392",
                 "2.4 TB/s", "18.7%"):
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


def test_robots_does_not_point_at_the_console(client):
    # Listing /console under Disallow told every visitor where to look.
    assert "console" not in client.get("/robots.txt").text


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
    assert "RankUp opens to the public soon." in home  # RankUp was not given
    assert "knock.js" not in home and "<html" not in home
    # The home page's own script goes along; the lock's never does.
    assert sorted(p.name for p in (out / "static" / "js").iterdir()) == ["home.js"]
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


def test_home_page_is_one_screen(client):
    """The owner wants the home page on one screen with no scrolling: it is
    all inside the .page frame, which is the height of the window, and the
    Learn more lists open over the page rather than making it longer."""
    page = client.get("/").text
    assert '<div class="page">' in page
    # Every pop-up is outside the frame, so opening one cannot move it.
    frame_html = page.split('<div class="page">', 1)[1].split('<section class="sheet', 1)[0]
    assert 'class="sheet' not in frame_html
    for sheet in ("projects", "team", "settings", "updates", "menu", "tour"):
        assert f'<section class="sheet' in page and f'id="{sheet}"' in page
    css = open("static/css/site.css", encoding="utf-8").read()
    frame = css.split(".page {", 1)[1].split("}", 1)[0]
    assert "height: 100dvh" in frame and "overflow: hidden" in frame


def test_home_page_numbers_are_real_or_say_they_are_coming(client):
    page = client.get("/").text
    assert "Live numbers appear here as soon as the apps launch." in page
    assert "Soon" in page


def test_home_page_shows_what_the_apps_reported(client, monkeypatch):
    """Once an app has reported, its own numbers are what the page shows."""
    import time
    from horizon import db

    # The numbers only count while the app is connected.
    monkeypatch.setenv("RANKUP_STATS_URL", "http://127.0.0.1:9/stats")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO app_snapshots (app, at, online, users, active_users)"
            " VALUES (?, ?, ?, ?, ?)", ("rankup", time.time(), 1, 1234, 56))
    page = client.get("/").text
    assert "1,234" in page and ">56<" in page and "1 / 3" in page
    assert "Live numbers appear here" not in page


def test_projects_on_the_home_page_are_the_real_list(client):
    from horizon import stats

    page = client.get("/").text
    for project in stats.PROJECTS:
        assert project["next"] in page


def test_each_app_has_open_and_learn_more(client, monkeypatch):
    monkeypatch.setenv("CYBERLOGIX_URL", "https://cyberlogix.example")
    page = client.get("/").text
    for key in ("rankup", "cyberlogix", "omniarmor"):
        assert f'href="#learn-{key}"' in page and f'id="learn-{key}"' in page
    # An app with an address opens; one without says it is coming.
    assert 'aria-label="Open CyberLogix AI"' in page and "https://cyberlogix.example" in page
    assert 'aria-label="Open RankUp"' not in page and "RankUp opens to the public soon." in page


@pytest.fixture
def slow_server():
    """An app that answers, but a byte at a time: up, yet very slow."""
    from http.server import ThreadingHTTPServer
    import time as _time

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b'{"users": 1, "active_users": 1}' + b" " * 20
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                for i in range(len(body)):
                    self.wfile.write(body[i:i + 1])
                    self.wfile.flush()
                    _time.sleep(0.3)
            except OSError:
                pass

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/stats"
    server.shutdown()


def test_a_slow_app_cannot_hold_up_the_console(client, monkeypatch, slow_server):
    """The time limit on an app's stats used to be per read, not for the
    whole answer, so an app sending a byte every so often held the console
    for as long as it liked (here 15 seconds)."""
    import time
    from horizon import stats

    monkeypatch.setattr(stats, "FETCH_SECONDS", 1)
    monkeypatch.setenv("RANKUP_STATS_URL", slow_server)
    owner(client)
    started = time.monotonic()
    data = client.get("/api/console/overview").json()
    assert time.monotonic() - started < 4
    rankup = next(a for a in data["apps"] if a["key"] == "rankup")
    assert rankup["connected"] is True and rankup["online"] is False


def test_an_impossible_number_from_an_app_does_not_break_the_console(client, monkeypatch, stats_server):
    """A count too big for the database made saving the snapshot fail, so
    the whole console failed to load ("Couldn't refresh") for as long as
    the app kept sending it, and the home page's numbers stopped updating."""
    url, answers = stats_server
    answers["body"] = {"users": 10 ** 20, "active_users": 3}
    monkeypatch.setenv("RANKUP_STATS_URL", url)
    owner(client)
    response = client.get("/api/console/overview")
    assert response.status_code == 200
    rankup = next(a for a in response.json()["apps"] if a["key"] == "rankup")
    assert rankup["online"] is True and rankup["users"] is None and rankup["active_users"] == 3


def test_home_page_starts_no_refresh_when_no_app_is_connected(client, monkeypatch):
    """The check for "no app connected" looked at a list that always has
    all three apps in it, so it never stopped anything: with nothing
    connected nothing was ever saved, and every visit to the home page
    started another background fetch."""
    from horizon import stats

    started = []
    real_thread = threading.Thread
    monkeypatch.setattr(stats.threading, "Thread",
                        lambda *a, **k: started.append(k) or real_thread(*a, **k))
    for _ in range(3):
        assert client.get("/").status_code == 200
    ours = [k for k in started
            if getattr(k.get("target"), "__qualname__", "").startswith("refresh_in_background")]
    assert ours == []


def test_active_users_on_the_home_page_are_the_active_ones(client, monkeypatch):
    """The "Active Users" figure showed the total number of users, so with
    1,234 users of whom 56 were active, the page said 1,234 were active."""
    import time
    from horizon import db

    # The numbers only count while the app is connected.
    monkeypatch.setenv("RANKUP_STATS_URL", "http://127.0.0.1:9/stats")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO app_snapshots (app, at, online, users, active_users)"
            " VALUES (?, ?, ?, ?, ?)", ("rankup", time.time(), 1, 1234, 56))
    page = client.get("/").text
    fact = page.split("<dt>Active Users</dt>", 1)[1].split("</div>", 1)[0]
    assert "56" in fact and "1,234" not in fact


def test_uptime_checks_that_ask_with_head_see_the_site_up(client):
    """Many uptime monitors ask with HEAD rather than GET. The home page and
    /healthz only answered GET, so a HEAD got "page not found" and the
    monitor reported a working site as down."""
    for path in ("/", "/healthz", "/robots.txt"):
        response = client.head(path)
        assert response.status_code == 200, path
        assert response.content == b""
    # Hidden pages stay hidden whatever the method.
    assert client.head("/console").status_code == 404


def test_server_running_for_is_this_process_not_the_host(monkeypatch):
    """/proc/uptime is the host's uptime; the console means this site's."""
    from horizon import stats

    monkeypatch.setattr(stats, "_STARTED", stats.time.monotonic() - 90)
    assert 90 <= stats.server()["uptime"] < 100


def test_a_disconnected_app_drops_off_the_home_page(client, monkeypatch, stats_server):
    """Taking an app's stats address away used to leave its old numbers up for good."""
    from horizon import stats

    url, _ = stats_server
    monkeypatch.setenv("RANKUP_STATS_URL", url)
    owner(client)
    client.get("/api/console/overview")  # saves a snapshot
    assert stats.public_numbers()["total_users"] == 120

    monkeypatch.delenv("RANKUP_STATS_URL")
    numbers = stats.public_numbers()
    assert numbers["total_users"] is None
    assert numbers["apps_online"] is None
    assert numbers["uptime"] is None


def test_a_mistyped_stats_address_does_not_break_the_console(client, monkeypatch, stats_server):
    """A stats address without its https:// (an easy slip in the hosting
    settings) made building the request fail before any error was caught,
    so the whole console failed to load for as long as the setting stayed."""
    url, _ = stats_server
    monkeypatch.setenv("RANKUP_STATS_URL", "rankup.example/api/stats")
    monkeypatch.setenv("CYBERLOGIX_STATS_URL", "file:///etc/hostname")
    monkeypatch.setenv("OMNIARMOR_STATS_URL", url)
    owner(client)
    response = client.get("/api/console/overview")
    assert response.status_code == 200
    apps = {a["key"]: a for a in response.json()["apps"]}
    assert apps["rankup"]["connected"] is True and apps["rankup"]["online"] is False
    assert apps["cyberlogix"]["online"] is False
    # The other apps still report.
    assert apps["omniarmor"]["online"] is True and apps["omniarmor"]["users"] == 120
