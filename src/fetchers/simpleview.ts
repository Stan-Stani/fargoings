import { createHash } from "crypto"
import { FargoAPIResponse, FargoEvent, StoredEvent } from "../types/event"
import {
  fetchWithRetry,
  getDateRangeInTimeZone,
  toTimeZoneMidnightIso,
} from "./shared"

export interface SimpleviewConfig {
  /** Site origin, e.g. "https://www.dennysanfordpremiercenter.com" */
  siteBase: string
  /** Source id stored on events */
  sourceId: string
  /** Log label, e.g. "Premier Center fetch" */
  label: string
  /** Fallback city when the event record carries none */
  defaultCity: string | null
  /**
   * Fallback location label when the event record carries none — single-venue
   * Simpleview sites (arenas) often leave `location` empty because every
   * event is at the house venue.
   */
  defaultLocation?: string
  /** IANA timezone of the venue (default America/Chicago) */
  timeZone?: string
  /**
   * Optional categories.catId filter (tenant-specific ids, like the curated
   * list fargomoorhead-com.ts uses). Omitted = all categories.
   */
  categoryIds?: string[]
  daysAhead?: number
}

/**
 * Generic fetcher for Simpleview CMS sites (CVBs and ASM-managed venues):
 * the same token + rest_v2 Mongo-find API that fargomoorhead.org exposes
 * (`/plugins/core/get_simple_token/` then
 * `/includes/rest_v2/plugins_events_events_by_date/find/?json=…&token=…`),
 * but config-driven so a new Simpleview site is one config object.
 */
export class SimpleviewFetcher {
  private readonly timeZone: string
  private cachedToken: string | null = null
  private tokenExpiresAt: number = 0

  constructor(private readonly config: SimpleviewConfig) {
    this.timeZone = config.timeZone ?? "America/Chicago"
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `${this.config.siteBase}/events/`,
      Origin: this.config.siteBase,
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    }
  }

  /** Tokens expire after 24 hours according to the API response headers. */
  private async getToken(): Promise<string> {
    const now = Date.now()
    if (this.cachedToken && now < this.tokenExpiresAt - 3600000) {
      return this.cachedToken
    }

    const response = await fetchWithRetry(
      `${this.config.siteBase}/plugins/core/get_simple_token/`,
      { headers: { ...this.headers(), Accept: "text/plain,*/*" } },
      `${this.config.label} token`,
    )
    const token = (await response.text()).trim()
    if (!token) {
      throw new Error(`${this.config.label} token fetch returned empty token`)
    }
    this.cachedToken = token
    this.tokenExpiresAt = now + 86400000
    return token
  }

  async fetchEvents(
    limit: number = 500,
    daysAhead: number = this.config.daysAhead ?? 14,
  ): Promise<FargoEvent[]> {
    const token = await this.getToken()

    const dateRange = getDateRangeInTimeZone(daysAhead, this.timeZone)
    const startIso = toTimeZoneMidnightIso(dateRange.start, this.timeZone)
    const endIso = toTimeZoneMidnightIso(dateRange.end, this.timeZone)

    console.log(
      `   Date range (${this.timeZone}): ${dateRange.startDateStr} to ${dateRange.endDateStr}`,
    )

    const filter: Record<string, unknown> = {
      active: true,
      date_range: {
        start: { $date: startIso },
        end: { $date: endIso },
      },
    }
    if (this.config.categoryIds && this.config.categoryIds.length > 0) {
      filter.$and = [
        { "categories.catId": { $in: this.config.categoryIds } },
      ]
    }

    const body = {
      filter,
      options: {
        limit,
        count: true,
        castDocs: false,
        fields: {
          _id: 1,
          location: 1,
          date: 1,
          startDate: 1,
          endDate: 1,
          recurrence: 1,
          recurType: 1,
          startTime: 1,
          endTime: 1,
          latitude: 1,
          longitude: 1,
          media_raw: 1,
          recid: 1,
          title: 1,
          url: 1,
          categories: 1,
          accountId: 1,
          city: 1,
          region: 1,
        },
        hooks: [],
        sort: { date: 1, rank: 1, title_sort: 1 },
      },
    }

    const url = `${this.config.siteBase}/includes/rest_v2/plugins_events_events_by_date/find/?json=${encodeURIComponent(JSON.stringify(body))}&token=${token}`

    try {
      const response = await fetchWithRetry(
        url,
        { headers: this.headers() },
        this.config.label,
      )
      const data = (await response.json()) as FargoAPIResponse
      return data.docs.docs
    } catch (error) {
      console.error(`Error in ${this.config.label}:`, error)
      throw error
    }
  }

  private toDateOnly(isoString: string): string {
    // Normalize to venue-local date so the server's timezone can't shift days.
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: this.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    const parts = formatter.formatToParts(new Date(isoString))
    const year = parts.find((part) => part.type === "year")?.value
    const month = parts.find((part) => part.type === "month")?.value
    const day = parts.find((part) => part.type === "day")?.value
    if (!year || !month || !day) {
      throw new Error(`Invalid date from API: ${isoString}`)
    }
    return `${year}-${month}-${day}`
  }

  // Upstream regenerates Mongo ObjectIds periodically and can return both the
  // master listing and per-occurrence documents; deriving eventId from stable
  // fields collapses those copies onto a single row via the upsert.
  private stableEventId(
    url: string,
    date: string,
    startTime: string | null,
  ): string {
    return createHash("sha1")
      .update(`${url}|${date}|${startTime ?? ""}`)
      .digest("hex")
      .slice(0, 24)
  }

  transformToStoredEvent(
    event: FargoEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    const date = this.toDateOnly(event.date)
    const url = event.url.startsWith("http")
      ? event.url
      : `${this.config.siteBase}${event.url}`
    const startTime = event.startTime || null
    return {
      eventId: this.stableEventId(url, date, startTime),
      title: event.title,
      url,
      location: event.location || this.config.defaultLocation || null,
      date,
      startTime,
      startDate: this.toDateOnly(event.startDate),
      endDate: this.toDateOnly(event.endDate || event.startDate),
      latitude: event.latitude || null,
      longitude: event.longitude || null,
      city: event.city || this.config.defaultCity,
      imageUrl:
        event.media_raw && event.media_raw.length > 0
          ? event.media_raw[0].mediaurl
          : null,
      categories: JSON.stringify(event.categories),
      source: this.config.sourceId,
    }
  }
}
