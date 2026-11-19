# Genesis Pro

Genesis Pro is a paid upgrade to Genesis (`/genesis`) for the people who use it most: about
**$4.99 a month**, or **$49.90 a year** ("2 months free", ten months' price, as the other apps
do). The free plan does not change at all.

It is **off by default**. Until `GENESIS_PRO_ENABLED=1`, every Stripe setting below is set,
email works (`MTRX_SMTP_*`) and Ask Genesis is on (`GENESIS_AI_KEY` and `GENESIS_AI_MODEL`),
every Pro address answers "page not found", and no page, the privacy page and terms included,
says anything about Pro. Since 1.11.0 Ask Genesis is part of that check: most of what Pro adds
is more Ask Genesis, so it is never shown or sold while AI help is off. As with email, turning AI
help off later switches all of Pro off (Stripe keeps retrying its webhook events for days, so
none is lost while it is back on within that time).

The code is `horizon/genesis_pro.py` (members, keys, Stripe, backups, numbers), the Pro parts
of `horizon/genesis_ai.py` (Pro asks), `static/js/genesis-pro.js` and
`static/js/genesis-pro-welcome.js` (the page), and `tests/test_genesis_pro.py`.

## What Pro includes

| | Free | Pro |
|---|---|---|
| Ask Genesis answers | 30 a day per visitor, from a budget all free visitors share | up to **100 a day** (30 an hour), the member's own, never "too busy" |
| Answer length | under 180 words (at most 1,200 tokens) | under 350 words, more detailed (at most **1,000** tokens of text) |
| Helpers | 6 | 9: also a four-week plan, words for a one-page website, price ideas |
| Own question | 300 characters | 600 characters |
| Cloud backup | no | the last 3 copies of all projects, private, restore any time |
| Download plan | no | any project as a tidy text file, made in the browser |
| Download / Import (JSON) | yes | yes |
| Today's spark, streaks, idea cards | yes | yes |

There is **no public publishing or sharing** of anything a member makes. A backup is readable
only with that member's key, never shown in the console, and never used for anything else, so
there is nothing to moderate.

Pro asks have their own allowance: they never use, or wait on, the free plan's
`GENESIS_AI_DAILY_CAP_USD`, so Pro also leaves more of the free budget to free visitors.

### How the page tells free and Pro apart (1.10.0)

- The Pro panel on `/genesis` shows the same comparison as a small table, Free next to Pro, and
  says Genesis is free to use and Pro is only for people who ask for help a lot.
- **The one upgrade moment:** when a free visitor's Ask Genesis help is used up for now (their
  own hourly or daily limit, or the shared daily budget), the answer `429` carries
  `"limit": "free"`, and only then, while Pro is on and this browser doesn't have it, the page adds
  one calm line under the message: everything else keeps working, Pro has its own answers each
  day, and a grown-up can get it. No timer, no pop-up, no locked buttons, nothing anywhere else.
  A member who reaches Pro's own limits never sees it.
- Idea cards are made and shared by the visitor from their own browser. Nothing a member (or
  anyone) makes is published on the site, so this doesn't change the paragraph above.

## The cost sums

### What one month brings in, after Stripe's fees

Stripe's standard pricing for US cards: **2.9% + $0.30** per card payment, plus **0.7%** for
Stripe Billing (subscriptions). No monthly fee.

| | Price | Card fee | Billing fee | Net | Net per month |
|---|---|---|---|---|---|
| Monthly | $4.99 | $0.14 + $0.30 | $0.03 | **$4.51** | **$4.51** |
| Yearly | $49.90 | $1.45 + $0.30 | $0.35 | **$47.80** | **$3.98** |

The yearly plan brings in less per month, so it is the one the cap is checked against. A card
from another country adds 1.5%, and paying in another currency 1% more: then $4.39 a month on
the monthly plan and $3.88 on the yearly one. Stripe Tax, if turned on, adds 0.5%.

### The most one Pro ask can cost

The worst case for one ask is every output token allowed plus a very generous guess at the
input:

- input: at most **3,000** tokens (`INPUT_GUESS`; a real request is the system prompt and the
  four short project fields, about 700 to 900 tokens);
- output: at most **1,000** tokens (`PRO_MAX_TOKENS`; a 350-word answer is about 470).

