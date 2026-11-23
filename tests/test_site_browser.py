"""Home, Genesis and Orbyt (1.22.0) in a real browser: what only layout can
show. The server and browser come from tests/test_browser.py (skipped there
too where Playwright or its Chromium isn't installed; CI has both)."""

import pytest

from tests.test_browser import _phone, browser, site, sync_api  # noqa: F401

SEED = """() => {
  const S = window.GenesisStore;
  const made = S.create({ name: "Paw Board", pitch: "A noticeboard app for lost pets on my street", audience: "Neighbours with pets" });
  S.open(localStorage).save([made.project]);
}"""


def _computer(browser, width=1440, height=900):
    return browser.new_context(viewport={"width": width, "height": height})


def test_genesis_welcome_back_ticks_the_next_steps_beside_the_greeting(site, browser):
    """A returning visitor on a computer: the next three steps fill the right
    half of the welcome, and ticking one saves it and brings the next one
    up. The project's name is plain words; Continue is the one way in."""
    context = _computer(browser)
    page = context.new_page()
    page.goto(f"{site}/genesis", wait_until="load")
    page.evaluate(SEED)
    page.reload(wait_until="load")
    page.wait_for_selector(".g-continue-tick")
    title = page.eval_on_selector(".g-continue-title", "e => e.getBoundingClientRect().toJSON()")
    steps = page.eval_on_selector(".g-continue-next", "e => e.getBoundingClientRect().toJSON()")
    assert steps["left"] > title["right"] and steps["top"] < title["bottom"] + 120, (title, steps)
    labels = page.eval_on_selector_all(".g-continue-tick span", "s => s.map(x => x.textContent)")
    assert len(labels) == 3
    assert page.query_selector(".g-continue-project a") is None
    assert page.eval_on_selector_all('.g-continue a[href^="#p/"]', "a => a.length") == 1
    page.click(".g-continue-tick >> nth=0")
    page.wait_for_function("first => ![...document.querySelectorAll('.g-continue-tick span')].some(s => s.textContent === first)",
                           arg=labels[0])
    assert page.eval_on_selector_all(".g-continue-tick span", "s => s.map(x => x.textContent)")[:2] == labels[1:]
    assert "1 of 19 steps done" in page.inner_text(".g-continue-project")
    saved = page.evaluate("() => window.GenesisStore.open(localStorage).load()[0].ticks")
    assert len(saved) == 1
    context.close()


def test_genesis_puts_todays_spark_on_a_phones_first_screen(site, browser):
    """375x667, first visit and coming back: today's spark's question shows
    without scrolling, and the words are those of today's spark (not greyed
    by another element's class)."""
    context = browser.new_context(viewport={"width": 375, "height": 667}, is_mobile=True, has_touch=True)
    page = context.new_page()
    for returning in (False, True):
        page.goto(f"{site}/genesis", wait_until="load")
        if returning:
            page.evaluate(SEED)
            page.reload(wait_until="load")
            page.wait_for_selector(".g-continue-tick")
        page.wait_for_selector("#g-daily-title:not(:empty)")
        box = page.eval_on_selector("#g-daily-title", "e => e.getBoundingClientRect().toJSON()")
        assert box["top"] < 667 - 40, (returning, box)
        assert page.evaluate("() => document.documentElement.scrollWidth") <= 375
        assert page.eval_on_selector("#g-daily-title", "e => getComputedStyle(e).color") == \
            page.eval_on_selector("body", "e => getComputedStyle(e).color")
        if not returning:
            lines = page.eval_on_selector(".g-intro", "e => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))")
            assert lines <= 2
    context.close()


def test_pilot_shows_genesis_projects_from_this_browser_with_no_key(site, browser):
    """"Show my projects" is answered at once from this browser's own Genesis
    data: no key wall, and no request leaves the site."""
    context = _phone(browser)
    page = context.new_page()
    away = []
    page.on("request", lambda r: away.append(r.url) if not r.url.startswith(site) else None)
    page.goto(f"{site}/genesis", wait_until="load")
    page.evaluate(SEED)
    page.reload(wait_until="networkidle")
    page.wait_for_selector(".pilot-launcher", timeout=10000)
    page.click(".pilot-launcher")
    page.click('.pilot-chip:has-text("Show my projects")')
    page.wait_for_selector(".pilot-from-pilot .pilot-md")
    assert page.is_hidden(".pilot-settings-view"), "no key wall"
    text = page.inner_text(".pilot-from-pilot .pilot-md")
    assert "You have 1 project in this browser" in text and "Paw Board" in text
    assert "Pick a name and check nobody else uses it" in text
    assert page.eval_on_selector('.pilot-from-pilot a[href*="/genesis#p/"]', "a => a.target") == ""
    assert away == [], away
    context.close()


