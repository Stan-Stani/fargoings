import { readFileSync } from "node:fs"
import { decodeHtmlEntities } from "../dedup/normalize"
import { logError } from "../log"
import { StoredEvent } from "../types/event"
import {
  DEFAULT_BROWSER_HEADERS,
  fetchWithRetry,
  getDateRangeInTimeZone,
} from "./shared"

export interface WestFargoLibraryEvent {
  uid: string
  title: string
  /** Local (America/Chicago) date, YYYY-MM-DD */
  date: string
  /** Local end date, YYYY-MM-DD */
  endDate: string
  /** Local wall-clock start, HH:MM:SS, or null for all-day entries */
  startTime: string | null
  location: string | null
}

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
      const parsed = this.parseICal(ical)

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

  /** Minimal RFC 5545 parser: just the VEVENT fields we consume. */
  private parseICal(raw: string): WestFargoLibraryEvent[] {
    const lines = this.unfold(raw)
    const events: WestFargoLibraryEvent[] = []

    let current: Record<string, { params: string; value: string }> | null = null

    for (const line of lines) {
      if (line === "BEGIN:VEVENT") {
        current = {}
        continue
      }
      if (line === "END:VEVENT") {
        if (current) {
          const event = this.toEvent(current)
          if (event) events.push(event)
        }
        current = null
        continue
      }
      if (!current) continue

      const colon = line.indexOf(":")
      if (colon === -1) continue
      const namePart = line.slice(0, colon)
      const value = line.slice(colon + 1)
      const semi = namePart.indexOf(";")
      const name = (semi === -1 ? namePart : namePart.slice(0, semi)).toUpperCase()
      const params = semi === -1 ? "" : namePart.slice(semi + 1)
      current[name] = { params, value }
    }

    return events
  }

  /** RFC 5545 line unfolding: a leading space/tab continues the prior line. */
  private unfold(raw: string): string[] {
    const physical = raw.split(/\r\n|\n|\r/)
    const logical: string[] = []
    for (const line of physical) {
      if ((line.startsWith(" ") || line.startsWith("\t")) && logical.length) {
        logical[logical.length - 1] += line.slice(1)
      } else {
        logical.push(line)
      }
    }
    return logical
  }

  private toEvent(
    fields: Record<string, { params: string; value: string }>,
  ): WestFargoLibraryEvent | null {
    const dtStart = fields["DTSTART"]
    const summary = fields["SUMMARY"]
    if (!dtStart || !summary) return null

    const start = this.parseDateTime(dtStart.params, dtStart.value)
    if (!start) return null

    const dtEnd = fields["DTEND"]
    const end = dtEnd ? this.parseDateTime(dtEnd.params, dtEnd.value) : null

    const uid = (fields["UID"]?.value || "").trim()
    const title = this.unescapeText(summary.value).trim()

    return {
      uid: uid || `${start.date}-${this.slug(title)}`,
      title,
      date: start.date,
      endDate: end?.date ?? start.date,
      startTime: start.time,
      location: this.cleanLocation(fields["LOCATION"]?.value),
    }
  }

  /**
   * Returns local wall-clock date/time. Feed values are either
   * `;VALUE=DATE:YYYYMMDD` (all-day) or `;TZID=America/Chicago:YYYYMMDDThhmmss`
   * (already local — kept as-is to avoid VPS timezone shifts). A trailing `Z`
   * (UTC) is converted to America/Chicago defensively.
   */
  private parseDateTime(
    params: string,
    value: string,
  ): { date: string; time: string | null } | null {
    const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (dateOnly || /VALUE=DATE\b/i.test(params)) {
      const m = dateOnly ?? value.match(/^(\d{4})(\d{2})(\d{2})/)
      if (!m) return null
      return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null }
    }

    const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
    if (!m) return null
    const [, y, mo, d, h, mi, s, z] = m

    if (z) {
      const utc = new Date(
        Date.UTC(+y, +mo - 1, +d, +h, +mi, +s),
      )
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: this.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).formatToParts(utc)
      const get = (t: string) =>
        parts.find((p) => p.type === t)?.value ?? "00"
      const hour = get("hour") === "24" ? "00" : get("hour")
      return {
        date: `${get("year")}-${get("month")}-${get("day")}`,
        time: `${hour}:${get("minute")}:${get("second")}`,
      }
    }

    return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}:${s}` }
  }

  private unescapeText(value: string): string {
    return value
      .replace(/\\n/gi, " ")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\")
  }

  private cleanLocation(value: string | undefined): string | null {
    if (!value) return null
    const text = decodeHtmlEntities(this.unescapeText(value))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s+-\s+/, ", ")
      .trim()
    return text.length ? text : null
  }

  private slug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
  }
}
