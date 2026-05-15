// wfpl-feed — Cloudflare Worker relay for the West Fargo Public Library
// iCal feed.
//
// Why this exists: West Fargo's web server (207.38.72.44, shared with
// westfargond.gov) silently firewalls the production VPS's DigitalOcean IP,
// so the VPS cannot fetch the library calendar directly. Cloudflare's egress
// IPs are NOT blocked (verified 2026-05-15), so the VPS fetches this Worker
// instead and the Worker fetches the origin.
//
// Access is gated by a shared secret (Worker secret WFPL_KEY) passed as
// ?key=… so this isn't an open relay. The upstream is a public government
// calendar, so the risk is low; the gate just keeps it tidy.
//
// Deploy:  cd infra/wfpl-feed-worker && npx wrangler deploy
// Secret:  npx wrangler secret put WFPL_KEY   (same value as in the VPS
//          /root/fargoings/.env WFPL_ICS_URL ?key= param)

const ORIGIN =
  "https://www.westfargolibrary.org/common/modules/iCalendar/iCalendar.aspx?catID=25&feed=calendar"

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!env.WFPL_KEY || url.searchParams.get("key") !== env.WFPL_KEY) {
      return new Response("forbidden\n", { status: 403 })
    }

    try {
      const upstream = await fetch(ORIGIN, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/calendar, text/plain, */*",
        },
        // Cache at Cloudflare's edge so repeated VPS pulls don't hammer
        // the origin; the calendar changes slowly.
        cf: { cacheTtl: 3600, cacheEverything: true },
      })

      if (!upstream.ok) {
        return new Response(`upstream ${upstream.status}\n`, { status: 502 })
      }

      const body = await upstream.text()
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          "X-Relayed-From": "westfargolibrary.org",
        },
      })
    } catch (err) {
      return new Response(`relay error: ${err}\n`, { status: 502 })
    }
  },
}
