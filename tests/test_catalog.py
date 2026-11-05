"""The app catalog: every app MTRX Horizyn makes, and whether it is public.

The owner adds, edits, releases and deletes apps in the console. These check
the founding apps are put in once, only the owner can change anything, every
field is checked, and an app shows on Chroma Vortex (and can be chosen
there) exactly while it is released, never before.
"""

import sqlite3
import time

import pytest

from tests.test_lock import ORIGIN, approved, client, make_client, owner  # noqa: F401
from tests.test_vortex import BUY, PARTNER, rows, send

NOVA = {"key": "nova-notes", "name": "Nova Notes", "line": "Homework reminders that actually work.",
        "url": "https://nova.example.com", "accent": "amber"}


def apps_table():
    from horizon import db
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM apps ORDER BY created_at, key")]


def add(client, body=NOVA):
    return client.post("/api/console/apps", json=body, headers=ORIGIN)


def act(client, key, action):
    return client.post(f"/api/console/apps/{key}/{action}", headers=ORIGIN)


def activity():
    from horizon import db
    with db.connect() as conn:
        return [(r["event"], r["detail"]) for r in conn.execute("SELECT event, detail FROM activity ORDER BY id")]


# ---------------------------------------------------------------- the first run

def test_the_founding_apps_are_put_in_once(client):
    from horizon import db
    table = apps_table()
    assert [(a["key"], a["name"], a["status"], a["accent"]) for a in table] == [
        ("rankup", "RankUp", "released", "green"),
        ("cyberlogix", "CyberLogix AI", "released", "blue"),
        ("omniarmor", "OmniArmor.ai", "released", "violet"),
    ]
    assert all(a["released_at"] and a["line"] and a["url"] == "" for a in table)
    # Starting again changes nothing, and never puts back what the owner changed.
    with db.connect() as conn:
        conn.execute("UPDATE apps SET name = 'RankUp Kids' WHERE key = 'rankup'")
        conn.execute("DELETE FROM apps WHERE key = 'omniarmor'")
    db.init()
    db.init()
    assert [(a["key"], a["name"]) for a in apps_table()] == [("rankup", "RankUp Kids"), ("cyberlogix", "CyberLogix AI")]
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM done_once WHERE job = 'seed apps'").fetchone()[0] == 1


def test_an_app_url_setting_fills_its_address(client, monkeypatch):
    from horizon import catalog
    assert catalog.get("rankup")["url"] == ""
    monkeypatch.setenv("RANKUP_URL", "https://rankup.example.com")
    rankup = catalog.get("rankup")
    assert rankup["url"] == "https://rankup.example.com" and rankup["url_from_setting"] is True
    # A setting that isn't a whole address is ignored, as everywhere else.
    monkeypatch.setenv("RANKUP_URL", "rankup.example.com")
    assert catalog.get("rankup")["url"] == ""
    page = client.get("/vortex").text
    assert 'href="rankup.example.com"' not in page
    monkeypatch.setenv("CYBERLOGIX_URL", "https://cyberlogix.example.com")
    card = client.get("/vortex").text.split('data-app="cyberlogix"', 1)[1].split("</li>", 1)[0]
    assert 'href="https://cyberlogix.example.com"' in card and "Open" in card


def test_the_schema_upgrades_a_database_that_already_has_data(tmp_path, make_client):
    """A live database from before the catalog gets the new tables and the
    founding apps, and keeps every message and device it had."""
    from horizon import db
    path = tmp_path / "test.db"  # the file the client fixture uses
    old_schema = db.SCHEMA.split("-- The app catalog", 1)[0]
    assert "CREATE TABLE IF NOT EXISTS apps" not in old_schema and "vortex_messages" in old_schema
    conn = sqlite3.connect(path)
    conn.executescript(old_schema)
    conn.execute("INSERT INTO devices (id, name, public_key, created_at) VALUES ('d1', 'Old laptop', x'00', 1)")
    conn.execute("INSERT INTO vortex_messages (at, kind, name, email, apps, partnership, message) "
                 "VALUES (?, 'partner', 'Old Partner', 'old@example.com', 'rankup', 'resell', 'Hello')",
                 (time.time(),))
    conn.commit()
    conn.close()

    client = make_client()  # starting the app runs db.init()
    assert [a["key"] for a in apps_table()] == ["rankup", "cyberlogix", "omniarmor"]
    assert send(client, PARTNER).status_code == 200
    assert [r["name"] for r in rows()] == ["Old Partner", "Grace Example"]
    with db.connect() as conn:
        assert conn.execute("SELECT name FROM devices WHERE id = 'd1'").fetchone()[0] == "Old laptop"
    db.init()  # and again, harmlessly
    assert len(apps_table()) == 3 and len(rows()) == 2


