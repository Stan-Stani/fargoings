import { decodeHtmlEntities } from "../dedup/normalize"
import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { DEFAULT_BROWSER_HEADERS, fetchWithRetry } from "./shared"

export interface FargoTheatreEvent {
  title: string
  url: string
  /** YYYY-MM-DD */
  date: string
  imageUrl: string | null
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

/**
 * Fargo Theatre (downtown landmark cinema/venue) runs WordPress with the
 * "Theater for WordPress" plugin, but its REST routes carry no structured
 * event dates — the /events/ listing page is the only place dates appear
 * ("Friday, October 9th, 2026"), so this scrapes that one page. Each
 * `<div class="post">` block holds the link, poster image, `<h4>` title and
 * a date `<p>`. No showtimes are published anywhere parseable (startTime
 * stays null). Daily movie showtimes are a different plugin and deliberately
 * out of scope — they'd spam the feed with screenings.
 *
 * Wordfence 406s non-browser user agents; DEFAULT_BROWSER_HEADERS plus an
 * HTML Accept header gets a 200.
 */
export class FargoTheatreFetcher {
  private readonly listingUrl = "https://fargotheatre.org/events/"

  async fetchEvents(): Promise<FargoTheatreEvent[]> {
    try {
      const response = await fetchWithRetry(
        this.listingUrl,
        {
          headers: {
            ...DEFAULT_BROWSER_HEADERS,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: "https://fargotheatre.org/",
            Origin: "https://fargotheatre.org",
          },
        },
        "Fargo Theatre events fetch",
        4,
      )
      const html = await response.text()

      const events: FargoTheatreEvent[] = []
      for (const block of html.split(/<div class="post">/).slice(1)) {
        const link = block.match(
          /<a href="(https:\/\/fargotheatre\.org\/event\/[^"]+)"><h4>([\s\S]*?)<\/h4>/,
        )
        if (!link) continue
        const date = this.parseLongDate(block)
        if (!date) continue

        const image = block.match(/data-src="(https:\/\/[^"]+)"/)

        events.push({
          title: decodeHtmlEntities(link[2])
            .replace(/<[^>]+>/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim(),
          url: link[1],
          date,
          imageUrl: image?.[1] ?? null,
        })
      }

      console.log(`   Parsed ${events.length} Fargo Theatre events`)
      return events
    } catch (error) {
      logError("Error fetching Fargo Theatre events:", error)
      throw error
    }
  }

  transformToStoredEvent(
    event: FargoTheatreEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    const slug =
      event.url.split("/").filter(Boolean).pop() ?? "event"

    return {
      eventId: `ftheatre_${slug}_${event.date}`,
      title: event.title,
      url: event.url,
      // Venue's own site — everything here is at the theatre. Set inline
      // because the VENUE_RULES title/location matcher has nothing to match
      // on ("An Evening with David Sedaris", no upstream location).
      location: "Fargo Theatre, 314 Broadway N",
      date: event.date,
      startTime: null,
      startDate: event.date,
      endDate: event.date,
      latitude: 46.8762,
      longitude: -96.7898,
      city: "Fargo",
      imageUrl: event.imageUrl,
      categories: JSON.stringify([]),
      source: "fargotheatre.org",
    }
  }

  /** "Friday, October 9th, 2026" → "2026-10-09" (first match in the block). */
  private parseLongDate(block: string): string | null {
    const m = block.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i,
    )
    if (!m) return null
    const month = MONTHS[m[1].toLowerCase()]
    if (!month) return null
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`
  }
}
