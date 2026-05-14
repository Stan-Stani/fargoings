# Implementation Plan

_Last refreshed: 2026-05-14. Current version: v1.1.9._

## Shipped

- **#1 Sort by Time (within day)** — `▲/▼` indicator in the Date header, clickable to toggle `asc/desc`. API param `sort=desc`. Orthogonal category sort kept. (`src/web/main.ts`, `src/web/api.ts`, `src/db/database.ts`)
- **#2 Date Range Selectors** — Presets `today | weekend | week | all` wired via `preset=` query param and `resolveDateRange()` in `src/web/api.ts`. Active button highlighted via `aria-pressed`.
- **#3 Map View** — Leaflet + OSM tiles. `List | Map` toggle, `latitude/longitude` columns added to `display_events` (with `ALTER TABLE` migration in `initialize()`), coords returned in API. _(See open gaps below — partial.)_
- **#4 Venue Links → Google Maps** — Location cell links to `https://maps.google.com/?q=<location, city>`. (Google Reviews piece deferred — see below.)
- **#5 Category Filter Dropdown** — `GET /api/categories`, `category=` param, populated `<select>` with HTML-entity decoding on display.
- **#7 Fix Paradox Comics Location** — `src/enrichment/venues.ts` with `VENUE_RULES`, applied in `rebuildDisplayEvents()` and via `npm run reenrich`. Rules use a narrower `htmlPattern` (e.g., `paradoxcnc.com`) to avoid false matches against unrelated page content.

---

## Open

### A. Map view: load all matching events, not just the loaded page

**Problem:** `renderMap(currentItems)` only shows whatever the list has paged in (default `pageSize=50`). Open the map and you see at most 50 markers regardless of how many events match the current filters. PLAN.md originally specified "loads all matching events (not paginated) up to reasonable limit (e.g., 500)" — never implemented.

**Plan:**
- Add `unpaginated=1` (or `pageSize=500`) fetch in `setViewMode("map")` that requests up to 500 matching events with current filters
- API: bump the `pageSize` cap from 100 to 500 _only_ when the request opts in (avoid changing list defaults)
- Store the map result separately from `currentItems` so paging the list back in `list` mode isn't disrupted
- Show "Showing N markers (M events have no coordinates)" in the map's meta area

### B. Map view: marker clustering

**Problem:** Dense days (Paradox alone often has 3–4 events) stack markers exactly on top of each other — only one is clickable.

**Plan:**
- `npm install leaflet.markercluster @types/leaflet.markercluster`
- Replace the bare `L.layerGroup()` with `L.markerClusterGroup()`
- Tune `maxClusterRadius` (start at 40px) and enable `spiderfyOnMaxZoom` so co-located venues fan out at max zoom

### C. Library Events: Moorhead and West Fargo

**Status:** Fargo Public Library is shipped (`src/fetchers/fargolibrary-org.ts`, hitting `fargond.gov/programdata`). The other two libraries are still missing.

**Plan:**
- **Moorhead Public Library** — inspect `lakeagassiz.com` and `cityofmoorhead.com/library` for an events feed (JSON, iCal, or RSS). Build `src/fetchers/moorheadlibrary-org.ts` following the existing fetcher pattern. ID prefix `mph_`.
- **West Fargo Public Library** — first confirm whether its events already appear via `westfargoevents.com` (the city-wide aggregator). If yes, no fetcher needed; if no, build one. ID prefix `wfpl_`.
- Per `AGENTS.md`: update both `src/index.ts` _and_ `src/refetch.ts` for each new fetcher. Add dedup pairs.

### D. Google Reviews on venue links (decision needed)

Original PLAN deferred this pending an API-key decision. Still deferred. Question to resolve before scoping:

- Are we willing to enable Google Places API (~$17/1k requests, requires billing account)? If not, drop this from the plan entirely and close the loop.
- If yes: fetch `place_id` + rating + review count once per venue, cache in a new `venue_ratings` table keyed by `(location, city)`, refresh weekly. Render a star chip next to the Maps link.