def test_orbyt_cards_line_up_and_the_bundle_bar_has_room(site, browser):
    """A computer: "Pitch →", "Join →" and "Partner →" on one line, and a
    12-16px gap between the Kitchen Safety Bundle bar and the app cards."""
    context = _computer(browser)
    page = context.new_page()
    page.goto(f"{site}/orbyt", wait_until="load")
    tops = page.eval_on_selector_all(".v-paths:not(.v-paths-more) .v-path-go", "g => g.map(x => Math.round(x.getBoundingClientRect().top))")
    assert len(tops) >= 2 and max(tops) - min(tops) <= 1, tops
    page.wait_for_function("() => document.getElementById('v-apps-fold').open")
    gap = page.evaluate("""() => document.querySelector('.v-app-list').getBoundingClientRect().top
                              - document.querySelector('.v-bundle').getBoundingClientRect().bottom""")
    assert 12 <= gap <= 16, gap
    context.close()


def test_home_new_strip_and_tags_are_never_cut_or_wrapped(site, browser):
    """Computers: the "New" strip's headline shows whole; each card's tags
    are one line, or left out at 901-1100px. A phone: "Tap to see" under
    each card's small screen."""
    # 1.28.0: the strip shows where the screen is tall enough (over 940 px);
    # shorter, "Ready today" takes its room.
    for width in (1024, 1100, 1180, 1280, 1440):
        context = _computer(browser, width, 1000)
        page = context.new_page()
        page.goto(f"{site}/", wait_until="load")
        strip = page.eval_on_selector(".news-strip-item span", "s => [s.scrollWidth, s.clientWidth, s.getBoundingClientRect().right]")
        assert strip[0] <= strip[1] + 1, (width, strip)
        assert strip[2] <= width, (width, strip)
        tags = page.eval_on_selector_all(".app-card .tags", """t => t.map(x => getComputedStyle(x).display === 'none' ? 0
            : Math.round(x.getBoundingClientRect().height / parseFloat(getComputedStyle(x).lineHeight)))""")
        assert all(n <= 1 for n in tags), (width, tags)
        if width <= 1100:
            assert tags == [0, 0, 0], (width, tags)
        context.close()
    context = _phone(browser)
    page = context.new_page()
    page.goto(f"{site}/", wait_until="load")
    cues = page.eval_on_selector_all(".app-shot", """s => s.map(a => {
        const img = a.querySelector('img').getBoundingClientRect(), cue = a.querySelector('.app-shot-cue');
        return [cue.textContent, getComputedStyle(cue).display, Math.round(cue.getBoundingClientRect().top - img.bottom)]; })""")
    assert all(c[0] == "Tap to see" and c[1] != "none" and 0 <= c[2] <= 8 for c in cues), cues
    context.close()


# ---------------------------------------------------------------- 1.25.0 (round 9)

def _box(page, selector):
    return page.eval_on_selector(selector, "e => e.getBoundingClientRect().toJSON()")


def test_home_phone_leads_with_what_is_ready_and_the_picture_runs_edge_to_edge(site, browser):
    """375x667, 375x812 and 320x568: "Ready today" (Genesis and Orbyt) is
    whole on the first screen, above the apps in development; the hero
    picture is the full width of the screen (no hard-edged band); nothing
    scrolls sideways."""
    for width, height in ((375, 667), (375, 812), (320, 568)):
        context = browser.new_context(viewport={"width": width, "height": height}, is_mobile=True, has_touch=True)
        page = context.new_page()
        page.goto(f"{site}/", wait_until="load")
        ready = _box(page, ".ready-today")
        assert ready["bottom"] <= height, (width, height, ready)
        assert ready["bottom"] < _box(page, ".app-card")["top"], (width, height)
        art = _box(page, ".hero-art")
        assert abs(art["left"]) < 1 and abs(art["width"] - width) < 1, (width, art)
        assert page.evaluate("() => document.documentElement.scrollWidth") <= width
        context.close()


