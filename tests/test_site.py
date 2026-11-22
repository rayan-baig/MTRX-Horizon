"""Tests for the public site and the console's numbers."""

import json
import re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from tests.test_lock import ORIGIN, make_client, client, owner  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent


def test_home_page_shows_all_three_apps(client):
    page = client.get("/").text
    for name in ("RankUp", "CyberLogix AI", "OmniArmor.ai", "Three apps that watch,"):
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
    monkeypatch.setenv("MTRX_OPEN_APPS", "rankup")
    page = client.get("/").text
    assert "Open RankUp" in page and "https://rankup.example" in page


@pytest.mark.parametrize("typed", ["   ", "rankup.example", "javascript:alert(1)", "https://", "http://[::1"])
def test_no_open_app_button_for_an_address_that_is_not_one(client, monkeypatch, typed):
    """A blank or half-typed address gives no button, rather than a link to
    nowhere on this site."""
    monkeypatch.setenv("RANKUP_URL", typed)
    page = client.get("/").text
    assert 'aria-label="Open RankUp"' not in page and 'href="rankup.example"' not in page
    assert "RankUp is in development." in page


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
    assert "RankUp is in development." in home  # RankUp was not given
    assert "knock.js" not in home and "<html" not in home
    # The home page's own script goes along; the lock's never does.
    assert sorted(p.name for p in (out / "static" / "js").iterdir()) == ["home.js"]
    page = (out / "cyberlogix" / "index.html").read_text()
    assert page.startswith("<!doctype html>") and "MTRX Horizyn</a>" in page
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
    Learn more lists open over the page rather than making it longer.
    Phones are the one exception (see the next test)."""
    page = client.get("/").text
    assert '<div class="page">' in page
    # Every pop-up is outside the frame, so opening one cannot move it.
    frame_html = page.split('<div class="page">', 1)[1].split('<section class="sheet', 1)[0]
    assert 'class="sheet' not in frame_html
    for sheet in ("projects", "company", "settings", "updates", "menu", "tour"):
        assert f'<section class="sheet' in page and f'id="{sheet}"' in page
    css = open("static/css/site.css", encoding="utf-8").read()
    frame = css.split(".page {", 1)[1].split("}", 1)[0]
    assert "height: 100dvh" in frame and "overflow: hidden" in frame


def test_on_a_phone_the_home_page_never_hides_what_it_is_or_where_to_go():
    """Held to one screen, a phone had no room for the hero's words: the
    line saying what MTRX Horizyn is was hidden, and on a 360x740 phone the
    buttons too. On a phone the page may now scroll, so all of it shows."""
    css = open("static/css/site.css", encoding="utf-8").read()
    phone = css.split("@media (max-width: 720px) {\n  /* A phone may scroll", 1)[1].split("\n}\n", 1)[0]
    assert "height: auto" in phone and "min-height: 100dvh" in phone
    assert "@container" not in css
    for words in (".lede", ".cta-row"):
        for rule in css.split("}"):
            assert not (words in rule.split("{")[0] and "display: none" in rule), rule


def test_home_page_numbers_are_real_or_say_they_are_coming(client):
    page = client.get("/").text
    # No "Active Users: Soon" placeholder and no filler figures: until an app
    # reports, the tiles are things to do (Genesis, Orbyt, the project list).
    assert "Counted from launch" not in page and '<dd class="soon">' not in page
    assert '<span class="fact-k">Genesis</span><b class="fact-v">Free</b><span class="fact-s">Turn your idea into a plan</span></a>' in page
    assert "Active Users" not in page
    # No live panel, and no Analytics link to it, until an app has reported:
    # an empty map with dashes looked alive and said nothing.
    assert 'id="activity"' not in page and 'href="#activity"' not in page
    assert '<section class="bottom solo">' in page


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
    import re
    from horizon import stats

    page = client.get("/").text
    sheet = page.split('id="projects"', 1)[1].split("</section>", 1)[0]
    rows = re.findall(r"<li><span><b>(.*?)</b><small>(.*?)</small></span>\s*"
                      r'<em class="status">(.*?)</em><span class="next">Next: (.*?)</span></li>', sheet)
    # An app's status comes from the catalog: "In development" until it opens.
    assert rows == [(p["name"], p["kind"], p.get("status", "In development"), p["next"]) for p in stats.PROJECTS]
    # The count in the panel is the length of that same list, and its line
    # says it in the card's own words (1.22.0): this website (Genesis and
    # Orbyt) is the live one, and the rest are apps in development. It used
    # to say "1 live, 3 in development", which the card didn't.
    assert (f'<a class="fact fact-projects" href="#projects">' in page
            and f'<span class="fact-k">Projects</span><b class="fact-v">{len(stats.PROJECTS)}</b>' in page)
    assert _projects_line(page) == "Genesis &amp; Orbyt live · 3 apps in development"
    assert "1 live, 3 in development" not in page
    assert "<span>Underway</span>" not in page


def _projects_line(page: str) -> str:
    """The Projects tile's line as words (each part is its own span, kept
    together, so a narrow tile breaks it only at a dot)."""
    tile = page.split('<a class="fact fact-projects"', 1)[1].split("</a>", 1)[0]
    line = tile.split('<span class="fact-s">', 1)[1].rsplit("</span>", 1)[0]
    assert re.fullmatch(r'<span class="fact-part">[^<]+</span>( · <span class="fact-part">[^<]+</span>)*', line), line
    return re.sub(r"<[^>]+>", "", line)


def test_the_projects_list_never_says_built_and_flips_at_launch(client, monkeypatch):
    """Before launch the apps are "In development", not "Built", and the
    website's row reads sensibly on the live site. The day an app opens,
    its row says "Open", from the same catalog as its Open button."""
    import re
    page = client.get("/").text
    sheet = page.split('id="projects"', 1)[1].split("</section>", 1)[0]
    status = dict(re.findall(r"<b>(.*?)</b>.*?<em class=\"status\">(.*?)</em>", sheet, re.S))
    assert status == {"MTRX Horizyn": "Live", "CyberLogix AI": "In development",
                      "OmniArmor.ai": "In development", "RankUp": "In development"}
    assert "Built" not in sheet and "hosting" not in sheet and "domain" not in sheet
    monkeypatch.setenv("CYBERLOGIX_URL", "https://cyberlogix.example")
    monkeypatch.setenv("MTRX_OPEN_APPS", "cyberlogix")
    sheet = client.get("/").text.split('id="projects"', 1)[1].split("</section>", 1)[0]
    status = dict(re.findall(r"<b>(.*?)</b>.*?<em class=\"status\">(.*?)</em>", sheet, re.S))
    assert status["CyberLogix AI"] == "Open" and status["RankUp"] == "In development"
    # The Projects tile's line changes with it.
    assert _projects_line(client.get("/").text) == "Genesis &amp; Orbyt live · 1 app open · 2 apps in development"


def test_each_app_has_open_and_learn_more(client, monkeypatch):
    monkeypatch.setenv("CYBERLOGIX_URL", "https://cyberlogix.example")
    monkeypatch.setenv("MTRX_OPEN_APPS", "all")
    page = client.get("/").text
    for key in ("rankup", "cyberlogix", "omniarmor"):
        assert f'href="#learn-{key}"' in page and f'id="learn-{key}"' in page
    # An app with an address opens; one without says it is coming.
    assert 'aria-label="Open CyberLogix AI"' in page and "https://cyberlogix.example" in page
    assert 'aria-label="Open RankUp"' not in page and "RankUp is in development." in page


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
    fact = page.split('<span class="fact-k">Active Users</span>', 1)[1].split("</a>", 1)[0]
    assert "56" in fact and "1,234" not in fact
    # The whole tile is a link, to the live numbers.
    assert '<a class="fact fact-users" href="#activity">' in page and 'id="activity"' in page


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


def test_a_typo_in_a_number_setting_does_not_take_the_site_down(client, monkeypatch):
    """Every request reads the settings, and "12h" for MTRX_SESSION_HOURS
    (or a blank or 0) crashed each one, the public home page included.
    A setting that isn't a whole number above 0 now uses the default."""
    from horizon import config

    for bad in ("12h", "", "0", "-3", "1.5"):
        monkeypatch.setenv("MTRX_SESSION_HOURS", bad)
        monkeypatch.setenv("MTRX_KNOCK_MINUTES", bad)
        assert client.get("/").status_code == 200, bad
        settings = config.get()
        assert settings.session_hours == 12 and settings.knock_minutes == 5
    monkeypatch.setenv("MTRX_SESSION_HOURS", " 24 ")
    assert config.get().session_hours == 24


