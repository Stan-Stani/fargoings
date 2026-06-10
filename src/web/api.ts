import "dotenv/config"
import { createServer } from "http"
import { URL } from "url"
import { getActiveCity } from "../cities"
import { EventDatabase } from "../db/database"
import { ALL_SOURCE_IDS } from "../fetchers/sources"

const PORT = Number(process.env.API_PORT || 8788)

function getCurrentDateLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getActiveCity().timeZone,
  }).format(new Date())
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** Returns YYYY-MM-DD for the coming Saturday (or today if today is Saturday) */
function comingSaturday(today: string): string {
  const [y, m, d] = today.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = dt.getUTCDay() // 0=Sun,6=Sat
  const daysUntilSat = dow === 6 ? 0 : (6 - dow + 7) % 7 || 7
  return addDays(today, daysUntilSat)
}

/** Returns YYYY-MM-DD for the coming Sunday (end of the same weekend) */
function comingSunday(saturday: string): string {
  return addDays(saturday, 1)
}

/** Returns YYYY-MM-DD for the Sunday ending the current week */
function endOfWeekSunday(today: string): string {
  const [y, m, d] = today.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = dt.getUTCDay()
  const daysUntilSun = dow === 0 ? 0 : 7 - dow
  return addDays(today, daysUntilSun)
}

function resolveDateRange(
  preset: string,
  rawFrom: string,
  rawTo: string,
): { dateFrom: string; dateTo: string } {
  const today = getCurrentDateLocal()
  if (preset === "today") {
    return { dateFrom: today, dateTo: today }
  }
  if (preset === "weekend") {
    const sat = comingSaturday(today)
    return { dateFrom: sat, dateTo: comingSunday(sat) }
  }
  if (preset === "week") {
    return { dateFrom: today, dateTo: endOfWeekSunday(today) }
  }
  // "all" or no preset — just pass through raw values (empty = no upper bound)
  return { dateFrom: rawFrom, dateTo: rawTo }
}

function toPositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

function sendJson(
  res: { writeHead: Function; end: Function },
  status: number,
  payload: unknown,
) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(payload))
}

interface EventFilters {
  query: string
  category: string
  sortDir: "asc" | "desc"
  dateFrom: string
  dateTo: string
  includeSports: boolean
  collapseRepeats: boolean
}

function parseEventFilters(searchParams: URLSearchParams): EventFilters {
  const preset = searchParams.get("preset") || ""
  const rawFrom = searchParams.get("dateFrom") || ""
  const rawTo = searchParams.get("dateTo") || ""
  const { dateFrom, dateTo } = resolveDateRange(preset, rawFrom, rawTo)

  return {
    query: searchParams.get("q") || "",
    category: searchParams.get("category") || "",
    sortDir: searchParams.get("sort") === "desc" ? "desc" : "asc",
    dateFrom,
    dateTo,
    includeSports: searchParams.get("sports") === "show",
    // Recurring series collapse to their next occurrence unless the client
    // opts into seeing every date (`repeats=all`).
    collapseRepeats: searchParams.get("repeats") !== "all",
  }
}

async function main() {
  const db = new EventDatabase()

  const server = createServer((req, res) => {
    if (!req.url) {
      sendJson(res, 400, { error: "Missing URL" })
      return
    }

    const requestUrl = new URL(req.url, `http://localhost:${PORT}`)
    const pathname = requestUrl.pathname

    if (pathname === "/health") {
      sendJson(res, 200, { ok: true })
      return
    }

    if (pathname === "/api/health/sources") {
      // Always HTTP 200 with an `ok` boolean — external monitors keyword-
      // match on `"ok":true`; /health stays the pure liveness probe.
      const sources = db.getSourceHealth(ALL_SOURCE_IDS)
      sendJson(res, 200, {
        ok: sources.every((s) => !s.flagged),
        sources,
      })
      return
    }

    if (pathname === "/api/config") {
      // Per-deployment city identity for the frontend (branding, map view).
      // One build artifact serves any city; main.ts falls back to Fargo
      // values if this endpoint is missing (old API during a deploy window).
      const city = getActiveCity()
      sendJson(res, 200, {
        cityId: city.id,
        displayName: city.displayName,
        branding: city.branding,
        map: city.map,
        timeZone: city.timeZone,
      })
      return
    }

    if (pathname === "/api/categories") {
      sendJson(res, 200, { categories: db.getDistinctCategories() })
      return
    }

    if (pathname === "/api/events") {
      const filters = parseEventFilters(requestUrl.searchParams)
      const page = toPositiveInt(requestUrl.searchParams.get("page"), 1)
      const pageSize = Math.min(
        100,
        Math.max(1, toPositiveInt(requestUrl.searchParams.get("pageSize"), 25)),
      )
      const offset = (page - 1) * pageSize

      const result = db.queryDisplayEvents(
        filters.query,
        pageSize,
        offset,
        filters.sortDir,
        filters.category,
        filters.dateFrom,
        filters.dateTo,
        filters.includeSports,
        filters.collapseRepeats,
      )
      const totalPages = Math.max(1, Math.ceil(result.total / pageSize))

      sendJson(res, 200, {
        items: result.rows.map((row) => ({
          ...row,
          // title/location are decoded at store time; category is
          // precomputed at rebuild time (response key stays `categories`
          // for the frontend).
          categories: row.category ?? null,
          latitude: row.latitude ?? null,
          longitude: row.longitude ?? null,
          recurringCadence: row.recurringCadence ?? null,
          recurringCount: row.recurringCount ?? null,
          possiblyCancelled: row.possiblyCancelled === 1,
        })),
        total: result.total,
        page,
        pageSize,
        totalPages,
      })
      return
    }

    if (pathname === "/api/events/map") {
      // Map view needs every matching event (not a page) but only the
      // fields a marker uses. Capped as a safety valve; display_events
      // only holds future deduped events.
      const filters = parseEventFilters(requestUrl.searchParams)
      const result = db.queryDisplayEvents(
        filters.query,
        1000,
        0,
        filters.sortDir,
        filters.category,
        filters.dateFrom,
        filters.dateTo,
        filters.includeSports,
        filters.collapseRepeats,
      )

      // Coordinates far outside the city's region are upstream geocoding
      // junk (e.g. virtual events pinned to the US centroid); treat them as
      // unmappable so they can't blow up the map bounds.
      const region = getActiveCity().region
      const inRegion = (lat: number, lng: number) =>
        lat > region.minLat &&
        lat < region.maxLat &&
        lng > region.minLng &&
        lng < region.maxLng

      const items = result.rows.map((row) => {
        const hasCoords =
          row.latitude != null &&
          row.longitude != null &&
          inRegion(row.latitude, row.longitude)
        return {
          title: row.title,
          date: row.date,
          startTime: row.startTime,
          location: row.location,
          url: row.url,
          latitude: hasCoords ? row.latitude : null,
          longitude: hasCoords ? row.longitude : null,
        }
      })

      sendJson(res, 200, {
        items,
        total: result.total,
        mappable: items.filter(
          (item) => item.latitude != null && item.longitude != null,
        ).length,
      })
      return
    }

    sendJson(res, 404, { error: "Not found" })
  })

  server.listen(PORT, () => {
    console.log(`📡 API running at http://localhost:${PORT}/api/events`)
  })

  const shutdown = () => {
    server.close(() => {
      db.close()
      process.exit(0)
    })
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((error) => {
  console.error("❌ API server error:", error)
  process.exit(1)
})
