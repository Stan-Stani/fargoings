import { FargoUndergroundEvent, StoredEvent } from "../types/event"
import { DEFAULT_BROWSER_HEADERS, fetchTribeEvents } from "./shared"

/**
 * Drekker Brewing runs The Events Calendar (Tribe) on WordPress, exposing
 * the standard REST feed — same shape as westfargoevents.com, so this reuses
 * `fetchTribeEvents`. Drekker's taproom (Brewhalla, 1666 1st Ave N, Fargo)
 * hosts frequent events; the feed can legitimately be empty between seasons.
 */
export class DrekkerBrewingFetcher {
  private readonly clientTimeZone = "America/Chicago"
  private readonly baseUrl =
    "https://drekkerbrewing.com/wp-json/tribe/events/v1/events"

  async fetchEvents(
    perPage: number = 100,
    daysAhead: number = 14,
  ): Promise<FargoUndergroundEvent[]> {
    try {
      return await fetchTribeEvents<FargoUndergroundEvent>({
        baseUrl: this.baseUrl,
        label: "Drekker Brewing fetch",
        timeZone: this.clientTimeZone,
        perPage,
        daysAhead,
        headers: DEFAULT_BROWSER_HEADERS,
      })
    } catch (error) {
      console.error("Error fetching Drekker Brewing events:", error)
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
      eventId: `drk_${event.id}`,
      title: event.title,
      url: event.url,
      location,
      date: event.start_date.split(" ")[0],
      startTime,
      startDate: event.start_date.split(" ")[0],
      endDate: event.end_date.split(" ")[0],
      latitude: event.venue?.geo_lat || null,
      longitude: event.venue?.geo_lng || null,
      city: event.venue?.city || "Fargo",
      imageUrl: event.image?.url || null,
      categories: JSON.stringify(categories),
      source: "drekkerbrewing.com",
    }
  }
}
