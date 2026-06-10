import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { ICalEvent, parseICal } from "./ical"
import {
  DEFAULT_BROWSER_HEADERS,
  fetchWithRetry,
  formatYmd,
  addDaysToYmd,
  getDatePartsInTimeZone,
} from "./shared"

export type GoCobbersEvent = ICalEvent

/**
 * Concordia College (Moorhead) athletics runs PrestoSports at gocobbers.com
 * — the old cobbers.com is a dead WordPress install (HTTP 500 on every
 * request, verified 2026-06-10), and the site is NOT Sidearm. The composite
 * iCal export carries the full schedule history back to 2005, so a forward
 * date window is mandatory. ~150 days covers a full season ahead; volume is
 * fine because sports sources sit behind the "Show sports" toggle.
 */
export class GoCobbersFetcher {
  private readonly timeZone = "America/Chicago"
  private readonly feedUrl = "https://gocobbers.com/composite?print=ical"
  private readonly scheduleUrl = "https://gocobbers.com/composite"

  async fetchEvents(daysAhead: number = 150): Promise<GoCobbersEvent[]> {
    try {
      const start = getDatePartsInTimeZone(new Date(), this.timeZone)
      const startStr = formatYmd(start)
      const endStr = formatYmd(addDaysToYmd(start, daysAhead))
      console.log(`   Date range (${this.timeZone}): ${startStr} to ${endStr}`)

      const response = await fetchWithRetry(
        this.feedUrl,
        { headers: { ...DEFAULT_BROWSER_HEADERS, Accept: "text/calendar, */*", Referer: "https://gocobbers.com/composite", Origin: "https://gocobbers.com" } },
        "Concordia athletics fetch",
        4,
      )
      const ical = await response.text()
      const parsed = parseICal(ical, this.timeZone)

      const events = parsed.filter(
        (e) => e.date >= startStr && e.date <= endStr,
      )

      console.log(
        `   Parsed ${parsed.length} VEVENTs, ${events.length} in the forward window`,
      )
      return events
    } catch (error) {
      logError("Error fetching Concordia athletics events:", error)
      throw error
    }
  }

  transformToStoredEvent(
    event: GoCobbersEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    // SUMMARY format: "(Women's Soccer) University of Mary vs. Concordia-M'head"
    // → "Women's Soccer: University of Mary vs. Concordia-M'head"
    const title = event.title
      .replace(/^\(([^)]+)\)\s*/, "$1: ")
      .replace(/\s{2,}/g, " ")
      .trim()

    return {
      eventId: `cobb_${event.uid.split("@")[0]}_${event.date}`,
      title,
      url: this.scheduleUrl,
      location: event.location,
      date: event.date,
      startTime: event.startTime,
      startDate: event.date,
      endDate: event.endDate,
      latitude: null,
      longitude: null,
      city: "Moorhead",
      imageUrl: null,
      categories: JSON.stringify([{ catName: "Sports", catId: "sports" }]),
      source: "gocobbers.com",
    }
  }
}
