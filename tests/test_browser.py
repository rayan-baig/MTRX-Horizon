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
