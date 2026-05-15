import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { fetchWithRetry, getDateRangeInTimeZone } from "./shared"

export interface MoorheadLibraryEvent {
  id: string
  recurring_id: string
  title: string
  event_start: string // "2026-05-18 17:30:00" — local (America/Chicago) wall time
  event_end: string
  location: string
  location_id: string
  url: string
  private_event: string // "0" | "1"
  event_type: string // "INPERSON" | "VIRTUAL" | ...
  tagsArray?: string[]
  agesArray?: string[]
}

/**
 * Moorhead Public Library is one branch of the Lake Agassiz Regional Library
 * (LARL), whose calendar runs on Communico/LibNet at `larl.libnet.info`. The
 * public SPA fetches `eeventcaldata` with `req` as a URL-encoded JSON blob
 * (NOT a datetime string — that returns `[]`). `locations:[id]` filters
 * server-side to a single branch; Moorhead's branch id is 3119 (from
 * `api.communico.co/v1/larl/locations`). Each occurrence of a recurring
 * series has a unique `id`, so `mph_${id}` is collision-free.
 *
 * larl.libnet.info's AWS WAF 403s the production VPS's datacenter IP, so
 * set `MPH_EVENTS_URL` to a Cloudflare Worker relay (CF egress is not
 * blocked) — same approach as the West Fargo feed. See
 * infra/larl-feed-worker/README.md.
 */
export class MoorheadLibraryFetcher {
  private readonly timeZone = "America/Chicago"
  private readonly baseUrl = "https://larl.libnet.info/eeventcaldata"
  private readonly moorheadLocationId = "3119"
  // From api.communico.co/v1/larl/locations (branch 3119).
  private readonly venue =
    "Moorhead Public Library, 450 Center Ave, Moorhead, MN 56560"
  private readonly latitude = 46.873097
  private readonly longitude = -96.771756

  async fetchEvents(daysAhead: number = 14): Promise<MoorheadLibraryEvent[]> {
    try {
      const dateRange = getDateRangeInTimeZone(daysAhead, this.timeZone)

      console.log(
        `   Date range (${this.timeZone}): ${dateRange.start.month}/${dateRange.start.day}/${dateRange.start.year} to ${dateRange.end.month}/${dateRange.end.day}/${dateRange.end.year}`,
      )

      const req = JSON.stringify({
        private: false,
        date: dateRange.startDateStr,
        days: daysAhead,
        locations: [this.moorheadLocationId],
        ages: [],
        types: [],
      })
      // larl.libnet.info's AWS WAF returns 403 to datacenter IPs (the VPS),
      // so production sets MPH_EVENTS_URL to a Cloudflare Worker relay
      // (CF egress is not blocked). The relay base already carries ?key=…,
      // so the query params are appended with "&". See infra/larl-feed-worker.
      const relay = process.env.MPH_EVENTS_URL
      const query = `event_type=0&req=${encodeURIComponent(req)}`
      let url: string
      if (relay) {
        console.log(`   Fetching via relay: ${relay.split("?")[0]}`)
        url = `${relay}${relay.includes("?") ? "&" : "?"}${query}`
      } else {
        url = `${this.baseUrl}?${query}`
      }

      const response = await fetchWithRetry(
        url,
        {
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        },
        "Moorhead Library events fetch",
        4,
      )

      const contentType = response.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) {
        const bodyPreview = (await response.text()).slice(0, 500)
        throw new Error(
          `Moorhead Library fetch returned non-JSON (${contentType}) for ${url}. Body: ${bodyPreview}`,
        )
      }

      const events = (await response.json()) as MoorheadLibraryEvent[]
      if (!Array.isArray(events)) {
        throw new Error("Moorhead Library fetch did not return an array")
      }

      // Server filters to Moorhead + window already; drop private events and
      // defensively re-check the branch id in case the filter is ever ignored.
      const active = events.filter(
        (e) =>
          e.private_event !== "1" &&
          e.location_id === this.moorheadLocationId,
      )

      console.log(
        `   Fetched ${events.length} events, ${active.length} public Moorhead events`,
      )

      return active
    } catch (error) {
      logError("Error fetching Moorhead Library events:", error)
      throw error
    }
  }

  transformToStoredEvent(
    event: MoorheadLibraryEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    // event_start is "YYYY-MM-DD HH:MM:SS" in the library's local wall time;
    // keep the parts verbatim so a VPS in another tz doesn't shift the day.
    const [startDate, startClock] = event.event_start.split(" ")
    const [endDate] = (event.event_end || event.event_start).split(" ")
    const startTime =
      startClock && startClock !== "00:00:00" ? startClock : null

    const categories = (event.tagsArray ?? [])
      .filter(Boolean)
      .map((tag) => ({ catName: tag, catId: tag }))

    // Collapse Communico's "//event/" into a single slash.
    const url = event.url.replace(
      "larl.libnet.info//event/",
      "larl.libnet.info/event/",
    )

    return {
      eventId: `mph_${event.id}`,
      title: event.title,
      url,
      location: this.venue,
      date: startDate,
      startTime,
      startDate,
      endDate,
      latitude: this.latitude,
      longitude: this.longitude,
      city: "Moorhead",
      imageUrl: null,
      categories: JSON.stringify(categories),
      source: "moorheadlibrary.org",
    }
  }
}
