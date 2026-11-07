"""Run Omnicyte.

  python -m omnicyte              the desktop buddy, with every watcher the policy turns on
  python -m omnicyte --demo       the same, plus a pretend phishing email after a few seconds
  python -m omnicyte check X      check a link, a .eml file, or "-" for text on standard input
  python -m omnicyte serve        no buddy: the browser service and inbox watchers, alerts printed
  python -m omnicyte token        print the pairing code for the browser extension
  python -m omnicyte policy       show the settings in force and where they came from
"""

import argparse
import json
import logging
import sys
import threading
from pathlib import Path

from . import __version__, engine, mail, policy as policy_mod, server
from .core import Guardian

LOG = logging.getLogger("omnicyte")


def _print_verdict(v: engine.Verdict, as_json: bool):
    if as_json:
        print(json.dumps(v.to_dict(), indent=2))
        return
    mark = {"danger": "DANGER ", "caution": "CAUTION", "safe": "SAFE   "}[v.level]
    print(f"{mark}  {v.headline}  (score {v.score})")
    if v.worst_link:
        dest = next((link.destination for link in v.links if link.url == v.worst_link), v.worst_link)
        print(f"  link really goes to: {dest}")
    for s in v.signals:
        print(f"  - {s.title}  [{s.detail}]")
    top = next((s for s in v.signals if s.tip), None)
    if top:
        print(f"  Spot it next time: {top.tip}")


def _check(args, guardian):
    target = args.target
    if target == "-":
        msg = engine.Message(source="manual", text=sys.stdin.read())
    elif Path(target).is_file() and target.lower().endswith(".eml"):
        msg = mail.from_bytes(Path(target).read_bytes(), where=Path(target).name)
    else:
        msg = engine.Message(source="manual", text=target if "://" in target else "https://" + target)
    v = guardian.see(msg, alert=False)
    _print_verdict(v, args.json)
    return {"safe": 0, "caution": 1, "danger": 2}[v.level]


def _start_watchers(guardian, stop):
    httpd = None
    try:
        httpd = server.serve(guardian)
        LOG.info("browser service on 127.0.0.1:%s", policy_mod.PORT)
    except OSError as e:
        LOG.warning("couldn't start the browser service (is Omnicyte already running?): %s", e)
    for box in guardian.policy.mailboxes:
        mail.InboxWatcher(box, guardian.see, stop).start()
    return httpd


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="omnicyte", description="A desktop buddy that catches phishing.")
    ap.add_argument("--version", action="version", version=f"omnicyte {__version__}")
    ap.add_argument("--demo", action="store_true", help="show a pretend phishing alert after a few seconds")
    sub = ap.add_subparsers(dest="cmd")
    c = sub.add_parser("check", help="check a link, an .eml file, or - for standard input")
    c.add_argument("target")
    c.add_argument("--json", action="store_true")
    sub.add_parser("serve", help="run without the buddy, printing alerts")
    sub.add_parser("token", help="print the browser extension's pairing code")
    sub.add_parser("policy", help="show the settings in force")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="omnicyte: %(message)s")

    guardian = Guardian()
    if args.cmd == "check":
        return _check(args, guardian)
    if args.cmd == "token":
        print(policy_mod.token())
        return 0
    if args.cmd == "policy":
        p = guardian.policy
        print(f"organisation policy: {policy_mod.org_policy_path()}"
              f"{'' if policy_mod.org_policy_path().is_file() else '  (not found)'}")
        print(f"personal settings:   {policy_mod.home() / 'settings.json'}")
        print(json.dumps({k: v for k, v in vars(p).items() if k != "mailboxes"}
                         | {"mailboxes": [m.get("user", "?") for m in p.mailboxes]}, indent=2))
        return 0

    stop = threading.Event()
    if args.cmd == "serve":
        _start_watchers(guardian, stop)
        print("Omnicyte is watching. Press Ctrl+C to stop.")
        try:
            while True:
                v = guardian.alerts.get()
                print()
                _print_verdict(v, False)
        except KeyboardInterrupt:
            return 0

    try:
        from .buddy import Buddy
    except ImportError:
        print("The buddy needs Tkinter. On Linux: sudo apt install python3-tk (or your system's equivalent).\n"
              "Meanwhile, `python -m omnicyte serve` runs without it.", file=sys.stderr)
        return 1
    _start_watchers(guardian, stop)
    try:
        Buddy(guardian, demo=args.demo).run()
    finally:
        stop.set()
    return 0


if __name__ == "__main__":
    sys.exit(main())
