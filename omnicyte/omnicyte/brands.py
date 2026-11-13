"""The brands phishers pretend to be most often, and the domains that really are them.

A link or sender that uses one of these names, but is not on one of its real
domains, is a strong sign of a fake. The list is deliberately short: the
names that turn up in most business phishing. An organisation adds its own
domains in the policy file (see policy.py), which are checked the same way.
"""

BRANDS = {
    "microsoft": ("microsoft.com", "microsoftonline.com", "live.com", "office.com", "office365.com",
                  "outlook.com", "sharepoint.com", "onedrive.com", "azure.com", "windows.net",
                  "msft.net", "microsoft365.com", "skype.com", "bing.com", "xbox.com", "aka.ms",
                  "asp.net", "dot.net", "visualstudio.com", "microsoftstore.com", "office.net", "live.net",
                  "msauth.net", "msftauth.net", "azureedge.net", "sway.cloud.microsoft", "cloud.microsoft",
                  "sharepointonline.com", "yammer.com", "powerbi.com", "dynamics.com", "microsoftstream.com",
                  "office365.us", "microsoftonline.us", "teams.cdn.office.net", "msecnd.net", "microsoftapp.net"),
    "m365": ("microsoft.com", "office.com", "microsoft365.com", "microsoftonline.com"),
    "o365": ("microsoft.com", "office.com", "office365.com", "microsoftonline.com"),
    "office365": ("office.com", "office365.com", "microsoft.com", "microsoftonline.com"),
    "outlook": ("outlook.com", "live.com", "office.com", "microsoft.com", "office365.com"),
    "sharepoint": ("sharepoint.com", "microsoft.com", "sharepointonline.com"),
    "onedrive": ("onedrive.com", "live.com", "microsoft.com", "sharepoint.com"),
    "google": ("google.com", "gmail.com", "googleusercontent.com", "googleapis.com", "gstatic.com",
               "youtube.com", "goo.gl", "g.co", "withgoogle.com", "googlemail.com", "youtu.be",
               "google-analytics.com", "googletagmanager.com", "googleadservices.com", "doubleclick.net",
               "googlesyndication.com", "app.goo.gl", "ggpht.com", "blogger.com", "android.com", "chrome.com"),
    "gmail": ("gmail.com", "google.com", "googlemail.com"),
    "apple": ("apple.com", "icloud.com", "me.com", "apple.news", "apple-cloudkit.com", "mzstatic.com", "cdn-apple.com"),
    "appleid": ("apple.com",),
    "icloud": ("icloud.com", "apple.com"),
    "amazon": ("amazon.com", "amazon.co.uk", "amazon.de", "amazon.ca", "amazon.in", "amazon.com.au",
               "amazonaws.com", "aws.amazon.com", "a2z.com", "amazon.jobs", "amazon-adsystem.com", "media-amazon.com",
               "ssl-images-amazon.com", "amazon.co.jp", "amazon.fr", "amazon.es", "amazon.it", "awsapps.com", "aws.dev",
               "amazonses.com", "primevideo.com", "audible.com"),
    "paypal": ("paypal.com", "paypal.me", "paypalobjects.com", "paypal-community.com", "paypal-communication.com",
               "paypal-prepaid.com", "paypal.co.uk", "venmo.com"),
    "docusign": ("docusign.com", "docusign.net"),
    "dropbox": ("dropbox.com", "dropboxusercontent.com", "db.tt", "dropboxmail.com", "dropboxforum.com",
                "getdropbox.com", "hellosign.com"),
    "adobe": ("adobe.com", "adobesign.com", "adobelogin.com", "acrobat.com", "echosign.com", "adobe.io",
              "typekit.net", "behance.net"),
    "linkedin": ("linkedin.com", "lnkd.in", "licdn.com", "linkedinlearning.com"),
    "facebook": ("facebook.com", "fb.com", "fb.me", "meta.com", "messenger.com", "facebookmail.com", "fbcdn.net",
                 "workplace.com", "whatsapp.com"),
    "twitter": ("twitter.com", "x.com", "t.co", "twimg.com"),
    "instagram": ("instagram.com",),
    "netflix": ("netflix.com",),
    "okta": ("okta.com", "oktacdn.com", "okta-emea.com"),
    "salesforce": ("salesforce.com", "force.com", "salesforce-sites.com"),
    "slack": ("slack.com", "slack-edge.com", "slack-imgs.com", "slackb.com"),
    "zoom": ("zoom.us", "zoom.com", "zoomgov.com", "zoom.co.uk"),
    "teams": ("microsoft.com", "office.com", "live.com"),
    "wellsfargo": ("wellsfargo.com",),
    "chase": ("chase.com", "jpmorgan.com", "jpmorganchase.com"),
    "bankofamerica": ("bankofamerica.com", "bofa.com"),
    "dhl": ("dhl.com", "dhl.de", "dhl.co.uk"),
    "fedex": ("fedex.com",),
    "ups": ("ups.com",),
    "usps": ("usps.com",),
    "stripe": ("stripe.com", "stripe.network", "stripecdn.com"),
    "github": ("github.com", "githubusercontent.com", "github.io", "githubstatus.com", "githubassets.com", "github.dev",
               "ghcr.io", "githubapp.com"),
    "coinbase": ("coinbase.com",),
    "binance": ("binance.com",),
    "intuit": ("intuit.com", "quickbooks.com", "turbotax.com", "intuitcdn.net"),
    "quickbooks": ("quickbooks.com", "intuit.com"),
    "xero": ("xero.com",),
    "workday": ("workday.com", "myworkday.com", "myworkdayjobs.com", "workdaysuv.com"),
    "adp": ("adp.com", "workforcenow.adp.com"),
    "wetransfer": ("wetransfer.com", "we.tl"),
}

