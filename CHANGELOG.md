# What changed

The newest version is at the top. The number in `VERSION` is shown at the
bottom of the home page and the console, and by `/healthz`, so you can tell
which version is live.

## 1.8.1 (17 November 2026)

- **Chroma Vortex is now Orbyt.** The page lives at `/orbyt`; the old `/vortex` and `/chroma-vortex`
  addresses redirect there, so old links and bookmarks still work. Every page, email, the console
  and the sitemap use the new name. Behind the scenes the code, the database table and the form's
  `/api/vortex/send` address keep their old names, so nothing stored had to move.

## 1.8.0 (15 November 2026)

- **The early access list**, so the apps open with customers waiting. **Off by default**: until
  `EARLY_ACCESS_ENABLED=1` and email (`MTRX_SMTP_*`) works, no page mentions it and every address
  of it is "page not found". `docs/EARLY-ACCESS-AND-CREATORS.md` has everything.
- **Get early access** on the home page (the first button, each app's card and Learn more, each
  opening the form over the page with that app ticked) and on `/early-access`: an email address,
  tick boxes for the apps, and "I'm a grown-up (18+)". **Double opt-in**: we email a link and only
  people who press it count; the rest are deleted after 7 days. Only the email and the apps are
  kept. The answer is the same whether or not an address is already on the list.
- **Unsubscribing:** every email has a one-click unsubscribe link and `List-Unsubscribe` with
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), so a mail app's own button works
  in one click. Unsubscribing deletes the person. The links keep working if the list is switched
  off later.
- **Founding members** are promised a launch discount. Each app's code is a Stripe promotion code in
  `FOUNDER_CODE_RANKUP`, `FOUNDER_CODE_CYBERLOGIX` and `FOUNDER_CODE_OMNIARMOR`; the percent
  (`FOUNDER_PERCENT_OFF`) is shown only for an app that has a code.
- **Launch emails** from the console's new **Early access** section: counts per app (confirmed and
  unconfirmed), then write a subject and message for one app, preview it, and send it to the
  people confirmed for that app with its founder code, unsubscribe link and the company's postal
  address. Sent one at a time, at most `EARLY_ACCESS_SEND_PER_MINUTE` (20) a minute, carrying on
  after a restart. An email is known by its app, subject and words, so each person gets it once,
  however often Send is pressed, and each is marked before it goes so a crash can't send it twice.
  **Blocked**, with the reason in the console, until `MTRX_POSTAL_ADDRESS` is set, email works and
  the app has its founder code.
