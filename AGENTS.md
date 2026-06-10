# Agent Notes

## Adding a new event source

All sources live in a single registry — `index.ts` and `refetch.ts` both iterate it, so they cannot drift apart:

| File | What to add |
|------|-------------|
| `src/fetchers/sources.ts` | One `SourceInfo` entry: source id, CLI aliases, `sports` flag, `dedupPriority` (lower priority = dropped side on a cross-source duplicate match) |
| `src/fetchers/registry.ts` | One fetch closure in `FETCH_FNS` (instantiate the fetcher lazily so env overrides are read after dotenv loads) |

Cross-source dedup pairs and per-source self-matching are generated from the registry automatically. Also update `src/enrichment/venues.ts` if the new source produces events with inferable-but-missing venue data.

## Health monitoring

Every fetch/refetch records a row in `source_runs` (status, event count, duration). `GET /api/health/sources` reports per-source health with an overall `ok` boolean (always HTTP 200 — point external monitors at it with a keyword match on `"ok":true`). `/health` stays a pure liveness probe used by the deploy smoke test.

`npm start` (the weekly cron entry point) prints a greppable `HEALTH SUMMARY:` line and **exits nonzero when any source is flagged** (last run failed, ≥2 consecutive failures, or returned 0 events after recently returning more). Data from healthy sources is already committed by then — the nonzero exit is purely the cron's alert signal, not a fatal error.

## Database migrations

`src/db/database.ts` runs one-shot migrations keyed on `PRAGMA user_version` (see `runMigrations()`). Add a new `if (version < N)` block and bump the pragma inside the transaction. The first process to open the DB after a deploy applies them.
