"""Pilot, the MTRX Horizyn assistant (static/pilot/, docs/PILOT.md).

These check the promises Pilot makes on this site: it is on every public
page and on none of the private ones; the security policy lets the browser
reach exactly the AI providers' addresses and nothing more; the chat window's
code loads only when it is opened; keys and AI calls never touch this
server; the core files carry their version; no model name is written
anywhere; and Ask Genesis with the visitor's own key uses the server's very
words. The core's own tests run in Node (tests/js/pilot.test.js).
"""

import gzip
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.test_lock import client, make_client  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
CORE = ("pilot.js", "pilot-store.js", "pilot-mascot.js", "pilot-engine.js", "pilot-providers.js", "pilot-media.js",
        "pilot-render.js", "pilot-panel.js", "pilot.css", "pilot-panel.css", "pilot-motion.js", "pilot-actor.js", "pilot-actor.css")
LAZY = ("pilot-panel.js", "pilot-engine.js", "pilot-providers.js", "pilot-media.js", "pilot-render.js", "pilot-panel.css",
        "pilot-mtrx-pack.js", "pilot-motion.js", "pilot-actor.js", "pilot-actor.css", "pilot-rest-body.webp", "pilot-rest-head.webp",
        "pilot-rest-eyes.webp")
PUBLIC = ("/", "/genesis", "/orbyt", "/partners", "/bundle", "/privacy", "/terms", "/brand", "/early-access", "/creators")


@pytest.fixture
def everything_on(monkeypatch):
    monkeypatch.setenv("EARLY_ACCESS_ENABLED", "1")
    monkeypatch.setenv("CREATORS_ENABLED", "1")
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("EARLY_ACCESS_EMAIL_FROM", "news@example.com")
    monkeypatch.setenv("MTRX_PUBLIC_URL", "https://testserver")


def _srcs(page: str) -> list:
    return re.findall(r'<script src="([^"]+)"', page)


def test_pilot_is_on_every_public_page(client, everything_on):
    for path in PUBLIC:
        page = client.get(path).text
        srcs = _srcs(page)
        pilot = [s for s in srcs if "pilot" in s]
        assert len(pilot) == 1 and re.fullmatch(r"/static/pilot/pilot\.js\?v=[0-9a-f]{10}", pilot[0]), (path, pilot)
        for name in ("pilot/pilot-store.js", "pilot/pilot-mascot.js", "js/pilot-mtrx.js", "pilot/pilot.css",
                     "pilot/pilot-robot-128.webp", "pilot/pilot-robot-256.webp"):
            assert re.search(rf'data-[a-z0-9-]+="/static/{re.escape(name)}\?v=[0-9a-f]{{10}}"', page), (path, name)
        assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", page), path
        assert 'style="' not in page, path


def test_the_window_loads_only_when_opened(client):
    """A page loads one small Pilot script, which fetches the robot and the
    config after the page has loaded. The chat window, the engine, the
    providers and the knowledge pack are named in data-* for the loader,
    and fetched only when Pilot is first opened."""
    page = client.get("/").text
    for name in LAZY:
        assert not re.search(rf'(?:src|href)="[^"]*{re.escape(name)}', page), name
        assert re.search(rf'data-[a-z-]+="/static/(?:pilot|js)/{re.escape(name)}\?v=[0-9a-f]{{10}}"', page), name
    eager = [s for s in _srcs(page) if "pilot" in s]
    assert len(eager) == 1
    sent = len(gzip.compress((ROOT / "static/pilot/pilot.js").read_bytes()))
    assert sent < 6_000, sent  # as it travels (compressed)
    loader = (ROOT / "static/pilot/pilot.js").read_text()
    assert 'window.addEventListener("load", () => setTimeout(boot, 0), { once: true });' in loader


