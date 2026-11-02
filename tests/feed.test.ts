import assert from "node:assert/strict"
import { test } from "node:test"
import { EventDatabase } from "../src/db/database"
import { LOCATION_SEE_LINK, venueRuleMatches } from "../src/enrichment/venues"
import { FARGO_VENUE_RULES } from "../src/cities/fargo/venues"
import { allRows, dayFromToday, dbWith, event, tags } from "./helpers"

const query = (
  db: EventDatabase,
  options: { q?: string; category?: string; sports?: boolean } = {},
) =>
  db.queryDisplayEvents(
    options.q ?? "",
    1000,
    0,
    "asc",
    options.category ?? "",
    "",
    "",
    options.sports ?? false,
    true,
    true,
  ).rows

const titles = (rows: { title: string }[]) => rows.map((row) => row.title)

test("an event titled with an earlier year is held, and reported", () => {
  // Early-year dates get a grace period, so pin this one late in a future year.
  const date = `${dayFromToday(370).slice(0, 4)}-11-02`
  const title = `${Number(date.slice(0, 4)) - 2} Fall Baccalaureate`
  const db = dbWith([
    event({ title, date, endDate: date, startDate: date }),
    event({ title: "Keeper" }),
  ])
  assert.deepEqual(titles(query(db)), ["Keeper"])
  const { heldForReview } = db.getDataQualityReport()
  assert.equal(heldForReview.length, 1)
  assert.equal(heldForReview[0].title, title)
  db.close()
})

test("the report lists missing venues, except Fargo Parks", () => {
  const db = dbWith([
    event({ title: "Super Massive Black Holes", location: null }),
    event({ title: "Parks Thing", location: null, source: "fargoparks.com" }),
    event({ title: "Has A Venue" }),
  ])
  const { missingLocation } = db.getDataQualityReport()
  assert.deepEqual(titles(missingLocation), ["Super Massive Black Holes"])
  db.close()
})

test("sports and start dates are hidden until asked for", () => {
  const db = dbWith([
    event({ title: "Concordia Football", categories: tags("Sports & Outdoors") }),
    event({ title: "Winter Volleyball League Starts" }),
    event({ title: "Pumpkin Patch", categories: tags("Sports & Outdoors") }),
    event({ title: "Trivia Night" }),
  ])
  assert.deepEqual(titles(query(db)).sort(), ["Pumpkin Patch", "Trivia Night"])
  assert.ok(titles(query(db, { sports: true })).includes("Concordia Football"))
  assert.ok(!titles(query(db, { sports: true })).includes("Winter Volleyball League Starts"))
  assert.deepEqual(titles(query(db, { category: "Sports" })), ["Concordia Football"])
  assert.deepEqual(titles(query(db, { category: "Programs & Registration" })), [
    "Winter Volleyball League Starts",
  ])
  assert.deepEqual(titles(query(db, { q: "volleyball" })), [
    "Winter Volleyball League Starts",
  ])
  db.close()
})

test("the category filter matches the label, with old links still working", () => {
  const db = dbWith([
    event({ title: "Jazz Night", categories: tags("Culture & Heritage", "Jazz & Blues") }),
    event({ title: "History Talk", categories: tags("Culture & Heritage") }),
  ])
  assert.deepEqual(titles(query(db, { category: "Culture & Heritage" })), ["History Talk"])
  assert.deepEqual(titles(query(db, { category: "Live Music" })), ["Jazz Night"])
  assert.deepEqual(titles(query(db, { category: "Jazz & Blues" })), ["Jazz Night"])
  db.close()
})

test("a merged row's tags carry over to a survivor with none", () => {
  const db = new EventDatabase(":memory:")
  const dropped = event({ title: "Charcuterie Night", categories: tags("Food & Drink") })
  const kept = event({ title: "Charcuterie Night", source: "downtownfargo.com" })
  db.insertEvent(dropped)
  db.insertEvent(kept)
  db.insertMatch({
    eventId1: dropped.eventId,
    eventId2: kept.eventId,
    score: 0.95,
    confidence: "high",
    reasons: [],
  })
  db.rebuildDisplayEvents()
  const rows = allRows(db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].eventId, kept.eventId)
  assert.equal(rows[0].category, "Food & Drink")
  assert.equal(rows[0].altUrl, dropped.url)
  db.close()
})

const onDays = (title: string, offsets: number[], extra = {}) =>
  offsets.map((offset) => {
    const date = dayFromToday(offset)
    return event({ title, date, startDate: date, endDate: date, source: "fargounderground.com", ...extra })
  })

test("an exhibit listed every open day collapses to one row per view", () => {
  const db = dbWith(
    onDays("Damnatio Memoriae", [0, 1, 2], {
      location: "NDSU Memorial Union Gallery, NDSU Campus, Fargo, ND 58102",
      startTime: "09:00:00",
    }),
  )
  const rows = query(db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].recurringCadence, "daily")
  assert.equal(rows[0].ongoingThrough, dayFromToday(2))
  assert.equal(allRows(db).length, 3, "every date stays available")
  db.close()
})

test("a daily run reaching the end of the fetch window gets no end date", () => {
  const db = dbWith(
    onDays("Long Show", Array.from({ length: 14 }, (_, i) => i), {
      location: "Some Gallery, 1 Main Ave, Fargo, ND 58102",
    }),
  )
  const [row] = query(db)
  assert.equal(row.recurringCadence, "daily")
  assert.equal(row.ongoingThrough, null)
  db.close()
})

