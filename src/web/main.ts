import L from "leaflet"
import { createElement, Moon, SlidersHorizontal, Sun, SunMoon, X } from "lucide"
import { decode } from "he"

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
const showSportsStorageKey = "showSports"
let showSports = localStorage.getItem(showSportsStorageKey) === "1"
let currentItems: EventItem[] = []
let isLoading = false
let viewMode: ViewMode = "list"
let mapInstance: L.Map | null = null
let mapMarkers: L.LayerGroup | null = null

// Same-venue events on the same day get collapsed into a clickable group
// header once this many share a (date, location) so dense venues (e.g.
// Paradox Comics & Games on a Friday) don't dominate the list.
const VENUE_GROUP_THRESHOLD = 3
const expandedVenueGroups = new Set<string>()
const venueGroupRefs = new Map<
  string,
  { header: HTMLTableRowElement; children: HTMLTableRowElement[] }
>()

function getInitialMapView(): { center: L.LatLngExpression; zoom: number } {
  // Desktop feels better slightly zoomed out so Fargo + Moorhead fit comfortably.
  const isDesktop = window.matchMedia("(min-width: 1024px)").matches
  return {
    center: [46.877, -96.789],
    zoom: isDesktop ? 11 : 12,
  }
}

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
const filtersToggleBtnEl = document.getElementById(
  "filtersToggleBtn",
) as HTMLButtonElement | null
const filtersMenuEl = document.getElementById(
  "filtersMenu",
) as HTMLDivElement | null
const filtersCloseBtnEl = document.getElementById(
  "filtersCloseBtn",
) as HTMLButtonElement | null
const tableWrapContainerEl = document.getElementById(
  "tableWrapContainer",
) as HTMLDivElement
const mapContainerEl = document.getElementById("mapContainer") as HTMLDivElement
const categoryFilterEl = document.getElementById(
  "categoryFilter",
) as HTMLSelectElement
const showSportsToggleEl = document.getElementById(
  "showSportsToggle",
) as HTMLInputElement
const themeToggleBtn = document.getElementById(
  "themeToggle",
) as HTMLButtonElement
const themeStorageKey = "themePreference"

filtersCloseBtnEl?.replaceChildren(
  createElement(X, {
    width: 16,
    height: 16,
    "aria-hidden": "true",
    focusable: "false",
  }),
)

filtersToggleBtnEl?.replaceChildren(
  createElement(SlidersHorizontal, {
    width: 16,
    height: 16,
    "aria-hidden": "true",
    focusable: "false",
  }),
)

function hasActiveFilters(): boolean {
  return (
    Boolean(query) ||
    Boolean(categoryFilter) ||
    (datePreset !== "all" && datePreset !== "") ||
    sortByCategoryWithinDay
  )
}

function syncFiltersToggleButtonState(): void {
  if (!filtersToggleBtnEl) return

  const active = hasActiveFilters()
  filtersToggleBtnEl.dataset.activeFilters = active ? "true" : "false"

  const isOpen = filtersMenuEl ? filtersMenuEl.dataset.open !== "false" : false
  const baseLabel = isOpen ? "Close filters" : "Open filters"
  const label = active ? `${baseLabel} (active)` : baseLabel
  filtersToggleBtnEl.setAttribute("aria-label", label)
  filtersToggleBtnEl.title = label
}

function setFiltersMenuOpen(isOpen: boolean): void {
  if (!filtersMenuEl || !filtersToggleBtnEl) return
  filtersMenuEl.dataset.open = isOpen ? "true" : "false"
  filtersToggleBtnEl.setAttribute("aria-expanded", isOpen ? "true" : "false")

  syncFiltersToggleButtonState()
}

function syncFiltersMenuToViewport(): void {
  if (!filtersMenuEl || !filtersToggleBtnEl) return
  const isMobile = window.matchMedia("(max-width: 640px)").matches
  setFiltersMenuOpen(!isMobile)
}

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

