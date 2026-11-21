"""Prepares the owner's pose sheet for Pilot for Mac (1.3 and later).

    python3 tools/poses.py --poses path/to/named/ [--props path/to/props/]

Needs Pillow, NumPy and OpenCV (a developer tool; the app never runs it). Each
<pose>.png (cut out, transparent) becomes assets/poses/<pose>.webp:

- scaled so the standing robot's halo is HALO pixels wide, and every other
  picture so its head comes out the same size (the sheet isn't drawn at one
  scale: a picture's head is measured by its dark visor, the larger of its
  height and its width scaled to a face-on visor, since a turned head is
  narrower and a tilted one shorter; SET_FIX corrects by eye), then lightly
  sharpened;
- centred on the visor (the face), so moving between poses never makes the
  head jump sideways;
- its lowest point on one baseline;
- on the shared canvas (300 x 340), or the big one (600 x 400) when a
  picture's props reach further out or up (tricks.css sizes those boxes);
- WebP with alpha, small.

Pictures are never mirrored. Props (--props) become assets/props/<prop>.webp,
scaled with the same factor, trimmed to what's there.
"""

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
CANVAS = (300, 340)
WIDE = (600, 400)  # baseline 4 px above its bottom too
HALO = 160
BASELINE = 336
# Rows (fractions of the picture's height) to look for the halo in, where
# the default top 30% would catch something else.
HALO_ROWS = {"hang": (0.1, 0.35), "sitting": (0, 0.3), "laptop": (0, 0.35), "sled": (0, 0.4), "snowman": (0.05, 0.4),
             "kite": (0, 0.35), "pumpkin": (0, 0.3)}
# Upside down (or a whirl around him): centred on the body.
BODY_CENTRE = {"flip", "cartwheel", "spin", "teleport"}
# Drawn at the standing robot's scale (upright, the same height on the sheet).
SAME_SCALE = {"standing", "walk1", "walk2", "wave", "run1", "run2", "fly"}
# By eye, after the visor measure (1.0: as measured).
SET_FIX = {"heart-eyes": 1.1, "yawn": 1.1, "sitting": 1.08, "meditate": 1.07, "ski": 0.9}
FIXED = {"flip": 1.05, "cartwheel": 1.18, "spin": 1.18}  # no usable visor: relative to standing
RENAME = {"skateboard": "trampoline", "shrug": "shy"}


def opaque_box(a, th=128):
    ys, xs = np.where(a > th)
    return xs.min(), ys.min(), xs.max(), ys.max()


def halo_centre(img, name):
    px = np.asarray(img.convert("RGBA")).astype(int)
    r, g, b, a = (px[:, :, i] for i in range(4))
    x0, y0, x1, y1 = opaque_box(a)
    if name in BODY_CENTRE:
        return (x0 + x1) / 2, None
    lo, hi = HALO_ROWS.get(name, (0, 0.3))
    h = px.shape[0]
    sat = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    mask = (a > 100) & (sat > 90) & (b > 150)
    rows = range(int(h * lo), max(int(h * lo) + 1, int(h * hi)))
    best = None
    for y in rows:
        xs = np.where(mask[y])[0]
        if len(xs) and (best is None or xs.max() - xs.min() > best[1] - best[0]):
            best = (xs.min(), xs.max())
    if best is None:
        return (x0 + x1) / 2, None
    return (best[0] + best[1]) / 2, best[1] - best[0]


def visor(img):
    """The face: the biggest very dark patch. (x centre, size measure)."""
    px = np.asarray(img.convert("RGBA")).astype(int)
    r, g, b, a = (px[:, :, i] for i in range(4))
    m = ((a > 150) & (np.maximum(np.maximum(r, g), b) < 60)).astype(np.uint8)
    k, _, st, _ = cv2.connectedComponentsWithStats(m, 4)
    i = max(range(1, k), key=lambda j: st[j, 4])
    x, y, w, h = st[i, 0], st[i, 1], st[i, 2], st[i, 3]
    return x + w / 2, max(h, w * 34 / 47)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--poses", required=True)
    ap.add_argument("--props")
    ap.add_argument("--out", default=str(ROOT / "assets"))
    o = ap.parse_args()
    src = Path(o.poses)
    out = Path(o.out)
    (out / "poses").mkdir(parents=True, exist_ok=True)
    stand = Image.open(src / "standing.png")
    _, halo_w = halo_centre(stand, "standing")
    scale = HALO / halo_w
    group = [visor(Image.open(src / f"{n}.png"))[1] for n in sorted(SAME_SCALE)]
    head = sum(group) / len(group)
    wide = []
    for f in sorted(src.glob("*.png")):
        name = RENAME.get(f.stem, f.stem)
        img = Image.open(f).convert("RGBA")
        vx, size = visor(img)
        if name in SAME_SCALE:
            rel = 1.0
        elif name == "sitting":
            rel = head / size * SET_FIX["sitting"]
        elif name in FIXED:
            rel = FIXED[name]
        else:
            rel = min(1.7, max(0.85, head / size)) * SET_FIX.get(name, 1.0)
        cx = (halo_centre(img, f.stem)[0] + vx) / 2 if name in BODY_CENTRE else vx
        k = scale * rel
        big = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
        big = big.filter(ImageFilter.UnsharpMask(radius=1.2, percent=55, threshold=2))
        a = np.asarray(big)[:, :, 3]
        x0, y0, x1, y1 = opaque_box(a)
        c = cx * k
        reach = max(c - x0, x1 - c)
        size = CANVAS if reach <= CANVAS[0] / 2 - 2 else WIDE
        if size == WIDE:
            wide.append(name)
        if size == CANVAS and y0 + BASELINE - y1 < 0:
            size = WIDE
            wide.append(name)
        base = size[1] - 4
        canvas = Image.new("RGBA", size, (0, 0, 0, 0))
        if y0 + base - y1 < 0:
            print(f"{name}: taller than the canvas")
        canvas.alpha_composite(big, (round(size[0] / 2 - c), round(base - y1)), (0, 0))
        canvas.save(out / "poses" / f"{name}.webp", "WEBP", quality=84, method=4)
        print(f"{name:14s} {size[0]}x{size[1]} x{rel:.2f} reach {reach:.0f}{'  TOO WIDE' if reach > WIDE[0] / 2 else ''}")
    print("wide:", " ".join(wide))
    if o.props:
        (out / "props").mkdir(parents=True, exist_ok=True)
        for f in sorted(Path(o.props).glob("*.png")):
            img = Image.open(f).convert("RGBA")
            if f.stem == "crown":
                # The crop has a small "zzz" beside the crown: keep the biggest piece only.
                px = np.asarray(img).astype(int)
                a = ((px[:, :, 3] > 40) & (px[:, :, 0] > px[:, :, 2])).astype(np.uint8)  # gold, not the blue z
                n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(a, np.ones((3, 3), np.uint8)), 8)
                i = max(range(1, n), key=lambda j: st[j, 4])
                x, y, w, h = st[i, :4]
                keep = np.asarray(img).copy()
                keep[lab != i] = 0
                img = Image.fromarray(keep).crop((x, y, x + w, y + h))
            big = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
            big = big.filter(ImageFilter.UnsharpMask(radius=1.2, percent=55, threshold=2))
            big = big.crop(big.getbbox())
            big.save(out / "props" / f"{f.stem}.webp", "WEBP", quality=84, method=4)
            print(f"prop {f.stem:12s} {big.width}x{big.height}")


if __name__ == "__main__":
    main()
