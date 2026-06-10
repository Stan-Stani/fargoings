import { decodeHtmlEntities } from "../dedup/normalize"
import { logError } from "../log"
import { StoredEvent } from "../types/event"
import {
  DEFAULT_BROWSER_HEADERS,
  fetchWithRetry,
  getDateRangeInTimeZone,
} from "./shared"

export interface EsfEvent {
  title: string
  url: string
  /** YYYY-MM-DD, from the listing's date group header */
  date: string
  location: string | null
  /** HH:MM:SS or null when the card shows no parseable start time */
  startTime: string | null
  imageUrl: string | null
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

/**
 * Experience Sioux Falls (the CVB) runs Craft CMS; its /events listing is a
 * server-rendered Sprig component: 20 `.event-item` cards per `?page=N`,
 * grouped chronologically under `<h2>June 11, 2026</h2>` date headers. There
 * is no JSON/iCal feed (the rest_v2/wp-json probes 404), so this walks the
 * paginated HTML in document order, carrying the current date header, and
 * stops once headers pass the fetch window. Cards carry title, venue name,
 * start–end time and the event URL — no coordinates or street address.
 */
export class ExperienceSiouxFallsFetcher {
  private readonly timeZone = "America/Chicago"
  private readonly listingUrl = "https://www.experiencesiouxfalls.com/events"
  /** Safety valve — the window cutoff is the real terminator. */
  private readonly maxPages = 30

  async fetchEvents(daysAhead: number = 14): Promise<EsfEvent[]> {
    try {
      const dateRange = getDateRangeInTimeZone(daysAhead, this.timeZone)
      console.log(
        `   Date range (${this.timeZone}): ${dateRange.startDateStr} to ${dateRange.endDateStr}`,
      )

      const events: EsfEvent[] = []
      const seen = new Set<string>()
      let currentDate: string | null = null
      let pastWindow = false

      // Craft's static cache can serve a weeks-old copy of the listing
      // (observed: page 1 with date headers 15 days in the past); a unique
      // query param forces a fresh render.
      const cacheBuster = Date.now()

      for (let page = 1; page <= this.maxPages && !pastWindow; page++) {
        const countBeforePage = events.length
        const url = `${this.listingUrl}?page=${page}&cb=${cacheBuster}`
        const response = await fetchWithRetry(
          url,
          {
            headers: {
              ...DEFAULT_BROWSER_HEADERS,
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              Referer: `${this.listingUrl}/`,
              Origin: "https://www.experiencesiouxfalls.com",
            },
          },
          `Experience Sioux Falls fetch (page ${page})`,
          4,
        )
        const html = await response.text()

        let cardsOnPage = 0
        // Walk h2 headers and event cards in document order so each card
        // inherits the closest preceding date header (headers don't repeat
        // across page boundaries, hence currentDate persists between pages).
        const tokens = html.split(/(?=<h2[^>]*>)|(?=<div class="event-item">)/)
        for (const token of tokens) {
          if (token.startsWith("<h2")) {
            const heading = token.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)
            const parsed = heading ? this.parseLongDate(heading[1]) : null
            if (parsed) {
              currentDate = parsed
              if (parsed > dateRange.endDateStr) {
                pastWindow = true
                break
              }
            }
            continue
          }
          if (!token.startsWith('<div class="event-item">')) continue
          cardsOnPage++
          if (!currentDate || currentDate < dateRange.startDateStr) continue

          const link = token.match(
            /<a href="(https:\/\/www\.experiencesiouxfalls\.com\/events\/[^"?]+)" class="callout-link">/,
          )
          const title = token.match(/<h3>([\s\S]*?)<\/h3>/)
          if (!link || !title) continue

          const key = `${link[1]}|${currentDate}`
          if (seen.has(key)) continue
          seen.add(key)

          events.push({
            title: decodeHtmlEntities(title[1])
              .replace(/<[^>]+>/g, " ")
              .replace(/\s{2,}/g, " ")
              .trim(),
            url: link[1],
            date: currentDate,
            location: this.parseLocation(token),
            startTime: this.parseStartTime(token),
            imageUrl: token.match(/<img [^>]*src="(https:\/\/[^"]+)"/)?.[1] ?? null,
          })
        }

        const newOnPage = events.length - countBeforePage
        console.log(`   Page ${page}: ${cardsOnPage} cards, ${newOnPage} new`)
        if (cardsOnPage === 0) break
        // Past the last real page Craft re-serves the final page's cards;
        // the seen-set makes that contribute 0 new events — stop there. Only
        // applies once headers reach the window (a stale-cache page opening
        // with past dates must not terminate the walk).
        if (
          newOnPage === 0 &&
          currentDate !== null &&
          currentDate >= dateRange.startDateStr
        ) {
          break
        }
      }

      console.log(`   Parsed ${events.length} Experience Sioux Falls events`)
      return events
    } catch (error) {
      logError("Error fetching Experience Sioux Falls events:", error)
      throw error
    }
  }

  transformToStoredEvent(
    event: EsfEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    const slug = event.url.split("/").filter(Boolean).pop() ?? "event"
    return {
      eventId: `esf_${slug}_${event.date}`,
      title: event.title,
      url: event.url,
      location: event.location,
      date: event.date,
      startTime: event.startTime,
      startDate: event.date,
      endDate: event.date,
      latitude: null,
      longitude: null,
      city: "Sioux Falls",
      imageUrl: event.imageUrl,
      categories: JSON.stringify([]),
      source: "experiencesiouxfalls.com",
    }
  }

  /** "June 11, 2026" → "2026-06-11" */
  private parseLongDate(text: string): string | null {
    const m = text.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i,
    )
    if (!m) return null
    const month = MONTHS[m[1].toLowerCase()]
    if (!month) return null
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`
  }

  /** Venue name from the location-pin <dd> (no street address on cards). */
  private parseLocation(card: string): string | null {
    const m = card.match(
      /location-pin\.svg[\s\S]*?<\/dt>\s*<dd>([\s\S]*?)<\/dd>/,
    )
    if (!m) return null
    const text = decodeHtmlEntities(m[1])
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
    return text || null
  }

  /** First "12:30 PM"-style time in the calendar <dd> → "12:30:00". */
  private parseStartTime(card: string): string | null {
    const m = card.match(
      /calendar\.svg[\s\S]*?<\/dt>\s*<dd>[\s\S]*?(\d{1,2}):(\d{2})\s*(AM|PM)/i,
    )
    if (!m) return null
    let hour = Number(m[1]) % 12
    if (m[3].toUpperCase() === "PM") hour += 12
    return `${String(hour).padStart(2, "0")}:${m[2]}:00`
  }
}