# ---------------------------------------------------------------- only the owner

CALLS = [
    ("get", "/api/console/apps", None),
    ("post", "/api/console/apps", NOVA),
    ("post", "/api/console/apps/rankup", {**NOVA, "name": "Hijacked"}),
    ("post", "/api/console/apps/rankup/unrelease", None),
    ("post", "/api/console/apps/rankup/release", None),
    ("post", "/api/console/apps/rankup/delete", None),
    ("post", "/api/console/apps/rankup/explode", None),
]


def test_the_catalog_api_is_owner_only(client, make_client):
    stranger_404 = client.get("/no-such-page")
    approved(client)  # an approved device that has not signed in is still a stranger here
    stranger = make_client()
    for c in (client, stranger):
        for method, path, body in CALLS:
            kwargs = {"headers": ORIGIN, "json": body} if method == "post" else {}
            response = getattr(c, method)(path, **kwargs)
            assert response.status_code == 404, path
            assert response.text == stranger_404.text
    # Nothing changed.
    assert [(a["key"], a["name"], a["status"]) for a in apps_table()] == [
        ("rankup", "RankUp", "released"), ("cyberlogix", "CyberLogix AI", "released"),
        ("omniarmor", "OmniArmor.ai", "released")]


def test_a_change_from_another_site_is_refused_even_for_the_owner(client):
    owner(client)
    for headers in ({}, {"Origin": "https://evil.example"}, {"Origin": "https://rankup.testserver"}):
        assert client.post("/api/console/apps", json=NOVA, headers=headers).status_code == 403
        assert client.post("/api/console/apps/rankup/unrelease", headers=headers).status_code == 403
    assert len(apps_table()) == 3 and apps_table()[0]["status"] == "released"


# ---------------------------------------------------------------- the owner's changes

def test_the_owner_adds_edits_releases_unreleases_and_deletes(client):
    owner(client)
    listed = client.get("/api/console/apps").json()
    assert [a["key"] for a in listed["apps"]] == ["rankup", "cyberlogix", "omniarmor"]
    assert listed["accents"] == ["green", "blue", "violet", "cyan", "magenta", "amber"]

    # Added: private, in development, and deletable.
    added = add(client)
    assert added.status_code == 200, added.text
    nova = added.json()["app"]
    assert (nova["key"], nova["name"], nova["status"], nova["released"], nova["deletable"]) == \
        ("nova-notes", "Nova Notes", "in_development", False, True)
    assert nova["url"] == "https://nova.example.com" and nova["accent"] == "amber" and nova["letter"] == "N"
    assert [a["key"] for a in added.json()["apps"]][-1] == "nova-notes"

    # Edited: everything but the key.
    edited = client.post("/api/console/apps/nova-notes", headers=ORIGIN,
                         json={"key": "renamed", "name": "  Nova   Notes Pro ", "line": "Reminders, sorted.",
                               "url": "", "accent": "cyan"})
    assert edited.status_code == 200, edited.text
    nova = edited.json()["app"]
    assert (nova["key"], nova["name"], nova["line"], nova["url"], nova["accent"]) == \
        ("nova-notes", "Nova Notes Pro", "Reminders, sorted.", "", "cyan")

    # Released, then back in development: no longer deletable.
    released = act(client, "nova-notes", "release")
    assert released.status_code == 200 and released.json()["app"]["released"] is True
    assert released.json()["app"]["released_at"] and released.json()["app"]["deletable"] is False
    back = act(client, "nova-notes", "unrelease")
    assert back.status_code == 200 and back.json()["app"]["status"] == "in_development"
    assert back.json()["app"]["deletable"] is False
    refused = act(client, "nova-notes", "delete")
    assert refused.status_code == 409 and "can't be deleted" in refused.json()["error"]

    # A new app that was never released can be deleted.
    assert add(client, {**NOVA, "key": "orbit", "name": "Orbit"}).status_code == 200
    gone = act(client, "orbit", "delete")
    assert gone.status_code == 200 and "orbit" not in [a["key"] for a in gone.json()["apps"]]
    # Gone, or never there: not a 404, which the console takes to mean "signed out".
    for action in ("delete", "release", "unrelease"):
        assert act(client, "orbit", action).status_code == 409
    assert client.post("/api/console/apps/orbit", json=NOVA, headers=ORIGIN).status_code == 409
    assert act(client, "nova-notes", "explode").status_code == 400

    events = activity()
    assert ("App added", "Nova Notes (in development)") in events
    assert ("App edited", "Nova Notes Pro") in events
    assert ("App released", "Nova Notes Pro is now public") in events
    assert ("App back in development", "Nova Notes Pro is no longer public") in events
    assert ("App deleted", "Orbit") in events


