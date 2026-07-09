/**
 * Venue enrichment from event pages.
 *
 * Some sources publish events with no usable venue at all (see
 * isJunkLocation), but the event's own page still links out to the venue's
 * website — e.g. Paradox Comics' fargounderground.com posts carry an
 * "Info & Tickets" link to paradoxcnc.com even though their venue record only
 * has the state filled in. For upcoming events that are still locationless
 * after title-based enrichment, fetch the event page once and match each
 * venue rule's htmlPattern against the HTML.
 */

import { getActiveCity } from "../cities"
import { EventDatabase } from "../db/database"
import { fetchWithRetry } from "../fetchers/shared"
import { VenueRule } from "./venues"

/**
 * Ceiling on page fetches per run. Enriched events keep their location across
 * later upserts (COALESCE), so anything skipped here is retried — and the
 * backlog shrinks — on the next run.
 */
const MAX_PAGE_FETCHES = 25

export async function enrichVenuesFromEventPages(
  db: EventDatabase,
  today: string,
): Promise<number> {
  const rules = getActiveCity().venueRules.filter((rule) => rule.htmlPattern)
  if (rules.length === 0) return 0

  const candidates = db.getLocationlessUpcomingEvents(today)
  if (candidates.length === 0) return 0

  // Each occurrence of a recurring event has its own URL, but cache per URL
  // anyway so same-URL candidates cost a single fetch.
  const matchByUrl = new Map<string, VenueRule | null>()
  let fetches = 0
  let skipped = 0
  let count = 0

  for (const event of candidates) {
    let match = matchByUrl.get(event.url)
    if (match === undefined) {
      if (fetches >= MAX_PAGE_FETCHES) {
        skipped++
        continue
      }
      fetches++
      match = null
      try {
        // No custom headers: fargounderground.com's Cloudflare rules pass
        // curl-like UAs but challenge browser-like ones (see the fetcher).
        const response = await fetchWithRetry(
          event.url,
          {},
          "Venue page fetch",
          2,
        )
        const html = await response.text()
        match = rules.find((rule) => rule.htmlPattern!.test(html)) ?? null
      } catch {
        console.warn(`   ⚠️ Could not fetch ${event.url} for venue enrichment`)
      }
      matchByUrl.set(event.url, match)
    }

    if (match) {
      db.applyVenueRule(event.eventId, match)
      count++
    }
  }

  if (skipped > 0) {
    console.log(
      `   ⏭️  Venue page enrichment hit the ${MAX_PAGE_FETCHES}-fetch cap; ${skipped} events deferred to the next run`,
    )
  }
  return count
}
