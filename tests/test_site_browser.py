"""Home, Genesis and Orbyt (1.22.0) in a real browser: what only layout can
show. The server and browser come from tests/test_browser.py (skipped there
too where Playwright or its Chromium isn't installed; CI has both)."""

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
    for width in (1024, 1100, 1180, 1280, 1440):
        context = _computer(browser, width, 800)
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


# ---------------------------------------------------------------- 1.24.0 (round 9)

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
        assert page.eval_on_selector(".btn-genesis", "e => getComputedStyle(e).display") == "none"
        assert page.evaluate("() => document.documentElement.scrollWidth") <= width
        context.close()
    context = _computer(browser)
    page = context.new_page()
    page.goto(f"{site}/", wait_until="load")
    assert page.eval_on_selector(".ready-today", "e => getComputedStyle(e).display") == "none"
    assert page.is_visible(".fact-genesis") and page.is_visible(".btn-genesis")
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


def test_genesis_at_320_keeps_the_spark_on_the_first_screen_and_words_whole(site, browser):
    """320x568, first visit and coming back: today's spark's line is on the
    first screen; "TODAY'S SPARK · <date>" is one line; "Welcome back" is one
    line; and the Continue button is one line ("Continue →", the project's
    name is just above it)."""
    context = browser.new_context(viewport={"width": 320, "height": 568}, is_mobile=True, has_touch=True)
    page = context.new_page()
    for returning in (False, True):
        page.goto(f"{site}/genesis", wait_until="load")
        if returning:
            page.evaluate(SEED)
            page.reload(wait_until="load")
            page.wait_for_selector(".g-continue-tick")
        page.wait_for_selector("#g-daily-title:not(:empty)")
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
