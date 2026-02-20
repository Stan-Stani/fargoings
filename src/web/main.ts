import { createElement, Moon, Sun, SunMoon } from "lucide"
import L from "leaflet"

type EventItem = {
  title: string
  date: string
  startTime: string | null
  location: string | null
  city: string | null
  categories: string | null
  source: string
  url: string
  altUrl: string | null
  latitude: number | null
  longitude: number | null
}

type ViewMode = "list" | "map"

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
let categoryFilter = ""
let datePreset = "all"
let totalPages = 1
let hasMore = false
let sortByCategoryWithinDay = false
let timeSortDir: "asc" | "desc" = "asc"
let currentItems: EventItem[] = []
let allItemsForMap: EventItem[] = []
let lastRenderedDate = ""
let isLoading = false
let viewMode: ViewMode = "list"
let mapInstance: L.Map | null = null
let mapMarkers: L.LayerGroup | null = null

const rowsEl = document.getElementById("rows") as HTMLTableSectionElement
const metaEl = document.getElementById("meta") as HTMLDivElement
const loadMoreBtn = document.getElementById("loadMoreBtn") as HTMLButtonElement
const searchInput = document.getElementById("search") as HTMLInputElement
const searchBtn = document.getElementById("searchBtn") as HTMLButtonElement
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement
const dateSortHeaderEl = document.getElementById(
  "dateSortHeader",
) as HTMLTableCellElement
const categorySortHeaderEl = document.getElementById(
  "categorySortHeader",
) as HTMLTableCellElement
const mobileCategorySortBtnEl = document.getElementById(
  "mobileCategorySortBtn",
) as HTMLButtonElement | null
const versionBadgeEl = document.getElementById("versionBadge") as HTMLDivElement
const tableWrapEl = document.querySelector(
  ".table-wrap",
) as HTMLDivElement | null
const viewToggleBtn = document.getElementById(
  "viewToggleBtn",
) as HTMLButtonElement
const tableWrapContainerEl = document.getElementById(
  "tableWrapContainer",
) as HTMLDivElement
const mapContainerEl = document.getElementById(
  "mapContainer",
) as HTMLDivElement
const categoryFilterEl = document.getElementById(
  "categoryFilter",
) as HTMLSelectElement
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
  const [year, month, day] = date.split("-").map(Number)
  const localDate = new Date(year, month - 1, day)
  const dayOfWeek = localDate.toLocaleDateString(undefined, {
    weekday: "short",
  })
  const md = month + "/" + day + "/" + year
  if (!time) return `${dayOfWeek}, ${md}`
  const [h, m] = time.split(":").map(Number)
  const hour = h % 12 || 12
  const ampm = h < 12 ? "AM" : "PM"
  return (
    `${dayOfWeek}, ${md}` +
    " " +
    hour +
    ":" +
    String(m).padStart(2, "0") +
    " " +
    ampm
  )
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

function getHostFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function formatSourceHostLabel(host: string): string {
  return host.replace(/^www\./i, "")
}

function isMobileCardLayoutActive(): boolean {
  return window.matchMedia("(max-width: 640px)").matches
}

function createSourceChip(url: string, label: string): HTMLAnchorElement {
  const sourceChip = document.createElement("a")
  sourceChip.className = "source-chip"
  sourceChip.href = url
  sourceChip.target = "_blank"
  sourceChip.rel = "noreferrer noopener"
  sourceChip.title = url

  const faviconDomain = label.includes(".") ? label : getHostFromUrl(url)
  const sourceFavicon = document.createElement("img")
  sourceFavicon.className = "source-favicon"
  sourceFavicon.src = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(faviconDomain)}`
  sourceFavicon.alt = ""
  sourceFavicon.loading = "lazy"
  sourceFavicon.decoding = "async"
  sourceFavicon.setAttribute("aria-hidden", "true")

  const sourceLabel = document.createElement("span")
  sourceLabel.textContent = label

  sourceChip.appendChild(sourceFavicon)
  sourceChip.appendChild(sourceLabel)

  return sourceChip
}

function createSourceIconLink(url: string, source?: string): HTMLAnchorElement {
  const sourceIconLink = document.createElement("a")
  sourceIconLink.className = "source-icon-link"
  sourceIconLink.href = url
  sourceIconLink.target = "_blank"
  sourceIconLink.rel = "noreferrer noopener"
  const faviconDomain =
    source && source.includes(".") ? source : getHostFromUrl(url)
  sourceIconLink.title = formatSourceHostLabel(faviconDomain)
  sourceIconLink.setAttribute(
    "aria-label",
    `Open source: ${sourceIconLink.title}`,
  )

  const sourceFavicon = document.createElement("img")
  sourceFavicon.className = "source-favicon"
  sourceFavicon.src = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(faviconDomain)}`
  sourceFavicon.alt = ""
  sourceFavicon.loading = "lazy"
  sourceFavicon.decoding = "async"
  sourceFavicon.setAttribute("aria-hidden", "true")

  sourceIconLink.appendChild(sourceFavicon)
  return sourceIconLink
}

