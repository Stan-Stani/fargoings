# Implementation Plan

_Last refreshed: 2026-06-09. Current version: v1.1.34._

## Shipped

- **Reliability/perf round (2026-06-09):**
  - **Fetcher registry** — `src/fetchers/sources.ts` (pure data: ids, aliases, sports flag, dedup priority) + `src/fetchers/registry.ts` (fetch closures, shared `runSource`, generated dedup pairs). `index.ts`, `refetch.ts`, and `dedup.ts` all iterate it; the old "update two files in sync" failure mode is gone. Cross-source pairs are now generated for ALL non-sports pairs (a few previously-missing pairs like downtownfargo×fargolibrary are now covered).
  - **Per-source health** — every run records to `source_runs`; `GET /api/health/sources` returns per-source status with an `ok` boolean (point an uptime monitor at it, keyword `"ok":true`). `npm start` prints `HEALTH SUMMARY:` and exits 1 when a source is flagged (last run failed, ≥2 consecutive failures, or 0 events after recently returning more) — the silent WFPL/LARL relay-death scenario now alerts via cron mail + the endpoint.
  - **DB** — `PRAGMA user_version` migrations; WAL + busy_timeout; `rebuildDisplayEvents()` is one SQL `INSERT…SELECT` (was a full-table JS pass) and only keeps today-or-future rows; `display_events.category` precomputed at rebuild (API no longer JSON-parses/decodes per request); HTML entities decoded once at store time (one-time migration decoded existing rows).
  - **Item A (map loads all matching events)** — dedicated slim `GET /api/events/map` (cap 1000, marker fields only, out-of-region junk coords nulled); map view fetches it separately from list pagination; meta shows "N markers (M without coordinates)".
  - **Item B (marker clustering)** — leaflet.markercluster (`maxClusterRadius: 40`, spiderfy at max zoom), cluster colors restyled via theme variables.
  - **Item E hardening** — same-source matcher: identical-URL fast path (querystring KEPT — Sidearm/CivicPlus key events by query params), >30-min time-difference guard before fuzzy scoring, and sports sources are URL-identity-only (fixes the "doubleheaders self-dedupe" known minor; fuzzy can't tell a doubleheader from a repost).
  - **Frontend error state** — failed loads render an error row + Retry (15s fetch timeout); failed "Load more" keeps existing rows.
  - **Deploy smoke test** — deploy now fails if `/api/events` serves zero events (lost/empty DB), and prints `/api/health/sources` informationally.

- **#1 Sort by Time (within day)** — `▲/▼` indicator in the Date header, clickable to toggle `asc/desc`. API param `sort=desc`. Orthogonal category sort kept. (`src/web/main.ts`, `src/web/api.ts`, `src/db/database.ts`)
- **#2 Date Range Selectors** — Presets `today | weekend | week | all` wired via `preset=` query param and `resolveDateRange()` in `src/web/api.ts`. Active button highlighted via `aria-pressed`.
- **#3 Map View** — Leaflet + OSM tiles. `List | Map` toggle, `latitude/longitude` columns added to `display_events` (with `ALTER TABLE` migration in `initialize()`), coords returned in API. _(See open gaps below — partial.)_
- **#4 Venue Links → Google Maps** — Location cell links to `https://maps.google.com/?q=<location, city>`. (Google Reviews piece deferred — see below.)
- **#5 Category Filter Dropdown** — `GET /api/categories`, `category=` param, populated `<select>` with HTML-entity decoding on display.
- **#7 Fix Paradox Comics Location** — `src/enrichment/venues.ts` with `VENUE_RULES`, applied in `rebuildDisplayEvents()` and via `npm run reenrich`. Rules use a narrower `htmlPattern` (e.g., `paradoxcnc.com`) to avoid false matches against unrelated page content.

---

## Open

### A. ~~Map view: load all matching events~~ — SHIPPED 2026-06-09

Dedicated `GET /api/events/map` (slim marker fields, cap 1000) fetched separately from list pagination; invalidated on filter changes. Meta line shows "N markers (M events without coordinates)". Out-of-region coordinates (e.g. virtual events upstream-geocoded to the US centroid in Colorado) are treated as unmappable so they can't blow up the map bounds.

### B. ~~Map view: marker clustering~~ — SHIPPED 2026-06-09

`L.markerClusterGroup({ maxClusterRadius: 40, spiderfyOnMaxZoom: true })`; cluster icons restyled with the theme CSS variables (the `.leaflet-container` prefix outranks the bundled default CSS, which loads after the inline block).

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

For (2) — same-source near-dups: **SHIPPED** (`findSelfMatches` at 0.85, wired for all sources), **hardened 2026-06-09**:
- Identical-URL fast path: same normalized URL (host lowercased, fragment/trailing-slash stripped, **querystring kept** — Sidearm `calendar.aspx?game_id=…` and CivicPlus `event-detail?id=…` key events entirely by query params; stripping it merged Women's Golf with Softball) ⇒ high-confidence match regardless of title drift.
- Time guard: both events having start times >30 min apart ⇒ never a repost, skip before fuzzy scoring.
- Sports sources are URL-identity-only (no fuzzy pass) — fixes the "same-day doubleheaders self-dedupe" known minor; a doubleheader and a repost are indistinguishable to fuzzy scoring (near-identical title/venue/time).
- Fuzzy threshold stays at 0.85; revisit 0.80 only after observing prod (false merges are worse than residual dupes).

### F. ~~Collapse same-venue events into a single row~~ — SHIPPED 2026-05-14

Client-side grouping in `renderRows()` keyed on `(date, location)`. When ≥3 events share a venue on a date, they render under a single collapsible header showing the venue name, count, and time range (e.g. "Paradox Comics & Games — 4 events · 5:00 PM – 6:30 PM"). Default state is collapsed. Groups of 2 stay as individual rows. Grouping is suppressed when "Category sort within day" is active. Append-only pagination was replaced with a full re-render so group counts stay correct across "Load more"; scroll position is preserved.

---

## Roadmap (set 2026-05-15)

Sequenced. A/B (map polish) and D (Google Reviews key decision) are now
backlog — pick them up opportunistically, not as the headline.

### Phase 1 — Marquee venue coverage (the real product value)

We're now fast at new fetchers (Tribe, CivicPlus, Communico, CF relays for
blocked hosts). Platform scouting done 2026-05-15 — ranked by known effort:

- ✅ **Drekker Brewing** — SHIPPED 2026-05-15 (`drekkerbrewing-com.ts`,
  Tribe REST via `fetchTribeEvents`). 0 events in-window at ship; auto-
  populates. Code on `main`; rides next VPS deploy.
- ✅ **NDSU + MSUM athletics — SHIPPED 2026-05-15.**
  `src/fetchers/sidearm-sports.ts` (`SidearmSportsFetcher`, RSS at
  `<base>/calendar.ashx/calendar.rss`), configured for `gobison.com` (NDSU,
  85) + `msumdragons.com` (MSUM, 61). Every event tagged a `Sports`
  category; `SPORTS_SOURCES` in `database.ts` is excluded from
  `queryDisplayEvents` by default. `?sports=show` (API) ↔ persisted
  "Show sports" checkbox (web, localStorage) opts in. UTC→Central handled;
  `[L|A|N]` marker optional in titles (away games omit it). Self-match only.
  **Known minor:** same-day doubleheaders can self-dedupe (distinct
  game_ids but near-identical title/time). Concordia (`cobbers.com`) is
  NOT Sidearm (404) — separate scope.
- **FargoDome** + **Fargo Force** — Ticketmaster-backed. Ticketmaster
  Discovery API (free key, by venue id) → "enable an API key?" decision,
  same call as D (Google Reviews). **Needs user decision before build.**
- **Plains Art Museum** — WordPress but NOT Tribe (`rest_no_route`); identify
  its events plugin/endpoint. Moderate.
- **Concordia** campus + athletics, **NDSU/MSUM academic** calendars —
  platforms still unidentified; research when convenient (high volume).
- **Fargo Theatre** (406'd our UA — real-UA/scrape; ticketing likely
  Spektrix/Agile), **Red River Zoo**, **Fargo Park District** — unknown
  platforms; scout + scope individually.
- ❌ **Dropped:** Sanctuary Events Center (wedding/corporate venue — no
  public event feed) and Fargo Brewing (business closing; site expired).

Per `AGENTS.md`: a new fetcher is one entry in `src/fetchers/sources.ts` +
one fetch closure in `src/fetchers/registry.ts` (dedup pairs, aliases, and
the index/refetch wiring are generated from the registry). Optional: venue
enrichment & coords for the map.

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

✅ **Per-source health SHIPPED 2026-06-09**: `source_runs` table,
`/api/health/sources` (`ok` boolean for keyword monitors), `HEALTH SUMMARY`
+ nonzero exit from the weekly cron when a source is flagged. **Remaining
action:** point an external uptime monitor (e.g. UptimeRobot keyword match
on `"ok":true`) at `https://fargoings.com/api/health/sources`.
Still open: parser regression tests so upstream HTML/JSON shape changes are
caught before a deploy.

### Backlog (unscheduled)

- **D — Google Reviews** on venue links — needs the Places API-key decision;
  fold into the Phase 1 Ticketmaster "enable a paid/keyed API?" call.