def test_a_new_device_key_is_kept_only_after_approval():
    """Saving the key before the server answered replaced a working device's
    key with one the server then refused, locking that device out. (Checked
    in a real browser when fixed; this keeps the order from sliding back.)"""
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent / "static" / "js"
    devicekey = (root / "devicekey.js").read_text()
    create = devicekey.split("async function create()", 1)[1].split("async function", 1)[0]
    assert ".put(" not in create, "create() must not store the key"
    add = (root / "add.js").read_text()
    assert add.index("DeviceKey.save(pair)") > add.index('if (result.ok && result.data.go)')


def test_the_proxy_check_logs_shape_once_and_no_addresses(monkeypatch, caplog):
    from horizon import main
    from starlette.requests import Request

    monkeypatch.setattr(main, "_proxy_shape_logged", False)
    monkeypatch.setenv("MTRX_TRUST_PROXY", "1")
    scope = {"type": "http", "headers": [(b"x-forwarded-for", b"198.51.100.7, 203.0.113.9"),
                                         (b"cf-connecting-ip", b"198.51.100.7")],
             "client": ("10.0.0.1", 1234)}
    with caplog.at_level("WARNING", logger="horizon"):
        main.client_ip(Request(scope))
        main.client_ip(Request(scope))
    lines = [r.getMessage() for r in caplog.records if r.name == "horizon"]
    assert len(lines) == 1
    assert "2 entries" in lines[0] and "does not match" in lines[0]
    assert "198.51.100.7" not in lines[0] and "203.0.113.9" not in lines[0]


def test_old_snapshots_and_invites_are_cleaned_up(client):
    import time
    from horizon import db, lock, stats

    old = time.time() - 500 * 86400
    with db.connect() as conn:
        conn.execute("INSERT INTO app_snapshots (app, at, online, users, active_users) VALUES ('rankup', ?, 1, 5, 1)", (old,))
        conn.execute("INSERT INTO invites (token_hash, created_by, expires_at) VALUES ('old', 'x', ?)", (old,))
    stats.snapshot([])
    lock.make_invite("someone")
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM app_snapshots WHERE at = ?", (old,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM invites WHERE token_hash = 'old'").fetchone()[0] == 0


def test_pages_need_no_other_website_to_draw(client):
    """The fonts come from this site, so a phone opens no other connection
    before the words can appear, and the security policy allows no other."""
    page = client.get("/")
    assert "fonts.googleapis.com" not in page.text and "gstatic" not in page.text
    csp = page.headers["content-security-policy"]
    # (Pilot's Gemini address, generativelanguage.googleapis.com, is for the
    # visitor's own AI calls only: connect-src, never fonts.)
    assert "font-src 'self';" in csp and "fonts.googleapis" not in csp and "gstatic" not in csp
    css = open("static/css/site.css", encoding="utf-8").read()
    for name in ("inter-latin", "montserrat-latin"):
        assert f'/static/fonts/{name}.woff2' in css and f'href="/static/fonts/{name}.woff2"' in page.text
        assert client.get(f"/static/fonts/{name}.woff2").status_code == 200


def test_text_files_are_compressed_but_secret_pages_are_not(client):
    gz = {"Accept-Encoding": "gzip"}
    assert client.get("/", headers=gz).headers.get("content-encoding") == "gzip"
    css = client.get("/static/css/site.css", headers=gz)
    assert css.headers.get("content-encoding") == "gzip" and ".page {" in css.text
    # The page holding the one-time setup code stays as it is.
    from tests.test_lock import SETUP
    add = client.get(f"/console/add/{SETUP}", headers=gz)
    assert add.status_code == 200 and "content-encoding" not in add.headers
    # Pictures are compressed already.
    assert "content-encoding" not in client.get("/static/img/hero-wide.webp", headers=gz).headers


def test_the_console_numbers_are_not_compressed(client):
    owner(client)
    gz = {"Accept-Encoding": "gzip"}
    overview = client.get("/api/console/overview", headers=gz)
    assert overview.status_code == 200 and "content-encoding" not in overview.headers


def test_fingerprinted_files_are_kept_and_change_address_with_their_contents(client):
    import re
    page = client.get("/").text
    css_url = re.search(r'href="(/static/css/site\.css\?v=[0-9a-f]{10})"', page).group(1)
    assert re.search(r'src="/static/js/home\.js\?v=[0-9a-f]{10}"', page)
    assert "immutable" in client.get(css_url).headers["cache-control"]
    # Files named in the stylesheet keep their plain address and are checked daily.
    assert client.get("/static/img/hero-wide.webp").headers["cache-control"] == "public, max-age=86400"
    # A missing file is not kept, so it can appear after a deploy.
    assert "max-age" not in client.get("/static/img/no-such.webp").headers.get("cache-control", "")


def test_search_folded_to_its_icon_can_still_be_opened():
    """On narrower screens the search box folds to its icon. It used to be
    hidden outright there, and a hidden box cannot take a tap or ⌘K, so
    search could not be opened at all on a phone."""
    import re
    css = open("static/css/site.css", encoding="utf-8").read()
    narrow = css.split("@media (max-width: 1440px) {", 1)[1].split("\n}\n", 1)[0]
    for rule in re.findall(r"([^{}]*)\{([^}]*)\}", narrow):
        if ".search input" in rule[0] and "focus-within" not in rule[0]:
            assert "display: none" not in rule[1]


def test_the_server_keeps_every_time_as_utc_seconds():
    """Every time the server stores or compares is time.time(): seconds
    since 1970 in UTC, the same whatever the server's own time zone. A
    local-time call (datetime.now(), date.today(), time.localtime()...)
    would make "expired" depend on where the server happens to run. The
    console page turns the seconds into the viewer's own local time."""
    import re
    from pathlib import Path
    naive = re.compile(r"\b(datetime|date)\.(now|utcnow|today|fromtimestamp|utcfromtimestamp)\("
                       r"|\btime\.(localtime|mktime|strftime|ctime)\(")
    files = sorted((Path(__file__).resolve().parent.parent / "horizon").glob("*.py"))
    assert files
    for file in files:
        assert not naive.search(file.read_text()), file


