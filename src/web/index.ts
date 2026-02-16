import "dotenv/config"
import { existsSync, readFileSync } from "fs"
import { createServer } from "http"
import { join, resolve } from "path"
import { URL } from "url"
import { EventDatabase } from "../db/database"
import { decodeHtmlEntities } from "../dedup/normalize"

const PORT = Number(process.env.PORT || 8787)
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || "")

function normalizeBasePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === "/") {
    return ""
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, "")
  return withoutTrailingSlash === "/" ? "" : withoutTrailingSlash
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

function sendHtml(res: { writeHead: Function; end: Function }, html: string) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(html)
}

function getContentType(filePath: string): string {
  if (filePath.endsWith(".svg")) return "image/svg+xml"
  if (filePath.endsWith(".png")) return "image/png"
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg"))
    return "image/jpeg"
  if (filePath.endsWith(".webp")) return "image/webp"
  if (filePath.endsWith(".gif")) return "image/gif"
  if (filePath.endsWith(".ico")) return "image/x-icon"
  return "application/octet-stream"
}

function loadPageTemplate(): string {
  const templatePath = join(__dirname, "page.html")
  return readFileSync(templatePath, "utf8")
}

function renderPage(pageTemplate: string, basePath: string): string {
  const apiPath = `${basePath || ""}/api/events`
  return pageTemplate.replace("__API_PATH__", JSON.stringify(apiPath))
}

const PUBLIC_ROOT = resolve(__dirname, "public")

async function main() {
  const db = new EventDatabase()
  const pageTemplate = loadPageTemplate()

  const server = createServer((req, res) => {
    if (!req.url) {
      sendJson(res, 400, { error: "Missing URL" })
      return
    }

    const requestUrl = new URL(req.url, `http://localhost:${PORT}`)
    const pathname = requestUrl.pathname
    const appPath = BASE_PATH
      ? pathname === BASE_PATH
        ? "/"
        : pathname.startsWith(`${BASE_PATH}/`)
          ? pathname.slice(BASE_PATH.length)
          : pathname
      : pathname

    if (appPath === "/health" || pathname === "/health") {
      sendJson(res, 200, { ok: true })
      return
    }

    if (appPath === "/api/events") {
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

    if (appPath === "/" || appPath === "/index.html") {
      sendHtml(res, renderPage(pageTemplate, BASE_PATH))
      return
    }

    if (appPath.startsWith("/public/")) {
      const relativePublicPath = appPath.slice("/public/".length)
      const publicFilePath = resolve(PUBLIC_ROOT, relativePublicPath)

      if (
        !publicFilePath.startsWith(PUBLIC_ROOT) ||
        !existsSync(publicFilePath)
      ) {
        sendJson(res, 404, { error: "Not found" })
        return
      }

      const contentType = getContentType(publicFilePath)
      const body = readFileSync(publicFilePath)
      res.writeHead(200, { "Content-Type": contentType })
      res.end(body)
      return
    }

    if (appPath === "/favicon.ico" || pathname === "/favicon.ico") {
      res.writeHead(204)
      res.end()
      return
    }

    sendJson(res, 404, { error: "Not found" })
  })

  server.listen(PORT, () => {
    const publicBase = BASE_PATH || "/"
    const publicApi = `${BASE_PATH || ""}/api/events`

    console.log(`🌐 Web app running at http://localhost:${PORT}${publicBase}`)
    console.log(`📡 API endpoint: http://localhost:${PORT}${publicApi}`)
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
  console.error("❌ Web server error:", error)
  process.exit(1)
})