# How each brand is written for a person.
DISPLAY = {
    "microsoft": "Microsoft", "office365": "Office 365", "m365": "Microsoft 365", "o365": "Office 365", "outlook": "Outlook", "sharepoint": "SharePoint",
    "onedrive": "OneDrive", "google": "Google", "gmail": "Gmail", "apple": "Apple", "appleid": "Apple ID",
    "icloud": "iCloud", "amazon": "Amazon", "paypal": "PayPal", "docusign": "DocuSign", "dropbox": "Dropbox",
    "adobe": "Adobe", "linkedin": "LinkedIn", "facebook": "Facebook", "instagram": "Instagram",
    "netflix": "Netflix", "okta": "Okta", "salesforce": "Salesforce", "slack": "Slack", "zoom": "Zoom",
    "teams": "Microsoft Teams", "wellsfargo": "Wells Fargo", "chase": "Chase", "bankofamerica": "Bank of America",
    "dhl": "DHL", "fedex": "FedEx", "ups": "UPS", "usps": "USPS", "stripe": "Stripe", "github": "GitHub",
    "coinbase": "Coinbase", "binance": "Binance", "intuit": "Intuit", "quickbooks": "QuickBooks", "xero": "Xero",
    "workday": "Workday", "twitter": "X (Twitter)", "adp": "ADP", "wetransfer": "WeTransfer",
}

# Short names are common words or letters inside other words ("ups", "chase",
# "zoom"), so for these only an exact name counts, never a near spelling.
EXACT_ONLY = {name for name in BRANDS if len(name) < 6}

# Names that are only brands in a display name when they stand alone, because
# people's names and job titles contain them ("Teams", "Chase Miller").
WEAK_IN_DISPLAY_NAME = {"teams", "chase", "zoom", "ups", "apple", "slack"}

