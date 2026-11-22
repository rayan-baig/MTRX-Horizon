"""The pages in a real browser (Chromium, through Playwright), against the
real server: what only a browser can show.

Skipped where Playwright or its Chromium isn't installed. CI installs both,
so there they always run. MTRX_BROWSER (a path to a Chromium) picks one by
hand.
"""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent

sync_api = pytest.importorskip("playwright.sync_api")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    yield from _serve(tmp_path_factory, {})


def _serve(tmp_path_factory, extra: dict, port: int | None = None):
    tmp = tmp_path_factory.mktemp("browser")
    port = port or _free_port()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("MTRX_", "ORBYT_REVIEW_")) and not k.endswith("_URL")}
    env.update(MTRX_DB_PATH=str(tmp / "horizon.db"), MTRX_KNOCK="logo logo omniarmor rankup", MTRX_DEV="1",
               MTRX_SETUP_TOKEN="a-browser-test-setup-code-123456", **extra)
    log = open(tmp / "server.log", "a")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "horizon.main:app", "--host", "127.0.0.1",
                             "--port", str(port)], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 20
    with httpx.Client(trust_env=False, timeout=2) as http:
        while True:
            try:
                if http.get(url + "/healthz").status_code == 200:
                    break
            except httpx.TransportError:
                pass
            if proc.poll() is not None or time.monotonic() > deadline:
                proc.kill()
                raise AssertionError("the server did not start:\n" + (tmp / "server.log").read_text())
            time.sleep(0.05)
    yield url
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    log.close()


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch(executable_path=os.environ.get("MTRX_BROWSER") or None)
        except Exception as err:  # no Chromium on this computer
            pytest.skip(f"no Chromium for Playwright here: {str(err).splitlines()[0]}")
        yield b
        b.close()


_FORM_PLACE = """kind => {
    const form = document.getElementById(`v-${kind}`);
    return { hidden: form.hidden, top: Math.round(form.getBoundingClientRect().top), y: Math.round(window.scrollY) };
}"""
# The form is shown, near the top of the screen (under the bar).
_FORM_IN_VIEW = f"""kind => {{
    const w = ({_FORM_PLACE})(kind);
    return !w.hidden && w.top >= -5 && w.top <= 140 && w.y >= 100;
}}"""


def _lands_on_form(page, site, kind, settle_ms=2500):
    """Opens /orbyt#kind; None if the form ends up in view, else where it was."""
    page.goto(f"{site}/orbyt#{kind}", wait_until="load")
    try:
        page.wait_for_function(_FORM_IN_VIEW, arg=kind, timeout=settle_ms)
        return None
    except sync_api.TimeoutError:
        return page.evaluate(_FORM_PLACE, kind)


@pytest.mark.parametrize("kind", ["pitch", "partner"])
def test_a_direct_link_to_an_orbyt_form_always_lands_on_it(site, browser, kind):
    """/orbyt#pitch and /orbyt#partner open their form and scroll to it.
    1.16 scrolled with behavior "auto", which the page's smooth-scroll style
    turns into a smooth scroll; started that early it was often cut short,
    and the visitor was left at the top. Loaded many times, on a phone and a
    computer, it must land on the form every time (and stay there: it is
    checked again a moment later)."""
    misses = []
    for size in ({"width": 390, "height": 844}, {"width": 1440, "height": 900}):
        context = browser.new_context(viewport=size)
        page = context.new_page()
        for attempt in range(12):
            miss = _lands_on_form(page, site, kind)
            if miss is None:
                page.wait_for_timeout(200)
                if not page.evaluate(_FORM_IN_VIEW, kind):
                    miss = page.evaluate(_FORM_PLACE, kind)
            if miss is not None:
                misses.append((size["width"], attempt, miss))
        context.close()
    assert not misses, misses


@pytest.mark.parametrize("kind", ["pitch", "partner"])
def test_a_form_link_still_lands_when_the_fonts_arrive_late(site, browser, kind):
    """The race behind the flaky test above, made certain: the first jump runs
    before the fonts arrive; when they swap in, the text above the form
    reflows and (on a phone, for Pitch) the form ended 54 px below where it
    should be (scrollY 733, not 787). 1.18 checked again after loading only
    if the visitor was still within 40 px of the top, so it stayed there.
    Now it is put back whenever it isn't under the bar."""
    misses = []
    for size in ({"width": 390, "height": 844}, {"width": 1440, "height": 900}):
        context = browser.new_context(viewport=size)
        page = context.new_page()

        def late(route):
            time.sleep(0.3)
            route.continue_()

        page.route("**/*.woff2", late)
        for attempt in range(2):
            miss = _lands_on_form(page, site, kind)
            if miss is not None:
                misses.append((size["width"], attempt, miss))
        context.close()
    assert not misses, misses


