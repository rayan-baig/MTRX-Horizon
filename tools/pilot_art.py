"""Prepares Pilot's robot pictures for the moving robot (Pilot core 1.1.0).

Run it again when the owner sends new art:

    python3 tools/pilot_art.py --design path/to/pilot-robot.png --poses path/to/poses/

It needs Pillow, NumPy and OpenCV (a developer tool; the site and the apps
never run it). It writes:

  The resting robot, the owner's design picture, cut into three layers that
  stack exactly into the original (same canvas, transparent):
    *-rest-body.webp  everything below the neck, with a dark neck behind the
                      head so a head tilt never shows a gap;
    *-rest-head.webp  the halo, headphones and visor (eyes painted out), cut
                      along the curve where the head meets the shoulders,
                      with a few pixels of overlap;
    *-rest-eyes.webp  just the two glowing eyes, so they can blink and look.
  The web copies also come at 112 and 168 pixels wide (pilot-rest-*-112.webp,
  -168.webp, core 1.4.1): a phone's 56 px robot at 2x and 3x, so it is drawn
  at the file's own size (crisp). The still robot's sizes (pilot-robot-112,
  -168 and -176.webp) are made the same way from pilot-desktop/assets/
  robot-512.png (see still_sizes).

  The pose pictures (any of the names in POSES), scaled together so the
  robot's halo and head are the same size in every pose (the set is drawn at
  one scale; the standing robot's halo sets it), each centred on its halo,
  with the bottom of the robot on one baseline, on one shared canvas. Moving
  between poses then never changes the robot's size or makes it jump. A new
  set replaces the old pictures.

Desktop copies go to pilot-desktop/assets/ (poses in assets/poses/) and web
copies, a little smaller, to static/pilot/ (poses in static/pilot/poses/).
"""

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
POSES = ("standing", "sitting", "wave", "walk1", "walk2", "run1", "run2", "fly", "climb1", "climb2", "flip", "throw", "kick",
         "tennis", "celebrate", "slide", "point", "power", "dash", "love", "land", "arms-crossed")

# Where the halo is in each pose picture (rows to search), so arms and glowing
# knees are not mistaken for it. A pose not listed is searched in its top 30%.
HALO_ROWS = {"standing": (0, 0.2), "wave": (0, 0.2), "walk1": (0, 0.2), "walk2": (0, 0.2), "run1": (0, 0.22),
             "run2": (0, 0.22), "fly": (0, 0.2), "climb1": (0, 0.25), "climb2": (0, 0.25), "flip": (0.4, 0.78),
             "sitting": (0.1, 0.42), "throw": (0, 0.26), "kick": (0, 0.24), "tennis": (0, 0.26), "celebrate": (0.02, 0.24),
             "slide": (0.18, 0.46), "point": (0.04, 0.27), "power": (0.06, 0.25), "love": (0.14, 0.4), "land": (0.24, 0.47),
             "arms-crossed": (0, 0.22)}

# The owner's pose sheets are drawn at one scale, so a whole set is scaled
# once, from the standing robot's halo (raised arms, hearts, a ball or an
# energy ball next to the head would throw off a picture-by-picture
# measure). SET_FIX nudges single pictures whose head is drawn a little
# bigger or smaller than the standing robot's (checked by eye in a strip).
SET_FIX = {"kick": 1.06, "love": 1.05, "arms-crossed": 1.06, "celebrate": 0.95, "point": 0.96, "land": 0.95}

# The shared pose canvas, in pixels: the halo is HALO wide, its centre is on
# the canvas's middle column, and the robot's lowest point is on BASELINE.
CANVAS = (300, 340)
HALO = 160
BASELINE = 336

# Where the design robot's head meets its shoulders, in the 644 x 622 master.
NECK = [(0, 300), (150, 302), (185, 309), (205, 318), (240, 327), (300, 334), (380, 336), (440, 333), (480, 325),
        (500, 314), (520, 302), (644, 296)]
# The two eyes, in the master: boxes that hold each glowing arc and its glow.
EYES = [(232, 160, 360, 245), (400, 160, 515, 245)]


def halo(rgba: np.ndarray, rows: tuple) -> tuple:
    """The halo's widest span (rotation-proof) and its centre."""
    im = rgba.astype(float) / 255
    r, g, b, a = (im[:, :, i] for i in range(4))
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn + 1e-6
    sat = (mx - mn) / (mx + 1e-6)
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    mask = (a > 0.5) & (mx > 0.55) & (sat > 0.35) & (hue > 175) & (hue < 300)
    h = rgba.shape[0]
    mask[: int(rows[0] * h)] = False
    mask[int(rows[1] * h):] = False
    ys, xs = np.nonzero(mask)
    pts = np.stack([xs, ys], 1).astype(float)
    best, centre = 0.0, (xs.mean(), ys.mean())
    for ang in np.linspace(0, np.pi, 180, endpoint=False):
        v = pts @ np.array([np.cos(ang), np.sin(ang)])
        if v.max() - v.min() > best:
            best = v.max() - v.min()
            lo, hi = pts[v.argmin()], pts[v.argmax()]
            centre = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
    return best, centre


def normalise_pose(path: Path, name: str, set_scale: float) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    rgba = np.array(img)
    _width, (cx, _cy) = halo(rgba, HALO_ROWS.get(name, (0, 0.3)))
    scale = set_scale * SET_FIX.get(name, 1.0)
    alpha = rgba[:, :, 3] > 24
    bottom = np.nonzero(alpha.any(1))[0][-1]
    big = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    canvas.alpha_composite(big, (round(CANVAS[0] / 2 - cx * scale), round(BASELINE - bottom * scale)))
    return canvas