SHORTENERS = {
    "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly",
    "shorturl.at", "rb.gy", "t.ly", "tiny.cc", "bl.ink", "s.id", "v.gd", "qrco.de", "lnkd.in", "trib.al",
    # publishers' and brands' own short links
    "nyti.ms", "wapo.st", "bbc.in", "reut.rs", "cnn.it", "econ.st", "bloom.bg", "on.ft.com", "ft.trib.al", 
    "amzn.to", "amzn.eu", "a.co", "msft.it", "spoti.fi", "apple.co", "flic.kr", "redd.it", "youtu.be", "dlvr.it",
    "ift.tt", "zpr.io", "hubs.ly", "hubs.la", "sforce.co", "ibm.co", "gtnr.it", "aje.io", "nbcnews.to", "abcn.ws",
    "politi.co", "trib.in", "lat.ms", "theatln.tc", "wrd.cm", "engt.co", "tcrn.ch", "vrge.co", "mktw.net",
    "forms.gle", "g.page", "maps.app.goo.gl", "go.aws", "aka.ms", "msft.to", "lin.ee", "pin.it",
}

# Top-level domains that cost almost nothing and are used far more for scams
# than for real business. A small nudge only: plenty of real sites use them.
RISKY_TLDS = {
    "zip", "mov", "xyz", "top", "click", "country", "gq", "tk", "ml", "cf", "ga", "work", "rest", "cam",
    "icu", "cyou", "sbs", "quest", "monster", "beauty", "hair", "lol", "buzz", "surf", "live", "support",
    "help", "online", "site", "website", "shop", "loan", "kim", "men", "date", "review", "fit",
}

# Brand names that are also everyday words ("apple pie", "economic outlook",
# "sales teams"). In a web address these count only next to words phishers
# pair them with (login, account, delivery…) or when disguised (app1e).
COMMON_WORD_BRANDS = {"apple", "amazon", "chase", "zoom", "slack", "teams", "ups", "outlook", "stripe", "workday",
                      "adobe", "xero", "office365", "twitter"}

# Words phishers put next to a brand's name in an address they bought:
# microsoft-login.com, paypal-resolution-center.net, dhl-parcel-redelivery.com.
PHISHY_WORDS = {
    "login", "log", "signin", "sign", "logon", "verify", "verification", "validate", "secure", "security", "safe",
    "account", "accounts", "acct", "support", "help", "helpdesk", "service", "services", "update", "updates",
    "billing", "bill", "payment", "payments", "pay", "invoice", "auth", "sso", "id", "wallet", "recovery", "recover",
    "restore", "unlock", "unlocked", "locked", "alert", "alerts", "notice", "notification", "confirm", "portal",
    "online", "webmail", "mail", "mailbox", "office", "docs", "doc", "document", "documents", "drive", "share",
    "shared", "sharing", "file", "files", "fax", "voicemail", "voice", "meeting", "join", "invite", "message",
    "messages", "tracking", "track", "delivery", "redelivery", "parcel", "package", "shipment", "refund", "claim",
    "reward", "rewards", "gift", "bonus", "prize", "resolution", "case", "dispute", "limited", "apply",
    "review", "esign", "signature", "payroll", "hr", "benefits", "admin", "team", "verify", "access", "session",
    "reset", "password", "pass", "token", "mfa", "2fa", "otp", "authenticate", "authentication", "customer", "care",
    "desk", "web", "cloud", "storage", "quota", "upgrade", "renew", "renewal", "subscription", "suspended",
    "client", "connect", "user", "my", "app", "apps", "find", "iphone", "prime", "orders", "order",
}

# Words that mark a fan, news or developer site about a brand rather than a
# copy of it: awesome-github.dev, microsoft-teams-tips.com.
COMMUNITY_WORDS = {
    "awesome", "fan", "fans", "news", "blog", "blogs", "community", "forum", "forums", "tips", "tricks", "stats",
    "guide", "guides", "tutorial", "tutorials", "learn", "learning", "insider", "weekly", "daily", "meetup",
    "users", "usergroup", "group", "conf", "devs", "readme", "clone", "wiki", "podcast",
    "recipes", "recipe", "consulting", "rainforest", "pie", "valley", "lens", "line", "center", "fitness",
}