def test_a_form_link_leaves_a_visitor_who_scrolled_alone(site, browser):
    """Putting the form back stops as soon as the visitor scrolls: the page
    must never pull them back to the form."""
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()

    def late(route):
        time.sleep(0.4)
        route.continue_()

    page.route("**/*.woff2", late)
    page.goto(f"{site}/orbyt#pitch", wait_until="domcontentloaded")
    jumped = page.evaluate("window.scrollY")
    page.mouse.move(200, 400)
    page.mouse.wheel(0, -500)
    page.wait_for_function("y => window.scrollY < y", arg=jumped - 300, timeout=3000)
    page.wait_for_load_state("load")
    page.wait_for_timeout(2000)
    where = page.evaluate(_FORM_PLACE, "pitch")
    context.close()
    # Still well below the bar, where the visitor's scroll left it.
    assert where["top"] > 300, where


def test_after_sending_orbyt_says_what_happens_next_with_a_date(site, browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page.goto(f"{site}/orbyt#pitch", wait_until="load")
    page.fill('form[data-kind="pitch"] input[name="name"]', "Ada")
    page.fill('form[data-kind="pitch"] input[name="email"]', "ada@example.com")
    page.fill('form[data-kind="pitch"] input[name="idea"]', "Nova")
    page.fill('form[data-kind="pitch"] input[name="pitch"]', "Homework reminders")
    page.fill('form[data-kind="pitch"] input[name="audience"]', "Students")
    page.click('form[data-kind="pitch"] button[type="submit"]')
    page.wait_for_selector("#v-sent:not([hidden])", timeout=10000)
    line = page.text_content("#v-next-step")
    assert line.startswith("What happens next: a real person reads your message and emails you back by ")
    expected = page.evaluate("VortexForm.replyBy(new Date())")
    assert expected in line
    context.close()


def _phone(browser):
    return browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True, has_touch=True)


def test_pilot_answers_its_own_pills_with_no_key_and_sends_nothing(site, browser):
    """Core 1.4.0: "What is Orbyt?" and "What apps are coming?" are answered
    at once, with no AI key: no "add a key" wall, and no request leaves the
    site. The answer's link to /orbyt works in this tab; "Help with my idea"
    goes to Genesis's start form."""
    context = _phone(browser)
    page = context.new_page()
    away = []
    page.on("request", lambda r: away.append(r.url) if not r.url.startswith(site) else None)
    page.goto(f"{site}/", wait_until="networkidle")
    page.wait_for_selector(".pilot-launcher", timeout=10000)
    page.click(".pilot-launcher")
    page.wait_for_selector(".pilot-pill")
    page.click('.pilot-pill:has-text("What is Orbyt?")')
    page.wait_for_selector(".pilot-from-pilot .pilot-md")
    assert page.is_hidden(".pilot-settings-view"), "no key wall"
    assert "official place to work with MTRX Horizyn" in page.inner_text(".pilot-log")
    assert page.inner_text(".pilot-more").startswith("Want more? Add your AI key to ask anything.")
    assert page.eval_on_selector('.pilot-log a[href$="/orbyt"]', "a => a.target") == ""
    page.click(".pilot-clear")
    page.click('.pilot-pill:has-text("What apps are coming?")')
    page.wait_for_selector(".pilot-from-pilot .pilot-md")
    text = page.inner_text(".pilot-log")
    for name in ("RankUp", "CyberLogix AI", "OmniArmor.ai"):
        assert name in text
    assert "in development" in text
    page.click(".pilot-clear")
    with page.expect_navigation():
        page.click('.pilot-pill:has-text("Help with my idea")')
    assert page.url.endswith("/genesis#new")
    assert away == [], away
    context.close()


# The core's placement in a real browser, on a phone page made for the test:
# a sticky header (its left end empty, as CyberLogix's console header) with
# the logo link and a small "Home" link, a page of
# words, and big link cards at the bottom.
PHONE_PAGE = """() => {
  for (const n of [...document.body.children]) if (!n.classList.contains("pilot-root")) n.remove();
  const header = document.createElement("header");
  header.className = "t-head";
  const logo = document.createElement("a"); logo.href = "/"; logo.textContent = "MTRX HORIZYN"; logo.className = "t-logo";
  const home = document.createElement("a"); home.href = "/"; home.textContent = "Home"; home.className = "t-home";
  header.append(logo, home);
  const main = document.createElement("main");
  main.className = "t-main";
  for (let i = 0; i < 6; i++) { const p = document.createElement("p"); p.textContent = "Words of the page. ".repeat(30); main.append(p); }
  for (let i = 0; i < 4; i++) { const a = document.createElement("a"); a.href = "/orbyt"; a.className = "t-card"; a.textContent = "A big card link"; main.append(a); }
  document.body.append(header, main);
  const s = new CSSStyleSheet();
  s.replaceSync(`.t-head{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;height:53px;padding:0 4px 0 64px;background:#111}
    .t-home{display:inline-block;width:47px;height:40px;line-height:40px} .t-main{padding:0 16px} .t-main p{text-align:justify}
    .t-card{display:block;height:106px;margin:8px 14px;border:1px solid #888}`);
  document.adoptedStyleSheets = [s];
  window.scrollTo(0, 0);
}"""