def test_tap_to_see_opens_the_screens_big(site, browser):
    """A phone: tapping a card's small screen opens the viewer with the
    screen nearly the window's width, not the Learn more card; Learn more
    still opens the card, and × closes the viewer."""
    context = _phone(browser)
    page = context.new_page()
    page.goto(f"{site}/", wait_until="load")
    page.click('.app-card[data-app="rankup"] .app-shot')
    page.wait_for_selector("#shot-rankup:target")
    page.wait_for_function("() => document.querySelector('#shot-rankup img').complete")
    img = _box(page, "#shot-rankup .viewer-row img")
    assert img["width"] >= 220 and img["height"] >= 400, img
    assert page.is_hidden("#learn-rankup")
    page.click("#shot-rankup .viewer-more")
    page.wait_for_selector("#learn-rankup:target")
    page.goto(f"{site}/#shot-cyberlogix")
    page.click("#shot-cyberlogix .sheet-x")
    page.wait_for_function("() => !document.querySelector('.sheet:target')")
    context.close()


# A day whose spark is the longest of the 45 (genesis-store.js PROMPTS), at
# noon there; and a check, in the page, that the spark shown is the longest.
LONGEST_SPARK_DAY = "2026-11-23T12:00:00"
_IS_LONGEST_SPARK = """() => { const S = window.GenesisStore;
  const most = Math.max(...S.PROMPTS.map((p) => p.length));
  return document.getElementById('g-daily-title').textContent.length === most; }"""


def test_genesis_at_320_keeps_the_spark_on_the_first_screen_and_words_whole(site, browser):
    """320x568, first visit and coming back: today's spark's line is on the
    first screen; "TODAY'S SPARK · <date>" is one line; "Welcome back" is one
    line; and the Continue button is one line ("Continue →", the project's
    name is just above it)."""
    context = browser.new_context(viewport={"width": 320, "height": 568}, is_mobile=True, has_touch=True)
    page = context.new_page()
    # 1.27.0: the same every day. The page's clock is pinned to a day whose
    # spark is the longest of them all (checked below), so this can't pass
    # or fail with the date.
    page.clock.set_fixed_time(LONGEST_SPARK_DAY)
    for returning in (False, True):
        page.goto(f"{site}/genesis", wait_until="load")
        if returning:
            page.evaluate(SEED)
            page.reload(wait_until="load")
            page.wait_for_selector(".g-continue-tick")
        page.wait_for_selector("#g-daily-title:not(:empty)")
        assert page.evaluate(_IS_LONGEST_SPARK), page.inner_text("#g-daily-title")
        assert _box(page, "#g-daily-input")["bottom"] <= 568, returning
        eyebrow = page.eval_on_selector(".g-daily-eyebrow", "e => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight || 14)")
        assert page.eval_on_selector(".g-daily-eyebrow", "e => e.getClientRects().length") == 1
        assert _box(page, ".g-daily-eyebrow")["height"] < 22, eyebrow
        assert page.evaluate("() => document.documentElement.scrollWidth") <= 320
        if returning:
            title = page.eval_on_selector(".g-continue-title", "e => [e.getBoundingClientRect().height, parseFloat(getComputedStyle(e).fontSize), e.scrollWidth <= e.clientWidth + 1]")
            assert title[0] < title[1] * 1.6 and title[2], title
            go = page.eval_on_selector(".g-continue .btn-genesis", "e => [e.innerText.trim(), e.getBoundingClientRect().height]")
            assert " ".join(go[0].split()) == "Continue →" and go[1] <= 50, go
            assert page.eval_on_selector_all(".g-continue-tick", "t => t.length") == 1
    context.close()


def test_genesis_one_project_on_a_computer_has_no_empty_patch(site, browser):
    """A returning visitor with one project, on a computer: the project's
    column ends level with today's spark beside it."""
    context = _computer(browser)
    page = context.new_page()
    page.goto(f"{site}/genesis", wait_until="load")
    page.evaluate(SEED)
    page.reload(wait_until="load")
    page.wait_for_selector(".g-card")
    card, spark = _box(page, ".g-card a"), _box(page, "#g-daily")
    assert abs(card["bottom"] - spark["bottom"]) <= 2, (card, spark)
    context.close()


def test_pilot_helps_with_todays_spark_with_no_key_and_jumps_to_it(site, browser):
    """"Help with today's spark" answers at once (a tip and today's
    prompt), with no key wall and nothing sent anywhere; its link puts the
    spark box in view with its line ready to type in."""
    context = _phone(browser)
    page = context.new_page()
    away = []
    page.on("request", lambda r: away.append(r.url) if not r.url.startswith(site) else None)
    page.goto(f"{site}/genesis", wait_until="load")
    page.evaluate(SEED)
    page.reload(wait_until="networkidle")
    page.wait_for_selector(".pilot-launcher", timeout=10000)
    page.click(".pilot-launcher")
    page.click('.pilot-chip:has-text("Help with today\'s spark")')
    page.wait_for_selector(".pilot-from-pilot .pilot-md")
    assert page.is_hidden(".pilot-settings-view"), "no key wall"
    text = page.inner_text(".pilot-from-pilot .pilot-md")
    prompt = page.inner_text("#g-daily-title")
    assert prompt in text and "Write it in one line" in text, text
    page.click('.pilot-from-pilot a:has-text("Write my spark")')
    page.wait_for_function("() => document.activeElement && document.activeElement.id === 'g-daily-input'")
    box = _box(page, "#g-daily")
    assert -2 <= box["top"] <= 200, box
    assert page.evaluate("() => location.hash") == ""
    assert away == [], away
    context.close()


