import { createHash } from "crypto"
import { timeForDateInText, timeFromText } from "../enrichment/normalize"
import { FargoAPIResponse, FargoEvent, StoredEvent } from "../types/event"
import {
  DEFAULT_BROWSER_HEADERS,
  fetchWithRetry,
  getDateRangeInTimeZone,
  toTimeZoneMidnightIso,
} from "./shared"

/** Simpleview recurType for "Recurring daily": one continuous run. */
const RECUR_TYPE_DAILY = 1

/**
 * "Name, Street, City, ST ZIP" from the API's separate fields. `location` is
 * only the venue name, and is empty on some events whose address fields are
 * filled in (planetarium shows have only `address1` and `address2: "Bridges
 * 167"`). `address1` is free text: it can already hold the city and state, and
 * isn't always a street at all ("NDSU Challey Hall").
 */
export function buildLocation(event: FargoEvent): string | null {
  const name = (event.location ?? "").trim()
  const address = (event.address1 ?? "").trim()
  const unit = (event.address2 ?? "").trim()

  // Some venue names are already a full address.
  if (/\d/.test(name) && /,\s*(?:ND|MN|SD)\b/i.test(name)) return name

  const venue = name || unit
  const street = /\d/.test(address) ? address : ""
  const streetWithUnit =
    street && name && unit && !street.includes(unit) ? `${street} ${unit}` : street
  const hasLocality = /\b(?:ND|MN|SD)\b/i.test(street)
  const locality =
    event.city && event.state && !hasLocality
      ? `${event.city}, ${event.state}${event.zip ? ` ${event.zip}` : ""}`
      : ""
  const parts = [venue, streetWithUnit, locality].filter(Boolean)
  return streetWithUnit && parts.length ? parts.join(", ") : venue || null
}

export class FargoFetcher {
  private readonly clientTimeZone = "America/Chicago"
  private readonly baseUrl =
    "https://www.fargomoorhead.org/includes/rest_v2/plugins_events_events_by_date/find/"
  private readonly tokenUrl =
    "https://www.fargomoorhead.org/plugins/core/get_simple_token/"
  private cachedToken: string | null = null
  private tokenExpiresAt: number = 0

  /**
   * Fetches a fresh API token from the Fargo Moorhead website.
   * Tokens expire after 24 hours according to the API response headers.
   */
  private async getToken(): Promise<string> {
    const now = Date.now()

    // Return cached token if it's still valid (with 1 hour buffer before expiration)
    if (this.cachedToken && now < this.tokenExpiresAt - 3600000) {
      return this.cachedToken
    }

    try {
      const response = await fetchWithRetry(
        this.tokenUrl,
        {
          headers: {
            ...DEFAULT_BROWSER_HEADERS,
            Accept: "text/plain,*/*",
          },
        },
        "Token fetch",
      )

      const token = (await response.text()).trim()
      if (!token) {
        throw new Error("Token fetch returned empty token")
      }

      this.cachedToken = token
      // Token is valid for 24 hours based on s-maxage header
      this.tokenExpiresAt = now + 86400000 // 24 hours in milliseconds

      console.log("✓ Fetched fresh API token (valid for 24 hours)")
      return this.cachedToken
    } catch (error) {
      console.error("Error fetching API token:", error)
      throw error
    }
  }

  async fetchEvents(
    limit: number = 500,
    daysAhead: number = 14,
  ): Promise<FargoEvent[]> {
    const token = await this.getToken()

    const dateRange = getDateRangeInTimeZone(daysAhead, this.clientTimeZone)
    const startIso = toTimeZoneMidnightIso(dateRange.start, this.clientTimeZone)
    const endIso = toTimeZoneMidnightIso(dateRange.end, this.clientTimeZone)

    console.log(
      `   Date range (${this.clientTimeZone}): ${dateRange.start.month}/${dateRange.start.day}/${dateRange.start.year} to ${dateRange.end.month}/${dateRange.end.day}/${dateRange.end.year}`,
    )

    const filter = {
      filter: {
        active: true,
        $and: [
          {
            "categories.catId": {
              $in: [
                "4",
                "8",
                "9",
                "20",
                "21",
                "10",
                "13",
                "3",
                "7",
                "16",
                "5",
                "18",
                "22",
                "6",
                "23",
                "2",
                "24",
              ],
            },
          },
        ],
        date_range: {
          start: { $date: startIso },
          end: { $date: endIso },
        },
      },
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
          "listing.primary_category": 1,
          "listing.recid": 1,
          "listing.acctid": 1,
          "listing.city": 1,
          "listing.region": 1,
          "listing.title": 1,
          "listing.url": 1,
          "listing.rankname": 1,
          // Venue address and the free-text schedule
          address1: 1,
          address2: 1,
          state: 1,
          zip: 1,
          times: 1,
          description: 1,
        },
        hooks: [],
        sort: { date: 1, rank: 1, title_sort: 1 },
      },
    }

    const url = `${this.baseUrl}?json=${encodeURIComponent(JSON.stringify(filter))}&token=${token}`

    try {
      const response = await fetchWithRetry(
        url,
        { headers: DEFAULT_BROWSER_HEADERS },
        "Events fetch",
      )
      const data = (await response.json()) as FargoAPIResponse
      return data.docs.docs
    } catch (error) {
      console.error("Error fetching Fargo events:", error)
      throw error
    }
  }

  private toDateOnly(isoString: string): string {
    // Always normalize to Fargo local date so VPS/server timezone does not shift dates.
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: this.clientTimeZone,
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

  // Upstream returns the same logical event with different Mongo ObjectIds (the
  // _id appears to be regenerated periodically and the API can return both the
  // master listing and a per-occurrence document). Deriving eventId from stable
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
    const url = `https://www.fargomoorhead.org${event.url}`
    // Season listings ("Concordia Football") have no structured time but give
    // each date's kickoff in the description.
    const startTime =
      event.startTime ||
      timeFromText(event.times) ||
      timeForDateInText(event.description, date)
    // startDate/endDate span a whole recurrence, so a weekly trivia night has
    // an endDate months out. Only a daily recurrence is one continuous run.
    const isRun = event.recurType === RECUR_TYPE_DAILY
    return {
      eventId: this.stableEventId(url, date, startTime),
      title: event.title,
      url,
      location: buildLocation(event),
      date,
      startTime,
      startDate: this.toDateOnly(event.startDate),
      endDate: isRun ? this.toDateOnly(event.endDate || event.startDate) : date,
      latitude: event.latitude || null,
      longitude: event.longitude || null,
      city: event.city || null,
      imageUrl:
        event.media_raw && event.media_raw.length > 0
          ? event.media_raw[0].mediaurl
          : null,
      categories: JSON.stringify(event.categories),
      source: "fargomoorhead.org",
    }
  }
}