def test_pilot_on_a_phone_never_parks_in_a_top_corner_over_the_header(site, browser):
    """Core 1.4.0: core 1.3.0 tucked the phone robot at the top (3,3 from
    the screen's corner, or over a small header "Home" link) when every
    corner had something; now the bottom corners come first on phones, and a
    tucked robot never covers a link while another corner avoids one."""
    context = _phone(browser)
    page = context.new_page()
    page.goto(f"{site}/privacy", wait_until="networkidle")
    page.wait_for_selector(".pilot-launcher", timeout=10000)
    page.evaluate(PHONE_PAGE)
    for y in (0, 300, 900):
        page.evaluate(f"window.scrollTo(0, {y})")
        page.wait_for_timeout(500)
        place = page.evaluate("""() => {
          const root = document.querySelector(".pilot-root");
          return PilotMascot.placeNow({ doc: document, win: window, own: root, launcher: root.querySelector(".pilot-launcher"),
            avoid: [], corner: "br", shown: "br", full: true, text: true, keepIn: true });
        }""")
        assert place["corner"][0] == "b", (y, place)
    # And the page's own robot agrees once scrolling has stopped.
    page.wait_for_timeout(600)
    assert page.evaluate("document.querySelector('.pilot-root').className").count("pilot-at-b") == 1
    context.close()


# ---------------------------------------------------------------- Orbyt Pitch Review (1.20.0)

@pytest.fixture(scope="module")
def review_site(tmp_path_factory):
    """The site with Pitch Review switched on and set up. Its mail server is
    a closed port here, so nothing is ever sent, and Stripe is never reached:
    the page's checkout request is answered by the test."""
    yield from _serve(tmp_path_factory, {
        "ORBYT_REVIEW_ENABLED": "1", "STRIPE_SECRET_KEY": "sk_test_not_real",
        "ORBYT_REVIEW_STRIPE_WEBHOOK_SECRET": "whsec_browser_test", "ORBYT_REVIEW_STRIPE_PRICE": "price_review1",
        "MTRX_ALERT_EMAIL": "alerts@example.com", "MTRX_ALERT_FROM": "site@example.com",
        "MTRX_SMTP_HOST": "127.0.0.1", "MTRX_SMTP_PORT": str(_free_port())})


def test_pitch_review_is_offered_after_a_pitch_and_needs_the_18_tick(review_site, browser):
    """On a phone: the offer appears only on the Sent screen, fits the
    screen, refuses to start checkout without the 18+ tick, and with it sends
    only the pitch's ticket and the tick, then goes to Stripe's page."""
    context = _phone(browser)
    page = context.new_page()
    asked = []

    def checkout(route):
        asked.append(route.request.post_data_json)
        route.fulfill(status=200, content_type="application/json",
                      body='{"url": "https://checkout.stripe.com/c/pay/cs_test_browser"}')

    page.route("**/api/orbyt/review/checkout", checkout)
    page.route("https://checkout.stripe.com/**", lambda route: route.fulfill(status=200, body="Stripe checkout"))
    page.goto(f"{review_site}/orbyt#pitch", wait_until="load")
    assert not page.is_visible("#v-review")
    page.fill('form[data-kind="pitch"] input[name="name"]', "Ada")
    page.fill('form[data-kind="pitch"] input[name="email"]', "ada@example.com")
    page.fill('form[data-kind="pitch"] input[name="idea"]', "Nova")
    page.fill('form[data-kind="pitch"] input[name="pitch"]', "Homework reminders")
    page.fill('form[data-kind="pitch"] input[name="audience"]', "Students")
    page.click('form[data-kind="pitch"] button[type="submit"]')
    page.wait_for_selector("#v-review:not([hidden])", timeout=10000)
    # It fits a 375 px phone: nothing wider than the screen.
    assert page.evaluate("document.documentElement.scrollWidth") <= 375
    box = page.locator("#v-review").bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 375
    assert page.locator("#v-review-buy").bounding_box()["height"] >= 44
    # No tick: told why, the tick gets the focus, and nothing is asked.
    page.click("#v-review-buy")
    assert "18 or over" in page.text_content("#v-review-error")
    assert page.evaluate("document.activeElement.id") == "v-review-adult"
    assert asked == []
    page.check("#v-review-adult")
    page.click("#v-review-buy")
    page.wait_for_url("https://checkout.stripe.com/**", timeout=10000)
    assert len(asked) == 1 and set(asked[0]) == {"ticket", "adult"} and asked[0]["adult"] is True
    assert len(asked[0]["ticket"]) >= 20
    context.close()


def test_pitch_review_is_never_offered_after_other_paths(review_site, browser):
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    page = context.new_page()
    page.goto(f"{review_site}/orbyt#invest", wait_until="load")
    page.fill('form[data-kind="invest"] input[name="name"]', "Sam")
    page.fill('form[data-kind="invest"] input[name="email"]', "sam@example.com")
    page.fill('form[data-kind="invest"] textarea[name="message"]', "Hello there")
    page.click('form[data-kind="invest"] button[type="submit"]')
    page.wait_for_selector("#v-sent:not([hidden])", timeout=10000)
    assert not page.is_visible("#v-review")


