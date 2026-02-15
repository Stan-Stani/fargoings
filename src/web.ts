import { createServer } from "http"
import { URL } from "url"
import { EventDatabase } from "./db/database"
import { decodeHtmlEntities } from "./dedup/normalize"

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

function renderPage(basePath: string): string {
  const apiPath = `${basePath || ""}/api/events`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fargoings Events</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; color: #111827; background: #f9fafb; }
      h1 { margin: 0 0 16px; }
      .toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
      input { padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; width: 320px; }
      button { padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; cursor: pointer; }
      button:disabled { opacity: 0.5; cursor: default; }
      .meta { margin-bottom: 12px; color: #4b5563; }
      table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
      th, td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; text-align: left; vertical-align: top; font-size: 14px; }
      th { background: #f9fafb; font-weight: 600; }
      tr:last-child td { border-bottom: none; }
      .links a { display: block; margin-bottom: 4px; }
      .pagination { margin-top: 14px; display: flex; align-items: center; gap: 8px; }
      .muted { color: #6b7280; font-size: 13px; }
    </style>
  </head>
  <body>
    <h1>Fargoings Events</h1>
    <div class="toolbar">
      <input id="search" placeholder="Search title, location, city, source" />
      <button id="searchBtn">Search</button>
      <button id="clearBtn">Clear</button>
    </div>
    <div id="meta" class="meta">Loading…</div>
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Date</th>
          <th>Location</th>
          <th>Source</th>
          <th>Links</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="pagination">
      <button id="prevBtn">Prev</button>
      <button id="nextBtn">Next</button>
      <span id="pageInfo" class="muted"></span>
    </div>

    <script>
      const apiPath = ${JSON.stringify(apiPath)};
      const pageSize = 50;
      let page = 1;
      let query = "";
      let totalPages = 1;

      const rowsEl = document.getElementById('rows');
      const metaEl = document.getElementById('meta');
      const pageInfoEl = document.getElementById('pageInfo');
      const prevBtn = document.getElementById('prevBtn');
      const nextBtn = document.getElementById('nextBtn');
      const searchInput = document.getElementById('search');
      const searchBtn = document.getElementById('searchBtn');
      const clearBtn = document.getElementById('clearBtn');

      function formatDate(date, time) {
        const [year, month, day] = date.split('-');
        const md = Number(month) + '/' + Number(day) + '/' + year;
        if (!time) return md;
        const [h, m] = time.split(':').map(Number);
        const hour = h % 12 || 12;
        const ampm = h < 12 ? 'AM' : 'PM';
        return md + ' ' + hour + ':' + String(m).padStart(2, '0') + ' ' + ampm;
      }

      function renderRows(items) {
        rowsEl.innerHTML = '';
        for (const item of items) {
          const tr = document.createElement('tr');

          const titleTd = document.createElement('td');
          titleTd.textContent = item.title;

          const dateTd = document.createElement('td');
          dateTd.textContent = formatDate(item.date, item.startTime);

          const locationTd = document.createElement('td');
          locationTd.textContent = item.location || 'TBD';

          const sourceTd = document.createElement('td');
          sourceTd.textContent = item.source;

          const linksTd = document.createElement('td');
          linksTd.className = 'links';
          const primary = document.createElement('a');
          primary.href = item.url;
          primary.target = '_blank';
          primary.rel = 'noreferrer noopener';
          primary.textContent = item.url;
          linksTd.appendChild(primary);
          if (item.altUrl) {
            const alt = document.createElement('a');
            alt.href = item.altUrl;
            alt.target = '_blank';
            alt.rel = 'noreferrer noopener';
            alt.textContent = item.altUrl;
            linksTd.appendChild(alt);
          }

          tr.appendChild(titleTd);
          tr.appendChild(dateTd);
          tr.appendChild(locationTd);
          tr.appendChild(sourceTd);
          tr.appendChild(linksTd);
          rowsEl.appendChild(tr);
        }
      }

      async function load() {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (query) params.set('q', query);

        const response = await fetch(apiPath + '?' + params.toString());
        const data = await response.json();

        totalPages = data.totalPages || 1;
        renderRows(data.items || []);

        metaEl.textContent = 'Showing ' + data.items.length + ' of ' + data.total + ' results' + (query ? ' for "' + query + '"' : '');
        pageInfoEl.textContent = 'Page ' + data.page + ' of ' + totalPages;
        prevBtn.disabled = data.page <= 1;
        nextBtn.disabled = data.page >= totalPages;

        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      prevBtn.addEventListener('click', () => {
        if (page > 1) {
          page -= 1;
          load();
        }
      });

      nextBtn.addEventListener('click', () => {
        if (page < totalPages) {
          page += 1;
          load();
        }
      });

      searchBtn.addEventListener('click', () => {
        query = searchInput.value.trim();
        page = 1;
        load();
      });

      clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        query = '';
        page = 1;
        load();
      });

      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          searchBtn.click();
        }
      });

      load();
    </script>
  </body>
</html>`
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
      sendHtml(res, renderPage(BASE_PATH))
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
