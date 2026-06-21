import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { fetchWithRetry, formatYmd, getDatePartsInTimeZone } from "./shared"

/**
 * Parachigo (14 8th St S, Fargo) is a DIY music/arts venue. Its site
 * (parachigo.com) is a Square Online store; ticketed events are catalog
 * products of `product_type === "event"`, which carry structured
 * `product_type_details` (start_date/start_time/location). The store's
 * "Events" category is unreliable — merch (tapes, CDs, albums) is filed under
 * it too — so we key off product_type, not category.
 *
 * The catalog is served by Square's public CDN API. The numeric ids below
 * identify this specific store; if Parachigo migrates platforms, re-derive
 * them from the product page's `window.__BOOTSTRAP_STATE__` / the
 * cdn5.editmysite.com XHR in the network tab.
 */
const API_BASE =
  "https://cdn5.editmysite.com/app/store/api/v28/editor/users/145494470/sites/496106265212101762"

const TIME_ZONE = "America/Chicago"

const HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}

interface Venue {
  location: string
  city: string
  latitude: number
  longitude: number
}

const PARACHIGO: Venue = {
  location: "Parachigo, 14 8th St S, Fargo, ND 58103",
  city: "Fargo",
  latitude: 46.8742,
  longitude: -96.791,
}

// Some Parachigo-hosted events happen offsite; the store's location field is
// unreliable (it tags everything "Parachigo"), so we resolve by title.
const MOONRISE_CAFE: Venue = {
  location: "Moonrise Cafe, 111 Broadway N, Fargo, ND 58102",
  city: "Fargo",
  latitude: 46.8775,
  longitude: -96.7875,
}

function resolveVenue(title: string): Venue {
  if (/moonrise/i.test(title)) return MOONRISE_CAFE
  return PARACHIGO
}

function categorize(title: string): string {
  if (/karaoke/i.test(title)) return "Karaoke"
  if (/knit|scrunchie|craft|draw|paint|sew|art fair|art market|\bfair\b|\bmarket\b/i.test(title))
    return "Arts & Crafts"
  if (/fashion|drum|hangout|percussive/i.test(title)) return "Community"
  // Parachigo is primarily a music venue, so unmatched events default to shows.
  return "Live Music"
}

/** "6:30 PM" / "5:00 PM" -> "18:30:00". Returns null if unparseable. */
function parseEventTime(timeStr: string | null | undefined): string | null {
  if (!timeStr) return null
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i)
  if (!m) return null
  let hours = Number(m[1])
  const minutes = Number(m[2])
  hours = m[3].toLowerCase() === "am" ? hours % 12 : (hours % 12) + 12
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`
}

interface SquareProduct {
  id: string
  name: string
  product_type?: string
  absolute_site_link?: string
  site_link?: string
  product_type_details?: {
    start_date?: string | null
    start_time?: string | null
  }
}

interface SquareProductsResponse {
  data: SquareProduct[]
  meta?: { pagination?: { total_pages?: number } }
}

/**
 * Flyer-only Parachigo events that have no Square ticket product (free, no
 * RSVP), so the catalog API can't surface them. Sourced from the venue's
 * promo flyers. They self-expire via the upcoming-only filter below.
 * TODO: remove entries once past (last date here: 2026-06-28).
 */
const FLYER_ONLY_EVENTS: Array<{
  slug: string
  title: string
  date: string
  startTime: string | null
  venue: Venue
}> = [
  {
    slug: "fashion-show-and-tell",
    title: "Fashion Show & Tell",
    date: "2026-06-23",
    startTime: "18:00:00",
    venue: PARACHIGO,
  },
  {
    slug: "limited-hangout-v-percussive-maintenance",
    title: "Limited Hangout V: Percussive Maintenance (Solstice Drum Circle)",
    date: "2026-06-28",
    startTime: "17:00:00",
    venue: PARACHIGO,
  },
]

const EVENTS_PAGE_URL =
  "https://www.parachigo.com/shop/events/F3Q236H5WFQOGQPQ7UDRF4HV"

export class ParachigoFetcher {
  private readonly timeZone = TIME_ZONE

  async fetchEvents(): Promise<SquareProduct[]> {
    try {
      const all: SquareProduct[] = []
      let page = 1

      while (true) {
        const url = `${API_BASE}/products?page=${page}&per_page=100&include=category`
        const response = await fetchWithRetry(
          url,
          { headers: HEADERS },
          `Parachigo products (page ${page})`,
          4,
        )

        const body = (await response.json()) as SquareProductsResponse
        const products = body.data ?? []
        all.push(...products)

        const totalPages = body.meta?.pagination?.total_pages ?? 1
        console.log(
          `   Fetched page ${page}/${totalPages} (${products.length} products)`,
        )
        if (page >= totalPages) break
        page++
      }

      const events = all.filter(
        (p) =>
          p.product_type === "event" &&
          Boolean(p.product_type_details?.start_date),
      )
      console.log(`   ${events.length} of ${all.length} products are events`)
      return events
    } catch (error) {
      logError("Error fetching Parachigo events:", error)
      throw error
    }
  }

  /** API event products + curated flyer-only events, upcoming dates only. */
  async fetchAll(): Promise<Omit<StoredEvent, "id" | "createdAt" | "updatedAt">[]> {
    const today = formatYmd(getDatePartsInTimeZone(new Date(), this.timeZone))

    const fromApi = (await this.fetchEvents())
      .map((p) => this.transformToStoredEvent(p))
      .filter((e) => e.date >= today)

    const flyer = FLYER_ONLY_EVENTS.filter((e) => e.date >= today).map((e) =>
      this.transformFlyerEvent(e),
    )

    return [...fromApi, ...flyer]
  }

  transformToStoredEvent(
    product: SquareProduct,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    const date = product.product_type_details!.start_date as string
    const venue = resolveVenue(product.name)
    const url =
      product.absolute_site_link || product.site_link || EVENTS_PAGE_URL

    return {
      eventId: `parachigo_${product.id}`,
      title: product.name,
      url,
      location: venue.location,
      date,
      startTime: parseEventTime(product.product_type_details?.start_time),
      startDate: date,
      endDate: date,
      latitude: venue.latitude,
      longitude: venue.longitude,
      city: venue.city,
      imageUrl: null,
      categories: JSON.stringify([
        { catName: categorize(product.name), catId: categorize(product.name) },
      ]),
      source: "parachigo.com",
    }
  }

  private transformFlyerEvent(e: {
    slug: string
    title: string
    date: string
    startTime: string | null
    venue: Venue
  }): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    return {
      eventId: `parachigo_${e.slug}_${e.date}`,
      title: e.title,
      url: EVENTS_PAGE_URL,
      location: e.venue.location,
      date: e.date,
      startTime: e.startTime,
      startDate: e.date,
      endDate: e.date,
      latitude: e.venue.latitude,
      longitude: e.venue.longitude,
      city: e.venue.city,
      imageUrl: null,
      categories: JSON.stringify([
        { catName: categorize(e.title), catId: categorize(e.title) },
      ]),
      source: "parachigo.com",
    }
  }
}
