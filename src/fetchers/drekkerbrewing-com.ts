import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { fetchWithRetry } from "./shared"

/**
 * Drekker Brewing (Brewhalla, 1666 1st Ave N, Fargo) dropped The Events
 * Calendar around 2026-06-19 — the whole WP REST API now errors
 * (rest_no_route / 500), which is what broke the old Tribe fetcher. Events
 * moved to the Sugar Calendar plugin, whose event-list block on /events/ is
 * fully server-rendered: one `<div data-eventdays=... class="...
 * __listview__event">` block per event carrying the detail-page link, the
 * title, ISO `<time datetime="...">` stamps (floating local wall-clock,
 * America/Chicago in practice), and the card image as an inline
 * background-image. No venue is published anywhere — every Drekker event is
 * at the Brewhalla complex, so it's set statically.
 *
 * The block renders the upcoming list only (~a month ahead on current data,
 * no pagination fetched) — comfortably covers the 14-day fetch window.
 */
const EVENTS_URL = "https://drekkerbrewing.com/events/"

const HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}

const VENUE = {
  location: "Brewhalla (Drekker Brewing), 1666 1st Ave N, Fargo, ND 58102",
  city: "Fargo",
  latitude: 46.8763,
  longitude: -96.8079,
}

function categorize(title: string): string {
  if (/trivia|bingo/i.test(title)) return "Trivia & Bingo"
  if (/table|dinner|tasting|bbq|brunch/i.test(title)) return "Food & Drink"
  return "Community"
}

export interface DrekkerEvent {
  slug: string
  title: string
  url: string
  /** "YYYY-MM-DDTHH:MM:SS" floating local wall-clock. */
  startAt: string
  /** Latest stamp in the block; equals startAt when no end is rendered. */
  endAt: string
  imageUrl: string | null
}

/** Parse the Sugar Calendar event-list block markup into events. */
export function parseSugarCalendarList(html: string): DrekkerEvent[] {
  // Each event is one block div; chunking on its opening tag keeps every
  // child (day badge, title link, time spans, card image) with its event.
  const chunks = html.split(
    /<div\s+data-eventdays=[^>]*sugar-calendar-event-list-block__listview__event"/,
  )
  const events: DrekkerEvent[] = []

  for (const chunk of chunks.slice(1)) {
    const title = chunk.match(
      /sugar-calendar-event-list-block__event__title[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/,
    )
    if (!title) continue
    const url = title[1]
    const slug = url.replace(/\/+$/, "").split("/").pop() ?? url

    const stamps = [
      ...chunk.matchAll(/datetime="(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"/g),
    ].map((m) => m[1])
    if (stamps.length === 0) continue
    stamps.sort()

    const image = chunk.match(/background-image:\s*url\('([^']+)'\)/)

    events.push({
      slug,
      title: title[2].trim(),
      url,
      startAt: stamps[0],
      endAt: stamps[stamps.length - 1],
      imageUrl: image ? image[1] : null,
    })
  }

  return events
}

export class DrekkerBrewingFetcher {
  async fetchEvents(): Promise<DrekkerEvent[]> {
    try {
      const response = await fetchWithRetry(
        EVENTS_URL,
        { headers: HEADERS },
        "Drekker Brewing fetch",
      )
      const events = parseSugarCalendarList(await response.text())
      console.log(`   Parsed ${events.length} events from the listing`)
      return events
    } catch (error) {
      logError("Error fetching Drekker Brewing events:", error)
      throw error
    }
  }

  transformToStoredEvent(
    event: DrekkerEvent,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    const [date, startTime] = event.startAt.split("T")
    const endDate = event.endAt.split("T")[0]

    return {
      eventId: `drk_${event.slug}`,
      title: event.title,
      url: event.url,
      location: VENUE.location,
      date,
      startTime,
      startDate: date,
      endDate,
      latitude: VENUE.latitude,
      longitude: VENUE.longitude,
      city: VENUE.city,
      imageUrl: event.imageUrl,
      categories: JSON.stringify([
        { catName: categorize(event.title), catId: categorize(event.title) },
      ]),
      source: "drekkerbrewing.com",
    }
  }
}
