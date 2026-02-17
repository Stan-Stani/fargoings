type EventItem = {
  title: string
  date: string
  startTime: string | null
  location: string | null
  source: string
  url: string
  altUrl: string | null
}

type EventsResponse = {
  items: EventItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const apiPath = "/api/events"
const pageSize = 50
let page = 1
let query = ""
let totalPages = 1

const rowsEl = document.getElementById("rows") as HTMLTableSectionElement
const metaEl = document.getElementById("meta") as HTMLDivElement
const pageInfoEl = document.getElementById("pageInfo") as HTMLSpanElement
const prevBtn = document.getElementById("prevBtn") as HTMLButtonElement
const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement
const searchInput = document.getElementById("search") as HTMLInputElement
const searchBtn = document.getElementById("searchBtn") as HTMLButtonElement
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement

function formatDate(date: string, time: string | null): string {
  const [year, month, day] = date.split("-")
  const md = Number(month) + "/" + Number(day) + "/" + year
  if (!time) return md
  const [h, m] = time.split(":").map(Number)
  const hour = h % 12 || 12
  const ampm = h < 12 ? "AM" : "PM"
  return md + " " + hour + ":" + String(m).padStart(2, "0") + " " + ampm
}

function renderRows(items: EventItem[]): void {
  rowsEl.innerHTML = ""
  for (const item of items) {
    const tr = document.createElement("tr")

    const titleTd = document.createElement("td")
    titleTd.textContent = item.title

    const dateTd = document.createElement("td")
    dateTd.textContent = formatDate(item.date, item.startTime)

    const locationTd = document.createElement("td")
    locationTd.textContent = item.location || "N/A"

    const sourceTd = document.createElement("td")
    sourceTd.textContent = item.source

    const linksTd = document.createElement("td")
    linksTd.className = "links"
    const primary = document.createElement("a")
    primary.href = item.url
    primary.target = "_blank"
    primary.rel = "noreferrer noopener"
    primary.textContent = item.url
    linksTd.appendChild(primary)
    if (item.altUrl) {
      const alt = document.createElement("a")
      alt.href = item.altUrl
      alt.target = "_blank"
      alt.rel = "noreferrer noopener"
      alt.textContent = item.altUrl
      linksTd.appendChild(alt)
    }

    tr.appendChild(titleTd)
    tr.appendChild(dateTd)
    tr.appendChild(locationTd)
    tr.appendChild(sourceTd)
    tr.appendChild(linksTd)
    rowsEl.appendChild(tr)
  }
}

async function load(): Promise<void> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })
  if (query) params.set("q", query)

  const response = await fetch(apiPath + "?" + params.toString())
  const data = (await response.json()) as EventsResponse

  totalPages = data.totalPages || 1
  renderRows(data.items || [])

  metaEl.textContent =
    "Showing " +
    data.items.length +
    " of " +
    data.total +
    " results" +
    (query ? ' for "' + query + '"' : "")
  pageInfoEl.textContent = "Page " + data.page + " of " + totalPages
  prevBtn.disabled = data.page <= 1
  nextBtn.disabled = data.page >= totalPages

  document.querySelector("h1")?.scrollIntoView()
}

prevBtn.addEventListener("click", () => {
  if (page > 1) {
    page -= 1
    load()
  }
})

nextBtn.addEventListener("click", () => {
  if (page < totalPages) {
    page += 1
    load()
  }
})

searchBtn.addEventListener("click", () => {
  query = searchInput.value.trim()
  page = 1
  load()
})

clearBtn.addEventListener("click", () => {
  searchInput.value = ""
  query = ""
  page = 1
  load()
})

searchInput.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter") {
    searchBtn.click()
  }
})

load()
