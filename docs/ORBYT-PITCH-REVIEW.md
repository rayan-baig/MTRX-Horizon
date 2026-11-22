# Orbyt Pitch Review

**Orbyt stays free.** Pitching an idea, partnering and business enquiries never cost anything,
and every pitch gets a reply from a real person either way.

**Pitch Review** is an optional, paid extra for a pitch that has already been sent. A real
person at MTRX Horizyn writes a personal review of the idea: what's strong, what to fix, the next
3 steps, and whether it might fit Orbyt. It is emailed within **5 days** (a setting), for **one
payment** (not a subscription), bought by a **grown-up (18+)**. If the review is late, or the idea
can't be reviewed, the buyer gets a **full refund**, which you make by hand in Stripe.

It is **off by default**. Until it is switched on and set up, no page mentions it and every
address it uses answers "page not found".

The code is `horizon/orbyt_review.py`, with the offer in `templates/vortex.html` and
`static/js/vortex.js`, the page Stripe sends buyers back to in
`templates/orbyt_review_thanks.html`, and the console's **Pitch Reviews** section in
`templates/console.html` and `horizon/private/console.js`.

## What a visitor sees (only while it is on)

- **Orbyt's Pitch form** gets one more answer in "Before you send": **What's a Pitch Review?**
- **After a pitch is sent**, the Sent screen shows a short box: "Optional extra: a Pitch
  Review", what you get, the price and days, "A grown-up pays", a tick box "I'm 18 or over, and
  I'm the one paying", the button **Get a Pitch Review ($19)**, and "Full refund if it's late or
  we can't review it". It says first that the pitch is sent and gets a reply either way. There
  are no countdowns, no "only today" and nothing on the form itself.
- **Pilot** on Orbyt answers "What's a Pitch Review?" at once, with no AI key.
- **The terms and the privacy page** each get a Pitch Review section: what is paid, what you
  get, the day promise, the refunds (by hand, through Stripe), and what is kept and for how long.

Orbyt's own words changed for good, on or off: "Nothing is bought or sold on this page" became
**"No shares, apps or companies are bought or sold here"**, which stays true with Pitch Review on.

## Switching it on: the owner's steps

Do it all in **test mode** first (on staging, `docs/STAGING.md`, if you have it), then again in
live mode.

1. **Product and price in Stripe.** Product catalog → **Add product**: name it "Orbyt Pitch
   Review". Add a **one-off** price (not recurring), for example **$19.00 USD**. Copy the
   price's id (`price_...`).
2. **API key.** If Genesis Pro is already set up, its restricted key already works: Pitch Review
   only needs **Checkout Sessions: write**. If not, Developers → API keys → **Create restricted
   key** with Checkout Sessions *write* and everything else *none*. It goes in
   `STRIPE_SECRET_KEY` (never in the code or a commit).
