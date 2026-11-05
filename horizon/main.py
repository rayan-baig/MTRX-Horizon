"""The MTRX Horizyn web app: the public home page and the owner's console."""

import base64
import hashlib
import io
import ipaddress
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from urllib.parse import urlsplit
from xml.sax.saxutils import escape as xml_escape

import qrcode
import qrcode.image.svg
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.templating import Jinja2Templates

from . import config, costs, db, errors, genesis_ai, health, lock, stats, upkeep, vortex

DEVICE_COOKIE = "mh_d"
# Browsers keep a cookie for 400 days at most.
DEVICE_COOKIE_DAYS = 400
DOOR_COOKIE = "mh_k"
SESSION_COOKIE = "mh_s"

CSP = (
    "default-src 'self'; img-src 'self' data:; "
    "style-src 'self'; font-src 'self'; "
    "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; "
    "base-uri 'none'; form-action 'self'"
)

@asynccontextmanager
async def lifespan(_app):
    db.init()
    upkeep.start()
    try:
        yield
    finally:
        upkeep.stop()


class _HideSecretLinks(logging.Filter):
    """Keep one-time device links out of the server log.

    The setup code and every QR code arrive as part of a URL, and the server
    logs every request: anyone who could read the log (the host's dashboard, a
    log service) could take a live code and approve their own device first.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        return "/console/add/" not in record.getMessage()


logging.getLogger("uvicorn.access").addFilter(_HideSecretLinks())

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=config.ROOT / "static"), name="static")
templates = Jinja2Templates(directory=config.ROOT / "templates")

STATIC = config.ROOT / "static"
_asset_versions: dict = {}


def asset(path: str) -> str:
    """The address of a file in /static, with a short fingerprint of its contents.

    A fingerprinted address never changes its contents, so a phone may keep
    the file for a year and not ask again (see `guard`); after a deploy that
    changes the file, the page names a new address and the phone fetches it.
    """
    file = STATIC / path
    try:
        mtime = file.stat().st_mtime_ns
    except OSError:
        return "/static/" + path
    known = _asset_versions.get(path)
    if known is None or known[0] != mtime:
        known = (mtime, hashlib.sha256(file.read_bytes()).hexdigest()[:10])
        _asset_versions[path] = known
    return f"/static/{path}?v={known[1]}"


templates.env.globals["asset"] = asset


def _read_version() -> str:
    try:
        return (config.ROOT / "VERSION").read_text().strip() or "dev"
    except OSError:
        return "dev"


# Shown at the foot of the home page and the console, and by /healthz, so
# the owner can see which version is live. CHANGELOG.md says what is in it.
VERSION = _read_version()
templates.env.globals["version"] = VERSION


class _GzipText(GZipMiddleware):
    """Compress the home page and the text files, and nothing else.

    On a phone, the stylesheet and the page shrink to about a quarter. Pictures
    and fonts are already compressed. Pages that carry a one-time code or
    a device's details are left alone on purpose: compressing a secret next
    to text a visitor can choose is how some attacks read it back.
    """

    TEXT = (".css", ".js", ".svg", ".webmanifest", ".txt")

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "") if scope["type"] == "http" else ""
        if path in ("/", "/privacy", "/terms", "/brand", "/genesis", "/vortex", "/sitemap.xml") or (path.startswith(("/static/", "/console/assets/"))
                           and path.endswith(self.TEXT)):
            await super().__call__(scope, receive, send)
        else:
            await self.app(scope, receive, send)


app.add_middleware(_GzipText, minimum_size=512)


# ---------------------------------------------------------------- helpers

_proxy_shape_logged = False


def _log_proxy_shape_once(request: Request, forwarded: str) -> None:
    """Say once, in the server log, what the host's proxy headers look like.

    Whether the last X-Forwarded-For entry is the visitor depends on how many
    proxies sit in front (Render alone, or Render behind Cloudflare). This
    line lets the owner check on the live site without guessing. It gives
    counts and yes/no answers only, never an address.
    """
    global _proxy_shape_logged
    if _proxy_shape_logged:
        return
    _proxy_shape_logged = True
    entries = [e.strip() for e in forwarded.split(",") if e.strip()]
    cf = request.headers.get("cf-connecting-ip", "").strip()
    logging.getLogger("horizon").warning(
        "Proxy check: X-Forwarded-For has %d entr%s; CF-Connecting-IP %s; "
        "the last entry %s CF-Connecting-IP. If it does not match, visitors "
        "are being counted by a proxy's address: see the README's note on a "
        "second proxy.",
        len(entries), "y" if len(entries) == 1 else "ies",
        "present" if cf else "absent",
        "matches" if cf and entries and entries[-1] == cf else ("does not match" if cf else "cannot be compared with"),
    )


def client_ip(request: Request) -> str:
    """Who is asking, for counting tries.

    An IPv6 address counts as its whole /64 block: one home or server is
    normally given the whole block, so counting each address on its own
    let a guesser use a fresh one for every try.
    """
    address = request.client.host if request.client else "unknown"
    if config.get().trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            _log_proxy_shape_once(request, forwarded)
            # The last entry is the one our own host's proxy added; the
            # ones before it were sent by the visitor and can be made up.
            address = forwarded.split(",")[-1].strip()
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return address
    if ip.version == 4:
        return str(ip)
    if ip.ipv4_mapped is not None:
        return str(ip.ipv4_mapped)
    return str(ipaddress.ip_network(f"{ip}/64", strict=False))


def set_cookie(response: Response, name: str, value: str, max_age: int):
    response.set_cookie(
        name, value, max_age=max_age, httponly=True, samesite="strict",
        secure=not config.get().dev, path="/",
    )


def clear_cookie(response: Response, name: str):
    """Delete a cookie with the same locks it was set with.

    Starlette's own delete sent it without Secure or HttpOnly and as
    SameSite=Lax, unlike every cookie the site sets.
    """
    response.delete_cookie(name, path="/", secure=not config.get().dev,
                           httponly=True, samesite="strict")


def not_found(request: Request) -> HTMLResponse:
    """The one answer to everything a stranger may not see.

    Every refusal, and every path that does not exist, gets this same page with
    the same headers, so nothing tells a stranger the console is there.
    """
    response = templates.TemplateResponse(request, "404.html", status_code=404)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"
    return response


def base_url(request: Request) -> str:
    settings = config.get()
    if settings.public_url:
        return settings.public_url
    url = request.base_url
    # The host ends https at its own proxy and hands the request on as plain
    # http, so the address seen here says http even though the site is
    # https. A QR code with http:// in it sent the one-time code unencrypted,
    # and a plain-http page cannot make a device key.
    if not settings.dev and url.scheme == "http":
        url = url.replace(scheme="https")
    return str(url).rstrip("/")


def signed_in(request: Request):
    return lock.session_device(
        request.cookies.get(SESSION_COOKIE), request.cookies.get(DEVICE_COOKIE)
    )


def _lock_down(response: Response) -> None:
    """The security headers every answer carries."""
    response.headers["Content-Security-Policy"] = CSP
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if not config.get().dev:
        response.headers["Strict-Transport-Security"] = "max-age=31536000"


@app.middleware("http")
async def guard(request: Request, call_next):
    # Every change has to come from this site's own pages. Cookies are also
    # "same site only", so this is a second wall against other sites.
    # It is the main wall against the apps on this domain's subdomains
    # (rankup., cyberlogix., omniarmor.): to a browser they are the "same
    # site" as this one, so SameSite lets their requests carry our cookies.
    # The exact host compared here does not.
    if request.method != "GET" and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin", "")
        try:
            same_site = bool(origin) and urlsplit(origin).netloc == request.url.netloc
        except ValueError:  # not an address at all, such as "https://[::1"
            same_site = False
        if not same_site:
            return JSONResponse({"error": "Bad origin"}, status_code=403)
    response = await call_next(request)
    _lock_down(response)
    path = request.url.path
    if path.startswith("/static/") and response.status_code in (200, 304):
        # A fingerprinted address (see `asset`) never changes. The rest
        # (pictures and fonts named in the stylesheet) can, after a deploy,
        # so they are kept a day and then checked again.
        if request.query_params.get("v"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "public, max-age=86400"
    if path.startswith(("/console", "/api/")):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Robots-Tag"] = "noindex"
    if config.get().noindex:
        response.headers["X-Robots-Tag"] = "noindex"
    return response


@app.exception_handler(404)
async def _404(request: Request, exc):
    return not_found(request)


@app.exception_handler(StarletteHTTPException)
async def _http_error(request: Request, exc):
    # A wrong method (405) used to answer "Method Not Allowed, allow: POST",
    # which told a stranger exactly which addresses exist.
    return not_found(request)


@app.exception_handler(Exception)
async def _server_error(request: Request, exc: Exception):
    # A friendly page instead of a bare "Internal Server Error". The error
    # itself still goes to the server log. It says nothing about what broke,
    # so the page tells a stranger nothing.
    logging.getLogger("horizon").exception("Server error on %s", errors.scrub(request.url.path))
    errors.report(request.method, request.url.path, exc, VERSION)
    # This answer is made outside the `guard` middleware, so it adds the
    # security headers itself.
    if request.url.path.startswith("/api/"):
        response = JSONResponse({"error": "Something went wrong. Please try again."},
                                status_code=500)
    else:
        response = templates.TemplateResponse(request, "500.html", status_code=500)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"
    _lock_down(response)
    return response


@app.exception_handler(RequestValidationError)
async def _bad_request(request: Request, exc):
    # Checked before the owner check runs, so a 422 with field names used to
    # describe console endpoints to anyone.
    return not_found(request)


# ---------------------------------------------------------------- public pages

# HEAD too: many uptime monitors ask with HEAD, and got "page not found".
@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
def home(request: Request):
    settings = config.get()
    stats.refresh_in_background()
    return templates.TemplateResponse(request, "home.html", {
        "urls": settings.app_urls,
        "contact": settings.contact_email,
        "numbers": stats.public_numbers(),
        "projects": stats.PROJECTS,
        "base": base_url(request),
    })


# The date the privacy page and the terms last changed in substance.
LEGAL_UPDATED = "5 November 2026"


def _legal(request: Request, page: str) -> HTMLResponse:
    settings = config.get()
    return templates.TemplateResponse(request, f"{page}.html", {
        "page": page,
        "updated": LEGAL_UPDATED,
        "contact": settings.contact_email,
        # Read from the same settings the cookies are set with, so the page
        # cannot say one thing while the code does another.
        "vortex_days": vortex.KEEP_DAYS,
        "cookies": {"device_days": DEVICE_COOKIE_DAYS,
                    "door_minutes": settings.knock_minutes,
                    "session_hours": settings.session_hours},
    })


@app.api_route("/privacy", methods=["GET", "HEAD"], response_class=HTMLResponse)
def privacy(request: Request):
    return _legal(request, "privacy")


@app.api_route("/terms", methods=["GET", "HEAD"], response_class=HTMLResponse)
def terms(request: Request):
    return _legal(request, "terms")


@app.api_route("/brand", methods=["GET", "HEAD"], response_class=HTMLResponse)
def brand(request: Request):
    return templates.TemplateResponse(request, "brand.html", {"page": "brand"})


# Genesis: anyone can turn an idea into a project here. The projects are
# kept in the visitor's own browser (static/js/genesis-store.js) and never
# stored here. Only Ask Genesis sends anything: the few fields it needs, when
# the visitor presses its button (genesis_ai.py).
@app.api_route("/genesis", methods=["GET", "HEAD"], response_class=HTMLResponse)
def genesis(request: Request):
    return templates.TemplateResponse(request, "genesis.html", {
        "page": "genesis",
        "contact": config.get().contact_email,
        "base": base_url(request),
        "ai": genesis_ai.enabled(),
    })


# Chroma Vortex: the official place to partner with MTRX Horizyn, pitch an
# idea or reach the company as an investor (vortex.py). It keeps what the
# visitor chooses to send, for the owner to reply to, and nothing else.
@app.api_route("/vortex", methods=["GET", "HEAD"], response_class=HTMLResponse)
def vortex_page(request: Request):
    return templates.TemplateResponse(request, "vortex.html", {
        "page": "vortex",
        "contact": config.get().contact_email,
        "base": base_url(request),
        "apps": vortex.APPS,
        "partnerships": vortex.PARTNERSHIPS,
        "limits": vortex.LIMITS,
        "keep_days": vortex.KEEP_DAYS,
    })


@app.api_route("/chroma-vortex", methods=["GET", "HEAD"])
def chroma_vortex():
    return RedirectResponse("/vortex", status_code=301)


@app.api_route("/healthz", methods=["GET", "HEAD"])
def healthz():
    return {"ok": True, "version": VERSION}


# The pages a search engine may list. The console is never one of them.
PUBLIC_PAGES = ("/", "/genesis", "/vortex", "/privacy", "/terms", "/brand")


@app.api_route("/robots.txt", methods=["GET", "HEAD"], response_class=Response)
def robots(request: Request):
    # Naming /console here told every visitor where to look. The console
    # pages already say noindex themselves.
    if config.get().noindex:
        return Response("User-agent: *\nDisallow: /\n", media_type="text/plain")
    return Response(f"User-agent: *\nAllow: /\n\nSitemap: {base_url(request)}/sitemap.xml\n",
                    media_type="text/plain")


@app.api_route("/sitemap.xml", methods=["GET", "HEAD"], response_class=Response)
def sitemap(request: Request):
    # Set MTRX_PUBLIC_URL on the live site: without it the address comes
    # from the request, and is escaped since the visitor chose it.
    base = xml_escape(base_url(request))
    pages = () if config.get().noindex else PUBLIC_PAGES
    urls = "".join(f"  <url><loc>{base}{page}</loc></url>\n" for page in pages)
    body = ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f"{urls}</urlset>\n")
    return Response(body, media_type="application/xml")


# Every body the site accepts is a few short fields.
MAX_BODY = 16_384


async def _json(request: Request):
    """The request's JSON object, or {} for anything else.

    Bodies used to be read whole however big they were, so anyone could
    make the server hold as much as they cared to send, and JSON nested
    thousands deep crashed the parser with a 500.
    """
    size = request.headers.get("content-length", "")
    if size and (not size.isdigit() or int(size) > MAX_BODY):
        return {}
    raw = b""
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > MAX_BODY:
            return {}
    try:
        body = json.loads(raw)
    except (ValueError, RecursionError):
        return {}
    return body if isinstance(body, dict) else {}


@app.post("/api/genesis/ask")
async def genesis_ask(request: Request):
    """Ask Genesis (genesis_ai.py). Open to every visitor, with no cookie:
    each one is counted by address, as failed tries are. Like every change,
    it only comes from this site's own pages (see `guard`)."""
    body = await _json(request)
    status, answer = await run_in_threadpool(genesis_ai.answer, client_ip(request), body)
    return JSONResponse(answer, status_code=status)


