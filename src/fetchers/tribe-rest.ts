import { FargoUndergroundEvent, StoredEvent } from "../types/event"
import { DEFAULT_BROWSER_HEADERS, fetchTribeEvents } from "./shared"

export interface TribeRestConfig {
  /** Full REST base, e.g. "https://www.dtsf.com/wp-json/tribe/events/v1/events" */
  apiBase: string
  /** Source id stored on events, e.g. "dtsf.com" */
  sourceId: string
  /** eventId prefix, e.g. "dtsf" → "dtsf_12345" */
  eventIdPrefix: string
  /** Log label, e.g. "DTSF fetch" */
  label: string
  /** Fallback city when the venue record carries none */
  defaultCity: string | null
  /** IANA timezone of the venue (default America/Chicago) */
  timeZone?: string
  daysAhead?: number
  /**
   * Env var holding a relay URL that replaces apiBase (for sites whose WAF
   * blocks our IPs — see infra/*-feed-worker). Read at fetch time so dotenv
   * has loaded.
   */
  envUrlOverride?: string
}

/**
 * Generic fetcher for any WordPress site running The Events Calendar (Tribe)
 * with the standard public REST feed — the same shape drekkerbrewing.com and
 * aquariumfargo.com use, but config-driven so a new Tribe site is one config
 * object instead of a new class. Venue city/coords come free in the JSON.
 */
export class TribeRestFetcher {
  constructor(private readonly config: TribeRestConfig) {}

  async fetchEvents(): Promise<FargoUndergroundEvent[]> {
    const relay = this.config.envUrlOverride
      ? process.env[this.config.envUrlOverride]
      : undefined
    if (relay) {
      console.log(`   Fetching via relay: ${relay.split("?")[0]}`)
    }
    try {
      return await fetchTribeEvents<FargoUndergroundEvent>({
        baseUrl: relay || this.config.apiBase,
        label: this.config.label,
        timeZone: this.config.timeZone ?? "America/Chicago",
        perPage: 100,
        daysAhead: this.config.daysAhead ?? 14,
        headers: DEFAULT_BROWSER_HEADERS,
      })
    } catch (error) {
      console.error(`Error in ${this.config.label}:`, error)
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
      eventId: `${this.config.eventIdPrefix}_${event.id}`,
      title: event.title,
      url: event.url,
      location,
      date: event.start_date.split(" ")[0],
      startTime,
      startDate: event.start_date.split(" ")[0],
      endDate: event.end_date.split(" ")[0],
      latitude: event.venue?.geo_lat || null,
      longitude: event.venue?.geo_lng || null,
      city: event.venue?.city || this.config.defaultCity,
      imageUrl: event.image?.url || null,
      categories: JSON.stringify(categories),
      source: this.config.sourceId,
    }
  }
}
