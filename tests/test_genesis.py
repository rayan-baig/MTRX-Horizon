"""Genesis: anyone can turn an idea into a project at /genesis.

The projects stay in the visitor's own browser. These check the page keeps
the site's promises (no cookies, the strict security policy, nothing sent
to the server), and run the storage rules' own tests in Node.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.test_lock import ORIGIN, client, make_client, owner  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ("static/js/genesis-store.js", "static/js/genesis.js", "static/js/genesis-pro.js",
           "static/js/genesis-pro-welcome.js")


def test_genesis_opens_for_anyone_with_the_site_rules(client):
    from horizon import main
    for method in (client.get, client.head):
        response = method("/genesis")
        assert response.status_code == 200
    response = client.get("/genesis")
    assert response.headers["content-security-policy"] == main.CSP
    assert "set-cookie" not in response.headers
    assert "x-robots-tag" not in response.headers
    page = response.text
    assert "<h1 class=\"g-title\">Genesis</h1>" in page
    for stage in ("Spark", "Launch"):
        assert stage in client.get("/static/js/genesis-store.js").text


def test_genesis_page_has_no_inline_script_or_style(client):
    page = client.get("/genesis").text
    assert 'style="' not in page and "<style" not in page
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", page)
    assert not re.search(r"\son[a-z]+=", page)  # no onclick= and the like
    assert 'src="http' not in page and '<link rel="stylesheet" href="http' not in page
    for path in ("/static/css/genesis.css", "/static/js/genesis-store.js", "/static/js/genesis.js"):
        assert re.search(re.escape(path) + r"\?v=[0-9a-f]{10}", page), path


def test_genesis_sends_nothing_but_ask_genesis(client):
    """The projects never leave the browser. The one request the free page
    can make is Ask Genesis. The server's only other Genesis addresses are
    Genesis Pro's, and while Pro is off (the default) each one is "page not
    found" and the page doesn't load Pro's script."""
    from horizon import main
    store = (ROOT / "static/js/genesis-store.js").read_text()
    page = (ROOT / "static/js/genesis.js").read_text()
    for call in ("fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource"):
        assert call not in store, call
    assert page.count("fetch(") == 1 and 'fetch("/api/genesis/ask"' in page
    for call in ("XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource"):
        assert call not in page, call
    for script in (store, page):
        for unsafe in (".innerHTML", "insertAdjacentHTML", "document.write"):
            assert unsafe not in script
    # What Ask Genesis sends: the four project fields, the helper and the question.
    sent = page.split('body: JSON.stringify({', 1)[1].split("}),", 1)[0]
    assert "notes" not in sent and "ticks" not in sent and "address" not in sent
    assert "genesis-pro" not in client.get("/genesis").text
    for route in main.app.routes:
        path = getattr(route, "path", "")
        if "genesis" in path and getattr(route, "methods", set()) - {"GET", "HEAD"}:
            if path == "/api/genesis/ask":
                continue
            assert path.startswith("/api/genesis/pro/"), path
            assert client.post(path, json={}, headers=ORIGIN).status_code == 404, path


def test_genesis_form_cannot_send(client):
    page = client.get("/genesis").text
    for form in re.findall(r"<form[^>]*>", page):
        assert "action=" not in form and "method=" not in form


def test_genesis_scripts_parse():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is not installed here (CI has it)")
    for script in SCRIPTS:
        subprocess.run([node, "--check", str(ROOT / script)], check=True)


