import { createElement, Moon, Sun, SunMoon } from "lucide"

type EventItem = {
  title: string
  date: string
  startTime: string | null
  location: string | null
  categories: string | null
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

type ThemePreference = "auto" | "light" | "dark"

declare const __APP_VERSION__: string

const apiPath = "/api/events"
const pageSize = 50
let page = 1
let query = ""
let totalPages = 1
let sortByCategoryWithinDay = false
let currentItems: EventItem[] = []

const rowsEl = document.getElementById("rows") as HTMLTableSectionElement
const metaEl = document.getElementById("meta") as HTMLDivElement
const pageInfoEl = document.getElementById("pageInfo") as HTMLSpanElement
const prevBtn = document.getElementById("prevBtn") as HTMLButtonElement
const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement
const searchInput = document.getElementById("search") as HTMLInputElement
const searchBtn = document.getElementById("searchBtn") as HTMLButtonElement
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement
const categorySortHeaderEl = document.getElementById(
  "categorySortHeader",
) as HTMLTableCellElement
const versionBadgeEl = document.getElementById("versionBadge") as HTMLDivElement
const tableWrapEl = document.querySelector(
  ".table-wrap",
) as HTMLDivElement | null
const themeToggleBtn = document.getElementById(
  "themeToggle",
) as HTMLButtonElement
const themeStorageKey = "themePreference"

function getStoredThemePreference(): ThemePreference {
  const stored = localStorage.getItem(themeStorageKey)
  if (stored === "light" || stored === "dark" || stored === "auto") {
    return stored
  }
  return "auto"
}

function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement
  if (preference === "auto") {
    root.removeAttribute("data-theme")
  } else {
    root.setAttribute("data-theme", preference)
  }
}

function setThemeToggleLabel(preference: ThemePreference): void {
  const icon =
    preference === "auto" ? SunMoon : preference === "dark" ? Moon : Sun
  const label =
    preference === "auto"
      ? "Theme: Auto (system)"
      : preference === "dark"
        ? "Theme: Dark"
        : "Theme: Light"

  themeToggleBtn.replaceChildren(
    createElement(icon, {
      width: 16,
      height: 16,
      "aria-hidden": "true",
      focusable: "false",
    }),
  )

  themeToggleBtn.setAttribute("aria-label", label)
  themeToggleBtn.title = label
}

function setThemePreference(preference: ThemePreference): void {
  localStorage.setItem(themeStorageKey, preference)
  applyThemePreference(preference)
  setThemeToggleLabel(preference)
}

function cycleThemePreference(current: ThemePreference): ThemePreference {
  if (current === "auto") return "dark"
  if (current === "dark") return "light"
  return "auto"
}

versionBadgeEl.textContent = `v${__APP_VERSION__}`

let themePreference = getStoredThemePreference()
applyThemePreference(themePreference)
setThemeToggleLabel(themePreference)

themeToggleBtn.addEventListener("click", () => {
  themePreference = cycleThemePreference(themePreference)
  setThemePreference(themePreference)
})

function formatDate(date: string, time: string | null): string {
  const [year, month, day] = date.split("-")
  const md = Number(month) + "/" + Number(day) + "/" + year
  if (!time) return md
  const [h, m] = time.split(":").map(Number)
  const hour = h % 12 || 12
  const ampm = h < 12 ? "AM" : "PM"
  return md + " " + hour + ":" + String(m).padStart(2, "0") + " " + ampm
}

function formatDayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  const localDate = new Date(year, month - 1, day)
  return localDate.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function formatCategory(categoriesRaw: string | null): string {
  return categoriesRaw || "N/A"
}

function updateCategorySortHeader(): void {
  if (sortByCategoryWithinDay) {
    categorySortHeaderEl.textContent = "Category (A→Z)"
    categorySortHeaderEl.title =
      "Sorted by category within each day. Click to restore default order."
    categorySortHeaderEl.setAttribute("aria-sort", "ascending")
  } else {
    categorySortHeaderEl.textContent = "Category"
    categorySortHeaderEl.title =
      "Default order. Click to sort within each day by category (A→Z)."
    categorySortHeaderEl.setAttribute("aria-sort", "none")
  }
}

function toggleCategorySortWithinDay(): void {
  sortByCategoryWithinDay = !sortByCategoryWithinDay
  updateCategorySortHeader()
  renderRows(sortItemsByCategoryWithinDay(currentItems))
}

function sortItemsByCategoryWithinDay(items: EventItem[]): EventItem[] {
  if (!sortByCategoryWithinDay) {
    return items
  }

  const sorted: EventItem[] = []
  let currentDate = ""
  let currentGroup: EventItem[] = []

  const flushGroup = () => {
    if (currentGroup.length === 0) {
      return
    }

    currentGroup.sort((a, b) => {
      const categoryA = formatCategory(a.categories)
      const categoryB = formatCategory(b.categories)
      return categoryA.localeCompare(categoryB, undefined, {
        sensitivity: "base",
      })
    })

    sorted.push(...currentGroup)
    currentGroup = []
  }

  for (const item of items) {
    if (item.date !== currentDate) {
      flushGroup()
      currentDate = item.date
    }
    currentGroup.push(item)
  }

  flushGroup()
  return sorted
}

function renderRows(items: EventItem[]): void {
  rowsEl.innerHTML = ""
  let lastDate = ""

  for (const item of items) {
    if (item.date !== lastDate) {
      const dayMarkerRow = document.createElement("tr")
      dayMarkerRow.className = "day-marker"

      const dayMarkerCell = document.createElement("td")
      dayMarkerCell.colSpan = 6
      dayMarkerCell.textContent = formatDayLabel(item.date)

      dayMarkerRow.appendChild(dayMarkerCell)
      rowsEl.appendChild(dayMarkerRow)
      lastDate = item.date
    }

    const tr = document.createElement("tr")

    const titleTd = document.createElement("td")
    titleTd.textContent = item.title

    const dateTd = document.createElement("td")
    dateTd.textContent = formatDate(item.date, item.startTime)

    const locationTd = document.createElement("td")
    locationTd.textContent = item.location || "N/A"

    const categoryTd = document.createElement("td")
    categoryTd.textContent = formatCategory(item.categories)

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
    tr.appendChild(categoryTd)
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
  currentItems = data.items || []

  totalPages = data.totalPages || 1
  renderRows(sortItemsByCategoryWithinDay(currentItems))

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

  tableWrapEl?.scrollTo({ top: 0, left: 0, behavior: "auto" })
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

categorySortHeaderEl.addEventListener("click", () => {
  toggleCategorySortWithinDay()
})

categorySortHeaderEl.tabIndex = 0
categorySortHeaderEl.setAttribute("role", "button")
categorySortHeaderEl.setAttribute(
  "aria-label",
  "Toggle category sorting within each day",
)
categorySortHeaderEl.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault()
    toggleCategorySortWithinDay()
  }
})

updateCategorySortHeader()

load()
