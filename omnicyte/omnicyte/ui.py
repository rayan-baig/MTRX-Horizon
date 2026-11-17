"""How Omnicyte's windows look and feel on each system."""

import base64
import platform
import tkinter as tk
from tkinter import font as tkfont

from .icon import png_bytes

COLORS = {"bg": "#1b1f2b", "fg": "#eef2f8", "muted": "#9aa6b8", "card": "#262c3c", "edge": "#3a4256",
          "accent": "#3ad6c5", "accent_fg": "#0d1a1f", "danger": "#ff8095", "caution": "#ffd27a"}
FONTS = {}


def sharp_text() -> None:
    """On Windows, tell the system we draw for high-resolution screens
    ourselves, so text isn't stretched and blurry. Call before tk.Tk()."""
    if platform.system() != "Windows":
        return
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except (AttributeError, OSError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            pass


def setup_fonts(root: tk.Misc) -> dict:
    """The system's own interface font (Segoe UI, San Francisco, Cantarell…) in our sizes."""
    family = tkfont.nametofont("TkDefaultFont", root).actual("family")
    mac = platform.system() == "Darwin"
    base = 13 if mac else 10
    FONTS.update({
        "body": (family, base), "bold": (family, base + 1, "bold"), "small": (family, base - 1),
        "small_bold": (family, base - 1, "bold"), "tiny": (family, base - 2, "bold"),
        "title": (family, base + 6, "bold"), "mono": ("Menlo" if mac else "Consolas", base),
    })
    return FONTS


def app_icon(root: tk.Misc) -> tk.PhotoImage:
    img = tk.PhotoImage(master=root, data=base64.b64encode(png_bytes(64)).decode())
    try:
        root.iconphoto(True, img)
    except tk.TclError:
        pass
    return img


def button(parent, text, command, primary=False, width=None):
    """A flat button that looks the same on every system (Tk's own buttons
    ignore colours on macOS)."""
    c = COLORS
    b = tk.Label(parent, text=text, font=FONTS.get("small_bold"), cursor="hand2", padx=12, pady=6,
                 fg=c["accent_fg"] if primary else c["fg"], bg=c["accent"] if primary else c["card"], width=width)
    b.bind("<Button-1>", lambda e: command())
    b.bind("<Enter>", lambda e: b.configure(bg="#5be3d5" if primary else c["edge"]))
    b.bind("<Leave>", lambda e: b.configure(bg=c["accent"] if primary else c["card"]))
    return b