# ---------------------------------------------------------------- 1.26.0: Genesis and Orbyt on their own addresses

@pytest.fixture(scope="module")
def moved_site(tmp_path_factory):
    """The site with Genesis and Orbyt on their own addresses. Chromium sends
    any name ending in .localhost to this computer, so genesis.localhost and
    orbyt.localhost stand in for genesis.mtrxhorizyn.com and orbyt.*."""
    from tests.test_browser import _free_port, _serve
    port = _free_port()
    main = f"http://localhost:{port}"
    extra = {"MTRX_APP_SUBDOMAINS": "1", "MTRX_PUBLIC_URL": main,
             "MTRX_GENESIS_HOST": f"genesis.localhost:{port}", "MTRX_ORBYT_HOST": f"orbyt.localhost:{port}"}
    for _ in _serve(tmp_path_factory, extra, port):
        yield {"main": main, "genesis": f"http://genesis.localhost:{port}", "orbyt": f"http://orbyt.localhost:{port}"}


SEED_OLD = """async () => {
  await new Promise((done) => { const s = document.createElement('script'); s.src = '/static/js/genesis-store.js'; s.onload = done; document.head.append(s); });
  const S = window.GenesisStore;
  const a = S.create({ name: "Paw Board", pitch: "A noticeboard app for lost pets on my street", audience: "Neighbours with pets" }).project;
  const b = S.create({ name: "Bike Club", pitch: "Saturday rides for beginners", audience: "New riders" }).project;
  S.open(localStorage).save([a, b]);
  S.openDaily(localStorage).save({ "2026-11-20": "Market stalls" });
}"""


def test_genesis_moves_a_visitors_projects_to_its_own_address_once(moved_site, browser):
    """A visitor with projects saved at the old address opens the old link:
    it lands on genesis.*, which asks the old address once, gets the
    projects in the #part (never sent to a server), says "Your projects
    moved here" and takes the #part out of the address. Reloading doesn't
    ask again, and nothing leaves this computer."""
    context = _phone(browser)
    page = context.new_page()
    asked, away = [], []
    page.on("request", lambda r: asked.append(r.url) if r.resource_type == "document" and "/genesis-move" in r.url else None)
    page.on("request", lambda r: away.append(r.url) if "localhost" not in r.url else None)
    page.goto(f"{moved_site['main']}/privacy", wait_until="load")
    page.evaluate(SEED_OLD)
    page.goto(f"{moved_site['main']}/genesis", wait_until="load")
    page.wait_for_selector(".g-continue-tick")
    assert page.url == f"{moved_site['genesis']}/", page.url
    assert "Your projects moved here" in page.inner_text("#g-toast")
    names = page.evaluate("() => window.GenesisStore.open(localStorage).load().map(p => p.name).sort()")
    assert names == ["Bike Club", "Paw Board"]
    assert page.evaluate("() => window.GenesisStore.openDaily(localStorage).load()['2026-11-20']") == "Market stalls"
    assert page.evaluate("() => localStorage.getItem('mtrx-genesis-moved')")
    assert len(asked) == 1, asked
    page.reload(wait_until="load")
    page.wait_for_selector(".g-continue-tick")
    assert len(asked) == 1 and page.url == f"{moved_site['genesis']}/"
    assert away == [], away
    context.close()


def test_a_new_visitor_lands_where_they_were_going_and_a_made_up_link_moves_nothing(moved_site, browser):
    context = _phone(browser)
    page = context.new_page()
    # Nothing saved at the old address: one quick look, then the start form they asked for.
    page.goto(f"{moved_site['genesis']}/#new", wait_until="load")
    page.wait_for_function("() => location.hash === '#new' && !document.getElementById('g-new').hidden")
    assert page.url.startswith(moved_site["genesis"])
    # A link someone made up, with projects in it but not this tab's one-time code.
    packed = page.evaluate("""() => {
      const m = new Map(), st = { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
      const S = window.GenesisStore;
      S.open(st).save([S.create({ name: "Planted", pitch: "Not mine", audience: "Nobody" }).project]);
      return S.packMove(st);
    }""")
    page.goto(f"{moved_site['genesis']}/#move={packed}&n=00112233445566778899", wait_until="load")
    page.reload(wait_until="load")
    page.wait_for_selector("#g-daily-title:not(:empty)")
    assert page.evaluate("() => window.GenesisStore.open(localStorage).load().length") == 0
    assert "move=" not in page.url
    context.close()