def test_no_pilot_on_private_pages(client, monkeypatch):
    """No Pilot where a page carries a one-time code, a Pro key or a
    creator's own figures, nor on the owner's pages or error pages."""
    for path in ("/console", "/console/add/nothing", "/no-such-page"):
        assert "pilot" not in client.get(path).text.lower(), path
    for name in ("creator_dashboard.html", "early_access_confirm.html", "early_access_unsubscribe.html"):
        assert "{% block pilot %}{% endblock %}" in (ROOT / "templates" / name).read_text(), name
    for name in ("genesis_pro_welcome.html", "console.html", "add.html", "unlock.html", "404.html", "500.html"):
        assert "_pilot.html" not in (ROOT / "templates" / name).read_text(), name
    # The Pro key box on the Genesis page is never read by "Analyze & explain".
    assert 'id="pro" aria-labelledby="g-pro-title" data-pilot-private' in (ROOT / "templates/genesis.html").read_text()


def test_the_security_policy_adds_exactly_the_provider_hosts(client):
    from horizon import main
    csp = client.get("/").headers["content-security-policy"]
    assert csp == main.CSP
    rules = dict(rule.strip().split(" ", 1) for rule in csp.split(";"))
    connect = rules["connect-src"].split()
    assert connect == (["'self'", "https://api.anthropic.com", "https://api.openai.com", "https://generativelanguage.googleapis.com"]
                       + [f"https://{h}" for h in main.PILOT_COMPATIBLE_HOSTS]
                       + ["http://localhost:*", "http://127.0.0.1:*"])
    for host in connect:
        assert "*." not in host and host not in ("https:", "http:", "*", "data:", "blob:"), host
    # Nothing else was widened: scripts, styles, frames and forms stay this site's own.
    assert rules["script-src"] == "'self'" and rules["style-src"] == "'self'" and rules["default-src"] == "'self'"
    assert rules["frame-ancestors"] == "'none'" and rules["form-action"] == "'self'"
    assert rules["media-src"] == "'self' blob:"  # a video Pilot made, shown from memory
    assert rules["img-src"] == "'self' data:"
    # The config the page gets lists the same compatible hosts the policy allows.
    page = client.get("/").text
    hosts = re.search(r'data-hosts="([^"]*)"', page).group(1).split()
    assert hosts == list(main.PILOT_COMPATIBLE_HOSTS + main.PILOT_LOCAL_HOSTS)
    assert "microphone=(self)" in client.get("/").headers["permissions-policy"]
    assert "camera=()" in client.get("/").headers["permissions-policy"]


def test_keys_and_ai_calls_never_touch_this_server():
    """Pilot talks only to the provider the visitor chose. No core file asks
    this server for anything, and the server has no Pilot address at all."""
    from horizon import main
    for name in CORE:
        text = (ROOT / "static/pilot" / name).read_text()
        assert "/api/" not in text, name
        for unsafe in (".innerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"):
            assert unsafe not in text, (name, unsafe)
        assert "localStorage.setItem" not in text or name == "pilot-store.js", name
    for route in main.app.routes:
        assert "pilot" not in getattr(route, "path", "").lower()
    providers = (ROOT / "static/pilot/pilot-providers.js").read_text()
    assert '"anthropic-dangerous-direct-browser-access": "true"' in providers
    assert 'credentials: "omit"' in providers


def test_the_owner_pays_nothing_for_pilot():
    """Ask Genesis is the site's only server-side AI, as before; nothing new
    calls an AI provider from the server."""
    callers = [p.name for p in (ROOT / "horizon").glob("*.py") if re.search(r"^import anthropic|^from anthropic", p.read_text(), re.M)]
    assert callers == ["genesis_ai.py"]


def test_the_robot_is_the_owners_picture_small_enough():
    """Two sizes of the owner's robot (transparent WebP), and no robot
    drawing: 128 pixels for the corner, 256 for sharp screens."""
    for size, most in ((128, 15_000), (256, 40_000)):
        data = (ROOT / f"static/pilot/pilot-robot-{size}.webp").read_bytes()
        assert data[:4] == b"RIFF" and data[8:12] == b"WEBP" and len(data) < most, size
        assert data[12:16] == b"VP8X" and data[20] & 0x10, f"{size}: no transparency"
    mascot = (ROOT / "static/pilot/pilot-mascot.js").read_text()
    assert "srcset" in mascot and "pm-eyes" not in mascot