# ---------------------------------------------------------------- core 1.4.1

# Where the robot is and what it covers: hidden (faded out), its corner,
# tucked or not, and the links and buttons under the part of it that shows.
_ROBOT = """() => {
  const root = document.querySelector(".pilot-root");
  const l = root.querySelector(".pilot-launcher");
  const hidden = getComputedStyle(l).visibility === "hidden" || getComputedStyle(root).visibility === "hidden";
  const r = l.getBoundingClientRect();
  const q = { left: Math.max(r.left, 0), right: Math.min(r.right, innerWidth), top: Math.max(r.top, 0), bottom: Math.min(r.bottom, innerHeight) };
  const under = [];
  if (!hidden) {
    for (const e of document.querySelectorAll("a[href], button, input, textarea, select, summary, [role=button]")) {
      if (root.contains(e)) continue;
      for (const b of e.getClientRects()) {
        const ix = Math.min(b.right, q.right) - Math.max(b.left, q.left), iy = Math.min(b.bottom, q.bottom) - Math.max(b.top, q.top);
        if (ix > 2 && iy > 2) { under.push((e.innerText || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 40)); break; }
      }
    }
  }
  return { hidden, corner: (root.className.match(/pilot-at-(\\w\\w)/) || [])[1], peek: root.classList.contains("pilot-peek"),
    away: root.classList.contains("pilot-away"), top: Math.round(q.top), left: Math.round(q.left), under, y: Math.round(scrollY) };
}"""


def _phone_size(browser, width, height):
    return browser.new_context(viewport={"width": width, "height": height}, is_mobile=True, has_touch=True,
                               device_scale_factor=2)


def _pilot_page(context, url):
    page = context.new_page()
    page.goto(url, wait_until="networkidle")
    # Attached, maybe not visible: with no room it waits out of sight (1.4.1).
    page.wait_for_selector(".pilot-launcher", state="attached", timeout=10000)
    # The first look (4 s) is over, and the moving robot is awake.
    page.wait_for_timeout(4800)
    return page


def test_pilot_typing_low_on_a_phone_fades_out_and_comes_back(site, browser):
    """Core 1.4.1: typing in Genesis's "today's spark" low on a phone's
    screen sent the robot to the top left, 3 px from the corner, over the
    logo and the Home link (round-7). Now it fades out while the box is
    typed in (every corner left would cover the header) and comes back
    after."""
    context = _phone_size(browser, 375, 812)
    page = _pilot_page(context, f"{site}/genesis")
    # Since 1.22.0 today's spark is on a phone's first screen, too high to
    # scroll down to 770 px: room above it puts the box low again.
    page.evaluate("""() => { const e = document.querySelector('#g-daily-input');
      const gap = Math.ceil(770 - e.getBoundingClientRect().top - scrollY);
      if (gap > 0) { const s = new CSSStyleSheet(); s.replaceSync(`#g-daily { margin-top: ${gap}px; }`);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]; } }""")
    page.evaluate("""() => { const e = document.querySelector('#g-daily-input'); scrollBy(0, e.getBoundingClientRect().top - 770); }""")
    page.wait_for_timeout(900)
    page.tap("#g-daily-input")
    page.keyboard.type("Homework reminders", delay=10)
    page.wait_for_timeout(900)
    typing = page.evaluate(_ROBOT)
    assert typing["hidden"] and typing["away"], typing
    assert not (typing["top"] < 60 and not typing["hidden"]), typing
    page.evaluate("document.activeElement.blur()")
    page.wait_for_timeout(900)
    after = page.evaluate(_ROBOT)
    assert not after["hidden"] and after["corner"][0] == "b", after
    context.close()


@pytest.mark.parametrize("size", [(375, 812), (375, 667), (320, 640)])
def test_pilot_while_scrolling_a_phone_keeps_one_bottom_corner(site, browser, size):
    """Core 1.4.1: on Home it changed corner about every 100 px and sat
    whole in a top corner over the headline or a card. Now, once scrolled,
    it is tucked in one bottom corner (or faded out for a moment), never
    whole, never at the top, never over a link or button, and it changes
    corner only a few times from the top of the page to the bottom."""
    context = _phone_size(browser, *size)
    page = _pilot_page(context, f"{site}/")
    height = page.evaluate("document.documentElement.scrollHeight - innerHeight")
    seen, problems = [], []
    for y in range(100, height + 100, 100):
        page.evaluate(f"window.scrollTo(0, {min(y, height)})")
        page.wait_for_timeout(700)
        r = page.evaluate(_ROBOT)
        if r["y"] <= 8:
            continue
        key = "hidden" if r["hidden"] else r["corner"]
        if not seen or seen[-1] != key:
            seen.append(key)
        if not r["hidden"] and (r["corner"][0] != "b" or not r["peek"] or r["under"]):
            problems.append(r)
    context.close()
    assert not problems, problems
    assert len(seen) <= 4, seen