3. **Webhook.** Developers → Webhooks → **Add endpoint**:
   `https://mtrxhorizyn.com/api/orbyt/review/stripe` (use your site's own address), with these
   events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `charge.refunded`. Copy its **signing secret** (`whsec_...`). This is a separate endpoint
   from Genesis Pro's, with its own secret.
4. **Business details.** Settings → Public details: the business name MTRX Horizyn and a
   support email, so a grown-up recognises the charge. If you like, also turn on Stripe's
   **successful payment** receipts (Settings → Customer emails); this site's own confirmation
   email doesn't depend on them.
5. **Settings on the host** (on Render: the service's **Environment** page):

   | Setting | Example | What it does |
   |---|---|---|
   | `ORBYT_REVIEW_STRIPE_PRICE` | `price_1Abc...` | the one-off price id from step 1 |
   | `ORBYT_REVIEW_STRIPE_WEBHOOK_SECRET` | `whsec_...` | the signing secret from step 3 |
   | `ORBYT_REVIEW_PRICE_TEXT` | `$19` | the price as the page writes it (default `$19`). Stripe's checkout shows the real amount, so keep the two the same |
   | `ORBYT_REVIEW_DAYS` | `5` | the promise: the review is emailed within this many days of paying, from 1 to 30 (default 5) |
   | `ORBYT_REVIEW_EMAIL_FROM` | `reviews@mtrxhorizyn.com` | optional: where confirmations come from (default `MTRX_ALERT_FROM`) |
   | `STRIPE_SECRET_KEY` | `rk_live_...` | from step 2 (shared with Genesis Pro) |

   Email must work (`MTRX_SMTP_HOST` and its login), and **`MTRX_ALERT_EMAIL`** must be set:
   Pitch Review stays hidden until every buyer can get a confirmation and you are told about
   every paid review.
6. **Switch on.** Set **`ORBYT_REVIEW_ENABLED=1`**. If anything is missing, the server's log says
   what at start ("Pitch Review is switched on but stays off until this is done: ..."), and so
   does the console's Pitch Reviews section.
7. **Try it** (test mode): send a pitch on `/orbyt`, tick 18+, press **Get a Pitch Review**, pay
   with card `4242 4242 4242 4242`, and check: the thanks page shows, the confirmation email
   arrives with a due date, you get the "a paid Pitch Review is due" email, the review is in the
   console's **Pitch Reviews** section, and Developers → Webhooks shows the delivery succeeded.
   Press **Mark sent**, then refund the test payment in Stripe. Then repeat steps 1 to 5 in live
   mode with the live key, live price and live webhook secret.

To switch it off again, set `ORBYT_REVIEW_ENABLED=0` (or delete it). The offer disappears at
once; reviews already paid for stay in the console until you mark them sent.

## Each review: what you do

1. You get an email: "MTRX Horizyn: a paid Pitch Review is due by <date>", with the idea's name
   only.
2. Open the console → **Pitch Reviews**. Each one shows the idea, the pitch, the address to
   send the review to (the grown-up who paid), when it was paid and when it's due; a late one is
   marked in red.
3. Press **Write the review** (it opens your email app to that address) and write: what's
   strong, what to fix, the next 3 steps, and whether it might fit Orbyt.
4. Press **Mark sent**.

**Refunds are by hand.** If a review will be late, or you can't review the idea (too unclear,
or not something you can comment on safely), refund it in full: Stripe → Payments → the
payment → **Refund**. Stripe tells this site, and the review leaves the "To write" list. A pitch
with a review still to write can't be deleted from the Orbyt inbox until it is marked sent or
refunded.

## How it works

1. **A ticket, not an account.** While Pitch Review is on, sending a pitch answers with a
   one-time ticket for that pitch. Only the ticket's SHA-256 is kept, for 2 days.
2. **Checkout.** `POST /api/orbyt/review/checkout` (same-site only, like every change) takes the
   ticket and the 18+ tick. It refuses without the tick, with a ticket that is unknown or more
   than 2 days old, or for a pitch that already has a review, and each address may start 10 an
   hour. It makes a Stripe Checkout page in **payment** mode (one payment) for
   `ORBYT_REVIEW_STRIPE_PRICE`, with `metadata[product]=orbyt_review` and the pitch's number,
   and says on Stripe's page that checkout is for grown-ups. The buyer types their own email
   there; card details never reach this server.
3. **The webhook is the only source of truth.** `POST /api/orbyt/review/stripe` checks Stripe's
   signature (HMAC-SHA256, at most five minutes old) with `ORBYT_REVIEW_STRIPE_WEBHOOK_SECRET`,
   the same way Genesis Pro's does; bad signatures are counted and an address with many is
   refused. Each event id is applied once (its own table, since Stripe sends one event, with
   one id, to every endpoint that asks for it). A paid checkout for `orbyt_review` makes the
   order (once per checkout), then the buyer's confirmation and your notice are emailed from a
   background thread. A full `charge.refunded` marks the order refunded. Anything else,
   Genesis Pro's events included, is ignored.
4. **What is kept** (the privacy page says the same): which pitch, the idea's name, the buyer's
   email, the amount, and when it was paid, is due, and was sent or refunded. The email and the
   idea's name are cleared 90 days after the review is sent or refunded; the order goes after
   400 days. An open order is never cleared.

Genesis Pro's Stripe plumbing is reused (`genesis_pro._stripe`, `genesis_pro.verify`, and the
limits table), so both products call Stripe the same careful way.