@app.post("/api/vortex/send")
async def vortex_send(request: Request):
    """A Chroma Vortex message. Open to every visitor, with no cookie: each
    address may send a few (see vortex.claim). Like every change, it only
    comes from this site's own pages (see `guard`)."""
    body = await _json(request)
    status, answer = await run_in_threadpool(vortex.send, client_ip(request), body)
    return JSONResponse(answer, status_code=status)


@app.post("/api/knock")
async def knock(request: Request):
    # The database work runs in a worker thread: done here, on the event loop,
    # every knock held up every other visitor while it ran.
    taps = (await _json(request)).get("taps")
    return await run_in_threadpool(_knock, request.cookies.get(DEVICE_COOKIE), taps)


def _knock(device_id: str | None, taps) -> JSONResponse:
    # Only an approved device can use the knock, so only its knock is looked
    # at. Anyone else's is ignored without a word: the right order used to
    # answer "go to /console" to anybody, so a stranger could try every
    # order from as many addresses as they had and learn it.
    dev = lock.device(device_id)
    if dev is None:
        return JSONResponse({"go": None})
    # Tries are counted per device, not per address. Many people can share
    # one address (a phone network, an office, the host's own proxies), and
    # a stranger's wrong knocks there used to lock the owner out.
    who = "device:" + dev["id"]
    # Out of tries: refused without even looking, and without writing another
    # row.
    if not lock.allowed("knock", who):
        return JSONResponse({"go": None})
    if lock.knock_matches(taps):
        response = JSONResponse({"go": "/console"})
        minutes = config.get().knock_minutes
        set_cookie(response, DOOR_COOKIE, lock.open_door(), minutes * 60)
        db.log("Door opened", "Secret knock")
        return response
    # Every wrong knock costs a try, whatever its shape. Only "four or more
    # taps" used to count, while one tap holding the whole order with spaces
    # in it was checked as a full knock: guessing was free.
    lock.record_failure("knock", who)
    return JSONResponse({"go": None})


