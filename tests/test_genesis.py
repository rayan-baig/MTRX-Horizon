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
SCRIPTS = ("static/js/genesis-store.js", "static/js/genesis.js")


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


def test_genesis_sends_nothing_but_ask_genesis():
    """The projects never leave the browser. The one request the page can
    make is Ask Genesis, and the server has no other Genesis address that
    takes anything in."""
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
    for route in main.app.routes:
        path = getattr(route, "path", "")
        if "genesis" in path and getattr(route, "methods", set()) - {"GET", "HEAD"}:
            assert path == "/api/genesis/ask", path


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
    result = subprocess.run([node, "--test", str(ROOT / "tests/js/genesis_store.test.js")],
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
