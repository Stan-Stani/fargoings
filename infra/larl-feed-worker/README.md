# larl-feed — LARL / Moorhead Public Library feed relay

## Problem

Moorhead Public Library events come from the Lake Agassiz Regional Library
(LARL) Communico/LibNet calendar: `larl.libnet.info/eeventcaldata`. That host
sits behind an **AWS WAF/ALB** (`server: awselb/2.0`) that returns **HTTP 403**
to the production VPS's DigitalOcean datacenter IP. The public `/events` HTML
page is reachable from the VPS, but the JSON API endpoint is not. Plain
requests from a residential/office IP get `200` + JSON, so it is an IP-class
block, not a header/cookie issue.

Verified 2026-05-15: a Cloudflare Worker reaches it fine (`status 200`, 18
events, ~450ms) — Cloudflare egress is not in the WAF's blocklist. This Worker
is the relay. Same approach as `infra/wfpl-feed-worker` (West Fargo), but the
LARL endpoint takes a dynamic `req` query param (the date window), so this
relay **forwards the querystring** instead of hardcoding the URL.

## Architecture

```
VPS cron (Thu 05:00, `npm start`)
  → MoorheadLibraryFetcher reads MPH_EVENTS_URL from /root/fargoings/.env
    → GET https://larl-feed.<sub>.workers.dev/?key=SECRET&event_type=0&req=<json>
      → Worker drops key=, forwards rest to
        https://larl.libnet.info/eeventcaldata?event_type=0&req=<json>
      ← JSON array of Moorhead (location 3119) events
  → normal parse / dedup / rebuild pipeline
```

`src/fetchers/moorheadlibrary-org.ts`: if `MPH_EVENTS_URL` is set it is used
as the base (it already carries `?key=…`) and `event_type`/`req` are appended
with `&`; otherwise the origin is hit directly (works only from non-blocked
IPs, e.g. local dev).

## Deploy / operate

```bash
cd infra/larl-feed-worker
npx wrangler deploy
npx wrangler secret put LARL_KEY    # paste the shared secret
```

Shared secret lives in two places that must match (never in this repo):
1. Worker secret `LARL_KEY` (`wrangler secret put`).
2. VPS `/root/fargoings/.env` →
   `MPH_EVENTS_URL=https://larl-feed.<sub>.workers.dev/?key=<secret>`
   (`.env` is gitignored; read by `index.ts`/`refetch.ts` via dotenv).

Rotate: regenerate secret → `wrangler secret put LARL_KEY` → update the
`?key=` in the VPS `.env`. Retire: if LARL/Communico ever allowlists the VPS
IP, unset `MPH_EVENTS_URL` and `npx wrangler delete --name larl-feed`.

## Verify

```bash
curl -s "https://larl-feed.<sub>.workers.dev/?key=SECRET&event_type=0&req=%7B%22private%22%3Afalse%2C%22date%22%3A%222026-05-18%22%2C%22days%22%3A14%2C%22locations%22%3A%5B%223119%22%5D%2C%22ages%22%3A%5B%5D%2C%22types%22%3A%5B%5D%7D" | head -c 120
# wrong/no key -> 403; Moorhead branch id = 3119
```