# ---------------------------------------------------------------- the console

@app.get("/console", response_class=HTMLResponse)
def console(request: Request):
    if signed_in(request):
        return templates.TemplateResponse(request, "console.html")
    device_ok = lock.device(request.cookies.get(DEVICE_COOKIE)) is not None
    if device_ok and lock.door_open(request.cookies.get(DOOR_COOKIE)):
        return templates.TemplateResponse(request, "unlock.html")
    return not_found(request)


# ":path" lets the code hold a "/": render.yaml has Render make the setup
# code, which is base64 and can have one, and the page was then missing.
@app.get("/console/add/{token:path}", response_class=HTMLResponse)
def add_device_page(request: Request, token: str):
    # This page says whether a code is live, so a wrong code here costs a
    # try just as it does at /api/enroll; with no limit, the setup code
    # could be guessed here as fast as a computer could ask.
    #
    # An address that is out of tries can still open a live QR code: many
    # people share one address (a phone network, an office), and a stranger's
    # wrong codes used to block the owner's new phone for an hour. A QR code
    # is 256 random bits, so letting it through helps no guesser. The setup
    # code, which the owner may have typed in themselves, still waits.
    who = client_ip(request)
    tries_left = lock.allowed("enroll", who)
    if not lock.token_usable(token, setup_ok=tries_left):
        if tries_left:
            lock.record_failure("enroll", who)
        return not_found(request)
    return templates.TemplateResponse(request, "add.html", {"token": token})


