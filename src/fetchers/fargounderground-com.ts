import {
  FargoUndergroundAPIResponse,
  FargoUndergroundEvent,
  StoredEvent,
} from "../types/event"
import {
  DEFAULT_BROWSER_HEADERS,
  fetchWithRetry,
  getDateRangeInTimeZone,
} from "./shared"

export class FargoUndergroundFetcher {
  private readonly clientTimeZone = "America/Chicago"
  private readonly baseUrl =
    "https://fargounderground.com/wp-json/tribe/events/v1/events"

  async fetchEvents(
    perPage: number = 100,
    daysAhead: number = 14,
  ): Promise<FargoUndergroundEvent[]> {
    const dateRange = getDateRangeInTimeZone(daysAhead, this.clientTimeZone)

    console.log(
      `   Date range (${this.clientTimeZone}): ${dateRange.start.month}/${dateRange.start.day}/${dateRange.start.year} to ${dateRange.end.month}/${dateRange.end.day}/${dateRange.end.year}`,
    )

    const allEvents: FargoUndergroundEvent[] = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const url = `${this.baseUrl}?per_page=${perPage}&page=${page}&start_date=${dateRange.startDateStr}&end_date=${dateRange.endDateStr}`

      try {
        const response = await fetchWithRetry(
          url,
          { headers: DEFAULT_BROWSER_HEADERS },
          `Fargo Underground events fetch (page ${page})`,
        )

        const data = (await response.json()) as FargoUndergroundAPIResponse
        allEvents.push(...data.events)

        console.log(
          `   Fetched page ${page}/${data.total_pages} (${data.events.length} events)`,
        )

        hasMore = page < data.total_pages
        page++
      } catch (error) {
        console.error("Error fetching Fargo Underground events:", error)
        throw error
      }
    }

    return allEvents
  }

  transformToStoredEvent(
    event: FargoUndergroundEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    // Parse start time from start_date (format: "2026-02-13 09:00:00")
    const startTimeParts = event.start_date.split(" ")
    const startTime = startTimeParts.length > 1 ? startTimeParts[1] : null

    // Build location string from venue
    let location: string | null = null
    if (event.venue) {
      location = event.venue.venue
      if (event.venue.address) {
        location += `, ${event.venue.address}`
      }
    }

    // Transform categories to match our format
    const categories = event.categories.map((cat) => ({
      catName: cat.name,
      catId: cat.id.toString(),
    }))

    return {
      eventId: `fu_${event.id}`, // Prefix to avoid ID collisions
      title: event.title,
      url: event.url,
      location,
      date: event.start_date.split(" ")[0], // Just the date part
      startTime,
      startDate: event.start_date.split(" ")[0],
      endDate: event.end_date.split(" ")[0],
      latitude: event.venue?.geo_lat || null,
      longitude: event.venue?.geo_lng || null,
      city: event.venue?.city || null,
      imageUrl: event.image?.url || null,
      categories: JSON.stringify(categories),
      source: "fargounderground.com",
    }
  }
}
