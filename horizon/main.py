"""The MTRX Horizon web app: the public home page and the owner's console."""

import base64
import io
import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

import qrcode
import qrcode.image.svg
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.templating import Jinja2Templates

from . import config, db, lock, stats

DEVICE_COOKIE = "mh_d"
DOOR_COOKIE = "mh_k"
SESSION_COOKIE = "mh_s"

CSP = (
    "default-src 'self'; img-src 'self' data:; "
    "style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
    "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; "
    "base-uri 'none'; form-action 'self'"
)

@asynccontextmanager
async def lifespan(_app):
    db.init()
    yield


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


# ---------------------------------------------------------------- helpers

def client_ip(request: Request) -> str:
    if config.get().trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            # The last entry is the one our own host's proxy added; the
            # ones before it were sent by the visitor and can be made up.
            return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def set_cookie(response: Response, name: str, value: str, max_age: int):
    response.set_cookie(
        name, value, max_age=max_age, httponly=True, samesite="strict",
        secure=not config.get().dev, path="/",
    )


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
    return config.get().public_url or str(request.base_url).rstrip("/")


def signed_in(request: Request):
    return lock.session_device(
        request.cookies.get(SESSION_COOKIE), request.cookies.get(DEVICE_COOKIE)
    )


@app.middleware("http")
async def guard(request: Request, call_next):
    # Every change has to come from this site's own pages. Cookies are also
    # "same site only", so this is a second wall against other sites.
    if request.method != "GET" and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin", "")
        if not origin or urlsplit(origin).netloc != request.url.netloc:
            return JSONResponse({"error": "Bad origin"}, status_code=403)
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = CSP
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if not config.get().dev:
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    path = request.url.path
    if path.startswith(("/console", "/api/")):
        response.headers["Cache-Control"] = "no-store"
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


@app.exception_handler(RequestValidationError)
async def _bad_request(request: Request, exc):
    # Checked before the owner check runs, so a 422 with field names used to
    # describe console endpoints to anyone.
    return not_found(request)


# ---------------------------------------------------------------- public pages

@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    urls = config.get().app_urls
    stats.refresh_in_background()
    return templates.TemplateResponse(request, "home.html", {
        "urls": urls,
        "numbers": stats.public_numbers(),
        "projects": stats.PROJECTS,
    })


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/robots.txt", response_class=Response)
def robots():
    # Naming /console here told every visitor where to look. The console
    # pages already say noindex themselves.
    return Response("User-agent: *\nAllow: /\n", media_type="text/plain")


async def _json(request: Request):
    try:
        body = await request.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


@app.post("/api/knock")
async def knock(request: Request):
    # The database work runs in a worker thread: done here, on the event loop,
    # every knock held up every other visitor while it ran.
    return await run_in_threadpool(_knock, client_ip(request), (await _json(request)).get("taps"))


def _knock(who: str, taps) -> JSONResponse:
    # Out of tries: refused without even looking, and without writing another
    # row (writing one per refused request let a stranger grow the database
    # without limit).
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


@app.get("/console/add/{token}", response_class=HTMLResponse)
def add_device_page(request: Request, token: str):
    if not lock.token_usable(token):
        return not_found(request)
    return templates.TemplateResponse(request, "add.html", {"token": token})


@app.post("/api/enroll")
async def enroll(request: Request):
    return await run_in_threadpool(_enroll, request, client_ip(request), await _json(request))


def _enroll(request: Request, who: str, body: dict):
    if not lock.allowed("enroll", who):
        return not_found(request)
    try:
        device_id = lock.enroll(
            str(body["token"]), str(body.get("name", "")),
            str(body["public_key"]), str(body["signature"]),
        )
    except (ValueError, KeyError, TypeError):
        device_id = None
    if device_id is None:
        lock.record_failure("enroll", who)
        # The same page as any other address that does not exist: a JSON
        # "that link has expired" told anyone that device approval lives here.
        return not_found(request)
    response = JSONResponse({"go": "/console"})
    set_cookie(response, DEVICE_COOKIE, device_id, 400 * 86400)
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
    response.delete_cookie(DOOR_COOKIE, path="/")
    return response


def _owner_only(request: Request):
    dev = signed_in(request)
    if dev is None:
        return None, not_found(request)
    return dev, None


# The console's own files. They used to sit in /static where anyone could
# fetch them, and a manifest saying "MTRX Horizon Console, start at /console"
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
    with ThreadPoolExecutor(max_workers=3) as pool:
        apps = list(pool.map(stats.fetch_app, stats.APPS))
    stats.snapshot(apps)
    with db.connect() as conn:
        activity = [dict(r) for r in conn.execute(
            "SELECT at, event, detail FROM activity ORDER BY id DESC LIMIT 12")]
    devices = [
        {"id": d["id"], "name": d["name"], "created_at": d["created_at"],
         "last_seen": d["last_seen"], "this": d["id"] == dev["id"]}
        for d in lock.list_devices()
    ]
    return {
        "apps": apps,
        "server": stats.server(),
        "history": stats.history(max(1, min(days, 366))),
        "activity": activity,
        "devices": devices,
        "projects": stats.PROJECTS,
    }


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


@app.post("/api/console/devices/{device_id}/remove")
def remove(request: Request, device_id: str):
    dev, denied = _owner_only(request)
    if denied:
        return denied
    if device_id == dev["id"]:
        return JSONResponse({"error": "You can't remove the device you're using."},
                            status_code=400)
    target = lock.device(device_id)
    if target is None or not lock.remove_device(device_id):
        return JSONResponse({"error": "No such device."}, status_code=404)
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
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
