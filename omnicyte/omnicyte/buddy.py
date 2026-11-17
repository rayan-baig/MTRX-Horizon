"""The buddy: a small cell that lives on the desktop.

Most of the time it does its own thing: bobs, blinks, follows the mouse with
its eyes, wanders along the bottom of the screen and naps. When a watcher finds
something dangerous it turns red, jumps, and opens a speech bubble that says
what not to do, shows the signals behind the warning and a tip for spotting it
next time, with buttons to report it to the security team or carry on.

Built on Tkinter, which comes with Python on Windows and macOS (on Linux,
install python3-tk), so there is nothing else to install.
"""

import logging
import math
import queue
import random
import time
import tkinter as tk
import webbrowser
from tkinter import simpledialog
from urllib.parse import quote

from . import engine, policy as policy_mod, settings, ui, urls
from .signals import TIPS

LOG = logging.getLogger("omnicyte")

SIZE = 128
KEY = "#ff00fe"          # the colour made see-through where the system allows it
MOODS = {"calm": ("#3ad6c5", "#1f9e93"), "caution": ("#ffc145", "#d18f12"), "danger": ("#ff5470", "#c4223f"),
         "sleep": ("#7fb8c9", "#4f8798")}
IDLE_TIPS = (
    "Tip: hover over a link before you click. The real address shows at the bottom of the window.",
    "Tip: IT will never ask for your password or a one-time code by email or chat.",
    "Tip: a bank-details change? Call the person on a number you already have.",
    "Tip: read web addresses right to left. The bit before .com is who you're really talking to.",
    "Tip: not sure about a message? Report it. Security would rather check ten safe ones than miss one.",
)


