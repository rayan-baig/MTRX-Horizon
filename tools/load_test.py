"""Many visitors at once: how fast the public pages answer, and what breaks first.

    python tools/load_test.py http://localhost:8000 --users 50 --seconds 20

Run it against your own copy, never someone else's site. It only reads
public pages (the home page, /healthz, the legal pages, the brand page,
the stylesheet) and the console's "page not found" answer.
"""

import argparse
import asyncio
import statistics
import time

import httpx

PATHS = ("/", "/healthz", "/privacy", "/terms", "/brand", "/robots.txt",
         "/sitemap.xml", "/console")


async def visitor(client, base, stop, times, errors):
    i = 0
    while time.monotonic() < stop:
        path = PATHS[i % len(PATHS)]
        i += 1
        start = time.monotonic()
        try:
            response = await client.get(base + path)
            ok = response.status_code == (404 if path == "/console" else 200)
        except httpx.HTTPError as exc:
            ok, response = False, exc
        times.setdefault(path, []).append(time.monotonic() - start)
        if not ok:
            errors.append(f"{path}: {getattr(response, 'status_code', response)!r}")


async def run(base, users, seconds):
    times, errors = {}, []
    limits = httpx.Limits(max_connections=users)
    async with httpx.AsyncClient(limits=limits, timeout=10) as client:
        stop = time.monotonic() + seconds
        await asyncio.gather(*(visitor(client, base, stop, times, errors) for _ in range(users)))
    total = sum(len(t) for t in times.values())
    print(f"{users} visitors for {seconds}s: {total} requests, {total / seconds:.0f} a second, "
          f"{len(errors)} failed")
    for path, t in times.items():
        t.sort()
        p95 = t[int(len(t) * 0.95) - 1]
        print(f"  {path:13} median {statistics.median(t) * 1000:6.0f} ms   95% under {p95 * 1000:6.0f} ms")
    for e in errors[:5]:
        print("  failed:", e)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("--users", type=int, default=50)
    parser.add_argument("--seconds", type=int, default=20)
    args = parser.parse_args()
    asyncio.run(run(args.base.rstrip("/"), args.users, args.seconds))


if __name__ == "__main__":
    main()
