# wfpl-feed — West Fargo Public Library feed relay

## Problem

`westfargolibrary.org` and `westfargond.gov` both resolve to `207.38.72.44`
(West Fargo's own city server — not CivicPlus SaaS, no CDN). That server
**silently firewalls the production VPS's DigitalOcean IP** (`159.203.249.74`,
AS14061): TCP to :443/:80 gets no SYN-ACK. It is not a WAF/403 — control test:
`civicplus.com` itself loads fine from the VPS, so it is *not* a blanket
CivicPlus datacenter block, just West Fargo's edge ACL against DO. Not
publicly documented (municipal firewall policy). The library calendar data
exists **only** on that host (the RSS feed is the same server, also blocked),
so there is no alternate origin.

Verified 2026-05-15: a Cloudflare Worker reaches the origin fine
(`{"reachable":true,"httpStatus":200,"vevents":180}`) — Cloudflare egress is
not in West Fargo's blocklist. This Worker is that relay.

## Architecture

```
VPS cron (Thu 05:00, `npm start`)
  → fetcher reads WFPL_ICS_URL from /root/fargoings/.env
    → GET https://wfpl-feed.<sub>.workers.dev/?key=SECRET   (Cloudflare — reachable)
      → Worker fetches https://www.westfargolibrary.org/...catID=25  (origin)
      ← returns text/calendar (edge-cached 1h)
  → normal parse / dedup / rebuild pipeline
```

The fetcher override lives in `src/fetchers/westfargolibrary-org.ts`:
- `WFPL_ICS_FILE=/path` — parse a local `.ics` (manual fallback), **wins** if set.
- `WFPL_ICS_URL=https://…` — fetch from this URL instead of the blocked origin.
- neither set — fetch the origin directly (works only from non-blocked IPs).

## Deploy / operate

```bash
cd infra/wfpl-feed-worker
npx wrangler deploy                 # publishes to <name>.<sub>.workers.dev
npx wrangler secret put WFPL_KEY    # paste the shared secret (see below)
```

The shared secret is **not** in this repo. It lives in two places that must
match:
1. Worker secret `WFPL_KEY` (`wrangler secret put`).
2. VPS `/root/fargoings/.env` → `WFPL_ICS_URL=https://wfpl-feed.<sub>.workers.dev/?key=<secret>`
   (`.env` is gitignored; read by `index.ts`/`refetch.ts` via dotenv).

Rotate: regenerate a secret, `wrangler secret put WFPL_KEY`, update the
`?key=` in the VPS `.env`. To retire the relay entirely, get West Fargo IT to
allowlist `159.203.249.74`, then unset `WFPL_ICS_URL` and
`npx wrangler delete --name wfpl-feed`.

## Verify

```bash
# from anywhere (Cloudflare is reachable):
curl -s "https://wfpl-feed.<sub>.workers.dev/?key=SECRET" | grep -c BEGIN:VEVENT   # ~180
# wrong/no key -> 403
```
