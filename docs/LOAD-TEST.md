# Load test: many visitors at once

`tools/load_test.py` sends many visitors at the public pages at once and
says how fast they answered and whether any failed. Run it against your own
copy only:

    python -m uvicorn horizon.main:app --port 8000 &
    python tools/load_test.py http://localhost:8000 --users 50 --seconds 20

## Results (2 November 2026)

One server process, on a shared 4-core test machine that was also running
the load tool and other work, so real numbers on a quiet server will be a
little better.

| Visitors at once | Requests a second | Failed | Home page, typical | Home page, slowest 5% |
|---|---|---|---|---|
| 10 | about 690 | 0 | 15 ms | under 40 ms |
| 50 | about 300 | 0 | 135 ms | under 530 ms |
| 200 | about 190 | 0 | 700 ms | under 1.9 s |

## What breaks first

Nothing failed, even at 200 visitors at once. What gives first is speed:
the site runs as one process on one processor, so past about 50 visitors at
the same instant each page waits its turn. 200 people loading the page in
the same second is far more than a company home page sees.

The console is used by one person, so it has no load problem of its own.
The console's numbers come from the apps over the network, each with a few
seconds' limit, and are fetched at most once a minute, so many console
refreshes don't multiply the calls to the apps.

## If it is ever too slow

- First, a bigger Render plan (more processor). Nothing else changes.
- Do **not** start more than one server process (`--workers`): each one
  would run its own health checks, and you would get every "app is down"
  email twice.
- Put Cloudflare in front for the static files (pictures, fonts, the
  stylesheet). They already tell browsers to keep them, so most repeat
  visits barely touch the server.