def test_pitch_this_in_orbyt_brings_the_idea_to_orbyts_own_address(moved_site, browser):
    """Orbyt on its own address can't read Genesis's projects: "Pitch this in
    Orbyt" opens it in a new tab and hands it the idea by message, never in
    an address. The Pitch Review's cancelled-checkout return works there."""
    context = _computer(browser)
    page = context.new_page()
    page.goto(f"{moved_site['genesis']}/", wait_until="load")
    page.evaluate(SEED)
    pid = page.evaluate("() => window.GenesisStore.open(localStorage).load()[0].id")
    page.goto(f"{moved_site['genesis']}/#p/{pid}", wait_until="load")
    page.reload(wait_until="load")
    page.wait_for_selector(".g-vortex")
    with context.expect_page() as opened:
        page.click(".g-vortex")
    orbyt = opened.value
    orbyt.wait_for_load_state("load")
    assert orbyt.url == f"{moved_site['orbyt']}/#pitch"
    orbyt.wait_for_function("() => document.querySelector('form[data-kind=pitch] [name=idea]').value === 'Paw Board'")
    assert "Paw Board" in orbyt.inner_text("#v-genesis-note")
    assert "Paw" not in orbyt.url
    orbyt.goto(f"{moved_site['orbyt']}/#review-cancelled", wait_until="load")
    orbyt.reload(wait_until="load")
    orbyt.wait_for_selector("#v-sent:not([hidden])")
    # No pitch sent from this tab (1.27.0): it can't say one was.
    assert orbyt.inner_text("#v-sent-line") == "If you sent a pitch, it's on its way. Nothing was charged."
    context.close()


def test_pilot_on_genesis_own_address_links_there(moved_site, browser):
    """Pilot knows genesis.*'s "/" is Genesis: its suggestions are Genesis's,
    and "Show my projects" links to the project on this address."""
    context = _phone(browser)
    page = context.new_page()
    page.goto(f"{moved_site['genesis']}/", wait_until="load")
    page.evaluate(SEED)
    page.reload(wait_until="networkidle")
    page.wait_for_selector(".pilot-launcher", timeout=10000)
    page.click(".pilot-launcher")
    page.click('.pilot-chip:has-text("Show my projects")')
    page.wait_for_selector(".pilot-from-pilot .pilot-md a")
    href = page.eval_on_selector('.pilot-from-pilot a[href*="#p/"]', "a => [a.href, a.target]")
    assert href[0].startswith(f"{moved_site['genesis']}/#p/") and href[1] == "", href
    context.close()


def test_too_much_to_move_in_an_address_becomes_a_file_to_import(moved_site, browser):
    """Too big for an address: the old address's page offers the projects as
    a file (Download), and "Open Genesis" says to import it there."""
    context = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True, has_touch=True, accept_downloads=True)
    page = context.new_page()
    page.goto(f"{moved_site['main']}/privacy", wait_until="load")
    page.evaluate(SEED_OLD)
    page.evaluate("""() => {
      const S = window.GenesisStore;
      const many = Array.from({ length: 40 }, (_, i) => ({ ...S.create({ name: `Idea ${i}`, pitch: "A big plan", audience: "Everyone" }).project, notes: "n".repeat(4000) }));
      S.open(localStorage).save(many);
    }""")
    page.goto(f"{moved_site['main']}/genesis", wait_until="load")
    page.wait_for_selector("#g-move-big:not([hidden])")
    assert page.url.startswith(f"{moved_site['main']}/genesis-move#n=")
    with page.expect_download() as got:
        page.click("#g-move-download")
    assert got.value.suggested_filename.startswith("genesis-projects-")
    page.click("#g-move-go")
    page.wait_for_function("() => document.getElementById('g-toast') && /press Import/.test(document.getElementById('g-toast').textContent)")
    assert page.url == f"{moved_site['genesis']}/"
    context.close()


# ---------------------------------------------------------------- 1.27.0 (round 10)

