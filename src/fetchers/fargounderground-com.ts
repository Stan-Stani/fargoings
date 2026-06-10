import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { ICalEvent, parseICal } from "./ical"
import { fetchWithRetry, getDateRangeInTimeZone } from "./shared"

export class FargoUndergroundFetcher {
  private readonly timeZone = "America/Chicago"
  // The WP REST API (/wp-json/tribe/events/v1/events) is behind Cloudflare Bot
  // Fight Mode, which blocks server-side HTTP requests with a JS challenge page.
  // The Tribe Events iCal export is not behind the same protection.
  private readonly feedUrl = "https://fargounderground.com/events/?ical=1"

  async fetchEvents(daysAhead = 14): Promise<ICalEvent[]> {
    try {
      const dateRange = getDateRangeInTimeZone(daysAhead, this.timeZone)
      // Cloudflare on fargounderground.com challenges browser-like UAs but
      // passes curl-like UAs through. Send no custom headers so undici's
      // default UA is used.
      const response = await fetchWithRetry(
        this.feedUrl,
        {},
        "Fargo Underground iCal fetch",
      )
      const raw = await response.text()
      const all = parseICal(raw, this.timeZone)
      const inWindow = all.filter(
        (e) => e.date >= dateRange.startDateStr && e.date <= dateRange.endDateStr,
      )
      console.log(`   Parsed ${all.length} VEVENTs, ${inWindow.length} in window`)
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