# ---------------------------------------------------------------- the company

def _sheet(page: str, sheet_id: str) -> str:
    return page.split(f'id="{sheet_id}"', 1)[1].split("</section>", 1)[0]


def test_home_page_presents_mtrx_horizon_as_the_parent_company(client):
    page = client.get("/").text
    assert "MTRX Horizyn is the parent company of RankUp, CyberLogix AI and OmniArmor.ai" in page
    hero = page.split('class="hero-copy"', 1)[1].split("</section>", 1)[0]
    assert "MTRX Horizyn is the parent company of three apps, all in development:" in hero
    # Each app is named in that first paragraph, and each name opens its card.
    for key, name in (("rankup", "RankUp"), ("cyberlogix", "CyberLogix AI"),
                      ("omniarmor", "OmniArmor.ai")):
        assert f'<a href="#learn-{key}">{name}</a>' in hero
        assert "An MTRX Horizyn app" in _sheet(page, f"learn-{key}")
    nav = page.split('class="mainnav"', 1)[1].split("</nav>", 1)[0]
    assert '<a href="#company">About</a>' in nav


def test_about_lists_the_three_apps_with_their_links(client, monkeypatch):
    monkeypatch.setenv("OMNIARMOR_URL", "https://omniarmor.example.com")
    monkeypatch.setenv("MTRX_OPEN_APPS", "all")
    about = _sheet(client.get("/").text, "company")
    assert "MTRX Horizyn is a small independent software company" in about and "parent company of three apps" in about
    for key in ("rankup", "cyberlogix", "omniarmor"):
        assert f'href="#learn-{key}"' in about
    # Open only for the app that has a real address.
    assert 'href="https://omniarmor.example.com"' in about and 'aria-label="Open OmniArmor.ai"' in about
    assert 'aria-label="Open RankUp"' not in about and 'aria-label="Open CyberLogix AI"' not in about


def test_about_is_about_the_company_not_a_person(client):
    """The repository is public, and so is the page: the About section says
    what the company is and makes, and nothing about whoever runs it."""
    import re
    about = re.sub(r"<[^>]+>", " ", _sheet(client.get("/").text, "company")).lower()
    words = set(re.findall(r"[a-z']+", about))
    for personal in ("i", "i'm", "me", "my", "founder", "founded", "ceo", "owner", "age", "aged",
                     "old", "born", "school", "student", "grade", "parents", "mum", "dad", "mom",
                     "brother", "sister", "lives", "based", "hometown", "he", "she", "his", "her"):
        assert personal not in words, personal


def test_business_enquiries_only_when_an_address_is_set(client, monkeypatch):
    """Without the setting the page still says where to write: the help
    address, never "Business enquiries"."""
    from horizon import config
    page = client.get("/").text
    assert "Business enquiries" not in page
    assert set(re.findall(r'href="mailto:([^"]+)"', page)) == {config.HELP_EMAIL}
    news = page.split('id="news"', 1)[1].split("</section>", 1)[0]
    assert f'Questions? Write to <a href="mailto:{config.HELP_EMAIL}">{config.HELP_EMAIL}</a>.' in news
    monkeypatch.setenv("MTRX_CONTACT_EMAIL", "  hello@example.com ")
    page = client.get("/").text
    assert 'href="mailto:hello@example.com"' in page
    assert "Business enquiries" in _sheet(page, "company")
    footer = page.split('<footer class="footer">', 1)[1].split("</footer>", 1)[0]
    assert '<a href="mailto:hello@example.com">Business enquiries</a>' in footer


@pytest.mark.parametrize("typed", ["not-an-address", "a@b", "x@example.com?bcc=y@evil.example",
                                   "<x@example.com>", "x y@example.com", '"x"@example.com'])
def test_a_contact_setting_that_is_not_a_plain_address_shows_nothing(client, monkeypatch, typed):
    from horizon import config
    monkeypatch.setenv("MTRX_CONTACT_EMAIL", typed)
    page = client.get("/").text
    assert "Business enquiries" not in page
    # Only the help address: what was typed is never put in a link.
    assert set(re.findall(r'href="mailto:([^"]+)"', page)) == {config.HELP_EMAIL}


