import { EventDatabase } from "../src/db/database"
import { FetchedEvent } from "../src/cities/types"

/** A local YYYY-MM-DD, `days` from today in Fargo. */
export function dayFromToday(days = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
  }).format(new Date())
  const [y, m, d] = today.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

let nextId = 1

/** A stored-event shape with defaults, overridable per test. */
export function event(overrides: Partial<FetchedEvent> = {}): FetchedEvent {
  const date = overrides.date ?? dayFromToday(1)
  return {
    eventId: `test_${nextId++}`,
    title: "Test Event",
    url: `https://example.com/${nextId}`,
    location: "Somewhere, 1 Main Ave, Fargo, ND 58102",
    date,
    startTime: "18:00:00",
    startDate: date,
    endDate: date,
    latitude: null,
    longitude: null,
    city: "Fargo",
    imageUrl: null,
    categories: "[]",
    source: "fargomoorhead.org",
    ...overrides,
  }
}

export function tags(...names: string[]): string {
  return JSON.stringify(names.map((catName) => ({ catName })))
}

/** An in-memory database holding these events, already rebuilt for display. */
export function dbWith(events: FetchedEvent[]): EventDatabase {
  const db = new EventDatabase(":memory:")
  for (const row of events) db.insertEvent(row)
  db.rebuildDisplayEvents()
  return db
}

/** Everything the API would serve, with nothing hidden or collapsed. */
export function allRows(db: EventDatabase) {
  return db.queryDisplayEvents("", 1000, 0, "asc", "", "", "", true, false, true)
    .rows
}