@app.post("/api/enroll")
async def enroll(request: Request):
    return await run_in_threadpool(_enroll, request, client_ip(request), await _json(request))


def _enroll(request: Request, who: str, body: dict):
    # Out of tries: only a QR code is still accepted (see add_device_page).
    tries_left = lock.allowed("enroll", who)
    try:
        device_id = lock.enroll(
            str(body["token"]), str(body.get("name", "")),
            str(body["public_key"]), str(body["signature"]),
            setup_ok=tries_left,
        )
    except (ValueError, KeyError, TypeError):
        device_id = None
    if device_id is None:
        if tries_left:
            lock.record_failure("enroll", who)
        # The same page as any other address that does not exist: a JSON
        # "that link has expired" told anyone that device approval lives here.
        return not_found(request)
    response = JSONResponse({"go": "/console"})
    set_cookie(response, DEVICE_COOKIE, device_id, DEVICE_COOKIE_DAYS * 86400)
    # The device just proved itself, so let it straight in this once.
    set_cookie(response, DOOR_COOKIE, lock.open_door(), config.get().knock_minutes * 60)
    return response


@app.post("/api/unlock/challenge")
def unlock_challenge(request: Request):
    device_id = request.cookies.get(DEVICE_COOKIE)
    if lock.device(device_id) is None or not lock.door_open(request.cookies.get(DOOR_COOKIE)):
        return not_found(request)
    return {"challenge": lock.make_challenge(device_id)}


