"""Starting Omnicyte when the person logs in, on Windows, macOS and Linux.

Each system's own per-user way is used, so nothing needs an administrator:
- Windows: a value under HKEY_CURRENT_USER\\...\\CurrentVersion\\Run
- macOS:   a LaunchAgent in ~/Library/LaunchAgents
- Linux:   a .desktop file in ~/.config/autostart (the XDG standard)
"""

import os
import platform
import plistlib
import shlex
import sys
from pathlib import Path

NAME = "Omnicyte"
LABEL = "com.mtrxhorizyn.omnicyte"
_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def command() -> list[str]:
    """How to start this copy of Omnicyte without a terminal window."""
    if getattr(sys, "frozen", False):
        return [sys.executable]
    launcher = str(Path(__file__).resolve().parents[1] / "launch.py")
    exe = sys.executable
    if platform.system() == "Windows":
        windowless = Path(exe).with_name("pythonw.exe")
        exe = str(windowless) if windowless.exists() else exe
    return [exe, launcher]


def _mac_plist() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def _linux_desktop() -> Path:
    base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return base / "autostart" / "omnicyte.desktop"


def is_enabled() -> bool:
    system = platform.system()
    if system == "Windows":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
                winreg.QueryValueEx(key, NAME)
            return True
        except OSError:
            return False
    if system == "Darwin":
        return _mac_plist().is_file()
    return _linux_desktop().is_file()


def enable() -> None:
    cmd = command()
    system = platform.system()
    if system == "Windows":
        import winreg
        value = " ".join(f'"{c}"' for c in cmd)
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
            winreg.SetValueEx(key, NAME, 0, winreg.REG_SZ, value)
    elif system == "Darwin":
        path = _mac_plist()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as f:
            plistlib.dump({"Label": LABEL, "ProgramArguments": cmd, "RunAtLoad": True,
                           "ProcessType": "Interactive", "LimitLoadToSessionType": "Aqua"}, f)
    else:
        path = _linux_desktop()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("[Desktop Entry]\nType=Application\nName=Omnicyte\n"
                        "Comment=Your phishing buddy\n"
                        f"Exec={shlex.join(cmd)}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n",
                        encoding="utf-8")


def disable() -> None:
    system = platform.system()
    if system == "Windows":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
                winreg.DeleteValue(key, NAME)
        except OSError:
            pass
    elif system == "Darwin":
        _mac_plist().unlink(missing_ok=True)
    else:
        _linux_desktop().unlink(missing_ok=True)


def set_enabled(on: bool) -> bool:
    """Turn it on or off; returns whether it is on afterwards."""
    try:
        enable() if on else disable()
    except OSError:
        pass
    return is_enabled()