def test_genesis_storage_rules_in_node():
    """Saves, reloads, imports, exports, and survives blocked storage."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is not installed here (CI has it)")
    result = subprocess.run([node, "--test", "--test-reporter=tap",
                             str(ROOT / "tests/js/genesis_store.test.js")],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "# fail 0" in result.stdout


def test_privacy_page_says_where_genesis_keeps_projects(client):
    page = client.get("/privacy").text
    assert ('Genesis projects stay in your browser, except the text you choose to send with "Ask Genesis",\n'
            "    which goes to our AI provider to write the answer; we keep only counts.") in page
    assert "kept for\n  24 hours" in page


def test_genesis_is_linked_from_the_home_page_and_listed(client, monkeypatch):
    page = client.get("/").text
    nav = page.split('class="mainnav"', 1)[1].split("</nav>", 1)[0]
    footer = page.split('<footer class="footer">', 1)[1].split("</footer>", 1)[0]
    assert 'href="/genesis"' in nav and 'href="/genesis"' in footer
    monkeypatch.setenv("MTRX_PUBLIC_URL", "https://mtrx.example")
    assert "<loc>https://mtrx.example/genesis</loc>" in client.get("/sitemap.xml").text
    for path in ("/privacy", "/terms", "/brand"):
        assert 'href="/genesis"' in client.get(path).text


def test_genesis_page_is_compressed(client):
    response = client.get("/genesis", headers={"Accept-Encoding": "gzip"})
    assert response.headers.get("content-encoding") == "gzip"


def test_the_owner_console_links_to_genesis(client):
    owner(client)
    assert 'href="/genesis"' in client.get("/console").text


# ---------------------------------------------------------------- 1.10.0

def test_a_first_visit_never_starts_at_a_blank_page(client):
    """What Genesis is, in one line, a one-tap example, and how it works in
    three steps; the row of counts waits until there are projects to count."""
    page = client.get("/genesis").text
    hero = page.split('<section class="g-hero panel">', 1)[1].split("</section>", 1)[0]
    assert "Turn your idea into a real plan, one small step at a time." in hero
    assert 'href="#new">Start my idea' in hero and 'href="#example"' in hero
    assert hero.count("<li class=\"stage-") == 3
    assert '<ol class="g-path" id="g-path" hidden>' in hero
    assert 'id="g-example"' in page  # "Stuck? Fill in an example" on the form
    script = (ROOT / "static/js/genesis.js").read_text()
    assert 'hash === "#example"' in script and "S.example(" in script


def test_todays_spark_is_kept_in_the_browser_and_never_nags(client):
    page = client.get("/genesis").text
    daily = page.split('<section class="panel g-daily"', 1)[1].split("</section>", 1)[0]
    assert 'id="g-daily-form" novalidate' in daily and "Turn it into a project" in daily
    assert "Clear my sparks" in daily
    script = (ROOT / "static/js/genesis.js").read_text()
    section = script.split("// ---------------------------------------------------------------- today's spark", 1)[1] \
        .split("// ---------------------------------------------------------------- the form", 1)[0]
    # Only this browser's storage: nothing is sent, and nothing reminds or counts down.
    for call in ("fetch(", "Notification", "serviceWorker", "setInterval", "PushManager", "vibrate"):
        assert call not in section, call
    assert "S.openDaily(" in script and "freeze" in section
    for pressure in ("don't lose", "hurry", "last chance", "or lose", "expires"):
        assert pressure not in section.lower(), pressure


def test_an_idea_card_is_drawn_in_the_browser_from_the_card_fields_only(client):
    page = client.get("/genesis").text
    dialog = page.split('<dialog class="g-share"', 1)[1].split("</dialog>", 1)[0]
    assert '<canvas id="g-share-canvas" width="1080" height="1080">' in dialog
    assert "leave out full\n      names, your school, address or phone number" in dialog
    script = (ROOT / "static/js/genesis.js").read_text()
    card = script.split("function drawCard(", 1)[1].split("function cardBlob(", 1)[0]
    assert "notes" not in card and ".ticks" not in card
    # No link carries an idea: nothing a visitor wrote is put in an address.
    for leak in ("btoa(", "encodeURIComponent(", "location.search", "#see/", "?idea="):
        assert leak not in script, leak
    assert script.count("fetch(") == 1


def test_free_and_pro_side_by_side_only_while_pro_is_on(client):
    page = client.get("/genesis").text
    assert "g-compare" not in page and "Genesis Pro" not in page
    script = (ROOT / "static/js/genesis.js").read_text()
    # The upgrade note shows only when the free help is used up, Pro is
    # switched on here and this browser doesn't have it.
    assert "if (last.limit && proOffered && !isPro())" in script


def test_privacy_page_says_where_sparks_and_cards_stay(client):
    page = " ".join(client.get("/privacy").text.split())
    assert ("Your answers to Genesis's daily spark, and your streak, are kept the same way: in your browser "
            "only, never sent to us") in page
    assert "An idea card is drawn in your browser too" in page


# ---------------------------------------------------------------- 1.11.0: rough edges

def test_typing_stops_at_the_limit_the_counter_shows():
    """The counters said 60/140/120 while the boxes took 80/160/140."""
    script = (ROOT / "static/js/genesis.js").read_text()
    assert "$(`g-${f}`).maxLength = S.LIMITS[f];" in script
    assert "S.LIMITS[f] + 20" not in script
    store = (ROOT / "static/js/genesis-store.js").read_text()
    assert "name: 60, pitch: 140, audience: 120" in store


def test_a_saved_spark_is_said_in_the_card_and_toasts_never_cover_the_list(client):
    page = client.get("/genesis").text
    done = page.split('id="g-daily-done"', 1)[1].split("</div>", 1)[0]
    assert '<p class="g-daily-saved" id="g-daily-saved" role="status"></p>' in done
    script = (ROOT / "static/js/genesis.js").read_text()
    section = script.split("// ---------------------------------------------------------------- today's spark", 1)[1] \
        .split("// ---------------------------------------------------------------- the form", 1)[0]
    assert '$("g-daily-saved").textContent' in section and 'toast(st.streak' not in section
    css = (ROOT / "static/css/genesis.css").read_text()
    toast = css.split(".g-toast {", 1)[1].split("}", 1)[0]
    assert "top: calc(12px" in toast and "bottom:" not in toast


def test_the_next_step_box_leads_to_ask_genesis_only_while_ai_is_on():
    script = (ROOT / "static/js/genesis.js").read_text()
    box = script.split("function nextBox(", 1)[1].split("// ---------------------------------------------------------------- idea cards", 1)[0]
    assert 'if (aiOn) {' in box and '"Ask Genesis"' in box and 'document.querySelector(".g-ask")' in box


def test_later_stages_start_folded_and_steps_can_be_hidden_or_added():
    script = (ROOT / "static/js/genesis.js").read_text()
    project = script.split("function drawProject(", 1)[1].split("// ---------------------------------------------------------------- the next step", 1)[0]
    assert 'el("details", { class: `g-group' in project
    assert "at === here || (at < here && s.done < s.total)" in project
    assert "S.hideStep(" in project and "S.showStep(" in project and "S.steps(p)" in project
    assert "Hidden steps (" in project
    assert "S.addStep(" in script and "input.maxLength = S.LIMITS.step;" in script
    # Every word a visitor typed goes in with textContent, never as HTML.
    assert "innerHTML" not in script and "insertAdjacentHTML" not in script
