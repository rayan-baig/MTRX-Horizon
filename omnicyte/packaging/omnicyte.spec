# PyInstaller recipe for the Omnicyte app. Run from the omnicyte folder:
#   python tools/make_icon.py packaging/icon.png 512
#   pyinstaller packaging/omnicyte.spec --noconfirm
# Makes dist/Omnicyte.exe (Windows), dist/Omnicyte.app (macOS) or dist/Omnicyte (Linux).
import sys
from pathlib import Path

sys.path.insert(0, str(Path(SPECPATH).parent))
from omnicyte import __version__  # noqa: E402

ROOT = Path(SPECPATH).parent
ICON = str(ROOT / "packaging" / "icon.png")   # PyInstaller turns it into .ico / .icns (needs Pillow)

a = Analysis(
    [str(ROOT / "launch.py")],
    pathex=[str(ROOT)],
    hiddenimports=["omnicyte.buddy", "omnicyte.settings", "omnicyte.ui", "omnicyte.autostart"],
    excludes=["pytest", "pydoc", "doctest", "lib2to3", "pdb", "test", "distutils", "setuptools", "pip"],
    noarchive=False,
)
pyz = PYZ(a.pure)

if sys.platform == "darwin":
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="Omnicyte", console=False, icon=ICON,
              argv_emulation=False, upx=False)
    coll = COLLECT(exe, a.binaries, a.datas, name="Omnicyte", upx=False)
    app = BUNDLE(
        coll, name="Omnicyte.app", icon=ICON, bundle_identifier="com.mtrxhorizyn.omnicyte",
        version=__version__,
        info_plist={
            "CFBundleName": "Omnicyte", "CFBundleDisplayName": "Omnicyte",
            "CFBundleShortVersionString": __version__, "CFBundleVersion": __version__,
            "LSUIElement": True,                 # no Dock icon: the buddy is the app
            "NSHighResolutionCapable": True,
            "LSMinimumSystemVersion": "11.0",
            "NSHumanReadableCopyright": "MTRX Horizyn",
        },
    )
else:
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name="Omnicyte", console=False, icon=ICON,
              upx=False, version=None)