if (filtersToggleBtnEl && filtersMenuEl) {
  // Default: closed on mobile, open on desktop.
  syncFiltersMenuToViewport()
  syncFiltersToggleButtonState()

  filtersToggleBtnEl.addEventListener("click", () => {
    const currentlyOpen = filtersMenuEl.dataset.open !== "false"
    setFiltersMenuOpen(!currentlyOpen)
  })

  const mobileMq = window.matchMedia("(max-width: 640px)")
  mobileMq.addEventListener("change", () => {
    // Keep desktop consistent (always open). On mobile we default to closed.
    syncFiltersMenuToViewport()
  })

  filtersCloseBtnEl?.addEventListener("click", () => {
    setFiltersMenuOpen(false)
    filtersToggleBtnEl.focus()
  })

  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    if (filtersMenuEl.dataset.open === "false") return
    setFiltersMenuOpen(false)
    filtersToggleBtnEl.focus()
  })
}

function formatDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  const localDate = new Date(year, month - 1, day)
  const dayOfWeek = localDate.toLocaleDateString(undefined, {
    weekday: "short",
  })
  return `${dayOfWeek}, ${month}/${day}/${year}`
}

function formatTime(time: string | null): string {
  if (!time) return ""
  const [h, m] = time.split(":").map(Number)
  const hour = h % 12 || 12
  const ampm = h < 12 ? "AM" : "PM"
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`
}

function formatDate(date: string, time: string | null): string {
  const t = formatTime(time)
  return t ? `${formatDay(date)} ${t}` : formatDay(date)
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
  const initial = getInitialMapView()
  mapInstance = L.map("mapContainer").setView(initial.center, initial.zoom)
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

  if (mappable.length === 1) {
    const only = mappable[0]
    mapInstance.setView(
      [only.latitude as number, only.longitude as number],
      14,
      { animate: false },
    )
    return
  }

  if (mappable.length > 1) {
    const bounds = L.latLngBounds(
      mappable.map(
        (item) =>
          [item.latitude as number, item.longitude as number] as [
            number,
            number,
          ],
      ),
    )

    mapInstance.fitBounds(bounds, {
      padding: [24, 24],
      maxZoom: 14,
      animate: false,
    })
    return
  }

  const initial = getInitialMapView()
  mapInstance.setView(initial.center, initial.zoom, { animate: false })
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
    // Leaflet needs a size recalculation when the container becomes visible.
    queueMicrotask(() => {
      mapInstance?.invalidateSize()
    })
    // Map view renders markers for whatever the table has already loaded.
    renderMap(currentItems)
  } else {
    mapContainerEl.style.display = "none"
    // Important on mobile: CSS sets #tableWrapContainer to `display: contents` so
    // `.table-wrap` remains the flex child and provides the scrollable region.
    // Forcing `display: block` here breaks scrolling because `body` is
    // `overflow: hidden` on small screens.
    tableWrapContainerEl.style.display = ""
  }

  updateLoadMoreUi()
}

function toggleCategorySortWithinDay(): void {
  sortByCategoryWithinDay = !sortByCategoryWithinDay
  updateCategorySortHeader()
  syncFiltersToggleButtonState()
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

function buildEventRow(item: EventItem): HTMLTableRowElement {
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
  const dayPart = document.createElement("span")
  dayPart.className = "datetime-day"
  dayPart.textContent = formatDay(item.date)
  dateTd.appendChild(dayPart)
  const timeText = formatTime(item.startTime)
  if (timeText) {
    dateTd.appendChild(document.createTextNode(" "))
    const timeEl = document.createElement("span")
    timeEl.className = "datetime-time"
    timeEl.textContent = timeText
    dateTd.appendChild(timeEl)
  }

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
  return tr
}

function venueGroupKey(item: EventItem): string | null {
  if (!item.location) return null
  return `${item.date}|${item.location}`
}

function formatTimeShort(time: string): string {
  const [h, m] = time.split(":").map(Number)
  const hour = h % 12 || 12
  const ampm = h < 12 ? "AM" : "PM"
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`
}

function formatGroupTimeRange(groupItems: EventItem[]): string {
  const times = groupItems
    .map((g) => g.startTime)
    .filter((t): t is string => Boolean(t))
  if (times.length === 0) return ""
  const min = times.reduce((a, b) => (a < b ? a : b))
  const max = times.reduce((a, b) => (a > b ? a : b))
  return min === max
    ? formatTimeShort(min)
    : `${formatTimeShort(min)} – ${formatTimeShort(max)}`
}

// Locations are typically "Venue Name, Street Address". Splitting on the first
// comma lets the header show the venue name bold and the address muted.
function splitVenueLocation(location: string): {
  name: string
  address: string
} {
  const idx = location.indexOf(",")
  if (idx === -1) return { name: location.trim(), address: "" }
  return {
    name: location.slice(0, idx).trim(),
    address: location.slice(idx + 1).trim(),
  }
}

