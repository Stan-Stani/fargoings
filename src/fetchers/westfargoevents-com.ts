import { FargoUndergroundEvent, StoredEvent } from "../types/event"
import { DEFAULT_BROWSER_HEADERS, fetchTribeEvents } from "./shared"

export class WestFargoEventsFetcher {
  private readonly clientTimeZone = "America/Chicago"
  private readonly baseUrl =
    "https://westfargoevents.com/wp-json/tribe/events/v1/events"

  async fetchEvents(
    perPage: number = 100,
    daysAhead: number = 14,
  ): Promise<FargoUndergroundEvent[]> {
    try {
      return await fetchTribeEvents<FargoUndergroundEvent>({
        baseUrl: this.baseUrl,
        label: "West Fargo Events fetch",
        timeZone: this.clientTimeZone,
        perPage,
        daysAhead,
        headers: DEFAULT_BROWSER_HEADERS,
      })
    } catch (error) {
      console.error("Error fetching West Fargo Events:", error)
      throw error
    }
  }

  transformToStoredEvent(
    event: FargoUndergroundEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    const startTimeParts = event.start_date.split(" ")
    const startTime = startTimeParts.length > 1 ? startTimeParts[1] : null

    let location: string | null = null
    if (event.venue) {
      location = event.venue.venue
      if (event.venue.address) {
        location += `, ${event.venue.address}`
      }
    }

    const categories = event.categories.map((cat) => ({
      catName: cat.name,
      catId: cat.id.toString(),
    }))

    return {
      eventId: `wfe_${event.id}`,
      title: event.title,
      url: event.url,
      location,
      date: event.start_date.split(" ")[0],
      startTime,
      startDate: event.start_date.split(" ")[0],
      endDate: event.end_date.split(" ")[0],
      latitude: event.venue?.geo_lat || null,
      longitude: event.venue?.geo_lng || null,
      city: event.venue?.city || null,
      imageUrl: event.image?.url || null,
      categories: JSON.stringify(categories),
      source: "westfargoevents.com",
    }
  }
}