# Shared platforms where every customer gets its own space, named after
# itself: acme.atlassian.net, stripe.statuspage.io, google.github.io. A brand
# or our own name as the whole space name there is the real owner.
TENANT_PLATFORMS = {
    "atlassian.net", "zendesk.com", "freshdesk.com", "statuspage.io", "myworkdayjobs.com", "service-now.com",
    "servicenow.com", "greenhouse.io", "lever.co", "bamboohr.com", "okta.com", "oktapreview.com", "sharepoint.com",
    "github.io", "gitlab.io", "readthedocs.io", "my.salesforce.com", "force.com", "lightning.force.com", "box.com",
    "app.box.com", "webex.com", "zoom.us", "slack.com", "notion.site", "substack.com", "typeform.com",
    "smartsheet.com", "monday.com", "zohodesk.com", "helpscoutdocs.com", "intercom.help", "gitbook.io",
    "workable.com", "recruitee.com", "teamtailor.com", "auth0.com", "onelogin.com", "pingone.com", "awsapps.com",
    "visualstudio.com", "azurewebsites.net", "hubspotpagebuilder.com", "myshopify.com", "status.io",
}

# Free web hosts anyone can put a page on in a minute. Phishing pages live
# here a lot, so a brand's name here counts as much as in a bought domain.
FREE_HOSTS = {
    "web.app", "firebaseapp.com", "weebly.com", "wixsite.com", "glitch.me", "ngrok.io", "ngrok-free.app",
    "pages.dev", "workers.dev", "netlify.app", "vercel.app", "herokuapp.com", "blogspot.com", "000webhostapp.com",
    "r2.dev", "surge.sh", "repl.co", "replit.app", "onrender.com", "fly.dev", "square.site", "godaddysites.com",
    "webflow.io", "framer.app", "framer.website", "carrd.co", "wordpress.com", "sites.google.com", "ipfs.io",
    "github.dev", "codesandbox.io", "trycloudflare.com", "duckdns.org", "glitch.com", "start.page",
}

# Email services that send newsletters and notifications for other companies
# and route every link through themselves to count clicks. Their links never
# show the final address, so different link text proves nothing.
CLICK_TRACKERS = {
    "sendgrid.net", "list-manage.com", "hubspotlinks.com", "hubspotemail.net", "hs-sites.com", "mandrillapp.com",
    "mailgun.org", "awstrack.me", "pstmrk.it", "exacttarget.com", "createsend.com", "cmail19.com", "cmail20.com",
    "mailchi.mp", "rs6.net", "klclick.com", "klclick1.com", "klclick2.com", "klclick3.com", "pardot.com",
    "eloqua.com", "en25.com", "sparkpostmail.com", "mjt.lu", "sendibt2.com", "sendibt3.com", "sendibm1.com",
    "customeriomail.com", "intercom-clicks.com", "intercom-mail.com", "mlsend.com", "convertkit-mail.com",
    "convertkit-mail2.com", "ck.page", "beehiiv.com", "mcusercontent.com", "sfmc-content.com", "marketo.com",
    "mktoweb.com", "mkt.com", "mailerlite.com", "brevo.com", "constantcontact.com", "salesforce-communities.com",
    "emltrk.com", "mailtrack.io", "yesware.com", "outreach.io", "salesloft.com", "linkedin-ei.com", "substack.com",
    "e.customeriomail.com", "trk.klclick.com", "smartlinks.io", "click.convertkit-mail2.com",
}

# Ticketing and mailing services that legitimately set a different Reply-To.
REPLY_PLATFORMS = {
    "zendesk.com", "freshdesk.com", "helpscout.net", "intercom.io", "intercom-mail.com", "hubspot.com", "salesforce.com",
    "mailchimp.com", "list-manage.com", "sendgrid.net", "googlegroups.com", "groups.io", "servicenow.com",
    "service-now.com", "atlassian.net", "zohodesk.com", "kayako.com", "gorgias.com", "frontapp.com", "helpscoutapp.com",
}

