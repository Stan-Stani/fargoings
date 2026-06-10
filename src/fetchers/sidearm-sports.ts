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

export interface SidearmEvent {
  title: string
  link: string
  /** ev:startdate — "2026-04-15" (TBD) or "2026-04-15T19:00:00.0000000Z" (UTC) */
  startRaw: string
  /** s:localstartdate — school-local date, "2026-04-15" */
  localDate: string
}

export interface SidearmConfig {
  /** e.g. "https://gobison.com" */
  baseUrl: string
  /** Human school/program name, e.g. "NDSU Athletics" */
  schoolName: string
  /** Source id, e.g. "gobison.com" */
  sourceId: string
  /** City the program plays its home games in */
  city: string
  /** IANA timezone of the home venue (default America/Chicago). */
  timeZone?: string
}

/**
 * Sidearm Sports powers most college athletics sites and exposes a public
 * RSS feed at `<base>/calendar.ashx/calendar.rss`. One class covers every
 * Sidearm school; NDSU (gobison.com) and MSUM (msumdragons.com) are wired
 * up. Every event is tagged with a "Sports" category and a per-school
 * source so the UI can hide them from the main feed by default.
 *
 * Title format: "M/D [h:mm AM/PM] [L|A|N] <School> <Sport> vs|at <Opp>"
 * where [L]=home, [A]=away, [N]=neutral. `ev:startdate` is either date-only
 * (time TBD) or a full UTC instant; `s:localstartdate` is the school-local
 * date and is the reliable date source.
 */
export class SidearmSportsFetcher {
  private readonly timeZone: string

  constructor(private readonly config: SidearmConfig) {
    this.timeZone = config.timeZone ?? "America/Chicago"
  }

  async fetchEvents(): Promise<SidearmEvent[]> {
    try {
      const url = `${this.config.baseUrl}/calendar.ashx/calendar.rss`
      const response = await fetchWithRetry(
        url,
        { headers: DEFAULT_BROWSER_HEADERS },
        `${this.config.schoolName} schedule fetch`,
        4,
      )
      const xml = await response.text()

      const events: SidearmEvent[] = []
      for (const block of xml.split("<item>").slice(1)) {
        const item = block.split("</item>")[0]
        const title = rssTag(item, "title")
        const link = rssTag(item, "link")
        const startRaw = rssTag(item, "ev:startdate")
        const localDate = rssTag(item, "s:localstartdate")
        if (!title || !startRaw) continue
        events.push({ title, link, startRaw, localDate })
      }

      console.log(
        `   Parsed ${events.length} ${this.config.schoolName} events`,
      )
      return events
    } catch (error) {
      logError(`Error fetching ${this.config.schoolName} events:`, error)
      throw error
    }
  }

  transformToStoredEvent(
    event: SidearmEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    const { date, startTime } = this.resolveDateTime(event)

    // Strip the leading "M/D [h:mm AM/PM] [L|A|N] " bookkeeping prefix; the
    // remainder ("North Dakota State University Softball vs St. Thomas") is
    // the human title. Capture the home/away marker for the location line.
    // "M/D [h:mm AM/PM] [L|A|N] <title>" — both the time and the [L|A|N]
    // marker are optional (away games often omit the bracket).
    const raw = decodeHtmlEntities(event.title).trim()
    const m = raw.match(
      /^\d{1,2}\/\d{1,2}(?:\s+\d{1,2}:\d{2}\s*[AP]M)?\s*(?:\[([LAN])\]\s*)?(.+)$/i,
    )
    const venueType = m?.[1]?.toUpperCase()
    const title = (m?.[2] ?? raw).replace(/\s{2,}/g, " ").trim()

    const where =
      venueType === "L"
        ? "Home"
        : venueType === "A"
          ? "Away"
          : venueType === "N"
            ? "Neutral site"
            : null
    const location = where
      ? `${this.config.schoolName} — ${where}`
      : this.config.schoolName

    const gameId = event.link.match(/game_id=(\d+)/)?.[1]
    const eventId = `${this.config.sourceId.split(".")[0]}_${
      gameId ?? slugify(`${date}-${title}`)
    }`
    // admin.<school>.com is the editor host; use the public one.
    const url = event.link.replace(/\/\/admin\./, "//www.")

    return {
      eventId,
      title,
      url,
      location,
      date,
      startTime,
      startDate: date,
      endDate: date,
      latitude: null,
      longitude: null,
      city: this.config.city,
      imageUrl: null,
      categories: JSON.stringify([{ catName: "Sports", catId: "sports" }]),
      source: this.config.sourceId,
    }
  }

  /** Date from s:localstartdate; time from ev:startdate when it's a UTC instant. */
  private resolveDateTime(event: SidearmEvent): {
    date: string
    startTime: string | null
  } {
    const utc = event.startRaw.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/,
    )
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/

    if (utc && event.startRaw.endsWith("Z")) {
      const [, y, mo, d, h, mi, s] = utc
      const at = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
      const local = utcInstantToLocal(at, this.timeZone)
      return { date: local.date, startTime: local.time }
    }

    // Date-only / TBD time: prefer the school-local date.
    const date = dateOnly.test(event.localDate)
      ? event.localDate
      : event.startRaw.slice(0, 10)
    return { date, startTime: null }
  }

}