`worst = (3,000 × input price + 1,000 × output price) / 1,000,000`

| AI prices (per million tokens, in / out) | Worst Pro ask | Typical Pro ask (900 in, 450 out) |
|---|---|---|
| $1 / $5 (a small, fast model) | **$0.008** | $0.0032 |
| $3 / $15 (a mid-size model) | $0.024 | $0.0095 |
| $10 / $50 (the safe defaults of the price settings) | $0.08 | $0.032 |

The model is the `GENESIS_AI_MODEL` setting; its prices are `GENESIS_AI_INPUT_PRICE` and
`GENESIS_AI_OUTPUT_PRICE`. No model is named in this repository.

### The cap

A daily count alone can't keep the cost down: 100 asks a day, every day for 31 days, every one
at its worst, would be 3,100 × $0.008 = $24.80 even with a small model. So Pro has two limits:

1. **Up to 100 asks a day** and 30 an hour per member (`GENESIS_PRO_PER_DAY`,
   `GENESIS_PRO_PER_HOUR`), so a busy day is never cut short.
2. **An AI allowance of $1.50 per member in any 31 days** (`GENESIS_PRO_MONTHLY_AI_USD`).
   Before each ask, its worst case is set aside against the allowance, under a lock, and the
   ask is refused if it doesn't fit; when the answer arrives, the real cost (from the token
   counts) replaces it. So spend can never go past the allowance, whatever the model or its
   price. Any month or billing period (31 days at most) fits inside one 31-day window.

**Worst-case AI cost for one maxed-out Pro member: $1.50 a month.**

| | Monthly plan | Yearly plan | Yearly, foreign card and currency |
|---|---|---|---|
| Net after Stripe | $4.51 | $3.98 | $3.88 |
| AI at the cap | $1.50 | $1.50 | $1.50 |
| Left at worst | **$3.01** (67%) | **$2.48** (62%) | **$2.38** (61%) |

What $1.50 buys a member, with a small model at $1 / $5: at least 187 answers in 31 days even
if every one is as long and costly as allowed, and about 470 typical answers (about 15 a day,
every day), with up to 100 on any one day. With a pricier model the allowance buys fewer
answers, but still costs no more than $1.50. A member who reaches it is told it tops up day
by day.

**Set `GENESIS_AI_INPUT_PRICE` and `GENESIS_AI_OUTPUT_PRICE` to the model's real prices before
turning Pro on.** With the safe defaults ($10 / $50) every answer is counted at about ten times
a small model's price, so members get about a tenth of the answers they should. The console's
Numbers card says so while they are still the defaults. The prices must never be set lower
than the real ones, or the estimate (and so the cap) would be too low.

### Everything else Pro costs

- **Cloud backup:** at most 3 copies of up to 1 MB each per member (a typical backup is a few
  KB). On a $0.25-a-GB disk that is under $0.001 per member a month at worst.
- **Emails:** one when someone buys, and one for each "Email a new key" (at most 3 a day per
  member). A free email tier covers it.
- **Stripe:** no monthly fee; the fees above are per payment.

## The settings

| Setting | Default | What it does |
|---|---|---|
| `GENESIS_PRO_ENABLED` | `0` | `1` switches Pro on. It only shows once the three Stripe settings below are set and email works; until then the console's Genesis Pro card says what is missing |
| `STRIPE_SECRET_KEY` | empty | Stripe's secret key (best: a restricted key, see below). Never commit it |
| `GENESIS_PRO_STRIPE_WEBHOOK_SECRET` | empty | the signing secret (`whsec_...`) of the webhook endpoint below |
| `GENESIS_PRO_STRIPE_PRICE` | empty | the monthly price's id (`price_...`) |
| `GENESIS_PRO_YEARLY_STRIPE_PRICE` | empty | the yearly price's id (`price_...`); without it only monthly is offered |
| `GENESIS_PRO_PRICE_TEXT` | `$4.99` | the monthly price as written on the button while Stripe's own figure can't be read (Stripe slow or down); only the words, never the price charged |
| `GENESIS_PRO_PER_DAY` / `GENESIS_PRO_PER_HOUR` | 100 / 30 | Ask Genesis answers per member |
| `GENESIS_PRO_MONTHLY_AI_USD` | 1.5 | the most one member's AI help may cost in any 31 days, in US dollars |
| `GENESIS_PRO_EMAIL_FROM` | `MTRX_ALERT_FROM` | the address Pro keys are emailed from |

