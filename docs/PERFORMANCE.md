# Speed on a phone: a first visit

How fast each public page loads for someone opening it for the first time,
on an ordinary phone on a slow connection. Run it again any time:

    python -m uvicorn horizon.main:app --port 8000 &
    python tools/measure_pages.py http://localhost:8000 --runs 3

It needs Playwright and its Chromium (`pip install playwright`, then
`python -m playwright install chromium`, or pass `--chromium` with the path
of one you already have). Run it against your own copy only.

## How it is measured

- A fresh browser for every page, with nothing saved: a first visit.
- A 390 x 844 phone screen.
- The processor slowed down 4 times, like a mid-range phone.
- A "Fast 3G" network: about 1.5 Mbit/s down, 560 ms there and back for every request.
- Each page loaded 3 times; the middle result is shown.

What each column means:

- **LCP** (Largest Contentful Paint): when the biggest picture or block of words has been drawn.
  Under 2.5 s is good.
- **KB**: everything the page fetched, as it travelled (compressed).
- **Requests**: how many files the page fetched.
- **Shift** (Cumulative Layout Shift): how much the page jumped about while it loaded.
  Under 0.1 is good.

`/early-access` and `/creators` were measured switched on. Switched off, they are "page not
found", and the home page has no early access form (with them off it measured 2.14 s, 198 KB,
15 requests, shift 0).

## Pilot (20 November 2026, version 1.12.0)

Pilot, the assistant (docs/PILOT.md), adds one small deferred script to each public page. It
fetches the robot and its config only after the page has finished loading, and the chat window's
code only when someone opens it, so the time to draw the page is unchanged. The extra kilobytes
and requests below all arrive after the page has drawn. Before is 1.11.1, after is 1.12.0.

| Page | LCP before | LCP after | KB before | KB after | Requests before | Requests after | Shift before | Shift after |
|---|---|---|---|---|---|---|---|---|
| `/` | 2.06 s | 2.09 s | 198 KB | 245 KB | 15 | 21 | 0.00 | 0.00 |
| `/genesis` | 1.75 s | 1.73 s | 147 KB | 194 KB | 9 | 15 | 0.00 | 0.00 |
| `/orbyt` | 1.70 s | 1.67 s | 143 KB | 189 KB | 14 | 20 | 0.00 | 0.00 |
| `/partners` | 1.61 s | 1.65 s | 118 KB | 163 KB | 9 | 15 | 0.00 | 0.00 |

