"""One link at a time: real sites pass, the tricks phishers use are caught, and
every warning says why."""

import pytest

from omnicyte import urls
from omnicyte.engine import check_link
from omnicyte.policy import Policy

ACME = Policy(org_domains=["acme.com"], trusted_domains=["acmepayroll.com"])

SAFE = [
    "https://login.microsoftonline.com/common/oauth2/authorize",
    "https://acme.sharepoint.com/sites/finance/report.xlsx",
    "https://docs.google.com/document/d/abc",
    "https://www.paypal.com/signin",
    "https://github.com/acme/app/pull/4",
    "https://finance.yahoo.com/quote/MSFT",
    "https://zoominfo.com/c/acme",
    "https://stripes.com",
    "https://www.chase.com/",
    "https://acme.com/login",
    "https://intranet.acme.com/hr",
    "https://acmepayroll.com/verify",
    "https://www.bbc.co.uk/news",
    "mailto:someone@acme.com",
    "#top",
]


@pytest.mark.parametrize("url", SAFE)
def test_real_sites_are_safe(url):
    assert check_link(url, policy=ACME).level == "safe", check_link(url, policy=ACME).signals


DANGER = [
    ("https://micros0ft-login.xyz/verify", "brand-lookalike"),
    ("https://paypal.com.secure-check.io/signin", "brand-lookalike"),
    ("https://rnicrosoft.com/", "brand-lookalike"),
    ("https://gooogle.com", "brand-lookalike"),
    ("https://docusign-review.net/envelope", "brand-lookalike"),
    ("https://xn--pple-43d.com/", "punycode"),
    ("https://acrne.com/sso", "org-lookalike"),
    ("https://acme-sso.net/", "org-lookalike"),
    ("https://acme.com.account-check.io/", "org-lookalike"),
    ("https://www.acme.com@evil.example/login", "userinfo"),
    ("javascript:alert(1)", "scheme"),
    ("data:text/html;base64,PGgxPkhp", "scheme"),
    ("http://192.168.4.4/owa/login", "ip-address"),
]


@pytest.mark.parametrize("url,code", DANGER)
def test_phishing_tricks_are_danger(url, code):
    v = check_link(url, policy=ACME)
    assert v.level == "danger", (url, v.score, v.signals)
    assert code in {s.code for s in v.signals}


def test_link_text_that_names_another_site():
    v = check_link("https://evil.example/x", "https://www.chase.com/login", ACME)
    assert v.level == "danger"
    assert v.signals[0].code == "text-mismatch"
    assert "chase.com" in v.signals[0].title and "evil.example" in v.signals[0].title


def test_link_text_on_the_same_brand_is_fine():
    assert check_link("https://login.microsoftonline.com/", "microsoft.com", ACME).level == "safe"
    assert check_link("https://www.acme.com/x", "acme.com", ACME).level == "safe"


def test_gateway_rewrites_are_unwrapped():
    safelink = ("https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fg00gle-docs.top%2Flogin"
                "&data=05%7C01&reserved=0")
    v = check_link(safelink, policy=ACME)
    assert v.destination == "https://g00gle-docs.top/login"
    assert v.level == "danger"
    clean = "https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Facme.com%2Fpolicy&data=x"
    assert check_link(clean, policy=ACME).level == "safe"
    assert urls.unwrap("https://www.google.com/url?q=https://example.org/a&sa=D") == "https://example.org/a"
    assert urls.unwrap("https://urldefense.com/v3/__https://evil.example/x__;!!abc$") == "https://evil.example/x"


def test_weak_signs_add_up_only_to_caution():
    assert check_link("https://bit.ly/3abc", policy=ACME).level == "safe"
    v = check_link("http://shop-deals.top/account/login", policy=ACME)
    assert v.level == "caution", v.signals


def test_downloads_are_flagged():
    v = check_link("https://files.example.net/Invoice_2291.exe", policy=ACME)
    assert "download" in {s.code for s in v.signals}
    assert v.level == "caution"


def test_trusted_domains_still_cant_hide_behind_an_at():
    v = check_link("https://acme.com@evil.example/", policy=ACME)
    assert v.level == "danger"


def test_every_signal_has_a_tip():
    v = check_link("http://paypa1-secure.top/login?next=https://other.example", policy=ACME)
    assert v.signals
    for s in v.signals:
        assert s.tip, s.code
        assert s.to_dict()["tip"] == s.tip


@pytest.mark.parametrize("host,expected", [
    ("login.mail.example.co.uk", "example.co.uk"), ("a.b.example.com", "example.com"),
    ("example.com", "example.com"), ("10.0.0.1", "10.0.0.1"),
])
def test_registrable(host, expected):
    assert urls.registrable(host) == expected


def test_find_links_in_text():
    text = "see https://a.example/x, and www.b.example/y. Also (https://c.example/z)"
    assert urls.find_links(text) == ["https://a.example/x", "http://www.b.example/y", "https://c.example/z"]