def test_no_email_address_is_written_into_the_site():
    """The contact address comes only from the setting: none is typed into a
    page, a script or the code, but for the one help address the home page
    falls back to (config.HELP_EMAIL), written once."""
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    email = re.compile(r"[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
    for folder in ("templates", "static/js", "static/css", "horizon"):
        for path in (root / folder).rglob("*"):
            if path.suffix in (".html", ".js", ".css", ".py", ".webmanifest"):
                found = email.findall(path.read_text(encoding="utf-8"))
                if path == root / "horizon" / "config.py":
                    assert found == ["help@mtrxhorizyn.com"], (path, found)
                else:
                    assert found == [], (path, found)


def test_no_page_has_a_form_that_sends_anything(client, monkeypatch):
    """Business enquiries are an email link, not a form the site would have
    to store. The search box filters the page in the browser and has no
    address to send to."""
    import re
    monkeypatch.setenv("MTRX_CONTACT_EMAIL", "hello@example.com")
    for path in ("/", "/privacy", "/terms"):
        page = client.get(path).text
        for form in re.findall(r"<form[^>]*>", page):
            assert "action=" not in form and "method=" not in form, (path, form)
        assert "<textarea" not in page


# ---------------------------------------------------------------- privacy and terms

def test_privacy_and_terms_are_linked_from_the_home_page(client):
    page = client.get("/").text
    footer = page.split('<footer class="footer">', 1)[1].split("</footer>", 1)[0]
    assert 'href="/privacy"' in footer and 'href="/terms"' in footer
    for path, heading in (("/privacy", "<h1>Privacy</h1>"), ("/terms", "<h1>Terms</h1>")):
        response = client.get(path)
        assert response.status_code == 200 and heading in response.text
        assert client.head(path).status_code == 200
        # Public pages, so search engines may list them.
        assert "noindex" not in response.text and "x-robots-tag" not in response.headers


def test_privacy_page_matches_what_the_code_does(client, monkeypatch):
    """The cookie names and how long each lasts are read from the same
    settings the code uses, and every cookie the page names is one the site
    really sets on the owner's devices."""
    from horizon import lock, main
    from tests.test_lock import Device, SETUP, enroll, unlock

    monkeypatch.setenv("MTRX_SESSION_HOURS", "7")
    monkeypatch.setenv("MTRX_KNOCK_MINUTES", "3")
    page = client.get("/privacy").text
    assert "No cookies for visitors." in page
    assert "<code>mh_d</code> remembers that a device is approved, for up to 400 days." in page
    assert "<code>mh_k</code> lasts 3 minutes" in page
    assert "<code>mh_s</code> keeps the owner signed in, for up to 7 hours." in page
    assert main.DEVICE_COOKIE_DAYS == 400
    assert lock.KEEP_TRIES_SECONDS == 24 * 3600 and "kept for 24 hours" in page
    # A visitor really gets no cookie from any public page...
    for path in ("/", "/privacy", "/terms", "/healthz", "/no-such-page"):
        assert "set-cookie" not in client.get(path).headers, path
    # ...and the owner's devices get exactly the three named.
    named = {"mh_d", "mh_k", "mh_s"}
    assert {main.DEVICE_COOKIE, main.DOOR_COOKIE, main.SESSION_COOKIE} == named
    device = Device()
    set_names = set(enroll(client, device, SETUP).cookies.keys())
    set_names |= set(unlock(client, device).cookies.keys())
    assert set_names <= named and main.SESSION_COOKIE in set_names


def test_privacy_page_tells_the_truth_about_tracking(client):
    """No tracking, nothing from another company: the security policy every
    page is sent with refuses anything not from this site."""
    from horizon import main
    response = client.get("/privacy")
    assert "No tracking" in response.text
    assert response.headers["content-security-policy"] == main.CSP
    for rule in ("default-src 'self'", "script-src 'self'", "connect-src 'self'",
                 "font-src 'self'", "img-src 'self' data:"):
        assert rule in main.CSP
    for path in ("/", "/privacy", "/terms"):
        page = client.get(path).text
        # Nothing on the page is fetched from another address.
        assert 'src="http' not in page and "@import" not in page
        assert '<link rel="stylesheet" href="http' not in page


def test_failed_tries_are_deleted_after_a_day_even_if_nobody_tries_again(client):
    import time
    from horizon import db, upkeep
    with db.connect() as conn:
        conn.execute("INSERT INTO attempts (kind, who, at) VALUES ('enroll', '203.0.113.9', ?)",
                     (time.time() - 25 * 3600,))
        conn.execute("INSERT INTO attempts (kind, who, at) VALUES ('enroll', '203.0.113.8', ?)",
                     (time.time() - 3600,))
    upkeep.run_once()
    with db.connect() as conn:
        left = [r[0] for r in conn.execute("SELECT who FROM attempts")]
    assert left == ["203.0.113.8"]


def test_legal_pages_name_the_contact_only_when_set(client, monkeypatch):
    for path in ("/privacy", "/terms"):
        assert "mailto:" not in client.get(path).text
    monkeypatch.setenv("MTRX_CONTACT_EMAIL", "hello@example.com")
    for path in ("/privacy", "/terms"):
        assert 'href="mailto:hello@example.com"' in client.get(path).text


def test_legal_pages_say_nothing_about_the_console_a_stranger_could_use(client):
    """The privacy page has to mention the owner's cookies, but not where
    the console is or how it opens."""
    for path in ("/privacy", "/terms"):
        page = client.get(path).text.lower()
        for clue in ("/console", "knock", "/api/", "tap the", "setup code"):
            assert clue not in page, (path, clue)


def test_the_company_name_is_spelled_horizyn_everywhere_people_see_it():
    """The company is MTRX Horizyn. The old spelling must not come back in
    anything a visitor or the owner reads."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    places = [root / "README.md", *root.glob("docs/*.md"), *root.glob("templates/*.html"),
              *root.glob("static/js/*.js"), *root.glob("horizon/*.py"),
              root / "horizon/private/manifest.webmanifest"]
    old = re.compile(r"MTRX\s+(<b>)?horizon", re.IGNORECASE)
    hits = [str(p.relative_to(root)) for p in places if p.exists() and old.search(p.read_text())]
    assert hits == [], hits


def test_the_live_version_is_shown_and_matches_the_version_file(client):
    from horizon import config
    version = (config.ROOT / "VERSION").read_text().strip()
    assert version and client.get("/healthz").json() == {"ok": True, "version": version}
    assert f"Version {version}" in client.get("/").text
    changelog = (config.ROOT / "CHANGELOG.md").read_text()
    assert f"## {version} " in changelog, "every version has a line in CHANGELOG.md"


def test_a_server_error_gets_a_friendly_page_that_says_nothing(make_client):
    from fastapi.testclient import TestClient
    from horizon import main

    def broken():
        raise RuntimeError("secret detail")

    main.app.add_api_route("/test-broken", broken)
    main.app.add_api_route("/api/test-broken", broken)
    try:
        with TestClient(main.app, raise_server_exceptions=False) as c:
            page = c.get("/test-broken")
            assert page.status_code == 500
            assert "Something went wrong" in page.text and "secret detail" not in page.text
            assert page.headers["content-security-policy"] == main.CSP
            api = c.get("/api/test-broken")
            assert api.status_code == 500 and "secret" not in api.text
            assert api.json()["error"]
    finally:
        main.app.router.routes[:] = [r for r in main.app.router.routes
                                     if getattr(r, "path", "") not in ("/test-broken", "/api/test-broken")]


def test_sitemap_lists_the_public_pages_and_never_the_console(client, monkeypatch):
    monkeypatch.setenv("MTRX_PUBLIC_URL", "https://mtrx.example")
    body = client.get("/sitemap.xml").text
    for page in ("/", "/privacy", "/terms", "/brand"):
        assert f"<loc>https://mtrx.example{page}</loc>" in body
    assert "console" not in body
    assert "Sitemap: https://mtrx.example/sitemap.xml" in client.get("/robots.txt").text
    for page in ("/privacy", "/terms", "/brand"):
        assert client.get(page).status_code == 200


def test_a_staging_copy_with_noindex_is_never_listed(client, monkeypatch):
    """MTRX_NOINDEX=1, for a copy that is not the live site (docs/STAGING.md):
    every answer says noindex, robots.txt closes the site, the sitemap is
    empty. It still names no console address."""
    monkeypatch.setenv("MTRX_PUBLIC_URL", "https://mtrx.example")
    monkeypatch.setenv("MTRX_NOINDEX", "1")
    for path in ("/", "/privacy", "/terms", "/brand", "/healthz", "/robots.txt", "/sitemap.xml",
                 "/no-such-page", "/console"):
        assert client.get(path).headers.get("x-robots-tag") == "noindex", path
    robots = client.get("/robots.txt").text
    assert robots == "User-agent: *\nDisallow: /\n"
    assert "<loc>" not in client.get("/sitemap.xml").text
    # The same page, with or without the setting: only the header differs.
    monkeypatch.setenv("MTRX_NOINDEX", "0")
    assert "x-robots-tag" not in client.get("/").headers
    assert "<loc>https://mtrx.example/</loc>" in client.get("/sitemap.xml").text


def test_share_previews_use_whole_addresses(client, monkeypatch):
    """Chat apps cannot fetch a picture named as "/static/...": the preview
    showed no image."""
    monkeypatch.setenv("MTRX_PUBLIC_URL", "https://mtrx.example")
    page = client.get("/").text
    assert '<meta property="og:image" content="https://mtrx.example/static/img/logo-512.png">' in page
    assert '<meta property="og:url" content="https://mtrx.example/">' in page


def test_brand_page_has_the_name_logos_and_colours(client):
    page = client.get("/brand").text
    assert "MTRX Horizyn" in page and "Horizyn with a <b>y</b>" in page
    for logo in ("logo-512.png", "rankup-icon.svg", "cyberlogix-icon.svg", "omniarmor-icon.svg"):
        assert logo in page
    assert "#22D3EE" in page


def test_console_shows_costs_and_each_apps_admin_page(client, monkeypatch):
    from horizon import costs
    monkeypatch.setenv("RANKUP_URL", "https://rankup.mtrx.example")
    monkeypatch.setenv("CYBERLOGIX_URL", "https://cyberlogix.mtrx.example/")
    monkeypatch.setenv("OMNIARMOR_ADMIN_URL", "https://omniarmor.mtrx.example/settings")
    owner(client)
    data = client.get("/api/console/overview").json()
    assert data["admin_urls"] == {
        "rankup": "https://rankup.mtrx.example/#/operator",
        "cyberlogix": "https://cyberlogix.mtrx.example/console",
        "omniarmor": "https://omniarmor.mtrx.example/settings",
    }
    c = data["costs"]
    assert c["total_low"] == sum(i["low"] for i in c["monthly"]) == costs.summary()["total_low"]
    assert 35 <= c["total_low"] <= c["total_high"] <= 60


def test_no_admin_link_for_an_app_with_no_address(client, monkeypatch):
    monkeypatch.setenv("OMNIARMOR_ADMIN_URL", "javascript:alert(1)")
    owner(client)
    assert client.get("/api/console/overview").json()["admin_urls"]["omniarmor"] == ""


def _broken_routes(main, message):
    def broken():
        raise RuntimeError(message)
    main.app.add_api_route("/test-broken", broken)


def _drop_broken_routes(main):
    main.app.router.routes[:] = [r for r in main.app.router.routes
                                 if getattr(r, "path", "") != "/test-broken"]


def test_a_server_error_is_emailed_without_anything_about_the_visitor(make_client, monkeypatch):
    from fastapi.testclient import TestClient
    from horizon import errors, health, main

    sent = []
    monkeypatch.setattr(health, "send_email", lambda subject, body: sent.append((subject, body)) or True)
    real_report = errors.report
    monkeypatch.setattr(errors, "report", lambda *a, **k: real_report(*a, **{**k, "wait": True}))
    monkeypatch.setenv("MTRX_ALERT_EMAIL", "owner@example.com")
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    secret_token = "Zx9" * 12
    _broken_routes(main, f"could not save visitor@example.org with {secret_token}")
    try:
        with TestClient(main.app, raise_server_exceptions=False) as c:
            c.cookies.set("mh_d", "cookie-visitor@example.net")
            r = c.get("/test-broken?email=query-visitor@example.com&token=" + secret_token,
                      headers={"User-Agent": "agent-visitor@example.com"})
            assert r.status_code == 500
    finally:
        _drop_broken_routes(main)
    assert len(sent) == 1
    subject, body = sent[0]
    assert "RuntimeError" in subject and "GET /test-broken" in body and main.VERSION in body
    for leak in ("visitor@example", "query-visitor", "cookie-visitor", "agent-visitor",
                 secret_token, "email=", "?"):
        assert leak not in body, leak
    assert "[email]" in body and "[hidden]" in body
    assert "tests/test_site.py" in body and str(errors.config.ROOT) not in body


def test_error_emails_are_kept_to_one_an_hour_per_error_and_twenty_a_day(client, monkeypatch):
    from horizon import errors, health

    sent = []
    monkeypatch.setattr(health, "send_email", lambda s, b: sent.append(s) or True)
    monkeypatch.setenv("MTRX_ALERT_EMAIL", "owner@example.com")
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")

    def fail(n):
        try:
            exec(f"raise ValueError('kind {n}')", {})
        except ValueError as exc:
            return exc

    same = fail(0)
    for _ in range(3):
        errors.report("GET", "/x", same, "1", wait=True)
    assert len(sent) == 1, "the same error is emailed once an hour"
    # Different places in the code are different errors, up to 20 a day.
    for n in range(40):
        try:
            exec("\n" * n + "raise KeyError('k')", {})
        except KeyError as exc:
            errors.report("GET", "/x", exc, "1", wait=True)
    assert len(sent) == errors.PER_DAY


def test_no_error_email_when_email_is_not_set_up(client, monkeypatch):
    from horizon import errors, health
    sent = []
    monkeypatch.setattr(health, "send_email", lambda s, b: sent.append(s) or True)
    monkeypatch.delenv("MTRX_ALERT_EMAIL", raising=False)
    try:
        raise RuntimeError("x")
    except RuntimeError as exc:
        errors.report("GET", "/x", exc, "1", wait=True)
    assert sent == []


# ---------------------------------------------------------------- 1.11.0: an honest home page

def test_until_launch_every_part_of_the_home_page_says_the_apps_are_in_development(client):
    """Cards said "Early access", the figures said "3 Available" and Orbyt said
    "Released to the public". Now one place, the catalog, decides, and every
    part of the page agrees."""
    page = client.get("/").text
    assert "Available" not in page and "Total Apps" not in page
    assert "parent company of three apps, all in development" in page
    assert "parent company of three apps (3 in development)" in page
    # Released in the console but with no address: still in development.
    assert "Open RankUp" not in page and "RankUp is in development." in page


def test_the_day_the_apps_open_the_home_page_says_so(client, monkeypatch):
    for key in ("RANKUP", "CYBERLOGIX", "OMNIARMOR"):
        monkeypatch.setenv(f"{key}_URL", f"https://{key.lower()}.example.com")
    # Addresses alone don't launch anything: still in development, no Open
    # button and no link to the apps anywhere on the page.
    page = client.get("/").text
    assert "parent company of three apps, all in development" in page
    assert "rankup.example.com" not in page and 'aria-label="Open RankUp"' not in page
    # Named in MTRX_OPEN_APPS: open, everywhere at once.
    monkeypatch.setenv("MTRX_OPEN_APPS", "all")
    page = client.get("/").text
    assert "parent company of three apps, all open now" in page
    assert "In development" not in page and 'aria-label="Open RankUp"' in page
    monkeypatch.setenv("MTRX_OPEN_APPS", "rankup, cyberlogix")
    page = client.get("/").text
    assert "parent company of three apps, 2 open, 1 in development" in page
    assert 'aria-label="Open OmniArmor.ai"' not in page and "omniarmor.example.com" not in page


def test_the_catalog_words_for_open_and_in_development():
    from horizon import catalog
    assert catalog.apps_line([{"open": False}] * 3) == "3 in development"
    assert catalog.apps_line([{"open": True}, {"open": False}, {"open": False}]) == "1 open, 2 in development"
    assert catalog.apps_line([{"open": True}] * 3) == "3 open"
    assert catalog.opening([{"open": False}, {}]) and not catalog.opening([{"open": False}, {"open": True}])


def test_nothing_on_the_home_page_looks_alive_without_being_so(client):
    page = client.get("/").text
    top = page.split('<header class="topbar">', 1)[1].split("</header>", 1)[0]
    # The bell has no count that never goes away.
    assert "bell-count" not in page and 'aria-label="What\'s new"' in top
    # A plain three-line Menu button, not a round picture like a profile.
    assert '<a class="menu-btn" href="#menu" aria-label="Menu">' in top and "me-mark" not in page
    assert '<path d="M4 7h16M4 12h16M4 17h16"/>' in top
    # Settings held only calm mode: it is called that now, and not a top link.
    nav = top.split('class="mainnav"', 1)[1].split("</nav>", 1)[0]
    assert "Settings" not in nav and 'href="#activity"' not in nav
    menu = page.split('id="menu"', 1)[1].split("</section>", 1)[0]
    assert '<a href="#settings">Calm mode: less motion</a>' in menu
    assert "<h2>Calm mode</h2>" in page.split('id="settings"', 1)[1].split("</section>", 1)[0]
    script = Path("static/js/home.js").read_text(encoding="utf-8")
    assert 'document.getElementById("activity") ?' in script


def test_the_live_panel_comes_back_once_an_app_reports(client, monkeypatch):
    import time

    from horizon import db
    monkeypatch.setenv("RANKUP_STATS_URL", "http://127.0.0.1:9/stats")
    with db.connect() as conn:
        conn.execute("INSERT INTO app_snapshots (app, at, online, users, active_users) VALUES (?, ?, ?, ?, ?)",
                     ("rankup", time.time(), 1, 1234, 56))
    page = client.get("/").text
    assert 'id="activity"' in page and '<a href="#activity">Analytics</a>' in page
    assert '<section class="bottom">' in page


def test_the_home_page_says_plainly_what_the_company_makes(client):
    page = client.get("/").text
    hero = page.split('class="hero-copy"', 1)[1].split("</section>", 1)[0]
    assert '<h1><span class="line">Three apps that watch,</span> <span class="line gradient-text">warn and motivate.</span></h1>' in hero
    assert "One Vision." not in hero and "Infinite Possibilities." not in hero
    # Plain lines on the cards, never vague ones; and they show on phones too.
    for line in ("Chores that turn into points and games", "Fridge and freezer alarms that call you",
                 "Safety checklists that count the deadlines"):
        assert f'<p class="app-lede">{line}</p>' in page
    for vague in ("Secure, intelligent solutions", "Protect what matters", "advanced security"):
        assert vague not in page
    css = Path("static/css/site.css").read_text(encoding="utf-8")
    phone = css.split("@media (max-width: 720px) {\n  /* A phone may scroll", 1)[1].split("\n}\n", 1)[0]
    assert ".page .app-card .app-lede { display: block;" in phone
    # No vague figures: "Global Reach" is long gone, and 1.16.0 dropped the
    # strip's "CyberLogix: built for 12" too (the CyberLogix card says it).
    assert "Global Reach" not in page and "<dt>Built for</dt>" not in page
    assert "Built for 12 industries, from restaurants to data centers." in page


def test_on_a_phone_the_apps_stack_and_whats_new_is_on_the_page(client):
    """Three tiles side by side were too narrow on a phone: they stack, one
    card per app. One real section is on the page itself, not in a pop-up:
    what's new (the same list as the bell's), who makes it, and where to
    write. Plain words about the company only: no names, no ages."""
    page = client.get("/").text
    frame = page.split('<div class="page">', 1)[1].split('<section class="sheet', 1)[0]
    news = frame.split('<section class="panel home-news" id="news"', 1)[1].split("</section>", 1)[0]
    bell = page.split('id="updates"', 1)[1].split("</section>", 1)[0]
    items = re.findall(r"<li>.*?</li>", news, re.S)
    assert 3 <= len(items) <= 6 and items == re.findall(r"<li>.*?</li>", bell, re.S)
    assert "<p class=\"home-who\">MTRX Horizyn is a small independent software company.</p>" in news
    assert "all on one screen" not in page
    css = Path("static/css/site.css").read_text(encoding="utf-8")
    phone = css.split("@media (max-width: 720px) {\n  /* A phone may scroll", 1)[1].split("\n}\n", 1)[0]
    assert ".page .apps { grid-template-columns: minmax(0, 1fr);" in phone
    assert "repeat(3" not in phone
    assert ".page .home-news { display: none; }" in css
    assert ".page .home-news { display: grid;" in css


def test_on_a_phone_genesis_and_orbyt_are_on_the_page_and_the_menu_fits(client):
    """1.16.0: Genesis and Orbyt once each on a phone (the Genesis card and a
    Genesis figure sat one after the other), as big whole-tile links in the
    strip under the apps."""
    page = client.get("/").text
    assert 'class="more-places"' not in page and 'class="place ' not in page
    tiles = page.split('<ul class="facts" aria-label="Where to go next">', 1)[1].split("</ul>", 1)[0]
    assert tiles.count('href="/genesis"') == 1 and tiles.count('href="/orbyt"') == 1
    # Every tile is one link, the whole tile: nothing in the strip is just a figure.
    assert tiles.count("<li>") == tiles.count('<a class="fact ')
    main = page.split('<main id="top">', 1)[1].split("</main>", 1)[0]
    # 1.17.0: the hero has its own "Try Genesis now (free)" button (the
    # reviewers asked for it), so Genesis is the tile, that button, and its
    # dated line in What's new; never two cards in a row.
    hero = main.split('<section class="hero">', 1)[1].split("</section>", 1)[0]
    # (The one-line news strip in the hero is What's new, not a Genesis card.)
    strip = hero.split('<p class="news-strip">', 1)[1].split("</p>", 1)[0] if 'class="news-strip"' in hero else ""
    assert hero.count('href="/genesis"') - strip.count('href="/genesis"') == 1 and "Try Genesis now (free)" in hero
    news = main.split('id="news"', 1)[1]
    assert main.count('href="/genesis"') - news.count('href="/genesis"') - strip.count('href="/genesis"') == 2
    css = Path("static/css/site.css").read_text(encoding="utf-8")
    phone = css.split("@media (max-width: 720px) {\n  /* A phone may scroll", 1)[1].split("\n}\n", 1)[0]
    assert ".page .facts { grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr));" in phone
    assert "min-height: 76px" in phone
    assert ".more-places" not in css
    menu_rule = css.split(".menu-sheet .menu {", 1)[1].split("}", 1)[0]
    assert "max-height: calc(100dvh - 80px)" in menu_rule and "overflow-y: auto" in menu_rule
    menu = page.split('id="menu"', 1)[1].split("</section>", 1)[0]
    assert '<a href="/orbyt">Orbyt: work with us</a>' in menu


def test_the_open_apps_setting_is_read_carefully():
    from horizon import config
    assert config._open_apps(None) == frozenset() and config._open_apps("  ") == frozenset()
    assert config._open_apps("RankUp, cyberlogix  omniarmor") == {"rankup", "cyberlogix", "omniarmor"}
    assert config._open_apps("all") == {"*"} and config._open_apps("rankup,ALL") == {"*"}
    assert config._open_apps("rank up!, -bad-, ok") == {"rank", "ok"}


# ---------------------------------------------------------------- 1.15.0

def test_one_status_phrase_site_wide(client, monkeypatch):
    """ "In development" everywhere an app isn't open yet: the home page's
    cards and Learn more, and Orbyt's app cards. No "soon" variants."""
    monkeypatch.setenv("EARLY_ACCESS_ENABLED", "0")
    home = client.get("/").text
    for name in ("RankUp", "CyberLogix AI", "OmniArmor.ai"):
        assert f"{name} is in development." in home
    assert "opens to the public soon" not in home and "<small>soon</small>" not in home and 'title="Opening soon"' not in home
    orbyt = client.get("/orbyt").text
    assert "Opening soon" not in orbyt and "opening soon" not in orbyt