Pro keys are emailed through the same mail server as the alerts (`MTRX_SMTP_HOST` and the
other `MTRX_SMTP_*` settings). Pro stays off without it: a buyer who lost their key could never
get a new one, or reach **Manage subscription** to cancel. Ask Genesis has
to be on (`GENESIS_AI_KEY` and `GENESIS_AI_MODEL`) for Pro's AI help, and its price settings
are used for Pro's allowance. The code names only price ids: Stripe holds the amounts, and the
page shows the amounts it reads from Stripe (once an hour).

## How it works

1. **Buying.** A grown-up presses **Get Pro** (monthly or yearly). `POST
   /api/genesis/pro/checkout` makes a Stripe Checkout page for that price, with
   `metadata.product = genesis_pro` on the session and the subscription, and the browser goes
   there. Stripe takes the card and the email address; card details never reach this server.
   The button says, and Stripe's page says again, that checkout is for adults.
2. **The webhook is the only source of truth.** `POST /api/genesis/pro/stripe` checks Stripe's
   signature (HMAC-SHA256 of `timestamp.body` with the endpoint's secret, at most 5 minutes
   old), applies each event once (by its id), and ignores a subscription event older than the
   last one applied, and a late "incomplete" one (that state only comes before the first
   payment). A paid `checkout.session.completed` (or, for a payment that takes days such as a
   bank debit, `checkout.session.async_payment_succeeded`) makes a member: Stripe's customer and
   subscription ids, the state, the price, and SHA-256 fingerprints of the email address and of
   the checkout's id. No email address is kept.
3. **The key.** At once a Pro key (`GP-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`, 120 random bits) is
   emailed to the buyer. Stripe sends them back to `/genesis/pro/welcome?session_id=...`; that
   page asks `POST /api/genesis/pro/claim` (until the webhook has arrived) and gets a key once,
   which it keeps in the browser's storage, so Pro is on there straight away. The page takes
   the checkout's id out of the address, and the server log leaves that address out. Only the
   SHA-256 of each key is stored; a member keeps 5 keys. When a new one would make 6, a key that
   has never been used goes first, so asking for new keys (which anyone who knows the email can
   do) never stops a key a browser is using.
4. **Using Pro.** The page sends the key in an `X-Genesis-Pro-Key` header (never a cookie) with
   Ask Genesis and the backup. **I have a Pro key** turns Pro on in another browser. **Email a
   new key** sends a fresh key to an address whose fingerprint matches a member with Pro; the
   answer is the same either way, so nobody can find out who has Pro.
5. **Cancelling, failed payments, refunds.** **Manage subscription** opens Stripe's own
   customer portal. Cancelled at the period's end: Pro lasts until then
   (`customer.subscription.updated`), then stops (`customer.subscription.deleted`). A failed
   payment (`invoice.payment_failed`) pauses Pro until a later payment (`invoice.paid`), and
   **Email a new key** still works for that member, so they can reach **Manage subscription** to
   fix it. A full refund (`charge.refunded`) ends Pro at once and stays ended until they pay
   again; a part refund is counted but keeps Pro. A disputed payment (a chargeback,
   `charge.dispute.created`) pauses Pro until the dispute closes (`charge.dispute.closed`): won,
   Pro comes back; lost, it stays paused. Pro also ends when the time paid for runs out, even if
   Stripe's last event never arrives.
   A checkout's own event can arrive late, after the subscription was already cancelled or
   refunded, so before making a member this site asks Stripe for the subscription as it is now
   (and remembers a full refund that came first); if Stripe can't be asked, the event is answered
   "try again" and Stripe sends it again later.
6. **Backup.** While a browser has Pro, it backs up all its projects a few seconds after each
   change (at most once a minute), or on **Back up now**. The server checks every field the
   same way Genesis does, keeps the last 3 copies, and **Restore** merges a copy into the
   browser's projects, so nothing in the browser is lost. **Delete backups** deletes them all;
   they are also deleted 60 days after Pro ends.

### Every new address is limited

Counted like failed sign-ins (the address or member and the time, kept a day):

