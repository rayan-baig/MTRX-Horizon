# A staging copy

A second, separate copy of the MTRX Horizyn site and console on Render, at
`staging.example.com` (where `example.com` stands for MTRX Horizyn's domain,
as in the README). You try a change there first, and only then put it on
the live site.

The rule for everything below: **staging shares nothing with live.** Not the
database, not the disk, not the setup code, not the knock, not the stats key,
not a mail account. A device approved on live is not approved on staging,
and the other way round.

## Why it is not in render.yaml

`render.yaml` is the live site's Blueprint. A staging service added to it
would be created and changed every time the live Blueprint is synced, and
one careless edit to the shared file could touch the live service (its disk
is named just `data`). So staging is set up once, by hand, in Render's
dashboard, with the settings below. It costs about the same as live (a
starter instance and a small disk).

Never put any of these in `render.yaml`:

- the staging service, its disk or its branch;
- `MTRX_NOINDEX` (on live it would take the home page out of search results);
- any staging value: its `MTRX_SETUP_TOKEN`, `MTRX_KNOCK`, `MTRX_STATS_KEY`,
  `MTRX_PUBLIC_URL`, or a test inbox's `MTRX_SMTP_*` settings. Secrets are
  typed into the service's Environment page, never committed.

## 1. The service

Render → New → Web Service → this repository.

| Setting | Value |
|---|---|
| Name | `mtrx-horizon-staging` |
| Runtime | Docker (the same `Dockerfile`) |
| Branch | `staging` (make it once from the live branch) |
| Instance type | Starter, not Free (Free has no disk, so approved devices would be forgotten) |
| Instances | 1 |
| Health check path | `/healthz` |
| Auto-deploy | On: a push to `staging` deploys it |
| Disk | Its own, new disk: name `mtrx-horizon-staging-data`, mount path `/app/data`, 1 GB |

Never attach the live disk, and never copy the live database onto staging:
it holds the owner's approved devices and the apps' numbers.

## 2. The address

1. Where the domain's DNS is managed, add a `CNAME` named `staging` pointing
   at the staging service's `onrender.com` address.
2. Render: the staging service → Settings → Custom Domains → add
   `staging.example.com`, and wait for the certificate. It must be served
   over https: browsers only make device keys on secure sites.

Its cookies have no `Domain`, so they belong to `staging.example.com` alone,
and the console checks the exact address of every change, so staging's pages
can never act on live's console (README, "The domain, and the apps'
subdomains").

## 3. The settings

Set these on the staging service (Environment). Make new secrets; never
paste in the live ones.

| Setting | Staging value | Why |
|---|---|---|
| `MTRX_DB_PATH` | `/app/data/horizon.db` | On staging's own disk |
| `MTRX_TRUST_PROXY` | `1` | Render's proxy, as on live |
| `MTRX_PUBLIC_URL` | `https://staging.example.com` | QR codes for approving a device point at staging, not live |
| `MTRX_NOINDEX` | `1` | Search engines leave it out (section 5) |
| `MTRX_SETUP_TOKEN` | a new one (section 6) | Live's would approve a device on staging, and staging's must never work on live |
| `MTRX_KNOCK` | a different knock from live's | Trying staging must not teach anyone live's knock |
| `MTRX_STATS_KEY` | empty, or a new one | Section 4 |
| `RANKUP_STATS_URL`, `CYBERLOGIX_STATS_URL`, `OMNIARMOR_STATS_URL` | empty, or the apps' staging copies | Never live's apps (section 4) |
| `RANKUP_HEALTH_URL`, `CYBERLOGIX_HEALTH_URL`, `OMNIARMOR_HEALTH_URL` | empty, or the apps' staging copies | So staging's alerts are about staging |
| `RANKUP_URL`, `CYBERLOGIX_URL`, `OMNIARMOR_URL` | empty, or the apps' staging copies | The "Open app" buttons |
| `MTRX_ALERT_EMAIL` and `MTRX_SMTP_*` | empty, or a test inbox | Section 4 |
| `MTRX_CONTACT_EMAIL` | empty | Nobody should write to staging |
| `MTRX_DEV` | unset | Never on a site on the internet, staging included |

`MTRX_SESSION_HOURS`, `MTRX_KNOCK_MINUTES` and `MTRX_ALERT_MINUTES` as on
live, so staging behaves the same.

## 4. Nothing reaches a real person, or a live app

### Mail

**Leave `MTRX_ALERT_EMAIL` and `MTRX_SMTP_HOST` empty.** Then no mail is
sent: "app is down" alerts and the server's own error reports show only in
the console's **Recent activity**. That is enough for most tests.

