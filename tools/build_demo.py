"""Build a click-through demo: the MTRX Horizon home page with each app's
own offline demo behind its card.

Nothing here runs any app's code. It renders this site's home page and
copies each app's ready-made demo files next to it:

- CyberLogix AI: docs/index.html and docs/console.html (its own demo build)
- OmniArmor.ai:  dashboard/index.html (its Risk Console)
- RankUp:        a built preview folder, if one is given

    python tools/build_demo.py --out demo \\
        --cyberlogix ../cyberlogix-ai --omniarmor ../omniarmor.ai \\
        [--rankup ../rankup/preview]

The home page is written without <html>/<head>/<body> wrappers, the form
an Artifact page takes. Every other page is a full document.
"""

import argparse
import re
import shutil
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

ROOT = Path(__file__).resolve().parent.parent

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
    html = env.get_template("home.html").render(urls=urls, demo=True)
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


def as_document(html: str, back_link: bool = True) -> str:
    """Give a bare page a doctype and head, and a way back."""
    if not html.lstrip().lower().startswith("<!doctype"):
        html = HEAD + "</head>\n<body>\n" + html + "\n</body>\n</html>\n"
    if back_link:
        html = re.sub(r"</body>", BACK_LINK + "</body>", html, count=1, flags=re.I)
    return html


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


def add_rankup(preview: Path, out: Path):
    dest = out / "rankup"
    shutil.copytree(preview, dest, dirs_exist_ok=True)
    index = dest / "index.html"
    index.write_text(as_document(index.read_text(encoding="utf-8")), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--cyberlogix", type=Path)
    parser.add_argument("--omniarmor", type=Path)
    parser.add_argument("--rankup", type=Path, help="a built RankUp preview folder")
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
        add_rankup(args.rankup, out)
        urls["rankup"] = "rankup/index.html"

    (out / "index.html").write_text(render_home(urls), encoding="utf-8")
    print(f"Demo written to {out}")


if __name__ == "__main__":
    main()