def test_genesis_at_320_keeps_welcome_back_whole_and_try_an_example_on_one_line(site, browser):
    """Coming back at 320 px, the star no longer sits over "back"; a first
    visit shows "Try an example" on one line, inside the welcome."""
    context = browser.new_context(viewport={"width": 320, "height": 568}, is_mobile=True, has_touch=True)
    page = context.new_page()
    page.clock.set_fixed_time(LONGEST_SPARK_DAY)
    page.goto(f"{site}/genesis", wait_until="load")
    page.wait_for_selector(".g-hero .cta-row .btn-ghost")
    one_line = """() => [...document.querySelectorAll('.g-hero .cta-row .btn')].map((b) => {
      const r = b.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(b).lineHeight) || 20;
      const range = document.createRange(); range.selectNodeContents(b);
      const lines = new Set([...range.getClientRects()].filter((x) => x.width > 2).map((x) => Math.round(x.top))).size;
      const box = document.querySelector('.g-hero').getBoundingClientRect();
      return { text: b.textContent.trim(), lines, inside: r.right <= box.right - 8 && r.left >= box.left + 8 };
    })"""
    for button in page.evaluate(one_line):
        assert button["lines"] == 1 and button["inside"], button
    page.evaluate(SEED)
    page.reload(wait_until="load")
    page.wait_for_selector(".g-continue-title")
    star = page.eval_on_selector(".g-hero-art .g-spark", "e => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display === 'none' ? null : r.toJSON(); }")
    title = page.eval_on_selector(".g-continue-title", "e => e.getBoundingClientRect().toJSON()")
    assert star is None or star["left"] >= title["right"] or star["bottom"] <= title["top"], (star, title)
    assert page.evaluate("() => document.documentElement.scrollWidth") <= 320
    context.close()


def test_genesis_one_project_card_on_a_computer_has_no_stretched_gaps(site, browser):
    """One project at 1440x900: the card's words sit at the top with small
    gaps, and the stages (each with its count) fill the rest, down to the
    total, level with today's spark beside it."""
    context = _computer(browser)
    page = context.new_page()
    page.goto(f"{site}/genesis", wait_until="load")
    page.evaluate(SEED)
    page.reload(wait_until="load")
    page.wait_for_selector(".g-card .g-seg-n")
    at = page.evaluate("""() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const kids = [...document.querySelector('.g-card a').children].map((k) => k.getBoundingClientRect());
      const gaps = kids.slice(1, 5).map((k, i) => Math.round(k.top - kids[i].bottom));
      return { gaps, card: r('.g-card a').bottom, spark: r('#g-daily').bottom,
               counts: [...document.querySelectorAll('.g-card .g-seg-n')].map((n) => n.offsetParent !== null ? n.textContent : '') };
    }""")
    assert max(at["gaps"]) <= 16, at
    assert abs(at["card"] - at["spark"]) <= 2, at
    assert at["counts"] == ["0 of 3", "0 of 5", "0 of 6", "0 of 5"], at
    context.close()


def test_orbyt_first_path_card_shows_whole_on_a_small_phone(site, browser):
    """375x667 (and 320x568): "Pitch an idea", the first path card, is whole
    on the first screen, with room to spare for a browser's own bars."""
    for width, height, most in ((375, 667, 500), (320, 568, 520)):
        context = browser.new_context(viewport={"width": width, "height": height}, is_mobile=True, has_touch=True)
        page = context.new_page()
        page.goto(f"{site}/orbyt", wait_until="load")
        page.evaluate("document.fonts.ready")
        card = page.eval_on_selector(".v-path.path-pitch", "e => e.getBoundingClientRect().toJSON()")
        assert card["bottom"] <= most, (width, card)
        assert page.is_visible(".v-intro") and not page.is_visible(".v-promises")
        context.close()


def test_home_on_a_computer_has_room_under_the_bar(site, browser):
    """"Welcome to MTRX Horizyn" sat 6 px under the bar at 1440x900 and
    touched it at 1280x720. Now there's room, and the one-screen page still
    fits (no scrolling on a computer)."""
    for width, height in ((1440, 900), (1280, 720), (1024, 768)):
        context = _computer(browser, width, height)
        page = context.new_page()
        page.goto(f"{site}/", wait_until="load")
        page.evaluate("document.fonts.ready")
        at = page.evaluate("""() => ({ bar: document.querySelector('.topbar').getBoundingClientRect().bottom,
          eyebrow: document.querySelector('.hero .eyebrow').getBoundingClientRect().top,
          tall: document.documentElement.scrollHeight, view: innerHeight })""")
        assert at["eyebrow"] - at["bar"] >= 12, (width, at)
        assert at["tall"] <= at["view"], (width, at)
        context.close()


# ---------------------------------------------------------------- 1.28.0 (round 11)