@app.post("/api/unlock")
async def unlock(request: Request):
    return await run_in_threadpool(_unlock, request, client_ip(request), await _json(request))


def _unlock(request: Request, who: str, body: dict):
    device_id = request.cookies.get(DEVICE_COOKIE)
    door = request.cookies.get(DOOR_COOKIE)
    if not lock.allowed("unlock", who) or not lock.door_open(door):
        return not_found(request)
    try:
        token = lock.unlock(device_id, str(body["challenge"]), str(body["signature"]))
    except (ValueError, KeyError, TypeError):
        token = None
    if token is None:
        lock.record_failure("unlock", who)
        return JSONResponse({"error": "This device couldn't prove who it is."}, status_code=403)
    lock.close_door(door)
    response = JSONResponse({"go": "/console"})
    set_cookie(response, SESSION_COOKIE, token, config.get().session_hours * 3600)
    # Set only on approval, the device cookie ran out 400 days later however
    # often the device was used, and the owner was locked out. Renew it.
    set_cookie(response, DEVICE_COOKIE, device_id, DEVICE_COOKIE_DAYS * 86400)
    clear_cookie(response, DOOR_COOKIE)
    return response


def _owner_only(request: Request):
    dev = signed_in(request)
    if dev is None:
        return None, not_found(request)
    return dev, None


# The console's own files. They used to sit in /static where anyone could
# fetch them, and a manifest saying "MTRX Horizyn Console, start at /console"
# rather gave the game away. Now only a device that may see the page that
# uses a file can fetch it.
PRIVATE = config.ROOT / "horizon" / "private"
ASSETS = {
    "console.js": ("signed_in", "text/javascript"),
    "console.css": ("signed_in", "text/css"),
    "manifest.webmanifest": ("signed_in", "application/manifest+json"),
    "unlock.js": ("at_the_door", "text/javascript"),
}