def test_every_core_file_says_its_version():
    versions = set()
    for name in CORE:
        first = (ROOT / "static/pilot" / name).read_text().splitlines()[0]
        match = re.fullmatch(r"(?://|/\*) Pilot core (\d+\.\d+\.\d+) · " + re.escape(name) + r"(?: \*/)?", first)
        assert match, (name, first)
        versions.add(match.group(1))
    assert len(versions) == 1, versions
    version = versions.pop()
    for name in CORE:
        if name.endswith(".js"):
            assert f'const VERSION = "{version}";' in (ROOT / "static/pilot" / name).read_text(), name
    assert f"core {version}" in (ROOT / "docs/PILOT.md").read_text()


MODEL_NAMES = re.compile(r"claude-|gpt-?\d|gemini-\d|\bo[1-9]-|sonnet|opus|haiku|llama|dall-?e|\bsora\b|whisper|imagen|\bveo\b",
                         re.IGNORECASE)


def test_no_model_name_is_written_anywhere():
    """Models come from the provider's own list for the visitor's key, or
    the visitor types one."""
    files = [ROOT / "static/pilot" / n for n in CORE] + [
        ROOT / "static/js" / n for n in ("pilot-mtrx.js", "pilot-mtrx-pack.js", "genesis-ask.js")] + [
        ROOT / "docs/PILOT.md", ROOT / "templates/_pilot.html", ROOT / "tests/js/pilot.test.js"]
    for f in files:
        hits = MODEL_NAMES.findall(f.read_text())
        assert not hits, (f.name, hits)


def test_the_pack_and_the_kid_note():
    pack = (ROOT / "static/js/pilot-mtrx-pack.js").read_text()
    for fact in ("RankUp", "CyberLogix AI", "OmniArmor.ai", "Genesis", "Orbyt", "Kitchen Safety Bundle", "STRENGTHS"):
        assert fact in pack, fact
    config = (ROOT / "static/js/pilot-mtrx.js").read_text()
    assert "AI keys are for grown-ups (the AI companies require 18+)." in config
    assert "kidView: () => false" in config


def test_the_window_matches_the_design_words():
    panel = (ROOT / "static/pilot/pilot-panel.js").read_text() + (ROOT / "static/js/pilot-mtrx.js").read_text()
    for words in ("Your AI copilot. Powered by you.", "Hello! I'm Pilot.", "How can I help you today?", "Ask anything…",
                  "Get things done…", "Help with code…", "Analyze & explain…", "Customize with your API key", "Type a message…",
                  "Bring Your Own API Key", "Use your OpenAI, Claude, Gemini, or any compatible API key.",
                  "Image generation", "Video generation"):
        assert words in panel, words


def test_ask_genesis_with_your_own_key_uses_the_servers_words():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is not installed here (CI has it)")
    from horizon import genesis_ai
    out = subprocess.run([node, "-e", "const A=require(process.argv[1]);console.log(JSON.stringify({s:A.SYSTEM,h:A.HELPERS,"
                          "l:A.LIMITS,st:A.STAGES,m:A.MAX_TOKENS,c:A.MAX_ANSWER_CHARS}))", str(ROOT / "static/js/genesis-ask.js")],
                         capture_output=True, text=True, check=True, timeout=30)
    js = json.loads(out.stdout)
    assert js["s"] == genesis_ai.SYSTEM
    assert js["h"] == genesis_ai.HELPERS
    assert js["l"] == genesis_ai.LIMITS
    assert js["st"] == genesis_ai.STAGES
    assert js["m"] == genesis_ai.MAX_TOKENS and js["c"] == genesis_ai.MAX_ANSWER_CHARS
    # The page uses it only with a Pilot key, never for a Pro member, and
    # the free server path is unchanged.
    page = (ROOT / "static/js/genesis.js").read_text()
    assert "const ownKey = () => Boolean(window.Pilot && window.Pilot.ready() && !isPro());" in page
    # Its words load only when an own-key ask is made, so the page draws as fast as before.
    assert 'data-ask="{{ asset(\'js/genesis-ask.js\') }}"' in (ROOT / "templates/genesis.html").read_text()
    assert "genesis-ask.js" not in " ".join(re.findall(r"<script[^>]*>", (ROOT / "templates/genesis.html").read_text()))
    assert 'fetch("/api/genesis/ask"' in page


