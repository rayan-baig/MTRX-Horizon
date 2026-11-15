# Early access and creators

Two ways to have customers and money ready on launch day, before RankUp, CyberLogix AI and
OmniArmor.ai open:

1. **The early access list.** People leave their email for the apps they care about. Founding
   members get a launch discount. On launch day you send them one email from the console, with
   the discount code.
2. **The creator program.** YouTubers and other creators make videos about the apps and earn a
   share (20% by default) of what the people they send pay in their first year. Each creator
   gets a short link and a private dashboard.

Both are **off by default**. Until you switch one on, no page mentions it, and every address
that belongs to it answers "page not found".

The code: `horizon/early_access.py`, `horizon/creators.py`, `horizon/growth.py` (what they
share), `templates/early_access*.html`, `templates/_early_form.html`, `templates/creators.html`,
`templates/creator_dashboard.html`, `static/js/early-access.js`, `static/js/creators.js`,
`static/js/creator-dashboard.js`, `static/css/grow.css`, and `tests/test_growth.py`.

## The settings

| Setting | Default | What it does |
|---|---|---|
| `EARLY_ACCESS_ENABLED` | `0` | `1` switches the early access list on. The form shows only once email works too (below). |
| `FOUNDER_CODE_RANKUP` | empty | RankUp's founding member code: a Stripe promotion code you make (see below), such as `FOUNDER20` |
| `FOUNDER_CODE_CYBERLOGIX` | empty | the same for CyberLogix AI |
| `FOUNDER_CODE_OMNIARMOR` | empty | the same for OmniArmor.ai |
| `FOUNDER_PERCENT_OFF` | empty | the percent the codes take off, such as `20`. Shown only for an app that has a code; with no code the page promises "a launch discount" and no number |
| `MTRX_POSTAL_ADDRESS` | empty | the company's postal address, printed at the foot of every email. **Launch emails can't be sent until it is set.** A PO box or a registered business address is fine |
| `EARLY_ACCESS_EMAIL_FROM` | `MTRX_ALERT_FROM` | the address early access and creator emails come from |
| `EARLY_ACCESS_SEND_PER_MINUTE` | `20` | launch emails go one at a time, at most this many a minute |
| `CREATORS_ENABLED` | `0` | `1` switches the creator program on |
| `CREATOR_PERCENT` | `20` | the share a creator earns, 1 to 100 |
| `CREATOR_MONTHS` | `12` | for how long after someone starts paying ("first year" when 12) |

Emails go through the mail server you already use for alerts (`MTRX_SMTP_HOST`,
`MTRX_SMTP_PORT`, `MTRX_SMTP_USER`, `MTRX_SMTP_PASSWORD`). Creator applications are emailed to
`MTRX_CONTACT_EMAIL` (or `MTRX_ALERT_EMAIL` if that is empty). Links in emails use
`MTRX_PUBLIC_URL` (`https://mtrxhorizyn.com` on the live site).

## The early access list

**Where the form is.** While it is on, the home page's first button is **Get early access**,
each app's card has an **Early access** button (instead of "Open soon") and each app's Learn
more card has one too. Each opens the form over the page, with that app already ticked. There
is also a page of its own, `/early-access` (`/early-access?app=rankup` ticks RankUp), linked
from the footer and the menu.

**The form** asks for an email address, which apps (tick boxes), and "I'm a grown-up (18+)".

**Double opt-in.** We email a link; only people who press it are on the list ("confirmed").
Until then they are "unconfirmed", and they are deleted after 7 days if they never press it.
The form says the same thing whether or not an address is already on the list, so nobody can
use it to find out who is.

