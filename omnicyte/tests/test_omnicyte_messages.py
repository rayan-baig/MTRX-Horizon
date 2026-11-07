"""Whole messages: who they claim to be from, what they ask for, what's
attached, and secrets pasted in chat."""

from pathlib import Path

from omnicyte import creds, mail
from omnicyte.engine import Message, check_message
from omnicyte.policy import Policy

ACME = Policy(org_domains=["acme.com"])


def codes(v):
    return {s.code for s in v.signals}


def test_password_expiry_phish():
    v = check_message(Message(
        source="mail", sender_name="Microsoft 365", sender_address="no-reply@m365-alerts.net",
        subject="Your password expires today",
        text="Your password will expire within 24 hours. Keep your same password by signing in below.",
        links=[("https://m365-alerts.net/keep", "Keep password")]), ACME)
    assert v.level == "danger"
    assert {"credential-request", "urgency"} <= codes(v)
    assert v.headline.startswith("Don't click that link")
    assert v.worst_link == "https://m365-alerts.net/keep"


def test_normal_colleague_mail_is_safe():
    v = check_message(Message(source="mail", sender_name="Bob Lee", sender_address="bob@acme.com",
                              subject="Lunch?", text="Want to grab lunch at noon? https://maps.google.com/x"), ACME)
    assert v.level == "safe"
    assert v.headline == "Looks fine to me."


def test_real_microsoft_mail_is_safe():
    v = check_message(Message(source="mail", sender_name="Microsoft", sender_address="account-security-noreply@accountprotection.microsoft.com",
                              subject="Microsoft account security info", text="Review at https://account.microsoft.com/security"), ACME)
    assert v.level == "safe", v.signals


def test_people_named_like_brands_are_not_flagged():
    v = check_message(Message(source="mail", sender_name="Chase Miller", sender_address="chase.miller@gmail.com",
                              subject="Photos", text="Here are the photos from Saturday"), ACME)
    assert v.level == "safe", v.signals


def test_lookalike_of_our_own_domain():
    v = check_message(Message(source="mail", sender_name="Dana (CFO)", sender_address="dana@acrne.com",
                              subject="Quick favour", text="Are you at your desk? I need you to buy gift cards for a client today."), ACME)
    assert v.level == "danger"
    assert {"sender-lookalike", "payment-change"} <= codes(v)


def test_outsider_using_our_name():
    v = check_message(Message(source="mail", sender_name="Acme IT Helpdesk", sender_address="helpdesk.acme@gmail.com",
                              subject="Mailbox quota", text="Your mailbox is full. Re-validate your password here: https://forms.example/x"), ACME)
    assert v.level == "danger"
    assert "sender-brand" in codes(v)


def test_mfa_code_request_in_chat():
    v = check_message(Message(source="chat", text="hey it's IT, I just sent you a text, can you send me the code so I can fix your account?"), ACME)
    assert v.level in ("caution", "danger")
    assert "mfa-code" in codes(v)


def test_bank_detail_change():
    v = check_message(Message(source="mail", sender_name="Supplier Accounts", sender_address="accounts@supplier.example",
                              reply_to="accounts.supplier@protonmail.com", subject="Change of bank details",
                              text="Please note our new banking details for all future invoices. Process the payment today."), ACME)
    assert v.level == "danger"
    assert {"payment-change", "reply-to"} <= codes(v)


def test_dangerous_attachments():
    v = check_message(Message(source="mail", sender_address="x@vendor.example", attachments=["Invoice.pdf.exe"]), ACME)
    assert v.level == "danger" and "double-extension" in codes(v)
    v = check_message(Message(source="mail", sender_address="x@vendor.example", attachments=["remittance.html"]), ACME)
    assert v.level == "caution" and "attachment" in codes(v)
    v = check_message(Message(source="mail", sender_address="x@vendor.example", attachments=["report.pdf", "photo.jpg"]), ACME)
    assert v.level == "safe"


def test_secret_shared_in_chat_is_masked():
    v = check_message(Message(source="chat", text="prod key is AKIAABCDEFGHIJKLMNOP and the db password: Hunter22!"), ACME)
    assert "secret-shared" in codes(v)
    shown = " ".join(s.detail + s.title for s in v.signals)
    assert "AKIAABCDEFGHIJKLMNOP" not in shown and "Hunter22!" not in shown
    assert v.headline.startswith("Careful: a password or key")


def test_password_words_are_not_passwords():
    assert creds.find("Password: reset required. Your password is expired.") == []
    assert creds.find("Use a password manager please") == []


def test_secret_kinds():
    found = dict(creds.find("ghp_" + "a" * 36 + " xoxb-1234567890-abcdefghij sk-ant-" + "b" * 30))
    assert {"GitHub token", "Slack token", "Anthropic API key"} <= set(found)
    assert "OpenAI API key" not in found


def test_gateway_flag_counts():
    v = check_message(Message(source="mail", sender_address="a@b.example", subject="[SUSPICIOUS] Invoice"), ACME)
    assert "gateway-flagged" in codes(v)
    v = check_message(Message(source="mail", sender_address="a@b.example", subject="[EXTERNAL] Invoice"), ACME)
    assert "gateway-flagged" not in codes(v)


EML = b"""From: "DocuSign" <dse@docusign-mail.top>
To: you@acme.com
Subject: Please review: Contract_2026.pdf
Reply-To: billing@another.example
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="b1"

--b1
Content-Type: text/html; charset="utf-8"

<html><head><style>p{color:red}</style></head><body><p>You have a document to review and sign.</p>
<a href="https://docusign-mail.top/review?id=1">https://www.docusign.net/Signing</a>
<a href="mailto:help@acme.com">Help</a></body></html>
--b1
Content-Type: text/html; name="Contract_2026.html"
Content-Disposition: attachment; filename="Contract_2026.html"

<html>form</html>
--b1--
"""


def test_reading_an_eml(tmp_path):
    msg = mail.from_bytes(EML, where="you@acme.com")
    assert msg.sender_name == "DocuSign" and msg.sender_address == "dse@docusign-mail.top"
    assert msg.reply_to == "billing@another.example"
    assert msg.attachments == ["Contract_2026.html"]
    assert ("https://docusign-mail.top/review?id=1", "https://www.docusign.net/Signing") in msg.links
    assert "p{color" not in msg.text
    v = check_message(msg, ACME)
    assert v.level == "danger"
    assert {"text-mismatch", "sender-lookalike", "attachment", "reply-to"} <= codes(v)


def test_cli_check(tmp_path, capsys):
    from omnicyte.__main__ import main
    eml = tmp_path / "phish.eml"
    eml.write_bytes(EML)
    assert main(["check", str(eml)]) == 2
    out = capsys.readouterr().out
    assert out.startswith("DANGER") and "Spot it next time" in out
    assert main(["check", "https://github.com"]) == 0