class Buddy:
    def __init__(self, guardian, demo: bool = False):
        self.g = guardian
        ui.sharp_text()
        self.root = tk.Tk()
        self.root.title("Omnicyte")
        ui.setup_fonts(self.root)
        self._icon = ui.app_icon(self.root)
        self.root.report_callback_exception = self._on_error
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.bg = KEY
        try:
            self.root.attributes("-transparentcolor", KEY)           # Windows
        except tk.TclError:
            try:
                self.root.attributes("-transparent", True)            # macOS
                self.bg = "systemTransparent"
            except tk.TclError:
                self.bg = "#171a24"                                   # Linux: a small dark square
        self.root.configure(bg=self.bg)
        self.canvas = tk.Canvas(self.root, width=SIZE, height=SIZE, bg=self.bg, highlightthickness=0, bd=0)
        self.canvas.pack()

        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        self.x, self.y = sw - SIZE - 40, sh - SIZE - 70
        self.floor = self.y
        self.target_x = self.x
        self.root.geometry(f"{SIZE}x{SIZE}+{self.x}+{self.y}")

        self.mood = "calm"
        self.t0 = time.time()
        self.next_blink = time.time() + 2
        self.blink_until = 0.0
        self.jump_until = 0.0
        self.last_activity = time.time()
        self.last_pointer = (0, 0)
        self.next_wander = time.time() + random.uniform(20, 60)
        self.next_tip = time.time() + random.uniform(15 * 60, 30 * 60)
        self.dots = [(random.uniform(-0.5, 0.5), random.uniform(-0.3, 0.5), random.uniform(0, 6.28)) for _ in range(5)]
        self.bubble = None
        self.current = None
        self.drag = None
        self.clip_last = ""

        self.canvas.bind("<ButtonPress-1>", self._press)
        self.canvas.bind("<B1-Motion>", self._move)
        self.canvas.bind("<ButtonRelease-1>", self._release)
        self.canvas.bind("<Button-3>", self._menu)
        self.canvas.bind("<Button-2>", self._menu)
        self.canvas.bind("<Control-Button-1>", self._menu)

        self.root.after(30, self._tick)
        self.root.after(250, self._poll_alerts)
        self.root.after(1500, self._poll_clipboard)
        if not guardian.policy.set_up:
            self.root.after(900, lambda: settings.open_window(self.root, self.g, first_run=True, on_saved=self._welcome))
        else:
            self.root.after(1200, lambda: self.say("I'm here, keeping an eye out. Right-click me any time.", seconds=4))
        self.root.after(1000, self._poll_notices)
        if demo:
            self.root.after(4000, self._demo)

    # ------------------------------------------------------------ drawing

    def _draw(self, now: float):
        c = self.canvas
        c.delete("all")
        t = now - self.t0
        mood = "sleep" if self.mood == "calm" and self._asleep(now) else self.mood
        fill, edge = MOODS[mood]
        bob = math.sin(t * (6 if mood == "danger" else 2)) * (5 if mood == "danger" else 3)
        if mood == "sleep":
            bob = math.sin(t * 0.8) * 2
        squash = 1 + math.sin(t * 2) * 0.03
        cx, cy = SIZE / 2, SIZE / 2 + 8 + bob
        rx, ry = 44 * squash, 40 / squash
        # soft glow, membrane and body
        c.create_oval(cx - rx - 6, cy - ry - 6, cx + rx + 6, cy + ry + 6, fill="", outline=fill, width=2,
                      dash=(3, 5) if mood != "danger" else ())
        c.create_oval(cx - rx, cy - ry, cx + rx, cy + ry, fill=fill, outline=edge, width=3)
        # floating organelles
        for ox, oy, ph in self.dots:
            dx = ox * rx + math.sin(t + ph) * 3
            dy = oy * ry + math.cos(t * 0.7 + ph) * 3
            c.create_oval(cx + dx - 3, cy + dy - 3, cx + dx + 3, cy + dy + 3, fill=edge, outline="")
        c.create_oval(cx - rx * 0.55, cy - ry * 0.75, cx - rx * 0.15, cy - ry * 0.45, fill="#ffffff", outline="",
                      stipple="gray50")
        # eyes follow the pointer
        px, py = self.root.winfo_pointerxy()
        ang = math.atan2(py - (self.y + cy), px - (self.x + cx))
        look = (math.cos(ang) * 3, math.sin(ang) * 3)
        closed = mood == "sleep" or now < self.blink_until
        for ex in (cx - 15, cx + 15):
            ey = cy - 6
            if closed:
                c.create_arc(ex - 8, ey - 5, ex + 8, ey + 7, start=200, extent=140, style="arc", outline="#14202b",
                             width=3)
            else:
                big = 10 if mood == "danger" else 9
                c.create_oval(ex - big, ey - big - 1, ex + big, ey + big + 1, fill="#ffffff", outline="#14202b", width=2)
                c.create_oval(ex + look[0] - 4, ey + look[1] - 4, ex + look[0] + 4, ey + look[1] + 4,
                              fill="#14202b", outline="")
                if mood == "danger":   # angry brows
                    side = -1 if ex < cx else 1
                    c.create_line(ex - 9 * side, ey - 15, ex + 7 * side, ey - 10, fill="#14202b", width=3)
        # mouth
        my = cy + 14
        if mood == "danger":
            c.create_oval(cx - 7, my - 5, cx + 7, my + 7, fill="#14202b", outline="")
        elif mood == "caution":
            c.create_line(cx - 8, my, cx + 8, my, fill="#14202b", width=3)
        elif mood == "sleep":
            c.create_oval(cx - 3, my - 2, cx + 3, my + 3, outline="#14202b", width=2)
            z = (t * 0.6) % 1
            c.create_text(cx + 34 + z * 10, cy - 34 - z * 20, text="z", font=(ui.FONTS["body"][0], int(10 + z * 6), "bold"),
                          fill="#d8f3ff")
        else:
            c.create_arc(cx - 9, my - 8, cx + 9, my + 5, start=200, extent=140, style="arc", outline="#14202b", width=3)
        if self.g.paused:
            c.create_text(cx, 10, text="paused", font=ui.FONTS["small"], fill="#c8d2e0")

    def _asleep(self, now: float) -> bool:
        return now - self.last_activity > 120 and not self.bubble

    # ------------------------------------------------------------ life

    def _tick(self):
        now = time.time()
        pointer = self.root.winfo_pointerxy()
        if pointer != self.last_pointer:
            self.last_pointer = pointer
            self.last_activity = now
        if now > self.next_blink:
            self.blink_until = now + 0.15
            self.next_blink = now + random.uniform(2.5, 6)
        if self.mood == "calm" and not self.bubble and not self.drag and now > self.next_wander:
            sw = self.root.winfo_screenwidth()
            self.target_x = int(min(max(20, self.x + random.choice((-1, 1)) * random.randint(60, 260)), sw - SIZE - 20))
            self.next_wander = now + random.uniform(25, 90)
        if self.mood == "calm" and not self.bubble and now > self.next_tip and not self._asleep(now):
            self.say(random.choice(IDLE_TIPS), seconds=9)
            self.next_tip = now + random.uniform(20 * 60, 40 * 60)
        if not self.drag:
            sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
            # Back on screen if the display changed (a monitor unplugged, a new resolution).
            self.floor = min(max(0, self.floor), sh - SIZE)
            self.x = min(max(0, self.x), sw - SIZE)
            self.target_x = min(max(0, self.target_x), sw - SIZE)
            if abs(self.target_x - self.x) > 1:
                self.x += int(max(-3, min(3, self.target_x - self.x)))
            jump = 0
            if now < self.jump_until:
                phase = (self.jump_until - now) % 0.5 / 0.5
                jump = int(math.sin(phase * math.pi) * 40)
            self.root.geometry(f"+{self.x}+{self.floor - jump}")
            self.y = self.floor - jump
        self._draw(now)
        self.root.after(33, self._tick)

    # ------------------------------------------------------------ mouse

    def _press(self, e):
        self.drag = (e.x_root, e.y_root, self.x, self.floor, False)

    def _move(self, e):
        if not self.drag:
            return
        sx, sy, ox, oy, _ = self.drag
        if abs(e.x_root - sx) + abs(e.y_root - sy) > 4:
            self.drag = (sx, sy, ox, oy, True)
            self.x, self.floor = ox + e.x_root - sx, oy + e.y_root - sy
            self.target_x = self.x
            self.root.geometry(f"+{self.x}+{self.floor}")
            self.y = self.floor
            if self.bubble:
                self._place_bubble()

    def _release(self, e):
        moved = self.drag and self.drag[4]
        self.drag = None
        self.last_activity = time.time()
        if not moved:
            if self.current:
                self.alert(self.current)
            else:
                c = self.g.counts
                self.say(f"All quiet. I've checked {c['checked']} things and warned you {c['warned']} "
                         f"time{'s' if c['warned'] != 1 else ''} so far.", seconds=5)

    def _menu(self, e):
        m = tk.Menu(self.root, tearoff=0)
        m.add_command(label="Check a link…", command=self._ask_link)
        if self.g.paused:
            m.add_command(label="Resume watching", command=lambda: self._pause(0))
        else:
            m.add_command(label="Pause for 1 hour", command=lambda: self._pause(3600))
        m.add_command(label=("Stop" if self.g.policy.clipboard_watch else "Start") + " watching copied links",
                      command=self._toggle_clipboard)
        m.add_command(label="Pair the browser extension…", command=self._pair)
        m.add_command(label="Settings…", command=lambda: settings.open_window(self.root, self.g))
        m.add_separator()
        m.add_command(label="About Omnicyte", command=lambda: webbrowser.open(policy_mod.WEBSITE))
        m.add_command(label="Quit", command=self.root.destroy)
        m.tk_popup(e.x_root, e.y_root)

    def _welcome(self):
        self.say("All set! I'll keep an eye on your mail, chats and browser, and shout if something looks "
                 "phishy. Drag me anywhere; right-click me for options.", seconds=9)

    def _on_error(self, exc, value, tb):
        """A bug in one alert or animation must never take the buddy down."""
        LOG.error("unexpected error", exc_info=(exc, value, tb))

    def _poll_notices(self):
        try:
            while True:
                self.say(self.g.notices.get_nowait(), seconds=4)
        except queue.Empty:
            pass
        self.root.after(500, self._poll_notices)

    def _pause(self, seconds: int):
        policy_mod.save_user(paused_until=time.time() + seconds if seconds else 0)
        self.g.reload()
        self.say("OK, I'm taking a break for an hour." if seconds else "I'm back on watch.", seconds=4, force=True)

    def _toggle_clipboard(self):
        policy_mod.save_user(clipboard_watch=not self.g.policy.clipboard_watch)
        self.g.reload()

    def _ask_link(self):
        link = simpledialog.askstring("Omnicyte", "Paste a link or a message to check:", parent=self.root)
        if not link:
            return
        v = self.g.see(engine.Message(source="manual", text=link if "://" in link or " " in link else "https://" + link),
                       alert=False)
        if v.level == "safe":
            self.say("That one looks fine to me. Still, only open links you were expecting.", seconds=6, force=True)
        else:
            self.alert(v)

    def _pair(self):
        self.say("Paste this pairing code into the Omnicyte browser extension:", seconds=60,
                 extra=("Copy code", lambda: self._copy(policy_mod.token())), code=policy_mod.token(), force=True)

    def _copy(self, text: str):
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.clip_last = text
        self._close_bubble()

    # ------------------------------------------------------------ watchers

    def _poll_alerts(self):
        try:
            while True:
                v = self.g.alerts.get_nowait()
                self.alert(v)
        except Exception:
            pass
        self.root.after(250, self._poll_alerts)

    def _poll_clipboard(self):
        if self.g.policy.clipboard_watch and not self.g.paused:
            try:
                text = self.root.clipboard_get()
            except tk.TclError:
                text = ""
            if text and text != self.clip_last:
                self.clip_last = text
                found = urls.find_links(text[:20000])
                if found:
                    # Only the links are looked at, never the rest of what was copied.
                    self.g.see(engine.Message(source="clipboard", text="\n".join(found[:20]), where="copied link"))
        self.root.after(1500, self._poll_clipboard)

    def _demo(self):
        self.g.see(engine.Message(
            source="mail", sender_name="Microsoft 365 Admin", sender_address="admin@micros0ft-support.top",
            subject="Action required: your password expires today",
            text="Your password will expire within 24 hours. Keep your same password by verifying your account below.",
            links=[("https://micros0ft-support.top/login?user=you", "https://portal.office.com")],
            where="Inbox (demo)"))

    # ------------------------------------------------------------ talking

    def alert(self, v: engine.Verdict):
        self.current = v
        self.mood = v.level if v.level in MOODS else "caution"
        self.jump_until = time.time() + (1.5 if v.level == "danger" else 0.5)
        self.last_activity = time.time()
        self._open_bubble(self._alert_body(v))
        try:
            self.root.bell()
        except tk.TclError:
            pass

    def say(self, text: str, seconds: int = 6, extra=None, code: str = "", force: bool = False):
        # Chatter (tips, hellos) never covers a warning the person hasn't dealt with yet.
        if self.current and self.bubble and not force:
            return
        def body(frame, colors):
            tk.Label(frame, text=text, font=ui.FONTS["body"], fg=colors["fg"], bg=colors["bg"], wraplength=280,
                     justify="left").pack(anchor="w")
            if code:
                tk.Label(frame, text=code, font=ui.FONTS["mono"], fg=colors["fg"], bg=colors["card"],
                         padx=6, pady=4).pack(anchor="w", pady=(8, 0), fill="x")
            if extra:
                self._button(frame, extra[0], extra[1], colors, primary=True).pack(anchor="e", pady=(8, 0))
        self._open_bubble(body)
        if seconds:
            bubble = self.bubble
            self.root.after(seconds * 1000, lambda: bubble is self.bubble and self._close_bubble())

    def _alert_body(self, v: engine.Verdict):
        def body(frame, colors):
            accent = {"danger": "#ff8095", "caution": "#ffd27a"}.get(v.level, "#7ee8dc")
            tk.Label(frame, text=("⚠  " if v.level == "danger" else "")+v.headline, font=ui.FONTS["bold"], fg=accent,
                     bg=colors["bg"], wraplength=300, justify="left").pack(anchor="w")
            context = []
            if v.sender:
                context.append(f"From: {v.sender}")
            if v.subject:
                context.append(f"Subject: {v.subject[:70]}")
            if v.where:
                context.append(f"Seen in: {v.where}")
            dest = next((link.destination for link in v.links if link.url == v.worst_link), "")
            if dest:
                context.append(f"Link really goes to: {urls.decode_host(urls.host_of(dest))}")
            if context:
                tk.Label(frame, text="\n".join(context), font=ui.FONTS["small"], fg=colors["muted"], bg=colors["bg"],
                         wraplength=300, justify="left").pack(anchor="w", pady=(4, 6))
            tk.Label(frame, text="Why I think so:", font=ui.FONTS["small_bold"], fg=colors["fg"],
                     bg=colors["bg"]).pack(anchor="w")
            seen = set()
            for s in v.signals:
                if s.title in seen or len(seen) >= 5:
                    continue
                seen.add(s.title)
                row = tk.Frame(frame, bg=colors["bg"])
                row.pack(anchor="w", fill="x", pady=1)
                tk.Label(row, text="•", font=ui.FONTS["body"], fg=accent, bg=colors["bg"]).pack(side="left", anchor="n")
                tk.Label(row, text=s.title, font=ui.FONTS["small"], fg=colors["fg"], bg=colors["bg"], wraplength=285,
                         justify="left").pack(side="left", anchor="w")
            top = next((s for s in v.signals if TIPS.get(s.code)), None)
            if top:
                tk.Label(frame, text="Spot it next time: " + top.tip, font=ui.FONTS["small"], fg=colors["fg"], bg=colors["card"],
                         wraplength=290, justify="left", padx=8, pady=6).pack(anchor="w", fill="x", pady=(8, 4))
            buttons = tk.Frame(frame, bg=colors["bg"])
            buttons.pack(anchor="e", pady=(6, 0))
            if self.g.policy.report_to:
                self._button(buttons, "Report to security", lambda: self._report(v), colors).pack(side="left", padx=3)
            host = urls.host_of(dest) if dest else ""
            if host and self.g.policy.allow_user_trust and v.level != "danger":
                self._button(buttons, "I trust this site", lambda: self._trust(v, host), colors).pack(side="left", padx=3)
            self._button(buttons, "Got it, thanks", lambda: self._dismiss(v), colors, primary=True).pack(side="left", padx=3)
        return body

    def _report(self, v: engine.Verdict):
        self.g.note(v, "reported")
        lines = [f"Omnicyte warned me about this ({v.level}, score {v.score}).", "",
                 f"Where: {v.source} {v.where}".strip()]
        if v.sender:
            lines.append(f"From: {v.sender}")
        if v.subject:
            lines.append(f"Subject: {v.subject}")
        if v.worst_link:
            lines.append(f"Link (do not open): {v.worst_link.replace('http', 'hxxp', 1)}")
        lines += ["", "Signals:"] + [f"- {s.title}" for s in v.signals[:8]]
        url = f"mailto:{self.g.policy.report_to}?subject={quote('Suspected phishing: ' + (v.subject or v.where or v.source))}" \
              f"&body={quote(chr(10).join(lines))}"
        webbrowser.open(url)
        self._calm("Thanks for reporting! That really helps the security team.")

    def _trust(self, v, host):
        policy_mod.trust_domain(urls.registrable(host))
        self.g.reload()
        self.g.note(v, "trusted")
        self._calm(f"OK, I'll trust {urls.registrable(host)} from now on.")

    def _dismiss(self, v):
        self.g.note(v, "dismissed")
        self._calm("Nice catch. Stay sharp!")

    def _calm(self, text: str):
        self.current = None
        self.mood = "calm"
        self.say(text, seconds=4)

    # ------------------------------------------------------------ the bubble window

    def _open_bubble(self, fill):
        self._close_bubble()
        colors = ui.COLORS
        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.attributes("-topmost", True)
        win.configure(bg=colors["edge"])
        inner = tk.Frame(win, bg=colors["bg"], padx=14, pady=12)
        inner.pack(padx=1, pady=1)
        head = tk.Frame(inner, bg=colors["bg"])
        head.pack(fill="x")
        tk.Label(head, text="Omnicyte", font=ui.FONTS["tiny"], fg=colors["muted"], bg=colors["bg"]).pack(side="left")
        close = tk.Label(head, text="✕", font=ui.FONTS["small"], fg=colors["muted"], bg=colors["bg"], cursor="hand2")
        close.pack(side="right")
        close.bind("<Button-1>", lambda e: self._close_bubble(user=True))
        body = tk.Frame(inner, bg=colors["bg"])
        body.pack(fill="x", pady=(4, 0))
        fill(body, colors)
        self.bubble = win
        win.update_idletasks()
        self._place_bubble()

    def _place_bubble(self):
        win = self.bubble
        if not win:
            return
        w, h = win.winfo_reqwidth(), win.winfo_reqheight()
        sw = self.root.winfo_screenwidth()
        bx = min(max(10, self.x + SIZE // 2 - w // 2), sw - w - 10)
        by = max(10, self.floor - h - 6)
        win.geometry(f"+{bx}+{by}")

    def _close_bubble(self, user: bool = False):
        if self.bubble:
            self.bubble.destroy()
            self.bubble = None
        if user and self.current:
            self._dismiss(self.current)

    @staticmethod
    def _button(parent, text, command, colors, primary=False):
        return ui.button(parent, text, command, primary=primary)

    def run(self):
        self.root.mainloop()
