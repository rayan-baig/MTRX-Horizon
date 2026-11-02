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
   only in the server's settings, never in the page. Only an approved device's knock
   is looked at (anyone else is never told whether theirs was right), and each device
   gets 8 tries per 15 minutes.

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

**Keep at least two devices approved** (say, your laptop and your phone). A device's
key lives in that browser's saved data, and a browser can lose it: clearing history
does, and Safari on iPhone can clear a site's data after about a week without a
visit. If one device loses its key, open the console on the other and approve it
again with a new QR code. With only one device approved, losing its key means
setting up from scratch with a new setup code.

On iPhone, use the console in Safari. Don't rely on adding it to the Home Screen:
a Home Screen app has its own storage, separate from Safari, so a phone approved in
Safari is not approved inside the Home Screen app.

### If a device is lost or stolen

- From another approved device, open **Approved devices** and press **Remove**. It's
  locked out straight away, even if it was signed in.
- A thief would also need your knock, and your phone's own lock screen protects it.
- **If every device is lost:** in the hosting settings, set `MTRX_SETUP_TOKEN` to a new
  long random code (at least 16 characters) and save, which restarts the site. Then use
  step 2 above with the new code. In the console, remove the lost devices under
  **Approved devices**, and delete `MTRX_SETUP_TOKEN` again. The old code never works
  again, and the new one works once. Only someone with the hosting account can do this,
  so keep that account safe.

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

All three apps already have this address built in, off until they are given the key.
Pick one long random key, then:

| App | In that app's hosting settings | In this site's settings |
|---|---|---|
| RankUp | `STATS_KEY=<the key>` | `RANKUP_STATS_URL=https://<rankup site>/api/stats` |
| CyberLogix | `STATS_KEY=<the key>` | `CYBERLOGIX_STATS_URL=https://<cyberlogix site>/api/stats` |
| OmniArmor | `STATS_KEY=<the key>` | `OMNIARMOR_STATS_URL=https://<omniarmor site>/api/stats` |

and `MTRX_STATS_KEY=<the key>` here once. Each app answers with two counts and nothing
else. A wrong or missing key gets "unauthorized"; an app without `STATS_KEY` acts as if
the address does not exist.

To show an **Open app** button on the home page, set `RANKUP_URL`, `CYBERLOGIX_URL` or
`OMNIARMOR_URL` to the app's whole address, starting with `https://`. An address without
it shows no button, rather than a link to nowhere.

## Running it on a computer

```bash
pip install -r requirements.txt -c constraints.txt
MTRX_DEV=1 MTRX_KNOCK="logo logo omniarmor rankup" MTRX_SETUP_TOKEN=local-setup-code-1234567890 \
  python -m uvicorn horizon.main:app --port 8000
```

The site reads its settings from the environment, not from a file. To keep them
in one, copy `.env.example` to `.env`, fill it in, and load it into the shell
first with `set -a; . ./.env; set +a`.

`MTRX_DEV=1` lets cookies work over plain `http://localhost`. Never set it on the real site.

## Tests

```bash
pip install -r requirements.txt -c constraints.txt pytest httpx
python -m pytest -q
```

The lock tests try every way in that should fail: a stranger, a wrong or partial knock,
guessing, a copied cookie, a stolen session, a reused puzzle, an expired or reused QR code,
a removed device, and requests from other websites. `tests/test_live.py` starts the real
server and walks the owner's whole way in from `127.0.0.1` and `::1`, restarts included.

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

**Uptime monitor:** check `https://<your site>/healthz` (answers `{"ok":true}` to GET or HEAD).
The site must be served over **https**, because browsers only make device keys on secure
sites.

`MTRX_TRUST_PROXY=1` (set in `render.yaml`) has the site take each visitor's address from
the last entry in `X-Forwarded-For`, the one Render's proxy added. If you ever put a
second proxy in front, such as Cloudflare, that entry becomes Cloudflare's address and
every visitor looks the same, so strangers' wrong codes could hold back your setup code
for an hour. Change how the address is read (`client_ip` in `horizon/main.py`) before
adding one. (The knock is counted per approved device, and a live QR code works even from
an address that is out of tries, so neither is affected.)

To check what your host really sends, open the site once after a deploy and look in the
host's logs for the line starting **"Proxy check:"**. If it says the last entry "does not
match" CF-Connecting-IP, visitors are being counted by a proxy's address, and `client_ip`
needs changing. The line shows counts only, never anyone's address.

## What's where

- `horizon/main.py`: the web pages and the console's API
- `horizon/lock.py`: the three locks
- `horizon/stats.py`: the console's numbers, and the project list
- `templates/`: the pages
- `static/`: styles, scripts, pictures (cut from the supplied design artwork) and the two
  fonts (Inter and Montserrat, under the SIL Open Font License; the licences are beside them)
- `tests/`: the tests