def test_the_help_address_is_in_the_mailbox_list_and_the_readme_is_right():
    from horizon import config
    running = (ROOT / "docs/RUNNING-MTRX-HORIZYN.md").read_text()
    assert f"`{config.HELP_EMAIL}`" in running and "`hello@mtrxhorizyn.com`" in running
    readme = " ".join((ROOT / "README.md").read_text().split())
    assert "Unset (or not a plain address), nothing is shown." not in readme
    assert f"`{config.HELP_EMAIL}`" in readme


# ---------------------------------------------------------------- 1.17.0: Home

def test_whats_new_is_dated_linked_and_kept_in_step_with_the_changelog(client):
    """Each item has a date and a link, newest first, none stale; an MTRX
    Horizyn item names a version that CHANGELOG.md has, on the same date."""
    from datetime import date, timedelta
    from horizon import news
    changelog = Path("CHANGELOG.md").read_text(encoding="utf-8")
    months = {m: i + 1 for i, m in enumerate(("January", "February", "March", "April", "May", "June", "July",
                                               "August", "September", "October", "November", "December"))}
    released = {v: date(int(y), months[m], int(d)) for v, d, m, y in
                re.findall(r"^## (\d+\.\d+\.\d+) \((\d+) (\w+) (\d{4})\)", changelog, re.M)}
    newest = max(released.values())
    dates = [date.fromisoformat(i["date"]) for i in news.NEWS]
    assert dates == sorted(dates, reverse=True)
    assert newest - dates[0] <= timedelta(days=news.FRESH_DAYS), "the newest item is stale"
    assert dates[0] - dates[-1] <= timedelta(days=news.SPAN_DAYS), "an old item lingers"
    for item in news.NEWS:
        assert item["href"].startswith("/") and item["text"].strip() and item["who"].strip()
        if item["source"].startswith("MTRX Horizyn "):
            version = item["source"].split()[-1]
            assert released.get(version) == date.fromisoformat(item["date"]), item
        else:
            assert re.fullmatch(r"(RankUp|CyberLogix AI|OmniArmor\.ai) \d+\.\d+\.\d+", item["source"]), item
    page = client.get("/").text
    bell = page.split('id="updates"', 1)[1].split("</section>", 1)[0]
    items = re.findall(r"<li>.*?</li>", bell, re.S)
    assert len(items) == len(news.NEWS)
    for li, item in zip(items, news.NEWS):
        assert f'<time datetime="{item["date"]}">' in li and 'class="news-item" href="' in li
    # Links to the apps' cards stay on the page; the cards they name exist.
    for anchor in re.findall(r'class="news-item" href="#([\w-]+)"', bell):
        assert f'id="{anchor}"' in page
    for path in {i["href"].split("#")[0] for i in news.NEWS if not i["href"].startswith("/#")}:
        assert client.get(path).status_code == 200, path
    assert "Block Craft now tells a story" not in page  # the stale line is gone


