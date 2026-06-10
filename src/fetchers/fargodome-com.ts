import { decodeHtmlEntities } from "../dedup/normalize"
import { logError } from "../log"
import { StoredEvent } from "../types/event"
import {
  DEFAULT_BROWSER_HEADERS,
  fetchWithRetry,
  rssTag,
  slugify,
  utcInstantToLocal,
} from "./shared"

export interface FargodomeEvent {
  title: string
  link: string
  /** ev:startdate — ISO UTC instant */
  startRaw: string
  /** ev:enddate — ISO UTC instant (same as start for single-session events) */
  endRaw: string
  location: string
  /** ev:type, e.g. "Concert" / "Sports" / "Other" */
  type: string
}

/**
 * FARGODOME runs a carbonhouse site whose RSS feed carries proper event
 * metadata (`ev:startdate` UTC instants), so no Ticketmaster API key is
 * needed. The feed lists every announced event — often months ahead — which
 * is why the source's fetchHorizonDays is 365, not the usual 14.
 */
export class FargodomeFetcher {
  private readonly timeZone = "America/Chicago"
  private readonly feedUrl = "https://www.fargodome.com/events/rss"

  async fetchEvents(): Promise<FargodomeEvent[]> {
    try {
      const response = await fetchWithRetry(
        this.feedUrl,
        { headers: { ...DEFAULT_BROWSER_HEADERS, Accept: "application/rss+xml, application/xml, text/xml, */*", Referer: "https://www.fargodome.com/events", Origin: "https://www.fargodome.com" } },
        "FARGODOME events fetch",
        4,
      )
      const xml = await response.text()

      const events: FargodomeEvent[] = []
      for (const block of xml.split("<item>").slice(1)) {
        const item = block.split("</item>")[0]
        const title = rssTag(item, "title")
        const link = rssTag(item, "link")
        const startRaw = rssTag(item, "ev:startdate")
        if (!title || !link || !startRaw) continue
        events.push({
          title,
          link,
          startRaw,
          endRaw: rssTag(item, "ev:enddate") || startRaw,
          location: rssTag(item, "ev:location"),
          type: rssTag(item, "ev:type"),
        })
      }

      console.log(`   Parsed ${events.length} FARGODOME events`)
      return events
    } catch (error) {
      logError("Error fetching FARGODOME events:", error)
      throw error
    }
  }

  transformToStoredEvent(
    event: FargodomeEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    const start = utcInstantToLocal(new Date(event.startRaw), this.timeZone)
    const end = utcInstantToLocal(new Date(event.endRaw), this.timeZone)

    const pathSlug =
      event.link.split("/").filter(Boolean).pop() ?? slugify(event.title)

    return {
      eventId: `fdome_${pathSlug}_${start.date}`,
      title: decodeHtmlEntities(event.title).trim(),
      url: event.link,
      location: event.location || "FARGODOME",
      date: start.date,
      startTime: start.time,
      startDate: start.date,
      endDate: end.date,
      latitude: null,
      longitude: null,
      city: "Fargo",
      imageUrl: null,
      categories: JSON.stringify(
        event.type ? [{ catName: event.type }] : [],
      ),
      source: "fargodome.com",
    }
  }
}