To see the emails as they would arrive, use a test inbox service that
accepts SMTP over encryption (the site refuses a server without it) and
delivers nothing, and put its details in `MTRX_SMTP_HOST`, `MTRX_SMTP_PORT`,
`MTRX_SMTP_USER` and `MTRX_SMTP_PASSWORD`, with the test inbox in
`MTRX_ALERT_EMAIL`. Never live's mail account. `MTRX_ALERT_FROM`, if set, is
a staging address such as `alerts@staging.example.com`.

### The apps' numbers

The console sends `MTRX_STATS_KEY` to every `*_STATS_URL`. Never point
staging at the live apps with live's key: the key would then sit on a second
server, and staging's console would show real customers' numbers. Either
leave the stats addresses empty (the console says "Not connected", which is
true), or connect the apps' own staging copies with a new key that only
they and staging have (CyberLogix's and OmniArmor's `docs/STAGING.md` say
the same from their side).

## 5. Out of search engines

The console already answers `noindex` and robots.txt never names it. For the
rest of a staging copy, `MTRX_NOINDEX=1` (added in 1.2.1) makes every answer
carry `X-Robots-Tag: noindex`, the home page and the legal pages included;
`/robots.txt` becomes `Disallow: /` and `/sitemap.xml` lists nothing.
Otherwise a search for the company could land on staging.

Check it after each deploy:

```sh
curl -sI https://staging.example.com/ | grep -i x-robots-tag
curl -s https://staging.example.com/robots.txt
```

Leave `MTRX_NOINDEX` unset on live.

## 6. Getting in: a fresh setup code

Staging starts with no approved devices. There is nothing else to seed: the
console's numbers come from the apps (section 4) and from staging's own
checks.

1. Make a new setup code, at least 16 characters, used for staging only:
   `python3 -c "import secrets; print(secrets.token_urlsafe(24))"`. Put it in
   staging's `MTRX_SETUP_TOKEN` and save (it redeploys).
2. On your laptop open `https://staging.example.com/console/add/<the code>`,
   name the device and press **Approve this device**. Approve a second device
   by QR code from the console, as on live (README, "The first time").
3. **Delete `MTRX_SETUP_TOKEN` from staging's settings.** The code works once,
   but "used once" lives in staging's database; with the setting gone there
   is nothing to reuse.
4. Use staging's own knock (`MTRX_KNOCK`) from then on.

If staging's devices are all lost, or its disk is replaced, do the same with
another new code.

## 7. From staging to live, a checklist

- [ ] Push the change to the `staging` branch. Staging deploys it.
- [ ] `curl -s https://staging.example.com/healthz` answers `"ok": true`
      with the new version from `VERSION`.
- [ ] `python -m pytest -q` passes, and GitHub Actions is green for that
      commit.
- [ ] In staging's Render logs, the line starting "Proxy check:" does not
      say "does not match".
- [ ] Walk the change by hand: the home page, then the knock and the console
      on an approved staging device. For anything that emails, read it in
      **Recent activity** (or the test inbox).
- [ ] If the change needs a new setting, add it to live by hand now, with
      live's own value. Settings do not travel with a commit.
- [ ] Merge the **same commit** into the live branch (the one the live
      service deploys) as a fast-forward: `git checkout <live branch> &&
      git merge --ff-only staging && git push`. Do not re-type the change:
      the commit that was tested is the commit that ships.
- [ ] Live deploys on the push (if auto-deploy is off: the service → Manual
      Deploy → Deploy latest commit). Check `https://example.com/healthz`
      shows the same version, that `curl -sI https://example.com/` has **no**
      `X-Robots-Tag`, and look once for live's "Proxy check:" line
      ([RUNNING-MTRX-HORIZYN.md](RUNNING-MTRX-HORIZYN.md), section 2).

## 8. Keeping them apart, a checklist

- [ ] Staging has its own disk; the live disk is attached to live only.
- [ ] `MTRX_PUBLIC_URL` on staging is the staging address.
- [ ] `MTRX_NOINDEX=1` on staging, and unset on live.
- [ ] Staging's setup code was made for staging, used once, and deleted.
- [ ] Staging's knock is not live's.
- [ ] `MTRX_STATS_KEY` on staging is empty or a staging-only key, and no
      `*_STATS_URL` on staging points at a live app.
- [ ] Mail on staging is off or a test inbox.
- [ ] `MTRX_DEV` is unset on both.
- [ ] No copy of the live database has ever been put on staging.
- [ ] Nothing about staging is in `render.yaml`.
