# MTRX Horizyn

The website for MTRX Horizyn, the parent company of **RankUp**, **CyberLogix AI** and
**OmniArmor.ai**, plus a private control console that only the owner can open.

- **The home page** (`/`) shows the three apps, what each one does, and what the company
  stands for. Every number on it is true.
- **Genesis** (`/genesis`, or `genesis.mtrxhorizyn.com` once
  [moved](#genesis-and-orbyt-on-their-own-addresses)) is where anyone can turn an idea into a
  project and take it from Spark to Launch. See [Genesis](#genesis).
- **Orbyt** (`/orbyt`, or `orbyt.mtrxhorizyn.com` once moved) is where people pitch an idea,
  partner with the company, or write as an investor or buyer.
- **Pilot** is the AI assistant on every public page: a small robot in the corner that runs on
  the visitor's own AI key, from their browser. See [docs/PILOT.md](docs/PILOT.md).
- **The control console** (`/console`) shows how the apps and this server are doing. It has
  no link anywhere and looks like a missing page to everyone else.

## How the console is locked

No password, no fingerprint, no face scan, and nothing physical to lose. Three locks,
all checked by the server:

1. **Only approved devices.** When a phone or laptop is approved, its browser makes a
   secret key that never leaves the device. Not even the page's own code can read it.
   To get in, the device signs a fresh random puzzle with that key. A copied cookie
   is useless without the key.
2. **New devices are approved by QR code** from a device that's already signed in. The
   code works once, for 10 minutes.
3. **The secret knock.** On the home page, tap the logo and the app icons in your own
   secret order. The right order opens the console for 5 minutes. The order is kept
   only in the server's settings, never in the page. Only an approved device's knock
   is looked at (anyone else is never told whether theirs was right), and each device
   gets 8 tries per 15 minutes.

Anyone who fails any lock sees the normal "page not found".

### The first time

1. In the hosting settings, set:
   - `MTRX_KNOCK`: your secret order, at least 4 taps, using these names:
     `logo` (the top-left logo), `mark` (the logo lower down the page), `rankup`,
     `cyberlogix`, `omniarmor` (the three app icons). Example: `logo logo omniarmor rankup mark`.
     Don't use the example. Make up your own and tell nobody.
   - `MTRX_SETUP_TOKEN`: a long random code (Render makes one for you).
2. On your laptop, open `https://mtrxhorizyn.com/console/add/<the setup code>`, name the
   device, and press **Approve this device**. You're in.
3. In the console, press **Approve a device** and scan the QR code with your phone.

The setup code works once. After that, new devices are approved by QR.
**Then delete `MTRX_SETUP_TOKEN` from the hosting settings.** "Used once" is
remembered in the database, so if the database were ever lost (a disk reset, a
move to a plan without a disk) the same code would work again for whoever had
it. With the setting gone there is no code to reuse. If you ever need to set up
from scratch, put a new random one in, use it, and delete it again.

### Every day

Go to the home page, do the knock, and wait a second. Your device unlocks itself.
Sessions last 12 hours, and **Sign out** ends one early.

**Keep at least two devices approved** (say, your laptop and your phone). A device's
key lives in that browser's saved data, and a browser can lose it: clearing history
does, and Safari on iPhone can clear a site's data after about a week without a
visit. If one device loses its key, open the console on the other and approve it
again with a new QR code. With only one device approved, losing its key means
setting up from scratch with a new setup code.

On iPhone, use the console in Safari. Don't rely on adding it to the Home Screen:
a Home Screen app has its own storage, separate from Safari, so a phone approved in
Safari is not approved inside the Home Screen app.

### If a device is lost or stolen

- From another approved device, open **Approved devices** and press **Remove**. It's
  locked out straight away, even if it was signed in.
- A thief would also need your knock, and your phone's own lock screen protects it.
- **If every device is lost:** in the hosting settings, set `MTRX_SETUP_TOKEN` to a new
  long random code (at least 16 characters) and save, which restarts the site. Then use
  step 2 above with the new code. In the console, remove the lost devices under
  **Approved devices**, and delete `MTRX_SETUP_TOKEN` again. The old code never works
  again, and the new one works once. Only someone with the hosting account can do this,
  so keep that account safe.

## The domain, and the apps' subdomains

MTRX Horizyn is the company, and it has the one domain. RankUp, CyberLogix and
OmniArmor are its products: they have no domains of their own, and each lives on a
subdomain of MTRX Horizyn's: **mtrxhorizyn.com**.

| Address | What is there |
|---|---|
| `mtrxhorizyn.com` and `www.mtrxhorizyn.com` | This site: the home page and the console |
| `genesis.mtrxhorizyn.com` | Genesis (this same app; see [below](#genesis-and-orbyt-on-their-own-addresses)) |
| `orbyt.mtrxhorizyn.com` | Orbyt (this same app) |
| `rankup.mtrxhorizyn.com` | RankUp |
| `cyberlogix.mtrxhorizyn.com` | CyberLogix |
| `omniarmor.mtrxhorizyn.com` | OmniArmor |

**Subdomains, not folders** (`mtrxhorizyn.com/rankup`). A browser treats each subdomain as
a separate site for cookies, saved data and installed web apps, so a sign-in on one
app never reaches another, and none of them reaches the console. To keep it that way:

- No site sets a cookie with a `Domain` (each cookie belongs to its own exact
  address). This site's cookies have none, and the tests check it.
- No site lets another one read its answers (no CORS for siblings), and this site only
  accepts changes from its own pages. The other subdomains count as "the same site" to
  a browser, so the console checks the exact address, not just the site.
- No page can be shown inside another site's frame.

**Setting it up**, on the host that runs each one (Render here):

1. **This site:** in Render, the service's Settings, Custom Domains, add `mtrxhorizyn.com`
   and `www.mtrxhorizyn.com`. At whoever manages the domain's DNS, add the records Render
   shows (for the bare domain usually an `A` record or an `ALIAS`/`ANAME`; for `www` a
   `CNAME` to the service's `onrender.com` address). Render redirects one to the other
   and gets the HTTPS certificate itself. `MTRX_PUBLIC_URL=https://mtrxhorizyn.com` (set
   in `render.yaml`) has QR codes, the sitemap, `robots.txt` and link previews use it.
   Unset, they use the address the visitor came in on.
2. **Each app:** add a `CNAME` named `rankup`, `cyberlogix` or `omniarmor` pointing at
   that app's own host, add the same name in that host's custom-domain settings, wait
   for HTTPS, and set the app's own address setting to it: CyberLogix's
   `PUBLIC_BASE_URL`, OmniArmor's `BASE_URL`, and RankUp's `PUBLIC_SITE_URL`. Leave each app's
   allowed-origins setting (such as CyberLogix's `CYBERLOGIX_ALLOWED_ORIGINS`) unset:
   never `*`, and never this domain or a sibling. Each app's deploy guide has the steps.
3. **Here:** point the settings below at the subdomains, always starting with `https://`.
   `render.yaml` sets these, and the health addresses below, for the live service; a copy
   made by hand (such as staging) sets its own or leaves them empty:

   | Setting | Value |
   |---|---|
   | `RANKUP_URL` | `https://rankup.mtrxhorizyn.com` |
   | `CYBERLOGIX_URL` | `https://cyberlogix.mtrxhorizyn.com` |
   | `OMNIARMOR_URL` | `https://omniarmor.mtrxhorizyn.com` |
   | `RANKUP_STATS_URL` | `https://rankup.mtrxhorizyn.com/api/stats` |
   | `CYBERLOGIX_STATS_URL` | `https://cyberlogix.mtrxhorizyn.com/api/stats` |
   | `OMNIARMOR_STATS_URL` | `https://omniarmor.mtrxhorizyn.com/api/stats` |

### Genesis and Orbyt on their own addresses

Genesis and Orbyt are part of this site, but each can have its own address, like the apps:
**genesis.mtrxhorizyn.com** and **orbyt.mtrxhorizyn.com**. The same service answers all three;
it looks at the address a visitor used and shows Genesis or Orbyt at the top (`/`). Until you
switch it on they stay at `mtrxhorizyn.com/genesis` and `mtrxhorizyn.com/orbyt`.

**To switch it on, in plain words** (about 15 minutes, plus waiting for DNS):

1. **Tell Render about the two addresses.** In Render, open the MTRX Horizyn service, then
   **Settings**, then **Custom Domains**. Press **Add Custom Domain**, type
   `genesis.mtrxhorizyn.com`, and save. Do the same for `orbyt.mtrxhorizyn.com`. Render then shows,
   for each one, the address it should point at (the service's own `...onrender.com` address).
2. **Add two DNS records** where you manage the domain's DNS (the company you bought
   mtrxhorizyn.com from, or Cloudflare if you moved it there). Add a record for each:

   | Type | Name (or Host) | Value (or Target / Points to) |
   |---|---|---|
   | `CNAME` | `genesis` | the `...onrender.com` address Render showed |
   | `CNAME` | `orbyt` | the same `...onrender.com` address |

   Leave TTL as it is ("Auto" or 1 hour). If you use Cloudflare, set the little cloud to grey
   ("DNS only") so Render can make the certificate. Don't touch the records that are already
   there (the main domain, `www`, `rankup`, `cyberlogix`, `omniarmor`, and the email ones).
3. **Wait for both to say "Verified" and "Certificate issued"** in Render's Custom Domains list.
   That's usually a few minutes, sometimes an hour or two. Check by opening
   `https://genesis.mtrxhorizyn.com/healthz` and `https://orbyt.mtrxhorizyn.com/healthz`: each
   should answer `"ok": true` with a padlock.
4. **Switch it on.** In Render, the service's **Environment**, add `MTRX_APP_SUBDOMAINS` with the
   value `1`, and save (the site restarts by itself in a minute or so).
5. **Point Stripe's webhooks at the new addresses** (optional, the old ones keep working): Genesis
   Pro's at `https://genesis.mtrxhorizyn.com/api/genesis/pro/stripe` and Pitch Review's at
   `https://orbyt.mtrxhorizyn.com/api/orbyt/review/stripe`. Nothing else in Stripe changes: the
   site tells Stripe where to send buyers back each time.

That's all. From then on:

- `mtrxhorizyn.com/genesis` and `mtrxhorizyn.com/orbyt` (and anything after them, such as
  `/orbyt#pitch`) send visitors to the new addresses, so old links and bookmarks still work.
- Every link on the site, Pilot's answers, the sitemap, link previews, the Pro key email and
  Stripe's "back to the site" addresses use the new ones.
- **Nobody loses their Genesis projects.** Genesis keeps projects in the visitor's own browser,
  and a browser keeps each address's saved data separate. So the first time someone opens
  Genesis at its new address, it quietly asks the old address (once) for anything Genesis saved
  there and brings it over, saying "Your projects moved here". The projects travel inside the
  browser, in the part of the address after `#`, which browsers never send to any server; a
  one-time code made in that tab means a link someone made up can't put projects into anyone's
  browser. If someone has saved a very large amount, the old address offers it as a file to
  download, and they press **Import** on Genesis. Pilot's own settings (such as an AI key a
  visitor added) are not moved: they add it again at the new address.

To undo it, delete `MTRX_APP_SUBDOMAINS` (or set it to `0`). The redirects are only kept by
browsers for a day, so within a day everything is back at `/genesis` and `/orbyt`. Projects made
at the new address stay there; visitors can move them with **Download** and **Import**.

Two more settings, only if the addresses are ever different: `MTRX_GENESIS_HOST` and
`MTRX_ORBYT_HOST` (default `genesis.mtrxhorizyn.com` and `orbyt.mtrxhorizyn.com`). A staging copy
leaves `MTRX_APP_SUBDOMAINS` unset. On your own computer it stays off too, so `/genesis` and
`/orbyt` work as before.

**How it stays safe:** each address is its own site to a browser. Genesis and Orbyt set no
cookies, and the console's cookies belong to `mtrxhorizyn.com` alone. Neither address can open
the console or any API but its own (they answer "page not found"), no address lets another read
its answers, every change must come from a page on the exact same address, every address sends
the same strict security headers (including HTTPS-only), and nothing is shared between them
except what a visitor chooses to bring.

**Email.** Everything is sent from the one domain, so the records that keep mail out of
spam are set up once, on `mtrxhorizyn.com`, at whoever manages its DNS, using the values the
email provider gives: **SPF** (which servers may send for the domain), **DKIM** (a
signature on each message) and **DMARC** (what to do with mail that fails those two).
Each app then sends from an address of its own, such as `no-reply@cyberlogix.mtrxhorizyn.com`
or `no-reply@omniarmor.mtrxhorizyn.com`, so people can tell them apart. A sending subdomain
must be verified with the provider as well (it adds a DKIM record for it), and the
parent domain's DMARC covers it. Check the records with any free DMARC checker before
real customers depend on the mail. Every app's terms, privacy page and emails name
MTRX Horizyn as the company behind it.

## Connecting the apps

The console shows "Not connected" until an app is connected. Nothing is ever made up.
To connect an app, give it a small private stats address that answers with JSON:

```json
{ "users": 120, "active_users": 30 }
```

Then set, for example, `RANKUP_STATS_URL=https://rankup.mtrxhorizyn.com/api/stats`. If
`MTRX_STATS_KEY` is set, the console sends it as `Authorization: Bearer <key>`, and the
app should refuse requests without it. The console saves each app's numbers once an hour
to draw the chart and work out uptime.

All three apps already have this address built in, off until they are given the key.
Pick one long random key, then:

| App | In that app's hosting settings | In this site's settings |
|---|---|---|
| RankUp | `STATS_KEY=<the key>` | `RANKUP_STATS_URL=https://rankup.mtrxhorizyn.com/api/stats` |
| CyberLogix | `STATS_KEY=<the key>` | `CYBERLOGIX_STATS_URL=https://cyberlogix.mtrxhorizyn.com/api/stats` |
| OmniArmor | `STATS_KEY=<the key>` | `OMNIARMOR_STATS_URL=https://omniarmor.mtrxhorizyn.com/api/stats` |

and `MTRX_STATS_KEY=<the key>` here once. Each app answers with two counts and its daily usage
totals (see [Numbers](#numbers-what-people-do-in-each-app)), nothing about anyone. A wrong or missing key gets "unauthorized"; an app without `STATS_KEY` acts as if
the address does not exist.

To show an **Open app** button on the home page, set `RANKUP_URL`, `CYBERLOGIX_URL` or
`OMNIARMOR_URL` to the app's whole address on its subdomain, such as
`https://rankup.mtrxhorizyn.com`. An address without `https://` shows no button, rather
than a link to nowhere.

If an app has a public demo with pretend data, set `RANKUP_DEMO_URL`, `CYBERLOGIX_DEMO_URL` or
`OMNIARMOR_DEMO_URL` to its whole address: that app's Learn more card then links to it ("See the
demo (pretend data)") and its What's new items say "In the demo" instead of "Preview". Unset, no
demo link is shown.

**Launch day: `MTRX_OPEN_APPS`.** An address alone doesn't open an app to the public. Until
an app's key is in `MTRX_OPEN_APPS` (`rankup,cyberlogix,omniarmor`, or `all`), every page says
it is in development ("3 in development" on the home page, "In development" on Orbyt's app cards),
and nothing links to its address: no Open button, no bundle trial link, creator links go to
its early access form. Name it there and every page changes together (`horizon/catalog.py`,
`apps_line` and `opening`).

## Admin links and costs in the console

Each app's card in **Our platforms** has an **Admin →** link to that app's own admin
page, made from its address (`RANKUP_URL` and so on): RankUp's operator page
(`/#/operator`), CyberLogix's console (`/console`) and OmniArmor's front page (its owner
signs in to the app itself). Set `RANKUP_ADMIN_URL`, `CYBERLOGIX_ADMIN_URL` or
`OMNIARMOR_ADMIN_URL` to send a link somewhere else.

The **Monthly costs** panel lists what each part costs to run each month. The figures
live in `horizon/costs.py` and match `docs/RUNNING-MTRX-HORIZYN.md`; change both
together when a price changes.

## Versions

`VERSION` holds the version number. It shows at the foot of the home page and the
console, and in `/healthz`. Each new version gets a short entry at the top of
`CHANGELOG.md`; a test fails if the number has no entry.

## App health, and being told when an app is down

The console's **Our platforms** panel shows, for each app on one screen: up or down
right now (with how long it took to answer, or how long it has been down), its users,
its uptime over 7 days, the last 24 hours as one bar per half hour, and its outages in
the last week. It needs each app's public health address:

| Setting | Value |
|---|---|
| `RANKUP_HEALTH_URL` | `https://rankup.mtrxhorizyn.com/api/health` |
| `CYBERLOGIX_HEALTH_URL` | `https://cyberlogix.mtrxhorizyn.com/api/health` |
| `OMNIARMOR_HEALTH_URL` | `https://omniarmor.mtrxhorizyn.com/healthz` |

The server asks each one once a minute, whether or not the console is open, with a
4-second limit and no key. Any 2xx answer is up; anything else, a redirect, or no answer
in time is down. Use the final address, starting `https://`. Checks are kept for 31 days.

When an app has been down for `MTRX_ALERT_MINUTES` (5 if unset), the console's
**Recent activity** says so, and, if email is set up, you get an email. Then:
one "back up" email when it recovers, a reminder every 6 hours while it stays down,
never two "down" emails for the same app within an hour, and at most 12 emails a day.
To set up email, use any email provider's SMTP details:

| Setting | Value |
|---|---|
| `MTRX_ALERT_EMAIL` | where alerts go |
| `MTRX_SMTP_HOST` | the provider's SMTP server |
| `MTRX_SMTP_PORT` | `587` (STARTTLS, the default) or `465` |
| `MTRX_SMTP_USER`, `MTRX_SMTP_PASSWORD` | the login the provider gives you |
| `MTRX_ALERT_FROM` | the sender, such as `alerts@mtrxhorizyn.com` (defaults to the login) |

Mail is only sent encrypted. A server that offers no encryption is refused (except one
on the same machine), and the console shows "Alert email failed". The console shows
whether email is set up, never the address or the login.

The same email also tells you when the site itself hits an error it did not expect:
when, which version, the method and path, the kind of error and where in the code. It
never includes anything about the visitor (no query string, cookies, headers or
address), and words in the error that look like an email address or a code are
blanked out. At most one email an hour for each error, and 20 a day. Every error also
shows in the console's **Recent activity**.

## Business enquiries

Set `MTRX_CONTACT_EMAIL` to the address business enquiries should go to, such as
`hello@mtrxhorizyn.com`. The home page's About card, its footer and menu, and the privacy
and terms pages then show it as an email link. Unset (or not a plain address), the home page
still gives visitors somewhere to write: its "Questions?" line, About card and footer show the
general help address, `help@mtrxhorizyn.com` (`config.HELP_EMAIL`), and the other pages show no
address. Nothing is ever sent to that address from the site, so create that mailbox too
([RUNNING-MTRX-HORIZYN.md](docs/RUNNING-MTRX-HORIZYN.md), "Answering customers"). Partners, ideas
and investors have their own place: [Orbyt](#chroma-vortex).

## Privacy and terms

`/privacy` and `/terms` are this site's own, in plain words. Each app has its own. The
privacy page has to stay true to the code: if the site starts keeping, logging or setting
something new, change the page in the same commit (the tests check the cookie names and how
long each lasts, that visitors get no cookies, and that failed tries go after a day).

## Genesis

`/genesis` is a feature for every visitor, linked from the home page's menu and footer: a
place to turn an idea for an app or a small business into a project. A project has a name, a
one-line pitch, who it's for and a web address idea (suggested from the name, and checked to
be a real address shape). It moves through **Spark → Plan → Build → Launch**, forward or back,
with a launch checklist in plain words grouped by stage (check the name is free, talk to
people it's for, the simplest first version, try it with 3 real people, a privacy page, a way
to contact you, backups, a launch day...), progress per stage and overall, and notes. The list
shows every project as a card, with an empty state that invites the first idea.

- **The first minute:** the top of the page says what Genesis is in one line, with **Start my
  idea**, **Try an example** (`/genesis#example` opens the form filled with one of
  `GenesisStore.EXAMPLES`; nothing is saved until Start is pressed) and three "how it works" steps.
  The row of counts per stage shows only once there are projects.
- **Your next step:** each project shows the first open step of its stage at the top, with a
  **Done** button, or **Move to (next stage)** once a stage is finished.
- **Today's spark:** a new idea prompt every day (`GenesisStore.PROMPTS`, the same for everyone
  on the same day), answered in one line and kept only in the browser (`mtrx-genesis-daily`).
  A streak counts the days in a row; every streak has one **freeze** that covers a single missed
  day, earned back after 7 more answers. No reminders, no countdowns. **Turn it into a project**
  opens the form with the answer as the pitch.
- **Idea cards:** **Make an idea card** draws the project's name, pitch, who it's for and
  progress as a picture in the browser (a `<canvas>`), to save, share with the phone's own share
  menu, or copy as words. Never the notes or ticks, and no link carries an idea, so nothing a
  visitor wrote ends up on a page of ours for others to see.

**Nothing about a project is kept on the server** (unless a Genesis Pro member backs their
projects up, below). Projects live only in the visitor's own browser (`localStorage`). If the browser blocks storage, Genesis still works for that visit
and says so. **Download** saves every project as a JSON file, **Import** reads one back (to
move to another device), and **Delete all** clears them. The privacy page says the same.

The rules and the saving are in `static/js/genesis-store.js`, which has no page code in it, so
Node can test it: `node --test tests/js/genesis_store.test.js` (the Python tests run it too,
with `tests/js/vortex_handoff.test.js` for the hand-off to Orbyt).

### Ask Genesis: free AI help

On a project, **Ask Genesis** offers a few helpers ("Sharpen my pitch", "Who might use this?",
"Simplest first version", "Name ideas", "What could go wrong?", "What should I do next?") and
one short question. The answer shows on the page and can be saved into the project's notes,
which are still only in the browser.

Only when a button is pressed, the page sends the project's name, pitch, who it's for and
stage, and the question, to `POST /api/genesis/ask`, which passes exactly those to the AI
provider (Anthropic, through its Python SDK) and returns the answer. The text is never stored
or logged, and failures are logged by their kind only. A fixed system prompt keeps answers
short, plain and on the idea, refuses unsafe or off-topic requests, and never asks for
personal details. The panel tells people not to type any.

It is **off until two settings are set**:

| Setting | Value |
|---|---|
| `GENESIS_AI_KEY` | an API key from the Anthropic Console |
| `GENESIS_AI_MODEL` | set GENESIS_AI_MODEL to a current model id from Anthropic's model list |

No model id is written anywhere in this repository; change the setting to change the model.
Without both, the panel says AI help isn't switched on yet and the rest of Genesis works.

Free means the company pays, so it is fenced in:

| Setting | Default | What it does |
|---|---|---|
| `GENESIS_AI_PER_HOUR` / `GENESIS_AI_PER_DAY` | 3 / 5 | asks per visitor, counted by address (no cookie); the address and time are kept 24 hours |
| `GENESIS_AI_DAILY_CAP_USD` | 2 | the most all asks together may cost in a UTC day |
| `GENESIS_AI_INPUT_PRICE` / `GENESIS_AI_OUTPUT_PRICE` | 10 / 50 | the model's US dollars per million tokens, for the estimate; set them to the real prices |
| `GENESIS_AI_EFFORT` | `low` | how hard the model thinks; empty sends nothing, for a model that doesn't take it |

Before each ask, the most it could cost is set aside against the day's cap; when the answer
arrives, that is replaced by its real cost from the token counts. Each answer is at most 1,200
tokens and each request a few hundred words. A visitor over their limit is told which limit
and when more come ("You've used 3 this hour; more in 40 minutes"), everyone gets a friendly
message once the cap is reached, and the provider is not called. Each free answer says how many
are left today, and `GET /api/genesis/ask` (a plain read that counts nothing) lets the page show
"4 of 5 left today" before the first ask. Timeouts (30 seconds,
5 to connect) and provider errors also get a friendly message, and so does an ask made while 8
others are already waiting on a slow provider, so the rest of the site never waits behind them. Set a monthly spend limit in the Anthropic
Console as well, as a second fence.

### Genesis Pro: the paid upgrade

**Genesis Pro** ([docs/GENESIS-PRO.md](docs/GENESIS-PRO.md)) is an optional subscription, about
$4.99 a month or $49.90 a year ("2 months free"), for the people who use Genesis most. The free
plan does not change. Pro adds up to 100 Ask Genesis answers a day (the member's own, not the
shared free budget), longer and more detailed answers, three more helpers (a four-week plan,
words for a one-page website, price ideas), a private cloud backup of the member's projects, and
**Download plan** (a project as a text file). Nothing a member makes is ever published or shared.

It is **off until `GENESIS_PRO_ENABLED=1`**, Stripe is set up, email works and Ask Genesis is on
(`GENESIS_AI_KEY` and `GENESIS_AI_MODEL`: most of Pro is more Ask Genesis); until then no page mentions it
and every Pro address is "page not found". Payment is a Stripe Checkout subscription, and
Stripe's signed webhook is the only thing that makes anyone Pro or stops them (cancelled,
payment failed, refunded, disputed). There are no accounts: the buyer gets a **Pro key** on the page Stripe
sends them back to and by email, the browser keeps it and sends it in a header with Pro
requests, and only SHA-256 fingerprints of keys and of the buyer's email are stored. The buy
button says a grown-up pays and checkout is for adults.

| Setting | Default | What it does |
|---|---|---|
| `GENESIS_PRO_ENABLED` | `0` | `1` switches Pro on, once the next three are set and email works |
| `STRIPE_SECRET_KEY` | empty | Stripe's (restricted) secret key |
| `GENESIS_PRO_STRIPE_WEBHOOK_SECRET` | empty | the signing secret of `https://mtrxhorizyn.com/api/genesis/pro/stripe` |
| `GENESIS_PRO_STRIPE_PRICE` / `GENESIS_PRO_YEARLY_STRIPE_PRICE` | empty | the monthly and yearly price ids; Stripe holds the amounts |
| `GENESIS_PRO_PRICE_TEXT` | `$4.99` | the monthly price as written on the page while Stripe's figure can't be read |
| `GENESIS_PRO_PER_DAY` / `GENESIS_PRO_PER_HOUR` | 100 / 30 | Ask Genesis answers per member |
| `GENESIS_PRO_MONTHLY_AI_USD` | 1.5 | the most one member's AI help may cost in any 31 days |
| `GENESIS_PRO_EMAIL_FROM` | `MTRX_ALERT_FROM` | where Pro keys are emailed from (through `MTRX_SMTP_*`) |

A maxed-out member costs at most $1.50 of AI a month, against $4.51 (monthly) or $3.98 (yearly)
a month after Stripe's fees. The doc has the sums, the owner's Stripe steps, and every limit. The
console's **Numbers** section shows Pro members and monthly revenue.

## Early access and creators

Two ways to have customers and money ready on launch day ([docs/EARLY-ACCESS-AND-CREATORS.md](docs/EARLY-ACCESS-AND-CREATORS.md)).
Both are **off by default**: until switched on, no page mentions them and their addresses are
"page not found".

- **The early access list** (`EARLY_ACCESS_ENABLED=1`, with email set up): a **Get early access**
  form on the home page (the first button, each app's card and Learn more) and on
  `/early-access`. Email, which apps, and "I'm a grown-up (18+)". Double opt-in: only people who
  open the link in our email and press Confirm count (a mail checker opening it changes nothing),
  and the rest are deleted 7 days after they last signed up. Only the email and
  the apps are kept. Every email has a one-click unsubscribe link and `List-Unsubscribe`
  headers. Founding members are promised a launch discount; each app's code is a Stripe
  promotion code in `FOUNDER_CODE_*`. The console's **Early access** section shows the counts and
  sends the **launch email** for an app: previewed first, sent to the people confirmed for it with
  its founder code, each person once, a few a minute, and blocked until `MTRX_POSTAL_ADDRESS` is set.
- **The creator program** (`CREATORS_ENABLED=1`): `/creators` ("Make videos about our apps, earn
  20% of what your viewers pay in their first year"), an application emailed to you and listed in
  the console, and on approval a short link `mtrxhorizyn.com/c/<code>` that counts clicks and
  sign-ups and forwards to the app with `?ref=<code>` (before launch, to its early access form),
  plus a private dashboard key (only its hash is kept). You write earnings and payouts down by
  hand; nothing moves money. Clicks are counted with a daily-changing keyed hash, never the address.

| Setting | Default | What it does |
|---|---|---|
| `EARLY_ACCESS_ENABLED` | `0` | `1` switches the early access list on (shown once email works) |
| `FOUNDER_CODE_RANKUP` / `FOUNDER_CODE_CYBERLOGIX` / `FOUNDER_CODE_OMNIARMOR` | empty | each app's founding member code: a Stripe promotion code you make |
| `FOUNDER_PERCENT_OFF` | empty | the percent off, shown only for an app with a code |
| `MTRX_POSTAL_ADDRESS` | empty | the company's postal address, at the foot of every email; launch emails are blocked until it is set |
| `EARLY_ACCESS_EMAIL_FROM` | `MTRX_ALERT_FROM` | where early access and creator emails come from (through `MTRX_SMTP_*`) |
| `EARLY_ACCESS_SEND_PER_MINUTE` | 20 | how many launch emails go a minute |
| `CREATORS_ENABLED` | `0` | `1` switches the creator program on |
| `CREATOR_PERCENT` / `CREATOR_MONTHS` | 20 / 12 | the creators' share, and for how many months |

Both show on the console's **Numbers** section.

## Orbyt

`/orbyt` (the old `/vortex` and `/chroma-vortex` addresses redirect there) is the official place to work with MTRX
Horizyn, linked from the home page's menu and footer, the other pages and the sitemap. It has
four paths, each a short form (four cards across, two by two on tablets, and one row each on
phones). The top says in a line what it is for, with three promises (about 2 minutes, a real
person reads every message, pitching and enquiries are free), and three "how it works" steps sit
under the paths. After sending, each path suggests one next step (Genesis for an idea, the
partner page for a partner, the apps for investors and buyers).

- **Partner with us**: name, organisation, email, which apps (any released app, see below),
  the kind of partnership (resell, integrate, refer customers, refer my customers (repair /
  food safety), co-marketing, something else) and a message. An address such as
  `/orbyt#partner/cyberlogix/refer-trade` opens it with those choices made (the partner page's
  Apply button). Like Pitch, it asks anyone under 13 to have a parent or guardian send it
  (Investors and Buy don't); each app card under **Our apps** has **Get early access** (while the
  early access list is open) beside **Partner on this**.
- **Pitch an idea**: name, email, the idea's name, a one-line pitch, who it's for, and an
  optional message. **Bring a project from Genesis** lists the visitor's Genesis projects from
  their own browser and fills in the idea fields. On a Genesis project, **Pitch this in
  Orbyt** opens `/orbyt#pitch` with that project filled in: only the project's id is handed
  over, through the tab's `sessionStorage`, so the idea never appears in an address or a log.
  Nothing is sent until the visitor presses Send. The path asks anyone under 13 to have a parent
  or guardian send it.
- **Investors**: name, organisation (optional), email and message, under a plain notice that
  no shares are sold and nobody is asked for money here, and nothing on the site is an
  investment.
- **Buy the company or an app**: name, organisation (optional), email, what they're interested in
  (MTRX Horizyn as a whole, one or more released apps, or both) and a message, under the notice
  "This only starts a conversation. No shares, apps or companies are bought or sold here, and no deal
  happens on this page." Kept as the `buy` kind,
  with the choices in the `apps` column (`company` for the whole company).

Below the forms, **Our apps** has a card for each released app: its name, its one line, **Open**
when it has an address, and **Partner on this** and **Ask about buying**, which open that form
with the app already picked.

A form goes to `POST /api/vortex/send` (same-site only, like every change, and within the usual
16 KB body limit). Every field is checked on the server: lengths, a plain email address, and the
path and partnership kind against fixed lists, and the apps against the apps released right now; fields that belong to another path are
dropped. Messages are kept in the `vortex_messages` table with the time, the path and the
fields: **never the sender's address or a cookie**. They are deleted 365 days after they
arrive by the upkeep job, and the privacy page says so.

Against abuse: each address may send `VORTEX_PER_HOUR` (5) messages an hour and
`VORTEX_PER_DAY` (20) a day, counted like failed sign-ins (the address and time, gone after a
day); a hidden field catches simple bots, which are told "sent" and dropped; and a message that
is mostly links is refused.

When alert email is set up (`MTRX_ALERT_EMAIL` and the SMTP settings), the owner gets a short
notice from a background thread: the path and the organisation or idea name (and, for buying,
which apps or the company), nothing else (no email address, no message), at most 30 a day. Everything is read in the console's
**Orbyt** section: an inbox and an archive, an unread count on the sidebar, each message's
fields, the reply address to copy and a **Reply by email** link, and buttons to mark read or
unread, archive and delete. Opening a message marks it read.

### Orbyt Pitch Review: the optional paid extra

**Orbyt stays free**: pitching, partnering and business enquiries never cost anything, and every
pitch gets a reply. **Pitch Review** ([docs/ORBYT-PITCH-REVIEW.md](docs/ORBYT-PITCH-REVIEW.md)) is
an optional extra offered on the Sent screen after a pitch: for one payment (default `$19`, not a
subscription), a real person at MTRX Horizyn writes a personal review of the idea (what's strong,
what to fix, the next 3 steps, and whether it might fit Orbyt) and emails it within 5 days, or the
buyer gets a full refund (also if the idea can't be reviewed). A grown-up pays: an "I'm 18 or over"
tick, then Stripe Checkout, where the grown-up gives their own email.

It is **off until `ORBYT_REVIEW_ENABLED=1`**, its Stripe settings are set, email works and
`MTRX_ALERT_EMAIL` is set; until then no page mentions it and its addresses are "page not found".
Stripe's signed webhook (`/api/orbyt/review/stripe`, its own endpoint and secret) is the only thing
that makes an order; the buyer gets a confirmation with the due date, you get a short notice, and
the console's **Pitch Reviews** section lists open reviews, soonest due first, with **Mark sent**.
Refunds are made by hand in Stripe.

**How to switch it on, in short:** in Stripe, add a product "Orbyt Pitch Review" with a one-off
price and copy its `price_...` id; add a webhook endpoint `https://mtrxhorizyn.com/api/orbyt/review/stripe`
with `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`,
and copy its signing secret; then set these and `ORBYT_REVIEW_ENABLED=1`. The doc has every step,
and a test-mode run-through.

| Setting | Default | What it does |
|---|---|---|
| `ORBYT_REVIEW_ENABLED` | `0` | `1` switches Pitch Review on, once the settings below are set, email works and `MTRX_ALERT_EMAIL` is set |
| `STRIPE_SECRET_KEY` | empty | shared with Genesis Pro; Pitch Review needs only Checkout Sessions *write* |
| `ORBYT_REVIEW_STRIPE_WEBHOOK_SECRET` | empty | the signing secret of `https://mtrxhorizyn.com/api/orbyt/review/stripe` |
| `ORBYT_REVIEW_STRIPE_PRICE` | empty | the one-off price id; Stripe holds the amount |
| `ORBYT_REVIEW_PRICE_TEXT` | `$19` | the price as the page writes it (keep it the same as Stripe's) |
| `ORBYT_REVIEW_DAYS` | 5 | the promise: emailed within this many days of paying (1 to 30) |
| `ORBYT_REVIEW_EMAIL_FROM` | `MTRX_ALERT_FROM` | where confirmations come from (through `MTRX_SMTP_*`) |
| `ORBYT_REVIEW_MODE` | empty | who writes the reviews: `ai` or `person`; empty means AI once the three AI settings below are set |
| `ORBYT_REVIEW_AI_URL` | empty | an OpenAI-compatible AI service's address (`https://` only), for AI mode |
| `ORBYT_REVIEW_AI_KEY` | empty | that service's key (a free tier works). Never commit it |
| `ORBYT_REVIEW_AI_MODEL` | empty | the name of the service's model that writes the reviews |
| `ORBYT_REVIEW_AI_PER_DAY` | 20 | the most AI calls in a UTC day, to stay inside a free tier |

**Make it automatic (free):** in AI mode (1.23.0) each paid review is written by AI and emailed by
itself within minutes, with honest "written by AI" wording everywhere it's offered and the
grown-up agreeing at checkout. The doc's "Make it automatic (free)" has the steps for a free-tier
key from Google AI Studio, Groq or OpenRouter.

## Partners and the Kitchen Safety Bundle

Two plain public pages, with no script, form or cookie, linked from every footer and listed in
the sitemap. What they say about apps comes from the app catalog (`horizon/offers.py`), so a
button only links to an app that is released and has an address.

- **`/partners`** asks fridge and refrigeration repair companies, food safety consultants and
  inspectors' trainers, and kitchen equipment sellers to recommend CyberLogix AI to the shops
  they already visit, and earn a share of what those shops pay. It says only what CyberLogix
  AI's partner code does (its `partners.py` and `docs/PARTNERS.md`): a share of money actually
  collected in the last 30 days, nothing for a free trial or an unpaid or cancelled invoice,
  the rate agreed per partner (so no number is printed), paid by bank transfer. **Apply** opens
  `/orbyt#partner/cyberlogix/refer-trade`: the Partner form with CyberLogix AI picked and
  "Refer my customers (repair / food safety)" chosen. Nothing is sent until the visitor fills
  in their details and presses Send.
- **`/bundle`**, the Kitchen Safety Bundle: CyberLogix AI's fridge and freezer alarms with
  OmniArmor.ai's inspection checklists, where CyberLogix AI fills in OmniArmor.ai's temperature
  checks each day. **Start with a free trial** goes to CyberLogix AI's `/signup` when
  `CYBERLOGIX_URL` (or its catalog address) is set; without one it says "Free trial coming
  soon" and offers Orbyt. Each app's **Open** button uses its catalog address, or says
  "Coming soon". The price reads "Ask about bundle pricing" until CyberLogix AI's `pricing.py`
  has a bundle add-on: then copy its monthly price into `BUNDLE_PRICE` in `horizon/offers.py`.

## Numbers: what people do in each app

The console's **Numbers** section shows, for each connected app, the daily usage counts its
stats address sends (numbers per day, never who):

| App | Where in `/api/stats` | Counts |
|---|---|---|
| CyberLogix AI | `usage.daily`, oldest day first | sign-ups, sensors added, test alerts, alerts answered (console, text, call), inspector's logs, help views |
| OmniArmor.ai | `usage.days`, newest day first | checks updated, bulk updates, lessons started and passed, certificates, help views, sign-ups |
| RankUp | `daily.days`, oldest first (or `null`) | families and schools signed up, chores accepted, rewards bought, games played, help views |

Per app: the last 30 days as small bars for each count, this month so far against last month
with an arrow, the three things done most in 30 days, and one **What to do next** line. Months
are compared by the average per day counted, so the middle of a month is compared fairly. The
line comes from these rules, first match wins:

1. No daily counts yet: update the app.
2. Nothing at all in 30 days: time to find the first customers.
3. Sign-ups, but nobody took the first step: "No test alerts sent: remind new customers to try
   one" (CyberLogix AI), "No checks updated..." (OmniArmor.ai), "No chores accepted yet..."
   (RankUp).
4. Sign-ups up or down 25% or more this month (with at least 3 last month): "Sign-ups are up
   40% this month: keep doing what's working", or down, "ask happy customers to pass it on".
5. No sign-ups in 30 days though people use it: share it somewhere new.
6. Otherwise: steady, and the most done thing this month.

Each app sends only 30 days, so the console keeps every day it is sent (`usage_days`, 100 days)
and each month's totals (`usage_months`, about three years), updated whenever the console or the
home page asks the apps. A month's total never shrinks to fewer days than it had. Anything odd
in an answer (a bad date, a day ahead of now, a negative or non-whole count) is left out. An app
that isn't connected shows how to connect it. The numbers come from `GET /api/console/numbers`,
owner only, read from what was saved; `horizon/numbers.py` has the rules.

## The app catalog: adding and releasing apps

Every app is a row in the `apps` table: a key (the short name used in links, `a`–`z`, `0`–`9`
and dashes, fixed once added), a name, one line about it, a public address (a whole `http://` or
`https://` address, checked like `RANKUP_URL`, or none), a colour from a fixed list (green, blue,
violet, cyan, magenta, amber), its status (`in_development` or `released`) and `released_at`.
The first start fills it with RankUp, CyberLogix AI and OmniArmor.ai, as released, once only
(the `done_once` table remembers it). `RANKUP_URL`, `CYBERLOGIX_URL` and `OMNIARMOR_URL` still
work: when one is set, it is the address used for that app.
Released means listed on Orbyt and in its forms; **open** means released, with an address,
and named in `MTRX_OPEN_APPS` (see above). Only an open app gets an Open button.

In the console, **Manage apps** adds an app (it starts in development, private), edits its name,
line, address and colour, releases it to the public or takes it back into development, and
deletes an app that has never been released. An app that has been public can't be deleted;
take it back into development to hide it. Every change goes in the activity list.

The moment an app is released it is on Orbyt, in Our apps and in the Partner and Buy
forms, and the server accepts it there; taken back into development, it is gone from the page
and refused again. Messages already sent about it still show its name in the inbox.

The home page keeps its three designed app cards: the secret knock taps their icons, so they
are always there, and a founding app in development shows "soon" instead of its Open button.
Newer released apps join the home page's About list, the project list and the app count, rather
than its cards, which are drawn to fit three on one screen.

| Route (owner only, same-site only) | What it does |
|---|---|
| `GET /api/console/apps` | every app, released or not |
| `POST /api/console/apps` | add an app: `key`, `name`, `line`, `url`, `accent` |
| `POST /api/console/apps/{key}` | edit its `name`, `line`, `url`, `accent` |
| `POST /api/console/apps/{key}/release` | release it to the public |
| `POST /api/console/apps/{key}/unrelease` | take it back into development |
| `POST /api/console/apps/{key}/delete` | delete it, only if it was never released |

## Running it on a computer

You need Python 3 (the live site runs 3.13). Install into a virtual environment:
on many systems (Ubuntu 24.04, Homebrew's Python) a plain `pip install` is refused,
and there may be no `python` command outside one.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt -c constraints.txt
MTRX_DEV=1 MTRX_KNOCK="logo logo omniarmor rankup" MTRX_SETUP_TOKEN=local-setup-code-1234567890 \
  python -m uvicorn horizon.main:app --port 8000
```

The site reads its settings from the environment, not from a file. To keep them
in one, copy `.env.example` to `.env`, fill it in, and load it into the shell
first with `set -a; . ./.env; set +a`.

Then open `http://localhost:8000`. `MTRX_DEV=1` lets cookies work over plain
`http://localhost`. Never set it on the real site.

## Tests

In the same virtual environment:

```bash
pip install -r requirements.txt -c constraints.txt pytest httpx
python -m pytest -q
```

The lock tests try every way in that should fail: a stranger, a wrong or partial knock,
guessing, a copied cookie, a stolen session, a reused puzzle, an expired or reused QR code,
a removed device, and requests from other websites. `tests/test_live.py` starts the real
server and walks the owner's whole way in from `127.0.0.1` and `::1`, restarts included,
then checks that no code, cookie, device id or puzzle reached the server's log.

## The click-through demo

`tools/build_demo.py` builds a demo folder: the home page, with each app's
own offline demo behind its card. It only copies files the apps already
ship (CyberLogix's `docs/` demo, OmniArmor's `dashboard/`, and a built RankUp
preview folder if you give one). It never runs their code.

```bash
python tools/build_demo.py --out demo \
  --cyberlogix ../cyberlogix-ai --omniarmor ../omniarmor.ai --rankup ../rankup/preview
```

## Hosting

`render.yaml` sets up Render with a small paid server and a disk for the database (the
free plan has no disk, so devices would be forgotten). The `Dockerfile` works on any host.

The domain and the apps' subdomains are set up as in
[The domain, and the apps' subdomains](#the-domain-and-the-apps-subdomains).

**A staging copy** to try a change on before live: [docs/STAGING.md](docs/STAGING.md).

**Running all four apps** (uptime checks, releasing, backups, what to do when something breaks, support, costs): [docs/RUNNING-MTRX-HORIZYN.md](docs/RUNNING-MTRX-HORIZYN.md).

**Uptime monitor:** check `https://mtrxhorizyn.com/healthz` (is the site answering?) and
`https://mtrxhorizyn.com/readyz` (can it do its work: database, settings, background jobs?). Both
answer GET or HEAD; `/readyz` answers 503 when something is wrong. What to do for each alert:
[docs/OPERATIONS.md](docs/OPERATIONS.md), "If the app is down".

**Settings check at start:** the image sets `MTRX_PRODUCTION=1`, so on Render (and staging) the site
won't start without a working `MTRX_KNOCK` and an `https://` `MTRX_PUBLIC_URL`, or with `MTRX_DEV=1`.
The log then says "MTRX Horizyn can't start" and what to set. Running it on a computer, without
`MTRX_PRODUCTION`, nothing is checked.

The site must be served over **https**, because browsers only make device keys on secure
sites.

`MTRX_TRUST_PROXY=1` (set in `render.yaml`) has the site take each visitor's address from
the last entry in `X-Forwarded-For`, the one Render's proxy added. If you ever put a
second proxy in front, such as Cloudflare, that entry becomes Cloudflare's address and
every visitor looks the same, so strangers' wrong codes could hold back your setup code
for an hour. Change how the address is read (`client_ip` in `horizon/main.py`) before
adding one. (The knock is counted per approved device, and a live QR code works even from
an address that is out of tries, so neither is affected.)

To check what your host really sends, open the site once after a deploy and look in the
host's logs for the line starting **"Proxy check:"**. If it says the last entry "does not
match" CF-Connecting-IP, visitors are being counted by a proxy's address, and `client_ip`
needs changing. The line shows counts only, never anyone's address.

## What's where

- `horizon/main.py`: the web pages and the console's API
- `horizon/lock.py`: the three locks
- `horizon/stats.py`: the console's numbers, and the project list
- `horizon/health.py`: the apps' health checks, and the alerts when one is down
- `horizon/upkeep.py`: the jobs the server runs on its own once a minute, and their watchdog
- `horizon/ready.py`: the settings check at start, and the readiness check (`/readyz`)
- `horizon/outbound.py`: how many calls to the AI provider and Stripe may wait at once
- `horizon/genesis_ai.py`: Ask Genesis, its limits and its system prompt
- `horizon/genesis_pro.py`, `static/js/genesis-pro*.js`, `templates/genesis_pro_welcome.html`:
  Genesis Pro, the paid upgrade (`docs/GENESIS-PRO.md`)
- `templates/genesis.html`, `static/js/genesis*.js`, `static/css/genesis.css`: Genesis
- `horizon/vortex.py`, `templates/vortex.html`, `static/js/vortex*.js`, `static/css/vortex.css`:
  Orbyt
- `horizon/orbyt_review.py`, `templates/orbyt_review_thanks.html`: Orbyt Pitch Review, the optional
  paid extra (`docs/ORBYT-PITCH-REVIEW.md`)
- `horizon/catalog.py`: the app catalog, and which apps are released
- `horizon/offers.py`, `templates/partners.html`, `templates/bundle.html`, `static/css/offers.css`:
  the partner page and the Kitchen Safety Bundle
- `horizon/numbers.py`: the console's Numbers section
- `horizon/early_access.py`, `horizon/creators.py`, `horizon/growth.py`, `templates/early_access*.html`,
  `templates/creators.html`, `templates/creator_dashboard.html`, `static/js/early-access.js`,
  `static/js/creators.js`, `static/js/creator-dashboard.js`, `static/css/grow.css`: the early access
  list and the creator program (`docs/EARLY-ACCESS-AND-CREATORS.md`)
- `templates/`: the pages
- `static/`: styles, scripts, pictures (cut from the supplied design artwork) and the two
  fonts (Inter and Montserrat, under the SIL Open Font License; the licences are beside them)
- `tests/`: the tests
