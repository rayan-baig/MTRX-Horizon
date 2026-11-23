"""Orbyt's Sent screen and Pitch Review in a real browser (1.23.0).

- After sending a pitch, "Sent." and where the reply goes are the first
  thing seen, just under the bar, on small phones and a computer; the paid
  offer comes after the confirmation and "While you wait". (Centring the
  panel, which the offer made taller than a phone, left "Sent." above the top.)
- Cancelling at Stripe's checkout brings the visitor back to a page that says
  the pitch was sent and nothing was charged, with the offer again (its
  ticket kept in this tab), not to an empty form.

Uses the browser harness of test_browser.py; skipped where Playwright or its
Chromium isn't installed.
"""

import pytest

from tests.test_browser import _free_port, _serve, browser, sync_api  # noqa: F401

CANCELLED = "Your pitch was sent. Checkout was cancelled, and nothing was charged."
# 1.27.0: this tab has no pitch's code, so it can't know a pitch was sent.
UNKNOWN = "If you sent a pitch, it's on its way. Nothing was charged."


@pytest.fixture(scope="module")
def review_site(tmp_path_factory):
    """Pitch Review on, in person mode; mail goes to a closed port and Stripe
    is never reached (the test answers the page's checkout request)."""
    yield from _serve(tmp_path_factory, {
        "ORBYT_REVIEW_ENABLED": "1", "STRIPE_SECRET_KEY": "sk_test_not_real",
        "ORBYT_REVIEW_STRIPE_WEBHOOK_SECRET": "whsec_browser_test", "ORBYT_REVIEW_STRIPE_PRICE": "price_review1",
        "MTRX_ALERT_EMAIL": "alerts@example.com", "MTRX_ALERT_FROM": "site@example.com",
        "MTRX_SMTP_HOST": "127.0.0.1", "MTRX_SMTP_PORT": str(_free_port())})


def _send_pitch(page, site):
    page.goto(f"{site}/orbyt#pitch", wait_until="load")
    form = 'form[data-kind="pitch"]'
    page.fill(f'{form} input[name="name"]', "Ada")
    page.fill(f'{form} input[name="email"]', "ada@example.com")
    page.fill(f'{form} input[name="idea"]', "Nova")
    page.fill(f'{form} input[name="pitch"]', "Homework reminders")
    page.fill(f'{form} input[name="audience"]', "Students")
    page.click(f'{form} button[type="submit"]')
    page.wait_for_selector("#v-review:not([hidden])", timeout=10000)
    page.wait_for_timeout(300)


# Where the top of the Sent panel is, against the bar and the screen.
_PLACE = """() => {
  const bar = document.querySelector(".topbar").getBoundingClientRect().bottom;
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  return { bar: Math.round(bar), swirl: Math.round(r("#v-sent .v-swirl").top), title: Math.round(r(".v-sent-title").top),
           line: Math.round(r("#v-sent-line").bottom), next: Math.round(r("#v-next").top),
           offer: Math.round(r("#v-review").top), height: innerHeight };
}"""


@pytest.mark.parametrize("size", [(375, 812), (375, 667), (320, 568), (1280, 900)])
def test_after_sending_sent_and_the_reply_line_come_first_under_the_bar(review_site, browser, size):
    width, height = size
    phone = width < 700
    context = browser.new_context(viewport={"width": width, "height": height}, is_mobile=phone, has_touch=phone)
    page = context.new_page()
    _send_pitch(page, review_site)
    at = page.evaluate(_PLACE)
    # The swirl, "Sent." and "We'll reply to ..." are all on screen, below the bar.
    assert at["swirl"] >= at["bar"] - 1, at
    assert at["bar"] <= at["title"] and at["line"] <= at["height"], at
    # The confirmation and "While you wait" come before the paid offer.
    assert at["line"] < at["next"] < at["offer"], at
    assert page.text_content("#v-sent-line") == "We'll reply to ada@example.com, even if the answer is no."
    context.close()


