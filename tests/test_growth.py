"""The early access list (early_access.py) and the creator program
(creators.py): off by default, double opt-in, unsubscribing, launch emails
(blocked without a postal address, each person once, throttled), creator
links (counted, forwarded only to allowed places), keys kept only as hashes,
and every limit. No email is really sent: they are kept in a list."""

import hashlib
import re
import time

import pytest

from tests.test_lock import ORIGIN, client, make_client  # noqa: F401
from tests.test_lock import owner as sign_in

EMAIL = "fan@example.com"


@pytest.fixture
def owner(client):
    """This browser is the owner's, signed in to the console."""
    sign_in(client)


@pytest.fixture
def mail(monkeypatch):
    """Emails "sent", kept here instead, with their headers."""
    from horizon import health
    sent = []
    monkeypatch.setenv("MTRX_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("EARLY_ACCESS_EMAIL_FROM", "news@example.com")
    monkeypatch.setattr(health, "send_email", lambda subject, body, to="", sender="", headers=None: sent.append(
        {"subject": subject, "body": body, "to": to, "sender": sender, "headers": headers or {}}) or True)
    return sent


@pytest.fixture
def early(monkeypatch, mail):
    """Early access on, every launch setting filled in, and the background
    sender held back so each test sends when it chooses."""
    from horizon import early_access
    monkeypatch.setenv("EARLY_ACCESS_ENABLED", "1")
    monkeypatch.setenv("FOUNDER_CODE_RANKUP", "FOUNDER20")
    monkeypatch.setenv("FOUNDER_CODE_CYBERLOGIX", "CYBERFOUNDER")
    monkeypatch.setenv("FOUNDER_PERCENT_OFF", "20")
    monkeypatch.setenv("MTRX_POSTAL_ADDRESS", "1 Example Street, Example Town")
    kicks = []
    monkeypatch.setattr(early_access, "kick", lambda: kicks.append(1))
    return mail


@pytest.fixture
def makers(monkeypatch, mail):
    monkeypatch.setenv("CREATORS_ENABLED", "1")
    monkeypatch.setenv("MTRX_CONTACT_EMAIL", "owner@example.com")
    for name in ("CREATOR_PERCENT", "CREATOR_MONTHS", "RANKUP_URL", "MTRX_TRUST_PROXY"):
        monkeypatch.delenv(name, raising=False)
    return mail


def wait_for(check, seconds=3.0):
    end = time.time() + seconds
    while time.time() < end:
        if check():
            return True
        time.sleep(0.02)
    return check()


def join(client, email=EMAIL, apps=("rankup",), adult=True, **extra):
    return client.post("/api/early-access/join", headers=ORIGIN,
                       json={"email": email, "apps": list(apps), "adult": adult, **extra})


def link(sent, kind, to=EMAIL):
    for m in reversed(sent):
        if m["to"] == to:
            found = re.search(rf"https://testserver(/early-access/{kind}/[0-9a-f.]+)", m["body"])
            if found:
                return found.group(1)
    raise AssertionError(f"no {kind} link sent to {to}")


def joined(client, sent, email=EMAIL, apps=("rankup",), **extra):
    """Join and press the link in the email."""
    before = len(sent)
    assert join(client, email, apps, **extra).status_code == 200
    assert wait_for(lambda: len(sent) > before)
    assert client.post(link(sent, "confirm", email)).status_code == 200


def rows(sql, *args):
    from horizon import db
    with db.connect() as conn:
        return [dict(r) for r in conn.execute(sql, args)]


# ---------------------------------------------------------------- off by default

PUBLIC = ("/early-access", "/creators", "/creators/dashboard", "/c/abcdef",
          "/early-access/confirm/0123456789abcdef.0123456789abcdef0123456789abcdef")
POSTS = ("/api/early-access/join", "/api/creators/apply", "/api/creators/me")


def test_both_are_off_by_default_and_every_address_is_page_not_found(client, owner):
    for path in PUBLIC + ("/early-access/unsubscribe/0123456789abcdef.0123456789abcdef0123456789abcdef",):
        assert client.get(path).status_code == 404, path
    for path in POSTS:
        assert client.post(path, headers=ORIGIN, json={}).status_code == 404, path
    for path in ("/", "/privacy", "/terms", "/sitemap.xml"):
        page = client.get(path).text.lower()
        assert "early access" not in page and "early-access" not in page and "/creators" not in page, path
    console = client.get("/console").text
    assert 'id="early"' not in console and 'id="creators"' not in console
    numbers = client.get("/api/console/numbers").json()
    assert numbers["early_access"] is None and numbers["creators"] is None


def test_switched_on_without_email_still_shows_nothing(client, monkeypatch):
    """No mail server means nobody could confirm, so the form stays hidden."""
    monkeypatch.setenv("EARLY_ACCESS_ENABLED", "1")
    monkeypatch.delenv("MTRX_SMTP_HOST", raising=False)
    assert client.get("/early-access").status_code == 404
    assert "Get early access" not in client.get("/").text
    assert join(client).status_code == 404


def test_when_on_the_pages_show_and_keep_the_strict_security_policy(client, early, makers):
    from horizon import main
    home = client.get("/").text
    assert "Get early access" in home and 'href="#early-access-rankup"' in home
    assert 'href="/creators"' in home
    for path in ("/", "/early-access", "/creators", "/creators/dashboard", "/privacy"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert response.headers["content-security-policy"] == main.CSP
        assert 'style="' not in response.text and "<script>" not in response.text, path
        assert re.search(r"<script(?![^>]*\ssrc=)", response.text) is None, path
    sitemap = client.get("/sitemap.xml").text
    assert "/early-access</loc>" in sitemap and "/creators</loc>" in sitemap


def test_the_home_page_stays_one_screen_with_the_form_in_pop_ups(client, early):
    page = client.get("/").text
    frame = page.split('<div class="page">', 1)[1].split('<section class="sheet', 1)[0]
    assert "ea-form" not in frame
    for sheet in ("early-access", "early-access-rankup", "early-access-cyberlogix", "early-access-omniarmor"):
        assert f'id="{sheet}"' in page
    # Each app's own pop-up has that app ticked already.
    rankup = page.split('id="early-access-rankup"', 1)[1].split("</section>", 1)[0]
    assert 'value="rankup" checked' in rankup and 'value="omniarmor" checked' not in rankup


def test_the_promise_shows_a_number_only_for_an_app_with_a_code(client, early, monkeypatch):
    page = client.get("/early-access").text
    assert "20% off for founding members" in page
    omni = page.split('value="omniarmor"', 1)[1].split("</label>", 1)[0]
    assert "% off" not in omni
    monkeypatch.delenv("FOUNDER_CODE_RANKUP")
    monkeypatch.delenv("FOUNDER_CODE_CYBERLOGIX")
    page = client.get("/early-access").text
    assert "% off" not in page and "Founding members get a launch discount." in page


def test_privacy_page_says_one_short_line_only_while_on(client, early, makers, monkeypatch):
    page = client.get("/privacy").text
    assert "The early access list keeps only your email and the apps you picked" in page
    assert "If you apply as a creator, we keep what you send" in page
    assert "The one form is Orbyt" not in page
    monkeypatch.setenv("EARLY_ACCESS_ENABLED", "0")
    monkeypatch.setenv("CREATORS_ENABLED", "0")
    page = client.get("/privacy").text
    assert "early access" not in page.lower() and "creator" not in page.lower()
    assert "The one form is Orbyt" in page


# ---------------------------------------------------------------- double opt-in

def test_double_opt_in_only_confirmed_people_count(client, early):
    from horizon import early_access
    assert join(client, apps=["rankup", "omniarmor"]).status_code == 200
    assert wait_for(lambda: len(early) == 1)
    email = early[0]
    assert email["to"] == EMAIL and email["sender"] == "news@example.com"
    assert "/early-access/confirm/" in email["body"] and "Founding members get 20% off RankUp" in email["body"]
    # Every email can be left in one click, from the link or the mail app.
    unsubscribe = link(early, "unsubscribe")
    assert email["headers"]["List-Unsubscribe"] == f"<https://testserver{unsubscribe}>"
    assert email["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "1 Example Street, Example Town" in email["body"]

    counts = early_access.counts()
    assert counts["rankup"] == {"confirmed": 0, "unconfirmed": 1}
    page = client.post(link(early, "confirm"))
    assert page.status_code == 200 and "You're on the list!" in page.text
    assert page.headers["cache-control"] == "no-store"
    counts = early_access.counts()
    assert counts["rankup"] == {"confirmed": 1, "unconfirmed": 0}
    assert counts["omniarmor"] == {"confirmed": 1, "unconfirmed": 0}
    # Pressing it again changes nothing.
    assert client.post(link(early, "confirm")).status_code == 200
    assert early_access.counts()["rankup"]["confirmed"] == 1


def test_only_the_email_and_the_apps_are_kept(client, early):
    joined(client, early, apps=["cyberlogix"])
    (row,) = rows("SELECT * FROM early_signups")
    assert row["email"] == EMAIL and row["apps"] == "cyberlogix"
    assert row["pending"] == "" and row["ref"] == ""
    assert set(row) == {"id", "email", "apps", "pending", "ref", "created_at", "pending_at", "confirmed_at"}


def test_unconfirmed_sign_ups_are_deleted_after_seven_days(client, early):
    from horizon import early_access
    join(client, "old@example.com")
    join(client, "new@example.com")
    joined(client, early, "kept@example.com")
    from horizon import db
    with db.connect() as conn:
        conn.execute("UPDATE early_signups SET created_at = ?, pending_at = COALESCE(pending_at, ?) "
                     "WHERE email IN ('old@example.com', 'kept@example.com')",
                     (time.time() - 8 * 86400, time.time() - 8 * 86400))
        conn.execute("UPDATE early_signups SET pending_at = ? WHERE email = 'old@example.com'",
                     (time.time() - 8 * 86400,))
    early_access.forget_old()
    left = {r["email"] for r in rows("SELECT email FROM early_signups")}
    assert left == {"new@example.com", "kept@example.com"}


def test_a_wrong_or_unsigned_link_is_page_not_found(client, early):
    joined(client, early)
    good = link(early, "confirm")
    signup_id = good.rsplit("/", 1)[1].split(".")[0]
    for bad in (f"{signup_id}.{'0' * 32}", "nothing", f"{signup_id}"):
        assert client.get(f"/early-access/confirm/{bad}").status_code == 404
    # An unsubscribe link can't be used to confirm, or the other way round.
    assert client.get(link(early, "unsubscribe").replace("unsubscribe", "confirm")).status_code == 404


def test_joining_checks_the_form(client, early):
    assert join(client, adult=False).json()["field"] == "adult"
    assert join(client, apps=[]).json()["field"] == "apps"
    assert join(client, apps=["notanapp"]).status_code == 400
    assert join(client, email="not an email").json()["field"] == "email"
    assert join(client, email="a@b.c?bcc=x@y.z").status_code == 400
    # A bot that fills in the hidden field is told "done", and nothing is kept.
    assert join(client, website="spam").status_code == 200
    assert rows("SELECT * FROM early_signups") == [] and early == []


def test_the_answer_is_the_same_whether_or_not_someone_is_on_the_list(client, early):
    joined(client, early)
    first = join(client).json()
    assert first == join(client, email="someone.new@example.com").json()
    # Already confirmed for that app: no new email.
    before = len([m for m in early if m["to"] == EMAIL])
    join(client)
    time.sleep(0.2)
    assert len([m for m in early if m["to"] == EMAIL]) == before
    # A new app needs its own confirmation, and joins once confirmed.
    from horizon import early_access
    join(client, apps=["omniarmor"])
    assert wait_for(lambda: len([m for m in early if m["to"] == EMAIL]) == before + 1)
    assert early_access.counts()["omniarmor"] == {"confirmed": 0, "unconfirmed": 1}
    client.post(link(early, "confirm"))
    assert early_access.counts()["omniarmor"] == {"confirmed": 1, "unconfirmed": 0}


# ---------------------------------------------------------------- unsubscribing

def test_unsubscribe_asks_then_deletes_the_person(client, early):
    joined(client, early)
    url = link(early, "unsubscribe")
    page = client.get(url)
    assert page.status_code == 200 and "Unsubscribe?" in page.text and f'action="{url}"' in page.text
    assert len(rows("SELECT * FROM early_signups")) == 1  # a link checker opening it changes nothing
    done = client.post(url)
    assert done.status_code == 200 and "You're unsubscribed" in done.text
    assert rows("SELECT * FROM early_signups") == []
    assert "You're unsubscribed" in client.get(url).text


def test_a_mail_apps_one_click_unsubscribe_works_with_no_origin(client, early):
    """RFC 8058: the mail provider posts List-Unsubscribe=One-Click, from its
    own servers, with no Origin header."""
    joined(client, early)
    url = link(early, "unsubscribe")
    response = client.post(url, content=b"List-Unsubscribe=One-Click",
                           headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert response.status_code == 200
    assert rows("SELECT * FROM early_signups") == []


def test_unsubscribing_still_works_after_early_access_is_switched_off(client, early, monkeypatch):
    joined(client, early)
    url = link(early, "unsubscribe")
    monkeypatch.setenv("EARLY_ACCESS_ENABLED", "0")
    assert client.get("/early-access").status_code == 404
    assert client.post(url).status_code == 200
    assert rows("SELECT * FROM early_signups") == []
    assert client.post("/early-access/unsubscribe/0123456789abcdef.0123456789abcdef0123456789abcdef").status_code == 404


def test_the_secret_links_stay_out_of_the_server_log():
    import logging
    from horizon import main
    keep = main._HideSecretLinks()
    for path in ("/early-access/confirm/abc.def", "/early-access/unsubscribe/abc.def"):
        record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "GET %s", (path,), None)
        assert keep.filter(record) is False


# ---------------------------------------------------------------- launch emails

def launch(client, app="rankup", subject="RankUp is open!", message="It's here. Thanks for waiting.", action="send"):
    return client.post(f"/api/console/early-access/{action}", headers=ORIGIN,
                       json={"app": app, "subject": subject, "message": message})


def test_launch_emails_are_blocked_without_a_postal_address(client, early, owner, monkeypatch):
    joined(client, early)
    monkeypatch.delenv("MTRX_POSTAL_ADDRESS")
    preview = launch(client, action="preview").json()
    assert preview["can_send"] is False
    assert any("MTRX_POSTAL_ADDRESS" in p for p in preview["problems"])
    refused = launch(client)
    assert refused.status_code == 409 and "MTRX_POSTAL_ADDRESS" in refused.json()["error"]
    assert rows("SELECT * FROM early_sends") == []
    # The console says so before the owner even tries.
    assert client.get("/api/console/early-access").json()["postal"] is False


def test_launch_emails_need_the_apps_founder_code(client, early, owner, monkeypatch):
    joined(client, early, apps=["omniarmor"])
    refused = launch(client, app="omniarmor", subject="OmniArmor.ai is open")
    assert refused.status_code == 409 and "FOUNDER_CODE_OMNIARMOR" in refused.json()["error"]


def test_each_person_gets_a_launch_email_once(client, early, owner):
    from horizon import early_access
    joined(client, early, "a@example.com")
    joined(client, early, "b@example.com", apps=["rankup", "omniarmor"])
    joined(client, early, "c@example.com", apps=["omniarmor"])
    join(client, "unconfirmed@example.com")
    preview = launch(client, action="preview").json()
    assert preview["to"] == 2 and preview["can_send"] is True
    assert "FOUNDER20" in preview["body"] and "1 Example Street" in preview["body"]

    first = launch(client).json()
    assert first["queued"] == 2 and first["already"] == 0
    before = len(early)
    assert early_access.deliver() == 2
    launches = early[before:]
    assert sorted(m["to"] for m in launches) == ["a@example.com", "b@example.com"]
    for m in launches:
        assert m["subject"] == "RankUp is open!"
        assert "Your founding member code for RankUp: FOUNDER20" in m["body"] and "20% off" in m["body"]
        assert "/early-access/unsubscribe/" in m["body"] and "List-Unsubscribe" in m["headers"]
        assert "1 Example Street, Example Town" in m["body"]

    # Pressing Send again, or sending the same email again, sends nothing new.
    again = launch(client).json()
    assert again["queued"] == 0 and again["already"] == 2
    assert early_access.deliver() == 0 and len(early) == before + 2
    # Someone who confirms later gets it, and only them.
    joined(client, early, "late@example.com")
    assert launch(client).json()["queued"] == 1
    count = len(early)
    early_access.deliver()
    assert [m["to"] for m in early[count:]] == ["late@example.com"]
    (campaign,) = client.get("/api/console/early-access").json()["campaigns"]
    assert campaign["sent"] == 3 and campaign["queued"] == 0


def test_an_email_being_sent_is_never_sent_twice(client, early, owner):
    from horizon import early_access
    joined(client, early, "a@example.com")
    launch(client)
    # As if the server stopped while it was sending.
    from horizon import db
    with db.connect() as conn:
        conn.execute("UPDATE early_sends SET state = 'sending'")
    count = len(early)
    assert early_access.deliver() == 0 and len(early) == count


def test_someone_who_unsubscribes_before_their_turn_is_skipped(client, early, owner):
    from horizon import early_access
    joined(client, early, "a@example.com")
    joined(client, early, "b@example.com")
    launch(client)
    client.post(link(early, "unsubscribe", "b@example.com"))
    count = len(early)
    early_access.deliver()
    assert [m["to"] for m in early[count:]] == ["a@example.com"]


def test_launch_emails_are_sent_a_few_a_minute(client, early, owner, monkeypatch):
    from horizon import early_access
    for n in range(3):
        joined(client, early, f"p{n}@example.com")
    launch(client)
    count = len(early)
    assert early_access.deliver(limit=1) == 1 and len(early) == count + 1
    monkeypatch.setenv("EARLY_ACCESS_SEND_PER_MINUTE", "30")
    asked = {}
    monkeypatch.setattr(early_access, "deliver", lambda **kw: asked.update(kw))
    early_access._work()
    assert asked["pause"] == 2.0


def test_the_launch_email_is_checked(client, early, owner):
    assert launch(client, subject="").json()["error"] == "Write a subject."
    assert launch(client, subject="x" * 121).status_code == 400
    assert launch(client, message="   ").json()["error"] == "Write a short message."
    assert launch(client, app="nope").status_code == 400
    # A subject can't carry another header.
    joined(client, early)
    from horizon import early_access
    launch(client, subject="Hi\r\nBcc: someone@example.com")
    count = len(early)
    early_access.deliver()
    assert early[count]["subject"] == "Hi Bcc: someone@example.com"


def test_the_owners_early_access_tools_are_hidden_from_strangers(client, early):
    assert client.get("/api/console/early-access").status_code == 404
    assert launch(client).status_code == 404
    assert launch(client, action="preview").status_code == 404


# ---------------------------------------------------------------- creators

def apply(client, **extra):
    body = {"name": "Sam Maker", "email": "sam@example.com", "channel": "youtube.com/@sammaker",
            "audience": "10k-100k", "app": "rankup", "grown_up": True}
    body.update(extra)
    return client.post("/api/creators/apply", headers=ORIGIN, json=body)


def approved(client, mail, app="rankup"):
    """Apply, then approve as the owner. Returns the console's answer."""
    assert apply(client).status_code == 200
    (pending,) = client.get("/api/console/creators").json()["pending"]
    answer = client.post(f"/api/console/creators/{pending['id']}/approve", headers=ORIGIN, json={"app": app})
    assert answer.status_code == 200, answer.text
    return answer.json()


def test_the_creators_page_uses_the_settings(client, makers, monkeypatch):
    page = client.get("/creators").text
    assert "Make videos about our apps," in page and "earn 20% of what your viewers pay in their first year" in page
    monkeypatch.setenv("CREATOR_PERCENT", "25")
    monkeypatch.setenv("CREATOR_MONTHS", "6")
    assert "earn 25% of what your viewers pay in their first 6 months" in client.get("/creators").text


def test_an_application_is_emailed_to_the_owner_and_listed(client, makers, owner):
    assert apply(client).json()["ok"] is True
    assert wait_for(lambda: makers)
    notice = makers[-1]
    assert notice["to"] == "owner@example.com" and "Sam Maker" in notice["body"]
    assert "https://youtube.com/@sammaker" in notice["body"]
    (pending,) = client.get("/api/console/creators").json()["pending"]
    assert pending["audience"] == "10,000 to 100,000" and pending["email"] == "sam@example.com"


def test_an_application_is_checked(client, makers):
    assert apply(client, grown_up=False).json()["field"] == "grown_up"
    assert apply(client, channel="javascript:alert(1)").json()["field"] == "channel"
    assert apply(client, audience="lots").json()["field"] == "audience"
    assert apply(client, email="nope").json()["field"] == "email"
    assert apply(client, name="").json()["field"] == "name"
    assert apply(client, website="spam").status_code == 200
    assert rows("SELECT * FROM creators") == []


def test_approving_gives_a_link_and_a_key_kept_only_as_a_hash(client, makers, owner):
    from horizon import creators
    answer = approved(client, makers)
    key, code = answer["key"], answer["code"]
    assert re.fullmatch(r"CR(-[A-Z2-7]{4}){6}", key)
    assert answer["link"] == f"https://testserver/c/{code}"
    # The key is emailed to the creator with their link.
    assert wait_for(lambda: any(m["to"] == "sam@example.com" for m in makers))
    welcome = next(m for m in makers if m["to"] == "sam@example.com")
    assert key in welcome["body"] and answer["link"] in welcome["body"]
    # Only its SHA-256 is kept, nowhere the key itself.
    (stored,) = rows("SELECT key_hash FROM creator_keys")
    flat = key.replace("-", "")
    assert stored["key_hash"] == creators.key_hash(key) == hashlib.sha256(flat.encode()).hexdigest()
    from horizon import config
    raw = config.get().db_path.read_bytes()
    assert key.encode() not in raw and flat.encode() not in raw
    # The key opens the dashboard, however it is typed.
    for typed in (key, key.lower(), " " + flat + " "):
        me = client.post("/api/creators/me", headers={**ORIGIN, "X-Creator-Key": typed})
        assert me.status_code == 200 and me.json()["code"] == code
    assert client.post("/api/creators/me", headers={**ORIGIN, "X-Creator-Key": "CR-AAAA"}).status_code == 403


def test_a_new_key_replaces_the_oldest(client, makers, owner):
    answer = approved(client, makers)
    (creator,) = client.get("/api/console/creators").json()["approved"]
    keys = [answer["key"]]
    for _ in range(3):
        keys.append(client.post(f"/api/console/creators/{creator['id']}/key", headers=ORIGIN).json()["key"])
    assert len(rows("SELECT * FROM creator_keys")) == 3
    assert client.post("/api/creators/me", headers={**ORIGIN, "X-Creator-Key": keys[0]}).status_code == 403
    assert client.post("/api/creators/me", headers={**ORIGIN, "X-Creator-Key": keys[-1]}).status_code == 200


def test_a_creator_link_counts_each_visitor_once_a_day_and_forwards(client, makers, owner, early, monkeypatch):
    code = approved(client, makers)["code"]
    monkeypatch.setenv("MTRX_TRUST_PROXY", "1")
    first = client.get(f"/c/{code}", headers={"X-Forwarded-For": "203.0.113.7"}, follow_redirects=False)
    assert first.status_code == 302
    assert first.headers["location"] == f"/early-access?app=rankup&ref={code}"
    client.get(f"/c/{code}", headers={"X-Forwarded-For": "203.0.113.7"}, follow_redirects=False)
    client.get(f"/c/{code.upper()}", headers={"X-Forwarded-For": "198.51.100.4"}, follow_redirects=False)
    (day,) = rows("SELECT clicks, signups FROM creator_days")
    assert day == {"clicks": 2, "signups": 0}
    # The address itself is written down nowhere.
    from horizon import config
    raw = config.get().db_path.read_bytes()
    assert b"203.0.113.7" not in raw and b"198.51.100.4" not in raw
    # The early access page carries the code, and a confirmed sign-up counts once.
    page = client.get(first.headers["location"]).text
    assert f'name="ref" value="{code}"' in page and 'value="rankup" checked' in page
    joined(client, early, ref=code)
    client.post(link(early, "confirm"))
    assert rows("SELECT signups FROM creator_days")[0]["signups"] == 1


def test_a_creator_link_never_forwards_anywhere_it_shouldnt(client, makers, owner, monkeypatch):
    from horizon import db
    code = approved(client, makers)["code"]
    # Nothing in the request changes where it goes.
    for path in (f"/c/{code}?to=https://evil.example", f"/c/{code}?next=//evil.example",
                 f"/c/{code}?ref=other"):
        where = client.get(path, follow_redirects=False).headers["location"]
        assert "evil" not in where and where.startswith("/") and not where.startswith("//"), where
    for path in ("/c/nosuch1", "/c/%2F%2Fevil.example", "/c/https:evil", "/c/" + "a" * 40):
        assert client.get(path, follow_redirects=False).status_code == 404, path
    # Once the app is open at its own address, it goes there with the code.
    monkeypatch.setenv("RANKUP_URL", "https://rankup.mtrxhorizyn.com")
    where = client.get(f"/c/{code}", follow_redirects=False).headers["location"]
    assert where == f"https://rankup.mtrxhorizyn.com/?ref={code}"
    # An address typed into the catalog that isn't an allowed host is not used.
    monkeypatch.delenv("RANKUP_URL")
    with db.connect() as conn:
        conn.execute("UPDATE apps SET url = 'https://evil.example/' WHERE key = 'rankup'")
    where = client.get(f"/c/{code}", follow_redirects=False).headers["location"]
    assert "evil" not in where and where.startswith("/#learn-rankup")


def test_the_owner_writes_down_earnings_and_the_creator_sees_them(client, makers, owner):
    key = approved(client, makers)["key"]
    (creator,) = client.get("/api/console/creators").json()["approved"]
    act = f"/api/console/creators/{creator['id']}/record"
    assert client.post(act, headers=ORIGIN, json={"kind": "earned", "amount": "40.00", "note": "November"}).status_code == 200
    assert client.post(act, headers=ORIGIN, json={"kind": "paid", "amount": "$25"}).status_code == 200
    assert client.post(act, headers=ORIGIN, json={"kind": "paid", "amount": "-5"}).status_code == 400
    assert client.post(act, headers=ORIGIN, json={"kind": "stolen", "amount": "5"}).status_code == 400
    me = client.post("/api/creators/me", headers={**ORIGIN, "X-Creator-Key": key}).json()
    assert (me["earned_usd"], me["paid_usd"], me["owed_usd"]) == (40.0, 25.0, 15.0)
    assert me["ledger"][0]["kind"] == "paid" and me["ledger"][1]["note"] == "November"
    assert len(me["days"]) == 30 and me["percent"] == 20 and me["period"] == "first year"


def test_declining_or_removing_deletes_everything(client, makers, owner):
    approved(client, makers)
    (creator,) = client.get("/api/console/creators").json()["approved"]
    code = creator["code"]
    assert client.post(f"/api/console/creators/{creator['id']}/remove", headers=ORIGIN).status_code == 200
    assert client.get(f"/c/{code}").status_code == 404
    assert rows("SELECT * FROM creators") == [] and rows("SELECT * FROM creator_keys") == []


def test_the_owners_creator_tools_are_hidden_from_strangers(client, makers):
    apply(client)
    (row,) = rows("SELECT id FROM creators")
    assert client.get("/api/console/creators").status_code == 404
    assert client.post(f"/api/console/creators/{row['id']}/approve", headers=ORIGIN,
                       json={"app": "rankup"}).status_code == 404


def test_yesterdays_visitor_keys_and_marks_are_deleted(client, makers):
    from horizon import creators, db, growth, upkeep
    growth.visitor_mark("203.0.113.9")
    with db.connect() as conn:
        conn.execute("INSERT INTO site_keys (name, value, at) VALUES ('visitors:2020-01-01', 'aa', 0)")
        conn.execute("INSERT INTO creator_seen (day, mark) VALUES ('2020-01-01', 'x')")
    upkeep.run_once()
    names = {r["name"] for r in rows("SELECT name FROM site_keys")}
    assert "visitors:2020-01-01" not in names and f"visitors:{growth.today()}" in names
    assert rows("SELECT * FROM creator_seen WHERE day = '2020-01-01'") == []
    assert creators.RATES["cr_click"][0] > 0


# ---------------------------------------------------------------- limits

def test_the_early_access_form_is_rate_limited(client, early):
    from horizon import early_access
    limit = early_access.RATES["ea_join"][0]
    for n in range(limit):
        assert join(client, f"p{n}@example.com").status_code == 200
    assert join(client, "one.more@example.com").status_code == 429


def test_confirmation_emails_to_one_address_are_limited(client, early, monkeypatch):
    from horizon import early_access
    monkeypatch.setitem(early_access.RATES, "ea_join", (100, 3600))
    monkeypatch.setitem(early_access.RATES, "ea_join_day", (100, 86400))
    for _ in range(6):
        join(client)
    time.sleep(0.3)
    assert len([m for m in early if m["to"] == EMAIL]) == early_access.RATES["ea_email"][0]


def test_wrong_links_are_rate_limited(client, early):
    from horizon import early_access
    bad = "/early-access/confirm/0123456789abcdef." + "0" * 32
    for _ in range(early_access.RATES["ea_bad_link"][0]):
        assert client.get(bad).status_code == 404
    assert client.get(bad).status_code == 429


def test_creator_applications_are_rate_limited(client, makers):
    from horizon import creators
    for _ in range(creators.RATES["cr_apply"][0]):
        assert apply(client).status_code == 200
    assert apply(client).status_code == 429


def test_guessing_creator_keys_is_rate_limited(client, makers):
    from horizon import creators
    for _ in range(creators.RATES["cr_bad_key"][0]):
        assert client.post("/api/creators/me", headers={**ORIGIN, "X-Creator-Key": "CR-WRONG"}).status_code == 403
    assert client.post("/api/creators/me", headers={**ORIGIN, "X-Creator-Key": "CR-WRONG"}).status_code == 429


def test_creator_link_clicks_are_limited_per_visitor(client, makers, owner, monkeypatch):
    from horizon import creators
    code = approved(client, makers)["code"]
    monkeypatch.setitem(creators.RATES, "cr_click", (2, 3600))
    for _ in range(4):
        # Over the limit, a visitor still gets where they were going.
        assert client.get(f"/c/{code}", follow_redirects=False).status_code == 302
    attempts = rows("SELECT who FROM attempts WHERE kind = 'cr_click'")
    assert len(attempts) == 2 and all(a["who"].startswith("mark:") for a in attempts)


# ---------------------------------------------------------------- the console

def test_numbers_shows_early_access_and_creators(client, early, makers, owner):
    joined(client, early)
    join(client, "waiting@example.com", apps=["omniarmor"])
    approved(client, makers)
    data = client.get("/api/console/numbers").json()
    ea, cr = data["early_access"], data["creators"]
    assert ea["confirmed"] == 1 and ea["unconfirmed"] == 1 and ea["ready"] is True
    by_app = {a["key"]: a for a in ea["apps"]}
    assert by_app["rankup"]["confirmed"] == 1 and by_app["omniarmor"]["unconfirmed"] == 1
    assert cr["approved"] == 1 and cr["percent"] == 20
    console = client.get("/console").text
    assert 'id="early"' in console and 'id="creators"' in console and 'id="nu-early"' in console


def test_the_new_settings_tolerate_typos(monkeypatch):
    from horizon import config
    monkeypatch.setenv("FOUNDER_CODE_RANKUP", "has spaces; DROP")
    monkeypatch.setenv("FOUNDER_PERCENT_OFF", "120")
    monkeypatch.setenv("CREATOR_PERCENT", "lots")
    monkeypatch.setenv("CREATOR_MONTHS", "-3")
    monkeypatch.setenv("MTRX_POSTAL_ADDRESS", "  1 Example Street\r\nBcc: x  ")
    s = config.get()
    assert s.founder_codes["rankup"] == "" and s.founder_percent_off == 0
    assert s.creator_percent == 20 and s.creator_months == 12
    assert s.postal_address == "1 Example Street Bcc: x"


# ---------------------------------------------------------------- found before launch

def test_a_link_checker_opening_the_confirm_link_does_not_confirm(client, early):
    """Work and school mail often opens every link in an email to check it
    before the person sees it. That must not put an address on the list
    (or count a sign-up for a creator): the person presses Confirm."""
    from horizon import early_access
    join(client)
    assert wait_for(lambda: len(early) == 1)
    url = link(early, "confirm")
    page = client.get(url)
    assert page.status_code == 200 and f'action="{url}"' in page.text
    assert page.headers["cache-control"] == "no-store"
    assert early_access.counts()["rankup"] == {"confirmed": 0, "unconfirmed": 1}
    done = client.post(url)
    assert done.status_code == 200 and "You're on the list!" in done.text
    assert early_access.counts()["rankup"] == {"confirmed": 1, "unconfirmed": 0}
    # Opened again later, it just says so.
    assert "You're on the list!" in client.get(url).text


def test_confirmation_emails_to_one_inbox_are_limited_however_the_address_is_written(client, early, monkeypatch):
    """fan+1@..., fan+2@... and F.a.n@gmail.com all land in one inbox."""
    from horizon import early_access
    monkeypatch.setitem(early_access.RATES, "ea_join", (100, 3600))
    monkeypatch.setitem(early_access.RATES, "ea_join_day", (100, 86400))
    for n in range(6):
        join(client, f"fan+{n}@example.com")
    for local in ("victim", "v.ictim", "Vi.Ctim", "victim+a", "v.i.c.t.i.m+b", "victim+c"):
        join(client, f"{local}@gmail.com")
    time.sleep(0.3)
    limit = early_access.RATES["ea_email"][0]
    assert len([m for m in early if m["to"].endswith("@example.com")]) == limit
    assert len([m for m in early if m["to"].endswith("@gmail.com")]) == limit


def test_signing_up_again_gives_a_confirm_link_that_lasts_seven_days(client, early):
    """Someone who ignored the first email and signs up again on day six
    used to get a link that ran out a few hours later."""
    from horizon import db, early_access
    join(client)
    with db.connect() as conn:
        conn.execute("UPDATE early_signups SET created_at = ?, pending_at = ?",
                     (time.time() - 6 * 86400, time.time() - 6 * 86400))
    join(client)
    assert wait_for(lambda: len(early) == 2)
    early_access.forget_old(now=time.time() + 2 * 86400)
    assert client.post(link(early, "confirm")).status_code == 200
    assert early_access.counts()["rankup"] == {"confirmed": 1, "unconfirmed": 0}
    # Never confirmed at all, it still goes seven days after the last sign-up.
    join(client, "gone@example.com")
    early_access.forget_old(now=time.time() + 8 * 86400)
    assert {r["email"] for r in rows("SELECT email FROM early_signups")} == {EMAIL}
