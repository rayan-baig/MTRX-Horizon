"""Run Omnicyte.

  python -m omnicyte              the desktop buddy, with every watcher the policy turns on
  python -m omnicyte --demo       the same, plus a pretend phishing email after a few seconds
  python -m omnicyte check X      check a link, a .eml file, or "-" for text on standard input
  python -m omnicyte serve        no buddy: the browser service and inbox watchers, alerts printed
  python -m omnicyte token        print the pairing code for the browser extension
  python -m omnicyte policy       show the settings in force and where they came from
  python -m omnicyte self-test    check this copy works (used by the builds); exit code 0 if it does
"""

import argparse
import json
import logging
import logging.handlers
import sys
import threading
import urllib.request
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


def _setup_logging():
    """To ~/.omnicyte/omnicyte.log (kept small), and to the terminal if there is one."""
    root = logging.getLogger("omnicyte")
    root.setLevel(logging.INFO)
    try:
        path = policy_mod.home() / "omnicyte.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.handlers.RotatingFileHandler(path, maxBytes=512 * 1024, backupCount=2, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        root.addHandler(handler)
    except OSError:
        pass
    if sys.stderr is not None:   # a windowed app on Windows has no terminal
        console = logging.StreamHandler()
        console.setFormatter(logging.Formatter("omnicyte: %(message)s"))
        root.addHandler(console)


def _already_running() -> bool:
    """If Omnicyte is already running, ask it to say hello and return True."""
    req = urllib.request.Request(f"http://127.0.0.1:{policy_mod.PORT}/v1/show", data=b"{}", method="POST",
                                 headers={"X-Omnicyte-Token": policy_mod.token(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=2) as r:
            return r.status == 200
    except OSError:
        return False


def self_test(out: str | None) -> int:
    """Check the engine, the windows' toolkit and the local service all work in this copy."""
    results = {}
    try:
        bad = engine.check_message(engine.Message(text="https://micros0ft-login.xyz/verify"))
        good = engine.check_message(engine.Message(text="https://github.com/acme/api"))
        results["engine"] = bad.level == "danger" and good.level == "safe"
    except Exception as e:  # report, don't crash
        results["engine"] = f"error: {e}"
    try:
        import tkinter  # noqa: F401

        from . import buddy, settings, ui  # noqa: F401
        results["windows"] = True
    except Exception as e:
        results["windows"] = f"error: {e}"
    try:
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(Guardian(), "x" * 24))
        httpd.server_close()
        results["service"] = True
    except Exception as e:
        results["service"] = f"error: {e}"
    ok = all(v is True for v in results.values())
    text = json.dumps({"ok": ok, "version": __version__, **results})
    if out:
        Path(out).write_text(text)
    if sys.stdout is not None:
        print(text)
    return 0 if ok else 1


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
    st = sub.add_parser("self-test", help="check this copy works")
    st.add_argument("--out", help="also write the result to this file")
    if argv is None:
        # macOS used to add a -psn_… argument to apps opened from Finder.
        argv = [a for a in sys.argv[1:] if not a.startswith("-psn_")]
    args = ap.parse_args(argv)
    if args.cmd == "self-test":
        return self_test(args.out)
    _setup_logging()

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

    if _already_running():
        LOG.info("Omnicyte is already running; said hello from the running one")
        return 0
    try:
        from .buddy import Buddy
    except ImportError:
        LOG.error("The buddy needs Tkinter. On Linux: sudo apt install python3-tk (or your system's equivalent). "
                  "Meanwhile, `python -m omnicyte serve` runs without it.")
        return 1
    _start_watchers(guardian, stop)
    LOG.info("Omnicyte %s started", __version__)
    try:
        Buddy(guardian, demo=args.demo).run()
    except Exception:
        LOG.exception("the buddy couldn't start (is there a screen to show it on?)")
        return 1
    finally:
        stop.set()
    return 0


if __name__ == "__main__":
    sys.exit(main())
