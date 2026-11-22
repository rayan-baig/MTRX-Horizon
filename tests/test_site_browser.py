"""Home, Genesis and Orbyt (1.21.0) in a real browser: what only layout can
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
