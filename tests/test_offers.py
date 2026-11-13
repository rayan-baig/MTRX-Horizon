"""The partner page (/partners) and the Kitchen Safety Bundle (/bundle).

Both are plain public pages: they keep the site's security rules, set no
cookie and run no script. What they say about money is only what
CyberLogix AI's code does, and every button goes somewhere real. Apply opens
the Chroma Vortex Partner form with CyberLogix AI and the new partnership
kind picked.
"""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.test_lock import client, make_client  # noqa: F401
from tests.test_vortex import PARTNER, rows, send

ROOT = Path(__file__).resolve().parent.parent
PAGES = ("/partners", "/bundle")


def _section(page: str, marker: str) -> str:
    return page.split(marker, 1)[1].split("</section>", 1)[0]


def _text(html: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", html).split())


# ---------------------------------------------------------------- both pages

@pytest.mark.parametrize("path", PAGES)
def test_the_page_opens_for_strangers_with_the_site_rules(client, path):
    from horizon import main
    for method in (client.get, client.head):
        assert method(path).status_code == 200
    response = client.get(path)
    assert response.headers["content-security-policy"] == main.CSP
    assert "set-cookie" not in response.headers and not client.cookies
    assert "x-robots-tag" not in response.headers
    page = response.text
    assert 'style="' not in page and "<style" not in page
    assert "<script" not in page
    assert not re.search(r"\son[a-z]+=", page)
    assert 'src="http' not in page and '<link rel="stylesheet" href="http' not in page
    assert re.search(r"/static/css/offers\.css\?v=[0-9a-f]{10}", page)
    assert client.get("/static/css/offers.css").status_code == 200
    # No form that sends anything: the buttons are links.
    assert "<form" not in page and "<textarea" not in page
    assert f'<link rel="canonical" href="https://testserver{path}">' in page


@pytest.mark.parametrize("path", PAGES)
def test_the_page_is_listed_and_compressed(client, monkeypatch, path):
    from horizon import main
    assert path in main.PUBLIC_PAGES
    monkeypatch.setenv("MTRX_PUBLIC_URL", "https://mtrx.example")
    assert f"<loc>https://mtrx.example{path}</loc>" in client.get("/sitemap.xml").text
    assert client.get(path, headers={"Accept-Encoding": "gzip"}).headers.get("content-encoding") == "gzip"


def test_both_pages_are_linked_from_the_footers(client):
    for path in ("/", "/vortex", "/genesis", "/privacy", "/terms", "/brand", "/partners", "/bundle"):
        page = client.get(path).text
        footer = page.split('<footer class="footer">', 1)[1].split("</footer>", 1)[0]
        assert 'href="/partners"' in footer and 'href="/bundle"' in footer, path


def test_the_pages_say_nothing_about_a_person():
    for name in ("partners.html", "bundle.html", "_offer.html"):
        text = (ROOT / "templates" / name).read_text().lower()
        for word in ("years old", "my son", "my daughter", "school year", "@"):
            assert word not in text, (name, word)


# ---------------------------------------------------------------- the partner page

def test_the_partner_page_says_who_how_and_what_partners_earn(client):
    page = client.get("/partners").text
    text = _text(page)
    assert ("Recommend CyberLogix AI to the shops you already visit, and earn a share of what they pay."
            in text)
    for audience in ("Fridge and refrigeration repair companies",
                     "Food safety consultants and inspectors' trainers", "Kitchen equipment sellers"):
        assert audience in text.replace("&#39;", "'")
    steps = _text(_section(page, 'id="how"'))
    assert steps.index("Apply") < steps.index("Get a partner key") < steps.index(
        "Your customers sign up, and you earn")
    # Only what CyberLogix AI's partners.py does: money actually collected,
    # nothing for a trial or an unpaid or cancelled invoice, a share with no
    # number, since the rate is a setting.
    for fact in ("actually paid in the last 30 days. Not the price list.",
                 "A free trial, or an invoice that hasn't been paid, earns nothing.",
                 "A cancelled invoice earns nothing; half paid earns half."):
        assert fact in text.replace("&#39;", "'")
    assert not re.search(r"\d\s*%|\bpercent\b", text)
    assert "$" not in text


def test_the_france_story_is_calm_and_names_no_company(client):
    story = _text(_section(client.get("/partners").text, 'class="panel o-story"'))
    assert "In October 2026, hackers warmed the fridges at hundreds of supermarkets in France." in story
    assert "Separate alarms matter" in story
    # No company or brand named in it, only the app this page is about.
    names = set(re.findall(r"\b[A-Z][a-zA-Z]+\b", story)) - {
        "Why", "It", "In", "October", "France", "Separate", "That", "CyberLogix", "AI", "What"}
    assert names == set(), names
    for loud in ("!", "attack", "terror", "panic", "devastat"):
        assert loud not in story.lower()


def test_apply_opens_the_partner_form_with_cyberlogix_and_the_new_kind(client):
    page = client.get("/partners").text
    applies = re.findall(r'<a class="btn btn-primary" href="([^"]+)">Apply', page)
    assert applies and set(applies) == {"/vortex#partner/cyberlogix/refer-trade"}
    assert "Refer my customers (repair / food safety)" in page.replace("&#34;", '"')


def test_apply_still_opens_the_form_when_cyberlogix_is_not_public(client):
    from horizon import catalog
    catalog.unrelease("cyberlogix")
    page = client.get("/partners").text
    assert "/vortex#partner/cyberlogix" not in page and 'href="/vortex#partner"' in page


def test_the_partner_page_is_linked_from_chroma_vortex(client):
    page = client.get("/vortex").text
    panel = _section(page, 'id="v-partner"')
    assert 'href="/partners"' in panel


# ---------------------------------------------------------------- the new partnership kind

def test_the_new_partnership_kind_is_accepted_and_shown_to_the_owner(client):
    from horizon import vortex
    assert vortex.PARTNERSHIPS["refer-trade"] == "Refer my customers (repair / food safety)"
    body = {**PARTNER, "apps": ["cyberlogix"], "partnership": "refer-trade"}
    assert send(client, body).status_code == 200
    (row,) = rows()
    assert row["partnership"] == "refer-trade" and row["apps"] == "cyberlogix"
    names = {"cyberlogix": "CyberLogix AI"}
    shown = vortex._public({**row, "read_at": None, "archived_at": None}, names)
    assert shown["partnership"] == "Refer my customers (repair / food safety)"
    # The Vortex form offers it.
    assert '<option value="refer-trade">Refer my customers (repair / food safety)</option>' in client.get("/vortex").text


@pytest.mark.parametrize("kind", ["refer_trade", "Refer-trade", "refer-trade ", "refer-repair", ["refer-trade"]])
def test_a_kind_close_to_the_new_one_is_still_refused(client, kind):
    response = send(client, {**PARTNER, "partnership": kind})
    assert response.status_code == 400 and response.json()["field"] == "partnership"
    assert rows() == []


def test_apply_pre_fills_the_form_in_node():
    """The address Apply opens is read by the Vortex page's own rules
    (vortex-form.js fromHash): CyberLogix AI picked, the new kind chosen."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is not installed here (CI has it)")
    result = subprocess.run([node, "--test", "--test-reporter=tap", str(ROOT / "tests/js/vortex_prefill.test.js")],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "# fail 0" in result.stdout and "# pass 5" in result.stdout


def test_the_vortex_page_uses_the_pre_fill():
    script = (ROOT / "static/js/vortex.js").read_text()
    assert "V.fromHash(window.location.hash)" in script and "preset(kind, asked)" in script
    # Only apps the form offers are picked, and the address is tidied after.
    assert "asked.apps.filter((a) => offered.includes(a))" in script
    assert 'history.replaceState(null, "", `#${kind}`)' in script


# ---------------------------------------------------------------- the bundle

def test_the_bundle_page_says_what_it_is_and_who_it_is_for(client):
    page = client.get("/bundle").text
    text = _text(page).replace("&#39;", "'")
    assert "CyberLogix AI's fridge and freezer alarms and OmniArmor.ai's inspection checklists, together." in text
    assert "CyberLogix AI fills in OmniArmor.ai's temperature checks for you, automatically, every day." in text
    for who in ("Restaurants", "Cafés", "Pharmacies", "School kitchens"):
        assert f"<h3>{who}</h3>" in page
    assert "No more writing temperatures on paper." in text
    assert "Fridge and freezer alarms" in text and "Inspection checklists" in text


def test_no_price_until_cyberlogix_has_a_bundle_add_on(client, monkeypatch):
    from horizon import offers
    assert offers.BUNDLE_PRICE is None
    page = client.get("/bundle").text
    assert "Ask about bundle pricing" in page and "$" not in _text(page)
    monkeypatch.setattr(offers, "BUNDLE_PRICE", 149)
    page = client.get("/bundle").text
    assert "Ask about bundle pricing" not in page and "<b>$149</b> a month" in page


def test_the_trial_and_open_buttons_go_to_the_apps_own_addresses(client, monkeypatch):
    monkeypatch.setenv("CYBERLOGIX_URL", "https://cyberlogix.example")
    monkeypatch.setenv("OMNIARMOR_URL", "https://omniarmor.example/")
    page = client.get("/bundle").text
    assert page.count('href="https://cyberlogix.example/signup" rel="noopener">Start with a free trial') == 2
    assert 'href="https://cyberlogix.example" rel="noopener">Open CyberLogix AI' in page
    assert 'href="https://omniarmor.example/" rel="noopener">Open OmniArmor.ai' in page
    assert "Coming soon" not in page and "Free trial coming soon" not in page


def test_an_app_with_no_address_says_coming_soon_and_offers_vortex(client):
    page = client.get("/bundle").text
    assert "Start with a free trial" not in page and "Free trial coming soon" in page
    assert page.count("Coming soon.") == 2
    assert 'href="/vortex#partner/cyberlogix,omniarmor"' in page
    assert 'href="https://' not in page.split("<main", 1)[1].split("</main>", 1)[0]


def test_an_app_in_development_is_not_offered(client, monkeypatch):
    from horizon import catalog
    monkeypatch.setenv("OMNIARMOR_URL", "https://omniarmor.example")
    catalog.unrelease("omniarmor")
    page = client.get("/bundle").text
    assert "https://omniarmor.example" not in page
    assert 'href="/vortex#partner/cyberlogix"' in page


def test_the_bundle_is_linked_from_home_vortex_and_the_catalog(client):
    home = client.get("/").text
    menu = home.split('<nav class="sheet-card menu"', 1)[1].split("</nav>", 1)[0]
    about = _section(home, 'id="company"')
    assert 'href="/bundle"' in menu and 'href="/bundle"' in about
    vortex = client.get("/vortex").text
    catalog = vortex.split('id="our-apps"', 1)[1].split("</section>", 1)[0]
    assert 'href="/bundle"' in catalog
    script = (ROOT / "static/js/home.js").read_text()
    assert '"/bundle"' in script and '"/partners"' in script


def test_the_demo_build_leaves_the_new_pages_out():
    """The click-through demo is the home page alone; it has no /bundle."""
    from horizon import main
    html = main.templates.env.get_template("home.html").render(
        demo=True, urls={"rankup": "", "cyberlogix": "", "omniarmor": ""}, numbers=None, projects=[],
        more_apps=[], app_count=3, contact="", base="", version="x")
    assert 'href="/bundle"' not in html and 'href="/partners"' not in html


def test_fixtures_are_plain_json():
    for path in (ROOT / "tests/fixtures").glob("*.json"):
        json.loads(path.read_text())