def test_a_released_app_cannot_be_deleted(client):
    owner(client)
    for key in ("rankup", "cyberlogix", "omniarmor"):
        response = act(client, key, "delete")
        assert response.status_code == 409 and "can't be deleted" in response.json()["error"]
    assert add(client).status_code == 200 and act(client, "nova-notes", "release").status_code == 200
    assert act(client, "nova-notes", "delete").status_code == 409
    assert len(apps_table()) == 4


@pytest.mark.parametrize("change, field", [
    ({"key": ""}, "key"),
    ({"key": "Nova Notes"}, "key"),
    ({"key": "-nova"}, "key"),
    ({"key": "nova-"}, "key"),
    ({"key": "n" * 25}, "key"),
    ({"key": "nova_notes"}, "key"),
    ({"key": "company"}, "key"),
    ({"key": "rankup"}, "key"),
    ({"key": 7}, "key"),
    ({"name": ""}, "name"),
    ({"name": "x" * 41}, "name"),
    ({"name": "RankUp"}, "name"),
    ({"name": "rankup"}, "name"),
    ({"name": "Visit https://spam.example"}, "name"),
    ({"name": "<b>Nova</b>"}, "name"),
    ({"name": ["Nova"]}, "name"),
    ({"line": ""}, "line"),
    ({"line": "x" * 141}, "line"),
    ({"url": "nova.example.com"}, "url"),
    ({"url": "javascript:alert(1)"}, "url"),
    ({"url": "https://"}, "url"),
    ({"url": "ftp://nova.example.com"}, "url"),
    ({"url": "https://nova.example.com/a b"}, "url"),
    ({"url": "https://nova.example.com/" + "x" * 300}, "url"),
    ({"accent": "pink"}, "accent"),
    ({"accent": ""}, "accent"),
])
def test_what_the_owner_types_is_checked(client, change, field):
    owner(client)
    response = add(client, {**NOVA, **change})
    assert response.status_code == 400, response.text
    assert response.json()["field"] == field and response.json()["error"]
    assert len(apps_table()) == 3


def test_an_edit_is_checked_too(client):
    owner(client)
    assert add(client).status_code == 200
    for change, field in (({"name": "CyberLogix AI"}, "name"), ({"url": "not an address"}, "url"),
                          ({"accent": "plaid"}, "accent")):
        response = client.post("/api/console/apps/nova-notes", json={**NOVA, **change}, headers=ORIGIN)
        assert response.status_code == 400 and response.json()["field"] == field
    assert apps_table()[-1]["name"] == "Nova Notes"
    # An app keeps its own name when it is edited.
    assert client.post("/api/console/apps/nova-notes", json=NOVA, headers=ORIGIN).status_code == 200
    # A body too big is not read.
    assert add(client, {**NOVA, "key": "big", "name": "Big", "line": "x" * 20_000}).status_code == 400


# ---------------------------------------------------------------- on Chroma Vortex

def test_an_app_shows_on_vortex_only_while_released(client):
    owner(client)
    assert add(client).status_code == 200
    page = client.get("/vortex").text
    assert "Nova Notes" not in page and "nova-notes" not in page and "nova.example.com" not in page
    # Unreleased: refused by both forms.
    for body in ({**PARTNER, "apps": ["nova-notes"]}, {**BUY, "apps": ["nova-notes"]}):
        response = send(client, body)
        assert response.status_code == 400 and response.json()["field"] == "apps"
    assert rows() == []

    assert act(client, "nova-notes", "release").status_code == 200
    page = client.get("/vortex").text
    catalog = page.split('id="our-apps"', 1)[1].split("</section>", 1)[0]
    card = catalog.split('data-app="nova-notes"', 1)[1].split("</li>", 1)[0]
    assert "<h3>Nova Notes</h3>" in card and "Homework reminders that actually work." in card
    assert 'href="https://nova.example.com"' in card and 'rel="noopener"' in card
    assert 'href="#partner" data-pick="nova-notes"' in card and "Partner on this" in card
    assert 'href="#buy" data-pick="nova-notes"' in card and "Ask about buying" in card
    assert 'class="v-badge accent-amber"' in card
    for form in ("v-partner", "v-buy"):
        section = page.split(f'id="{form}"', 1)[1].split("</section>", 1)[0]
        assert 'name="apps" value="nova-notes"' in section, form
    assert 'style="' not in page
    # Released: accepted by both forms, and named in the owner's inbox.
    assert send(client, {**PARTNER, "apps": ["nova-notes", "rankup"]}).status_code == 200
    assert send(client, {**BUY, "apps": ["nova-notes"]}).status_code == 200
    assert [r["apps"] for r in rows()] == ["rankup,nova-notes", "nova-notes"]
    inbox = client.get("/api/console/vortex").json()["messages"]
    assert [m["apps"] for m in inbox] == [["Nova Notes"], ["RankUp", "Nova Notes"]]

    # Back in development: gone from the page and refused again, while the
    # messages about it still say which app they were about.
    assert act(client, "nova-notes", "unrelease").status_code == 200
    assert "Nova Notes" not in client.get("/vortex").text
    assert send(client, {**PARTNER, "apps": ["nova-notes"]}).status_code == 400
    assert [m["apps"] for m in client.get("/api/console/vortex").json()["messages"]][0] == ["Nova Notes"]