def test_the_app_cards_and_learn_more_show_real_screens(client):
    """1-2 real screens per app, from the apps' own demos (pretend data),
    small WebP files with their sizes written in."""
    from tests.test_speed import webp_size
    page = client.get("/").text
    for key in ("rankup", "cyberlogix", "omniarmor"):
        card = page.split(f'data-app="{key}"', 1)[1].split("</article>", 1)[0]
        assert f'<img src="/static/img/{key}-screen-sm.webp" alt="" width="192" height="320" loading="lazy"' in card
        learn = page.split(f'id="learn-{key}"', 1)[1].split("</section>", 1)[0]
        for n in (1, 2):
            assert f'src="/static/img/{key}-screen-{n}.webp"' in learn and 'width="320" height="591"' in learn
        assert "pretend data" in learn
        for name, size in ((f"{key}-screen-sm.webp", (192, 320)), (f"{key}-screen-1.webp", (320, 591)),
                           (f"{key}-screen-2.webp", (320, 591))):
            path = Path("static/img") / name
            assert webp_size(path) == size, name
            assert path.stat().st_size < 30_000, name
    css = Path("static/css/site.css").read_text(encoding="utf-8")
    # The desktop tags keep a dark fade behind them, over the artwork.
    assert ".page .app-card .tags {" in css and "linear-gradient(90deg, rgba(6, 14, 38, .9) 72%, rgba(6, 14, 38, 0))" in css


