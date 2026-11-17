"""The desktop app around the engine: first-run settings, what IT can lock,
starting at login, one copy at a time, and the self-test the builds run."""

import json
import platform
import threading
import urllib.request

import pytest

from omnicyte import autostart, policy as policy_mod, server, settings
from omnicyte.core import Guardian

GOOD = {"org_name": "  Acme   Ltd ", "org_domains": "Acme.com, https://acme.co.uk/", "report_to": "security@acme.com",
        "start_at_login": False, "clipboard_watch": True, "alert_caution": False}


@pytest.fixture(autouse=True)
def own_autostart_folder(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))


def test_first_run_until_set_up():
    assert policy_mod.load().set_up is False
    assert settings.apply(GOOD) == {}
    p = policy_mod.load()
    assert p.set_up and p.org_name == "Acme Ltd"
    assert p.org_domains == ["acme.com", "acme.co.uk"]
    assert p.report_to == "security@acme.com" and p.alert_on == "danger"


def test_bad_values_are_explained_and_nothing_is_saved():
    problems = settings.apply(dict(GOOD, report_to="not an email", org_domains="!!!"))
    assert set(problems) == {"report_to", "org_domains"}
    assert policy_mod.load().set_up is False


def test_empty_is_fine():
    assert settings.apply(dict(GOOD, org_name="", org_domains="", report_to="")) == {}
    assert policy_mod.load().org_domains == []


def test_it_policy_wins_and_is_locked(omnicyte_home):
    (omnicyte_home / "policy.json").write_text(json.dumps({"org_name": "Acme (IT)", "org_domains": ["acme.com"],
                                                            "clipboard_watch": False}))
    p = policy_mod.load()
    assert p.set_up                                   # IT did the setup: no first-run window
    assert {"org_name", "org_domains", "clipboard_watch"} <= set(p.managed)
    assert settings.apply(dict(GOOD, org_name="Something else", org_domains="evil.example",
                               clipboard_watch=True)) == {}
    p = policy_mod.load()
    assert p.org_name == "Acme (IT)" and p.org_domains == ["acme.com"] and p.clipboard_watch is False
    assert p.report_to == "security@acme.com"          # not set by IT, so the person's own


def test_settings_window_starts_from_saved_values():
    settings.apply(GOOD)
    start = settings.current()
    assert start["org_domains"] == "acme.com, acme.co.uk" and start["report_to"] == "security@acme.com"


@pytest.mark.skipif(platform.system() != "Linux", reason="checks the Linux autostart file")
def test_start_at_login_on_linux(tmp_path):
    assert not autostart.is_enabled()
    assert autostart.set_enabled(True)
    desktop = (tmp_path / "xdg" / "autostart" / "omnicyte.desktop").read_text()
    assert "launch.py" in desktop and "Exec=" in desktop
    assert settings.apply(dict(GOOD, start_at_login=False)) == {}
    assert not autostart.is_enabled()
    settings.apply(dict(GOOD, start_at_login=True))
    assert autostart.is_enabled()


def test_opening_again_says_hello_from_the_running_one():
    g = Guardian()
    httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(g, policy_mod.token()))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{httpd.server_address[1]}/v1/show", data=b"{}",
                                     method="POST", headers={"X-Omnicyte-Token": policy_mod.token()})
        with urllib.request.urlopen(req, timeout=5) as r:
            assert r.status == 200
        assert "already here" in g.notices.get_nowait()
    finally:
        httpd.shutdown()


def test_self_test_reports(tmp_path):
    from omnicyte.__main__ import self_test
    out = tmp_path / "result.json"
    code = self_test(str(out))
    result = json.loads(out.read_text())
    assert result["engine"] is True and result["service"] is True
    assert code == (0 if result["windows"] is True else 1)


def test_mac_finder_argument_is_ignored(monkeypatch, capsys):
    from omnicyte.__main__ import main
    monkeypatch.setattr("sys.argv", ["omnicyte", "-psn_0_12345", "token"])
    assert main() == 0
    assert capsys.readouterr().out.strip() == policy_mod.token()