# Free personal email providers.
FREEMAIL = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.co.uk",
    "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com",
    "gmx.net", "mail.com", "yandex.com", "yandex.ru", "zoho.com", "tutanota.com", "tuta.io", "hey.com", "fastmail.com",
    "inbox.com", "qq.com", "163.com", "web.de", "btinternet.com", "comcast.net", "att.net", "verizon.net",
}

# Words that sit next to a brand in the name a real service sends mail as
# ("PayPal Service", "Microsoft account team"). A display name made only of a
# brand and these words is claiming to be the brand.
SERVICE_WORDS = {
    "account", "accounts", "team", "security", "support", "service", "services", "billing", "notification",
    "notifications", "alert", "alerts", "admin", "administrator", "noreply", "no", "reply", "online", "customer",
    "care", "help", "desk", "helpdesk", "message", "messages", "center", "centre", "mail", "id", "pay", "payments",
    "update", "updates", "verification", "review", "sign", "docs", "drive", "calendar", "storage", "cloud", "protection",
    "inc", "llc", "ltd", "corp", "official", "the", "via", "and", "&", "365", "for", "business", "workspace", "teams",
    "outlook", "office", "web", "app", "voicemail", "fax", "scan", "scanner", "delivery", "shipping", "express",
    "tracking", "bank", "banking", "finance", "rewards", "prime", "store", "plus", "premium", "pro", "secure",
}

# Words in a display name that claim a position of trust inside a company.
ROLE_WORDS = {
    "ceo", "cfo", "coo", "cto", "ciso", "cio", "president", "chairman", "chairwoman", "chair", "director", "founder",
    "owner", "executive", "md", "vp", "finance", "payroll", "hr", "helpdesk", "help desk", "it support", "it helpdesk",
    "it department", "it team", "it service", "security", "administrator", "sysadmin", "accounts payable", "treasury",
}

# Real top-level domains seen often in link text. A word.word that ends in
# something else (report.pdf, Node.js) is a file name or product, not a site.
FILE_EXTENSIONS = {
    "pdf", "doc", "docx", "docm", "xls", "xlsx", "xlsm", "ppt", "pptx", "csv", "txt", "md", "json", "xml", "yaml",
    "yml", "html", "htm", "js", "ts", "jsx", "tsx", "py", "rb", "go", "java", "kt", "swift", "c", "h", "cpp", "cs",
    "php", "sh", "ps1", "png", "jpg", "jpeg", "gif", "svg", "webp", "heic", "zip", "rar", "7z", "gz", "tar", "exe",
    "msi", "dmg", "pkg", "mp4", "mov", "avi", "mp3", "wav", "m4a", "eml", "msg", "ics", "vcf", "log", "ini", "cfg",
    "key", "pages", "numbers", "sql", "db", "bak", "tmp", "iso", "img", "apk", "jar", "css", "scss", "vue", "rs",
}
GENERIC_TLDS = {
    "com", "net", "org", "io", "co", "ai", "app", "dev", "biz", "info", "me", "tv", "us", "uk", "eu", "xyz", "top",
    "online", "site", "shop", "store", "tech", "cloud", "live", "news", "page", "link", "click", "email", "pro",
    "gov", "edu", "mil", "int", "ly", "gl", "gg", "sh", "fm", "to", "so", "cc", "ms", "is", "it", "de", "fr", "es",
    "nl", "be", "ch", "at", "se", "no", "dk", "fi", "pl", "ie", "pt", "ca", "au", "nz", "jp", "in", "br", "mx", "za",
    "sg", "hk", "cn", "kr", "tw", "ru", "ua", "tr", "il", "ae", "sa", "ar", "cl", "id", "my", "ph", "vn", "th",
    "work", "help", "support", "zip", "mov", "icu", "buzz", "website", "space", "digital", "agency", "media",
    "solutions", "services", "global", "world", "group", "company", "business", "finance", "money", "bank",
}
