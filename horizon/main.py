"""The MTRX Horizon web app: the public home page and the owner's console."""

import base64
import io
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

import qrcode
import qrcode.image.svg
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
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
    return templates.TemplateResponse(request, "404.html", status_code=404)


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
    return Response("User-agent: *\nDisallow: /console\n", media_type="text/plain")


@app.post("/api/knock")
async def knock(request: Request):
    try:
        body = await request.json()
    except ValueError:
        body = {}
    taps = body.get("taps") if isinstance(body, dict) else None
    who = client_ip(request)
    if lock.allowed("knock", who) and lock.knock_matches(taps):
        response = JSONResponse({"go": "/console"})
        minutes = config.get().knock_minutes
        set_cookie(response, DOOR_COOKIE, lock.open_door(), minutes * 60)
        db.log("Door opened", "Secret knock")
        return response
    if isinstance(taps, list) and len(taps) >= 4:
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
    who = client_ip(request)
    if not lock.allowed("enroll", who):
        return JSONResponse({"error": "Too many tries. Wait an hour."}, status_code=429)
    try:
        body = await request.json()
        device_id = lock.enroll(
            str(body["token"]), str(body.get("name", "")),
            str(body["public_key"]), str(body["signature"]),
        )
    except (ValueError, KeyError, TypeError):
        device_id = None
    if device_id is None:
        lock.record_failure("enroll", who)
        return JSONResponse({"error": "That link has expired or was already used."},
                            status_code=400)
    response = JSONResponse({"go": "/console"})
    set_cookie(response, DEVICE_COOKIE, device_id, 400 * 86400)
    # The device just proved itself, so let it straight in this once.
    set_cookie(response, DOOR_COOKIE, lock.open_door(), config.get().knock_minutes * 60)
    return response


@app.post("/api/unlock/challenge")
def unlock_challenge(request: Request):
    device_id = request.cookies.get(DEVICE_COOKIE)
    if lock.device(device_id) is None or not lock.door_open(request.cookies.get(DOOR_COOKIE)):
        return JSONResponse({"error": "Not found"}, status_code=404)
    return {"challenge": lock.make_challenge(device_id)}


@app.post("/api/unlock")
async def unlock(request: Request):
    who = client_ip(request)
    device_id = request.cookies.get(DEVICE_COOKIE)
    door = request.cookies.get(DOOR_COOKIE)
    if not lock.allowed("unlock", who) or not lock.door_open(door):
        return JSONResponse({"error": "Not found"}, status_code=404)
    try:
        body = await request.json()
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
        return None, JSONResponse({"error": "Not found"}, status_code=404)
    return dev, None


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
