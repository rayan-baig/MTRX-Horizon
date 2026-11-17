"""Start Omnicyte. The packaged app is built from this file, and starting at
login runs it when Omnicyte is used from source."""

import sys
from pathlib import Path

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from omnicyte.__main__ import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