def test_a_founding_app_taken_back_into_development_leaves_vortex(client):
    owner(client)
    assert act(client, "omniarmor", "unrelease").status_code == 200
    page = client.get("/vortex").text
    assert 'data-app="omniarmor"' not in page and 'name="apps" value="omniarmor"' not in page
    assert send(client, {**PARTNER, "apps": ["omniarmor"]}).status_code == 400
    assert send(client, {**PARTNER, "apps": ["cyberlogix"]}).status_code == 200
    assert act(client, "omniarmor", "release").status_code == 200
    assert 'data-app="omniarmor"' in client.get("/vortex").text


def test_the_vortex_page_lists_the_released_apps(client):
    page = client.get("/vortex").text
    catalog = page.split('id="our-apps"', 1)[1].split("</section>", 1)[0]
    assert "<h2" in catalog and "Our apps" in catalog
    for key, name in (("rankup", "RankUp"), ("cyberlogix", "CyberLogix AI"), ("omniarmor", "OmniArmor.ai")):
        card = catalog.split(f'data-app="{key}"', 1)[1].split("</li>", 1)[0]
        assert f"<h3>{name}</h3>" in card and f'src="/static/img/{key}-icon.svg"' in card
        # No address yet: no Open link.
        assert "v-app-open" not in card


# ---------------------------------------------------------------- the home page and the console

def test_the_home_page_picks_up_a_released_app(client):
    owner(client)
    assert add(client).status_code == 200
    home = client.get("/").text
    assert "Nova Notes" not in home and "<dt>Total Apps</dt><dd>3</dd>" in home
    assert act(client, "nova-notes", "release").status_code == 200
    home = client.get("/").text
    about = home.split('id="company"', 1)[1].split("</section>", 1)[0]
    assert "<b>Nova Notes</b>" in about and 'href="https://nova.example.com"' in about
    assert "parent company of four apps" in about
    assert "<dt>Total Apps</dt><dd>4</dd>" in home
    projects = home.split('id="projects"', 1)[1].split("</section>", 1)[0]
    assert "<b>Nova Notes</b>" in projects and '<em class="status">Released</em>' in projects
    assert 'style="' not in home
    # The three founding cards stay; one in development shows "soon".
    assert act(client, "rankup", "unrelease").status_code == 200
    home = client.get("/").text
    assert 'data-app="rankup"' in home and 'data-knock="rankup"' in home
    assert "RankUp opens to the public soon." in home


def test_a_founding_app_in_development_has_no_open_button_even_with_its_setting(client, monkeypatch):
    owner(client)
    monkeypatch.setenv("RANKUP_URL", "https://rankup.example")
    assert 'aria-label="Open RankUp"' in client.get("/").text
    assert act(client, "rankup", "unrelease").status_code == 200
    assert 'aria-label="Open RankUp"' not in client.get("/").text


def test_the_console_has_a_manage_apps_panel(client):
    owner(client)
    page = client.get("/console").text
    sidebar = page.split('<aside class="sidebar"', 1)[1].split("</aside>", 1)[0]
    assert 'href="#catalog"' in sidebar and 'id="catalog"' in page and 'id="ca-list"' in page
    assert 'id="ca-form"' in page and 'style="' not in page
    script = client.get("/console/assets/console.js").text
    section = script.split("// ---------------------------------------------------------------- the app catalog", 1)[1]
    section = section.split("// ---------------------------------------------------------------- loading", 1)[0]
    for call in ("/api/console/apps", "release", "unrelease", "delete"):
        assert call in section
    assert ".innerHTML" not in section and "insertAdjacentHTML" not in section