- **The creator program**, `/creators`: "Make videos about our apps, earn 20% of what your viewers
  pay in their first year" (`CREATOR_PERCENT`, `CREATOR_MONTHS`). **Off by default**
  (`CREATORS_ENABLED`). The application (name, channel link, audience size, email, app, and "I'm 18
  or over or my parent or guardian is applying for me") is emailed to `MTRX_CONTACT_EMAIL` and
  listed in the console's new **Creators** section.
- **Approving a creator** gives them a short link, `/c/<code>`, and a private dashboard key
  (`CR-XXXX-...`, 120 bits) shown once and emailed to them; only its SHA-256 is kept. The link
  counts clicks and confirmed early access sign-ups, then forwards to the app with `?ref=<code>`
  (before launch, to its early access form here). Where it goes is worked out from the creator's
  app alone, and only to `mtrxhorizyn.com`, its subdomains or the app's own address setting: no
  open redirect. Clicks are counted with a keyed hash whose key changes every day and is deleted
  after two, never the address.
- **The creator dashboard**, `/creators/dashboard`: clicks and sign-ups (30 days and in all, with a
  chart), and what the creator has earned, been paid and is owed, as the owner writes it down in
  the console. Nothing moves money by itself.
- **Limits on everything:** joining (5 an hour, 20 a day per address), confirmation emails (3 a
  day per email address, 500 a day in all), wrong links, applications (3 an hour, 10 a day),
  wrong dashboard keys (20 an hour) and link clicks (120 an hour per visitor mark).
- The console's **Numbers** section shows both. The privacy page gains one short line about each
  while it is on. `.env.example`, `render.yaml`, the README and `docs/RUNNING-MTRX-HORIZYN.md`
  list every new setting. `send_email` can add headers (for `List-Unsubscribe`).

## 1.7.0 (14 November 2026)

- **Genesis Pro**, a paid upgrade to Genesis for the people who use it most: about $4.99 a month,
  or $49.90 a year ("2 months free", ten months' price). **Off by default**: until
  `GENESIS_PRO_ENABLED=1` and `STRIPE_SECRET_KEY`, `GENESIS_PRO_STRIPE_WEBHOOK_SECRET` and
  `GENESIS_PRO_STRIPE_PRICE` are set, no page mentions Pro and every Pro address is "page not
  found". The free plan is unchanged. `docs/GENESIS-PRO.md` has the cost sums, the settings, how
  it works and the owner's Stripe steps.
- **What Pro adds:** up to `GENESIS_PRO_PER_DAY` (100) Ask Genesis answers a day and
  `GENESIS_PRO_PER_HOUR` (30) an hour per member, counted by member and never using the free
  plan's shared daily budget; answers up to 350 words (at most 1,000 tokens, `PRO_MAX_TOKENS`)
  from a more detailed prompt; three more helpers (a four-week plan, words for a one-page website,
  price ideas); a 600-character question; a private **cloud backup** of the member's projects
  (the last 3 copies, backed up by itself as they work, merged back in on **Restore**, deleted on
  request or 60 days after Pro ends); and **Download plan**, a project as a text file made in the
  browser. Nothing a member makes is ever published or shared.
- **The cap:** besides the daily asks, each member's AI help may cost at most
  `GENESIS_PRO_MONTHLY_AI_USD` ($1.50) in any 31 days. Each ask's worst case is set aside before
  the call, so the allowance can't be passed whatever the model's price. A maxed-out member costs
  at most $1.50 a month against $4.51 (monthly) or $3.98 (yearly) a month after Stripe's fees.
- **Paying:** a Stripe Checkout subscription (`POST /api/genesis/pro/checkout`), monthly or
  yearly, named only by the price ids in `GENESIS_PRO_STRIPE_PRICE` and
  `GENESIS_PRO_YEARLY_STRIPE_PRICE`; the page shows the amounts it reads from Stripe once an hour.
  The buy button says a grown-up pays and checkout is for adults, and Stripe's page says it again.
- **Stripe's signed webhook is the only source of truth** (`POST /api/genesis/pro/stripe`, the one
  `/api/` address without the same-site check): the signature is checked (at most 5 minutes old),
  each event applied once, and older subscription events ignored. Handles a paid checkout,
  subscription changes, cancelling (Pro lasts to the end of the time paid for), failed payments
  (Pro paused until paid), and refunds (a full refund ends Pro at once). Paid invoices and refunds
  are kept for the numbers.
- **No accounts:** a **Pro key** (`GP-XXXX-...`, 120 random bits) is emailed to the buyer and shown
  once on `/genesis/pro/welcome`, which keeps it in the browser; the browser sends it in an
  `X-Genesis-Pro-Key` header, never a cookie. **I have a Pro key** turns Pro on in another browser,
  **Email a new key** sends a fresh one to a member's address (the same answer either way), and
  **Manage subscription** opens Stripe's customer portal. Only SHA-256 fingerprints of keys, of the
  buyer's email and of the checkout's id are stored; no email address and no card details. The
  welcome page's address is kept out of the server log.
- New tables `genesis_pro_members`, `genesis_pro_keys`, `genesis_pro_events`,
  `genesis_pro_payments`, `genesis_pro_spend` and `genesis_pro_backups`, tidied by the upkeep loop.
  Every new address is rate-limited (`genesis_pro.RATES`).
- The console's **Numbers** section shows a Genesis Pro card while Pro is on: members (monthly and
  yearly), monthly revenue, money collected this month and last, new, ended and cancelling members,
  failed payments, and the AI cost against the cap, with a warning while the AI price settings are
  still the safe defaults. The costs list names Pro's AI help while Pro is on.
- The privacy page and the terms gain a short Genesis Pro section, shown only while Pro is on.
- New settings: `GENESIS_PRO_ENABLED`, `STRIPE_SECRET_KEY`, `GENESIS_PRO_STRIPE_WEBHOOK_SECRET`,
  `GENESIS_PRO_STRIPE_PRICE`, `GENESIS_PRO_YEARLY_STRIPE_PRICE`, `GENESIS_PRO_PER_HOUR`,
  `GENESIS_PRO_PER_DAY`, `GENESIS_PRO_MONTHLY_AI_USD` and `GENESIS_PRO_EMAIL_FROM`, in
  `.env.example`, `render.yaml`, the README, `docs/STAGING.md` and `docs/GENESIS-PRO.md`.

## 1.6.1 (14 November 2026)

