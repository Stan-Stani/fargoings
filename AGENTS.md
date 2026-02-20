# Agent Notes

## Adding a new event source

When adding a new fetcher, changes are required in **two separate files** — both must stay in sync:

| File | What to add |
|------|-------------|
| `src/index.ts` | Import, instantiate, fetch block, dedup pairs |
| `src/refetch.ts` | Same — import, instantiate, `deleteEventsBySource`, fetch block, dedup pairs |

`refetch.ts` is a standalone script (not derived from `index.ts`) and will silently skip any source that isn't explicitly listed in it. Forgetting to update it means `npm run refetch` leaves stale data from that source in the DB.

Also update `src/enrichment/venues.ts` if the new source produces events with inferable-but-missing venue data.
