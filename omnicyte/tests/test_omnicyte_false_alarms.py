"""Ordinary, legitimate traffic must not set Omnicyte off.

A false alarm costs more than its moment: people who are warned about safe
things learn to click past the warnings. This is a corpus of the everyday
links, notifications, newsletters, internal mail and chat a business sees,
and every one of them must come out "safe". A test of the same size in
test_omnicyte_detection.py checks the real phishing is still caught.
"""

import pytest

from omnicyte.engine import Message, check_link, check_message
from omnicyte.policy import Policy

ACME = Policy(org_name="Acme", org_domains=["acme.com", "acme.co.uk"])

# ---------------------------------------------------------------- links people click every day

LINKS = [
    # Microsoft
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp.vendor.com%2Fcb",
    "https://outlook.office.com/mail/inbox", "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc",
    "https://acme.sharepoint.com/:x:/s/Finance/EabcD?e=1", "https://acme-my.sharepoint.com/personal/jo_acme_com/Documents",
    "https://portal.azure.com/#home", "https://aka.ms/mfasetup", "https://account.microsoft.com/security",
    "https://go.microsoft.com/fwlink/?linkid=2151817", "https://www.office.com/?auth=2", "https://admin.microsoft.com",
    "https://microsoft.github.io/vscode-docs", "https://download.microsoft.com/download/x/Teams_windows_x64.exe",
    # Google
    "https://accounts.google.com/ServiceLogin?continue=https://mail.google.com/mail/", "https://docs.google.com/spreadsheets/d/1xyz/edit",
    "https://drive.google.com/file/d/1abc/view?usp=sharing", "https://meet.google.com/abc-defg-hij",
    "https://calendar.google.com/calendar/event?eid=x", "https://www.google-analytics.com/analytics.js",
    "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=abc", "https://google.github.io/styleguide/",
    "https://www.google.com/url?q=https://www.acme.com/news&sa=D",
    # Other SaaS a company uses, including its own spaces on them
    "https://acme.slack.com/archives/C01", "https://app.slack.com/client/T01/C01", "https://acme.zoom.us/j/123456789?pwd=abc",
    "https://us02web.zoom.us/j/8765", "https://acme.okta.com/app/UserHome", "https://acme.atlassian.net/browse/OPS-12",
    "https://acme.zendesk.com/hc/en-us", "https://acme.app.box.com/folder/1837", "https://acme.app.box.com/s/k2j3h4", "https://acme.my.salesforce.com/lightning/r/Account/001/view",
    "https://login.salesforce.com/?startURL=https://acme.lightning.force.com", "https://acme.wd5.myworkdayjobs.com/careers",
    "https://www.docusign.net/Signing/EmailStart.aspx?a=x", "https://app.docusign.com/documents/details/abc",
    "https://secure.adobesign.com/public/apiesign?pid=x", "https://acrobat.adobe.com/link/review?uri=urn:aaid",
    "https://www.dropbox.com/s/abc/Q3.pdf?dl=0", "https://app.box.com/s/abc", "https://wetransfer.com/downloads/abc/def",
    "https://github.com/acme/api/pull/42", "https://raw.githubusercontent.com/acme/api/main/README.md",
    "https://acme.github.io/docs/", "https://gitlab.com/acme/infra/-/merge_requests/9",
    "https://www.notion.so/acme/Roadmap-abc", "https://trello.com/b/abc/board", "https://app.asana.com/0/1/2",
    "https://www.linkedin.com/in/someone/", "https://lnkd.in/eAbC123", "https://www.paypal.com/myaccount/summary",
    "https://www.amazon.com/gp/your-account/order-history", "https://aws.amazon.com/console/",
    "https://signin.aws.amazon.com/oauth?redirect_uri=https%3A%2F%2Fconsole.aws.amazon.com", "https://s3.us-east-1.amazonaws.com/acme-reports/q3.pdf",
    "https://www.fedex.com/fedextrack/?trknbr=123", "https://www.ups.com/track?tracknum=1Z", "https://tools.usps.com/go/TrackConfirmAction",
    "https://www.dhl.com/gb-en/home/tracking.html", "https://dashboard.stripe.com/payments", "https://quickbooks.intuit.com/login",
    "https://go.xero.com/Dashboard/", "https://workforcenow.adp.com/workforcenow/login.html", "https://www.chase.com/personal/online-banking",
    "https://status.slack.com/", "https://www.githubstatus.com/", "https://stripe.statuspage.io/",
    # Ordinary websites whose names contain brand words, or are near them
    "https://finance.yahoo.com/quote/MSFT", "https://www.applied.com/", "https://www.appliedmaterials.com/",
    "https://www.bigapplebagels.com/menu", "https://big-apple-bagels.com/", "https://www.apple-pie-recipes.com/",
    "https://www.economic-outlook.org/2026", "https://outlook-consulting.co.uk/", "https://www.salesforceben.com/",
    "https://www.salesforge.ai/", "https://zoominfo.com/c/acme", "https://www.zoom-lens-store.com/",
    "https://sales-teams.com/blog", "https://teams.acme.com/", "https://www.chase-center.com/events",
    "https://www.theupsstore.com/", "https://slack-line-supplies.com/", "https://pinstripe-tailors.com/",
    "https://www.amazon-rainforest.org/", "https://www.adobe-homes.com/", "https://workday-lunch.com/",
    "https://github-readme-stats.vercel.app/api?username=x", "https://awesome-github.dev/", "https://www.linkedinwriter.com/",
    "https://www.9to5google.com/", "https://appleinsider.com/", "https://www.paypal-community.com/t5/",
    "https://www.dropboxforum.com/", "https://stripes.com", "https://www.binancefinance.example/",
    # Normal internet
    "https://www.bbc.co.uk/news/business-123", "https://www.nytimes.com/2026/11/01/business/x.html", "https://nyti.ms/3abc",
    "https://en.wikipedia.org/wiki/Phishing", "https://stackoverflow.com/questions/123/how", "https://www.python.org/ftp/python/3.13.1/python-3.13.1-amd64.exe",
    "https://nodejs.org/dist/v22.0.0/node-v22.0.0.pkg", "https://www.mozilla.org/firefox/download/thanks/",
    "https://medium.com/@someone/post-abc", "https://substack.com/@writer", "https://news.ycombinator.com/item?id=1",
    "https://www.reddit.com/r/sysadmin/", "https://example.shop/products/blue-mug", "https://mybrand.online/about",
    "https://events.support/register", "https://d1a2b3c4.cloudfront.net/assets/app.css",
    "https://www.facebook.com/sharer/sharer.php?u=https://www.acme.com/blog", "https://twitter.com/intent/tweet?url=https://acme.com",
    "https://x.com/acme", "https://t.co/abc123", "https://bit.ly/acme-offsite",
    "https://app.vendor.com/login?next=https://app.vendor.com/reports", "https://auth.vendor.io/sso/saml?RelayState=https://portal.vendor.io",
    # Company and private network
    "https://acme.com/login", "https://intranet.acme.com/hr", "https://www.acme.co.uk/", "http://intranet/wiki", "http://printer.local/",
    "http://192.168.1.1/login", "http://10.0.4.12:8080/jenkins/login", "http://localhost:3000/auth", "https://wiki.corp/",
    # Gateway rewrites of safe links
    "https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.bbc.co.uk%2Fnews&data=05%7C02&reserved=0",
    "https://urldefense.com/v3/__https://github.com/acme/api__;!!abc$",
    # Email marketing and notification click trackers
    "https://click.email.nike.com/?qs=abc", "https://u123456.ct.sendgrid.net/ls/click?upn=abc",
    "https://acme.us5.list-manage.com/track/click?u=1&id=2", "https://links.mail.vendor.com/ls/click?upn=x",
    "https://email.mg.vendor.com/c/eJx", "https://xyz.r.us-east-1.awstrack.me/L0/https:%2F%2Fvendor.com%2Fx/1/abc",
    "https://t.hubspotlinks.com/Ctc/abc", "https://click.pstmrk.it/3s/vendor.com%2Fdocs/abc",
]


