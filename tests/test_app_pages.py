"""1.30.0: each app's very simple page first, then its hands-on demo."""
from horizon import app_pages
from tests.test_lock import ORIGIN, make_client, client, owner  # noqa: F401

KEYS = ("rankup", "cyberlogix", "omniarmor", "genesis", "orbyt", "pilot")


def test_every_app_has_a_simple_page_and_a_demo(client):
    for key in KEYS:
        page = client.get(f"/apps/{key}")
        assert page.status_code == 200, key
        body = page.text
        item = app_pages.get(key)
        assert item["one"] in body
        # Very simple: one sentence and exactly three steps.
        assert body.count('<span class="intro-n">') == 3
        assert f'href="/apps/{key}/demo"' in body
        demo = client.get(f"/apps/{key}/demo")
        assert demo.status_code == 200, key
        assert f'id="demo" data-app="{key}"' in demo.text
        assert "/static/js/app-demo" in demo.text
        assert "Nothing you do here is saved or sent." in demo.text


def test_an_unknown_app_is_a_404(client):
    assert client.get("/apps/nope").status_code == 404
    assert client.get("/apps/nope/demo").status_code == 404


def test_genesis_and_orbyt_look_different_and_open_for_real_first(client):
    """They are free tools on this site ("side shows"), not apps: their own
    look, and the real thing is the first button."""
    for key in ("genesis", "orbyt"):
        body = client.get(f"/apps/{key}").text
        assert "is-side" in body and "Free tool on this site" in body
        first = body.split('<div class="intro-acts">', 1)[1]
        assert first.index("intro-open") < first.index("intro-demo")
    for key in ("rankup", "cyberlogix", "omniarmor"):
        assert "is-side" not in client.get(f"/apps/{key}").text
    listing = client.get("/apps").text
    apps_part, side_part = listing.split("Side shows", 1)
    assert 'href="/apps/genesis"' in side_part and 'href="/apps/genesis"' not in apps_part
    assert 'href="/apps/rankup"' in apps_part


def test_the_home_page_opens_the_simple_page_first(client):
    page = client.get("/").text
    for key in ("rankup", "cyberlogix", "omniarmor"):
        card = page.split(f'data-app="{key}"', 1)[1].split("</article>", 1)[0]
        assert f'<a class="app-title" href="/apps/{key}">' in card
    assert 'class="fact fact-genesis" href="/apps/genesis"' in page
    assert 'class="ready-tile ready-genesis" href="/apps/genesis"' in page
    assert '<a href="/apps">Apps</a>' in page


def test_no_inline_scripts_or_styles_on_the_new_pages(client):
    for path in ["/apps"] + [f"/apps/{k}" for k in KEYS] + [f"/apps/{k}/demo" for k in KEYS]:
        body = client.get(path).text
        assert " style=" not in body, path
        assert "<script>" not in body, path
