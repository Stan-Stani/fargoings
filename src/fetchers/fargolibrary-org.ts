import { StoredEvent } from "../types/event"
import { DEFAULT_BROWSER_HEADERS, getDateRangeInTimeZone } from "./shared"

interface FargoLibraryEvent {
  _id: string
  sIndex: number
  title: string
  datetime: string // ISO 8601 UTC, e.g. "2026-02-19T16:00:00.000Z"
  displaytimeframestart: string // "10:00 am"
  location: string | null
  locationaddress: string | null
  tags: string[]
  isCancelled: boolean
}

export class FargoLibraryFetcher {
  private readonly baseUrl = "https://fargond.gov/programdata"
  private readonly eventDetailBase =
    "https://fargond.gov/city-government/departments/library/calendar-of-events/event-detail"
  private readonly timeZone = "America/Chicago"

  async fetchEvents(daysAhead: number = 14): Promise<FargoLibraryEvent[]> {
    const dateRange = getDateRangeInTimeZone(daysAhead, this.timeZone)

    console.log(
      `   Date range (${this.timeZone}): ${dateRange.start.month}/${dateRange.start.day}/${dateRange.start.year} to ${dateRange.end.month}/${dateRange.end.day}/${dateRange.end.year}`,
    )

    const allEvents: FargoLibraryEvent[] = []
    let page = 1
    const pageSize = 100

    while (true) {
      const url = `${this.baseUrl}?api=lem&datefrom=${dateRange.startDateStr}&dateto=${dateRange.endDateStr}&page=${page}&pageSize=${pageSize}`

      const response = await fetch(url, { headers: DEFAULT_BROWSER_HEADERS })
      if (!response.ok) {
        throw new Error(
          `Fargo Library events fetch failed: HTTP ${response.status}`,
        )
      }

      const events = (await response.json()) as FargoLibraryEvent[]
      if (!Array.isArray(events) || events.length === 0) break

      const active = events.filter((e) => !e.isCancelled)
      allEvents.push(...active)

      console.log(
        `   Fetched page ${page} (${events.length} events, ${active.length} active)`,
      )

      if (events.length < pageSize) break
      page++
    }

    return allEvents
  }

  transformToStoredEvent(
    event: FargoLibraryEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    // Convert UTC datetime to local date string (YYYY-MM-DD)
    const dt = new Date(event.datetime)
    const localDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: this.timeZone,
    }).format(dt)

    const startTime = this.parseDisplayTime(event.displaytimeframestart)

    // Build location: venue name + address
    let location: string | null = null
    if (event.location) {
      location = event.location
      if (event.locationaddress) {
        location += `, ${event.locationaddress}`
      }
    } else if (event.locationaddress) {
      location = event.locationaddress
    }

    const categories = event.tags.map((tag) => ({ catName: tag, catId: tag }))

    const url = `${this.eventDetailBase}?id=${event._id}&index=${event.sIndex}`

    return {
      eventId: `fpl_${event._id}`,
      title: event.title,
      url,
      location,
      date: localDateStr,
      startTime,
      startDate: localDateStr,
      endDate: localDateStr,
      latitude: null,
      longitude: null,
      city: "Fargo",
      imageUrl: null,
      categories: JSON.stringify(categories),
      source: "fargolibrary.org",
    }
  }

  private parseDisplayTime(timeStr: string | null): string | null {
    if (!timeStr) return null
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i)
    if (!match) return null
    let hours = Number(match[1])
    const minutes = Number(match[2])
    const period = match[3].toLowerCase()
    hours = period === "am" ? hours % 12 : (hours % 12) + 12
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`
  }
}