| What | Limit |
|---|---|
| Start a checkout | 10 an hour per address |
| The welcome page asking for its key | 90 an hour per address |
| Pro status | 120 an hour per address |
| Wrong Pro keys | 20 an hour per address, then every key waits |
| Email a new key | 5 an hour per address, 3 emails a day per member |
| Manage subscription | 10 an hour per member |
| Back up / restore | 60 / 30 an hour per member |
| Webhook with a bad signature | 60 an hour per address, then refused unread |
| Pro asks | `GENESIS_PRO_PER_HOUR` / `GENESIS_PRO_PER_DAY` per member, and the allowance |

### The console

The **Numbers** section shows a Genesis Pro card above the apps while Pro is on (or anyone has
ever had it): Pro members (monthly and yearly), monthly revenue (yearly plans counted as a
twelfth), money collected this month after refunds and last month's, new and ended members and
those cancelling, failed payments, and the AI cost of the last 30 days against the cap. Money
is in US dollars; a member paying in another currency is counted apart.

## The owner's Stripe steps

Do it all in **test mode** first, on staging (`docs/STAGING.md`), then again in live mode.

1. **Product and prices.** Product catalog → **Add product**: "Genesis Pro". Add a recurring
   price of **$4.99 USD monthly**, then a second recurring price on the same product of
   **$49.90 USD yearly** (ten months). Copy each price's id (`price_...`) into
   `GENESIS_PRO_STRIPE_PRICE` and `GENESIS_PRO_YEARLY_STRIPE_PRICE`.
2. **API key.** Developers → API keys → **Create restricted key** with: Checkout Sessions
   *write*, Prices *read*, Customer portal *write*, Subscriptions *read*, Charges *read*;
   everything else *none*. Put it in
   `STRIPE_SECRET_KEY` (never in the code or a commit).
3. **Webhook.** Developers → Webhooks → **Add endpoint**:
   `https://mtrxhorizyn.com/api/genesis/pro/stripe`, with these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
   `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`,
   `charge.dispute.closed`. Copy its signing secret (`whsec_...`) into
   `GENESIS_PRO_STRIPE_WEBHOOK_SECRET`.
4. **Customer portal.** Settings → Billing → Customer portal: turn it on; allow cancelling (at
   the end of the billing period), updating the payment method and seeing invoices. To let
   members switch between monthly and yearly, allow switching plans and add both prices.
5. **Failed payments.** Settings → Billing → Subscriptions and emails: turn on Smart Retries,
   and after the last retry **cancel the subscription**; turn on Stripe's emails for failed
   payments and receipts.
6. **Business details.** Settings → Public details: the business name MTRX Horizyn, the support
   email and a statement descriptor such as `MTRX GENESIS`, so a grown-up recognises the
   charge.
7. **Email and AI prices on this site.** Set `MTRX_SMTP_*` and `GENESIS_PRO_EMAIL_FROM` so keys
   are emailed, and set `GENESIS_AI_INPUT_PRICE` / `GENESIS_AI_OUTPUT_PRICE` to the model's
   real prices.
8. **Switch on.** Set `GENESIS_PRO_ENABLED=1`. Within a minute the page shows the prices it
   read from Stripe.
9. **Try it** (test mode): buy with card `4242 4242 4242 4242`, check the welcome page shows a
   key and the email arrives, check Developers → Webhooks shows every delivery succeeded, ask
   Genesis a Pro question, back up, cancel from **Manage subscription**, and refund one test
   payment. Then repeat steps 1 to 3 in live mode with live keys and live prices.

**Promotion codes:** Checkout lets a buyer type any promotion code in your Stripe account. Make
every coupon behind a code apply only to its own product (**Apply to specific products** on the
coupon), so the apps' founder codes, which launch emails send to everyone on the list, don't take
money off Genesis Pro, and no code takes 100% off Pro unless you mean it to.

**Refunds:** refund from Payments in the Stripe dashboard. A full refund ends Pro straight away
on this site, but Stripe keeps the subscription going unless it is cancelled too: open the
customer's subscription and cancel it, or it charges again next period. To refund without
ending Pro, refund part of the payment.

**Turning Pro off** (`GENESIS_PRO_ENABLED=0`) hides it again and makes every member's asks free
ones; their subscriptions keep charging in Stripe until cancelled there, so cancel them first if
Pro is stopping for good.
