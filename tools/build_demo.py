"""Build a click-through demo: the MTRX Horizon home page with each app's
own offline demo behind its card.

Nothing here runs any app's code. It renders this site's home page and
copies each app's ready-made demo files next to it:

- CyberLogix AI: docs/index.html and docs/console.html (its own demo build)
- OmniArmor.ai:  dashboard/index.html (its Risk Console)
- RankUp:        a built preview folder, if one is given

    python tools/build_demo.py --out demo \\
        --cyberlogix ../cyberlogix-ai --omniarmor ../omniarmor.ai \\
        [--rankup ../rankup/preview --rankup-source ../rankup]

The home page is written without <html>/<head>/<body> wrappers, the form
an Artifact page takes. Every other page is a full document.
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

HEAD = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n')

# A way back to the parent site on every app page. Plain inline styles so it
# needs nothing from the page it sits on.
BACK_LINK = (
    '<a href="../" style="position:fixed;left:12px;bottom:12px;z-index:2147483647;'
    'padding:8px 14px;border-radius:999px;background:#0a1434;color:#eef3ff;'
    'border:1px solid rgba(96,165,250,.6);font:600 13px/1.2 system-ui,sans-serif;'
    'text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.5)">'
    '&larr; MTRX Horizon</a>\n'
)


def render_home(urls: dict) -> str:
    env = Environment(loader=FileSystemLoader(ROOT / "templates"), autoescape=True)
    # The real project list, and no app numbers: the demo has no apps
    # reporting to it, so its activity panel says the numbers come at launch.
    from horizon import stats
    html = env.get_template("home.html").render(
        urls=urls, demo=True, numbers=None, projects=stats.PROJECTS)
    html = html.replace('"/static/', '"static/')
    # Unwrap to the form an Artifact page takes.
    for pattern in (r"<!doctype html>\s*", r"<html[^>]*>\s*", r"</html>\s*",
                    r"<head>\s*", r"</head>\s*", r"<body[^>]*>\s*", r"</body>\s*"):
        html = re.sub(pattern, "", html, flags=re.I)
    return html


def copy_static(out: Path):
    """Only what the home page uses: the console's files stay out."""
    shutil.copytree(ROOT / "static" / "img", out / "static" / "img")
    (out / "static" / "css").mkdir(parents=True)
    css = (ROOT / "static" / "css" / "site.css").read_text()
    (out / "static" / "css" / "site.css").write_text(css.replace('url("/static/img/', 'url("../img/'))
    # The home page's own script, and only that: knock.js, the lock's way
    # in, never leaves the real site.
    (out / "static" / "js").mkdir(parents=True)
    shutil.copy(ROOT / "static" / "js" / "home.js", out / "static" / "js" / "home.js")


def as_document(html: str, link_position: str = "left:12px;bottom:12px") -> str:
    """Give a bare page a doctype and head, and a way back."""
    if not html.lstrip().lower().startswith("<!doctype"):
        html = HEAD + "</head>\n<body>\n" + html + "\n</body>\n</html>\n"
    link = BACK_LINK.replace("left:12px;bottom:12px", link_position)
    return re.sub(r"</body>", lambda _: link + "</body>", html, count=1, flags=re.I)


def add_cyberlogix(src: Path, out: Path):
    dest = out / "cyberlogix"
    dest.mkdir(parents=True, exist_ok=True)
    for name in ("index.html", "console.html"):
        html = (src / "docs" / name).read_text(encoding="utf-8")
        # Links into the live app have nowhere to go in a demo.
        html = html.replace('location.href = "/console"', 'location.href = "console.html"')
        html = html.replace('href="/reset"', 'href="#"').replace('href="/legal#privacy"', 'href="#"')
        html = html.replace('href="/legal"', 'href="#"')
        (dest / name).write_text(as_document(html), encoding="utf-8")


def add_omniarmor(src: Path, out: Path):
    dest = out / "omniarmor"
    dest.mkdir(parents=True, exist_ok=True)
    html = (src / "dashboard" / "index.html").read_text(encoding="utf-8")
    (dest / "index.html").write_text(as_document(html), encoding="utf-8")


def rankup_themes(source: Path) -> list:
    """Read the kid themes out of RankUp's theme file, as text.

    Only the first few fields of each theme are needed for the switcher,
    and reading them as text means none of RankUp's code is run.
    """
    text = (source / "src" / "data" / "kidThemes.js").read_text(encoding="utf-8")
    body = text.split("export const KID_THEMES = [", 1)[1]
    themes = []
    for block in re.split(r"\n  \{\n    id: ", body)[1:]:
        field = lambda pattern: (re.search(pattern, block) or [None, ""])[1]
        themes.append({
            "id": field(r"^'([a-z0-9]+)'"),
            "name": field(r"\n    name: '([^']+)'"),
            "icon": field(r"currency: \{ name: '[^']+', icon: '([^']+)'"),
            "bg": field(r"\bbg: '(#[0-9a-fA-F]{6})'"),
            "accent": field(r"\baccent: '(#[0-9a-fA-F]{6})'"),
        })
    return [t for t in themes if t["id"] and t["name"]]


