# MTRX Horizon

The website for MTRX Horizon, the parent company of **RankUp**, **CyberLogix AI** and
**OmniArmor.ai**, plus a private control console that only the owner can open.

- **The home page** (`/`) shows the three apps, what each one does, and what the company
  stands for. Every number on it is true.
- **The control console** (`/console`) shows how the apps and this server are doing. It has
  no link anywhere and looks like a missing page to everyone else.

## How the console is locked

No password, no fingerprint, no face scan, and nothing physical to lose. Three locks,
all checked by the server:

1. **Only approved devices.** When a phone or laptop is approved, its browser makes a
   secret key that never leaves the device. Not even the page's own code can read it.
   To get in, the device signs a fresh random puzzle with that key. A copied cookie
   is useless without the key.
2. **New devices are approved by QR code** from a device that's already signed in. The
   code works once, for 10 minutes.
3. **The secret knock.** On the home page, tap the logo and the app icons in your own
   secret order. The right order opens the console for 5 minutes. The order is kept
   only in the server's settings, never in the page, and guessing is limited to 8 tries
   per 15 minutes.

Anyone who fails any lock sees the normal "page not found".

### The first time

1. In the hosting settings, set:
   - `MTRX_KNOCK`: your secret order, at least 4 taps, using these names:
     `logo` (the top-left logo), `mark` (the logo lower down the page), `rankup`,
     `cyberlogix`, `omniarmor` (the three app icons). Example: `logo logo omniarmor rankup mark`.
     Don't use the example. Make up your own and tell nobody.
   - `MTRX_SETUP_TOKEN`: a long random code (Render makes one for you).
2. On your laptop, open `https://<your site>/console/add/<the setup code>`, name the
   device, and press **Approve this device**. You're in.
3. In the console, press **Approve a device** and scan the QR code with your phone.

The setup code works once. After that, new devices are approved by QR.
**Then delete `MTRX_SETUP_TOKEN` from the hosting settings.** "Used once" is
remembered in the database, so if the database were ever lost (a disk reset, a
move to a plan without a disk) the same code would work again for whoever had
it. With the setting gone there is no code to reuse. If you ever need to set up
from scratch, put a new random one in, use it, and delete it again.

### Every day

Go to the home page, do the knock, and wait a second. Your device unlocks itself.
Sessions last 12 hours, and **Sign out** ends one early.

On iPhone, add the console to your Home Screen (Share → Add to Home Screen). Safari can
clear a website's saved data if you don't visit for a while, and that would wipe the key.
Home Screen apps keep it.

### If a device is lost or stolen

- From another approved device, open **Approved devices** and press **Remove**. It's
  locked out straight away, even if it was signed in.
- A thief would also need your knock, and your phone's own lock screen protects it.
- **If every device is lost:** change `MTRX_SETUP_TOKEN` in the hosting settings to a
  new code and use step 2 above again. Only someone with the hosting account can do
  this, so keep that account safe.

## Connecting the apps

The console shows "Not connected" until an app is connected. Nothing is ever made up.
To connect an app, give it a small private stats address that answers with JSON:

```json
{ "users": 120, "active_users": 30 }
```

Then set, for example, `RANKUP_STATS_URL=https://rankup.example/api/stats`. If
`MTRX_STATS_KEY` is set, the console sends it as `Authorization: Bearer <key>`, and the
app should refuse requests without it. The console saves each app's numbers once an hour
to draw the chart and work out uptime.

To show an **Open app** button on the home page, set `RANKUP_URL`, `CYBERLOGIX_URL` or
`OMNIARMOR_URL`.

## Running it on a computer

```bash
pip install -r requirements.txt
cp .env.example .env        # then fill it in
MTRX_DEV=1 MTRX_KNOCK="logo logo omniarmor rankup" MTRX_SETUP_TOKEN=local-setup-code-1234567890 \
  python -m uvicorn horizon.main:app --port 8000
```

`MTRX_DEV=1` lets cookies work over plain `http://localhost`. Never set it on the real site.

## Tests

```bash
pip install pytest httpx
python -m pytest -q
```

The lock tests try every way in that should fail: a stranger, a wrong or partial knock,
guessing, a copied cookie, a stolen session, a reused puzzle, an expired or reused QR code,
a removed device, and requests from other websites.

## The click-through demo

`tools/build_demo.py` builds a demo folder: the home page, with each app's
own offline demo behind its card. It only copies files the apps already
ship (CyberLogix's `docs/` demo, OmniArmor's `dashboard/`, and a built RankUp
preview folder if you give one). It never runs their code.

```bash
python tools/build_demo.py --out demo \
  --cyberlogix ../cyberlogix-ai --omniarmor ../omniarmor.ai --rankup ../rankup/preview
```

## Hosting

`render.yaml` sets up Render with a small paid server and a disk for the database (the
free plan has no disk, so devices would be forgotten). The `Dockerfile` works on any host.
The site must be served over **https**, because browsers only make device keys on secure
sites.

## What's where

- `horizon/main.py`: the web pages and the console's API
- `horizon/lock.py`: the three locks
- `horizon/stats.py`: the console's numbers, and the project list
- `templates/`: the pages
- `static/`: styles, scripts and pictures (cut from the supplied design artwork)
- `tests/`: the tests
