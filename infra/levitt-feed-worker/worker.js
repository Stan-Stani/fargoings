// levitt-feed — Cloudflare Worker relay for the Levitt at the Falls
// (levittsiouxfalls.org) The Events Calendar REST feed, used by SooGoings.
//
// Why: the site's WAF returns HTTP 403 to the production VPS's DigitalOcean
// IP (and to IPs that probed it) — verified 2026-06-10. Same relay pattern
// as infra/larl-feed-worker: the querystring (per_page/page/start_date/
// end_date) is forwarded verbatim to the origin.
//
// Access is gated by a shared secret (Worker secret LEVITT_KEY) passed as
// ?key=…; every other query param is forwarded verbatim to the origin.
//
// Deploy:  cd infra/levitt-feed-worker && npx wrangler deploy
// Secret:  npx wrangler secret put LEVITT_KEY   (same value as the ?key=
//          in the SooGoings .env LEVITT_EVENTS_URL)

const ORIGIN = "https://www.levittsiouxfalls.org/wp-json/tribe/events/v1/events"

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!env.LEVITT_KEY || url.searchParams.get("key") !== env.LEVITT_KEY) {
      return new Response("forbidden\n", { status: 403 })
    }

    const params = new URLSearchParams(url.search)
    params.delete("key")
    const target = `${ORIGIN}?${params.toString()}`

    try {
      const upstream = await fetch(target, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.levittsiouxfalls.org/events/",
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
      const contentType = upstream.headers.get("content-type") ?? ""
      if (!contentType.includes("json")) {
        return new Response(`upstream non-JSON (${contentType})\n`, {
          status: 502,
        })
      }

      const body = await upstream.text()
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=1800",
          "X-Relayed-From": "levittsiouxfalls.org",
        },
      })
    } catch (err) {
      return new Response(`relay error: ${err}\n`, { status: 502 })
    }
  },
}
