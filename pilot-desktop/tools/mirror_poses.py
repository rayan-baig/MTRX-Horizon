"""Makes the left-facing pictures for Pilot for Mac (1.5 and later; a
developer tool, the app never runs it). Needs Pillow, NumPy and OpenCV.

    python3 tools/mirror_poses.py

The owner's walk, run and climb pictures all face the viewer's right. Pilot
1.4 never mirrored a picture (the P on the chest would read backwards), so
going left he skipped sideways facing the camera, which looked odd. Here each
of those pictures is mirrored, and then:

- the P on the chest is put back the right way round. 1.5.1: the mirrored P
  is first wiped off the chest panel (in 1.5.0 an arc of it was left showing
  beside the new P, and a stray mark on walk2-left), then the original P is
  laid on the clean panel exactly where the mirrored one was;
- the halo keeps its colours the same way round as in every other picture
  (pink on the viewer's left, cyan on the right). Mirroring swapped them, so
  his halo changed colour sides each time he turned round.

Every walkN, runN and climbN picture in assets/poses/ is done (so a 4-picture
walk cycle, walk1 to walk4, and climb2 get their left-facing copies too):

    walk1, walk2, ... -> walk1-left, walk2-left, ...
    run1, run2, ...   -> run1-left, run2-left, ...
    climb1, climb2    -> climb1-left, climb2-left   (side-on: no P in view)

Run it again whenever those pictures change or new ones are added. It also
prints each picture's planted foot (FEET in src/core/roam.js), measured from
the picture: copy any new numbers there.
"""

import re
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
POSES = ROOT / "assets" / "poses"
# Where to look for the P on the chest (300 x 340 canvas: left, top, right,
# bottom). A new picture without an entry is searched for it on the chest.
P_BOX = {
    "walk1": (151, 154, 172, 182),
    "walk2": (149, 161, 169, 184),
    "run1": (157, 158, 177, 182),
    "run2": (157, 152, 179, 180),
}
SOURCE = re.compile(r"^(walk|run|climb)\d+$")


def sources():
    return sorted(p.stem for p in POSES.glob("*.webp") if SOURCE.match(p.stem))


def hsv(px):
    rgb = px[:, :, :3].astype(np.uint8)
    return cv2.cvtColor(rgb.reshape(-1, 1, 3), cv2.COLOR_RGB2HSV_FULL).reshape(px.shape[0], px.shape[1], 3).astype(int)


def glyphness(px):
    """How much each pixel looks like the glowing P (bright and saturated,
    unlike the dark panel and the pale shell), 0..1."""
    r, g, b = (px[:, :, i].astype(float) for i in range(3))
    v = np.maximum(np.maximum(r, g), b)
    sat = v - np.minimum(np.minimum(r, g), b)
    return np.clip((sat - 70) / 60, 0, 1) * np.clip((v - 70) / 60, 0, 1) * (px[:, :, 3] > 200)


