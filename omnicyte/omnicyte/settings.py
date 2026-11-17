"""The setup window shown the first time, and the same window as Settings later.

A small business with no IT team sets its company details here. Anything IT
has set in the policy file is shown but locked ("Set by your IT team").
"""

import re

from . import autostart, policy as policy_mod

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def current() -> dict:
    """What the window starts with."""
    p = policy_mod.load()
    return {"org_name": p.org_name, "org_domains": ", ".join(p.org_domains), "report_to": p.report_to,
            "start_at_login": autostart.is_enabled() if p.set_up else True,
            "clipboard_watch": p.clipboard_watch, "alert_caution": p.alert_on == "caution", "managed": p.managed}


def apply(values: dict) -> dict:
    """Check and save what was typed. Returns {field: problem} for anything
    that can't be used; nothing is saved unless it's all fine."""
    p = policy_mod.load()
    problems = {}
    changes = {"set_up": True}
    if "org_name" not in p.managed:
        changes["org_name"] = " ".join(str(values.get("org_name", "")).split())[:80]
    if "org_domains" not in p.managed:
        raw = str(values.get("org_domains", ""))
        domains = policy_mod.clean_domains(raw)
        if raw.strip() and not domains:
            problems["org_domains"] = "Type your company's email domains, like acme.com"
        changes["org_domains"] = domains
    if "report_to" not in p.managed:
        email = str(values.get("report_to", "")).strip()
        if email and not EMAIL.match(email):
            problems["report_to"] = "That doesn't look like an email address"
        changes["report_to"] = email
    if "alert_on" not in p.managed:
        changes["alert_on"] = "caution" if values.get("alert_caution") else "danger"
    if "clipboard_watch" not in p.managed or p.clipboard_watch:
        changes["clipboard_watch"] = bool(values.get("clipboard_watch", True))
    if problems:
        return problems
    policy_mod.save_user(**changes)
    autostart.set_enabled(bool(values.get("start_at_login")))
    return {}