@app.get("/console/assets/{name}")
def console_asset(request: Request, name: str):
    rule = ASSETS.get(name)
    if rule is None:
        return not_found(request)
    who, media_type = rule
    allowed = signed_in(request) is not None
    if not allowed and who == "at_the_door":
        allowed = (lock.device(request.cookies.get(DEVICE_COOKIE)) is not None
                   and lock.door_open(request.cookies.get(DOOR_COOKIE)))
    if not allowed:
        return not_found(request)
    response = FileResponse(PRIVATE / name, media_type=media_type)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/console/overview")
def overview(request: Request, days: int = 30):
    dev, denied = _owner_only(request)
    if denied:
        return denied
    # The numbers and the health checks at once: each keeps to its own
    # few seconds, so the page waits for the slower of the two, not both.
    with ThreadPoolExecutor(max_workers=2) as pool:
        numbers, checks = pool.submit(stats.fetch_all), pool.submit(health.check_all)
        apps, checks = numbers.result(), checks.result()
    stats.snapshot(apps)
    health.record(checks)
    with db.connect() as conn:
        activity = [dict(r) for r in conn.execute(
            "SELECT at, event, detail FROM activity ORDER BY id DESC LIMIT 12")]
    devices = [
        {"id": lock.handle(d["id"]), "name": d["name"], "created_at": d["created_at"],
         "last_seen": d["last_seen"], "this": d["id"] == dev["id"]}
        for d in lock.list_devices()
    ]
    return {
        "apps": apps,
        "server": stats.server(),
        "history": stats.history(max(1, min(days, 366))),
        "health": health.summary(),
        "alerts": _alert_setup(),
        "activity": activity,
        "devices": devices,
        "projects": stats.PROJECTS,
        "admin_urls": config.get().admin_urls,
        "costs": costs.summary(),
    }


def _alert_setup() -> dict:
    """How the owner hears about an app that is down, for the console to
    say. Whether email is set up, never the address or the login."""
    settings = config.get()
    return {"minutes": settings.alert_minutes,
            "email": bool(settings.alert_email and settings.smtp_host)}


@app.post("/api/console/invite")
def invite(request: Request):
    dev, denied = _owner_only(request)
    if denied:
        return denied
    url = f"{base_url(request)}/console/add/{lock.make_invite(dev['id'])}"
    image = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, border=2)
    buf = io.BytesIO()
    image.save(buf)
    qr = "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()
    db.log("Approval code made", f"on {dev['name']}")
    return {"url": url, "qr": qr, "minutes": lock.INVITE_MINUTES}


# The address names a device by its handle (see lock.handle), never by its id.
@app.post("/api/console/devices/{name}/remove")
def remove(request: Request, name: str):
    dev, denied = _owner_only(request)
    if denied:
        return denied
    target = lock.device_by_handle(name)
    if target is not None and target["id"] == dev["id"]:
        return JSONResponse({"error": "You can't remove the device you're using."},
                            status_code=400)
    if target is None or not lock.remove_device(target["id"]):
        # Not 404: the console takes a 404 to mean "signed out" and leaves.
        return JSONResponse({"error": "That device was already removed."}, status_code=409)
    db.log("Device removed", f"{target['name']} (by {dev['name']})")
    return {"ok": True}


@app.post("/api/console/signout")
def signout(request: Request):
    dev, denied = _owner_only(request)
    if denied:
        return denied
    lock.end_session(request.cookies.get(SESSION_COOKIE))
    db.log("Signed out", dev["name"])
    response = JSONResponse({"go": "/"})
    clear_cookie(response, SESSION_COOKIE)
    return response


# ---------------------------------------------------------------- Chroma Vortex, for the owner

@app.get("/api/console/vortex")
def vortex_inbox(request: Request, box: str = "inbox"):
    dev, denied = _owner_only(request)
    if denied:
        return denied
    return vortex.inbox("archived" if box == "archived" else "inbox")


@app.post("/api/console/vortex/{message_id}/{action}")
def vortex_act(request: Request, message_id: str, action: str):
    dev, denied = _owner_only(request)
    if denied:
        return denied
    if action not in vortex.ACTIONS or not message_id.isdigit() or len(message_id) > 12:
        return JSONResponse({"error": "That isn't something the console can do."}, status_code=400)
    if not vortex.act(int(message_id), action):
        # Not 404: the console takes a 404 to mean "signed out" and leaves.
        return JSONResponse({"error": "That message is already gone."}, status_code=409)
    if action == "delete":
        db.log("Vortex message deleted", f"by {dev['name']}")
    return {"ok": True, "unread": vortex.unread()}