function commonStringPrefix(strings: string[]): string {
  if (strings.length < 2) return ""
  let prefix = strings[0]
  for (const s of strings.slice(1)) {
    let i = 0
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++
    prefix = prefix.slice(0, i)
    if (!prefix) return ""
  }
  return prefix
}

function summarizeGroupTitles(groupItems: EventItem[]): {
  prefix: string
  suffixes: string[]
} {
  const titles = groupItems.map((g) => g.title.trim())
  const raw = commonStringPrefix(titles)
  // Trim trailing separators so the prefix lands on a word boundary.
  const trimmed = raw.replace(/[\s:\-–—,]+$/, "")
  const words = trimmed.split(/\s+/).filter(Boolean)
  // Need ≥2 words and ≥5 chars for the abbreviation to be useful, else fall
  // back to showing full titles without a prefix chip.
  if (trimmed.length < 5 || words.length < 2) {
    return { prefix: "", suffixes: titles }
  }
  const suffixes = titles.map((t) =>
    t.slice(raw.length).replace(/^[\s:\-–—,]+/, "").trim(),
  )
  // Initials from capitalized words ("Friday Night Magic" → "FNM"). Fall back
  // to the full prefix if it doesn't yield ≥2 caps (e.g. "open mic" stays
  // verbatim instead of becoming "om").
  const initials = words
    .filter((w) => /^[A-Z]/.test(w))
    .map((w) => w[0])
    .join("")
  const prefix = initials.length >= 2 ? initials : trimmed
  return { prefix, suffixes }
}

function applyVenueGroupState(key: string): void {
  const refs = venueGroupRefs.get(key)
  if (!refs) return
  const expanded = expandedVenueGroups.has(key)
  refs.header.dataset.expanded = expanded ? "true" : "false"
  refs.header.setAttribute("aria-expanded", expanded ? "true" : "false")
  for (const child of refs.children) {
    child.classList.toggle("venue-group-hidden", !expanded)
  }
}

function toggleVenueGroup(key: string): void {
  if (expandedVenueGroups.has(key)) {
    expandedVenueGroups.delete(key)
  } else {
    expandedVenueGroups.add(key)
  }
  applyVenueGroupState(key)
}

function buildVenueGroupHeader(
  location: string,
  groupItems: EventItem[],
  key: string,
): HTMLTableRowElement {
  const tr = document.createElement("tr")
  tr.className = "venue-group-header"
  tr.tabIndex = 0
  tr.setAttribute("role", "button")
  tr.setAttribute(
    "aria-label",
    `${location}: ${groupItems.length} events. Click to expand.`,
  )

  const td = document.createElement("td")
  td.colSpan = 5

  const headline = document.createElement("div")
  headline.className = "venue-group-headline"

  const chevron = document.createElement("span")
  chevron.className = "venue-group-chevron"
  chevron.setAttribute("aria-hidden", "true")
  chevron.textContent = "▶"
  headline.appendChild(chevron)

  const { name, address } = splitVenueLocation(location)
  const nameEl = document.createElement("span")
  nameEl.className = "venue-group-name"
  nameEl.textContent = name
  headline.appendChild(nameEl)

  if (address) {
    const addressEl = document.createElement("span")
    addressEl.className = "venue-group-address"
    addressEl.textContent = `· ${address}`
    headline.appendChild(addressEl)
  }

  const countPill = document.createElement("span")
  countPill.className = "venue-group-count-pill"
  countPill.textContent = `${groupItems.length} events`
  headline.appendChild(countPill)

  const timeRange = formatGroupTimeRange(groupItems)
  if (timeRange) {
    const timeEl = document.createElement("span")
    timeEl.className = "venue-group-time-range"
    timeEl.textContent = timeRange
    headline.appendChild(timeEl)
  }

  td.appendChild(headline)

  // Salient-contents summary line: list distinctive parts of the event titles,
  // factoring out any common prefix into a small chip.
  const summary = summarizeGroupTitles(groupItems)
  if (summary.suffixes.length > 0) {
    const summaryEl = document.createElement("div")
    summaryEl.className = "venue-group-summary"

    if (summary.prefix) {
      const prefixEl = document.createElement("span")
      prefixEl.className = "venue-group-summary-prefix"
      prefixEl.textContent = summary.prefix
      summaryEl.appendChild(prefixEl)
    }

    const partsEl = document.createElement("span")
    partsEl.className = "venue-group-summary-parts"
    partsEl.textContent = summary.suffixes.join(" · ")
    summaryEl.appendChild(partsEl)

    td.appendChild(summaryEl)
  }

  tr.appendChild(td)

  tr.addEventListener("click", () => toggleVenueGroup(key))
  tr.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      toggleVenueGroup(key)
    }
  })

  return tr
}

