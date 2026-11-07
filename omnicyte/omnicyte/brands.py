"""The brands phishers pretend to be most often, and the domains that really are them.

A link or sender that uses one of these names, but is not on one of its real
domains, is a strong sign of a fake. The list is deliberately short: the
names that turn up in most business phishing. An organisation adds its own
domains in the policy file (see policy.py), which are checked the same way.
"""

BRANDS = {
    "microsoft": ("microsoft.com", "microsoftonline.com", "live.com", "office.com", "office365.com",
                  "outlook.com", "sharepoint.com", "onedrive.com", "azure.com", "windows.net",
                  "msft.net", "microsoft365.com", "skype.com", "bing.com", "xbox.com", "aka.ms"),
    "m365": ("microsoft.com", "office.com", "microsoft365.com", "microsoftonline.com"),
    "o365": ("microsoft.com", "office.com", "office365.com", "microsoftonline.com"),
    "office365": ("office.com", "office365.com", "microsoft.com", "microsoftonline.com"),
    "outlook": ("outlook.com", "live.com", "office.com", "microsoft.com", "office365.com"),
    "sharepoint": ("sharepoint.com", "microsoft.com"),
    "onedrive": ("onedrive.com", "live.com", "microsoft.com", "sharepoint.com"),
    "google": ("google.com", "gmail.com", "googleusercontent.com", "googleapis.com", "gstatic.com",
               "youtube.com", "goo.gl", "g.co", "withgoogle.com", "googlemail.com"),
    "gmail": ("gmail.com", "google.com", "googlemail.com"),
    "apple": ("apple.com", "icloud.com", "me.com", "apple.news"),
    "appleid": ("apple.com",),
    "icloud": ("icloud.com", "apple.com"),
    "amazon": ("amazon.com", "amazon.co.uk", "amazon.de", "amazon.ca", "amazon.in", "amazon.com.au",
               "amazonaws.com", "aws.amazon.com", "a2z.com", "amazon.jobs"),
    "paypal": ("paypal.com", "paypal.me", "paypalobjects.com"),
    "docusign": ("docusign.com", "docusign.net"),
    "dropbox": ("dropbox.com", "dropboxusercontent.com", "db.tt"),
    "adobe": ("adobe.com", "adobesign.com", "adobelogin.com", "acrobat.com"),
    "linkedin": ("linkedin.com", "lnkd.in", "licdn.com"),
    "facebook": ("facebook.com", "fb.com", "fb.me", "meta.com", "messenger.com"),
    "instagram": ("instagram.com",),
    "netflix": ("netflix.com",),
    "okta": ("okta.com", "oktacdn.com", "okta-emea.com"),
    "salesforce": ("salesforce.com", "force.com", "salesforce-sites.com"),
    "slack": ("slack.com", "slack-edge.com"),
    "zoom": ("zoom.us", "zoom.com", "zoomgov.com"),
    "teams": ("microsoft.com", "office.com", "live.com"),
    "wellsfargo": ("wellsfargo.com",),
    "chase": ("chase.com", "jpmorgan.com", "jpmorganchase.com"),
    "bankofamerica": ("bankofamerica.com", "bofa.com"),
    "dhl": ("dhl.com", "dhl.de", "dhl.co.uk"),
    "fedex": ("fedex.com",),
    "ups": ("ups.com",),
    "usps": ("usps.com",),
    "stripe": ("stripe.com",),
    "github": ("github.com", "githubusercontent.com", "github.io"),
    "coinbase": ("coinbase.com",),
    "binance": ("binance.com",),
    "intuit": ("intuit.com", "quickbooks.com", "turbotax.com"),
    "quickbooks": ("quickbooks.com", "intuit.com"),
    "xero": ("xero.com",),
    "workday": ("workday.com", "myworkday.com"),
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
    "workday": "Workday", "adp": "ADP", "wetransfer": "WeTransfer",
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
}

# Top-level domains that cost almost nothing and are used far more for scams
# than for real business. A small nudge only: plenty of real sites use them.
RISKY_TLDS = {
    "zip", "mov", "xyz", "top", "click", "country", "gq", "tk", "ml", "cf", "ga", "work", "rest", "cam",
    "icu", "cyou", "sbs", "quest", "monster", "beauty", "hair", "lol", "buzz", "surf", "live", "support",
    "help", "online", "site", "website", "shop", "loan", "kim", "men", "date", "review", "fit",
}
