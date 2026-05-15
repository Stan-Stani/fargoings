// larl-feed — Cloudflare Worker relay for the Lake Agassiz Regional Library
// (LARL / Communico) events API, used for the Moorhead Public Library feed.
//
// Why: larl.libnet.info sits behind an AWS WAF/ALB that returns HTTP 403 to
// the production VPS's DigitalOcean datacenter IP. Cloudflare Worker egress
// is NOT blocked (verified 2026-05-15: status 200, 18 events). Sibling of
// infra/wfpl-feed-worker, but this endpoint takes a dynamic `req` query
// param (the date window), so the relay forwards the querystring instead of
// hardcoding the URL.
//
// Access is gated by a shared secret (Worker secret LARL_KEY) passed as
// ?key=…; every other query param is forwarded verbatim to the origin.
//
// Deploy:  cd infra/larl-feed-worker && npx wrangler deploy
// Secret:  npx wrangler secret put LARL_KEY   (same value as the ?key= in
//          the VPS /root/fargoings/.env MPH_EVENTS_URL)

const ORIGIN = "https://larl.libnet.info/eeventcaldata"

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!env.LARL_KEY || url.searchParams.get("key") !== env.LARL_KEY) {
      return new Response("forbidden\n", { status: 403 })
    }

    const params = new URLSearchParams(url.search)
    params.delete("key")
    const target = `${ORIGIN}?${params.toString()}`

    try {
      const upstream = await fetch(target, {
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        // Short edge cache; the date window changes daily so the cache key
        // (full query) naturally rotates.
        cf: { cacheTtl: 1800, cacheEverything: true },
      })

      if (!upstream.ok) {
        return new Response(`upstream ${upstream.status}\n`, { status: 502 })
      }

      const body = await upstream.text()
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=1800",
          "X-Relayed-From": "larl.libnet.info",
        },
      })
    } catch (err) {
      return new Response(`relay error: ${err}\n`, { status: 502 })
    }
  },
}
