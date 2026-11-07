"""Draw Omnicyte's icon (the buddy's face) as a PNG, with nothing but the standard library.

  python tools/make_icon.py extension/icon.png 128
"""

import math
import struct
import sys
import zlib


def draw(size: int):
    px = [[(0, 0, 0, 0)] * size for _ in range(size)]
    c = size / 2
    r = size * 0.44

    def blend(x, y, rgb, a):
        if 0 <= x < size and 0 <= y < size and a > 0:
            br, bg, bb, ba = px[y][x]
            na = a + ba * (1 - a)
            mix = lambda s, d: int((s * a + d * ba * (1 - a)) / na) if na else 0
            px[y][x] = (mix(rgb[0], br), mix(rgb[1], bg), mix(rgb[2], bb), na)

    def disc(cx, cy, rad, rgb, ry=None):
        ry = ry or rad
        for y in range(int(cy - ry - 2), int(cy + ry + 3)):
            for x in range(int(cx - rad - 2), int(cx + rad + 3)):
                d = math.hypot((x + .5 - cx) / rad, (y + .5 - cy) / ry)
                blend(x, y, rgb, max(0.0, min(1.0, (1 - d) * min(rad, ry) + .5)))

    disc(c, c, r, (31, 158, 147))
    disc(c, c, r * 0.9, (58, 214, 197))
    for dx, dy in ((-.45, .35), (.4, .45), (.1, .6), (-.15, -.55)):
        disc(c + dx * r, c + dy * r, r * .07, (31, 158, 147))
    for side in (-1, 1):
        ex, ey = c + side * r * .36, c - r * .12
        disc(ex, ey, r * .23, (20, 32, 43))
        disc(ex, ey, r * .18, (255, 255, 255))
        disc(ex + r * .04, ey + r * .03, r * .09, (20, 32, 43))
    return px


def png(px) -> bytes:
    size = len(px)
    raw = b"".join(b"\x00" + bytes(v for p in row for v in (p[0], p[1], p[2], int(p[3] * 255))) for row in px)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    out, size = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 128
    with open(out, "wb") as f:
        f.write(png(draw(size)))