@pytest.mark.parametrize("size", [(375, 667), (390, 844)])
def test_pilot_resting_on_orbyt_never_covers_a_path_card(site, browser, size):
    """Core 1.4.1: at the top of Orbyt the tucked robot sat on the corner of
    the big "Early access" / "Partner with us" cards, so tapping the card's
    corner opened Pilot. A link under the robot now counts in full; with a
    link in every corner the robot waits out of sight until a scroll."""
    context = _phone_size(browser, *size)
    page = _pilot_page(context, f"{site}/orbyt")
    for y in (0, 100, 200):
        page.evaluate(f"window.scrollTo(0, {y})")
        page.wait_for_timeout(800)
        r = page.evaluate(_ROBOT)
        assert not r["under"], (y, r)
    context.close()


# A phone page where every corner would cover something: RankUp's gift page
# (full-width "Pay" buttons, no tab bar) or CyberLogix's console at 320 px
# (a sticky bar on top that the app asks Pilot to avoid, a search box and
# tabs along the bottom).
CROWDED_PAGE = """(kind) => {
  for (const n of [...document.body.children]) if (!n.classList.contains("pilot-root")) n.remove();
  const main = document.createElement("main");
  const s = new CSSStyleSheet();
  if (kind === "gift") {
    for (let i = 0; i < 14; i++) { const b = document.createElement("button"); b.className = "t-pay"; b.textContent = "Pay"; main.append(b); }
    s.replaceSync(`.t-pay{display:block;width:100%;height:96px;margin:0 0 4px;border:0;background:#335}`);
  } else {
    const bar = document.createElement("div"); bar.className = "t-bar"; bar.textContent = "Needs you now"; document.body.append(bar);
    for (let i = 0; i < 30; i++) { const p = document.createElement("p"); p.textContent = "Fridge " + i; main.append(p); }
    const finder = document.createElement("input"); finder.className = "t-finder"; finder.placeholder = "Search";
    const tab = document.createElement("button"); tab.className = "t-tab"; tab.textContent = "Everything";
    const row = document.createElement("div"); row.className = "t-row"; row.append(finder, tab); document.body.append(row);
    s.replaceSync(`.t-bar{position:sticky;top:0;height:56px;background:#511} .t-row{position:fixed;left:0;right:0;bottom:0;display:flex;height:52px}
      .t-finder{flex:1} .t-tab{width:120px}`);
    window.Pilot.config.avoid = [".t-bar", ".t-finder", ".t-tab"];
  }
  document.body.prepend(main);
  document.adoptedStyleSheets = [s];
  window.scrollTo(0, 0);
}"""


@pytest.mark.parametrize("kind,size", [("gift", (375, 812)), ("console", (320, 640))])
def test_pilot_hides_rather_than_covers_when_every_corner_is_taken(site, browser, kind, size):
    """Core 1.4.1: RankUp's gift page scrolled to 500 px (a full-width Pay
    button in every corner) and CyberLogix's console at 320 px (avoided
    bars top and bottom): 1.4.0 tucked over the edge of a Pay button or the
    search box. Now it fades out; and the window still opens."""
    context = _phone_size(browser, *size)
    page = _pilot_page(context, f"{site}/privacy")
    page.evaluate(CROWDED_PAGE, kind)
    page.wait_for_timeout(300)
    page.evaluate("window.scrollTo(0, 500)")
    page.wait_for_timeout(900)
    r = page.evaluate(_ROBOT)
    assert r["hidden"] and r["away"] and not r["under"], r
    # Core 1.4.2: the handle, once the page has been still about 2 s: never on the gift page (a Pay button at
    # every edge), and on the console only between the avoided bars, covering nothing.
    page.wait_for_timeout(2300)
    h = page.evaluate(_HANDLE)
    if kind == "gift":
        assert h is None, h
    else:
        assert h and not h["under"] and 56 <= h["top"] and h["top"] + h["height"] <= size[1] - 52, h
    page.evaluate("Pilot.open()")
    page.wait_for_selector(".pilot-panel:not([hidden])")
    assert page.is_visible(".pilot-panel")
    context.close()