def test_home_main_button_is_start_my_idea_and_a_computer_shows_ready_today(site, browser):
    """Phones (320, 375x667, 375x812) and computers: the main (filled)
    button is "Start my idea (free)", to Genesis's start form, with early
    access (or the apps) the outline button beside it; both whole, on one
    row on a phone. A computer's hero has "Ready today" (Genesis and
    Orbyt) under the headline, its words fit the hero, and Genesis and
    Orbyt are not repeated in the bottom row."""
    for width, height in ((320, 568), (375, 667), (375, 812)):
        context = browser.new_context(viewport={"width": width, "height": height}, is_mobile=True, has_touch=True)
        page = context.new_page()
        page.goto(f"{site}/", wait_until="load")
        page.evaluate("document.fonts.ready")
        buttons = page.eval_on_selector_all(".hero .cta-row .btn", """b => b.filter(x => getComputedStyle(x).display !== 'none').map(x => {
          const r = x.getBoundingClientRect();
          return { text: x.innerText.trim(), cls: x.className, top: Math.round(r.top), right: r.right, whole: x.scrollWidth <= x.clientWidth }; })""")
        assert buttons[0]["text"] == "Start my idea (free)" and "btn-primary" in buttons[0]["cls"], (width, buttons)
        assert len(buttons) == 2 and "btn-ghost" in buttons[1]["cls"], (width, buttons)
        assert buttons[0]["top"] == buttons[1]["top"] and all(b["whole"] and b["right"] <= width for b in buttons), (width, buttons)
        assert page.evaluate("() => document.documentElement.scrollWidth") <= width
        context.close()
    for width, height in ((1024, 768), (1280, 720), (1440, 900), (1100, 700)):
        context = _computer(browser, width, height)
        page = context.new_page()
        page.goto(f"{site}/", wait_until="load")
        page.evaluate("document.fonts.ready")
        at = page.evaluate("""() => {
          const hero = document.querySelector('.hero'), copy = document.querySelector('.hero-copy');
          const first = document.querySelector('.hero .cta-row .btn');
          const tiles = [...document.querySelectorAll('.ready-tile')].map(t => t.getBoundingClientRect());
          return { hero: hero.getBoundingClientRect().height, copy: copy.scrollHeight,
            ready: getComputedStyle(document.querySelector('.ready-today')).display,
            tilesTop: tiles.map(t => Math.round(t.top)), first: first.firstChild.textContent.trim(), primary: first.classList.contains('btn-primary'),
            facts: [...document.querySelectorAll('.facts > li')].filter(l => getComputedStyle(l).display !== 'none').map(l => (l.querySelector('.fact-k') || l).textContent.trim()),
            tall: document.documentElement.scrollHeight, view: innerHeight }; }""")
        assert at["ready"] != "none" and len(at["tilesTop"]) == 2 and at["tilesTop"][0] == at["tilesTop"][1], (width, at)
        assert at["first"] == "Start my idea (free)" and at["primary"], (width, at)
        assert at["copy"] <= at["hero"] + 1, (width, at)
        assert at["tall"] <= at["view"], (width, at)
        assert "Genesis" not in at["facts"] and "Orbyt" not in at["facts"] and any("Projects" in f for f in at["facts"]), (width, at)
        context.close()


def test_learn_more_close_button_has_its_own_room(site, browser):
    """The × no longer crowds "An MTRX Horizyn app" or the app's name: on a
    phone it sits in a strip above them, on a computer beside them."""
    for width, height, mobile in ((320, 568, True), (375, 667, True), (1440, 900, False)):
        context = browser.new_context(viewport={"width": width, "height": height}, is_mobile=mobile, has_touch=mobile)
        page = context.new_page()
        for key in ("rankup", "cyberlogix", "omniarmor"):
            page.goto(f"{site}/#learn-{key}", wait_until="load")
            at = page.evaluate(f"""() => {{ const x = document.querySelector('#learn-{key} .sheet-x').getBoundingClientRect();
              const parts = [...document.querySelectorAll('#learn-{key} .learn-head .eyebrow, #learn-{key} .learn-head h2')].map(e => {{
                const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); }});
              return {{ x: [x.left, x.top, x.right, x.bottom], parts: parts.map(p => [p.left, p.top, p.right, p.bottom]) }}; }}""")
            x = at["x"]
            for p in at["parts"]:
                apart = p[2] <= x[0] - 8 or p[1] >= x[3] + 2
                assert apart, (width, key, at)
            assert x[2] - x[0] >= 40, (width, key, at)
        context.close()