function updateCategorySortHeader(): void {
  if (sortByCategoryWithinDay) {
    categorySortHeaderEl.textContent = "Category (A→Z)"
    categorySortHeaderEl.title =
      "Sorted by category within each day. Click to restore default order."
    categorySortHeaderEl.setAttribute("aria-sort", "ascending")
    if (mobileCategorySortBtnEl) {
      mobileCategorySortBtnEl.textContent = "Category sort: On (A→Z)"
      mobileCategorySortBtnEl.title =
        "Sorted by category within each day. Tap to restore default order."
      mobileCategorySortBtnEl.setAttribute("aria-pressed", "true")
    }
  } else {
    categorySortHeaderEl.textContent = "Category"
    categorySortHeaderEl.title =
      "Default order. Click to sort within each day by category (A→Z)."
    categorySortHeaderEl.setAttribute("aria-sort", "none")
    if (mobileCategorySortBtnEl) {
      mobileCategorySortBtnEl.textContent = "Category sort: Off"
      mobileCategorySortBtnEl.title =
        "Default order. Tap to sort within each day by category (A→Z)."
      mobileCategorySortBtnEl.setAttribute("aria-pressed", "false")
    }
  }
}

function updateDateSortHeader(): void {
  const indicator = timeSortDir === "asc" ? "▲" : "▼"
  const dirLabel = timeSortDir === "asc" ? "oldest first" : "newest first"
  dateSortHeaderEl.textContent = `Date ${indicator}`
  dateSortHeaderEl.title = `Sorted by time (${dirLabel}). Click to reverse.`
  dateSortHeaderEl.setAttribute(
    "aria-sort",
    timeSortDir === "asc" ? "ascending" : "descending",
  )
}

function toggleTimeSort(): void {
  timeSortDir = timeSortDir === "asc" ? "desc" : "asc"
  updateDateSortHeader()
  page = 1
  load("replace")
}

function initMap(): void {
  if (mapInstance) return
  mapInstance = L.map("mapContainer").setView([46.877, -96.789], 12)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(mapInstance)
  mapMarkers = L.layerGroup().addTo(mapInstance)
}

function renderMap(items: EventItem[]): void {
  if (!mapInstance || !mapMarkers) return
  mapMarkers.clearLayers()

  const mappable = items.filter(
    (item) => item.latitude != null && item.longitude != null,
  )

  for (const item of mappable) {
    const lat = item.latitude as number
    const lng = item.longitude as number
    const dateStr = formatDate(item.date, item.startTime)
    const popup = `
      <strong>${item.title}</strong><br>
      ${dateStr}<br>
      ${item.location ? `${item.location}<br>` : ""}
      <a href="${item.url}" target="_blank" rel="noreferrer noopener">View event</a>
    `
    L.marker([lat, lng]).bindPopup(popup).addTo(mapMarkers)
  }

  if (mappable.length > 0 && mapInstance) {
    const group = L.featureGroup(
      mappable.map((item) =>
        L.marker([item.latitude as number, item.longitude as number]),
      ),
    )
    mapInstance.fitBounds(group.getBounds().pad(0.1))
  }
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode
  viewToggleBtn.textContent = mode === "list" ? "Map view" : "List view"
  viewToggleBtn.setAttribute(
    "aria-label",
    mode === "list" ? "Switch to map view" : "Switch to list view",
  )

  if (mode === "map") {
    tableWrapContainerEl.style.display = "none"
    mapContainerEl.style.display = "block"
    initMap()
    // Fetch all items (unpaginated) for map
    loadAllForMap()
  } else {
    mapContainerEl.style.display = "none"
    tableWrapContainerEl.style.display = "block"
  }
}

