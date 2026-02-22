import { VENUE_RULES } from "../enrichment/venues"
import { FargoUndergroundEvent, StoredEvent } from "../types/event"
import {
  DEFAULT_BROWSER_HEADERS,
  fetchTribeEvents,
  fetchWithRetry,
} from "./shared"

type InferredVenue = {
  location: string
  city: string
  latitude: number
  longitude: number
}

type EnrichedFargoUndergroundEvent = FargoUndergroundEvent & {
  inferredVenue?: InferredVenue
}

export class FargoUndergroundFetcher {
  private readonly clientTimeZone = "America/Chicago"
  private readonly baseUrl =
    "https://fargounderground.com/wp-json/tribe/events/v1/events"

  private readonly paradoxVenue: InferredVenue | null = (() => {
    const rule = VENUE_RULES.find((r) => /paradox/i.test(r.location))
    if (!rule) {
      return null
    }

    return {
      location: rule.location,
      city: rule.city,
      latitude: rule.latitude,
      longitude: rule.longitude,
    }
  })()

  private readonly paradoxHtmlPattern: RegExp | null = (() => {
    const rule = VENUE_RULES.find((r) => /paradox/i.test(r.location))
    return rule?.htmlPattern ?? null
  })()

  async fetchEvents(
    perPage: number = 100,
    daysAhead: number = 14,
  ): Promise<EnrichedFargoUndergroundEvent[]> {
    try {
      const events = await fetchTribeEvents<FargoUndergroundEvent>({
        baseUrl: this.baseUrl,
        label: "Fargo Underground events fetch",
        timeZone: this.clientTimeZone,
        perPage,
        daysAhead,
        headers: DEFAULT_BROWSER_HEADERS,
      })

      const enriched = events as EnrichedFargoUndergroundEvent[]
      await this.enrichMissingVenues(enriched)
      return enriched
    } catch (error) {
      console.error("Error fetching Fargo Underground events:", error)
      throw error
    }
  }

  private async enrichMissingVenues(
    events: EnrichedFargoUndergroundEvent[],
  ): Promise<void> {
    if (!this.paradoxVenue) {
      return
    }

    const candidates = events.filter(
      (e) => (!e.venue || !e.venue.venue) && !!e.url,
    )
    if (candidates.length === 0) {
      return
    }

    await this.mapWithConcurrency(candidates, 4, async (event) => {
      const inferred = await this.inferVenueFromInfoAndTickets(event.url)
      if (inferred) {
        event.inferredVenue = inferred
      }
    })
  }

  private async inferVenueFromInfoAndTickets(
    eventUrl: string,
  ): Promise<InferredVenue | null> {
    if (!this.paradoxVenue) {
      return null
    }

    let eventHtml: string
    try {
      const response = await fetchWithRetry(
        eventUrl,
        { headers: DEFAULT_BROWSER_HEADERS },
        "Fargo Underground event page fetch",
      )
      eventHtml = await response.text()
    } catch {
      return null
    }

    // If the event page mentions the Paradox website domain, treat it as a
    // Paradox-hosted event. We use the specific domain rather than the word
    // "paradox" alone to avoid false positives from sidebar content, related
    // events, or other unrelated mentions on the page.
    if (this.paradoxHtmlPattern?.test(eventHtml)) {
      return this.paradoxVenue
    }

    const infoTicketsUrl = this.extractInfoAndTicketsUrl(eventHtml, eventUrl)
    if (!infoTicketsUrl) {
      return null
    }

    // Many Paradox-hosted events link directly to paradoxcnc.com.
    if (/paradox/i.test(infoTicketsUrl)) {
      return this.paradoxVenue
    }

    try {
      const response = await fetchWithRetry(
        infoTicketsUrl,
        { headers: DEFAULT_BROWSER_HEADERS },
        "Info & Tickets page fetch",
      )
      const infoHtml = await response.text()
      if (this.paradoxHtmlPattern?.test(infoHtml)) {
        return this.paradoxVenue
      }
    } catch {
      // Non-fatal; leave venue unknown.
    }

    return null
  }

  private extractInfoAndTicketsUrl(html: string, baseUrl: string): string | null {
    // Try to find the “INFO & TICKETS” link in the event details sidebar.
    // Handles either “&” or “&amp;” in HTML.
    const re =
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*INFO\s*(?:&|&amp;)\s*TICKETS\s*<\/a>/i
    const match = html.match(re)
    const href = match?.[1]?.trim()
    if (!href) {
      return null
    }

    try {
      return new URL(href, baseUrl).toString()
    } catch {
      return null
    }
  }

  private async mapWithConcurrency<T>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    const limit = Math.max(1, Math.floor(concurrency))
    for (let i = 0; i < items.length; i += limit) {
      const slice = items.slice(i, i + limit)
      await Promise.all(slice.map((item) => fn(item)))
    }
  }

  transformToStoredEvent(
    event: EnrichedFargoUndergroundEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    // Parse start time from start_date (format: "2026-02-13 09:00:00")
    const startTimeParts = event.start_date.split(" ")
    const startTime = startTimeParts.length > 1 ? startTimeParts[1] : null

    // Build location string from venue (or inferred venue when missing)
    let location: string | null = null
    let latitude: number | null = null
    let longitude: number | null = null
    let city: string | null = null

    const venueName = event.venue?.venue?.trim()
    const hasUsableVenueName = !!venueName

    if (hasUsableVenueName) {
      location = venueName

      const venueAddress = event.venue?.address?.trim()
      if (venueAddress) {
        location += `, ${venueAddress}`
      }

      latitude = Number.isFinite(event.venue?.geo_lat) ? event.venue!.geo_lat : null
      longitude =
        Number.isFinite(event.venue?.geo_lng) ? event.venue!.geo_lng : null
      city = event.venue?.city?.trim() || null
    } else if (event.inferredVenue) {
      location = event.inferredVenue.location
      latitude = event.inferredVenue.latitude
      longitude = event.inferredVenue.longitude
      city = event.inferredVenue.city
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
      latitude,
      longitude,
      city,
      imageUrl: event.image?.url || null,
      categories: JSON.stringify(categories),
      source: "fargounderground.com",
    }
  }
}
