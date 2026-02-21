import "dotenv/config"
import { createServer } from "http"
import { URL } from "url"
import { EventDatabase } from "../db/database"
import { decodeHtmlEntities } from "../dedup/normalize"

const PORT = Number(process.env.API_PORT || 8788)

function getCurrentDateChicago(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(
    new Date(),
  )
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
  const today = getCurrentDateChicago()
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

function extractCategory(categoriesRaw: string | null): string | null {
  if (!categoriesRaw) {
    return null
  }

  try {
    const parsed = JSON.parse(categoriesRaw) as unknown

    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0]

      if (typeof first === "string") {
        return decodeHtmlEntities(first)
      }

      if (first && typeof first === "object") {
        const record = first as Record<string, unknown>

        if (typeof record.catName === "string") {
          return decodeHtmlEntities(record.catName)
        }

        if (typeof record.name === "string") {
          return decodeHtmlEntities(record.name)
        }
      }
    }
  } catch {
    return decodeHtmlEntities(categoriesRaw)
  }

  return null
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

    if (pathname === "/api/categories") {
      sendJson(res, 200, { categories: db.getDistinctCategories() })
      return
    }

    if (pathname === "/api/events") {
      const query = requestUrl.searchParams.get("q") || ""
      const category = requestUrl.searchParams.get("category") || ""
      const page = toPositiveInt(requestUrl.searchParams.get("page"), 1)
      const pageSize = Math.min(
        100,
        Math.max(1, toPositiveInt(requestUrl.searchParams.get("pageSize"), 25)),
      )
      const offset = (page - 1) * pageSize
      const sortDir =
        requestUrl.searchParams.get("sort") === "desc" ? "desc" : "asc"

      const preset = requestUrl.searchParams.get("preset") || ""
      const rawFrom = requestUrl.searchParams.get("dateFrom") || ""
      const rawTo = requestUrl.searchParams.get("dateTo") || ""
      const { dateFrom, dateTo } = resolveDateRange(preset, rawFrom, rawTo)

      const result = db.queryDisplayEvents(
        query,
        pageSize,
        offset,
        sortDir,
        category,
        dateFrom,
        dateTo,
      )
      const totalPages = Math.max(1, Math.ceil(result.total / pageSize))

      sendJson(res, 200, {
        items: result.rows.map((row) => ({
          ...row,
          title: decodeHtmlEntities(row.title),
          location: row.location ? decodeHtmlEntities(row.location) : null,
          categories: extractCategory(row.categories),
          latitude: row.latitude ?? null,
          longitude: row.longitude ?? null,
        })),
        total: result.total,
        page,
        pageSize,
        totalPages,
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
