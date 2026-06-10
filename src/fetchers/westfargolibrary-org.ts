import { readFileSync } from "node:fs"
import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { ICalEvent, parseICal } from "./ical"
import {
  DEFAULT_BROWSER_HEADERS,
  fetchWithRetry,
  getDateRangeInTimeZone,
} from "./shared"

export type WestFargoLibraryEvent = ICalEvent

/**
 * West Fargo Public Library is its own venue and is NOT covered by the
 * westfargoevents.com aggregator (verified 2026-05-15). The library's calendar
 * lives on the City of West Fargo CivicPlus site; `catID=25` is the
 * "West Fargo Library" calendar category, so the iCal export is already
 * scoped to library-hosted programming. The RSS feed is capped at 10 items,
 * so we use the iCal export, which returns the full forward range.
 *
 * West Fargo's web server (207.38.72.44, shared with westfargond.gov)
 * firewalls the production VPS's DigitalOcean IP, so it cannot reach the
 * feed directly. Two overrides handle this (file wins if both are set):
 *   - `WFPL_ICS_FILE=/path/to/feed.ics` — parse a local copy instead of
 *     fetching (fetch off-VPS, transfer the .ics, point this at it).
 *   - `WFPL_ICS_URL=https://…` — fetch from an alternate URL instead of the
 *     origin. Production uses a Cloudflare Worker relay (Cloudflare egress
 *     is not blocked) so the weekly cron `npm start` works unattended.
 *     See infra/wfpl-feed-worker/README.md.
 */
export class WestFargoLibraryFetcher {
  private readonly timeZone = "America/Chicago"
  private readonly feedUrl =
    "https://www.westfargolibrary.org/common/modules/iCalendar/iCalendar.aspx?catID=25&feed=calendar"
  private readonly eventDetailBase =
    "https://www.westfargolibrary.org/Calendar.aspx?EID="

  async fetchEvents(daysAhead: number = 14): Promise<WestFargoLibraryEvent[]> {
    try {
      const dateRange = getDateRangeInTimeZone(daysAhead, this.timeZone)

      console.log(
        `   Date range (${this.timeZone}): ${dateRange.start.month}/${dateRange.start.day}/${dateRange.start.year} to ${dateRange.end.month}/${dateRange.end.day}/${dateRange.end.year}`,
      )

      const icsFile = process.env.WFPL_ICS_FILE
      const icsUrl = process.env.WFPL_ICS_URL
      let ical: string
      if (icsFile) {
        console.log(`   Reading iCal from local file: ${icsFile}`)
        ical = readFileSync(icsFile, "utf8")
      } else {
        const url = icsUrl || this.feedUrl
        if (icsUrl) {
          console.log(`   Fetching iCal via relay: ${icsUrl.split("?")[0]}`)
        }
        const response = await fetchWithRetry(
          url,
          { headers: DEFAULT_BROWSER_HEADERS },
          "West Fargo Library events fetch",
          4,
        )
        ical = await response.text()
      }
      const parsed = parseICal(ical, this.timeZone)

      // The feed expands recurring events far into the future; keep only the
      // window we care about (inclusive, lexicographic works on YYYY-MM-DD).
      const inWindow = parsed.filter(
        (e) =>
          e.date >= dateRange.startDateStr && e.date <= dateRange.endDateStr,
      )

      // Closure notices ("LIBRARY CLOSED - Christmas Day", "LIBRARY CLOSING
      // EARLY ...") are all-day calendar markers, not attendable events.
      const events = inWindow.filter(
        (e) => !/^LIBRARY (CLOSED|CLOSING|OPEN)\b/i.test(e.title.trim()),
      )

      console.log(
        `   Parsed ${parsed.length} VEVENTs, ${inWindow.length} in window, ${events.length} after dropping closure notices`,
      )

      return events
    } catch (error) {
      logError("Error fetching West Fargo Library events:", error)
      throw error
    }
  }

  transformToStoredEvent(
    event: WestFargoLibraryEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    return {
      // Recurring entries reuse one UID across dates, so the date is part of
      // the key — otherwise the upsert collapses every occurrence into one row.
      eventId: `wfpl_${event.uid}_${event.date}`,
      title: event.title,
      url: `${this.eventDetailBase}${event.uid}`,
      location: event.location,
      date: event.date,
      startTime: event.startTime,
      startDate: event.date,
      endDate: event.endDate,
      latitude: null,
      longitude: null,
      city: "West Fargo",
      imageUrl: null,
      categories: JSON.stringify([]),
      source: "westfargolibrary.org",
    }
  }
}