def test_pilot_explains_the_page_with_no_key_and_answers_typed_questions(site, browser):
    """No key: "Explain this page" answers at once with the page's own
    summary on Home, Genesis and Orbyt; typed questions ("Is my data
    safe?", "I'm 13, can I pitch?", "Give me an idea") get their built-in
    answers; nothing leaves the site. With a key, "Explain this page" asks
    the AI about the screen again."""
    context = _phone(browser)
    page = context.new_page()
    away = []
    page.on("request", lambda r: away.append(r.url) if not r.url.startswith(site) else None)
    for path, summary, asked, said in (
            ("/", "This is MTRX Horizyn's home page.", "Is my data safe?", "MTRX Horizyn keeps very little"),
            ("/genesis", "This is Genesis.", "Give me an idea", "Try an example"),
            ("/orbyt", "This is Orbyt", "I'm 13, can I pitch?", "at 13 you can send a pitch yourself")):
        page.goto(f"{site}{path}", wait_until="networkidle")
        page.wait_for_selector(".pilot-launcher", state="attached", timeout=10000)
        page.evaluate("() => window.Pilot.open()")
        page.wait_for_selector(".pilot-pill")
        page.click('.pilot-pill:has-text("Explain this page")')
        page.wait_for_selector(".pilot-from-pilot .pilot-md")
        assert summary in page.inner_text(".pilot-log"), path
        assert page.is_hidden(".pilot-settings-view"), path
        page.click(".pilot-clear")
        page.fill(".pilot-panel textarea", asked)
        page.press(".pilot-panel textarea", "Enter")
        page.wait_for_selector(".pilot-from-pilot .pilot-md")
        assert said in page.inner_text(".pilot-log"), (path, page.inner_text(".pilot-log"))
        page.click(".pilot-clear")
        page.evaluate("() => window.Pilot.close()")
    assert away == [], away
    # A key added: the button is the AI's explanation again (the provider is
    # never reached here: the request is stopped).
    page.route("https://**", lambda route: route.abort())
    page.evaluate("() => window.Pilot.store.addKey({ provider: 'anthropic', key: 'sk-test-not-real', model: 'test-model' })")
    page.goto(f"{site}/", wait_until="networkidle")
    page.wait_for_selector(".pilot-launcher", state="attached", timeout=10000)
    page.evaluate("() => window.Pilot.open()")
    page.wait_for_selector(".pilot-pill")
    page.click('.pilot-pill:has-text("Explain this page")')
    page.wait_for_selector(".pilot-from-user")
    assert "This is MTRX Horizyn's home page." not in page.inner_text(".pilot-log")
    assert "Analyze & explain this screen" in page.inner_text(".pilot-log")
    context.close()


def test_orbyt_send_error_shows_whole_under_the_bar(site, browser):
    """A pitch that can't be sent ("Please wait a while...") shows its error
    box in view, its top just under the bar (scroll-margin-top is the bar's
    measured height, like "Sent."), at 375x667, 320x568 and 1440x900."""
    why = "You've sent a few messages already. Please wait a while before sending another, or add anything you forgot when we reply."
    for width, height, mobile in ((375, 667, True), (320, 568, True), (1440, 900, False)):
        context = browser.new_context(viewport={"width": width, "height": height}, is_mobile=mobile, has_touch=mobile)
        page = context.new_page()
        page.route("**/api/vortex/send", lambda route: route.fulfill(status=429, content_type="application/json",
                                                                      body='{"ok": false, "error": "' + why + '"}'))
        page.goto(f"{site}/orbyt#pitch", wait_until="load")
        form = 'form[data-kind="pitch"]'
        page.fill(f'{form} input[name="name"]', "Ada")
        page.fill(f'{form} input[name="email"]', "ada@example.com")
        page.fill(f'{form} input[name="idea"]', "Nova")
        page.fill(f'{form} input[name="pitch"]', "Homework reminders")
        page.fill(f'{form} input[name="audience"]', "Students")
        page.click(f'{form} button[type="submit"]')
        page.wait_for_function(f"() => document.querySelector('{form} [data-error]').textContent.length > 0")
        page.wait_for_timeout(200)
        at = page.evaluate(f"""() => {{ const box = document.querySelector('{form} [data-error]').getBoundingClientRect();
          const bar = document.querySelector('.topbar').getBoundingClientRect();
          return {{ top: box.top, bottom: box.bottom, bar: bar.bottom, view: innerHeight,
            margin: getComputedStyle(document.querySelector('{form} [data-error]')).scrollMarginTop }}; }}""")
        assert at["top"] >= at["bar"] - 1 and at["bottom"] <= at["view"], (width, at)
        assert at["margin"] == f"{round(at['bar'])}px" or abs(float(at["margin"][:-2]) - at["bar"]) <= 1, (width, at)
        context.close()