async function loadAllForMap(): Promise<void> {
  const params = new URLSearchParams({
    page: "1",
    pageSize: "500",
    sort: timeSortDir,
  })
  if (query) params.set("q", query)
  if (categoryFilter) params.set("category", categoryFilter)
  if (datePreset && datePreset !== "all") params.set("preset", datePreset)

  try {
    const response = await fetch(apiPath + "?" + params.toString())
    if (!response.ok) return
    const data = (await response.json()) as EventsResponse
    allItemsForMap = data.items || []
    renderMap(allItemsForMap)
  } catch {
    // map stays empty
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

function renderRows(items: EventItem[], options?: { append?: boolean }): void {
  const append = options?.append ?? false
  if (!append) {
    rowsEl.innerHTML = ""
    lastRenderedDate = ""
  }

  let lastDate = append ? lastRenderedDate : ""

  for (const item of items) {
    if (item.date !== lastDate) {
      const dayMarkerRow = document.createElement("tr")
      dayMarkerRow.className = "day-marker"

      const dayMarkerCell = document.createElement("td")
      dayMarkerCell.colSpan = 5
      dayMarkerCell.textContent = formatDayLabel(item.date)

      dayMarkerRow.appendChild(dayMarkerCell)
      rowsEl.appendChild(dayMarkerRow)
      lastDate = item.date
    }

    const tr = document.createElement("tr")
    tr.className = "event-row"
    tr.tabIndex = 0
    tr.setAttribute("role", "link")
    tr.setAttribute("aria-label", `Open event: ${item.title}`)

    const navigateToEvent = () => {
      if (!isMobileCardLayoutActive()) {
        return
      }
      window.open(item.url, "_blank", "noopener,noreferrer")
    }

    tr.addEventListener("click", (event: MouseEvent) => {
      const targetElement = event.target as Element | null
      if (targetElement?.closest("a")) {
        return
      }
      navigateToEvent()
    })

    tr.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        navigateToEvent()
      }
    })

    const titleTd = document.createElement("td")
    titleTd.setAttribute("data-label", "Title")
    titleTd.className = "title-cell"
    const titleText = document.createElement("span")
    titleText.className = "event-title"
    titleText.textContent = item.title
    titleTd.appendChild(titleText)

    const dateTd = document.createElement("td")
    dateTd.setAttribute("data-label", "Date")
    dateTd.className = "datetime-cell"
    dateTd.textContent = formatDate(item.date, item.startTime)

    const locationTd = document.createElement("td")
    locationTd.setAttribute("data-label", "Location")
    locationTd.className = "location-cell"
    if (item.location) {
      const mapsQuery = encodeURIComponent(
        item.city ? `${item.location}, ${item.city}` : item.location,
      )
      const locationLink = document.createElement("a")
      locationLink.href = `https://maps.google.com/?q=${mapsQuery}`
      locationLink.target = "_blank"
      locationLink.rel = "noreferrer noopener"
      locationLink.textContent = item.location
      locationLink.className = "location-link"
      locationTd.appendChild(locationLink)
    } else {
      locationTd.textContent = "N/A"
    }

    const categoryTd = document.createElement("td")
    categoryTd.setAttribute("data-label", "Category")
    categoryTd.className = "category-cell"

    const categoryInline = document.createElement("div")
    categoryInline.className = "category-inline"

    const categoryPill = document.createElement("span")
    categoryPill.className = "category-pill"
    categoryPill.textContent = formatCategory(item.categories)
    categoryInline.appendChild(categoryPill)

    const sourceIconsInline = document.createElement("div")
    sourceIconsInline.className = "source-icons-inline"
    sourceIconsInline.appendChild(createSourceIconLink(item.url, item.source))
    if (item.altUrl) {
      sourceIconsInline.appendChild(createSourceIconLink(item.altUrl))
    }
    categoryInline.appendChild(sourceIconsInline)

    categoryTd.appendChild(categoryInline)

    const sourceTd = document.createElement("td")
    sourceTd.setAttribute("data-label", "Source")
    sourceTd.className = "source-cell"
    const sourceList = document.createElement("div")
    sourceList.className = "source-list"

    sourceList.appendChild(createSourceChip(item.url, item.source))

    if (item.altUrl) {
      const altSourceLabel = formatSourceHostLabel(getHostFromUrl(item.altUrl))
      sourceList.appendChild(createSourceChip(item.altUrl, altSourceLabel))
    }

    const sourceMeta = document.createElement("div")
    sourceMeta.className = "source-meta"
    sourceMeta.textContent = formatSourceHostLabel(getHostFromUrl(item.url))

    sourceTd.appendChild(sourceList)
    sourceTd.appendChild(sourceMeta)

    tr.appendChild(titleTd)
    tr.appendChild(dateTd)
    tr.appendChild(locationTd)
    tr.appendChild(categoryTd)
    tr.appendChild(sourceTd)
    rowsEl.appendChild(tr)
  }

  lastRenderedDate = lastDate
}

