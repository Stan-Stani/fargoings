import { decodeHtmlEntities } from "../dedup/normalize"
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
  /** Dated occurrence path, e.g. "/events-and-deadlines/dates/yoga-park" */
  viewNode: string
  /** Program page path (cleaner link target than the dated path) */
  programPath: string
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

/**
 * Fargo Park District runs Drupal 9 with fullcalendar_block; the calendar
 * page loads `/calendar-events-2?start=&end=` as plain JSON. The feed's
 * `title` is truncated to ~11 chars ("Yoga in the…"), so the display title is
 * reconstructed from the `view_node` slug instead
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
      for (const item of items) {
        const viewNode = (item.view_node ?? "").trim()
        const start = (item.start ?? "").trim()
        if (!viewNode || !start) continue

        const category = decodeHtmlEntities(item.field_color ?? "").trim()
        if (/^deadlines$/i.test(category)) continue

        events.push({
          title: this.titleFromSlug(viewNode),
          category: category || null,
          start,
          end: (item.end ?? start).trim(),
          viewNode,
          programPath: (item.view_node_1 ?? item.url ?? viewNode).trim(),
        })
      }

      console.log(
        `   Parsed ${items.length} calendar items, ${events.length} after dropping deadlines`,
      )
      return events
    } catch (error) {
      logError("Error fetching Fargo Parks events:", error)
      throw error
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
      url: `${this.baseUrl}${event.programPath}`,
      location: null,
      date,
      startTime,
      startDate: date,
      endDate: event.end.slice(0, 10) || date,
      latitude: null,
      longitude: null,
      city: "Fargo",
      imageUrl: null,
      categories: JSON.stringify(
        event.category ? [{ catName: event.category }] : [],
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