- **The domain is chosen: mtrxhorizyn.com.** `render.yaml` now sets the live addresses:
  `MTRX_PUBLIC_URL=https://mtrxhorizyn.com`, the three apps' "Open" addresses
  (`https://rankup.mtrxhorizyn.com`, `https://cyberlogix.mtrxhorizyn.com`,
  `https://omniarmor.mtrxhorizyn.com`), their health addresses (RankUp and CyberLogix AI
  `/api/health`, OmniArmor.ai `/healthz`) and stats addresses (`/api/stats`), and asks for
  `MTRX_STATS_KEY` without storing it. Staging is made by hand and gets none of them.
- The README, `docs/STAGING.md`, `docs/RUNNING-MTRX-HORIZYN.md` and `.env.example` name the
  real addresses instead of placeholders, with `hello@mtrxhorizyn.com` for business enquiries
  and `help@<app>.mtrxhorizyn.com` for each app. The code still reads every address from its
  setting, and works with them unset.

## 1.6.0 (13 November 2026)

- **Partners** (`/partners`): for fridge and refrigeration repair companies, food safety
  consultants and inspectors' trainers, and kitchen equipment sellers. "Recommend CyberLogix AI
  to the shops you already visit, and earn a share of what they pay." Three steps (apply, get a
  partner key, your customers sign up and you earn), what partners earn and see, exactly as
  CyberLogix AI's partner code works (a share of money actually collected, nothing for trials or
  unpaid or cancelled invoices, no rate printed since it is a setting), and a calm note on why a
  separate alarm matters. Linked from Chroma Vortex's Partner path and every footer.
- **Apply** opens the Chroma Vortex Partner form with CyberLogix AI picked and the new
  partnership kind **Refer my customers (repair / food safety)** (`refer-trade`) chosen. The
  server accepts the new kind; a Vortex address like `#partner/cyberlogix/refer-trade` fills in
  the form (`fromHash` in `static/js/vortex-form.js`), picking only apps the form offers.
- **Kitchen Safety Bundle** (`/bundle`): CyberLogix AI's fridge and freezer alarms with
  OmniArmor.ai's inspection checklists, for restaurants, cafés, pharmacies and school kitchens.
  "Start with a free trial" goes to CyberLogix AI's sign-up when it has an address; an app with
  none says "coming soon" and offers Chroma Vortex. The price says "Ask about bundle pricing"
  until CyberLogix AI's pricing has a bundle add-on (`BUNDLE_PRICE` in `horizon/offers.py`).
  Linked from the home page's menu, About card and footer, from Chroma Vortex and its Our apps
  list, and from the home page's search.