def test_the_phone_hero_has_two_buttons_and_a_balanced_headline(client):
    page = client.get("/").text
    hero = page.split('<section class="hero">', 1)[1].split("</section>", 1)[0]
    assert ('<a class="btn btn-ghost btn-genesis" href="/genesis"><span class="say-long">Try Genesis now (free)</span>'
            '<span class="say-short">Try Genesis free</span></a>') in hero
    css = Path("static/css/site.css").read_text(encoding="utf-8")
    late = css.split("/* ---------- 1.17.0:", 1)[1]
    phone = late.split("@media (max-width: 720px) {", 1)[1].split("\n}\n", 1)[0]
    assert "text-wrap: balance" in phone and "grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr)" in phone


def test_the_footer_is_three_labelled_groups(client):
    for path in ("/", "/genesis", "/orbyt"):
        page = client.get(path).text
        foot = page.split('<nav class="foot-links"', 1)[1].split("</nav>", 1)[0]
        labels = re.findall(r'<span class="foot-h" id="[\w-]+">([^<]+)</span>', foot)
        assert labels == ["Your idea", "Business", "About"], path
        assert foot.count('class="foot-group" role="group"') == 3
        assert foot.count("<a ") <= 12
    css = Path("static/css/site.css").read_text(encoding="utf-8")
    assert ".foot-group { display: contents; }" in css and ".foot-h { display: none; }" in css


# ---------------------------------------------------------------- 1.19.0

def _late_css():
    return Path("static/css/site.css").read_text(encoding="utf-8").split("/* ---------- 1.19.0:", 1)[1]


def test_narrow_buttons_say_try_genesis_free(client):
    """At phone widths the hero's button says "Try Genesis free" (shorter);
    a computer keeps "Try Genesis now (free)". One is hidden at a time, so
    a screen reader hears one name."""
    late = _late_css()
    assert ".say-short { display: none; }" in late
    phone = late.split("@media (max-width: 720px) {", 1)[1].split("\n}\n", 1)[0]
    assert ".say-long { display: none; }" in phone and ".say-short { display: inline; }" in phone


def test_whats_new_labels_app_items_and_says_what_you_can_do_today(client):
    """The apps' items say "Preview" (the apps are in development), this
    site's own items (Genesis, Orbyt, Pilot) work today and have no label;
    every item shows an arrow; one plain line says what a visitor can do
    here today. The same on the page and in the bell's pop-up."""
    from horizon import news
    page = client.get("/").text
    for where in ('id="news"', 'id="updates"'):
        box = page.split(where, 1)[1].split("</section>", 1)[0]
        assert ('<p class="news-today">Today you can plan your own idea in Genesis (free), send it to us on Orbyt, '
                "or ask Pilot. The apps are in development.</p>") in box, where
        items = re.findall(r"<li>.*?</li>", box, re.S)
        assert len(items) == len(news.NEWS)
        for li, item in zip(items, news.NEWS):
            assert '&nbsp;<i class="news-go" aria-hidden="true">→</i>' in li
            assert ('<em class="news-tag">Preview</em>' in li) == bool(item.get("app")), item["who"]
    assert any(i.get("app") for i in news.NEWS) and any(not i.get("app") for i in news.NEWS)