### E. Same-source duplicates (two distinct problems)

**Confirmed live on prod (`fargoings.com`, 2026-05-14):**

1. **Exact-URL repeats** — On Fri 5/15, "Vista & Vines Blues, Jazz, & Wine by the Creekside" appeared **twice** with the identical URL `fargomoorhead.org/event/vista-...-by-the-creekside/4319/`. "Book Sale" same day, same pattern. Direct query against prod `/api/events?q=Vista` showed two rows with **different** `eventId`s (`69f58160…` and `69ff8155…`), `createdAt` identical (same fetch run), and ObjectId-embedded timestamps ~4 days apart — confirming upstream is returning the same logical event with regenerated `_id`s, and our upsert (keyed on `eventId`) can't merge them.

2. **Near-dup reposts** — A poster publishes an event, deletes it, then re-posts with a slightly tweaked title or new slug. The repost gets a fresh `eventId`, so upsert doesn't merge it. Dedup also doesn't catch it: `findMatches()` in `src/index.ts:229–237` is invoked only across source *pairs* (`fargoStored × undergroundStored`, etc.). Same-source self-matching is never run, so within a single source these slip through.

**Plan:**

For (1) — exact-URL repeats: **SHIPPED locally; needs deploy + one-time refetch.**
- `FargoFetcher.transformToStoredEvent()` now derives `eventId` from `sha1(url|date|startTime)` instead of upstream's volatile `_id`. Two upstream docs for the same logical event collapse onto one row via the existing upsert. Different `startTime`s still produce distinct rows, so Paradox's 6:00/6:15/6:30 PM events stay separate.
- Verified locally with `npm start`: zero `(source, url, date, startTime)` groups with >1 row in fargomoorhead.org events. Vista and Book Sale each collapse to a single row.
- **Deploy step:** after the new code lands on the VPS, run `npm run refetch -- --source fargomoorhead.org` once. Existing prod rows still carry the old volatile `_id`-based eventIds; without the refetch they'd linger as orphans alongside the new synthetic-ID rows.

For (2) — same-source near-dups:
- Add same-source passes to the dedup loop: `findMatches(undergroundStored, undergroundStored, 0.85)` and likewise for each source.
- Skip self-pairs in `findMatches` (`if event1.eventId === event2.eventId continue`) and skip already-compared pairs (use a `Set<string>` keyed on `min(id1,id2)|max(id1,id2)`).
- Use a **tighter threshold** for same-source (0.85+ vs. cross-source 0.65). Same venue + same time + same source is common for genuinely distinct events (Paradox runs Magic Modern + Magic Draft + Magic Commander simultaneously, all at 6:15 PM, all at Paradox), so title similarity needs to dominate.
- When matched, keep the row with the more recent `updatedAt` (or higher event ID — assumes monotonic), drop the older. Record the merge in `matches` for audit.

### F. ~~Collapse same-venue events into a single row~~ — SHIPPED 2026-05-14

Client-side grouping in `renderRows()` keyed on `(date, location)`. When ≥3 events share a venue on a date, they render under a single collapsible header showing the venue name, count, and time range (e.g. "Paradox Comics & Games — 4 events · 5:00 PM – 6:30 PM"). Default state is collapsed. Groups of 2 stay as individual rows. Grouping is suppressed when "Category sort within day" is active. Append-only pagination was replaced with a full re-render so group counts stay correct across "Load more"; scroll position is preserved.

---

## Suggested order

1. ~~**E.1 — exact-URL repeats**~~ — shipped 2026-05-14; deploy needs one-time `npm run refetch -- --source fargomoorhead.org`.
2. ~~**E.2 — same-source near-dup detection**~~ — shipped 2026-05-14.
3. ~~**F — collapse same-venue rows**~~ — shipped 2026-05-14.
4. **A — map loads all events** (small, high-impact; map view currently shows only the loaded page)
5. **B — marker clustering** (small, naturally follows A)
6. **C — Moorhead + West Fargo libraries** (research-heavy)
7. **D — Google Reviews decision** (one conversation, not coding work)
