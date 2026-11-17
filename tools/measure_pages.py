"""How fast each public page loads on a mid-range phone, on a first visit.

    python tools/measure_pages.py http://localhost:8000
    python tools/measure_pages.py http://localhost:8000 --runs 3 --json after.json

Run it against your own copy. It needs Playwright and its Chromium
(pip install playwright; python -m playwright install chromium).

Each page is opened in a fresh browser with nothing saved, on a 390x844
phone screen, with the processor slowed 4 times and a "Fast 3G" network
(about 1.5 Mbit/s down, 560 ms round trip). For each page it prints:

- LCP: when the biggest picture or block of words finished drawing
  (Largest Contentful Paint). Under 2.5 s is good.
- KB and requests: everything the page fetched, as sent over the wire.
- blocking: files the browser had to wait for before drawing anything.
- shift: how much the page jumped about while loading (Cumulative Layout
  Shift). Under 0.1 is good.

With --runs above 1 it shows the middle (median) result of each page.
/early-access and /creators answer "not found" unless they are switched
on; a page that is not found is shown as such and skipped.
"""

import argparse
import json
import statistics
import sys

PATHS = ("/", "/genesis", "/orbyt", "/partners", "/bundle", "/privacy", "/terms", "/brand",
         "/early-access", "/creators")

# Chrome DevTools' "Fast 3G", the same figures Lighthouse uses.
NETWORK = {"offline": False, "latency": 562.5,
           "downloadThroughput": 1.6 * 1024 * 1024 / 8 * 0.9,
           "uploadThroughput": 750 * 1024 / 8 * 0.9}
CPU_SLOWDOWN = 4
PHONE = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2,
         "is_mobile": True, "has_touch": True}

# Watches from the very start of the page, before any of its own code runs.
WATCH = """
window.__lcp = 0; window.__cls = 0;
new PerformanceObserver(list => {
  for (const e of list.getEntries()) window.__lcp = e.startTime;
}).observe({type: 'largest-contentful-paint', buffered: true});
new PerformanceObserver(list => {
  for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
}).observe({type: 'layout-shift', buffered: true});
"""

READ = """() => ({
  lcp: window.__lcp, cls: window.__cls,
  blocking: performance.getEntriesByType('resource')
    .filter(r => r.renderBlockingStatus === 'blocking')
    .map(r => new URL(r.name).pathname),
})"""


def measure(browser, url):
    context = browser.new_context(**PHONE)
    context.add_init_script(WATCH)
    page = context.new_page()
    cdp = context.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", NETWORK)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU_SLOWDOWN})
    sizes = {}
    cdp.on("Network.requestWillBeSent", lambda e: sizes.setdefault(e["requestId"], 0))
    cdp.on("Network.loadingFinished", lambda e: sizes.__setitem__(e["requestId"], e["encodedDataLength"]))
    try:
        response = page.goto(url, wait_until="load", timeout=60000)
        if response is None or response.status != 200:
            return None
        page.wait_for_load_state("networkidle", timeout=60000)
        page.wait_for_timeout(500)
        found = page.evaluate(READ)
    finally:
        context.close()
    return {"lcp_ms": round(found["lcp"]), "cls": round(found["cls"], 3),
            "kb": round(sum(sizes.values()) / 1024, 1), "requests": len(sizes),
            "blocking": sorted(set(found["blocking"]))}


def middle(runs):
    pick = sorted(runs, key=lambda r: r["lcp_ms"])[len(runs) // 2]
    return {**pick, "cls": round(statistics.median(r["cls"] for r in runs), 3)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--json", help="also save the results to this file")
    parser.add_argument("--chromium", help="a Chromium to use instead of Playwright's own")
    parser.add_argument("paths", nargs="*", default=PATHS)
    args = parser.parse_args()
    from playwright.sync_api import sync_playwright

    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chromium)
        print(f"{'page':14} {'LCP':>7} {'KB':>7} {'requests':>8} {'shift':>6}  blocking")
        for path in args.paths:
            runs = [measure(browser, args.base.rstrip("/") + path) for _ in range(args.runs)]
            if None in runs:
                print(f"{path:14} not found (switched off?)")
                continue
            r = results[path] = middle(runs)
            good = "" if r["lcp_ms"] < 2500 and r["cls"] < 0.1 else "  <- slow or jumpy"
            print(f"{path:14} {r['lcp_ms'] / 1000:6.2f}s {r['kb']:7.1f} {r['requests']:8} {r['cls']:6.3f}  "
                  f"{', '.join(r['blocking']) or '-'}{good}")
        browser.close()
    if args.json:
        with open(args.json, "w") as f:
            json.dump(results, f, indent=2)
    return 0 if all(r["lcp_ms"] < 2500 and r["cls"] < 0.1 for r in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