Two things were changed on the way to this: the robot's glow is a gradient behind the picture, not
a filter on it (a filter's blur made the browser count the robot as the biggest thing on the page),
and Ask Genesis's own-key words (`genesis-ask.js`) load only when someone uses them, so the Genesis
page asks for no more files before drawing than it did.

## Results (17 November 2026)

Before is version 1.8.3, after is 1.8.4.

| Page | LCP before | LCP after | KB before | KB after | Requests before | Requests after | Shift before | Shift after |
|---|---|---|---|---|---|---|---|---|
| `/` | 3.45 s | 2.14 s | 330 KB | 203 KB | 17 | 17 | 0.00 | 0.00 |
| `/genesis` | 1.90 s | 1.74 s | 154 KB | 133 KB | 9 | 9 | 0.00 | 0.00 |
| `/orbyt` | 1.72 s | 1.70 s | 158 KB | 137 KB | 14 | 14 | 0.00 | 0.00 |
| `/partners` | 1.66 s | 1.71 s | 139 KB | 118 KB | 9 | 9 | 0.00 | 0.00 |
| `/bundle` | 1.66 s | 1.72 s | 139 KB | 118 KB | 10 | 10 | 0.00 | 0.00 |
| `/privacy` | 1.60 s | 1.61 s | 135 KB | 114 KB | 6 | 6 | 0.00 | 0.00 |
| `/terms` | 1.61 s | 1.60 s | 133 KB | 112 KB | 6 | 6 | 0.00 | 0.00 |
| `/brand` | 1.67 s | 1.69 s | 186 KB | 122 KB | 10 | 10 | 0.00 | 0.00 |
| `/early-access` | 1.69 s | 1.71 s | 145 KB | 124 KB | 13 | 13 | 0.00 | 0.00 |
| `/creators` | 1.68 s | 1.71 s | 142 KB | 121 KB | 10 | 10 | 0.00 | 0.00 |

Every page is now under 2.5 s, and none of them jumps. Differences of a few hundredths of a
second between runs are noise.

The only files any page waits for before drawing are its stylesheets (`site.css`, plus the
page's own: `genesis.css`, `vortex.css`, `offers.css`, `grow.css`). They are small (3 to 12 KB
compressed) and all asked for at once. They can't be written into the page instead, because the
site's security policy allows no styles inside the page.

## What was slow, and what changed

- **The home page waited for its big picture.** The city and planet at the top was the largest
  thing on the page, but only the stylesheet named it, so a phone asked for it only once the
  stylesheet had arrived, behind the fonts and the app pictures. It took until 3.45 s.
  - The page now asks for it straight away, at high priority, along with the stylesheet.
  - Phones get their own copy sized for a phone screen (`hero-phone.webp`, 828 px wide, 44 KB
    instead of 104 KB). It looks the same.
  - The pictures behind the three app tiles have phone-sized copies too (`*-art-sm.webp`,
    about 10 KB each instead of 25 KB).
- **The logo in the top bar** was a 216 px picture shown at most 80 px wide. It is now 160 px:
  26 KB down to 17 KB, on every page.
- **The text font (Inter)** held every weight from thin to black, but the site only uses regular
  to semi-bold, and the browser was never allowed the rest. The files now hold just those
  weights: 48 KB down to 35 KB on every page. Letters look exactly the same.
- **The brand page** showed the logo from a 50 KB PNG; it is now a 7 KB WebP. The 512 px PNG to
  download is unchanged.

Already in place before this, and checked again:

- Every picture on every page says its width and height, so nothing jumps when it arrives.
- Text files (pages, stylesheets, scripts) are sent compressed.
- Stylesheets and scripts have a fingerprint in their address and are kept by phones for a year.
  Pictures and fonts are kept a day and then checked again.
- Fonts are served from this site, start with a stand-in font while they load
  (`font-display: swap`), and only the two the pages use straight away are asked for early.
- Scripts never hold up drawing the page (`defer`).

`tests/test_speed.py` checks that these stay true.

## The server, and staying fast when something is slow (19 November 2026, version 1.9.0)

How long the server takes to answer each page, measured on a computer with nothing else
running (60 requests each, the time until the whole answer arrived):

| Page | Middle | Slowest 1 in 20 |
|---|---|---|
| `/` | 4.2 ms | 5.3 ms |
| `/genesis` | 2.1 ms | 4.5 ms |
| `/orbyt` | 3.3 ms | 5.4 ms |
| `/partners` | 3.2 ms | 3.5 ms |
| `/privacy` | 2.2 ms | 2.7 ms |
| `/healthz` | 1.3 ms | 1.6 ms |
| `/readyz` | 1.0 ms | 2.2 ms |

Every page is a few thousandths of a second, so the server is not what a phone waits for (the
network is; see above). Nothing was changed for speed in 1.9.0.

What was slow was the site **while an outside service hung**. Pages and calls to the AI provider
or Stripe share one pool of 40 workers. With 45 Ask Genesis requests stuck on a provider that
never answered:

| | Before (1.8.4) | After (1.9.0) |
|---|---|---|
| Home page | 59 s | 0.04 s |
| Asks | 40 waited about 60 s, then failed; 5 more waited 120 s and gave up | 8 waited for the provider; 37 were told "try again" at once |

Now at most 8 calls to each outside service wait at once (`horizon/outbound.py`), so most workers
are always free for pages. `tests/test_reliability.py` checks it.

## Genesis and Orbyt (19 November 2026, version 1.10.0)

The same first-visit phone test, before (1.9.0) and after (1.10.0), middle of 3 runs:

| Page | LCP before | LCP after | KB before | KB after | Requests before | Requests after | Shift |
|---|---|---|---|---|---|---|---|
| `/genesis` | 1.76 s | 1.79 s | 133 KB | 144 KB | 9 | 9 | 0.00 |
| `/orbyt` | 1.70 s | 1.75 s | 137 KB | 141 KB | 14 | 14 | 0.00 |

Both stay well under 2.5 s, with no extra files to fetch and nothing jumping; the few hundredths
are noise. Genesis is about 10 KB bigger for today's spark and idea cards, kept in the files it
already loads instead of a new one. On a phone, Orbyt's swirl no longer blurs (the costliest
part of drawing it) and only its inner ring turns, and its app list is drawn only as it comes
near the screen (`content-visibility`).