@pytest.mark.parametrize("url", LINKS)
def test_everyday_links_are_safe(url):
    v = check_link(url, policy=ACME)
    assert v.level == "safe", [(s.code, s.title, s.weight) for s in v.signals]


# Link text and the real address differ all the time in legitimate mail.
LINK_TEXTS = [
    ("https://click.email.nike.com/?qs=abc", "www.nike.com"),
    ("https://u123.ct.sendgrid.net/ls/click?upn=abc", "vendor.com/pricing"),
    ("https://acme.us5.list-manage.com/track/click?u=1", "https://www.acme.com"),
    ("https://t.hubspotlinks.com/Ctc/abc", "vendor.com"),
    ("https://nyti.ms/3abc", "nytimes.com"),
    ("https://www.microsoft.com/en-us/microsoft-365", "office.com"),
    ("https://login.microsoftonline.com/", "portal.office.com"),
    ("https://www.youtube.com/watch?v=x", "youtu.be/x"),
    ("https://x.com/acme", "twitter.com/acme"),
    ("https://www.acme.co.uk/", "acme.com"),
    ("https://github.com/acme/api/blob/main/report.pdf", "report.pdf"),
    ("https://github.com/acme/api/blob/main/README.md", "README.md"),
    ("https://nodejs.org/", "Node.js"),
    ("https://nextjs.org/docs", "Next.js"),
    ("https://dotnet.microsoft.com/", "ASP.NET"),
    ("https://www.acme.com/q3", "Q3-results.xlsx"),
    ("https://vendor.com/invoice/123", "Invoice_123.pdf"),
    ("https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.bbc.co.uk%2Fnews&data=x", "www.bbc.co.uk/news"),
    ("https://example.org/a", "e.g. this"),
    ("https://www.vendor.com/", "Vendor.com"),
]


