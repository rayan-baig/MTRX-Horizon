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


@pytest.mark.parametrize("typed", ["   ", "rankup.example", "javascript:alert(1)", "https://", "http://[::1"])
def test_no_open_app_button_for_an_address_that_is_not_one(client, monkeypatch, typed):
    """A blank or half-typed address gives no button, rather than a link to
    nowhere on this site."""
    monkeypatch.setenv("RANKUP_URL", typed)
    page = client.get("/").text
    assert 'aria-label="Open RankUp"' not in page and 'href="rankup.example"' not in page
    assert "RankUp opens to the public soon." in page


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
    Learn more lists open over the page rather than making it longer."""
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
    import re
    from horizon import stats

    page = client.get("/").text
    sheet = page.split('id="projects"', 1)[1].split("</section>", 1)[0]
    rows = re.findall(r"<li><span><b>(.*?)</b><small>(.*?)</small></span>\s*"
                      r'<em class="status">(.*?)</em><span class="next">Next: (.*?)</span></li>', sheet)
    assert rows == [(p["name"], p["kind"], p["status"], p["next"]) for p in stats.PROJECTS]
    # The count in the panel is the length of that same list.
    assert f"<dt>Projects</dt><dd>{len(stats.PROJECTS)}</dd>" in page


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
    assert "font-src 'self'" in csp and "googleapis" not in csp and "gstatic" not in csp
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
    narrow = css.split("@media (max-width: 1280px) {", 1)[1].split("\n}\n", 1)[0]
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
    assert "MTRX Horizyn is the parent company of three apps" in hero
    # Each app is named in that first paragraph, and each name opens its card.
    for key, name in (("rankup", "RankUp"), ("cyberlogix", "CyberLogix AI"),
                      ("omniarmor", "OmniArmor.ai")):
        assert f'<a href="#learn-{key}">{name}</a>' in hero
        assert "An MTRX Horizyn app" in _sheet(page, f"learn-{key}")
    nav = page.split('class="mainnav"', 1)[1].split("</nav>", 1)[0]
    assert '<a href="#company">About</a>' in nav


def test_about_lists_the_three_apps_with_their_links(client, monkeypatch):
    monkeypatch.setenv("OMNIARMOR_URL", "https://omniarmor.example.com")
    about = _sheet(client.get("/").text, "company")
    assert "MTRX Horizyn is a software company" in about and "parent company of three apps" in about
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
    page = client.get("/").text
    assert "mailto:" not in page and "Business enquiries" not in page
    monkeypatch.setenv("MTRX_CONTACT_EMAIL", "  hello@example.com ")
    page = client.get("/").text
    assert 'href="mailto:hello@example.com"' in page
    assert "Business enquiries" in _sheet(page, "company")
    footer = page.split('<footer class="footer">', 1)[1].split("</footer>", 1)[0]
    assert '<a href="mailto:hello@example.com">Business enquiries</a>' in footer


@pytest.mark.parametrize("typed", ["not-an-address", "a@b", "x@example.com?bcc=y@evil.example",
                                   "<x@example.com>", "x y@example.com", '"x"@example.com'])
def test_a_contact_setting_that_is_not_a_plain_address_shows_nothing(client, monkeypatch, typed):
    monkeypatch.setenv("MTRX_CONTACT_EMAIL", typed)
    page = client.get("/").text
    assert "mailto:" not in page and "Business enquiries" not in page


def test_no_email_address_is_written_into_the_site():
    """The contact address comes only from the setting: none is typed into a
    page, a script or the code."""
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    email = re.compile(r"[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
    for folder in ("templates", "static/js", "static/css", "horizon"):
        for path in (root / folder).rglob("*"):
            if path.suffix in (".html", ".js", ".css", ".py", ".webmanifest"):
                found = email.findall(path.read_text(encoding="utf-8"))
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