function renderRows(items: EventItem[]): void {
  rowsEl.innerHTML = ""
  venueGroupRefs.clear()

  // Pre-pass: count items per (date, location) to identify collapsible groups.
  // Grouping is suppressed while category-sort-within-day is active, since
  // that mode breaks adjacency expectations and the collapse benefit is
  // mostly visual.
  const groupSizes = new Map<string, EventItem[]>()
  if (!sortByCategoryWithinDay) {
    for (const item of items) {
      const k = venueGroupKey(item)
      if (!k) continue
      const arr = groupSizes.get(k) || []
      arr.push(item)
      groupSizes.set(k, arr)
    }
  }

  const collapsibleGroups = new Set<string>()
  for (const [k, arr] of groupSizes) {
    if (arr.length >= VENUE_GROUP_THRESHOLD) collapsibleGroups.add(k)
  }

  const emittedHeaders = new Set<string>()
  let lastDate = ""

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

    const k = venueGroupKey(item)
    if (k && collapsibleGroups.has(k)) {
      // Emit the full group (header + children) on first encounter; skip
      // subsequent items of the same group since they're already rendered.
      if (emittedHeaders.has(k)) continue
      const groupItems = groupSizes.get(k)!
      const header = buildVenueGroupHeader(item.location!, groupItems, k)
      rowsEl.appendChild(header)
      const childRows: HTMLTableRowElement[] = []
      groupItems.forEach((child, idx) => {
        const childTr = buildEventRow(child)
        childTr.classList.add("venue-group-child")
        if (idx === groupItems.length - 1) {
          childTr.classList.add("venue-group-child-last")
        }
        rowsEl.appendChild(childTr)
        childRows.push(childTr)
      })
      venueGroupRefs.set(k, { header, children: childRows })
      applyVenueGroupState(k)
      emittedHeaders.add(k)
    } else {
      rowsEl.appendChild(buildEventRow(item))
    }
  }
}

function updateLoadMoreUi(): void {
  // In map view we hide pagination controls (markers reflect the list's loaded items).
  if (viewMode === "map") {
    loadMoreBtn.style.display = "none"
    loadMoreBtn.disabled = true
    return
  }

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
  if (showSports) params.set("sports", "show")

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

    // Always re-render from the full currentItems set so venue grouping stays
    // consistent across paginated loads. (For 50–500 rows the cost is trivial
    // and the alternative — appending only new rows — would break group
    // headers whose count depends on items spanning multiple pages.)
    const previousScrollTop = tableWrapEl?.scrollTop ?? 0
    if (mode === "replace") {
      currentItems = newItems
    } else {
      currentItems = currentItems.concat(newItems)
    }
    renderRows(sortItemsByCategoryWithinDay(currentItems))
    if (mode === "replace") {
      tableWrapEl?.scrollTo({ top: 0, left: 0, behavior: "auto" })
    } else {
      tableWrapEl?.scrollTo({ top: previousScrollTop, left: 0, behavior: "auto" })
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

    // Keep map markers in sync with the list.
    if (viewMode === "map") {
      renderMap(currentItems)
    }
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
  syncFiltersToggleButtonState()
  page = 1
  load("replace")
})

clearBtn.addEventListener("click", () => {
  searchInput.value = ""
  query = ""
  categoryFilter = ""
  categoryFilterEl.value = ""
  syncFiltersToggleButtonState()
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
  syncFiltersToggleButtonState()
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
  syncFiltersToggleButtonState()
  page = 1
  load("replace")
})

showSportsToggleEl.checked = showSports
showSportsToggleEl.addEventListener("change", () => {
  showSports = showSportsToggleEl.checked
  localStorage.setItem(showSportsStorageKey, showSports ? "1" : "0")
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
      // Keep raw value for filtering (matches DB), but decode for display.
      opt.textContent = decode(cat)
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
