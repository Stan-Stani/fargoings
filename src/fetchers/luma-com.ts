import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { fetchWithRetry, utcInstantToLocal } from "./shared"

/**
 * Luma (luma.com, API still at api.lu.ma) hosts organizer calendars whose
 * public pages are backed by two unauthenticated JSON endpoints:
 *
 *   GET /url?url=<slug>                    -> resolves a page slug; for a
 *                                             calendar page, data.calendar
 *                                             carries the api_id
 *   GET /calendar/get-items
 *       ?calendar_api_id=<cal-...>
 *       &period=future                     -> all announced future events,
 *                                             cursor-paginated
 *
 * Slugs are resolved at fetch time (one extra request per calendar) so the
 * config stays human-readable and survives Luma reissuing calendar ids.
 * Events carry their own IANA timezone plus UTC instants; wall-clock date and
 * time are derived per event.
 */
const API_BASE = "https://api.lu.ma"

const HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}

export interface LumaCalendarConfig {
  /** Calendar page slug, e.g. "tempo.fargo" (luma.com/tempo.fargo). */
  slug: string
  /** Category applied to this calendar's events, e.g. "Nightlife". */
  category: string
}

export interface LumaFetcherOptions {
  sourceId: string
  calendars: LumaCalendarConfig[]
  /** Fallback when an event is missing its own timezone. */
  timeZone: string
}

interface LumaGeoAddressInfo {
  city?: string | null
  /** "The Bomb Shelter, 325 10th St N, Fargo, ND 58102, USA" */
  full_address?: string | null
  /** Venue name as entered by the organizer, e.g. "The Bomb Shelter". */
  address?: string | null
  city_state?: string | null
}

interface LumaEvent {
  api_id: string
  name: string
  /** Event page slug: luma.com/<url> */
  url?: string | null
  start_at: string
  end_at?: string | null
  timezone?: string | null
  cover_url?: string | null
  location_type?: string | null
  geo_address_info?: LumaGeoAddressInfo | null
  coordinate?: { latitude: number; longitude: number } | null
}

interface LumaCalendarItemsResponse {
  entries: Array<{ api_id: string; event?: LumaEvent }>
  has_more: boolean
}

/** "Venue, street, city, state zip, USA" -> drop the country suffix. */
function formatLocation(geo: LumaGeoAddressInfo | null | undefined): string | null {
  if (!geo) return null
  const full = geo.full_address?.replace(/,\s*(USA|United States)$/i, "")
  if (full) return full
  // Obfuscated/hidden addresses still expose the venue name and city.
  const parts = [geo.address, geo.city_state ?? geo.city].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : null
}

export class LumaFetcher {
  constructor(private readonly options: LumaFetcherOptions) {}

  /** Resolve a calendar page slug to its cal-... api id. */
  private async resolveCalendarId(slug: string): Promise<string> {
    const url = `${API_BASE}/url?url=${encodeURIComponent(slug)}`
    const response = await fetchWithRetry(
      url,
      { headers: HEADERS },
      `Luma slug ${slug}`,
    )
    const body = (await response.json()) as {
      kind?: string
      data?: { calendar?: { api_id?: string } }
    }
    const calendarId = body.data?.calendar?.api_id
    if (body.kind !== "calendar" || !calendarId) {
      throw new Error(
        `Luma slug ${slug} did not resolve to a calendar (kind: ${body.kind})`,
      )
    }
    return calendarId
  }

  private async fetchCalendarEvents(calendarId: string): Promise<LumaEvent[]> {
    const events: LumaEvent[] = []
    let cursor: string | null = null

    // Cursor pagination; the cap only guards against a cursor the API
    // ignores (each page is 100 events, so real calendars fit in a page or
    // two).
    for (let page = 1; page <= 20; page++) {
      const params = new URLSearchParams({
        calendar_api_id: calendarId,
        period: "future",
        pagination_limit: "100",
      })
      if (cursor) params.set("pagination_cursor", cursor)

      const response = await fetchWithRetry(
        `${API_BASE}/calendar/get-items?${params}`,
        { headers: HEADERS },
        `Luma calendar ${calendarId} (page ${page})`,
      )
      const body = (await response.json()) as LumaCalendarItemsResponse
      const entries = body.entries ?? []
      events.push(...entries.flatMap((e) => (e.event ? [e.event] : [])))

      const nextCursor = entries[entries.length - 1]?.api_id ?? null
      if (!body.has_more || entries.length === 0 || nextCursor === cursor) {
        break
      }
      cursor = nextCursor
    }

    return events
  }

  async fetchAll(): Promise<Omit<StoredEvent, "id" | "createdAt" | "updatedAt">[]> {
    try {
      const all: Omit<StoredEvent, "id" | "createdAt" | "updatedAt">[] = []
      for (const calendar of this.options.calendars) {
        const calendarId = await this.resolveCalendarId(calendar.slug)
        const events = await this.fetchCalendarEvents(calendarId)
        console.log(`   ${calendar.slug}: ${events.length} upcoming events`)
        for (const event of events) {
          if (!event.start_at) continue
          all.push(this.transformToStoredEvent(event, calendar))
        }
      }
      return all
    } catch (error) {
      logError("Error fetching Luma events:", error)
      throw error
    }
  }

  transformToStoredEvent(
    event: LumaEvent,
    calendar: LumaCalendarConfig,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    const timeZone = event.timezone || this.options.timeZone
    const start = utcInstantToLocal(new Date(event.start_at), timeZone)
    const endDate = event.end_at
      ? utcInstantToLocal(new Date(event.end_at), timeZone).date
      : start.date
    const url = event.url
      ? `https://luma.com/${event.url}`
      : `https://luma.com/${calendar.slug}`

    return {
      eventId: `luma_${event.api_id}`,
      title: event.name,
      url,
      location: formatLocation(event.geo_address_info),
      date: start.date,
      startTime: start.time,
      startDate: start.date,
      endDate,
      latitude: event.coordinate?.latitude ?? null,
      longitude: event.coordinate?.longitude ?? null,
      city: event.geo_address_info?.city ?? null,
      imageUrl: event.cover_url ?? null,
      categories: JSON.stringify([
        { catName: calendar.category, catId: calendar.category },
      ]),
      source: this.options.sourceId,
    }
  }
}
