import { decodeHtmlEntities } from "../dedup/normalize"
import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { DEFAULT_BROWSER_HEADERS, fetchWithRetry } from "./shared"

export interface FargoTheatreEvent {
  title: string
  url: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM:SS of the first show, from the detail page; null if not listed. */
  startTime: string | null
  /** From the detail page's details line (film rating → film). */
  category: string | null
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
 * a date `<p>`. Showtimes are only on each event's detail page, in a
 * details `<h5>` ("Friday, October 9th, 2026 • 7pm show, 6pm doors and
 * 9:30pm show, 9pm doors • …"), so each listed event costs one extra
 * request (a handful per run). Daily movie showtimes are a different plugin
 * and deliberately out of scope — they'd spam the feed with screenings.
 *
 * Wordfence 406s non-browser user agents; DEFAULT_BROWSER_HEADERS plus an
 * HTML Accept header gets a 200.
 */
const LISTING_HEADERS: Record<string, string> = {
  ...DEFAULT_BROWSER_HEADERS,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  Referer: "https://fargotheatre.org/",
  Origin: "https://fargotheatre.org",
}

/** The detail page's `<div class="details">…<h5>` line, decoded, or null. */
export function parseDetailsLine(html: string): string | null {
  const m = html.match(/<div class="details">[\s\S]*?<h5>([\s\S]*?)<\/h5>/)
  if (!m) return null
  return decodeHtmlEntities(m[1].replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * First "<time> show" in the details line → "HH:MM:SS". Doors times are
 * ignored ("7pm show, 6pm doors" → 19:00). Null when no show time is listed.
 */
export function parseShowTime(details: string): string | null {
  const m = details.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+show/i)
  if (!m) return null
  const hours = (Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)
  return `${String(hours).padStart(2, "0")}:${m[2] ?? "00"}:00`
}

/** Films list an MPAA rating or "Film Not Yet Rated"; the rest are live. */
export function categorizeDetails(details: string, title: string): string {
  if (/\b(film|screening|movie)\b|•\s*(G|PG|PG-13|R|NR|NC-17)\s*(•|$)/i.test(`${details} ${title}`))
    return "Film & Media"
  if (/symphony|orchestra|concert|\bband\b/i.test(title)) return "Live Music"
  return "Live Performance"
}

export class FargoTheatreFetcher {
  private readonly listingUrl = "https://fargotheatre.org/events/"

  async fetchEvents(): Promise<FargoTheatreEvent[]> {
    try {
      const response = await fetchWithRetry(
        this.listingUrl,
        { headers: LISTING_HEADERS },
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

        // Lazy-loaded posters carry data-src; the first (eager) one uses a
        // plain src.
        const image =
          block.match(/data-src="(https:\/\/[^"]+)"/) ??
          block.match(/\ssrc="(https:\/\/[^"]+)"/)

        events.push({
          title: decodeHtmlEntities(link[2])
            .replace(/<[^>]+>/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim(),
          url: link[1],
          date,
          startTime: null,
          category: null,
          imageUrl: image?.[1] ?? null,
        })
      }

      for (const event of events) {
        try {
          const detail = await fetchWithRetry(
            event.url,
            { headers: LISTING_HEADERS },
            `Fargo Theatre detail fetch (${event.url})`,
            2,
          )
          const details = parseDetailsLine(await detail.text())
          if (details) {
            event.startTime = parseShowTime(details)
            event.category = categorizeDetails(details, event.title)
          }
        } catch (error) {
          // A missing showtime isn't worth dropping the event over.
          logError(`Fargo Theatre detail fetch failed for ${event.url}:`, error)
        }
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
      startTime: event.startTime,
      startDate: event.date,
      endDate: event.date,
      latitude: 46.8762,
      longitude: -96.7898,
      city: "Fargo",
      imageUrl: event.imageUrl,
      categories: JSON.stringify(
        event.category
          ? [{ catName: event.category, catId: event.category }]
          : [],
      ),
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
