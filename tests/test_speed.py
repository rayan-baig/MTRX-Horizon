"""A first visit on a phone: the pages ask for little, pictures don't make
the page jump, and what a phone fetched once it keeps. docs/PERFORMANCE.md
has the measurements; tools/measure_pages.py takes them again."""

import re
import struct
from pathlib import Path

import pytest

from tests.test_lock import client, make_client  # noqa: F401

STATIC = Path("static")
PAGES = ("/", "/genesis", "/orbyt", "/partners", "/bundle", "/privacy", "/terms", "/brand",
         "/early-access", "/creators")


@pytest.fixture
def everything_on(monkeypatch):
    """Early access and the creator program on, so their pages show too."""
    monkeypatch.setenv("EARLY_ACCESS_ENABLED", "1")
    monkeypatch.setenv("CREATORS_ENABLED", "1")
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("EARLY_ACCESS_EMAIL_FROM", "news@example.com")
    monkeypatch.setenv("MTRX_PUBLIC_URL", "https://testserver")


def webp_size(path: Path) -> tuple:
    """A WebP picture's width and height, read from its header."""
    data = path.read_bytes()[:30]
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP", path
    kind = data[12:16]
    if kind == b"VP8X":
        return (int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1)
    if kind == b"VP8L":
        bits = int.from_bytes(data[21:25], "little")
        return ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
    width, height = struct.unpack("<HH", data[26:30])
    return (width & 0x3FFF, height & 0x3FFF)


def test_every_picture_on_a_public_page_says_its_size(client, everything_on):
    """With its width and height written in, the browser keeps a picture's
    space from the start, so the words don't jump down when it arrives."""
    for path in PAGES:
        page = client.get(path)
        assert page.status_code == 200, path
        for tag in re.findall(r"<img\b[^>]*>", page.text):
            assert re.search(r'\swidth="\d+"', tag) and re.search(r'\sheight="\d+"', tag), (path, tag)


def test_what_a_phone_fetched_once_it_keeps(client, everything_on):
    """Fingerprinted files are kept a year; pictures and fonts named in the
    stylesheets a day, then checked again."""
    for path in PAGES:
        page = client.get(path).text
        named = re.findall(r'(?:href|src)="(/static/[^"]+\?v=[0-9a-f]{10})"', page)
        assert named, path
        for url in named:
            assert client.get(url).headers["cache-control"] == "public, max-age=31536000, immutable", url
    for url in ("/static/fonts/inter-latin.woff2", "/static/img/hero-phone.webp",
                "/static/img/rankup-art-sm.webp", "/static/img/logo-mark-sm.webp"):
        answer = client.get(url)
        assert answer.status_code == 200 and answer.headers["cache-control"] == "public, max-age=86400", url


def test_the_home_page_asks_for_its_big_picture_straight_away(client):
    """The picture at the top is named in the stylesheet, so the phone would
    find it late. The page asks for it at once, and for the very file the
    stylesheet uses on that screen: any other address would be fetched twice."""
    page = client.get("/").text
    head = page.split("</head>", 1)[0]
    preloads = dict((m[1], m[0]) for m in re.findall(
        r'<link rel="preload" href="(/static/img/[^"]+)" as="image"[^>]* media="([^"]+)"', head))
    assert preloads == {"(max-width: 720px)": "/static/img/hero-phone.webp",
                        "(min-width: 721px)": "/static/img/hero-wide.webp"}
    css = (STATIC / "css/site.css").read_text(encoding="utf-8")
    phone = css.split("@media (max-width: 720px) {\n  /* A phone may scroll", 1)[1].split("\n}\n", 1)[0]
    assert 'url("/static/img/hero-phone.webp")' in phone
    assert 'url("/static/img/hero-wide.webp")' in css.split(".page .hero-art {", 1)[1].split("}", 1)[0]


def test_phones_get_pictures_sized_for_phones():
    wide, phone = STATIC / "img/hero-wide.webp", STATIC / "img/hero-phone.webp"
    (ww, wh), (pw, ph) = webp_size(wide), webp_size(phone)
    # The same picture, the same shape, at a phone's size and under half the bytes.
    assert abs(ww / wh - pw / ph) < 0.01 and 750 <= pw < ww
    assert phone.stat().st_size * 2 < wide.stat().st_size
    for app in ("rankup", "cyberlogix", "omniarmor"):
        big, small = STATIC / f"img/{app}-art.webp", STATIC / f"img/{app}-art-sm.webp"
        assert webp_size(small)[0] <= 400 and small.stat().st_size * 2 < big.stat().st_size, app
    # The logo in the bars is drawn at most 80px wide; 160px is sharp on any screen.
    assert webp_size(STATIC / "img/logo-mark-sm.webp")[0] <= 160


def test_the_fonts_hold_only_the_weights_the_site_uses():
    """Each font file is cut down to the weights its @font-face rule names,
    which the browser could never use anyway."""
    css = (STATIC / "css/site.css").read_text(encoding="utf-8")
    assert 'font-family: "Inter"; font-style: normal; font-weight: 400 600' in css
    assert (STATIC / "fonts/inter-latin.woff2").stat().st_size < 40_000
