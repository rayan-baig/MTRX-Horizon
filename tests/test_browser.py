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
    tmp = tmp_path_factory.mktemp("browser")
    port = _free_port()
    env = {k: v for k, v in os.environ.items() if not k.startswith("MTRX_") and not k.endswith("_URL")}
    env.update(MTRX_DB_PATH=str(tmp / "horizon.db"), MTRX_KNOCK="logo logo omniarmor rankup", MTRX_DEV="1",
               MTRX_SETUP_TOKEN="a-browser-test-setup-code-123456")
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


@pytest.mark.parametrize("kind", ["pitch", "partner"])
def test_a_direct_link_to_an_orbyt_form_always_lands_on_it(site, browser, kind):
    """/orbyt#pitch and /orbyt#partner open their form and scroll to it.
    1.16 scrolled with behavior "auto", which the page's smooth-scroll style
    turns into a smooth scroll; started that early it was often cut short,
    and the visitor was left at the top. Loaded many times, on a phone and a
    computer, it must land on the form every time."""
    misses = []
    for size in ({"width": 390, "height": 844}, {"width": 1440, "height": 900}):
        context = browser.new_context(viewport=size)
        page = context.new_page()
        for attempt in range(12):
            page.goto(f"{site}/orbyt#{kind}", wait_until="load")
            page.wait_for_timeout(350)
            where = page.evaluate(f"""() => {{
                const form = document.getElementById("v-{kind}");
                return {{ hidden: form.hidden, top: form.getBoundingClientRect().top, y: window.scrollY }};
            }}""")
            # The form is shown, near the top of the screen (under the bar).
            if where["hidden"] or not (-5 <= where["top"] <= 140) or where["y"] < 100:
                misses.append((size["width"], attempt, where))
        context.close()
    assert not misses, misses


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
