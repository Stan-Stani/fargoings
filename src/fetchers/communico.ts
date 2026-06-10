import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { fetchWithRetry, getDateRangeInTimeZone } from "./shared"

export interface CommunicoEvent {
  id: string
  recurring_id: string
  title: string
  event_start: string // "2026-05-18 17:30:00" — library-local wall time
  event_end: string
  location: string
  location_id: string
  url: string
  private_event: string // "0" | "1"
  event_type: string // "INPERSON" | "VIRTUAL" | ...
  tagsArray?: string[]
  agesArray?: string[]
}

export interface CommunicoBranch {
  /** Branch id from api.communico.co/v1/<tenant>/locations */
  id: string
  /** Display location, ideally with street address */
  location: string
  city: string
  latitude: number | null
  longitude: number | null
}

export interface CommunicoConfig {
  /** Events API base, e.g. "https://siouxland.libnet.info/eeventcaldata" */
  baseUrl: string
  /**
   * Env var holding a relay URL override (Communico WAFs datacenter — and
   * sometimes residential — IPs; see infra/larl-feed-worker for the relay
   * pattern). The relay base already carries ?key=…, so query params are
   * appended with "&".
   */
  relayEnvVar: string
  /** Source id stored on events */
  sourceId: string
  /** eventId prefix, e.g. "sxld" → "sxld_12345" */
  eventIdPrefix: string
  /** Log label */
  label: string
  /** Branches to include; events at other branches are dropped. */
  branches: CommunicoBranch[]
  /** IANA timezone of the library system (default America/Chicago) */
  timeZone?: string
}

/**
 * Generic fetcher for Communico/LibNet library calendars — the same
 * `eeventcaldata` API moorheadlibrary-org.ts uses against larl.libnet.info,
 * but config-driven and multi-branch so a new library system is one config
 * object. `req` is a URL-encoded JSON blob; `locations:[ids]` filters
 * server-side.
 */
export class CommunicoFetcher {
  private readonly timeZone: string
  private readonly branchById: Map<string, CommunicoBranch>

  constructor(private readonly config: CommunicoConfig) {
    this.timeZone = config.timeZone ?? "America/Chicago"
    this.branchById = new Map(config.branches.map((b) => [b.id, b]))
  }

  async fetchEvents(daysAhead: number = 14): Promise<CommunicoEvent[]> {
    try {
      const dateRange = getDateRangeInTimeZone(daysAhead, this.timeZone)

      console.log(
        `   Date range (${this.timeZone}): ${dateRange.startDateStr} to ${dateRange.endDateStr}`,
      )

      const req = JSON.stringify({
        private: false,
        date: dateRange.startDateStr,
        days: daysAhead,
        locations: this.config.branches.map((b) => b.id),
        ages: [],
        types: [],
      })
      const relay = process.env[this.config.relayEnvVar]
      const query = `event_type=0&req=${encodeURIComponent(req)}`
      let url: string
      if (relay) {
        console.log(`   Fetching via relay: ${relay.split("?")[0]}`)
        url = `${relay}${relay.includes("?") ? "&" : "?"}${query}`
      } else {
        url = `${this.config.baseUrl}?${query}`
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
        this.config.label,
        4,
      )

      const contentType = response.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) {
        const bodyPreview = (await response.text()).slice(0, 500)
        throw new Error(
          `${this.config.label} returned non-JSON (${contentType}) for ${url}. Body: ${bodyPreview}`,
        )
      }

      const events = (await response.json()) as CommunicoEvent[]
      if (!Array.isArray(events)) {
        throw new Error(`${this.config.label} did not return an array`)
      }

      // Server filters to the branches + window already; drop private events
      // and defensively re-check the branch id in case the filter is ignored.
      const active = events.filter(
        (e) => e.private_event !== "1" && this.branchById.has(e.location_id),
      )

      console.log(
        `   Fetched ${events.length} events, ${active.length} public branch events`,
      )

      return active
    } catch (error) {
      logError(`Error in ${this.config.label}:`, error)
      throw error
    }
  }

  transformToStoredEvent(
    event: CommunicoEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    // event_start is "YYYY-MM-DD HH:MM:SS" in the library's local wall time;
    // keep the parts verbatim so a server in another tz doesn't shift the day.
    const [startDate, startClock] = event.event_start.split(" ")
    const [endDate] = (event.event_end || event.event_start).split(" ")
    const startTime =
      startClock && startClock !== "00:00:00" ? startClock : null

    const categories = (event.tagsArray ?? [])
      .filter(Boolean)
      .map((tag) => ({ catName: tag, catId: tag }))

    // Collapse Communico's "//event/" into a single slash (the leading
    // "https://" double slash is protected by the [^:] guard).
    const url = event.url.replace(/([^:])\/\/event\//, "$1/event/")

    const branch = this.branchById.get(event.location_id)

    return {
      eventId: `${this.config.eventIdPrefix}_${event.id}`,
      title: event.title,
      url,
      location: branch?.location ?? event.location,
      date: startDate,
      startTime,
      startDate,
      endDate,
      latitude: branch?.latitude ?? null,
      longitude: branch?.longitude ?? null,
      city: branch?.city ?? null,
      imageUrl: null,
      categories: JSON.stringify(categories),
      source: this.config.sourceId,
    }
  }
}