test("three nights of a comedian stay three shows", () => {
  const db = dbWith(onDays("Comedy in the Cellar - Bo Johnson", [1, 2, 3]))
  assert.equal(query(db).length, 3)
  db.close()
})

test("a single row spanning days reads as ongoing; a late show doesn't", () => {
  const start = dayFromToday(1)
  const db = dbWith([
    event({ title: "Dual Exhibition", date: start, startDate: start, endDate: dayFromToday(90) }),
    event({ title: "Late Show", date: start, startDate: start, endDate: dayFromToday(2) }),
  ])
  const byTitle = new Map(query(db).map((row) => [row.title, row]))
  assert.equal(byTitle.get("Dual Exhibition")?.ongoingThrough, dayFromToday(90))
  assert.equal(byTitle.get("Late Show")?.ongoingThrough, null)
  db.close()
})

test("a run that started earlier shows today, if the source still lists it", () => {
  const opened = dayFromToday(-3)
  const db = new EventDatabase(":memory:")
  db.recordSourceRun({
    source: "fargounderground.com",
    runType: "fetch",
    status: "ok",
    eventCount: 1,
    durationMs: 1,
    errorMessage: null,
    startedAt: "2000-01-01 00:00:00",
  })
  db.insertEvent(
    event({
      title: "All of Us Creatures",
      date: opened,
      startDate: opened,
      endDate: dayFromToday(50),
      startTime: null,
      source: "fargounderground.com",
    }),
  )
  db.rebuildDisplayEvents()
  const [row] = query(db)
  assert.equal(row.date, dayFromToday())
  assert.equal(row.ongoingThrough, dayFromToday(50))

  // The source's next fetch fails: nothing confirms the run is still on.
  db.recordSourceRun({
    source: "fargounderground.com",
    runType: "fetch",
    status: "error",
    eventCount: null,
    durationMs: 1,
    errorMessage: "HTTP 406",
    startedAt: "2000-01-02 00:00:00",
  })
  db.rebuildDisplayEvents()
  assert.equal(query(db).length, 0)
  db.close()
})

test("spellings of a venue reach one canonical location", () => {
  const spellings: Array<[string, string]> = [
    ["Front Street Taproom", "Front Street Taproom, 614 Main Ave, Fargo, ND 58103"],
    ["Front Street Taproom, 614 Main Ave, Fargo, ND 58102", "Front Street Taproom, 614 Main Ave, Fargo, ND 58103"],
    ["Front Street Taproom, 614 Main Avenue, Fargo, ND 58103", "Front Street Taproom, 614 Main Ave, Fargo, ND 58103"],
    ["SIdestreet Grille & Pub, 404 4th ave N, Fargo, ND 58102", "Sidestreet Grille & Pub, 404 4th Ave N, Fargo, ND 58102"],
    ["The Cellar below Front Street Taproom", "The Cellar Comedy Club, 614 Main Ave, Fargo, ND 58103"],
    ["Brewhalla Market", "Brewhalla, 1702 1st Ave N, Fargo, ND 58102"],
    ["Drekker Brewing Company, 1666 1st Ave N, Brewhalla, Fargo, ND 58102", "Drekker Brewing Company, 1666 1st Ave N, Fargo, ND 58102"],
    ["The Sandbox", "The Sandbox, 3147 Bluestem Dr, West Fargo, ND 58078"],
    ["The Sandbox, Bluestem Drive, Fargo, ND 58103", "The Sandbox, 3147 Bluestem Dr, West Fargo, ND 58078"],
    ["Gallery 4", "Gallery 4, 115 Roberts St N, Fargo, ND 58102"],
    ["The 1889 Fargo, 602 Main Avenue, Fargo, ND 58103", "The 1889, 602 Main Ave, Fargo, ND 58103"],
    ["Moorhead Public Library, 118 5th St S, Moorhead, MN 56560", "Moorhead Public Library, 450 Center Ave, Moorhead, MN 56560"],
    ["Bridges 167, 700 11th St S, Moorhead, MN 56560", "MSUM Planetarium, Bridges Hall 167, 700 11th St S, Moorhead, MN 56563"],
  ]
  for (const [spelling, canonical] of spellings) {
    const rule = FARGO_VENUE_RULES.find((r) =>
      venueRuleMatches(r, "Some Event", spelling),
    )
    assert.equal(rule?.location, canonical, spelling)
  }
})

test("a location-only venue name in a title doesn't move the event", () => {
  const db = new EventDatabase(":memory:")
  db.insertEvent(event({ title: "Bus Tour to Front Street Taproom", location: "City Hall, 225 4th St N, Fargo, ND 58102" }))
  db.enrichVenueLocations()
  db.rebuildDisplayEvents()
  assert.equal(allRows(db)[0].location, "City Hall, 225 4th St N, Fargo, ND 58102")
  db.close()
})

test("the see-link marker isn't a place", () => {
  assert.ok(
    !FARGO_VENUE_RULES.some((r) => venueRuleMatches(r, "x", LOCATION_SEE_LINK)),
  )
})

test("normalization happens at store time", () => {
  const db = dbWith([
    event({
      title: "FARGO BOARD GAMERS",
      location: "The Cellar Comedy Club 614 Main Avenue Fargo, ND 58103-1912",
    }),
  ])
  const [row] = allRows(db)
  assert.equal(row.title, "Fargo Board Gamers")
  assert.equal(row.location, "The Cellar Comedy Club, 614 Main Avenue, Fargo, ND 58103")
  db.close()
})
