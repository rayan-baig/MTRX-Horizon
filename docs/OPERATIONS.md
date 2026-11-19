# Looking after the MTRX Horizyn site

What to watch, and what to do when something goes wrong. For all four apps
together (backups, putting out a new version, costs), see
[RUNNING-MTRX-HORIZYN.md](RUNNING-MTRX-HORIZYN.md).

## The two health addresses

| Address | What it checks | Answers |
|---|---|---|
| `https://mtrxhorizyn.com/healthz` | Is the site answering at all? Nothing else. | 200 when it answers |
| `https://mtrxhorizyn.com/readyz` | Can it do its work? The database can be written to, the settings it needs are there, and its background jobs ran in the last 5 minutes. | 200 when all are fine, 503 when one isn't |

Both answer GET and HEAD, and neither shows any secret, setting, version of
anything it uses, or anything about a visitor. `/readyz` works its answer out
at most once every 5 seconds, so it is fine to ask it every minute.

Open `/readyz` in a browser to see which part is wrong. It looks like this:

```json
{"ok": true,
 "checks": {"database": "ok", "settings": "ok", "background_jobs": "ok"},
 "background_jobs_last_ran_seconds_ago": 42}
```

Render's own health check (`render.yaml`) uses `/healthz`. Leave it that way:
if Render used `/readyz`, it would restart the site whenever a background job
stopped, and you would never hear about the problem.

## If the app is down

### 1. Set up a free uptime monitor (once, before launch)

Any free monitor works. Two that do:

- **UptimeRobot**, free plan: checks every 5 minutes, emails you.
- **Better Stack** (Uptime), free plan: checks every 3 minutes, emails you,
  and can text you.

Add **two** checks, both of the "HTTP(s)" kind:

1. `https://mtrxhorizyn.com/healthz`, named "MTRX Horizyn site".
2. `https://mtrxhorizyn.com/readyz`, named "MTRX Horizyn working".

Have both email you when they go down. Leave every other option as it is:
any answer that is not 200 counts as down, which is what you want.

(If the site is ever behind Cloudflare, its free health checks can watch the
same two addresses instead.)

### 2. What each alert means, and what to do

**"MTRX Horizyn site" is down** (`/healthz` not answering): nobody can see the site.

1. Open Render, then the `mtrx-horizon` service.
2. Look at **Events**. If the newest deploy says "failed", open its logs and
   look for a line starting **"MTRX Horizyn can't start"**. It says which
   setting is missing or wrong. Fix it on the **Environment** page and save;
   Render starts the site again by itself.
3. If there is no such line and the newest deploy broke the site, press
   **Rollback** on the deploy before it.
4. If nothing changed, look at https://status.render.com for a Render outage.
5. Still down after 15 minutes? Press **Manual Deploy**, then
   **Restart service**.

**"MTRX Horizyn working" is down, but "MTRX Horizyn site" is up**: visitors can
see the site, but something behind it is wrong. Open
`https://mtrxhorizyn.com/readyz` and find the check that isn't "ok":

| What it says | What it means | What to do |
|---|---|---|
| `"database": "failing"` | The site can't write to its database. The public pages still load (the home page shows the three founding apps), but your console, Orbyt, Genesis Pro and sign-ups won't work. | In Render, open the service's **Disks** page: the disk should be there, at `/app/data`. Then **Restart service**. If it still fails, the logs say why ("the database can't be written to (...)"); send that line to whoever helps you with the code. |
| `"settings": "missing"` | A setting the site needs is missing. (Normally the site won't even start without it.) | Look in the logs for "can't start" and fix the setting it names. |
| `"background_jobs": "late"` | The jobs the site runs every minute (checking the other apps, sending launch emails, tidying old data) haven't finished a round for over 5 minutes. Something is stuck. | **Restart service** in Render. Check `/readyz` again 2 minutes later. |
| `"background_jobs": "stopped"` | The jobs aren't running. The site starts them again by itself the next time `/readyz` is asked. | Wait for the next check. If it is still down after 10 minutes, **Restart service**. |
| `"background_jobs": "failing"` | One job has failed 3 rounds in a row. You also get a "server error" email whose **Request** line starts with `JOB` and names the job. | Restart may help. Forward the email to whoever helps you with the code; it holds nothing private. |

When it is fixed, the monitor emails you that it is back up.

### 3. Other emails the site sends you

These need `MTRX_ALERT_EMAIL` and the `MTRX_SMTP_*` settings (README, "App
health"). Without them, you only see these in the console's Recent activity.

- **"RankUp is down"** (or CyberLogix AI, OmniArmor.ai): that app, not this
  site. See its own docs, listed in RUNNING-MTRX-HORIZYN.md.
- **"MTRX Horizyn: server error (...)"**: a page or a job hit an error the
  code didn't expect. One a visitor saw shows `GET` or `POST` and a page; one
  from a background job shows `JOB` and the job's name. At most one email an
  hour for each error. Forward it to whoever helps you with the code.

## When an outside service is slow or down

The site keeps working, and tells visitors to try again, when:

- **The AI provider** (Ask Genesis) is slow or down. Each ask waits at most
  30 seconds for an answer (5 to connect). At most 8 asks wait at once; more
  are told "try again in a minute" straight away, so the rest of the site
  stays fast.
- **Stripe** (Genesis Pro) is slow or down. Each call waits at most 15 seconds
  for the whole answer, and at most 8 wait at once. A buyer is told to try
  again; Stripe sends its events again later by itself.
- **Email** is down. Emails are sent in the background, and each step
  waits at most 15 seconds for the mail server, so no page waits for them.
- **The database can't be read.** The public pages still load, with the
  three founding apps.

There is nothing to do unless it lasts. Then look at that service's own
status page.

## When the site starts

On Render (and on staging), the site checks its settings each time it starts.
`MTRX_PRODUCTION=1` turns this on; the `Dockerfile` sets it, so you never set
it yourself. The site won't start, and its log says **"MTRX Horizyn can't
start, because of its settings"** and what to fix, when:

- `MTRX_KNOCK` is missing, or isn't a knock it understands (at least 4 taps, using
  `logo`, `rankup`, `cyberlogix`, `omniarmor`, `mark`). Without it you can't
  open your console.
- `MTRX_PUBLIC_URL` is missing or doesn't start with `https://`. Email links and
  the QR codes use it.
- `MTRX_DEV` is `1`. That is for a computer at home only, never the internet.
- The database file can't be opened ("can't open its database file"): check the
  disk on Render's **Disks** page.

Other things it notices are only written to the log, as lines starting
**"Setup:"**, and the site starts anyway: for example, Genesis Pro switched on
without its Stripe settings (it stays off until they are there), or alert
email not set up.

## Reading the logs

Render shows the site's log on the service's **Logs** page. Each line from
the site starts with the time (in UTC, so it may differ from your clock),
then how serious it is (`INFO`, `WARNING`, `ERROR` or `CRITICAL`), then
`horizon:` and what happened. Lines never hold a visitor's words, email or
address, or any secret: failures are written down by their kind only.