# A demo-only theme switcher. RankUp locks a child's theme behind a parent
# PIN, which is right for a family and in the way for somebody trying the
# demo. This changes every child's theme in the saved demo family and
# reloads into the kid's view, so the whole world changes at once.
THEME_SWITCHER = """
<div id="mh-themes" style="position:fixed;right:12px;bottom:calc(140px + env(safe-area-inset-bottom,0px));z-index:2147483647;font:500 13px/1.3 system-ui,sans-serif">
  <div id="mh-theme-list" hidden style="position:absolute;right:0;bottom:46px;width:min(290px,calc(100vw - 24px));max-height:min(420px,60vh);overflow:auto;padding:8px;border-radius:16px;background:#0a1434;border:1px solid rgba(96,165,250,.6);box-shadow:0 12px 32px rgba(0,0,0,.6)"></div>
  <button id="mh-theme-btn" type="button" style="padding:8px 14px;border-radius:999px;background:#0a1434;color:#eef3ff;border:1px solid rgba(96,165,250,.6);font:600 13px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.5)">&#127912; Themes</button>
</div>
<script>
(function () {
  var THEMES = __THEMES__;
  var KEY = "rankup.state.v1";
  var list = document.getElementById("mh-theme-list");
  var button = document.getElementById("mh-theme-btn");
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function current() { var s = read(); return s && s.kids && s.kids[0] ? s.kids[0].themeId : null; }
  function draw() {
    var now = current();
    list.textContent = "";
    var title = document.createElement("div");
    title.textContent = "Pick a world (" + THEMES.length + " themes)";
    title.style.cssText = "padding:6px 8px 8px;color:#a9b6d8;font-size:12px";
    list.appendChild(title);
    THEMES.forEach(function (t) {
      var row = document.createElement("button");
      row.type = "button";
      row.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:8px;margin:2px 0;border-radius:10px;cursor:pointer;text-align:left;color:#eef3ff;font:inherit;border:1px solid " + (t.id === now ? t.accent : "transparent") + ";background:" + (t.id === now ? "rgba(255,255,255,.08)" : "transparent");
      var swatch = document.createElement("span");
      swatch.style.cssText = "flex:none;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;font-size:15px;background:" + t.bg + ";box-shadow:inset 0 0 0 2px " + t.accent;
      swatch.textContent = t.icon;
      var name = document.createElement("span");
      name.textContent = t.name + (t.id === now ? "  \\u2713" : "");
      row.appendChild(swatch); row.appendChild(name);
      row.addEventListener("click", function () { choose(t.id); });
      list.appendChild(row);
    });
  }
  function choose(id) {
    var s = read();
    if (!s || !s.kids || !s.kids.length) { button.textContent = "Open the demo family first"; return; }
    s.kids = s.kids.map(function (k) { var c = {}; for (var x in k) c[x] = k[x]; c.themeId = id; return c; });
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { return; }
    location.hash = "#/kid";
    location.reload();
  }
  button.addEventListener("click", function () {
    list.hidden = !list.hidden;
    if (!list.hidden) draw();
  });
})();
</script>
"""


def add_rankup(preview: Path, out: Path, source: Path | None = None):
    dest = out / "rankup"
    shutil.copytree(preview, dest, dirs_exist_ok=True)
    index = dest / "index.html"
    # Above RankUp's own bottom tab bar, rather than on top of it.
    index.write_text(as_document(index.read_text(encoding="utf-8"),
                                 "right:12px;bottom:calc(92px + env(safe-area-inset-bottom,0px))"),
                     encoding="utf-8")
    if source:
        themes = json.dumps(rankup_themes(source)).replace("</", "<\\/")
        switcher = THEME_SWITCHER.replace("__THEMES__", themes)
        html = index.read_text(encoding="utf-8")
        index.write_text(re.sub(r"</body>", lambda _: switcher + "</body>", html,
                                count=1, flags=re.I), encoding="utf-8")
    # Cloudflare settings files: meaningless outside Cloudflare.
    for name in ("_headers", "_redirects"):
        (dest / name).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--cyberlogix", type=Path)
    parser.add_argument("--omniarmor", type=Path)
    parser.add_argument("--rankup", type=Path, help="a built RankUp preview folder")
    parser.add_argument("--rankup-source", type=Path,
                        help="the RankUp repository, to add the theme switcher")
    args = parser.parse_args()

    out = args.out
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    copy_static(out)

    urls = {"rankup": "", "cyberlogix": "", "omniarmor": ""}
    if args.cyberlogix:
        add_cyberlogix(args.cyberlogix, out)
        urls["cyberlogix"] = "cyberlogix/index.html"
    if args.omniarmor:
        add_omniarmor(args.omniarmor, out)
        urls["omniarmor"] = "omniarmor/index.html"
    if args.rankup:
        add_rankup(args.rankup, out, args.rankup_source)
        urls["rankup"] = "rankup/index.html"

    (out / "index.html").write_text(render_home(urls), encoding="utf-8")
    print(f"Demo written to {out}")


if __name__ == "__main__":
    main()
