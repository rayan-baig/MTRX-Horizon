"""Genesis and Orbyt on their own addresses: genesis.mtrxhorizyn.com and
orbyt.mtrxhorizyn.com, served by this same app (1.26.0).

Off until MTRX_APP_SUBDOMAINS=1 (config.py), so a computer running the site
by hand, staging and the tests keep /genesis and /orbyt. Once on:

- On genesis.* the Genesis page is at "/" and its Pro welcome page at
  /pro/welcome; on orbyt.* the Orbyt page is at "/" and the Pitch Review
  thanks page at /review/thanks. Each one's own API addresses, the shared
  /static files and the health checks answer there too. The console and
  every other API are "page not found" there; any other page goes to the
  same address on the main site.
- On the main site, /genesis and /orbyt (and everything under them) answer
  301 with the subdomain, keeping the rest of the address. The browser
  keeps any #part, so /orbyt#pitch lands on orbyt.mtrxhorizyn.com/#pitch.
  The API addresses stay on the main site too: a page still open in a tab,
  and Stripe's webhooks wherever the owner pointed them, keep working.
- /genesis-move on the main site is the one Genesis page that stays there.
  Genesis keeps projects in the browser, and a browser keeps each address's
  saved data apart, so the Genesis page on genesis.* asks it, once, for
  whatever the old address had saved (static/js/genesis-move.js).

Nothing here touches cookies: the site's only cookies (the console's) have
no Domain, so each belongs to the exact address that set it, and Genesis
and Orbyt set none. No address reads another's answers (no CORS), and the
same-site check on every change compares the exact address (main.guard).
"""

from . import config

APPS = ("genesis", "orbyt")

# The pages each app has under its path on the main site, as they are on its
# own address: the main site's /genesis/pro/welcome is genesis.*/pro/welcome.
PAGES = {"genesis": ("/pro/welcome",), "orbyt": ("/review/thanks",)}

# The API addresses each app's pages use: only these answer on its address.
APIS = {"genesis": ("/api/genesis/",), "orbyt": ("/api/vortex/", "/api/orbyt/", "/api/early-access/")}

# What every address serves the same way.
SHARED_PREFIXES = ("/static/",)
SHARED_PATHS = ("/healthz", "/readyz", "/robots.txt", "/sitemap.xml")

# The main site's page that hands a visitor's saved Genesis data to genesis.*.
MOVE_PATH = "/genesis-move"


def on() -> bool:
    return config.get().app_subdomains


def host(app: str) -> str:
    s = config.get()
    return s.genesis_host if app == "genesis" else s.orbyt_host


def _scheme() -> str:
    # https on the live site; a computer running it by hand (MTRX_DEV=1)
    # has no certificate.
    return "http" if config.get().dev else "https"


def root(app: str, base: str = "") -> str:
    """The app's own address, with no slash at the end, for Stripe and
    emails: https://genesis.mtrxhorizyn.com when on, else the main site's
    address (`base`) followed by /genesis. A #part or a path goes after it."""
    if on():
        return f"{_scheme()}://{host(app)}"
    return f"{base.rstrip('/')}/{app}"


def link(app: str, rest: str = "") -> str:
    """The app's address for a link on a page: "/genesis#new" while off,
    "https://genesis.mtrxhorizyn.com/#new" when on. `rest` is "", a path
    such as "/review/thanks", or a #part."""
    if not on():
        return f"/{app}{rest}"
    return f"{root(app)}{rest if rest.startswith('/') else '/' + rest}"


def canonical(app: str, base: str) -> str:
    """The app's address for search engines and link previews."""
    return f"{root(app)}/" if on() else root(app, base)


def which(netloc: str) -> str | None:
    """"genesis" or "orbyt" when a request came in on that app's address."""
    if not on():
        return None
    netloc = (netloc or "").strip().lower()
    for app in APPS:
        if netloc == host(app):
            return app
    return None


def main_url(netloc: str = "") -> str:
    """The main site's address: MTRX_PUBLIC_URL, or (unset) the address the
    visitor came in on with the app's name taken off the front."""
    s = config.get()
    if s.public_url:
        return s.public_url
    netloc = (netloc or "").lower()
    for app in APPS:
        if netloc == host(app):
            netloc = netloc.split(".", 1)[1]
    return f"{_scheme()}://{netloc}"


def inside(app: str, path: str) -> str | None:
    """What to serve for `path` on the app's own address: the path inside
    this app, or None when it belongs to the main site."""
    if path == "/":
        return f"/{app}"
    if path in PAGES[app]:
        return f"/{app}{path}"
    if path.startswith(APIS[app] + SHARED_PREFIXES) or path in SHARED_PATHS:
        return path
    return None


def outside(path: str) -> tuple[str, str] | None:
    """For a path on the main site: (app, the path on its own address) when
    it is one of the apps' pages and they have moved, else None."""
    if not on():
        return None
    for app in APPS:
        if path == f"/{app}" or path.startswith(f"/{app}/"):
            return app, path[len(app) + 1:] or "/"
    if path in ("/vortex", "/chroma-vortex"):
        return "orbyt", "/"
    return None


def page_link(href: str) -> str:
    """A link written as a main-site path ("/genesis", "/orbyt#pitch"), with
    Genesis and Orbyt at their own addresses once moved."""
    for app in APPS:
        if href == f"/{app}" or href.startswith((f"/{app}#", f"/{app}/", f"/{app}?")):
            return link(app, href[len(app) + 1:])
    return href