function updateLoadMoreUi(): void {
  loadMoreBtn.style.display = hasMore ? "" : "none"
  loadMoreBtn.disabled = !hasMore || isLoading
}

async function load(mode: "replace" | "append" = "replace"): Promise<void> {
  if (isLoading) {
    return
  }

  isLoading = true
  updateLoadMoreUi()

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sort: timeSortDir,
  })
  if (query) params.set("q", query)
  if (categoryFilter) params.set("category", categoryFilter)
  if (datePreset && datePreset !== "all") params.set("preset", datePreset)

  try {
    const response = await fetch(apiPath + "?" + params.toString())
    if (!response.ok) {
      const bodyPreview = (await response.text()).slice(0, 200)
      throw new Error(
        `HTTP ${response.status} ${response.statusText}: ${bodyPreview}`,
      )
    }

    const data = (await response.json()) as EventsResponse
    const newItems = data.items || []

    page = data.page || page
    totalPages = data.totalPages || 1

    if (mode === "replace") {
      currentItems = newItems
      renderRows(sortItemsByCategoryWithinDay(currentItems))
      tableWrapEl?.scrollTo({ top: 0, left: 0, behavior: "auto" })
    } else {
      currentItems = currentItems.concat(newItems)
      if (sortByCategoryWithinDay) {
        renderRows(sortItemsByCategoryWithinDay(currentItems))
      } else {
        renderRows(newItems, { append: true })
      }
    }

    metaEl.textContent =
      "Showing " +
      currentItems.length +
      " of " +
      data.total +
      " results" +
      (query ? ' for "' + query + '"' : "")

    hasMore =
      page < totalPages &&
      currentItems.length < data.total &&
      newItems.length > 0
  } catch (error) {
    metaEl.textContent =
      "Error loading events. " +
      (error instanceof Error ? error.message : String(error))
    console.error("❌ Failed to load events:", error)
  } finally {
    isLoading = false
    updateLoadMoreUi()
  }
}

loadMoreBtn.addEventListener("click", () => {
  if (!hasMore) {
    return
  }
  page += 1
  load("append")
})

searchBtn.addEventListener("click", () => {
  query = searchInput.value.trim()
  page = 1
  load("replace")
})

clearBtn.addEventListener("click", () => {
  searchInput.value = ""
  query = ""
  categoryFilter = ""
  categoryFilterEl.value = ""
  page = 1
  load("replace")
})

searchInput.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter") {
    searchBtn.click()
  }
})

dateSortHeaderEl.tabIndex = 0
dateSortHeaderEl.setAttribute("role", "button")
dateSortHeaderEl.setAttribute("aria-label", "Toggle time sort direction")
dateSortHeaderEl.addEventListener("click", () => {
  toggleTimeSort()
})
dateSortHeaderEl.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault()
    toggleTimeSort()
  }
})

categorySortHeaderEl.addEventListener("click", () => {
  toggleCategorySortWithinDay()
})

mobileCategorySortBtnEl?.addEventListener("click", () => {
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

const presetBtns = document.querySelectorAll<HTMLButtonElement>(
  ".preset-btn[data-preset]",
)

function setDatePreset(preset: string): void {
  datePreset = preset
  presetBtns.forEach((btn) => {
    btn.setAttribute(
      "aria-pressed",
      btn.dataset.preset === preset ? "true" : "false",
    )
  })
  page = 1
  load("replace")
}

presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    setDatePreset(btn.dataset.preset ?? "all")
  })
})

categoryFilterEl.addEventListener("change", () => {
  categoryFilter = categoryFilterEl.value
  page = 1
  load("replace")
})

async function populateCategoryFilter(): Promise<void> {
  try {
    const res = await fetch("/api/categories")
    if (!res.ok) return
    const data = (await res.json()) as { categories: string[] }
    for (const cat of data.categories) {
      const opt = document.createElement("option")
      opt.value = cat
      opt.textContent = cat
      categoryFilterEl.appendChild(opt)
    }
  } catch {
    // non-critical; filter just stays as "All categories"
  }
}

viewToggleBtn.addEventListener("click", () => {
  setViewMode(viewMode === "list" ? "map" : "list")
})

updateCategorySortHeader()
updateDateSortHeader()

populateCategoryFilter()
load("replace")
