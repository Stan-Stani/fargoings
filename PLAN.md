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

**Status:** Fargo Public Library shipped (`src/fetchers/fargolibrary-org.ts`). **West Fargo Public Library shipped 2026-05-15** (see below). Moorhead still missing.

**West Fargo Public Library — SHIPPED 2026-05-15:**
- Confirmed it is *not* covered by `westfargoevents.com` (queried that aggregator's venue list — no library venue).
- The CivicPlus RSS feed is capped at 10 items. Used the iCal export instead: `westfargolibrary.org/common/modules/iCalendar/iCalendar.aspx?catID=25&feed=calendar` — `catID=25` is the "West Fargo Library" calendar category, so it's already scoped to library programming and returns the full forward range.
- `src/fetchers/westfargolibrary-org.ts` — minimal RFC 5545 parser (line unfolding, VEVENT field extraction). Source id `westfargolibrary.org`, ID prefix `wfpl_${uid}_${date}` (recurring entries reuse one UID across dates, so the date is part of the key or the upsert collapses every occurrence). Local wall-clock times kept as-is (no VPS-tz shift). Closure notices (`LIBRARY CLOSED/CLOSING/OPEN …`) dropped. Wired into `index.ts` + `refetch.ts` (alias `westfargolibrary`/`wfpl`) with dedup pairs + self-match.
- **Prod deployment + the IP-block (resolved 2026-05-15):** West Fargo's server (`207.38.72.44`, shared with westfargond.gov) silently firewalls the VPS's DigitalOcean IP — TCP gets no SYN-ACK; `civicplus.com` itself works from the VPS, so it's West Fargo's own edge ACL, not a CivicPlus datacenter block. Not publicly documented. Cloudflare egress is **not** blocked (verified with a throwaway Worker probe: `{reachable:true,vevents:180}`). Fix shipped: a Cloudflare Worker relay (`infra/wfpl-feed-worker/`, deployed at `wfpl-feed.islaus.workers.dev`, secret-gated) + a `WFPL_ICS_URL` fetcher override (also `WFPL_ICS_FILE` for a local-file fallback). The VPS `/root/fargoings/.env` (gitignored, `chmod 600`) sets `WFPL_ICS_URL=…?key=…`; `index.ts`/`refetch.ts` load dotenv so the weekly `0 5 * * 4 npm start` cron pulls via the relay unattended. Verified live: fargoings.com serves the 10 in-window WFPL events end to end. Durable alternative: have West Fargo IT allowlist `159.203.249.74`, then unset `WFPL_ICS_URL` and delete the Worker.

**Moorhead Public Library — SHIPPED 2026-05-15:**
- Part of Lake Agassiz Regional Library (LARL), Communico/LibNet at `larl.libnet.info`. Reverse-engineered via browser network capture: the SPA calls `eeventcaldata?event_type=0&req=<URL-encoded JSON>` where `req={"private":false,"date":"YYYY-MM-DD","days":N,"locations":[ids],"ages":[],"types":[]}` (the earlier `[]` was from passing `req` as a datetime string). Branch ids come from `api.communico.co/v1/larl/locations`; **Moorhead = `3119`**, so `locations:["3119"]` filters server-side to that one branch. Branch coords (46.873097, -96.771756) set on every event for the map.
- `src/fetchers/moorheadlibrary-org.ts` — source id `larl.org`, ID prefix `mph_${id}` (each recurring occurrence has a unique `id`). Local wall-clock times kept verbatim. Skips `private_event`. Wired into `index.ts` + `refetch.ts` (aliases `moorhead`/`moorheadlibrary`/`mph`) with dedup pairs + self-match.
- **WAF/IP block:** `larl.libnet.info`'s AWS WAF/ALB (`server: awselb/2.0`) 403s the VPS's DigitalOcean IP on the API endpoint (the `/events` HTML page is reachable; residential IPs get 200 — IP-class block). Fixed with a second Cloudflare Worker relay `infra/larl-feed-worker/` (deployed `larl-feed.islaus.workers.dev`, secret-gated, forwards the querystring since `req` is dynamic) + `MPH_EVENTS_URL` fetcher override in the VPS `.env`. Verified live: fargoings.com serves the 18 in-window Moorhead events end to end via the relay; weekly `npm start` cron uses it unattended.

**PLAN item C is now fully complete** (Fargo + West Fargo + Moorhead public libraries all shipped).

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

## Roadmap (set 2026-05-15)

Sequenced. A/B (map polish) and D (Google Reviews key decision) are now
backlog — pick them up opportunistically, not as the headline.

### Phase 1 — Marquee venue coverage (the real product value)

We're now fast at new fetchers (Tribe, CivicPlus, Communico, CF relays for
blocked hosts). Platform scouting done 2026-05-15 — ranked by known effort:

- **Drekker Brewing** — The Events Calendar (Tribe) REST at
  `drekkerbrewing.com/wp-json/tribe/events/v1/events`. Reuses
  `fetchTribeEvents` in `shared.ts` — ~trivial, do first. (Returned 0 events
  the day scouted; confirm it populates when they have events.)
- **Sanctuary Events Center** + **Fargo Brewing** — Squarespace. Squarespace
  collections expose JSON (`?format=json` was HTML on the root — need the
  right collection path). One new pattern, then both are cheap.
- **FargoDome** + **Fargo Force** — Ticketmaster-backed. Ticketmaster
  Discovery API (free key, by venue id) is clean → same kind of "enable an
  API key?" decision as D. Decide once, covers both.
- **Plains Art Museum** — WordPress but NOT Tribe (`rest_no_route`); identify
  its events plugin/endpoint. Moderate.
- **NDSU / MSUM / Concordia** — campus calendars; platform not yet ID'd
  (guessed Localist subdomains 404'd). Research each; likely Localist/Trumba
  with clean JSON once found. High volume when landed.
- **FM RedHawks** (American Association, indie — no MiLB API; Squarespace
  site), **Fargo Theatre** (406'd our UA — needs real-UA/scrape; ticketing
  likely Spektrix/Agile), **Red River Zoo**, **Fargo Park District** —
  unknown platforms; scout + scope individually.

Per `AGENTS.md`: every new fetcher touches `index.ts` _and_ `refetch.ts`
(+ dedup pairs, alias, optional venue enrichment & coords for the map).

### Phase 2 — Discovery / SEO

Crawlable per-event pages (own route, not just outbound links) +
`schema.org/Event` JSON-LD + `sitemap.xml`. Goal: fargoings surfaces in
Google event results / "things to do in Fargo" searches.

### Phase 3 — Stickiness

Per-event "Add to Calendar" (Google + `.ics`); a fargoings-owned
iCal/RSS feed users can subscribe to (we consume these — now emit one);
auto-generated "This weekend in Fargo" digest page, optional Bluesky/Reddit
post from the weekly cron.

### Phase 4 — Reliability / health

Per-source health: row count + last-success per fetcher; alert when a
source errors or returns 0 (the West Fargo / LARL blocks failed silently —
that must page us, not rot). Parser regression tests so upstream HTML/JSON
shape changes are caught before a deploy.

### Backlog (unscheduled)

- **A — map loads all matching events** (currently only the loaded page).
- **B — map marker clustering** (follows A).
- **D — Google Reviews** on venue links — needs the Places API-key decision;
  fold into the Phase 1 Ticketmaster "enable a paid/keyed API?" call.