def test_cancelling_checkout_comes_back_to_sent_and_the_offer_again(review_site, browser):
    context = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True, has_touch=True)
    page = context.new_page()
    asked = []

    def checkout(route):
        asked.append(route.request.post_data_json)
        route.fulfill(status=200, content_type="application/json",
                      body='{"url": "https://checkout.stripe.com/c/pay/cs_test_browser"}')

    page.route("**/api/orbyt/review/checkout", checkout)
    page.route("https://checkout.stripe.com/**", lambda route: route.fulfill(status=200, body="Stripe checkout"))
    _send_pitch(page, review_site)
    page.check("#v-review-adult")
    page.click("#v-review-buy")
    page.wait_for_url("https://checkout.stripe.com/**", timeout=10000)
    # Stripe's "back" link: the checkout's cancel_url.
    page.goto(f"{review_site}/orbyt#review-cancelled", wait_until="load")
    page.wait_for_selector("#v-sent:not([hidden])", timeout=5000)
    # It lands with "Sent." under the bar, and stays once the page has settled.
    page.wait_for_function(f"(() => {{ const a = ({_PLACE})(); return a.bar <= a.title && a.line <= a.height; }})",
                           timeout=5000)
    page.wait_for_timeout(500)
    assert page.text_content("#v-sent-line") == CANCELLED
    assert page.text_content(".v-sent-title") == "Sent."
    assert "a real person reads your message and emails you back by" in page.text_content("#v-next-step")
    assert page.is_visible("#v-review") and not page.is_visible('form[data-kind="pitch"]')
    at = page.evaluate(_PLACE)
    assert at["bar"] <= at["title"] and at["line"] <= at["height"], at
    # The offer works again, with the same pitch's ticket.
    assert not page.is_checked("#v-review-adult")
    page.check("#v-review-adult")
    page.click("#v-review-buy")
    page.wait_for_url("https://checkout.stripe.com/**", timeout=10000)
    assert len(asked) == 2 and asked[0]["ticket"] == asked[1]["ticket"]
    context.close()


def test_coming_back_in_another_tab_still_says_nothing_was_charged(review_site, browser):
    """No ticket in this tab (a new tab, or it ran out): nothing was charged,
    but it doesn't claim a pitch was sent (1.27.0: it can't know), and no
    offer that would only fail."""
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    page = context.new_page()
    page.goto(f"{review_site}/orbyt#review-cancelled", wait_until="load")
    page.wait_for_selector("#v-sent:not([hidden])", timeout=5000)
    assert page.text_content("#v-sent-line") == UNKNOWN
    assert page.text_content(".v-sent-title") == "Checkout cancelled."
    assert "was sent" not in page.inner_text("#v-sent")
    assert not page.is_visible("#v-review")
    # "Send another" opens the pitch form.
    page.click("#v-again")
    page.wait_for_selector('form[data-kind="pitch"]', state="visible", timeout=5000)
    context.close()


# The Sent panel's top against the bar's bottom, once the fonts are in and two
# frames have been drawn.
_SETTLED = """async () => {
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const bar = document.querySelector(".topbar").getBoundingClientRect();
  const sent = document.getElementById("v-sent").getBoundingClientRect();
  const title = document.querySelector(".v-sent-title").getBoundingClientRect();
  return { bar: bar.bottom, sent: sent.top, title: title.top, margin: getComputedStyle(document.getElementById("v-sent")).scrollMarginTop,
           height: bar.height, view: innerHeight };
}"""


def test_sent_lands_exactly_under_the_bar_every_time(review_site, browser):
    """1.27.0: after each of many sends at 375x667, the Sent panel's top is
    exactly at the bar's bottom (its scroll-margin-top is the bar's measured
    height, set again after document.fonts.ready and one frame), never the
    stylesheet's 96 px guess, which left a gap that changed with the bar.
    The send is answered by the test, at varied speeds, so the server's
    hourly limit doesn't apply."""
    context = browser.new_context(viewport={"width": 375, "height": 667}, is_mobile=True, has_touch=True)
    page = context.new_page()
    sends = {"n": 0}

    def answer(route):
        sends["n"] += 1
        page.wait_for_timeout([0, 40, 150, 5][sends["n"] % 4])
        route.fulfill(status=200, content_type="application/json",
                      body='{"ok": true, "email": "ada@example.com", "review": "ticket_%022d"}' % sends["n"])

    page.route("**/api/vortex/send", answer)
    places = []
    for attempt in range(16):
        if attempt % 4 == 0:
            page.goto("about:blank")
            page.goto(f"{review_site}/orbyt#pitch", wait_until="load" if attempt % 8 else "domcontentloaded")
        else:
            page.click("#v-again")
        form = 'form[data-kind="pitch"]'
        page.wait_for_selector(form, state="visible")
        page.fill(f'{form} input[name="name"]', "Ada")
        page.fill(f'{form} input[name="email"]', "ada@example.com")
        page.fill(f'{form} input[name="idea"]', f"Nova {attempt}")
        page.fill(f'{form} input[name="pitch"]', "Homework reminders")
        page.fill(f'{form} input[name="audience"]', "Students")
        page.click(f'{form} button[type="submit"]')
        page.wait_for_selector("#v-sent:not([hidden])", timeout=10000)
        at = page.evaluate(_SETTLED)
        places.append(at)
        assert abs(at["sent"] - at["bar"]) <= 1, (attempt, at)
        assert at["margin"] == f"{int(-(-at['height'] // 1))}px", (attempt, at)
        assert page.is_visible("#v-review")
    # The same place every time.
    assert len({round(a["sent"]) for a in places}) == 1, places
    context.close()
