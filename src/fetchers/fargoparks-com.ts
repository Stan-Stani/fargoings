import { decodeHtmlEntities } from "../dedup/normalize"
import { CanonicalCategory } from "../enrichment/categories"
import { LOCATION_SEE_LINK } from "../enrichment/venues"
import { logError } from "../log"
import { StoredEvent } from "../types/event"
import {
  DEFAULT_BROWSER_HEADERS,
  fetchWithRetry,
  getDateRangeInTimeZone,
} from "./shared"

export interface FargoParksEvent {
  title: string
  category: string | null
  /** Local ISO datetime, e.g. "2026-06-10T09:00:00" */
  start: string
  end: string
  /** Occurrence page path, e.g. "/events-and-deadlines/dates/yoga-park" */
  viewNode: string
  /**
   * Program section path, e.g. "/adult-60-programs/active-agers". Shared by
   * every program in the section, so it says what kind of event this is but
   * can't identify or link to one.
   */
  programPath: string
  /** Facility named on the occurrence page. Null if the page names none. */
  facility: string | null
}

interface RawCalendarItem {
  title?: string
  field_color?: string
  start?: string
  end?: string
  view_node?: string
  view_node_1?: string
  url?: string
}

/** Section path → category, first match wins. Sports before the audience. */
const PROGRAM_PATH_CATEGORIES: Array<[RegExp, CanonicalCategory]> = [
  [/^\/park-board\//, "Public Meetings"],
  [
    /\/(?:volleyball|basketball|pickleball|softball|flag-football|baseball-t-ball|sports-sampler|drop-hockey)\b/,
    "Sports",
  ],
  [/^\/adult-(?:55|60)-programs\/|\/active-agers\b/, "Seniors"],
  [/\/(?:arts-culture|artventures|awesome-art-afternoon|paint-prairie)\b/, "Arts & Crafts"],
  [/\/education-stem\b/, "STEM"],
  [/\/health-wellness\b/, "Health & Wellness"],
  [/\/yoga-park\b/, "Fitness & Yoga"],
  [/\/music-park\b/, "Live Music"],
  [/\/movie-park\b/, "Film & Media"],
  [/^\/youth-programs\//, "Youth & Family"],
  [/\/nature-outdoors\b/, "Outdoors & Recreation"],
  [/^\/(?:adult-programs|events-and-deadlines|broadway-square|foundation)\b/, "Community"],
]

export function categoryFromProgramPath(path: string): CanonicalCategory | null {
  for (const [pattern, category] of PROGRAM_PATH_CATEGORIES) {
    if (pattern.test(path)) return category
  }
  return null
}

/** The display title and facility from an occurrence page's HTML. */
export function parseOccurrencePage(html: string): {
  title: string | null
  facility: string | null
} {
  const text = (fragment: string | undefined): string | null => {
    if (!fragment) return null
    const plain = decodeHtmlEntities(fragment.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
    return plain || null
  }
  // The page's real heading is the last h1; the first is the site banner on
  // pages that have one.
  const headings = Array.from(html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi))
  const facility = html.match(
    /field--name-field-facility[\s\S]*?field--item[^>]*>([\s\S]*?)<\/div>/i,
  )
  return {
    title: text(headings[headings.length - 1]?.[1]),
    facility: text(facility?.[1]),
  }
}

/**
 * Fargo Park District runs Drupal 9 with fullcalendar_block; the calendar
 * page loads `/calendar-events-2?start=&end=` as plain JSON. The feed's
 * `title` is truncated to ~11 chars ("Yoga in the…") and it has no venue, but
 * each entry links to an occurrence page with both. Fetched once per page,
 * since a weekly program lists the same one for every date. If a page can't be
 * read, the title falls back to the `view_node` slug
 * ("/events-and-deadlines/dates/yoga-park" → "Yoga Park"). "Deadlines"
 * entries are registration cutoffs, not attendable events — dropped.
 */
export class FargoParksFetcher {
  private readonly timeZone = "America/Chicago"
  private readonly baseUrl = "https://www.fargoparks.com"

  async fetchEvents(daysAhead: number = 14): Promise<FargoParksEvent[]> {
    try {
      const dateRange = getDateRangeInTimeZone(daysAhead, this.timeZone)
      console.log(
        `   Date range (${this.timeZone}): ${dateRange.startDateStr} to ${dateRange.endDateStr}`,
      )

      const url = `${this.baseUrl}/calendar-events-2?start=${dateRange.startDateStr}&end=${dateRange.endDateStr}`
      const response = await fetchWithRetry(
        url,
        { headers: { ...DEFAULT_BROWSER_HEADERS, Referer: `${this.baseUrl}/calendar`, Origin: this.baseUrl } },
        "Fargo Parks events fetch",
        4,
      )
      const items = (await response.json()) as RawCalendarItem[]

      const events: FargoParksEvent[] = []
      const pages = new Map<
        string,
        { title: string | null; facility: string | null }
      >()
      for (const item of items) {
        const viewNode = (item.view_node ?? "").trim()
        const start = (item.start ?? "").trim()
        if (!viewNode || !start) continue

        const category = decodeHtmlEntities(item.field_color ?? "").trim()
        if (/^deadlines$/i.test(category)) continue

        let page = pages.get(viewNode)
        if (!page) {
          page = await this.fetchOccurrencePage(viewNode)
          pages.set(viewNode, page)
        }

        events.push({
          title: page.title ?? this.titleFromSlug(viewNode),
          category: category || null,
          start,
          end: (item.end ?? start).trim(),
          viewNode,
          programPath: (item.view_node_1 ?? item.url ?? viewNode).trim(),
          facility: page.facility,
        })
      }

      console.log(
        `   Parsed ${items.length} calendar items, ${events.length} after dropping deadlines (${pages.size} occurrence pages)`,
      )
      return events
    } catch (error) {
      logError("Error fetching Fargo Parks events:", error)
      throw error
    }
  }

  /** Never throws: a missing page costs one event's venue, not the source. */
  private async fetchOccurrencePage(
    viewNode: string,
  ): Promise<{ title: string | null; facility: string | null }> {
    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}${viewNode}`,
        { headers: DEFAULT_BROWSER_HEADERS },
        "Fargo Parks occurrence page fetch",
        2,
      )
      return parseOccurrencePage(await response.text())
    } catch {
      console.warn(`   ⚠️ Could not read Fargo Parks page ${viewNode}`)
      return { title: null, facility: null }
    }
  }

  transformToStoredEvent(
    event: FargoParksEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    const date = event.start.slice(0, 10)
    const time = event.start.slice(11, 19) || null
    const startTime = time === "00:00:00" ? null : time
    const slug = event.viewNode.split("/").filter(Boolean).pop() ?? "event"

    return {
      // Same program can occur more than once per day (e.g. swim sessions),
      // so the start time is part of the key alongside the date.
      eventId: `fpk_${slug}_${date}${startTime ? `_${startTime.replace(/:/g, "")}` : ""}`,
      title: event.title,
      url: `${this.baseUrl}${event.viewNode}`,
      location: event.facility ?? LOCATION_SEE_LINK,
      date,
      startTime,
      startDate: date,
      endDate: event.end.slice(0, 10) || date,
      latitude: null,
      longitude: null,
      city: "Fargo",
      imageUrl: null,
      categories: JSON.stringify(
        [event.category, categoryFromProgramPath(event.programPath)]
          .filter(Boolean)
          .map((catName) => ({ catName })),
      ),
      source: "fargoparks.com",
    }
  }

  /** "/events-and-deadlines/dates/stay-active-and-independent-life-sail" → "Stay Active and Independent Life Sail" */
  private titleFromSlug(viewNode: string): string {
    // Trailing "-0" is Drupal's duplicate-path suffix, not a title word
    // ("yoga-garden-0" → "Yoga Garden"); higher numbers can be real
    // ("...session-1" → "Session 1"), so only -0 is stripped.
    const slug = (viewNode.split("/").filter(Boolean).pop() ?? "").replace(
      /-0$/,
      "",
    )
    const small = new Set([
      "a", "an", "and", "at", "for", "in", "of", "on", "or", "the", "to", "with",
    ])
    return slug
      .split("-")
      .filter(Boolean)
      .map((word, i) =>
        i > 0 && small.has(word)
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1),
      )
      .join(" ")
  }
}
