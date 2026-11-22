"""Makes the left-facing pictures for Pilot for Mac 1.5 (a developer tool;
the app never runs it). Needs Pillow and NumPy.

    python3 tools/mirror_poses.py

The owner's walk, run and climb pictures all face the viewer's right. Pilot
1.4 never mirrored a picture (the P on the chest would read backwards), so
going left he skipped sideways facing the camera, which looked odd. Here each
of those pictures is mirrored and, where the P shows, the P alone is put back
the right way round (its small dark chest panel is flipped back, with a soft
edge so no seam shows). The climb picture is side-on (no P in view).

    walk1, walk2, run1, run2 -> walk1-left, walk2-left, run1-left, run2-left
    climb1                   -> climb1-left

Run it again only if those pictures change.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
POSES = ROOT / "assets" / "poses"
# The P on the chest, measured on the 300 x 340 canvas: (left, top, right, bottom).
P_BOX = {
    "walk1": (151, 154, 172, 182),
    "walk2": (149, 161, 169, 184),
    "run1": (157, 158, 177, 182),
    "run2": (157, 152, 179, 180),
}
SOURCES = ["walk1", "walk2", "run1", "run2", "climb1"]


def mirrored(name):
    img = Image.open(POSES / f"{name}.webp").convert("RGBA")
    out = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    box = P_BOX.get(name)
    if box:
        w = img.width
        x0, y0, x1, y1 = box
        # The original (right-reading) P, placed where the mirror put the flipped one.
        patch = img.crop(box)
        mx0 = w - x1
        mask = Image.new("L", patch.size, 0)
        ImageDraw.Draw(mask).ellipse((1, 1, patch.width - 2, patch.height - 2), fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(1.6))
        # Only where both pictures are opaque (the chest panel), never past the outline.
        a = np.minimum(np.asarray(patch.getchannel("A")), np.asarray(out.crop((mx0, y0, mx0 + patch.width, y1)).getchannel("A")))
        mask = Image.fromarray((np.asarray(mask).astype(int) * a // 255).astype("uint8"))
        out.paste(patch, (mx0, y0), mask)
    return out


def main():
    for name in SOURCES:
        out = mirrored(name)
        dest = POSES / f"{name}-left.webp"
        out.save(dest, "WEBP", quality=90, method=6, exact=True)
        print(f"{dest.relative_to(ROOT)}  {out.size[0]}x{out.size[1]}")


if __name__ == "__main__":
    main()
