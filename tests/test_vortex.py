"""Orbyt: partners, ideas, investors and buyers at /orbyt.

A visitor sends a short form; it is kept so the owner can read it in the
console and reply, then deleted after a year. These check the page keeps the
site's rules, every field is checked, abuse is held back, nothing about the
sender beyond what they typed is kept, the owner's email holds no personal
details, and only the owner can read or change the messages.
"""

import json
import re
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

import pytest

from tests.test_lock import ORIGIN, approved, client, make_client, owner  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
SECRET = "violet-harbour-4471"  # stands for something private in a message

PARTNER = {"kind": "partner", "name": "Grace Example", "organisation": "Example Logistics Ltd",
           "email": "grace@example.com", "apps": ["omniarmor", "cyberlogix"], "partnership": "resell",
           "message": f"We run forty cold stores. {SECRET}"}
PITCH = {"kind": "pitch", "name": "Ada", "email": "ada@example.com", "idea": "Nova",
         "pitch": "Homework reminders that actually work", "audience": "Students who forget what's due",
         "message": f"We have a prototype.\n\nCould we talk? {SECRET}"}
INVEST = {"kind": "invest", "name": "Sam Lee", "organisation": "", "email": "sam@example.com",
          "message": f"I'd like to hear about your plans. {SECRET}"}
BUY = {"kind": "buy", "name": "Jo Buyer", "organisation": "Example Holdings", "email": "jo@example.com",
       "apps": ["rankup", "company"], "message": f"We'd like to talk about buying. {SECRET}"}
# 1.20.0: about shares, apps and companies only, so it stays true while
# Orbyt Pitch Review (an optional paid extra for a pitch) is on.
BUY_NOTICE = ("This only starts a conversation. No shares, apps or companies are bought or sold here, and "
              "no deal happens on this page.")


def send(client, body, headers=None):
    return client.post("/api/vortex/send", json=body, headers={**ORIGIN, **(headers or {})})


def rows():
    from horizon import db
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM vortex_messages ORDER BY id")]


# ---------------------------------------------------------------- the page

def test_vortex_opens_for_anyone_with_the_site_rules(client):
    from horizon import main
    for method in (client.get, client.head):
        assert method("/orbyt").status_code == 200
    response = client.get("/orbyt")
    assert response.headers["content-security-policy"] == main.CSP
    assert "set-cookie" not in response.headers
    assert "x-robots-tag" not in response.headers
    page = response.text
    assert '<h1 class="v-title"><span>Orbyt</span></h1>' in page
    assert 'style="' not in page and "<style" not in page
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", page)
    assert not re.search(r"\son[a-z]+=", page)
    assert 'src="http' not in page and '<link rel="stylesheet" href="http' not in page
    for path in ("/static/css/vortex.css", "/static/js/genesis-store.js", "/static/js/vortex-form.js",
                 "/static/js/vortex.js"):
        assert re.search(re.escape(path) + r"\?v=[0-9a-f]{10}", page), path
        assert client.get(path).status_code == 200
    # The forms have no address of their own: the script sends them.
    for form in re.findall(r"<form[^>]*>", page):
        assert "action=" not in form and "method=" not in form


def test_chroma_vortex_redirects_to_orbyt(client):
    response = client.get("/chroma-vortex", follow_redirects=False)
    assert response.status_code == 301 and response.headers["location"] == "/orbyt"
    assert client.get("/chroma-vortex").url.path == "/orbyt"


def test_the_four_paths_and_what_each_says(client):
    page = client.get("/orbyt").text
    for path in ('href="#partner"', 'href="#pitch"', 'href="#invest"', 'href="#buy"'):
        assert path in page
    for title in ("Partner with us", "Pitch an idea", "Investors", "Buy the company or an app", "Business enquiries"):
        assert title in page
    # Pitch and Partner, then one row for investors and buyers (1.16.0).
    assert page.count('class="v-path ') == 3
    for app in ("RankUp", "CyberLogix AI", "OmniArmor.ai"):
        assert app in page
    assert "If you're under 13, ask a parent or guardian to send this for you." in page
    assert "Bring a project from Genesis" in page
    notice = " ".join(page.split('<p class="v-notice">', 1)[1].split("</p>", 1)[0].split())
    assert notice == ("Just so you know: we're not selling shares or asking anyone for money here, and "
                      "nothing on this site is an investment. If you'd like to talk, leave your details "
                      "and we'll get back to you.")
    # No promises about money anywhere on the page.
    for word in ("return on", "returns", "valuation", "raising a round", "equity offered"):
        assert word not in page.lower()


def test_the_honeypot_is_hidden_by_a_css_class(client):
    page = client.get("/orbyt").text
    assert page.count('<div class="v-trap" aria-hidden="true">') == 4
    assert 'name="website"' in page
    css = (ROOT / "static/css/vortex.css").read_text()
    rule = css.split(".v-trap {", 1)[1].split("}", 1)[0]
    assert "left: -10000px" in rule and "overflow: hidden" in rule


def test_vortex_is_linked_from_the_home_page_and_listed(client, monkeypatch):
    from horizon import main
    page = client.get("/").text
    nav = page.split('class="mainnav"', 1)[1].split("</nav>", 1)[0]
    footer = page.split('<footer class="footer">', 1)[1].split("</footer>", 1)[0]
    menu = page.split('<nav class="sheet-card menu"', 1)[1].split("</nav>", 1)[0]
    for part in (nav, footer, menu):
        assert 'href="/orbyt"' in part
    for path in ("/genesis", "/privacy", "/terms", "/brand"):
        other = client.get(path).text
        assert 'href="/orbyt"' in other.split('class="mainnav"', 1)[1].split("</nav>", 1)[0], path
    assert "/orbyt" in main.PUBLIC_PAGES
    monkeypatch.setenv("MTRX_PUBLIC_URL", "https://mtrx.example")
    assert "<loc>https://mtrx.example/orbyt</loc>" in client.get("/sitemap.xml").text


def test_vortex_page_is_compressed(client):
    response = client.get("/orbyt", headers={"Accept-Encoding": "gzip"})
    assert response.headers.get("content-encoding") == "gzip"


def test_genesis_has_the_way_to_pitch_a_project():
    script = (ROOT / "static/js/genesis.js").read_text()
    assert "Pitch this in Orbyt" in script and 'href: "/orbyt#pitch"' in script
    assert "S.offerToVortex(session, p.id)" in script