**What is kept:** the email address and the apps. Nothing else: no name, no age (the 18+ box
must be ticked, and isn't stored), no network address. Someone who came through a creator's
link has the creator's code kept until they confirm; then it is counted for the creator and
cleared.

**Unsubscribing.** Every email ends with a one-click unsubscribe link, and has a
`List-Unsubscribe` header with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so the
Unsubscribe button in Gmail, Apple Mail and others removes the person in one click, with no
page at all. The link in the email opens a page with one **Unsubscribe** button (a link
checker opening the link can't unsubscribe anyone by accident). Unsubscribing deletes the
person from the list. Unsubscribe links keep working even if you switch early access off later.

**Limits.** Each address may join 5 times an hour and 20 a day; one email address gets at most
3 confirmation emails a day; at most 500 confirmation emails go out a day in all; and a
network address that tries 30 wrong confirm or unsubscribe links in an hour waits. The tries
are counted the way failed sign-ins are, and deleted after a day.

### Founding member codes (Stripe)

For each app, once its prices exist in Stripe:

1. Stripe dashboard → **Product catalog → Coupons → New**: for example "Founding member",
   20% off, duration **Once** (or "Repeating" for a few months, if you prefer). Under
   **Apply to specific products**, pick that app's product.
2. On the coupon, **Create promotion code**: type the code people will enter, such as
   `FOUNDER20`. You can limit it to first-time orders and set an end date.
3. Make sure the app's checkout allows promotion codes.
4. Set `FOUNDER_CODE_RANKUP` (or `_CYBERLOGIX`, `_OMNIARMOR`) to the code, and
   `FOUNDER_PERCENT_OFF` to the percent. If you use different percents for different apps,
   leave `FOUNDER_PERCENT_OFF` empty: the page then promises a launch discount without a number.

The page only ever shows a number when the app has a code and the percent is set.

### Sending the launch email

In the console, **Early access** shows each app's confirmed and unconfirmed people, and any
setting still missing. When an app opens:

1. Press **Write launch email** on that app (or pick it in the form).
2. Write a short subject and message. The email adds, at the bottom: the app's founding member
   code and the percent off, the app's address (once it is released with one), an unsubscribe
   link and your postal address.
3. Press **Preview**: you see the email as it will arrive and how many people it will go to.
4. Press **Send**. It goes to everyone confirmed for that app, one at a time, at most
   `EARLY_ACCESS_SEND_PER_MINUTE` a minute, and carries on by itself after a restart. The list
   under the form shows each email's progress.

**Each person gets a given email once.** An email is known by its app, subject and words.
Pressing Send twice, or sending the same email again next week, only reaches people who
confirmed since and haven't had it. Each email is marked as being sent before it goes, so even
a crash in the middle can't send it twice.

Sending is **blocked**, with the reason shown in the console, until `MTRX_POSTAL_ADDRESS` is
set, email works, and the app has its founder code (the page promised founding members a
discount).

## The creator program

**The page,** `/creators`, says it plainly: "Make videos about our apps, earn 20% of what your
viewers pay in their first year" (from `CREATOR_PERCENT` and `CREATOR_MONTHS`). The
application asks for a name, channel link, audience size, email, which app (or "not sure
yet"), and "I'm 18 or over, or my parent or guardian is applying for me". Each address may
apply 3 times an hour and 10 a day.

**Applications** are emailed to you and listed in the console's **Creators** section.

**Approving.** Pick the app their link goes to and press **Approve**. The creator gets:

- a short link, `https://mtrxhorizyn.com/c/<code>` (six letters and digits);
- a private dashboard key (`CR-XXXX-XXXX-...`, 120 random bits). It is shown to you once in the
  console and emailed to the creator with their link. Only its SHA-256 is kept, so nobody can
  read it back, not even from the database. **New key** makes a fresh one (each creator keeps
  their 3 newest). **Decline** or **Remove** deletes everything about them, and the link stops.

**The short link** counts the click, then forwards:

- before the app opens: to that app's early access form here, `/early-access?app=…&ref=<code>`,
  so early access sign-ups through it are counted for the creator (once each, when confirmed);
- once the app is released with an address: to that address with `?ref=<code>` added, for the
  app to credit the creator.

Where it forwards is worked out from the creator's app alone; nothing in the request can
change it, so it can't be used to send people to another site. It only forwards to
`mtrxhorizyn.com`, its subdomains, or the host in the app's own `RANKUP_URL` /
`CYBERLOGIX_URL` / `OMNIARMOR_URL` setting.

**Clicks are counted without keeping anyone's address.** Each visitor's address is turned
into a mark with a random key that changes every day; the same visitor counts once a day, and
the marks and that day's key are deleted after two days, so they can't be traced back. The
limit on clicks (120 an hour per visitor) is counted by the same mark. Someone over the limit
still gets where they were going; they just aren't counted.

**The dashboard,** `/creators/dashboard`: the creator pastes their key (the browser can
remember it). It shows their link, clicks and sign-ups for the last 30 days and in all, a chart
of each day, and what they've earned, been paid and are still owed. The key is sent in a
header, never a cookie. 20 wrong keys an hour from one address and it waits.

**Money is written down by hand.** In the console, under each approved creator, choose
**Earned** or **Paid to them**, type the amount and a note, and press **Write it down**. Nothing
here moves any money: you work out what the people a creator sent paid (from the app's Stripe
data and the `ref` code), and pay the creator yourself.

## The console's Numbers page

While either is on (or has ever been used), Numbers shows:

- **Early access:** confirmed people, new this week, confirmed and unconfirmed per app, launch
  emails sent.
- **Creators:** approved creators and applications waiting, clicks and sign-ups in the last 30
  days, and what is earned, paid and owed.

## Privacy

The privacy page gains one short line about each while it is on. Unconfirmed sign-ups go after
7 days; unsubscribing deletes the person; creator applications are kept to run the program and
deleted when you decline or remove them.

## Switching on, step by step

1. Make sure email works: `MTRX_SMTP_*` set (the console's app list says "Emails you after …"
   when alerts are set up), and `EARLY_ACCESS_EMAIL_FROM` set to an address on your domain.
2. Set `MTRX_POSTAL_ADDRESS`.
3. Make the founder codes in Stripe and set `FOUNDER_CODE_*` and `FOUNDER_PERCENT_OFF`.
4. Set `EARLY_ACCESS_ENABLED=1`. Sign up yourself from your phone to see the email arrive.
5. Set `CREATORS_ENABLED=1` (and `CREATOR_PERCENT` / `CREATOR_MONTHS` if not 20% for 12
   months). Apply yourself, approve yourself, and open your dashboard.
