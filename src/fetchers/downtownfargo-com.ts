import { StoredEvent } from "../types/event"
import {
  DEFAULT_BROWSER_HEADERS,
  fetchWithRetry,
  getDateRangeInTimeZone,
} from "./shared"

interface DowntownFargoEvent {
  className: string | null
  title: string
  start: string
  end: string
  allDay: boolean
  url: string
}

interface DowntownFargoEventWithDetails extends DowntownFargoEvent {
  location?: string
}

export class DowntownFargoFetcher {
  private readonly clientTimeZone = "America/Chicago"
  private readonly feedUrl = "https://www.downtownfargo.com/events/feed"
  private readonly baseUrl = "https://www.downtownfargo.com"

  async fetchEvents(
    daysAhead: number = 14,
  ): Promise<DowntownFargoEventWithDetails[]> {
    const dateRange = getDateRangeInTimeZone(daysAhead, this.clientTimeZone)

    console.log(
      `   Date range (${this.clientTimeZone}): ${dateRange.start.month}/${dateRange.start.day}/${dateRange.start.year} to ${dateRange.end.month}/${dateRange.end.day}/${dateRange.end.year}`,
    )

    const body = new URLSearchParams({
      searchText: "",
      category: "",
      start: dateRange.startDateStr,
      end: dateRange.endDateStr,
    })

    try {
      const response = await fetchWithRetry(
        this.feedUrl,
        {
          method: "POST",
          headers: {
            ...DEFAULT_BROWSER_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
            Accept: "application/json",
          },
          body: body.toString(),
        },
        "Downtown Fargo events fetch",
      )

      const events = (await response.json()) as DowntownFargoEvent[]

      console.log(`   Found ${events.length} events`)

      const eventsWithDetails: DowntownFargoEventWithDetails[] = []

      if (events.length > 0) {
        console.log(
          `   Fetching location details for ${events.length} events...`,
        )
      }
      for (const event of events) {
        const location = await this.fetchEventLocation(event.url)
        eventsWithDetails.push({ ...event, location })
      }

      return eventsWithDetails
    } catch (error) {
      console.error("Error fetching Downtown Fargo events:", error)
      throw error
    }
  }

  private async fetchEventLocation(
    eventPath: string,
  ): Promise<string | undefined> {
    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}${eventPath}`,
        {
          headers: DEFAULT_BROWSER_HEADERS,
        },
        "Downtown Fargo event details fetch",
        2,
      )
      if (!response.ok) return undefined

      const html = await response.text()

      // Look for venue name and address in the page
      // Pattern: Venue name followed by Google Maps link with address
      const venueMatch = html.match(
        /o-details-block__details-copy[^>]*>\s*([^<]+)</,
      )
      const addressMatch = html.match(/maps\.google\.com\/\?q=\(([^)]+)\)/)

      if (addressMatch) {
        // Extract from Google Maps link: "(Venue Name Address City, ST ZIP)"
        return addressMatch[1].replace(/\s+/g, " ").trim()
      }

      if (venueMatch) {
        return venueMatch[1].trim()
      }

      return undefined
    } catch {
      return undefined
    }
  }

  transformToStoredEvent(
    event: DowntownFargoEventWithDetails,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    // Parse start datetime (format: "2026-02-14T10:00:00-06:00")
    const startDateTime = new Date(event.start)
    const date = `${startDateTime.getFullYear()}-${String(startDateTime.getMonth() + 1).padStart(2, "0")}-${String(startDateTime.getDate()).padStart(2, "0")}`

    // Extract time as HH:MM:SS
    const hours = String(startDateTime.getHours()).padStart(2, "0")
    const minutes = String(startDateTime.getMinutes()).padStart(2, "0")
    const startTime = `${hours}:${minutes}:00`

    // Parse end date
    const endDateTime = new Date(event.end)
    const endDate = `${endDateTime.getFullYear()}-${String(endDateTime.getMonth() + 1).padStart(2, "0")}-${String(endDateTime.getDate()).padStart(2, "0")}`

    return {
      eventId: `dtf_${event.url.replace("/events/", "")}`,
      title: event.title,
      url: `https://www.downtownfargo.com${event.url}`,
      location: event.location || null,
      date,
      startTime: event.allDay ? null : startTime,
      startDate: date,
      endDate,
      latitude: null,
      longitude: null,
      city: "Fargo",
      imageUrl: null,
      categories: JSON.stringify([]),
      source: "downtownfargo.com",
    }
  }
}