def test_the_vortex_scripts_send_only_the_form():
    page = (ROOT / "static/js/vortex.js").read_text()
    rules = (ROOT / "static/js/vortex-form.js").read_text()
    # The form, and (only while Pitch Review is on and a pitch was just sent)
    # its checkout, which sends the one-time ticket and the 18+ tick only.
    assert page.count("fetch(") == 2 and 'fetch("/api/vortex/send"' in page
    assert 'fetch("/api/orbyt/review/checkout"' in page
    assert "body: JSON.stringify({ ticket: reviewTicket, adult: true })" in page
    assert page.count('credentials: "omit"') == 2
    assert "fetch(" not in rules
    for script in (page, rules):
        for call in ("XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "location.search"):
            assert call not in script, call
        for unsafe in (".innerHTML", "insertAdjacentHTML", "document.write"):
            assert unsafe not in script


def test_the_browser_checks_match_the_servers():
    """The page warns about the same limits and choices the server enforces."""
    from horizon import vortex
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is not installed here (CI has it)")
    out = subprocess.run([node, "-e", "const V = require(process.argv[1]); console.log(JSON.stringify("
                                      "{LIMITS: V.LIMITS, KINDS: V.KINDS, COMPANY: V.COMPANY, PARTNERSHIPS: V.PARTNERSHIPS, FIELDS: V.FIELDS}))",
                          str(ROOT / "static/js/vortex-form.js")], capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    assert js["LIMITS"] == vortex.LIMITS
    assert js["KINDS"] == list(vortex.KINDS) and js["COMPANY"] == vortex.COMPANY
    assert js["PARTNERSHIPS"] == list(vortex.PARTNERSHIPS)
    assert js["FIELDS"] == {k: {"required": list(v["required"]), "optional": list(v["optional"])}
                            for k, v in vortex.FIELDS.items()}


def test_vortex_scripts_parse():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is not installed here (CI has it)")
    for script in ("static/js/vortex-form.js", "static/js/vortex.js", "static/js/genesis-store.js"):
        subprocess.run([node, "--check", str(ROOT / script)], check=True)


def test_the_genesis_hand_off_pre_fills_in_node():
    """Pitch this in Orbyt: only the id is handed over, and the idea
    fields are filled from the visitor's own Genesis storage."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is not installed here (CI has it)")
    result = subprocess.run([node, "--test", "--test-reporter=tap",
                             str(ROOT / "tests/js/vortex_handoff.test.js")],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "# fail 0" in result.stdout and "# pass 5" in result.stdout


# ---------------------------------------------------------------- sending

@pytest.mark.parametrize("body", [PARTNER, PITCH, INVEST, BUY], ids=["partner", "pitch", "invest", "buy"])
def test_each_path_sends_and_is_stored(client, body):
    response = send(client, body)
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "message": "Sent.", "email": body["email"]}
    assert "set-cookie" not in response.headers
    (row,) = rows()
    assert row["kind"] == body["kind"] and row["email"] == body["email"] and row["name"] == body["name"]
    assert row["message"] == body["message"]
    assert abs(row["at"] - time.time()) < 60
    assert row["read_at"] is None and row["archived_at"] is None
    if body["kind"] == "partner":
        assert row["apps"] == "cyberlogix,omniarmor" and row["partnership"] == "resell"
        assert row["organisation"] == "Example Logistics Ltd"
    if body["kind"] == "pitch":
        assert (row["idea"], row["pitch"], row["audience"]) == (body["idea"], body["pitch"], body["audience"])
        assert row["organisation"] == "" and row["apps"] == ""
    if body["kind"] == "invest":
        assert row["organisation"] == "" and row["idea"] == ""
    if body["kind"] == "buy":
        # The company first, then the apps in the catalog's order.
        assert row["apps"] == "company,rankup" and row["organisation"] == "Example Holdings"
        assert row["partnership"] == "" and row["idea"] == ""


def test_fields_another_path_has_are_not_kept(client):
    assert send(client, {**PITCH, "organisation": "Sneaky", "apps": ["rankup"], "partnership": "resell",
                         "extra": "x" * 50}).status_code == 200
    (row,) = rows()
    assert row["organisation"] == "" and row["apps"] == "" and row["partnership"] == ""


def test_text_is_tidied(client):
    assert send(client, {**PITCH, "name": "  Ada\u0000 \n Lovelace‮ ",
                         "message": "Line one\r\n\r\n\r\n\r\nLine two\u0007"}).status_code == 200
    (row,) = rows()
    assert row["name"] == "Ada Lovelace"
    assert row["message"] == "Line one\n\nLine two"


@pytest.mark.parametrize("change, field", [
    ({"kind": "spam"}, "kind"),
    ({"kind": None}, "kind"),
    ({"name": ""}, "name"),
    ({"name": "   "}, "name"),
    ({"name": "x" * 81}, "name"),
    ({"name": 42}, "name"),
    ({"name": "Visit https://spam.example"}, "name"),
    ({"email": "not-an-email"}, "email"),
    ({"email": "ada@example"}, "email"),
    ({"email": "ada@example.com?bcc=other@example.com"}, "email"),
    ({"email": "a b@example.com"}, "email"),
    ({"email": "x" * 250 + "@example.com"}, "email"),
    ({"idea": ""}, "idea"),
    ({"idea": "x" * 61}, "idea"),
    ({"pitch": "x" * 141}, "pitch"),
    ({"audience": ""}, "audience"),
    ({"message": "x" * 3001}, "message"),
    ({"message": ["a list"]}, "message"),
])
def test_bad_input_is_refused_and_nothing_kept(client, change, field):
    response = send(client, {**PITCH, **change})
    assert response.status_code == 400
    assert response.json()["field"] == field and response.json()["error"]
    assert rows() == []


@pytest.mark.parametrize("change, field", [
    ({"apps": []}, "apps"),
    ({"apps": "rankup"}, "apps"),
    ({"apps": ["rankup", "somethingelse"]}, "apps"),
    ({"apps": [1]}, "apps"),
    ({"apps": ["rankup"] * 4}, "apps"),
    ({"partnership": "merger"}, "partnership"),
    ({"partnership": ""}, "partnership"),
    ({"organisation": ""}, "organisation"),
    ({"message": ""}, "message"),
])
def test_partner_choices_are_checked(client, change, field):
    response = send(client, {**PARTNER, **change})
    assert response.status_code == 400 and response.json()["field"] == field
    assert rows() == []


def test_investors_need_a_message_but_not_an_organisation(client):
    assert send(client, {**INVEST, "message": ""}).status_code == 400
    assert send(client, {k: v for k, v in INVEST.items() if k != "organisation"}).status_code == 200


def test_a_message_that_is_mostly_links_is_refused(client):
    links = " ".join(f"https://spam{i}.example/buy-now-cheap" for i in range(3))
    for message in (links, f"Look {links}", " ".join(f"www.x{i}.example" for i in range(6))):
        response = send(client, {**INVEST, "message": message})
        assert response.status_code == 400 and "mostly links" in response.json()["error"]
    assert rows() == []
    # A link or two inside real words is fine.
    ok = "We make delivery software for cold chains, see https://example.com/about for more."
    assert send(client, {**INVEST, "message": ok}).status_code == 200


def test_a_body_too_big_is_not_read(client):
    huge = {**PITCH, "message": "x" * 20_000}
    assert send(client, huge).status_code == 400
    assert rows() == []


def test_the_honeypot_drops_the_message_quietly(client, monkeypatch):
    from horizon import health
    sent = []
    monkeypatch.setattr(health, "send_email", lambda s, b: sent.append(s) or True)
    monkeypatch.setenv("MTRX_ALERT_EMAIL", "owner@example.com")
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    response = send(client, {**PITCH, "website": "https://bot.example"})
    assert response.status_code == 200 and response.json()["ok"] is True
    assert "email" not in response.json()
    time.sleep(0.2)
    assert rows() == [] and sent == []


def test_a_bad_origin_is_refused(client):
    for headers in ({}, {"Origin": "https://evil.example"}, {"Origin": "https://rankup.testserver"}):
        response = client.post("/api/vortex/send", json=PITCH, headers=headers)
        assert response.status_code == 403
    assert rows() == []


def test_sending_is_limited_per_address(client, monkeypatch):
    monkeypatch.setenv("MTRX_TRUST_PROXY", "1")
    one = {"X-Forwarded-For": "203.0.113.5"}
    for _ in range(5):
        assert send(client, PITCH, one).status_code == 200
    busy = send(client, PITCH, one)
    assert busy.status_code == 429 and "a few messages" in busy.json()["error"]
    # Somebody else is not held back.
    assert send(client, PITCH, {"X-Forwarded-For": "198.51.100.7"}).status_code == 200
    assert len(rows()) == 6


def test_sending_is_limited_per_day(client, monkeypatch):
    from horizon import db
    monkeypatch.setenv("MTRX_TRUST_PROXY", "1")
    who = {"X-Forwarded-For": "203.0.113.6"}
    # Twenty sends earlier today, spread over the hours before this one.
    with db.connect() as conn:
        for i in range(20):
            conn.execute("INSERT INTO attempts (kind, who, at) VALUES ('vortex', ?, ?)",
                         ("203.0.113.6", time.time() - 2 * 3600 - i * 600))
    assert send(client, PITCH, who).status_code == 429
    monkeypatch.setenv("VORTEX_PER_DAY", "25")
    assert send(client, PITCH, who).status_code == 200


def test_refused_sends_are_not_counted(client):
    for _ in range(10):
        assert send(client, {**PITCH, "email": "nope"}).status_code == 400
    assert send(client, PITCH).status_code == 200


def test_no_address_or_cookie_is_stored_with_a_message(client, monkeypatch, caplog):
    from horizon import db
    monkeypatch.setenv("MTRX_TRUST_PROXY", "1")
    client.cookies.set("tracker", "cookie-value-123")
    response = send(client, PITCH, {"X-Forwarded-For": "203.0.113.77", "User-Agent": "Agent/9.9"})
    assert response.status_code == 200
    with db.connect() as conn:
        columns = [r[1] for r in conn.execute("PRAGMA table_info(vortex_messages)")]
    assert columns == ["id", "at", "kind", "name", "organisation", "email", "apps", "partnership",
                       "idea", "pitch", "audience", "message", "read_at", "archived_at"]
    stored = json.dumps(rows())
    for trace in ("203.0.113", "cookie-value-123", "Agent/9.9", "testclient"):
        assert trace not in stored
    # What they wrote never reaches the server's log either.
    assert SECRET not in caplog.text


# ---------------------------------------------------------------- telling the owner

def test_the_owner_is_emailed_a_notice_with_no_personal_details(client, monkeypatch):
    from horizon import health
    sent = []
    monkeypatch.setattr(health, "send_email", lambda subject, body: sent.append((subject, body)) or True)
    monkeypatch.setenv("MTRX_ALERT_EMAIL", "owner@example.com")
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    for body in (PITCH, PARTNER, {**INVEST, "organisation": "Contact me at sam@example.com Fund"}):
        assert send(client, body).status_code == 200
    deadline = time.time() + 5
    while len(sent) < 3 and time.time() < deadline:
        time.sleep(0.05)
    assert len(sent) == 3
    subjects = sorted(s for s, _ in sent)
    assert subjects == ["MTRX Horizyn: new Orbyt message (Investors)",
                        "MTRX Horizyn: new Orbyt message (Partner with us)",
                        "MTRX Horizyn: new Orbyt message (Pitch an idea)"]
    everything = "\n".join(s + "\n" + b for s, b in sent)
    assert "Idea: Nova" in everything and "Organisation: Example Logistics Ltd" in everything
    for private in (SECRET, "We run forty", "@example.com", "Ada", "Grace", "Sam Lee",
                    "Homework reminders", "Students who forget"):
        assert private not in everything, private


def test_a_slow_mail_server_does_not_keep_the_visitor_waiting(client, monkeypatch):
    from horizon import health
    done = []
    monkeypatch.setattr(health, "send_email", lambda s, b: time.sleep(2) or done.append(s) or True)
    monkeypatch.setenv("MTRX_ALERT_EMAIL", "owner@example.com")
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    started = time.monotonic()
    assert send(client, PITCH).status_code == 200
    assert time.monotonic() - started < 1.5 and done == []


def test_a_failing_mail_server_still_keeps_the_message(client, monkeypatch, caplog):
    from horizon import health, vortex

    def broken(subject, body):
        raise ConnectionError(f"login failed for owner {SECRET}")

    monkeypatch.setattr(health, "send_email", broken)
    monkeypatch.setenv("MTRX_ALERT_EMAIL", "owner@example.com")
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    vortex.tell_owner(vortex.read_form(PITCH), wait=True)
    assert send(client, PITCH).status_code == 200
    assert len(rows()) == 1
    assert "ConnectionError" in caplog.text and SECRET not in caplog.text


def test_no_email_when_email_is_not_set_up(client, monkeypatch):
    from horizon import health
    sent = []
    monkeypatch.setattr(health, "send_email", lambda s, b: sent.append(s) or True)
    monkeypatch.delenv("MTRX_ALERT_EMAIL", raising=False)
    assert send(client, PITCH).status_code == 200
    time.sleep(0.2)
    assert sent == []


# ---------------------------------------------------------------- the console

CONSOLE_CALLS = [
    ("get", "/api/console/vortex"),
    ("get", "/api/console/vortex?box=archived"),
    ("post", "/api/console/vortex/1/read"),
    ("post", "/api/console/vortex/1/unread"),
    ("post", "/api/console/vortex/1/archive"),
    ("post", "/api/console/vortex/1/unarchive"),
    ("post", "/api/console/vortex/1/delete"),
    ("post", "/api/console/vortex/1/nonsense"),
]


def test_the_console_api_is_owner_only(client, make_client):
    assert send(client, PITCH).status_code == 200
    stranger_404 = client.get("/no-such-page")
    approved(client)  # an approved device that has not signed in is still a stranger here
    stranger = make_client()
    for c in (client, stranger):
        for method, path in CONSOLE_CALLS:
            response = getattr(c, method)(path, **({"headers": ORIGIN} if method == "post" else {}))
            assert response.status_code == 404, path
            assert response.text == stranger_404.text
            assert response.headers.get("cache-control") == stranger_404.headers.get("cache-control")
    # Nothing was changed.
    (row,) = rows()
    assert row["read_at"] is None and row["archived_at"] is None


def test_the_owner_reads_marks_archives_and_deletes(client):
    owner(client)
    for body in (PARTNER, PITCH, INVEST):
        assert send(client, body).status_code == 200
    data = client.get("/api/console/vortex").json()
    assert data["unread"] == 3 and data["archived"] == 0 and data["keep_days"] == 365
    assert [m["kind"] for m in data["messages"]] == ["invest", "pitch", "partner"]
    partner = data["messages"][2]
    assert partner["apps"] == ["CyberLogix AI", "OmniArmor.ai"]
    assert partner["partnership"] == "Resell or distribute" and partner["kind_name"] == "Partner with us"
    assert partner["email"] == "grace@example.com" and partner["message"] == PARTNER["message"]
    pid, iid = partner["id"], data["messages"][0]["id"]

    def act(mid, action):
        return client.post(f"/api/console/vortex/{mid}/{action}", headers=ORIGIN)

    assert act(pid, "read").json() == {"ok": True, "unread": 2}
    assert act(pid, "read").json()["unread"] == 2  # twice is fine
    assert act(pid, "unread").json()["unread"] == 3
    assert act(pid, "read").status_code == 200
    # Archiving moves it out of the inbox and counts as read.
    assert act(iid, "archive").json()["unread"] == 1
    inbox = client.get("/api/console/vortex").json()
    assert iid not in [m["id"] for m in inbox["messages"]] and inbox["archived"] == 1
    archived = client.get("/api/console/vortex?box=archived").json()
    assert [m["id"] for m in archived["messages"]] == [iid] and archived["messages"][0]["read"] is True
    assert act(iid, "unarchive").status_code == 200
    assert len(client.get("/api/console/vortex").json()["messages"]) == 3
    # Deleting removes it for good.
    assert act(pid, "delete").status_code == 200
    assert pid not in [r["id"] for r in rows()] and len(rows()) == 2
    # A message that is gone, or something the console can't do: not a 404,
    # which the console would take to mean "signed out".
    assert act(pid, "read").status_code == 409
    assert act(pid, "delete").status_code == 409
    assert act(iid, "explode").status_code == 400
    assert act("abc", "read").status_code == 400
    assert client.get("/api/console/vortex").status_code == 200


def test_the_console_has_a_chroma_vortex_section(client):
    owner(client)
    page = client.get("/console").text
    sidebar = page.split('<aside class="sidebar"', 1)[1].split("</aside>", 1)[0]
    top = page.split('<nav class="mainnav"', 1)[1].split("</nav>", 1)[0]
    assert 'href="#vortex"' in sidebar and 'id="vx-unread"' in sidebar
    assert 'href="#vortex"' in top
    assert 'id="vortex"' in page and 'id="vx-list"' in page
    script = client.get("/console/assets/console.js").text
    assert "/api/console/vortex" in script and "mailto:" in script
    section = script.split("// ---------------------------------------------------------------- Orbyt", 1)[1]
    section = section.split("// ---------------------------------------------------------------- loading", 1)[0]
    assert ".innerHTML" not in section and "insertAdjacentHTML" not in section


# ---------------------------------------------------------------- keeping and deleting

def test_upkeep_deletes_messages_older_than_a_year(client):
    from horizon import db, upkeep
    assert send(client, PITCH).status_code == 200
    with db.connect() as conn:
        conn.execute("UPDATE vortex_messages SET at = ?", (time.time() - 366 * 86400,))
    assert send(client, INVEST).status_code == 200
    with db.connect() as conn:
        conn.execute("UPDATE vortex_messages SET at = ? WHERE kind = 'invest'", (time.time() - 364 * 86400,))
    upkeep.run_once()
    assert [r["kind"] for r in rows()] == ["invest"]


def test_the_schema_upgrades_a_database_that_already_has_data(tmp_path, monkeypatch, make_client):
    """A live database from before Orbyt gets the new table, and
    keeps everything it had."""
    from horizon import db
    path = tmp_path / "test.db"  # the file the client fixture uses
    old_schema = db.SCHEMA.split("-- Orbyt", 1)[0]
    assert "vortex" not in old_schema
    conn = sqlite3.connect(path)
    conn.executescript(old_schema)
    conn.execute("INSERT INTO activity (at, event, detail) VALUES (1, 'Signed in', 'Old laptop')")
    conn.execute("INSERT INTO devices (id, name, public_key, created_at) VALUES ('d1', 'Old laptop', x'00', 1)")
    conn.commit()
    conn.close()

    client = make_client()  # starting the app runs db.init()
    assert send(client, PITCH).status_code == 200
    with db.connect() as conn:
        assert conn.execute("SELECT detail FROM activity WHERE event = 'Signed in'").fetchone()[0] == "Old laptop"
        assert conn.execute("SELECT name FROM devices WHERE id = 'd1'").fetchone()[0] == "Old laptop"
    assert len(rows()) == 1
    db.init()  # and again, harmlessly
    assert len(rows()) == 1


# ---------------------------------------------------------------- privacy and terms

def test_privacy_page_says_what_chroma_vortex_keeps(client):
    from horizon import main, vortex
    page = " ".join(client.get("/privacy").text.split())
    assert "No cookies for visitors." in page
    assert "<h2>Orbyt: work with MTRX Horizyn</h2>" in page
    assert "Until it opened, this site kept nothing that visitors typed." in page
    for field in ("your name, your email address and your message", "your organisation",
                  "which apps and the kind of partnership", "its name, its one-line pitch and who it's for"):
        assert field in page, field
    assert f"deleted {vortex.KEEP_DAYS} days after it arrives" in page
    assert "It is never shared" in page and "We don't keep your network address with it" in page
    assert "kept for 24 hours" in page
    assert "no forms" not in page
    assert main.LEGAL_UPDATED == "20 November 2026"


def test_terms_say_a_message_is_no_agreement_or_investment_offer(client):
    page = " ".join(client.get("/terms").text.split())
    assert "doesn't create a partnership, an agreement or any obligation" in page
    assert "Nothing on this site is an offer to sell, or a request to buy, any shares or other investment." in page


# ---------------------------------------------------------------- buying the company or an app

def test_the_buy_path_shows_its_notice_and_choices(client):
    page = client.get("/orbyt").text
    section = page.split('id="v-buy"', 1)[1].split("</section>", 1)[0]
    notice = " ".join(section.split('<p class="v-notice v-notice-buy">', 1)[1].split("</p>", 1)[0].split())
    assert notice == BUY_NOTICE
    assert 'data-kind="buy"' in section
    for field in ('name="name"', 'name="organisation"', 'name="email"', 'name="message"'):
        assert field in section
    assert 'value="company"' in section and "MTRX Horizyn (the whole company)" in section
    for key in ("rankup", "cyberlogix", "omniarmor"):
        assert f'name="apps" value="{key}"' in section
    # No price talk anywhere near it.
    for word in ("price", "valuation", "returns", "offer to buy"):
        assert word not in section.lower()


@pytest.mark.parametrize("change", [
    {"apps": []},
    {"apps": "company"},
    {"apps": ["company", "company"]},
    {"apps": ["no-such-app"]},
    {"apps": [7]},
    {"apps": ["company", "rankup", "cyberlogix", "omniarmor", "extra"]},
    {"message": ""},
    {"name": ""},
    {"email": "jo@"},
    {"organisation": "x" * 121},
])
def test_buy_choices_are_checked(client, change):
    response = send(client, {**BUY, **change})
    assert response.status_code == 400 and response.json()["error"]
    field = next(iter(change))
    assert response.json()["field"] == field
    assert rows() == []


def test_buying_can_be_the_company_alone_an_app_alone_or_both(client):
    for apps, kept in ((["company"], "company"), (["omniarmor"], "omniarmor"),
                       (["omniarmor", "company", "rankup"], "company,rankup,omniarmor")):
        assert send(client, {**BUY, "apps": apps}).status_code == 200
        assert rows()[-1]["apps"] == kept
    # Organisation is optional, and fields from another path are dropped.
    assert send(client, {**BUY, "organisation": "", "partnership": "resell", "idea": "Nova"}).status_code == 200
    last = rows()[-1]
    assert last["organisation"] == "" and last["partnership"] == "" and last["idea"] == ""


def test_buy_messages_are_counted_with_the_rest_and_the_honeypot_works(client, monkeypatch):
    monkeypatch.setenv("MTRX_TRUST_PROXY", "1")
    who = {"X-Forwarded-For": "203.0.113.9"}
    assert send(client, {**BUY, "website": "https://bot.example"}, who).status_code == 200
    assert rows() == []
    links = " ".join(f"https://spam{i}.example/x" for i in range(6))
    assert send(client, {**BUY, "message": links}, who).status_code == 400
    for _ in range(5):
        assert send(client, BUY, who).status_code == 200
    assert send(client, BUY, who).status_code == 429
    assert client.post("/api/vortex/send", json=BUY, headers={"Origin": "https://evil.example"}).status_code == 403


def test_the_owner_hears_of_a_buy_message_without_personal_details(client, monkeypatch):
    from horizon import health
    sent = []
    monkeypatch.setattr(health, "send_email", lambda subject, body: sent.append((subject, body)) or True)
    monkeypatch.setenv("MTRX_ALERT_EMAIL", "owner@example.com")
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    assert send(client, BUY).status_code == 200
    deadline = time.time() + 5
    while not sent and time.time() < deadline:
        time.sleep(0.05)
    ((subject, body),) = sent
    assert subject == "MTRX Horizyn: new Orbyt message (Buy the company or an app)"
    assert "Organisation: Example Holdings" in body
    assert "Interested in: MTRX Horizyn (the whole company), RankUp" in body
    for private in (SECRET, "Jo Buyer", "@example.com", "We'd like"):
        assert private not in body


def test_a_buy_message_shows_in_the_owners_inbox(client):
    owner(client)
    assert send(client, BUY).status_code == 200
    data = client.get("/api/console/vortex").json()
    (m,) = data["messages"]
    assert m["kind"] == "buy" and m["kind_name"] == "Buy the company or an app"
    assert m["apps"] == ["MTRX Horizyn (the whole company)", "RankUp"]
    assert m["organisation"] == "Example Holdings" and m["email"] == "jo@example.com"
    assert data["unread"] == 1
    assert client.post(f"/api/console/vortex/{m['id']}/archive", headers=ORIGIN).json()["unread"] == 0
    script = client.get("/console/assets/console.js").text
    assert 'm.kind === "buy" ? "Interested in buying"' in script
    css = client.get("/console/assets/console.css").text
    assert ".vx-msg.kind-buy" in css


def test_privacy_and_terms_cover_the_buy_path(client):
    privacy = " ".join(client.get("/privacy").text.split())
    assert "ask about buying the company or one of its apps" in privacy
    assert "for buying, whether it's the whole company or which apps" in privacy
    assert "which of the four paths you chose" in privacy
    terms = " ".join(client.get("/terms").text.split())
    assert ("Nothing on this site is an offer to sell the company or any app, and no sale happens "
            "through this site.") in terms

def test_the_old_vortex_address_still_lands_on_orbyt(client):
    response = client.get("/vortex", follow_redirects=False)
    assert response.status_code == 301 and response.headers["location"] == "/orbyt"
    assert "Orbyt" in client.get("/vortex").text


# ---------------------------------------------------------------- 1.10.0: clear in five seconds

def test_orbyt_says_who_it_is_for_and_how_it_works_at_once(client):
    page = client.get("/orbyt").text
    hero = page.split('<section class="v-hero panel">', 1)[1].split("</section>", 1)[0]
    assert "Want to work with MTRX Horizyn? Start here." in hero
    # Two promises, not four (1.16.0).
    assert re.findall(r"<li>(.*?)</li>", hero) == ["Takes about 2 minutes", "A real person replies"]
    paths = "".join(re.findall(r'<nav class="v-paths[^"]*"(.*?)</nav>', page, re.S))
    # The most common visitor first, each with who it's for in their words.
    assert [m for m in re.findall(r'data-path="(\w+)"', paths)] == ["pitch", "partner", "invest", "buy"]
    for who in ("I have an idea", "I run a business", "I&#39;m an investor", "I&#39;d like to buy"):
        assert who in paths or who.replace("&#39;", "'") in paths, who
    how = page.split('<ol class="v-how" id="v-choose"', 1)[1].split("</ol>", 1)[0]
    assert how.count("<li>") == 3 and "We reply by email" in how


def test_after_sending_each_path_gets_a_next_step(client):
    page = client.get("/orbyt").text
    sent = page.split('<section class="panel v-sent"', 1)[1].split("</section>", 1)[0]
    links = dict(re.findall(r'data-next="([a-z ]+)" href="([^"]+)" hidden', sent))
    assert links == {"pitch": "/genesis", "partner": "/partners", "invest buy": "#our-apps"}
    script = (ROOT / "static/js/vortex.js").read_text()
    assert 'link.dataset.next.split(" ").includes(kind)' in script


def test_buying_is_only_the_buy_path_and_no_money_moves_on_orbyt_while_review_is_off(client):
    page = client.get("/orbyt").text
    # No "Ask about buying" on each app: buying is one quiet path, under
    # "Other ways to talk to us".
    catalog = page.split('id="our-apps"', 1)[1].split("</section>", 1)[0]
    assert "v-app-buy" not in page and 'href="#buy"' not in catalog and "Ask about buying" not in catalog
    assert page.count('href="#buy" data-path="buy"') == 1
    # Nothing here takes money, offers shares or promises anything.
    lowered = page.lower()
    for word in ("checkout", "stripe", "card number", "invest now", "buy now", "guaranteed", "profit"):
        assert word not in lowered, word
    text = (ROOT / "static/js/vortex-form.js").read_text().lower()
    assert "checkout" not in text and "stripe" not in text and "/api/genesis/pro" not in text
    # The page's script has one checkout, Pitch Review's, which runs only on
    # the box the page has while it is on (tests/test_orbyt_review.py).
    text = (ROOT / "static/js/vortex.js").read_text()
    assert "/api/genesis/pro" not in text and 'const review = $("v-review");' in text
    assert re.findall(r'fetch\("([^"]+)"', text) == ["/api/vortex/send", "/api/orbyt/review/checkout"]
    assert 'id="v-review"' not in page


def test_with_no_apps_released_orbyt_says_so_instead_of_an_empty_gap(client):
    from horizon import catalog
    for key in catalog.released_keys():
        catalog.unrelease(key)
    page = client.get("/orbyt").text
    assert '<section class="panel v-catalog-empty" id="our-apps">' in page
    assert "Our apps will be listed here while they&#39;re open to the public." in page \
        or "Our apps will be listed here while they're open to the public." in page
    assert "No apps are open to partners right now." in page


# ---------------------------------------------------------------- 1.11.0: honest and plain

def test_orbyt_says_the_apps_are_opening_soon_until_one_has_an_address(client, monkeypatch):
    page = client.get("/orbyt").text
    catalog = page.split('id="our-apps"', 1)[1].split("</section>", 1)[0]
    # One status phrase site-wide: "In development" (1.15.0).
    assert "Our apps</h2>" in catalog and "opening soon" not in catalog.lower() and "Released to the public" not in page
    assert catalog.count('<span class="v-app-soon">In development</span>') == 3
    monkeypatch.setenv("RANKUP_URL", "https://rankup.example.com")
    assert "rankup.example.com" not in client.get("/orbyt").text  # not launched yet
    monkeypatch.setenv("MTRX_OPEN_APPS", "rankup")
    catalog = client.get("/orbyt").text.split('id="our-apps"', 1)[1].split("</section>", 1)[0]
    assert "(opening soon)" not in catalog and "Open to the public" in catalog
    assert 'href="https://rankup.example.com"' in catalog and catalog.count('<span class="v-app-soon">In development</span>') == 2


def test_pitch_and_partner_first_then_other_ways_to_talk(client):
    page = client.get("/orbyt").text
    first = page.split('<nav class="v-paths"', 1)[1].split("</nav>", 1)[0]
    assert first.index('data-path="pitch"') < first.index('data-path="partner"')
    assert "invest" not in first and "buy" not in first and "early-access" not in first
    # Investors and buying come lower: after how Orbyt works.
    how = page.index('<ol class="v-how" id="v-choose"')
    more = page.split('<nav class="v-paths v-paths-more"', 1)[1].split("</nav>", 1)[0]
    assert page.index('<nav class="v-paths v-paths-more"') > how
    other = more.index("Other ways to talk to us")
    assert other < more.index("Business enquiries") < more.index('data-path="invest"') < more.index('data-path="buy"')
    # Folded into one row (1.16.0), with a button for each.
    assert more.count("v-path-small") == 1 and more.count('class="v-pick ') == 2
    # Every nav of paths dims together once one is chosen.
    script = (ROOT / "static/js/vortex.js").read_text()
    assert 'document.querySelectorAll(".v-paths").forEach' in script


def test_orbyt_leads_with_pitch_and_early_access_while_it_is_open(client, monkeypatch):
    monkeypatch.setenv("EARLY_ACCESS_ENABLED", "1")
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("EARLY_ACCESS_EMAIL_FROM", "news@example.com")
    monkeypatch.setenv("MTRX_PUBLIC_URL", "https://testserver")
    page = client.get("/orbyt").text
    first = page.split('<nav class="v-paths with-early"', 1)[1].split("</nav>", 1)[0]
    cards = re.findall(r'<a class="v-path (path-\w+)" href="([^"]+)"', first)
    assert cards == [("path-pitch", "#pitch"), ("path-early", "/early-access"), ("path-partner", "#partner")]
    assert client.get("/early-access").status_code == 200
    # Early access is a link to its own page, never an Orbyt form.
    assert 'data-kind="early' not in page


def test_orbyt_label_stays_on_one_line_on_a_phone():
    css = (ROOT / "static/css/vortex.css").read_text()
    phone = css.split("@media (max-width: 720px) {", 1)[1].split("\n}\n", 1)[0]
    rule = phone.split(".v-hero-copy .v-eyebrow {", 1)[1].split("}", 1)[0]
    assert "white-space: nowrap" in rule and "letter-spacing: 0.12em" in rule


def test_every_form_has_the_7_day_reply_and_pitch_partner_the_under_13_note(client):
    """1.15.0: each thing is said once before sending. "Within 7 days" just
    above Send (not also in the hero and the steps), "we won't publish or
    pass on" once on the Pitch form, and the under-13 note only on the forms
    young people use (Pitch and Partner)."""
    page = client.get("/orbyt").text
    young = "If you're under 13, ask a parent or guardian to send this for you."
    for kind in ("partner", "pitch", "invest", "buy"):
        panel = page.split(f'id="v-{kind}"', 1)[1].split("</section>", 1)[0]
        assert (young in panel) == (kind in ("partner", "pitch")), kind
        assert panel.count("We reply within 7 days, even if the answer is no.") == 1, kind
        before_send = " ".join(panel.split('<div class="v-send">', 1)[0].split()).replace("&#39;", "'")
        assert (CONFIDENTIAL in before_send) == (kind == "pitch"), kind
        # "pass on" is said once in each form, never twice.
        assert " ".join(panel.split()).count("pass on") + " ".join(panel.split()).count("pass it on") == 1, kind
    # Outside the forms, "7 days" and "pass on" aren't repeated before sending.
    outside = page.split('<section class="panel v-panel', 1)[0]
    assert "7 days" not in outside and "pass on" not in outside
    # The Sent screen says when once, as a date (1.19.0: the line with their
    # address no longer repeats "within 7 days").
    sent = " ".join(page.split('<section class="panel v-sent"', 1)[1].split("</section>", 1)[0].split())
    assert "7 days" not in sent
    form_js = (ROOT / "static/js/vortex-form.js").read_text()
    assert "return `We'll reply to ${email}, even if the answer is no.`;" in form_js
    assert "within 7 days" not in form_js.split("function sentLine", 1)[1].split("}", 1)[0]
    # No shares, apps or companies are bought or sold here, and it says so in
    # those words (1.20.0: not "nothing is bought or sold", which Pitch Review
    # would make untrue).
    assert "No shares, apps or companies are bought or sold here." in page
    assert "Nothing is bought or sold" not in page and "Nobody pays or gets paid" not in page
    # No character count on an email box.
    assert 'data-count-for="email"' not in page


# 1.19.0: warmer, and still no more than the terms ("we may already be
# working on something similar"): if we are, we say so in the reply.
CONFIDENTIAL = ("We won't publish or pass on what you send. We may already be working on something similar; "
                "if we are, we'll tell you when we reply, so you know where you stand.")


def test_orbyt_says_the_same_thing_about_what_you_send_everywhere(client):
    """One sentence about ideas, wherever it comes up: not "aren't
    confidential" in one place and "nothing is made public" in another."""
    page = " ".join(client.get("/orbyt").text.split()).replace("&#39;", "'")
    # Said once, on the Pitch form, just before Send (1.15.0: no longer
    # also in "How Orbyt works").
    assert page.count(CONFIDENTIAL) == 1
    pitch = page.split('id="v-pitch"', 1)[1].split("</section>", 1)[0]
    assert CONFIDENTIAL in pitch
    for gone in ("aren't confidential", "made public", "never share it"):
        assert gone not in page, gone
    pack = (ROOT / "static/js/pilot-mtrx-pack.js").read_text()
    assert "aren't confidential" not in pack and "won't publish or pass on what is sent" in pack
    assert "It may already be working on something similar; if so, it says so in its reply." in pack
    assert "Nobody pays or gets paid" not in pack


def test_orbyt_always_says_it_is_for_working_with_mtrx_horizyn(client):
    for path in ("/", "/genesis", "/orbyt", "/privacy", "/terms", "/partners", "/bundle"):
        page = client.get(path).text
        for link in re.findall(r'<a href="/orbyt"[^>]*>(.*?)</a>', page, re.DOTALL):
            assert "Work with MTRX Horizyn" in link or "work with us" in link, (path, link)
    page = client.get("/orbyt").text
    assert "<title>Orbyt · Work with MTRX Horizyn</title>" in page
    assert '<p class="eyebrow v-eyebrow">Work with MTRX Horizyn</p>' in page


# ---------------------------------------------------------------- 1.16.0: review fixes

def _phone_rules(css, width=600):
    return css.split(f"@media (max-width: {width}px) {{\n  .v-paths, .v-paths.with-early", 1)[1].split("\n}\n", 1)[0]


@pytest.mark.parametrize("width", [320, 375])
def test_app_names_never_break_inside_a_word_on_phones(client, width):
    """At 375 and 320px "OmniArmor.ai" broke as "OmniArmo / r.ai" beside its
    status badge. Names now never break inside a word, and on phones the
    badge goes under the name, so the name has the card's width."""
    css = (ROOT / "static/css/vortex.css").read_text()
    h3 = css.split(".v-app h3 {", 1)[1].split("}", 1)[0]
    assert "overflow-wrap: normal" in h3 and "word-break: normal" in h3 and "anywhere" not in h3
    phone = _phone_rules(css)
    assert ".v-app-head { display: grid; grid-template-columns: auto minmax(0, 1fr);" in phone
    assert ".v-app-open, .v-app-soon { grid-column: 2;" in phone
    # The room the name has at this width: the page's side room (the robot's,
    # 30px, more than the page's own 16px), the card's padding (18px), the
    # icon (44px) and the gap (12px). Each name fits, at about 0.66em a letter
    # of the 18px heading.
    pilot = (ROOT / "static/pilot/pilot.css").read_text()
    side = int(re.search(r":root\.pilot-on\.pilot-keep-in \{ --pilot-side: (\d+)px; \}", pilot).group(1))
    room = width - 2 * max(side, 16) - 2 * 18 - 44 - 12
    page = client.get("/orbyt").text
    names = re.findall(r'<li class="v-app [^"]*" data-app="[^"]+">\s*<div class="v-app-head">.*?<h3>(.*?)</h3>', page, re.S)
    assert "OmniArmor.ai" in names
    for name in names:
        longest = max(name.split(), key=len)
        assert len(longest) * 18 * 0.66 <= room, (width, name, room)


def test_orbyt_is_shorter_and_its_examples_say_so(client):
    page = client.get("/orbyt").text
    # The idea name's placeholder is clearly an example, like the others.
    assert 'placeholder="e.g. Nova"' in page and 'placeholder="Nova"' not in page
    assert 'placeholder="e.g. Homework reminders"' in page and 'placeholder="e.g. Students"' in page
    # Investors and buyers: one "Business enquiries" row, a button each,
    # and either one lights the row up.
    more = page.split('<nav class="v-paths v-paths-more"', 1)[1].split("</nav>", 1)[0]
    assert more.count('<div class="v-path v-path-small v-business path-business">') == 1
    assert '<a class="v-pick path-invest" href="#invest" data-path="invest">' in more
    assert '<a class="v-pick path-buy" href="#buy" data-path="buy">' in more
    script = (ROOT / "static/js/vortex.js").read_text()
    assert 'row.classList.toggle("on", kind === "invest" || kind === "buy")' in script
    assert 'document.querySelector(`[data-path="${k}"]`)' in script
    # The label beside the swirl never runs into it at 320px.
    css = (ROOT / "static/css/vortex.css").read_text()
    small = css.split("@media (max-width: 360px) {", 1)[1].split("\n}\n", 1)[0]
    assert ".v-hero-copy .v-eyebrow { padding-right: 0;" in small and ".v-hero-art { top: 46px; }" in small


# ---------------------------------------------------------------- 1.17.0

def test_the_pitch_form_has_a_short_faq_above_send_that_promises_no_more_than_the_terms(client):
    page = client.get("/orbyt").text
    pitch = page.split('id="v-pitch"', 1)[1].split("</section>", 1)[0]
    before_send = pitch.split('<div class="v-send">', 1)[0]
    faq = before_send.split('<div class="v-faq" id="faq">', 1)[1].split("</div>", 1)[0]
    questions = re.findall(r"<summary>([^<]+)</summary>", faq)
    assert questions == ["Who owns my idea?", "What happens after I send?", "Will you build it without me?"]
    flat = " ".join(faq.split()).replace("&#39;", "'")
    assert "Your idea stays yours: we never take a share of it without a written agreement" in flat
    assert "parent or guardian" in flat
    # The same words the terms use: sending creates no agreement.
    terms = " ".join(client.get("/terms").text.split()).replace("&#39;", "'")
    assert "doesn't create a partnership, an agreement or any obligation for either of us" in terms
    assert "doesn't create a partnership, an agreement or any obligation for either of us" in flat
    assert CONFIDENTIAL in flat
    # Above the 7-day line and Send, and only on the Pitch form.
    assert before_send.index('id="faq"') < before_send.index('class="v-reply"')
    assert page.count('class="v-faq"') == 1
    for word in ("guarantee", "we will build", "royalt"):
        assert word not in flat.lower(), word


def test_the_phone_page_is_shorter_how_it_works_is_one_line_and_the_apps_fold(client):
    page = client.get("/orbyt").text
    how = page.split('<ol class="v-how" id="v-choose"', 1)[1].split("</ol>", 1)[0]
    assert how.count('<em class="v-how-more">') == 3
    css = (ROOT / "static/css/vortex.css").read_text()
    late = css.split("/* ---------- 1.17.0 ---------- */", 1)[1]
    phone = late.split("@media (max-width: 720px) {", 1)[1]
    assert ".v-how-more { display: none; }" in phone
    catalog = page.split('id="our-apps"', 1)[1].split("</section>", 1)[0]
    assert '<details class="v-apps-fold" id="v-apps-fold">' in catalog
    assert catalog.index("v-apps-fold") < catalog.index('class="v-app-list"')
    script = (ROOT / "static/js/vortex.js").read_text()
    assert 'window.matchMedia("(min-width: 721px)").matches) openApps();' in script
    assert 'if (window.location.hash === "#our-apps") openApps();' in script
    # The desktop path cards line up at the top; the examples are short enough for a phone.
    assert ".v-path { align-items: start; }" in late
    for example in re.findall(r'placeholder="(e\.g\. [^"]+)"', page):
        assert len(example) <= 24, example


def test_a_direct_link_to_a_form_scrolls_instantly_and_again_after_load():
    script = (ROOT / "static/js/vortex.js").read_text()
    assert 'behavior: smooth ? "smooth" : "instant"' in script
    assert 'smooth" : "auto"' not in script
    # 1.19.0: after load it checks where the form is, not whether the visitor
    # is still at the top (tests/test_browser.py makes the race certain).
    assert 'window.addEventListener("load", settle, { once: true });' in script
    assert "if (top < 0 || top > 140) jump(kind, false);" in script
    assert "window.scrollY < 40" not in script
    page_js = (ROOT / "static/js/vortex.js").read_text()
    assert '$("v-next-step").textContent = V.nextLine(new Date());' in page_js


# ---------------------------------------------------------------- 1.19.0

def test_orbyt_says_up_to_365_days_everywhere_it_says_how_long(client):
    """The FAQ said "then delete it" with no number while the form's footer
    and the privacy page said 365 days. Every place that says how long a
    message is kept now says "up to 365 days" (the same KEEP_DAYS)."""
    from horizon import vortex
    assert vortex.KEEP_DAYS == 365
    page = " ".join(client.get("/orbyt").text.split()).replace("&#39;", "'")
    faq = page.split('<div class="v-faq" id="faq">', 1)[1].split("</div>", 1)[0]
    assert "We keep your message only to reply, for up to 365 days, then delete it." in faq
    for line in re.findall(r"[^.]*\bkeep[^.]*\.", page.split("<main", 1)[1]):
        if "message" in line or "what you send" in line:
            assert "365 days" in line, line
    pilot = (ROOT / "static/js/pilot-mtrx.js").read_text()
    assert "We keep your message only to reply, for up to 365 days." in pilot
    privacy = " ".join(client.get("/privacy").text.split())
    assert "for up to 365 days" in privacy


def test_the_sent_screen_says_the_date_once(client):
    script = (ROOT / "static/js/vortex-form.js").read_text()
    sent = script.split("function sentLine", 1)[1].split("\n  }", 1)[0]
    assert "7 days" not in sent and "REPLY_DAYS" not in sent
    assert "by ${replyBy(now)}" in script


def test_a_phone_shows_how_it_works_as_three_short_columns(client):
    css = (ROOT / "static/css/vortex.css").read_text()
    late = css.split("/* ---------- 1.19.0 ---------- */", 1)[1]
    phone = late.split("@media (max-width: 720px) {", 1)[1].split("\n}\n", 1)[0]
    assert ".v-how { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));" in phone
    assert "flex-wrap" not in phone


def test_a_computer_hero_shows_an_example_pitch(client):
    """The desktop hero's right half was a lone swirl: now a short, made-up
    example pitch (the same three lines the Pitch form asks for) and a link
    to the form. Shown from 901px; a phone keeps the small swirl."""
    page = client.get("/orbyt").text
    hero = page.split('<section class="v-hero panel">', 1)[1].split("</section>", 1)[0]
    example = hero.split('<figure class="v-example">', 1)[1].split("</figure>", 1)[0]
    assert "<figcaption>Example pitch</figcaption>" in example
    for label in ("Idea", "In one line", "Who it's for"):
        assert f"<dt>{label}</dt>" in example, label
    assert '<a class="v-example-go" href="#pitch">Write mine' in example
    assert "7 days" not in example
    css = (ROOT / "static/css/vortex.css").read_text()
    assert ".v-example { display: none; }" in css
    assert "@media (min-width: 901px) {\n  .v-hero { grid-template-columns: minmax(0, 1fr) minmax(280px, 340px); }" in css
