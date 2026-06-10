// siouxland-feed — Cloudflare Worker relay for the Siouxland Libraries
// (Communico) events API, used for the SooGoings (Sioux Falls) deployment.
//
// Why: siouxland.libnet.info's bot protection 302-redirects non-browser
// clients to google.com — verified 2026-06-10 from residential AND
// datacenter IPs, so unlike its larl.libnet.info sibling this one is blocked
// everywhere except (hopefully) Cloudflare egress. Same relay pattern as
// infra/larl-feed-worker: dynamic `req` query param, querystring forwarded
// verbatim to the origin.
//
// Access is gated by a shared secret (Worker secret SIOUXLAND_KEY) passed as
// ?key=…; every other query param is forwarded verbatim to the origin.
//
// Deploy:  cd infra/siouxland-feed-worker && npx wrangler deploy
// Secret:  npx wrangler secret put SIOUXLAND_KEY   (same value as the ?key=
//          in the SooGoings .env SIOUXLAND_EVENTS_URL)

const ORIGIN = "https://siouxland.libnet.info/eeventcaldata"

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!env.SIOUXLAND_KEY || url.searchParams.get("key") !== env.SIOUXLAND_KEY) {
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
          Referer: "https://siouxland.libnet.info/events",
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        // The WAF rejects via 302-to-google rather than 403; don't follow it
        // or a Google HTML page would masquerade as a 200.
        redirect: "manual",
        // Short edge cache; the date window changes daily so the cache key
        // (full query) naturally rotates.
        cf: { cacheTtl: 1800, cacheEverything: true },
      })

      if (upstream.status !== 200) {
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
          "X-Relayed-From": "siouxland.libnet.info",
        },
      })
    } catch (err) {
      return new Response(`relay error: ${err}\n`, { status: 502 })
    }
  },
}