@pytest.mark.parametrize("href,text", LINK_TEXTS)
def test_link_text_differences_that_are_fine(href, text):
    v = check_link(href, text, ACME)
    assert v.level == "safe", [(s.code, s.title, s.weight) for s in v.signals]


# ---------------------------------------------------------------- whole messages

def mail(name, address, subject, text, links=(), attachments=(), reply_to=""):
    return Message(source="mail", sender_name=name, sender_address=address, subject=subject, text=text,
                   links=list(links), attachments=list(attachments), reply_to=reply_to)


MESSAGES = [
    mail("Microsoft account team", "account-security-noreply@accountprotection.microsoft.com", "Microsoft account security code",
         "Please use the following security code for the Microsoft account jo@acme.com. Security code: 482910. "
         "If you don't recognize the account, you can click here to remove your email address from that account.",
         [("https://account.live.com/dp?ft=abc", "click here")]),
    mail("Microsoft 365 Message center", "o365mc@microsoft.com", "Weekly digest: Microsoft service updates",
         "Message center: action required by 30 November. Review the changes.", [("https://admin.microsoft.com/Adminportal/Home#/MessageCenter", "Review")]),
    mail("Google", "no-reply@accounts.google.com", "Security alert",
         "A new sign-in on Windows. We noticed a new sign-in to your Google Account. If this was you, you don't need to do anything. "
         "If not, we'll help you secure your account.", [("https://accounts.google.com/AccountChooser?Email=jo@acme.com&continue=https://myaccount.google.com/alert", "Check activity")]),
    mail("Jo Bloggs (via Google Docs)", "comments-noreply@docs.google.com", "Document shared with you: \"Q3 plan\"",
         "Jo Bloggs shared a document with you. Open", [("https://docs.google.com/document/d/1abc/edit?usp=sharing_eil", "Open")]),
    mail("Slack", "feedback@slack.com", "Your Slack verification code",
         "Your confirmation code is below — enter it in your open browser window and we'll help you get signed in. 123-456"),
    mail("Zoom", "no-reply@zoom.us", "Please activate your Zoom account",
         "Welcome to Zoom! To activate your account please click the button below to verify your email address.",
         [("https://acme.zoom.us/activate?code=abc&fr=signup", "Activate Account")]),
    mail("GitHub", "noreply@github.com", "[GitHub] A third-party OAuth application has been added to your account",
         "Hey jo! A third-party OAuth application (Vendor CI) with read:user scope was recently authorized to access your account. "
         "Visit https://github.com/settings/connections/applications/abc for more information.",),
    mail("GitHub", "noreply@github.com", "[GitHub] Please verify your device",
         "Hey jo! A sign in attempt requires further verification because we did not recognize your device. "
         "To complete the sign in, enter the verification code on the unrecognized device. Verification code: 123456"),
    mail("DocuSign", "dse_NA3@docusign.net", "Completed: Please DocuSign: Acme MSA.pdf",
         "All parties have completed Please DocuSign: Acme MSA.pdf.", [("https://na3.docusign.net/Signing/EmailStart.aspx?a=abc", "VIEW COMPLETED DOCUMENT")]),
    mail("Adobe Acrobat Sign", "echosign@echosign.com", "You're invited to sign: NDA",
         "Please review and sign NDA.", [("https://secure.na1.adobesign.com/public/esignWidget?wid=abc", "Review and sign")]),
    mail("Dropbox", "no-reply@dropboxmail.com", "Jo shared \"Q3 Board deck\" with you",
         "Jo invited you to view the file \"Q3 Board deck.pptx\" on Dropbox.", [("https://www.dropbox.com/scl/fi/abc/Q3.pptx?dl=0", "View file")]),
    mail("Facebook", "notification@facebookmail.com", "Your Page has new activity", "See what's new on Acme's page.",
         [("https://www.facebook.com/acme", "See activity")]),
    mail("LinkedIn", "messages-noreply@linkedin.com", "Sam sent you a message", "Sam: Hi Jo, saw your post about the offsite.",
         [("https://www.linkedin.com/comm/messaging/thread/abc", "Reply")]),
    mail("Amazon.com", "auto-confirm@amazon.com", "Your Amazon.com order #112-123 has shipped",
         "Your package is on the way. Track your package.", [("https://www.amazon.com/gp/your-account/ship-track?orderId=112", "Track package")]),
    mail("PayPal", "service@paypal.com", "You've got money", "Vendor Ltd sent you $120.00 USD.",
         [("https://www.paypal.com/myaccount/transactions", "View transaction")]),
    mail("PayPal", "paypal@mail.paypal.com", "Important changes to our user agreement",
         "We're updating our agreement. Learn more.", [("https://www.paypal.com/legalhub/home", "Learn more")]),
    mail("FedEx", "TrackingUpdates@fedex.com", "Your package is scheduled for delivery today",
         "Scheduled delivery: Today by end of day.", [("https://www.fedex.com/fedextrack/?trknbr=123", "Track")]),
    mail("Chase", "no.reply.alerts@chase.com", "Your statement is ready", "Your credit card statement is available. Sign in to view it.",
         [("https://secure.chase.com/web/auth/dashboard", "Sign in")]),
    mail("Okta", "noreply@okta.com", "Okta password reset requested",
         "A password reset request was made for your Acme Okta account. Click this link to reset your password: ",
         [("https://acme.okta.com/signin/reset-password/abc", "Reset Password")]),
    mail("QuickBooks", "quickbooks@notification.intuit.com", "Invoice 1043 from Vendor Ltd",
         "Dear Acme, your invoice is attached. Amount due $4,200.00. Due date 30/11/2026. Overdue invoices may incur a fee.",
         [("https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-abc", "Review and pay")]),
    mail("Vendor Ltd Accounts", "accounts@vendorltd.co.uk", "Remittance advice",
         "Please find attached our remittance advice for invoice 1043, paid by wire transfer today. IBAN details as on file.",
         attachments=["Remittance_1043.pdf"]),
    mail("Nike", "nike@official.nike.com", "Just in: new arrivals",
         "Shop the latest. View in browser.", [("https://click.official.nike.com/?qs=abc", "www.nike.com"),
                                                ("https://click.official.nike.com/?qs=def", "Shop now")]),
    mail("Vendor Weekly", "newsletter@vendor.com", "This week at Vendor",
         "Read the full story on our blog. Act now: early-bird tickets end today only!",
         [("https://u123.ct.sendgrid.net/ls/click?upn=abc", "vendor.com/blog"),
          ("https://u123.ct.sendgrid.net/ls/click?upn=def", "Unsubscribe")], reply_to="support@vendor-help.zendesk.com"),
    mail("Morning Brew", "crew@morningbrew.com", "Markets: Apple, Amazon and Microsoft report",
         "Apple, Amazon and Microsoft all reported earnings. Read more: https://www.morningbrew.com/daily/stories/x"),
    mail("Substack", "writer@substack.com", "New post from The Outlook", "The Outlook: what's next for markets",
         [("https://theoutlook.substack.com/p/whats-next", "Read")]),
    mail("Salesforce Ben", "hello@salesforceben.com", "The Salesforce admin newsletter",
         "This week: Flow tips.", [("https://www.salesforceben.com/flow-tips/", "Read")]),
    mail("Acme for Salesforce", "account-team@salesforce.com", "Your renewal",
         "Hi Jo, your Acme renewal is due on 1 December.", [("https://acme.my.salesforce.com/", "Open")]),
    mail("Dana Whitfield", "dana@acme.com", "URGENT: board pack",
         "I need the board pack by end of day please, it's urgent. Upload it here: https://acme.sharepoint.com/sites/board"),
    mail("Acme IT", "it@acme.com", "Password expiry reminder",
         "Your password will expire in 7 days. Change it at https://acme.okta.com/enduser/settings before it expires."),
    mail("Acme HR", "hr@acme.com", "Welcome aboard!",
         "Your temporary password is on its way by text. Sign in at https://acme.okta.com and set a new one."),
    mail("Sam Lee", "sam.lee@gmail.com", "Photos from Saturday", "Here are the photos! https://photos.app.goo.gl/abc"),
    mail("Chase Miller", "chase.miller@outlook.com", "Lunch", "Lunch on Thursday?"),
    mail("Teams Fitness Club", "hello@teamsfitness.co.uk", "Your membership", "Thanks for joining."),
    mail("Apple Valley Dental", "reception@applevalleydental.com", "Appointment reminder", "See you Tuesday at 10am."),
    mail("Vendor Support", "support@vendor.com", "Re: ticket 4411", "We've reset your account. Log in at https://app.vendor.com/login",
         reply_to="support@vendor.zendesk.com"),
    mail("SharePoint Online", "no-reply@sharepointonline.com", "Priya shared \"FY27 Budget\" with you",
         "Priya Shah shared a file with you.", [("https://acme.sharepoint.com/:x:/s/Finance/abc", "Open")]),
    mail("Box", "noreply@box.com", "Tom uploaded 3 files to 'Legal'", "Tom Becker uploaded 3 files.",
         [("https://acme.app.box.com/folder/1837", "View files")]),
    mail("Jira", "jira@acme.atlassian.net", "[JIRA] OPS-12 assigned to you", "Fix login redirect.",
         [("https://acme.atlassian.net/browse/OPS-12", "OPS-12")]),
    mail("Recruiter", "jane@talentfirm.com", "Opportunity", "Hi Jo, saw your profile on LinkedIn: https://www.linkedin.com/in/jo"),
    mail("Python Software Foundation", "noreply@python.org", "Python 3.13.1 released",
         "Download: https://www.python.org/ftp/python/3.13.1/python-3.13.1-amd64.exe"),
]