- **Numbers**, a new console section: each app's daily usage counts from its stats address
  (CyberLogix AI's and OmniArmor.ai's `usage`, RankUp's `daily`), with the last 30 days as small
  bars per count, this month against last with an up or down arrow, the three things done most,
  and a "What to do next" line from simple rules. Each day is kept in `usage_days` and each
  month's totals in `usage_months`, so month-over-month works after last month has left an app's
  30 days. An app that isn't connected, or sends no daily counts yet, says so. Owner-only
  `GET /api/console/numbers`.

## 1.5.0 (5 November 2026)

- **Buy the company or an app**, a fourth Chroma Vortex path: name, organisation (optional),
  email, what the visitor is interested in (MTRX Horizyn as a whole, one or more released apps,
  or both) and a message, under a clear notice that it only starts a conversation, nothing is an
  offer to sell and no sale happens through the site. Stored in `vortex_messages` as the new
  `buy` kind, with the same checks, limits, hidden bot field, link check, owner email notice and
  console inbox as the other paths. The four path cards sit four across, or two by two on
  tablets and phones.
- **The app catalog**: a new `apps` table holding every app (key, name, one line, public
  address, colour, status and when it was released), filled once on the first start with
  RankUp, CyberLogix AI and OmniArmor.ai as released. `RANKUP_URL`, `CYBERLOGIX_URL` and
  `OMNIARMOR_URL` still work: when one is set, it is that app's address.
- The console's new **Manage apps** panel adds and edits apps, releases one to the public or
  takes it back into development, and deletes one that was never released. Every change is in
  the activity list. Owner-only routes under `/api/console/apps`.
- An app appears on Chroma Vortex the moment it is released: a card in the new **Our apps**
  section, with Open, **Partner on this** and **Ask about buying** (each opens that form with
  the app picked), and a choice in the Partner and Buy forms. The server accepts exactly the
  released apps. An app in development is shown nowhere.
- The home page counts released apps, lists newer ones in About and Projects, and takes the
  founding apps' Open buttons from the catalog.
- The privacy page and the terms cover the new path.

## 1.4.0 (5 November 2026)

- **Chroma Vortex** (`/vortex`, and `/chroma-vortex` redirects there): the official place to
  partner with MTRX Horizyn, pitch an idea, or get in touch as an investor, in its own swirl of
  colour. Three paths, each a short form, linked from the home page's menu and footer, the other
  pages and the sitemap.
- Pitch an idea can **bring a project from Genesis**, read from the visitor's own browser, and
  Genesis has **Pitch this in Chroma Vortex** on each project. Only the project's id is handed
  over, in the tab's own storage, never in an address. Nothing is sent until Send is pressed.
- The investors path says plainly that the page is not an offer of shares or any investment and
  that the company is not raising money through the site.
- Messages are checked field by field, kept in a new `vortex_messages` table without the
  sender's address or any cookie, and deleted after 365 days. Each address may send 5 an hour
  and 20 a day (`VORTEX_PER_HOUR`, `VORTEX_PER_DAY`); a hidden field catches bots; messages that
  are mostly links are refused.
- The owner gets a short email notice (path and organisation or idea name only) when email is
  set up, and reads, replies to, archives and deletes messages in the console's new **Chroma
  Vortex** section, with an unread count on the sidebar.
- The privacy page says what Chroma Vortex keeps, why and for how long; the terms say a message
  creates no agreement and nothing here is an investment offer.

## 1.3.0 (5 November 2026)

- **Genesis** (`/genesis`), a new feature for every visitor: turn an idea into a project with
  a name, a one-line pitch, who it's for and a web address idea, then take it from Spark to
  Plan, Build and Launch with a launch checklist in plain words, progress per stage and
  overall, and notes. Projects are cards in a list, with an empty state for the first idea.
  Linked from the home page's menu and footer, the other pages, the sitemap, and the console.
- Genesis keeps projects only in the visitor's own browser. Download and Import move them
  between devices; Delete all clears them. It still works, and says so, when the browser
  blocks storage.
- **Ask Genesis**: free, short AI help on a project (sharpen the pitch, who might use it, the
  simplest first version, name ideas, what could go wrong, what's next, or a short question),
  which can be saved to the project's notes. Off until `GENESIS_AI_KEY` and
  `GENESIS_AI_MODEL` are set. Limited per visitor (10 an hour, 30 a day, by address, no
  cookie) and by a daily spend cap (`GENESIS_AI_DAILY_CAP_USD`, 2 dollars by default). The
  idea text is passed to the AI provider and never stored or logged.
- The privacy page says what Genesis keeps (nothing on the server but counts) and what Ask
  Genesis sends.
- The home page's links close up a little on mid-sized screens so the new Genesis link fits.

## 1.2.1 (3 November 2026)

- `docs/STAGING.md`: how to run a second copy at `staging.<your domain>` on
  its own Render service and disk, with its own setup code, knock and stats
  key, mail off or to a test inbox, and a checklist for taking a tested
  commit to live. It is set up by hand, not in `render.yaml`, so syncing
  the live Blueprint never touches it.
- `MTRX_NOINDEX=1`, for that copy only: every answer says noindex,
  robots.txt closes the site and the sitemap is empty. Unset, nothing
  changes. Leave it unset on live.

## 1.2.0 (3 November 2026)

- When the site hits an error it did not expect, you get a short email (at
  the same address as the "app is down" alerts) with nothing about the
  visitor in it, and the console's activity list shows it.
- A load test tool and its results (`docs/LOAD-TEST.md`).

## 1.1.0 (2 November 2026)

- The company is now spelled **MTRX Horizyn** everywhere people see it.
- A friendly page when something goes wrong on the server, instead of a bare
  error.
- Share previews (the picture and text a link shows in a chat) work from
  any app, and the public pages are listed in a sitemap for search engines.
- Console: what each month costs to run, and a link to each app's own admin
  page.
- A brand page (`/brand`) with the logos, colours and the right spelling.

## 1.0.0 (2 November 2026)

- The home page presents MTRX Horizyn as the parent company of RankUp,
  CyberLogix AI and OmniArmor.ai, with an About card, contact, privacy and
  terms.
- Console: every app's health on one screen, and an email when one stays
  down.
- The owner's console is reached by a secret knock from an approved device
  only.
