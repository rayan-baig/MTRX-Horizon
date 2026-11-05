# What changed

The newest version is at the top. The number in `VERSION` is shown at the
bottom of the home page and the console, and by `/healthz`, so you can tell
which version is live.

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