@pytest.mark.parametrize("msg", MESSAGES, ids=lambda m: m.subject[:40])
def test_everyday_mail_is_safe(msg):
    v = check_message(msg, ACME)
    assert v.level == "safe", [(s.code, s.title, s.weight) for s in v.signals]


CHATS = [
    "can someone review https://github.com/acme/api/pull/42 before standup?",
    "the build is red again, urgent: https://ci.acme.com/job/api/1234",
    "the db password is in 1Password, don't paste it here",
    "set `password = os.environ['DB_PASSWORD']` in settings.py",
    "use password=$DB_PASS in the .env",
    "pwd: /home/jo/projects/api",
    "password: <your password here>",
    "the wifi password is on the whiteboard",
    "Your password must be at least 12 characters",
    "Reset links expire in 24 hours, so do it immediately",
    "can you send me the code review notes from yesterday?",
    "what is the code for the meeting room door? 4412 I think",
    "please wire the payment to the usual supplier, details are in Xero",
    "here's the deck: https://acme.sharepoint.com/:p:/s/Sales/abc",
    "lol https://x.com/someone/status/123",
    "token expired again, re-run `gh auth login`",
]


@pytest.mark.parametrize("text", CHATS)
def test_everyday_chat_is_safe(text):
    v = check_message(Message(source="chat", text=text), ACME)
    assert v.level == "safe", [(s.code, s.title, s.weight) for s in v.signals]
