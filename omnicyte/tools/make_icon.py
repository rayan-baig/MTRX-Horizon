"""Write Omnicyte's icon as a PNG.

  python tools/make_icon.py extension/icon.png 128
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omnicyte.icon import png_bytes  # noqa: E402

if __name__ == "__main__":
    out, size = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 128
    Path(out).write_bytes(png_bytes(size))
