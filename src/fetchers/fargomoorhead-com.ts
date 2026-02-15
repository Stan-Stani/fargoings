import { FargoAPIResponse, FargoEvent, StoredEvent } from "../types/event"

export class FargoFetcher {
  private readonly baseUrl =
    "https://www.fargomoorhead.org/includes/rest_v2/plugins_events_events_by_date/find/"
  private readonly tokenUrl =
    "https://www.fargomoorhead.org/plugins/core/get_simple_token/"
  private readonly browserHeaders = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://www.fargomoorhead.org/events/",
    Origin: "https://www.fargomoorhead.org",
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  }
  private cachedToken: string | null = null
  private tokenExpiresAt: number = 0

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    label: string,
    maxAttempts: number = 3,
  ): Promise<Response> {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, init)
        if (response.ok) {
          return response
        }

        const bodyPreview = (await response.text()).slice(0, 500)
        const shouldRetry = response.status >= 500 || response.status === 429

        if (!shouldRetry || attempt === maxAttempts) {
          throw new Error(
            `${label} failed: HTTP ${response.status}. Body preview: ${bodyPreview}`,
          )
        }

        console.warn(
          `⚠️ ${label} attempt ${attempt}/${maxAttempts} failed with ${response.status}; retrying...`,
        )
      } catch (error) {
        lastError = error
        if (attempt === maxAttempts) {
          throw error
        }
        console.warn(
          `⚠️ ${label} attempt ${attempt}/${maxAttempts} errored; retrying...`,
          error,
        )
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 750))
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`${label} failed after retries`)
  }

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
      const response = await this.fetchWithRetry(
        this.tokenUrl,
        {
          headers: {
            ...this.browserHeaders,
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

    // Calculate dynamic date range: today to N days ahead
    const startDate = new Date()
    startDate.setHours(0, 0, 0, 0)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + daysAhead)

    console.log(
      `   Date range: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`,
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
          start: { $date: startDate.toISOString() },
          end: { $date: endDate.toISOString() },
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
        },
        hooks: [],
        sort: { date: 1, rank: 1, title_sort: 1 },
      },
    }

    const url = `${this.baseUrl}?json=${encodeURIComponent(JSON.stringify(filter))}&token=${token}`

    try {
      const response = await this.fetchWithRetry(
        url,
        { headers: this.browserHeaders },
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
    // API returns UTC timestamps like "2026-02-15T05:59:59.000Z"
    // which is actually Feb 14 11:59 PM Central Time
    // Parse and extract local date, not UTC date
    const date = new Date(isoString)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  transformToStoredEvent(
    event: FargoEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    return {
      eventId: event._id,
      title: event.title,
      url: `https://www.fargomoorhead.org${event.url}`,
      location: event.location || null,
      date: this.toDateOnly(event.date),
      startTime: event.startTime || null,
      startDate: this.toDateOnly(event.startDate),
      endDate: this.toDateOnly(event.endDate || event.startDate),
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