def test_pilot_keeps_the_welcome_pills_under_its_own_answers_and_opens_long_ones_at_the_top(site, browser):
    """Core 1.4.1: after one built-in answer the welcome's pills were gone
    until "Clear chat"; now a compact row of them sits under the answer and
    works. A long answer opens at its first line, not its last."""
    context = _phone(browser)
    page = context.new_page()
    page.goto(f"{site}/", wait_until="networkidle")
    page.wait_for_selector(".pilot-launcher", timeout=10000)
    page.click(".pilot-launcher")
    page.click('.pilot-pill:has-text("What is Orbyt?")')
    page.wait_for_selector(".pilot-again .pilot-pill")
    row = page.eval_on_selector_all(".pilot-again .pilot-pill", "ps => ps.map(p => p.innerText.trim())")
    assert "What apps are coming?" in row and "Help with my idea" in row, row
    assert "What is Orbyt?" not in row and "Add my AI key" not in row, row
    # Smaller than the welcome's pills, and in a wrapping row (each as wide as its words, not the window).
    sizes = page.evaluate("""() => { const p = [...document.querySelectorAll('.pilot-again .pilot-pill')];
      const row = document.querySelector('.pilot-pills-row').getBoundingClientRect();
      return { h: Math.max(...p.map(x => x.getBoundingClientRect().height)), w: Math.max(...p.map(x => x.getBoundingClientRect().width)), row: row.width }; }""")
    assert sizes["h"] < 40 and sizes["w"] < sizes["row"] * 0.8, sizes
    page.click('.pilot-again .pilot-pill:has-text("What apps are coming?")')
    page.wait_for_function("() => document.querySelectorAll('.pilot-from-pilot .pilot-md').length === 2")
    page.wait_for_timeout(300)
    # The newest answer opens at its first line when it doesn't fit (the phone's sheet is short enough here).
    where = page.evaluate("""() => {
      const box = document.querySelector('.pilot-scroll'); const a = [...document.querySelectorAll('.pilot-from-pilot')].pop();
      const top = a.getBoundingClientRect().top - box.getBoundingClientRect().top;
      return { top, fits: box.scrollHeight - (a.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop) <= box.clientHeight,
        atEnd: Math.abs(box.scrollTop - (box.scrollHeight - box.clientHeight)) < 2 }; }""")
    if where["fits"]:
        assert where["atEnd"], where
    else:
        assert 0 <= where["top"] <= 16, where
    assert page.is_visible('.pilot-again .pilot-pill:has-text("What is Orbyt?")')
    # "Want more?" shows once per chat; under the second answer the row keeps the key pill instead.
    assert page.locator(".pilot-more").count() == 1
    assert page.is_visible('.pilot-again .pilot-pill:has-text("Add my AI key")')
    # The grown-ups note stays one line in the chat, with "More" for the whole note.
    assert page.inner_text(".pilot-foot-note-words") == "AI keys are for grown-ups (18+)."
    one_line = page.eval_on_selector(".pilot-foot-note", "n => n.getBoundingClientRect().height")
    page.click(".pilot-note-more")
    assert page.inner_text(".pilot-foot-note-words").startswith("Pilot uses a grown-up's AI key")
    assert page.inner_text(".pilot-note-more") == "Less"
    assert one_line < 24, one_line
    context.close()


# ---------------------------------------------------------------- core 1.4.2

# The handle (1.4.2): where it is (null while it isn't showing), and the
# links, buttons, boxes and avoided things under its whole 44 px square.
_HANDLE = """() => {
  const root = document.querySelector(".pilot-root");
  const h = root.querySelector(".pilot-handle");
  if (!h || getComputedStyle(h).display === "none" || getComputedStyle(root).visibility === "hidden") return null;
  const r = h.getBoundingClientRect();
  const hit = (b) => Math.min(b.right, r.right) - Math.max(b.left, r.left) > 0 && Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 0;
  const under = [];
  for (const e of document.querySelectorAll("a[href], button, input, textarea, select, summary, label, [role=button], [role=link], [role=tab]")) {
    if (root.contains(e)) continue;
    if ([...e.getClientRects()].some(hit)) under.push((e.innerText || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 40));
  }
  for (const sel of [...(Pilot.config.avoid || []), ...(Pilot.config.yieldTo || [])]) {
    for (const e of document.querySelectorAll(sel)) if (!root.contains(e) && [...e.getClientRects()].some(hit)) under.push(sel);
  }
  return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height),
    label: h.getAttribute("aria-label"), under };
}"""


@pytest.mark.parametrize("path", ["/", "/genesis", "/orbyt"])
@pytest.mark.parametrize("size", [(320, 640), (375, 667), (375, 812), (390, 844)])
def test_pilot_hidden_at_rest_shows_a_handle_that_covers_nothing(site, browser, path, size):
    """Core 1.4.2: 1.4.1 kept the robot out of sight wherever every spot
    would cover a link (the top of Orbyt on a small phone, part of Home), so
    a visitor might never find Pilot. Now, about 2 s after it hides with the
    page still, a handle shows at the screen's left or right edge: a 44 px
    square that covers no link, button, box or avoided thing, and opens
    Pilot. Never while the robot shows, never while the page scrolls."""
    context = _phone_size(browser, *size)
    page = _pilot_page(context, f"{site}{path}")
    tapped = False
    for y in (0, 350, 700):
        if y:
            page.evaluate(f"window.scrollTo(0, {y})")
            page.wait_for_timeout(700)
            r = page.evaluate(_ROBOT)
            assert r["hidden"] or page.evaluate(_HANDLE) is None, (y, r)
            if r["away"]:
                assert page.evaluate(_HANDLE) is None, "not at once: about 2 s after the page stops"
                page.wait_for_timeout(2300)
        r = page.evaluate(_ROBOT)
        h = page.evaluate(_HANDLE)
        if not r["hidden"]:
            assert h is None, (y, r, h)
            continue
        assert h, (y, r, "hidden at rest with free room at the edges, so the handle shows")
        assert h["width"] >= 44 and h["height"] >= 44, h
        assert h["left"] == 0 or h["left"] + h["width"] == size[0], h
        assert 0 <= h["top"] and h["top"] + h["height"] <= size[1], h
        assert not h["under"], (y, h)
        assert h["label"] == "Open Pilot, your AI helper"
        if not tapped:
            page.tap(".pilot-handle")
            page.wait_for_selector(".pilot-panel:not([hidden])")
            assert page.evaluate(_HANDLE) is None
            page.evaluate("Pilot.close()")
            tapped = True
            page.wait_for_timeout(300)
    context.close()


