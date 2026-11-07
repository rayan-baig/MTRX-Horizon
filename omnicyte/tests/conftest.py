import sys
from pathlib import Path

import pytest

# Omnicyte isn't installed in the website's environment: import it from here.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def omnicyte_home(tmp_path, monkeypatch):
    """Every test gets its own settings folder and no organisation policy."""
    monkeypatch.setenv("OMNICYTE_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("OMNICYTE_POLICY", str(tmp_path / "policy.json"))
    return tmp_path
