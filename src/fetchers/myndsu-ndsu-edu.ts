import { logError } from "../log"
import { StoredEvent } from "../types/event"
import {
  DEFAULT_BROWSER_HEADERS,
  fetchWithRetry,
  getDateRangeInTimeZone,
  utcInstantToLocal,
} from "./shared"

export interface MyNdsuEvent {
  id: string
  name: string
  /** UTC instant with offset, e.g. "2026-06-10T15:00:00+00:00" */
  startsOn: string
  endsOn: string | null
  location: string | null
  latitude: string | number | null
  longitude: string | number | null
  categoryNames: string[]
  imagePath: string | null
}

/**
 * NDSU campus/student-org events live on Anthology (CampusLabs) Engage at
 * myndsu.ndsu.edu — ndsu.edu/events redirects there and there is no separate
 * public master calendar. The discovery search API is public JSON (no auth).
 * The companion events.rss feed is hard-capped to a 7-day window, so the API
 * is the right source. Distinct from gobison.com (NDSU *athletics*).
 */
export class MyNdsuFetcher {
  private readonly timeZone = "America/Chicago"
  private readonly apiBase = "https://myndsu.ndsu.edu/api/discovery/event/search"
  private readonly eventBase = "https://myndsu.ndsu.edu/event/"
  private readonly imageCdn = "https://se-images.campuslabs.com/clink/images/"

  async fetchEvents(daysAhead: number = 14): Promise<MyNdsuEvent[]> {
    try {
      const dateRange = getDateRangeInTimeZone(daysAhead, this.timeZone)
      console.log(
        `   Date range (${this.timeZone}): ${dateRange.startDateStr} to ${dateRange.endDateStr}`,
      )

      const params = new URLSearchParams({
        endsAfter: `${dateRange.startDateStr}T00:00:00`,
        orderByField: "endsOn",
        status: "Approved",
        take: "200",
      })
      const response = await fetchWithRetry(
        `${this.apiBase}?${params}`,
        { headers: { ...DEFAULT_BROWSER_HEADERS, Referer: "https://myndsu.ndsu.edu/events", Origin: "https://myndsu.ndsu.edu" } },
        "NDSU campus events fetch",
        4,
      )
      const data = (await response.json()) as { value?: MyNdsuEvent[] }
      const items = data.value ?? []

      // endsAfter is the only server-side bound; cap the forward window
      // ourselves so volume and the cancelled-detection horizon stay at 14d.
      const events = items.filter((e) => {
        if (!e?.id || !e?.name || !e?.startsOn) return false
        const { date } = utcInstantToLocal(new Date(e.startsOn), this.timeZone)
        return date >= dateRange.startDateStr && date <= dateRange.endDateStr
      })

      console.log(
        `   Fetched ${items.length} events, ${events.length} in window`,
      )
      return events
    } catch (error) {
      logError("Error fetching NDSU campus events:", error)
      throw error
    }
  }

  transformToStoredEvent(
    event: MyNdsuEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    const start = utcInstantToLocal(new Date(event.startsOn), this.timeZone)
    const end = event.endsOn
      ? utcInstantToLocal(new Date(event.endsOn), this.timeZone)
      : start

    const latitude = event.latitude == null ? null : Number(event.latitude)
    const longitude = event.longitude == null ? null : Number(event.longitude)

    const imagePath = event.imagePath?.trim()
    const imageUrl = !imagePath
      ? null
      : /^https?:\/\//i.test(imagePath)
        ? imagePath
        : `${this.imageCdn}${imagePath}`

    return {
      eventId: `ndsu_${event.id}`,
      title: event.name.trim(),
      url: `${this.eventBase}${event.id}`,
      location: event.location?.trim() || null,
      date: start.date,
      startTime: start.time,
      startDate: start.date,
      endDate: end.date,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      city: "Fargo",
      imageUrl,
      categories: JSON.stringify(
        (event.categoryNames ?? []).map((name) => ({ catName: name })),
      ),
      source: "myndsu.ndsu.edu",
    }
  }
}
