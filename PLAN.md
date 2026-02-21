# Implementation Plan

## 1. Sort by Time (within day)

**Status:** Already implemented in DB query (`ORDER BY date ASC, COALESCE(startTime, '23:59:59') ASC`). No-time events sort last.

**Gap:** No visual indication. Category sort toggle overrides time ordering client-side. The "Date" column combines date+time making it harder to read at a glance.

**Plan:**
- Add sort indicator (▲) to the Date/Time column header on desktop, showing it's sorted ascending
- Make "Date" column header clickable to toggle: time-asc (default) vs. time-desc (pass `sort=desc` API param, DB flips ORDER to DESC)
- Keep category sort as orthogonal. When category sort is on, secondary sort is time within category groups.

---

## 2. Date Range Selectors

**Plan:**
- Add `dateFrom` / `dateTo` query params to `/api/events` and `queryDisplayEvents()`
- Add preset buttons below/beside search bar: **Today | This Weekend | This Month | All**
  - Today: `dateFrom=today&dateTo=today`
  - This Weekend: next or current Sat–Sun
  - This Week: today through the coming Sunday (or end of current week)
  - All: no upper bound (current default behavior)
- Active button gets highlighted style
- Buttons update URL params and reload; persists across page loads via `localStorage`
- Mobile: horizontal scrollable button row

---

## 3. Map View

**Plan:**
- Add `latitude` / `longitude` to `display_events` table (migration via ALTER TABLE IF NOT EXISTS approach in `initialize()`)
- Include coords in `rebuildDisplayEvents()` (pull from source `events` table join)
- Add coords to API response (`DisplayEvent` type + `queryDisplayEvents`)
- Frontend: add **List | Map** toggle button (top-right of toolbar)
- Map powered by **Leaflet.js** + OpenStreetMap (no API key, free):
  - `npm install leaflet @types/leaflet`
  - Render map in a `<div id="map">` that replaces `.table-wrap` when active
  - Markers clustered with `leaflet.markercluster`
  - Clicking a marker → popup with title, formatted date/time, location, link to event
- Events without coords are excluded from map view (show count of excluded)
- Map loads all matching events (not paginated) up to reasonable limit (e.g., 500)

---

## 4. Venue Links + Google Reviews

**Plan:**
- Make the location cell text a **Google Maps search link**: `https://maps.google.com/?q=<encoded location + city>`
- Add a small Google Maps icon/chip next to location (links to same)
- Full embedded Google Reviews (Places API) requires API key + billing — **defer** or make configurable via env var `GOOGLE_PLACES_API_KEY`
  - If key present: fetch place rating/review count server-side, cache in DB, show star rating chip
  - If no key: just the Google Maps link
- This keeps it zero-cost by default

---

## 5. Category Filter Dropdown

**Plan:**
- Add `GET /api/categories` endpoint returning sorted distinct category names from `display_events`
- Add `category` query param to `/api/events`; `queryDisplayEvents()` filters `WHERE categories LIKE ?`
- UI: `<select id="categoryFilter">` below search bar, populated on load from `/api/categories`
  - Default option: "All categories"
  - On change: reset page, reload with filter applied
- Mobile: full-width, same row as or below search group

---

## 6. Library Events

**Fetchers to research + build:**

| Library | Likely URL | Expected Format |
|---------|-----------|-----------------|
| Fargo Public Library | fargolibrary.org | Unknown - need to inspect |
| Moorhead Public Library | ci.moorhead.mn.us or moorheadmn.gov | Unknown |
| West Fargo Public Library | Already covered by westfargoevents.com? | Check if library events appear |

**Plan:**
- Inspect each library's events page to find JSON feed / iCal / RSS / scraping target
- Implement fetcher class per library following existing pattern (`fetchEvents()` + `transformToStoredEvent()`)
- Add each to `src/index.ts` fetcher loop
- IDs prefixed: `fpl_`, `mph_`, `wfpl_` to avoid collisions

---

## 7. Fix Paradox Comics Location

**Problem:** Paradox Comics events come through fargounderground.com with `venue: null`, so `location` is null in the DB even though we know the venue.

**Plan:**
- Add `src/enrichment/venues.ts` with a static known-venues map:
  ```ts
  // title substring → { location, city, latitude, longitude }
  const KNOWN_VENUES = [
    { match: /paradox comics/i, location: "Paradox Comics, 242 Broadway N", city: "Fargo", lat: 46.877, lng: -96.789 }
  ]
  ```
- Run enrichment in `rebuildDisplayEvents()`: for any event where `location IS NULL` and title matches a known venue pattern, backfill location + city + coords
- Alternatively, run enrichment as a post-insert step in `insertEvent()` (simpler, data baked in at write time)
- Chosen approach: **post-insert enrichment in `src/index.ts`** after fetching, before dedup — cleaner separation

---

## Maybe: Collapse Paradox

**Plan (if desired):**
- Add a "Venue grouping" toggle in UI: collapses multiple events at the same venue on the same day into a single expandable row
- Click the venue row to expand and see individual events
- Would primarily benefit Paradox Comics (often 2–4 events per day)
- Implementation: client-side grouping in `renderRows()` based on `location` field

---

## Suggested Implementation Order

1. **#7 Paradox Location** — Quick win, pure backend, no UI changes
2. **#1 Sort by Time** — Visual polish, mostly UI
3. **#5 Category Dropdown** — Small API + UI change, clean improvement
4. **#2 Date Range Selectors** — API + UI, well-scoped
5. **#6 Library Events** — Research-heavy, needs per-library investigation first
6. **#4 Venue Links** — UI change, Google Maps link is easy; reviews optional
7. **#3 Map View** — Largest item, needs new dep (Leaflet), schema migration, frontend work
8. **Maybe: Collapse Paradox** — After #7 is done, see if still needed