def open_window(root, guardian, first_run: bool = False, on_saved=None):
    """Show the window. on_saved() runs after a successful save."""
    import tkinter as tk

    from . import ui

    c, f = ui.COLORS, ui.FONTS
    start = current()
    managed = start["managed"]
    win = tk.Toplevel(root)
    win.title("Welcome to Omnicyte" if first_run else "Omnicyte settings")
    win.configure(bg=c["bg"])
    win.resizable(False, False)
    win.attributes("-topmost", True)
    body = tk.Frame(win, bg=c["bg"], padx=26, pady=22)
    body.pack(fill="both", expand=True)

    head = tk.Frame(body, bg=c["bg"])
    head.pack(fill="x")
    face = tk.Canvas(head, width=46, height=46, bg=c["bg"], highlightthickness=0)
    face.create_oval(3, 5, 43, 43, fill="#3ad6c5", outline="#1f9e93", width=3)
    for x in (16, 30):
        face.create_oval(x - 6, 15, x + 6, 28, fill="white", outline="#14202b", width=2)
        face.create_oval(x - 2, 19, x + 3, 25, fill="#14202b", outline="")
    face.pack(side="left")
    titles = tk.Frame(head, bg=c["bg"])
    titles.pack(side="left", padx=12)
    tk.Label(titles, text="Hi! Let's get you set up." if first_run else "Settings", font=f["title"],
             fg=c["fg"], bg=c["bg"]).pack(anchor="w")
    tk.Label(titles, text="It takes a minute. Everything stays on this computer.", font=f["small"],
             fg=c["muted"], bg=c["bg"]).pack(anchor="w")

    fields, errors = {}, {}

    def section(text):
        tk.Label(body, text=text, font=f["small_bold"], fg=c["muted"], bg=c["bg"]).pack(anchor="w", pady=(18, 4))

    def entry(key, label, hint):
        tk.Label(body, text=label, font=f["bold"], fg=c["fg"], bg=c["bg"]).pack(anchor="w", pady=(8, 2))
        locked = key in managed
        var = tk.StringVar(value=start[key])
        e = tk.Entry(body, textvariable=var, font=f["body"], width=44, relief="flat", bd=0,
                     bg=c["card"], fg=c["muted"] if locked else c["fg"], insertbackground=c["fg"],
                     disabledbackground=c["card"], disabledforeground=c["muted"],
                     highlightthickness=1, highlightbackground=c["edge"], highlightcolor=c["accent"])
        e.pack(anchor="w", ipady=6, ipadx=6, fill="x")
        if locked:
            e.configure(state="disabled")
        tk.Label(body, text="Set by your IT team" if locked else hint, font=f["small"], fg=c["muted"], bg=c["bg"],
                 wraplength=420, justify="left").pack(anchor="w", pady=(2, 0))
        err = tk.Label(body, text="", font=f["small"], fg=c["danger"], bg=c["bg"])
        err.pack(anchor="w")
        fields[key], errors[key] = var, err
        return e

    def check(key, label, value, locked=False):
        var = tk.BooleanVar(value=value)
        cb = tk.Checkbutton(body, text=label, variable=var, font=f["body"], fg=c["fg"], bg=c["bg"],
                            activebackground=c["bg"], activeforeground=c["fg"], selectcolor=c["card"],
                            highlightthickness=0, bd=0, anchor="w")
        cb.pack(anchor="w", pady=2)
        if locked:
            cb.configure(state="disabled")
        fields[key] = var

    section("YOUR COMPANY")
    first = entry("org_name", "Company name", "Shown in the browser extension.")
    entry("org_domains", "Company email domains",
          "Like acme.com, acme.co.uk. Fake copies of these are the surest sign of a scam.")
    entry("report_to", "Security team's email (optional)",
          "Where “Report to security” sends what I find. Leave empty to hide that button.")

    section("HOW I WORK")
    check("start_at_login", "Start Omnicyte when I log in", start["start_at_login"])
    check("clipboard_watch", "Check links I copy (covers Slack, Teams and other chat apps)", start["clipboard_watch"],
          locked="clipboard_watch" in managed and not start["clipboard_watch"])
    check("alert_caution", "Also pop up for “take a second look” warnings, not only dangerous ones",
          start["alert_caution"], locked="alert_on" in managed)

    section("BROWSER")
    tk.Label(body, text="Install the Omnicyte extension in Chrome or Edge, then paste this pairing code into it:",
             font=f["small"], fg=c["fg"], bg=c["bg"], wraplength=420, justify="left").pack(anchor="w")
    row = tk.Frame(body, bg=c["bg"])
    row.pack(anchor="w", pady=(6, 0), fill="x")
    code = policy_mod.token()
    tk.Label(row, text=code, font=f["mono"], fg=c["fg"], bg=c["card"], padx=8, pady=5).pack(side="left")

    def copy():
        win.clipboard_clear()
        win.clipboard_append(code)
        copied.configure(text="Copied!")

    ui.button(row, "Copy", copy).pack(side="left", padx=8)
    copied = tk.Label(row, text="", font=f["small"], fg=c["accent"], bg=c["bg"])
    copied.pack(side="left")

    buttons = tk.Frame(body, bg=c["bg"])
    buttons.pack(fill="x", pady=(22, 0))

    def save():
        values = {k: v.get() for k, v in fields.items()}
        problems = apply(values)
        for key, label in errors.items():
            label.configure(text=problems.get(key, ""))
        if problems:
            return
        guardian.reload()
        win.destroy()
        if on_saved:
            on_saved()

    ui.button(buttons, "Start protecting me" if first_run else "Save", save, primary=True).pack(side="right")
    if not first_run:
        ui.button(buttons, "Cancel", win.destroy).pack(side="right", padx=8)
    else:
        win.protocol("WM_DELETE_WINDOW", save)   # closing the first window keeps the defaults
    win.bind("<Return>", lambda e: save())
    win.bind("<Escape>", lambda e: win.destroy() if not first_run else None)

    win.update_idletasks()
    w, h = win.winfo_reqwidth(), win.winfo_reqheight()
    win.geometry(f"+{(win.winfo_screenwidth() - w) // 2}+{max(20, (win.winfo_screenheight() - h) // 3)}")
    win.lift()
    win.focus_force()
    first.focus_set()
    return win