def test_genesis_free_limits_and_pro_prices_are_unchanged(monkeypatch):
    from horizon import config
    for name in ("GENESIS_AI_PER_DAY", "GENESIS_AI_PER_HOUR", "GENESIS_PRO_PRICE_TEXT"):
        monkeypatch.delenv(name, raising=False)
    s = config.get()
    assert (s.genesis_ai_per_day, s.genesis_ai_per_hour) == (5, 3)
    assert s.genesis_pro_price_text == "$4.99"


def test_pilot_core_in_node():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is not installed here (CI has it)")
    for script in [ROOT / "static/pilot" / n for n in CORE if n.endswith(".js")] + [
            ROOT / "static/js" / n for n in ("pilot-mtrx.js", "pilot-mtrx-pack.js", "genesis-ask.js")]:
        subprocess.run([node, "--check", str(script)], check=True)
    result = subprocess.run([node, "--test", "--test-reporter=tap", str(ROOT / "tests/js/pilot.test.js")],
                            capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "# fail 0" in result.stdout


def test_the_moving_robot_loads_late_and_never_under_reduce_motion():
    """The moving robot (core 1.1.0) is fetched only once the page is idle,
    and not at all when the visitor asks for less motion; its pictures are
    small, and pose pictures load only when a move needs them."""
    loader = (ROOT / "static/pilot/pilot.js").read_text()
    assert 'window.matchMedia("(prefers-reduced-motion: reduce)").matches' in loader
    assert "requestIdleCallback" in loader
    actor = (ROOT / "static/pilot/pilot-actor.js").read_text()
    assert 'win.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;' in actor
    for part in ("body", "head", "eyes"):
        data = (ROOT / f"static/pilot/pilot-rest-{part}.webp").read_bytes()
        assert data[:4] == b"RIFF" and data[8:12] == b"WEBP" and len(data) < 12_000, part
    total = 0
    for pose in (ROOT / "static/pilot/poses").iterdir():
        data = pose.read_bytes()
        assert data[:4] == b"RIFF" and data[8:12] == b"WEBP" and len(data) < 25_000, pose.name
        total += len(data)
    assert total < 220_000, total
    # Fetched when needed: the page names the poses but loads none of them.
    page_poses = main_poses()
    assert "standing=" in page_poses and "wave=" in page_poses


def main_poses() -> str:
    from horizon import main
    return main.pilot_poses()


def test_a_new_pose_picture_is_picked_up(tmp_path):
    """Adding a pose is just putting its picture in static/pilot/poses/."""
    from horizon import main
    assert main.pilot_pose_files(tmp_path) == {}
    (tmp_path / "kick.png").write_bytes(b"x")
    (tmp_path / "notes.txt").write_bytes(b"x")
    (tmp_path / "dance.webp").write_bytes(b"x")
    assert main.pilot_pose_files(tmp_path) == {"kick": "kick.png"}
    (tmp_path / "kick.webp").write_bytes(b"x")
    (tmp_path / "walk2.webp").write_bytes(b"x")
    assert main.pilot_pose_files(tmp_path) == {"kick": "kick.webp", "walk2": "walk2.webp"}
    shipped = main.pilot_pose_files()
    assert set(shipped) == {"standing", "sitting", "wave", "walk1", "run1", "run2", "fly", "climb1", "flip"}
    # The pose names match the shared engine's.
    motion = (ROOT / "static/pilot/pilot-motion.js").read_text()
    names = re.search(r"const POSES = \[([^\]]+)\]", motion).group(1)
    assert tuple(re.findall(r'"([a-z0-9]+)"', names)) == main.PILOT_POSES


def test_the_page_names_the_moving_robots_files(client):
    page = client.get("/").text
    poses = re.search(r'data-poses="([^"]*)"', page).group(1).split()
    assert len(poses) == 9
    for pair in poses:
        name, url = pair.split("=", 1)
        assert re.fullmatch(rf"/static/pilot/poses/{name}\.webp\?v=[0-9a-f]{{10}}", url), pair
