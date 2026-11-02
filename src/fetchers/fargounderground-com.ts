import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { ICalEvent, parseICal } from "./ical"
import { fetchWithRetry, getDateRangeInTimeZone } from "./shared"

/** The Events Calendar's limit on one iCal export. */
const ICAL_FEED_CAP = 30

/** Enough to cross a 14-day window; a guard against a feed that never ends. */
const MAX_FEED_PAGES = 15

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export class FargoUndergroundFetcher {
  private readonly timeZone = "America/Chicago"
  // The WP REST API (/wp-json/tribe/events/v1/events) is behind Cloudflare Bot
  // Fight Mode, which blocks server-side HTTP requests with a JS challenge page.
  // The Tribe Events iCal export is not behind the same protection.
  private readonly feedUrl = "https://fargounderground.com/events/?ical=1"

  /**
   * The iCal export returns at most 30 events, which is only 2-3 days on this
   * calendar, and has no paging. `tribe-bar-date` moves its start date, so walk
   * forward from the last date each batch reached until the window is covered.
   * Each batch re-reads that last date, since the cap may have cut it short.
   */
  async fetchEvents(daysAhead = 14): Promise<ICalEvent[]> {
    try {
      const dateRange = getDateRangeInTimeZone(daysAhead, this.timeZone)
      const byUid = new Map<string, ICalEvent>()
      let cursor = dateRange.startDateStr
      let pages = 0

      while (pages < MAX_FEED_PAGES && cursor <= dateRange.endDateStr) {
        pages++
        // Cloudflare on fargounderground.com challenges browser-like UAs but
        // passes curl-like UAs through. Send no custom headers so undici's
        // default UA is used.
        const response = await fetchWithRetry(
          `${this.feedUrl}&tribe-bar-date=${cursor}`,
          {},
          "Fargo Underground iCal fetch",
        )
        const batch = parseICal(await response.text(), this.timeZone)
        for (const event of batch) byUid.set(event.uid, event)

        if (batch.length < ICAL_FEED_CAP) break
        const reached = batch.reduce(
          (latest, event) => (event.date > latest ? event.date : latest),
          cursor,
        )
        // One day holding a whole batch can't be walked past any other way.
        cursor = reached > cursor ? reached : nextDay(cursor)
      }

      const all = Array.from(byUid.values())
      // An all-day event that started earlier and is still running stays in:
      // the rebuild shows it as ongoing.
      const inWindow = all.filter(
        (e) => e.endDate >= dateRange.startDateStr && e.date <= dateRange.endDateStr,
      )
      console.log(
        `   Parsed ${all.length} VEVENTs from ${pages} pages, ${inWindow.length} in window`,
      )
      return inWindow
    } catch (error) {
      logError("Error fetching Fargo Underground events:", error)
      throw error
    }
  }

  transformToStoredEvent(
    event: ICalEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    // UID: "postId-unixStart-unixEnd@fargounderground.com" — first segment is
    // the WP post ID, same numeric value the old JSON API used for fu_<id>.
    const postId = event.uid.split("@")[0].split("-")[0]

    const categories = event.categoriesRaw.map((name, i) => ({
      catName: name,
      catId: String(i),
    }))

    return {
      eventId: `fu_${postId}`,
      title: event.title,
      url: event.eventUrl || `https://fargounderground.com/`,
      location: event.location,
      date: event.date,
      startTime: event.startTime,
      startDate: event.date,
      endDate: event.endDate,
      latitude: event.latitude,
      longitude: event.longitude,
      city: cityFromLocation(event.location),
      imageUrl: event.imageUrl,
      categories: JSON.stringify(categories),
      source: "fargounderground.com",
    }
  }
}

function cityFromLocation(location: string | null): string | null {
  if (!location) return null
  if (/\bMoorhead\b/i.test(location)) return "Moorhead"
  if (/\bWest Fargo\b/i.test(location)) return "West Fargo"
  if (/\bFargo\b/i.test(location)) return "Fargo"
  return null
}