# OmniArmor's signed-in phone pages (made for the test): a fixed tab bar
# along the bottom, 64 px, with four links, and the robot's corners raised
# above it by the app's own CSS (--pilot-gap: 76px), as OmniArmor 1.18.0
# does; a long page of words. `links`: a row of buttons right above the
# tab bar, edge to edge, so every bottom corner would cover one.
TAB_PAGE = """(links) => {
  for (const n of [...document.body.children]) if (!n.classList.contains("pilot-root")) n.remove();
  const main = document.createElement("main");
  main.className = "t-main";
  for (let i = 0; i < 40; i++) { const p = document.createElement("p"); p.textContent = "Words of the page. ".repeat(8); main.append(p); }
  const bar = document.createElement("nav"); bar.className = "t-tabbar";
  for (const w of ["Home", "Checks", "Codes", "More"]) { const a = document.createElement("a"); a.href = "/"; a.textContent = w; bar.append(a); }
  document.body.append(main, bar);
  if (links) {
    const row = document.createElement("div"); row.className = "t-over";
    for (const w of ["Save", "Print"]) { const b = document.createElement("button"); b.textContent = w; row.append(b); }
    document.body.append(row);
  }
  const s = new CSSStyleSheet();
  s.replaceSync(`.t-main{padding:0 30px 160px} .t-tabbar{position:fixed;left:0;right:0;bottom:0;height:64px;display:flex;background:#222}
    .t-tabbar a{flex:1;line-height:64px;text-align:center} .t-over{position:fixed;left:0;right:0;bottom:66px;height:60px;display:flex}
    .t-over button{flex:1} body .pilot-root{--pilot-gap:76px}`);
  document.adoptedStyleSheets = [s];
  window.scrollTo(0, 0);
}"""


@pytest.mark.parametrize("size", [(320, 640), (375, 812), (390, 844)])
def test_pilot_raised_above_a_tab_bar_stays_tucked_above_it_once_scrolled(site, browser, size):
    """Core 1.4.2: an app that raises the robot's corners above its tab bar
    (OmniArmor) had the robot hidden on every scrolled phone page under core
    1.4.1, which measured the tucked robot at the screen's edge, over the
    tab bar. Now it is measured, and drawn, in its raised corner: tucked
    there above the bar while words pass under it."""
    context = _phone_size(browser, *size)
    page = _pilot_page(context, f"{site}/privacy")
    page.evaluate(TAB_PAGE, False)
    for y in (300, 900, 1500):
        page.evaluate(f"window.scrollTo(0, {y})")
        page.wait_for_timeout(900)
        r = page.evaluate(_ROBOT)
        assert not r["hidden"] and r["peek"] and r["corner"][0] == "b" and not r["under"], (y, r)
        drawn = page.evaluate("""() => { const b = document.querySelector('.pilot-launcher').getBoundingClientRect();
          return { bottom: innerHeight - b.bottom, right: innerWidth - b.right, left: b.left }; }""")
        assert drawn["bottom"] >= 64, (y, drawn, "never over the tab bar")
        # Where placement measures it is where it is drawn.
        measured = page.evaluate("""() => { const root = document.querySelector('.pilot-root'); const css = getComputedStyle(root);
          const n = (k) => parseFloat(css.getPropertyValue(k));
          const c = (root.className.match(/pilot-at-(\\w\\w)/) || [])[1];
          const room = PilotMascot.edgeRoom(root, css, n('--pilot-gap'), c);
          const b = PilotMascot.peekBox(c, { width: innerWidth, height: innerHeight }, { width: 56, height: 54 }, room, 20,
            { scale: n('--pilot-peek-scale'), margin: n('--pilot-keep-margin'), pull: Math.min(n('--pilot-gap'), n('--pilot-keep-room')) - n('--pilot-keep-margin') });
          return { bottom: innerHeight - b.bottom, right: innerWidth - b.right, left: b.left }; }""")
        assert abs(drawn["bottom"] - measured["bottom"]) <= 1, (drawn, measured)
        assert abs(drawn["right"] - measured["right"]) <= 1 or abs(drawn["left"] - measured["left"]) <= 1, (drawn, measured)
    context.close()


