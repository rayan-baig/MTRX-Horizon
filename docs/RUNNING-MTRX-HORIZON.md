# Running MTRX Horizon and its three apps

One page for the boring, important jobs: knowing when something is down,
putting out a new version safely, what to do first when something breaks,
answering customers, and what it all costs. Each app's own docs have the
detail; this page tells you where.

MTRX Horizon is the parent company and owns the one domain. The apps live
on parts of it:

| What | Address | Its own docs |
|---|---|---|
| MTRX Horizon (site + your console) | `https://<your domain>` | this repo's README |
| RankUp (kids' chores) | `https://rankup.<your domain>` | RankUp `docs/LAUNCH.md`, `docs/IF-SOMETHING-BREAKS.md` |
| CyberLogix (fridge and freezer alerts) | `https://cyberlogix.<your domain>` | CyberLogix `DEPLOY.md`, `docs/OPERATIONS.md` |
| OmniArmor (compliance checks + Academy) | `https://omniarmor.<your domain>` | OmniArmor `docs/OPERATIONS.md`, `docs/COSTS.md` |

---

## 1. Know when something is down

Sign up for any free uptime monitor and add these four checks. Each answers
"OK" (status 200) when healthy, and something else when not. Have the
monitor email or text you.

| App | Check this address | Notes |
|---|---|---|
| MTRX Horizon | `https://<your domain>/healthz` | Answers GET and HEAD |
| RankUp | `https://rankup.<your domain>/api/health` | Shallow and public. With `Authorization: Bearer <CRON_SECRET>` it lists every scheduled job and answers 503 if one is late |
| CyberLogix | `https://cyberlogix.<your domain>/api/health` | Use this for the host's health check |
| CyberLogix, second check | `https://cyberlogix.<your domain>/api/watchdog` | Answers 503 when the alert sweep has stopped. Put this in the uptime monitor only, never in the host's health check (the host would restart the server and hide the problem) |
| OmniArmor | `https://omniarmor.<your domain>/healthz` | |

Check every 5 minutes. Most free monitors allow that.

Your MTRX Horizon console also shows each app's users, and whether each one
answered its last check. Give it the same addresses (`RANKUP_HEALTH_URL`,
`CYBERLOGIX_HEALTH_URL`, `OMNIARMOR_HEALTH_URL`) and it checks them once a
minute, draws the last day's ups and downs, and tells you when an app has
been down for 5 minutes: in the console, and by email once `MTRX_ALERT_EMAIL`
and the `MTRX_SMTP_*` settings are set (see the README).

---

## 2. Put out a new version (every time)

Do these in order. If any step fails, stop and fix it before going on.

**All apps, first:**
1. On GitHub, the latest automatic test run for the change is green.
2. A backup was taken in the last day (see section 4).

**RankUp** (the only one with a separate database):
3. Run the SQL files again on the live database, in the order in RankUp's
   `docs/BACKEND.md`. They are safe to run over a live database, and the
   new app version can fail without them.
4. Let the new version deploy (pushing to the main branch deploys it).
5. Open `https://rankup.<your domain>/api/health` with the secret: every
   check should say ok.

**CyberLogix, OmniArmor, MTRX Horizon** (their database is a file on the
server, and updates itself when the new version starts):
3. Let the new version deploy (pushing to the main branch deploys it).
4. Open the app's health address (section 1). It should answer OK within a
   few minutes.
5. Sign in and look at one main screen.

**MTRX Horizon only:** after it deploys, look once in Render's logs for the
line starting "Proxy check:". If it says "does not match", visitors are
being counted by the wrong address; tell me and I will fix it.

---

## 3. When something breaks: the first thing to do

Stay calm, write down the time, then:

| What you see | First step |
|---|---|
| An uptime monitor says an app is down | Open the host's dashboard for that app (Render or Cloudflare) and look at the latest deploy and logs. If the newest deploy broke it, roll back to the previous one in the dashboard. |
| CyberLogix watchdog says the sweep stopped | This is the important one: freezers are not being watched. Restart the CyberLogix service in Render. Then read CyberLogix `docs/OPERATIONS.md`, "dead man's switch". |
| Emails stopped arriving | Check the email service's dashboard for bounces or a suspended account. CyberLogix and OmniArmor keep unsent mail and send it when mail works again; RankUp's sign-in emails go through Supabase, so check its email settings too. |
| Payments failing | Look at the Stripe dashboard's webhook page for errors. Each app's payments doc explains its webhook. |
| Data looks wrong | Don't edit the database by hand. Take a backup first, then ask for help. |
| A customer says they can see someone else's data | Treat this as the most serious problem there is: take that app offline in the host's dashboard, then investigate. |

RankUp has a fuller guide for this: `docs/IF-SOMETHING-BREAKS.md`.

---

## 4. Backups

| App | Where its data lives | How it is backed up |
|---|---|---|
| RankUp | Supabase (Postgres) | Supabase's daily backups on the paid plan; RankUp `docs/BACKUPS.md` has the drill to prove a restore works |
| CyberLogix | A file on the Render disk | Daily automatic backups, checked before they are kept; see CyberLogix `docs/OPERATIONS.md` |
| OmniArmor | A file on the server disk | Daily automatic backups, checked before they are kept; see OmniArmor `docs/OPERATIONS.md` |
| MTRX Horizon | A file on the Render disk | Only approved devices and app numbers. If it is lost, set a new setup code and approve your devices again (README, "If every device is lost") |

Once a month, try a restore on a copy. A backup you have never restored is
a hope, not a backup.

---

## 5. Answering customers

Give each app its own help address on the shared domain, so you can tell at
a glance which app a message is about:

| App | Help address |
|---|---|
| RankUp | `help@rankup.<your domain>` |
| CyberLogix | `help@cyberlogix.<your domain>` |
| OmniArmor | `help@omniarmor.<your domain>` |
| MTRX Horizon (business enquiries) | set `MTRX_CONTACT_EMAIL` |

Rules of thumb:
- Answer within one working day. CyberLogix customers with a freezer
  problem: the same day.
- Never ask a customer for a password. Never send one.
- If a family or business asks for their data or for it to be deleted,
  each app has a "Download" and a "Delete" button for that. Point them to
  it; do not do it by hand.
- Keep a short list of questions people ask more than once. They become the
  help pages.

---

## 6. What it costs each month (roughly)

From each app's own docs. Prices change, so check the provider's pricing
page before you sign up.

| What | Roughly | Notes |
|---|---|---|
| Domain | about $10–15 a year | One domain, for MTRX Horizon. The apps use parts of it for free |
| MTRX Horizon server (Render starter + small disk) | about $7 a month | The free plan has no disk, so approved devices would be forgotten |
| CyberLogix server (Render starter + disk) | about $7 a month | Must not sleep: a sleeping server watches no freezers |
| OmniArmor server | $0–7 a month | A free-tier server works (OmniArmor `docs/COSTS.md`) |
| RankUp hosting (Cloudflare Pages) | $0 | |
| RankUp database (Supabase Pro) | about $25 a month | Needed before real families: the free plan keeps no backups you can count on |
| Email | $0 to start | Most email services have a free tier |
| Text messages and calls (CyberLogix, Twilio) | pay per message | CyberLogix tracks this and has a spending cap per business |
| Stripe | a fee per payment, no monthly fee | |

Before the first customer, that is roughly **$40–50 a month** plus the
domain.

---

## 7. Once a month

- [ ] Every uptime check was green, or you know why it wasn't.
- [ ] Try one restore from backup on a copy.
- [ ] Look at each app's open update requests on GitHub (Dependabot) and
      the automatic security checks.
- [ ] Look at the costs above against the real bills.
- [ ] Read the questions customers asked; add the common ones to help pages.
