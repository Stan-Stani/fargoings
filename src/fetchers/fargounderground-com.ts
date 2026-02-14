import {
  FargoUndergroundAPIResponse,
  FargoUndergroundEvent,
  StoredEvent,
} from "../types/event"

export class FargoUndergroundFetcher {
  private readonly baseUrl =
    "https://fargounderground.com/wp-json/tribe/events/v1/events"

  async fetchEvents(
    perPage: number = 100,
    daysAhead: number = 14,
  ): Promise<FargoUndergroundEvent[]> {
    const startDate = new Date()
    startDate.setHours(0, 0, 0, 0)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + daysAhead)

    const startDateStr = startDate.toISOString().split("T")[0]
    const endDateStr = endDate.toISOString().split("T")[0]

    console.log(
      `   Date range: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`,
    )

    const allEvents: FargoUndergroundEvent[] = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const url = `${this.baseUrl}?per_page=${perPage}&page=${page}&start_date=${startDateStr}&end_date=${endDateStr}`

      try {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

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