def test_an_open_app_or_a_demo_changes_its_label():
    from horizon import news
    item = {"app": "cyberlogix"}
    assert news.label(item) == "Preview"
    assert news.label(item, demo_urls={"cyberlogix": "https://demo.example"}) == "In the demo"
    assert news.label(item, open_urls={"cyberlogix": "https://app.example"}) == ""
    assert news.label({"who": "Genesis"}) == ""


def test_learn_more_links_a_demo_only_where_one_is_set(client, monkeypatch):
    """No public demo is set by default, so no "See the demo" link at all (no
    made-up links). With CYBERLOGIX_DEMO_URL set, only CyberLogix's Learn
    more links it, and its What's new item says "In the demo"."""
    page = client.get("/").text
    assert "See the demo" not in page and "In the demo" not in page
    monkeypatch.setenv("CYBERLOGIX_DEMO_URL", "https://demo.cyberlogix.example/")
    monkeypatch.setenv("RANKUP_DEMO_URL", "demo.rankup.example")  # not a whole address: ignored
    page = client.get("/").text
    learn = page.split('id="learn-cyberlogix"', 1)[1].split("</section>", 1)[0]
    assert ('<a class="learn-demo" href="https://demo.cyberlogix.example/" rel="noopener">See the demo (pretend data) '
            '<span aria-hidden="true">→</span></a>') in learn
    assert page.count("See the demo (pretend data)") == 1
    bell = page.split('id="updates"', 1)[1].split("</section>", 1)[0]
    cyber = [li for li in re.findall(r"<li>.*?</li>", bell, re.S) if "<b>CyberLogix AI</b>" in li]
    assert cyber and all('<em class="news-tag">In the demo</em>' in li for li in cyber)


def test_a_computer_shows_the_newest_update_in_one_line(client):
    """A small What's new strip under the hero's buttons on a computer: the
    newest item, linked, and "All updates" opening the bell's pop-up. The
    phone has the whole list on the page, so the strip is hidden there."""
    from horizon import news
    page = client.get("/").text
    hero = page.split('<section class="hero">', 1)[1].split("</section>", 1)[0]
    strip = hero.split('<p class="news-strip">', 1)[1].split("</p>", 1)[0]
    top = news.items()[0]
    assert f'<a class="news-strip-item" href="{top["href"]}" title="{top["text"]}"><b>{top["who"]}</b>' in strip.replace("&#34;", '"')
    assert '<a class="news-strip-all" href="#updates">All updates</a>' in strip
    late = _late_css()
    assert "@media (max-width: 900px) {\n  .page .news-strip { display: none; }" in late
    assert "white-space: nowrap" in late.split(".news-strip-item span {", 1)[1].split("}", 1)[0]


def test_the_new_strip_shows_a_short_headline_whole(client):
    """1.22.0: the strip cut the newest item's sentence off with "..." on a
    computer. Each item now has a short headline, and the strip shows it
    whole: never clipped."""
    from horizon import news
    for item in news.NEWS:
        assert item["headline"].strip() and len(item["headline"]) <= news.HEADLINE_MOST, item
        assert not item["headline"].endswith((".", "…", "...")), item
    hero = client.get("/").text.split('<section class="hero">', 1)[1].split("</section>", 1)[0]
    strip = hero.split('<p class="news-strip">', 1)[1].split("</p>", 1)[0]
    assert f'<span>{news.NEWS[0]["headline"]}</span>' in strip
    rules = Path("static/css/site.css").read_text(encoding="utf-8").split("/* ---------- 1.22.0:", 1)[1]
    span = rules.split(".news-strip-item span {", 1)[1].split("}", 1)[0]
    assert "text-overflow: clip" in span and "overflow: visible" in span


def test_card_tags_stay_on_one_line_and_phone_screens_say_tap_to_see(client):
    """1.22.0: at 1024-1100px the tags wrapped onto two lines beside the
    icon (now left out there; one line everywhere else), and on a phone
    nothing said the small screen opens bigger."""
    page = client.get("/").text
    apps = page.split('<section id="apps"', 1)[1].split("</section>", 1)[0]
    assert apps.count('<span class="app-shot-cue">Tap to see</span></a>') == 3
    rules = Path("static/css/site.css").read_text(encoding="utf-8").split("/* ---------- 1.22.0:", 1)[1]
    assert "@media (min-width: 901px) and (max-width: 1100px) {\n  .page .app-card .tags { display: none; }" in rules
    assert ".app-shot-cue { display: none; }" in rules
    phone = rules.split("@media (max-width: 720px) {", 1)[1].split("\n}", 1)[0]
    assert ".app-shot-cue { display: block;" in phone


def test_orbyt_stays_in_the_top_links_at_1280(client):
    """1.18 hid Orbyt's top link below 1320px, so a 1280px laptop had no
    Orbyt in the menu bar. Now only its "Work with MTRX Horizyn" waits."""
    css = Path("static/css/site.css").read_text(encoding="utf-8")
    assert ".nav-vortex { display: none; }" not in css
    assert "@media (max-width: 1440px) {\n  .page .mainnav .orbyt-sub { display: none; }" in css
    nav = client.get("/").text.split('<nav class="mainnav"', 1)[1].split("</nav>", 1)[0]
    assert 'href="/orbyt" class="nav-vortex"' in nav


def test_the_card_screens_are_whole_on_a_computer_and_bigger_on_a_phone(client):
    """1.17/1.18 pushed each card's screen 26% below the card's edge, so its
    bottom was cut off; on a phone it was a 46 x 62 px thumbnail. Now it sits
    whole inside the card (below the tags), and on a phone it is 54 x 90 px
    in its own column; pressing it opens Learn more."""
    late = _late_css()
    desk = late.split(".page .app-card .app-shot {", 1)[1].split("}", 1)[0]
    assert "transform: none" in desk and "height: calc(100% - clamp(72px, 9.4vh, 88px))" in desk
    phone = late.split("@media (max-width: 720px) {\n  .page .app-card {", 1)[1].split("\n}\n", 1)[0]
    assert "width: 54px; height: 90px" in phone and "grid-column: 3; grid-row: 1 / span 2" in phone
    page = client.get("/").text
    for key in ("rankup", "cyberlogix", "omniarmor"):
        card = page.split(f'data-app="{key}"', 1)[1].split("</article>", 1)[0]
        assert f'<a class="app-shot" href="#learn-{key}"' in card


def test_the_sites_own_pilot_answers_in_node():
    """1.22.0: Home's "What's ready today?" and "Which app fits me?",
    Orbyt's "Which form is for me?" (no "Open Orbyt" while on Orbyt), and
    Genesis's "Show my projects" and "What's my next step?" are answered at
    once, with no AI key and nothing sent (tests/js/site_pilot_answers.test.js)."""
    import shutil
    import subprocess
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is not installed here (CI has it)")
    result = subprocess.run([node, "--test", "--test-reporter=tap", "tests/js/site_pilot_answers.test.js"],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "# fail 0" in result.stdout


def test_pilot_facts_carry_each_apps_key(client):
    """The key lets Pilot link a founding app to its Learn more card."""
    import html
    page = client.get("/").text
    apps = json.loads(html.unescape(re.search(r'data-apps="([^"]*)"', page).group(1)))
    assert [a["key"] for a in apps][:3] == ["rankup", "cyberlogix", "omniarmor"]
    assert all(set(a) == {"key", "name", "line", "open", "url"} for a in apps)