def visor(px):
    """The dark visor's box (left, top, right, bottom): the biggest very dark patch in the top half."""
    dark = ((px[:, :, :3].max(axis=2) < 45) & (px[:, :, 3] > 200)).astype(np.uint8)
    dark[px.shape[0] // 2:] = 0
    n, _, stats, _ = cv2.connectedComponentsWithStats(dark, 8)
    if n < 2:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, w, h = stats[i, :4]
    return x, y, x + w, y + h


def find_p(px, name):
    """The P's own pixels (a 0/1 mask over the whole picture), or None."""
    g = glyphness(px)
    if name in P_BOX:
        x0, y0, x1, y1 = P_BOX[name]
        x0, y0, x1, y1 = x0 - 4, y0 - 4, x1 + 4, y1 + 4
    else:
        v = visor(px)
        if v is None:
            return None
        cx = (v[0] + v[2]) // 2
        x0, y0, x1, y1 = cx - 40, v[3] + 10, cx + 40, v[3] + 80
    m = np.zeros(g.shape, np.uint8)
    m[y0:y1, x0:x1] = (g[y0:y1, x0:x1] > 0.35)
    n, lab, stats, cent = cv2.connectedComponentsWithStats(cv2.dilate(m, np.ones((3, 3), np.uint8)), 8)
    if n < 2:
        return None
    # The P: the biggest glowing patch there, of about a P's size.
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    w, h = stats[i, 2], stats[i, 3]
    if not (8 <= w <= 34 and 14 <= h <= 40):
        return None
    return ((lab == i) & (m > 0)).astype(np.uint8)


def fix_p(src, out, name):
    """Wipe the mirrored P off the panel and lay the original P there."""
    p = find_p(src, name)
    if p is None:
        return False
    W = src.shape[1]
    flipped = p[:, ::-1]
    ys, xs = np.where(flipped)
    # 1. Wipe: the mirrored P and its glow become the panel's own dark colour.
    wipe = cv2.dilate(flipped, np.ones((7, 7), np.uint8))
    y0, y1, x0, x1 = ys.min() - 6, ys.max() + 7, xs.min() - 6, xs.max() + 7
    region = out[y0:y1, x0:x1].astype(float)
    dark = (region[:, :, :3].max(axis=2) < 60) & (region[:, :, 3] > 200) & (wipe[y0:y1, x0:x1] == 0)
    panel = np.median(region[dark][:, :3], axis=0) if dark.any() else np.array([8.0, 8.0, 30.0])
    amt = np.clip(glyphness(out[y0:y1, x0:x1]) * 1.6, 0, 1) * wipe[y0:y1, x0:x1]
    amt = cv2.GaussianBlur(amt.astype(np.float32), (3, 3), 0.8) * wipe[y0:y1, x0:x1]
    for c in range(3):
        region[:, :, c] = region[:, :, c] * (1 - amt) + panel[c] * amt
    out[y0:y1, x0:x1] = np.round(region).astype(np.uint8)
    # 2. The original P, moved so it covers the same place the mirrored one did.
    sy, sx = np.where(p)
    dx = int(round((W - 1 - sx.max()) - sx.min()))
    keep = cv2.GaussianBlur(cv2.dilate(p, np.ones((3, 3), np.uint8)).astype(np.float32), (5, 5), 1.0)
    keep = np.clip(keep * 1.4, 0, 1)
    shifted = np.zeros_like(src)
    kshift = np.zeros(keep.shape, np.float32)
    if dx >= 0:
        shifted[:, dx:] = src[:, :W - dx]
        kshift[:, dx:] = keep[:, :W - dx]
    else:
        shifted[:, :W + dx] = src[:, -dx:]
        kshift[:, :W + dx] = keep[:, -dx:]
    # Only on the chest panel (both pictures opaque there).
    kshift *= (out[:, :, 3] > 200) & (shifted[:, :, 3] > 200)
    blend = out.astype(float)
    for c in range(3):
        blend[:, :, c] = blend[:, :, c] * (1 - kshift) + shifted[:, :, c] * kshift
    out[:, :, :3] = np.round(blend[:, :, :3]).astype(np.uint8)
    return True


def halo_mask(px):
    """The halo's pixels: (clean, the first) bright and saturated above the
    visor's top, where only the halo is; (all) those, and the halo's pink end
    lower down beside the head (nothing else up there is pink: the headphones
    and eyes are blue and cyan)."""
    v = visor(px)
    top = v[1] + 2 if v else px.shape[0] // 4
    bottom = v[3] if v else px.shape[0] // 3
    r, g, b = (px[:, :, i].astype(int) for i in range(3))
    sat = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    bright = (px[:, :, 3] > 40) & (sat > 110) & (np.maximum(np.maximum(r, g), b) > 120)
    clean = bright.copy()
    clean[top:] = False
    hue = hsv(px)[:, :, 0]
    pink = bright & ((hue >= 185) | (hue <= 10))
    pink[bottom:] = False
    return clean, clean | pink


def fix_halo(out):
    """Turn the halo's colours back round: the colour across it goes pink to
    cyan from the viewer's left, as in the pictures that weren't mirrored.
    Only the hue changes; the halo's shape, shading and see-through edge stay."""
    clean, m = halo_mask(out)
    if clean.sum() < 50:
        return False
    ys, xs = np.where(m)
    lo, hi = xs.min(), xs.max()
    h = hsv(out)
    # The halo's hue across it (column by column, only the halo's pixels),
    # then read back reversed.
    hue = np.full(out.shape[1], -1.0)
    for x in range(lo, hi + 1):
        col = h[:, x, 0][m[:, x]]
        if len(col):
            # (Hue is an angle: the circular mean.)
            a = col / 256 * 2 * np.pi
            hue[x] = (np.arctan2(np.sin(a).mean(), np.cos(a).mean()) % (2 * np.pi)) / (2 * np.pi) * 256
    have = np.where(hue >= 0)[0]
    hue = np.interp(np.arange(out.shape[1]), have, hue[have])
    want = hue[(lo + hi) - np.clip(xs, lo, hi)]
    # Each halo pixel takes the reversed column's hue, keeping its own
    # brightness and saturation.
    new = h.copy()
    new[ys, xs, 0] = np.round(want).astype(int) % 256
    rgb = cv2.cvtColor(new[:, :, :3].astype(np.uint8).reshape(-1, 1, 3), cv2.COLOR_HSV2RGB_FULL).reshape(out.shape[0], out.shape[1], 3)
    soft = cv2.GaussianBlur(m.astype(np.float32), (3, 3), 0.7)
    blend = out[:, :, :3].astype(float) * (1 - soft[:, :, None]) + rgb.astype(float) * soft[:, :, None]
    out[:, :, :3] = np.round(blend).astype(np.uint8)
    return True


def feet(px):
    """The planted foot: the middle of what touches the baseline, in robot
    widths from the point between his feet (the canvas's middle). The pose
    box is 1.364 robot widths for the 300-pixel canvas."""
    a = px[:, :, 3]
    low = np.array([np.where(a[:, x] > 128)[0].max() if (a[:, x] > 128).any() else -1 for x in range(a.shape[1])])
    xs = np.where(low >= low.max() - 3)[0]
    if not len(xs):
        return None
    # The run of columns on the ground that holds the lowest point.
    runs = np.split(xs, np.where(np.diff(xs) > 2)[0] + 1)
    run = max(runs, key=lambda r: low[r].max() * 1000 + len(r))
    mid = (run.min() + run.max()) / 2
    return round((mid - a.shape[1] / 2) * 1.364 / a.shape[1], 3)


def mirrored(name):
    src = np.asarray(Image.open(POSES / f"{name}.webp").convert("RGBA")).copy()
    out = src[:, ::-1].copy()
    did = []
    if not name.startswith("climb") and fix_p(src, out, name):
        did.append("P")
    if fix_halo(out):
        did.append("halo")
    return Image.fromarray(out, "RGBA"), did, feet(src)


def main():
    for name in sources():
        out, did, foot = mirrored(name)
        dest = POSES / f"{name}-left.webp"
        out.save(dest, "WEBP", quality=90, method=6, exact=True)
        print(f"{dest.relative_to(ROOT)}  {out.size[0]}x{out.size[1]}  fixed: {', '.join(did) or 'nothing'}  planted foot: {foot}")


if __name__ == "__main__":
    main()
