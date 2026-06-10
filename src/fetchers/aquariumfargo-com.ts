import { FargoUndergroundEvent, StoredEvent } from "../types/event"
import { DEFAULT_BROWSER_HEADERS, fetchTribeEvents } from "./shared"

// The default headers carry fargomoorhead.org Referer/Origin; the Aquarium's
// WAF is touchy (it already 403s the www. host), so send same-site values.
const AQUARIUM_HEADERS: Record<string, string> = {
  ...DEFAULT_BROWSER_HEADERS,
  Referer: "https://aquariumfargo.com/events/",
}
delete AQUARIUM_HEADERS.Origin

/**
 * The Aquarium (downtown music venue, 226 Broadway N) runs The Events
 * Calendar PRO on WordPress — same Tribe REST shape as Drekker. Use the apex
 * domain: `www.aquariumfargo.com` is 403'd by a WAF regardless of UA
 * (verified 2026-06-10), the apex responds normally to a browser UA.
 */
export class AquariumFargoFetcher {
  private readonly clientTimeZone = "America/Chicago"
  private readonly baseUrl =
    "https://aquariumfargo.com/wp-json/tribe/events/v1/events"

  async fetchEvents(
    perPage: number = 100,
    daysAhead: number = 14,
  ): Promise<FargoUndergroundEvent[]> {
    try {
      return await fetchTribeEvents<FargoUndergroundEvent>({
        baseUrl: this.baseUrl,
        label: "The Aquarium fetch",
        timeZone: this.clientTimeZone,
        perPage,
        daysAhead,
        headers: AQUARIUM_HEADERS,
      })
    } catch (error) {
      console.error("Error fetching The Aquarium events:", error)
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
      eventId: `aqua_${event.id}`,
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
      source: "aquariumfargo.com",
    }
  }
}
