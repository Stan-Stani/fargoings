# Agent Notes

## City modules

The codebase is multi-city: every deployment serves ONE city, selected by the
`CITY` env var (default `fargo` — the existing Fargo deploy needs no env
changes). `src/cities/index.ts#getActiveCity()` resolves it once and throws on
unknown values; it also loads dotenv itself so CLI scripts that never imported
dotenv still pick up a `.env` CITY.

A city module is one directory under `src/cities/<id>/`:

| File | Contents |
|------|----------|
| `config.ts` | `CityConfig`: branding, timezone, map center/zoom, region bounding box (map junk filter), db path, source metadata. Pure data — db/web modules import this without pulling in the scraping stack. |
| `sources.ts` | `SourceInfo[]` (see "Adding a new event source") |
| `fetchers.ts` | Fetch closures keyed by source id (the scraping stack — only `fetchers/registry.ts` reaches this, via `cities/fetchers.ts`) |
| `venues.ts` | `VenueRule[]` for venue canonicalization/backfill |

Cities: `fargo` (db `./events.db`) and `siouxfalls` ("SooGoings", db
`./events-siouxfalls.db`). `src/fetchers/sources.ts` is a back-compat shim
re-exporting the active city's metadata. The frontend gets branding/map config
at runtime from `GET /api/config` (one build artifact serves any city;
index.html's static strings are the Fargo fallback).

Two instances can share one box: set distinct `API_PORT` and `WEB_PORT` (vite
dev/preview port) per checkout, and `cd` into the right checkout in cron.

## Adding a new event source

All sources live in a single per-city registry — `index.ts` and `refetch.ts`
both iterate it, so they cannot drift apart:

| File | What to add |
|------|-------------|
| `src/cities/<city>/sources.ts` | One `SourceInfo` entry: source id, CLI aliases, `sports` flag, `dedupPriority` (lower priority = dropped side on a cross-source duplicate match) |
| `src/cities/<city>/fetchers.ts` | One fetch closure (instantiate the fetcher lazily so env overrides are read after dotenv loads) |

Cross-source dedup pairs and per-source self-matching are generated from the registry automatically. Also update `src/cities/<city>/venues.ts` if the new source produces events with inferable-but-missing venue data.

Check the config-driven platform fetchers before writing a new class — most
sites run one of these: `tribe-rest.ts` (WordPress The Events Calendar),
`simpleview.ts` (Simpleview CVB/arena sites, token + rest_v2),
`communico.ts` (LibNet library calendars), `sidearm-sports.ts` (college/junior
athletics RSS).

## Health monitoring

Every fetch/refetch records a row in `source_runs` (status, event count, duration). `GET /api/health/sources` reports per-source health with an overall `ok` boolean (always HTTP 200 — point external monitors at it with a keyword match on `"ok":true`). `/health` stays a pure liveness probe used by the deploy smoke test.

`npm start` (the weekly cron entry point) prints a greppable `HEALTH SUMMARY:` line and **exits nonzero when any source is flagged** (last run failed, ≥2 consecutive failures, or returned 0 events after recently returning more). Data from healthy sources is already committed by then — the nonzero exit is purely the cron's alert signal, not a fatal error.

## Database migrations

`src/db/database.ts` runs one-shot migrations keyed on `PRAGMA user_version` (see `runMigrations()`). Add a new `if (version < N)` block and bump the pragma inside the transaction. The first process to open the DB after a deploy applies them.