def neck_curve(width: int) -> np.ndarray:
    xs, ys = zip(*NECK)
    return np.interp(np.arange(width), xs, ys)


def split_design(path: Path) -> dict:
    img = np.array(Image.open(path).convert("RGBA")).astype(float)
    h, w = img.shape[:2]
    curve = neck_curve(w)
    rows = np.arange(h)[:, None]
    # Head: above the neck curve, fading out over 3 pixels just below it.
    head_a = np.clip((curve[None, :] + 4 - rows) / 3, 0, 1)
    # Body: below the curve, starting a few pixels above it (the head covers that).
    body_a = np.clip((rows - (curve[None, :] - 6)) / 2, 0, 1)

    # Paint the eyes out of the head: fill each eye with the visor around it.
    eye_mask = np.zeros((h, w), np.uint8)
    rgb = img[:, :, :3]
    lum = rgb.mean(2)
    for x0, y0, x1, y1 in EYES:
        box = lum[y0:y1, x0:x1]
        eye_mask[y0:y1, x0:x1] = (box > 42).astype(np.uint8)
    eye_mask = cv2.dilate(eye_mask, np.ones((5, 5), np.uint8), iterations=2)
    bgr = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2BGR)
    filled = cv2.cvtColor(cv2.inpaint(bgr, eye_mask * 255, 9, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB).astype(float)
    filled = cv2.GaussianBlur(filled, (0, 0), 2.0) * (eye_mask[:, :, None] > 0) + rgb * (eye_mask[:, :, None] == 0)

    # The eyes on their own: how much brighter than the painted-out visor each
    # pixel is becomes its opacity, and its colour is what composites back to
    # the original over that visor.
    diff = np.clip(rgb - filled, 0, None)
    eye_alpha = np.clip(diff.max(2) / np.maximum(255 - filled.max(2), 1), 0, 1) * (eye_mask > 0)
    eye_alpha = cv2.GaussianBlur(eye_alpha, (0, 0), 0.6) * (eye_mask > 0)
    safe = np.maximum(eye_alpha, 1e-3)[:, :, None]
    eye_rgb = np.clip((rgb - filled * (1 - eye_alpha[:, :, None])) / safe, 0, 255)

    head = np.dstack([filled, img[:, :, 3] * head_a])
    eyes = np.dstack([eye_rgb, 255 * eye_alpha])

    # A dark neck behind the head, so tilting the head never shows a gap.
    body_rgb = rgb.copy()
    neck = np.zeros((h, w), float)
    cv2.ellipse(neck, (340, 318), (128, 30), 0, 0, 360, 1.0, -1)
    neck = cv2.GaussianBlur(neck, (0, 0), 4)
    neck_colour = np.array([8, 11, 34], float)
    body_alpha = img[:, :, 3] * body_a / 255
    out_a = np.maximum(body_alpha, neck)
    body_rgb = (rgb * body_alpha[:, :, None] + neck_colour * (neck * (1 - body_alpha))[:, :, None]) / np.maximum(out_a, 1e-3)[:, :, None]
    body = np.dstack([body_rgb, 255 * out_a])
    to = lambda a: Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")  # noqa: E731
    return {"body": to(body), "head": to(head), "eyes": to(eyes)}


# The phone's 56 px robot at 2x and 3x (core 1.4.1); the still robot also at
# a computer's 88 px at 2x.
REST_SIZES = (112, 168)
STILL_SIZES = (112, 168, 176)


def still_sizes() -> None:
    """The still robot (no motion) in the sizes it is drawn at, from the 512 px design."""
    src = Image.open(ROOT / "pilot-desktop/assets/robot-512.png").convert("RGBA")
    for w in STILL_SIZES:
        save_webp(src.resize((w, round(w * src.height / src.width)), Image.LANCZOS), ROOT / f"static/pilot/pilot-robot-{w}.webp")


def save_webp(img: Image.Image, path: Path, quality: int = 88) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=quality, method=6, exact=False)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--design", required=True, type=Path, help="the owner's design robot, transparent PNG")
    ap.add_argument("--poses", type=Path, help="a folder of pose PNGs named after the poses")
    args = ap.parse_args()

    layers = split_design(args.design)
    desk = ROOT / "pilot-desktop/assets"
    web = ROOT / "static/pilot"
    for part, img in layers.items():
        save_webp(img.resize((330, round(330 * img.height / img.width)), Image.LANCZOS), desk / f"robot-rest-{part}.webp")
        save_webp(img.resize((192, round(192 * img.height / img.width)), Image.LANCZOS), web / f"pilot-rest-{part}.webp", 86)
        for w in REST_SIZES:
            save_webp(img.resize((w, round(w * img.height / img.width)), Image.LANCZOS), web / f"pilot-rest-{part}-{w}.webp", 86)
    still_sizes()

    if args.poses:
        # A new set replaces the old one.
        for folder in (desk / "poses", web / "poses"):
            for old in folder.glob("*.webp"):
                old.unlink()
        ref = np.array(Image.open(args.poses / "standing.png").convert("RGBA"))
        set_scale = HALO / halo(ref, HALO_ROWS["standing"])[0]
        for name in POSES:
            src = args.poses / f"{name}.png"
            if not src.exists():
                continue
            canvas = normalise_pose(src, name, set_scale)
            save_webp(canvas, desk / "poses" / f"{name}.webp", 86)
            save_webp(canvas.resize((240, 272), Image.LANCZOS), web / "poses" / f"{name}.webp", 84)
            print("pose", name)


if __name__ == "__main__":
    main()
