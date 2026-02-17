import "dotenv/config"
import { createServer } from "http"
import { URL } from "url"
import { EventDatabase } from "../db/database"
import { decodeHtmlEntities } from "../dedup/normalize"

const PORT = Number(process.env.API_PORT || 8788)

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

    if (pathname === "/api/events") {
      const query = requestUrl.searchParams.get("q") || ""
      const page = toPositiveInt(requestUrl.searchParams.get("page"), 1)
      const pageSize = Math.min(
        100,
        Math.max(1, toPositiveInt(requestUrl.searchParams.get("pageSize"), 25)),
      )
      const offset = (page - 1) * pageSize

      const result = db.queryDisplayEvents(query, pageSize, offset)
      const totalPages = Math.max(1, Math.ceil(result.total / pageSize))

      sendJson(res, 200, {
        items: result.rows.map((row) => ({
          ...row,
          title: decodeHtmlEntities(row.title),
          location: row.location ? decodeHtmlEntities(row.location) : null,
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