def test_pilot_handle_on_a_tab_bar_page_sits_above_the_bar_and_leaves_while_scrolling(site, browser):
    """Core 1.4.2: buttons right above the tab bar in both bottom corners
    hide the robot; the handle then shows at an edge above them (never on the
    bar or a button), goes at once while the page scrolls, and comes back
    about 2 s after it stops."""
    context = _phone_size(browser, 375, 812)
    page = _pilot_page(context, f"{site}/privacy")
    page.evaluate(TAB_PAGE, True)
    page.evaluate("window.scrollTo(0, 400)")
    page.wait_for_timeout(900)
    assert page.evaluate(_ROBOT)["away"]
    page.wait_for_timeout(2300)
    h = page.evaluate(_HANDLE)
    assert h and not h["under"] and h["top"] + h["height"] <= 812 - 126, h
    page.evaluate("window.scrollBy(0, 200)")
    # Gone while the page moves (at the next look, a frame or so later).
    page.wait_for_function("() => { const h = document.querySelector('.pilot-handle'); return !h || getComputedStyle(h).display === 'none'; }", timeout=1000)
    page.wait_for_timeout(1000)
    assert page.evaluate(_HANDLE) is None, "not back until about 2 s after it stops"
    page.wait_for_timeout(2000)
    assert page.evaluate(_HANDLE), "back"
    context.close()


def test_pilot_suggestions_leave_out_summarise_this_without_a_key(site, browser):
    """Core 1.4.2: "Summarise this" needs the AI; 1.4.1 added it after every
    page's own suggestions even with no key, and pressing it asked for one.
    Now it shows only once a key is set."""
    context = _phone(browser)
    page = context.new_page()
    page.goto(f"{site}/", wait_until="networkidle")
    page.wait_for_selector(".pilot-launcher", state="attached", timeout=10000)
    page.evaluate("Pilot.open()")
    page.click('.pilot-pill:has-text("What is Orbyt?")')
    page.wait_for_selector(".pilot-from-pilot .pilot-md")
    page.wait_for_timeout(200)
    # The suggestions shown once a chat has started (the page's own: Home has some).
    chips = page.eval_on_selector_all(".pilot-chip", "cs => cs.filter(c => c.offsetParent).map(c => c.innerText.trim())")
    assert chips and "Summarise this" not in chips, chips
    context.close()


@pytest.mark.parametrize("path", ["/", "/orbyt"])
@pytest.mark.parametrize("size", [(320, 640), (375, 667), (375, 812), (390, 844)])
def test_pilot_is_findable_on_the_first_phone_screen_without_scrolling(site, browser, path, size):
    """Core 1.4.2 (round-8 review: the robot hidden on Home's first phone
    screen and on Orbyt at every phone size): within about 2 s of the page
    loading, with no scroll, either the robot shows or the handle does."""
    context = _phone_size(browser, *size)
    page = context.new_page()
    page.goto(f"{site}{path}", wait_until="load")
    page.wait_for_selector(".pilot-root", state="attached", timeout=10000)
    page.wait_for_timeout(2600)
    r = page.evaluate(_ROBOT)
    h = page.evaluate(_HANDLE)
    assert (not r["hidden"] and not r["under"]) or (h and not h["under"]), (r, h)
    assert page.evaluate("scrollY") == 0
    context.close()


@pytest.mark.parametrize("width,path", [(1024, "/orbyt"), (1024, "/genesis"), (1180, "/genesis")])
def test_pilot_on_a_computer_never_touches_a_link_or_parks_over_the_header(site, browser, width, path):
    """Core 1.4.2 (round-8 review): at 1024 px it tucked top right over
    Orbyt's header links and stayed; on Genesis at 1024-1180 px it touched
    "Save my spark" by 7 px. Links and buttons now count within 8 px, a top
    corner with the header's links is never used, and with every corner
    touching one it hides (the handle shows instead)."""
    context = browser.new_context(viewport={"width": width, "height": 800})
    page = context.new_page()
    page.goto(f"{site}{path}", wait_until="networkidle")
    page.wait_for_selector(".pilot-launcher", state="attached", timeout=10000)
    page.wait_for_timeout(5000)
    r = page.evaluate(_ROBOT)
    near = page.evaluate("""() => { const root = document.querySelector('.pilot-root'); const r = root.querySelector('.pilot-launcher').getBoundingClientRect();
      let best = 1e9;
      for (const e of document.querySelectorAll('a[href],button,input,textarea,select,summary,[role=button]')) { if (root.contains(e)) continue;
        for (const b of e.getClientRects()) { if (!b.width) continue;
          best = Math.min(best, Math.max(b.left - r.right, r.left - b.right, b.top - r.bottom, r.top - b.bottom)); } }
      return best; }""")
    if not r["hidden"]:
        assert r["corner"][0] == "b", r
        assert near >= 8, (r, near)
    else:
        h = page.evaluate(_HANDLE)
        assert h and not h["under"], h
    context.close()
