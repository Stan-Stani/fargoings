import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { buildLocation, FargoFetcher } from "../src/fetchers/fargomoorhead-com"
import {
  categoryFromProgramPath,
  FargoParksEvent,
  FargoParksFetcher,
  parseOccurrencePage,
} from "../src/fetchers/fargoparks-com"
import { FargoUndergroundFetcher } from "../src/fetchers/fargounderground-com"
import { LOCATION_SEE_LINK } from "../src/enrichment/venues"
import { FargoEvent } from "../src/types/event"
import { dayFromToday } from "./helpers"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const simpleview = (overrides: Partial<FargoEvent>): FargoEvent =>
  ({
    title: "An Event",
    url: "/event/an-event/1/",
    date: "2026-11-08T05:59:59.000Z",
    startDate: "2026-11-08T06:00:00.000Z",
    endDate: "2026-11-09T05:59:59.000Z",
    recurType: 0,
    categories: [],
    ...overrides,
  }) as FargoEvent

test("buildLocation finds the Black Holes talk's venue in the address fields", () => {
  assert.equal(
    buildLocation(
      simpleview({
        address1: "700 11th St S Moorhead, MN 56560",
        address2: "Bridges 167",
        city: "Moorhead",
        state: "MN",
        zip: "56560",
      }),
    ),
    "Bridges 167, 700 11th St S Moorhead, MN 56560",
  )
})

test("buildLocation adds the address to a bare venue name", () => {
  assert.equal(
    buildLocation(
      simpleview({
        location: "Olive Street",
        address1: "835 23rd Ave E",
        address2: "Suite 205",
        city: "West Fargo",
        state: "ND",
        zip: "58078",
      }),
    ),
    "Olive Street, 835 23rd Ave E Suite 205, West Fargo, ND 58078",
  )
})

test("buildLocation doesn't mangle odd address fields", () => {
  // A name that is already a full address
  assert.equal(
    buildLocation(
      simpleview({
        location: "Creative Kitchen 3902 13th Ave SW Fargo, ND",
        address1: "3902 13th Ave SW",
        city: "Fargo",
        state: "ND",
      }),
    ),
    "Creative Kitchen 3902 13th Ave SW Fargo, ND",
  )
  // address1 with no street in it
  assert.equal(
    buildLocation(
      simpleview({
        location: "Challey Hall",
        address1: "NDSU Challey Hall",
        city: "Fargo",
        state: "ND",
      }),
    ),
    "Challey Hall",
  )
  assert.equal(buildLocation(simpleview({})), null)
})

test("Simpleview: season listings get their time from the description", () => {
  const fetcher = new FargoFetcher()
  const row = fetcher.transformToStoredEvent(
    simpleview({
      title: "Concordia Football",
      recurType: 99,
      description: "Home Games Nov 7 (Sat) / 12 pm vs Macalester",
      date: "2026-11-08T05:59:59.000Z",
    }),
  )
  assert.equal(row.date, "2026-11-07")
  assert.equal(row.startTime, "12:00:00")
})

test("Simpleview: only a daily recurrence is a multi-day run", () => {
  const fetcher = new FargoFetcher()
  const span = {
    date: "2026-11-03T05:59:59.000Z",
    endDate: "2027-02-01T05:59:59.000Z",
  }
  assert.equal(
    fetcher.transformToStoredEvent(simpleview({ ...span, recurType: 1 })).endDate,
    "2027-01-31",
  )
  for (const recurType of [0, 3, 5, 99]) {
    const row = fetcher.transformToStoredEvent(simpleview({ ...span, recurType }))
    assert.equal(row.endDate, row.date, `recurType ${recurType}`)
  }
})

const OCCURRENCE_PAGE = `
  <h1 class="site">Fargo Parks</h1>
  <h1 class="page-title">
    <span>Stay Active and Independent for Life (SAIL)</span>
  </h1>
  <div class="field field--name-field-facility field--type-entity-reference field--label-above">
    <div class="field--label">Location</div>
    <div class="field--items">
      <div class="field--item">
        <a href="https://www.fargoparkssportscenter.com/">Fargo Parks &amp; Sports Center</a>
      </div>
    </div>
  </div>`

test("Fargo Parks: occurrence page gives the real title and facility", () => {
  assert.deepEqual(parseOccurrencePage(OCCURRENCE_PAGE), {
    title: "Stay Active and Independent for Life (SAIL)",
    facility: "Fargo Parks & Sports Center",
  })
  assert.deepEqual(parseOccurrencePage("<html><h1>All Day Thing</h1></html>"), {
    title: "All Day Thing",
    facility: null,
  })
})

test("Fargo Parks: section paths map to categories", () => {
  const cases: Array<[string, string | null]> = [
    ["/adult-60-programs/active-agers", "Seniors"],
    ["/adult-55-programs/sail", "Seniors"],
    ["/adult-programs/active-agers", "Seniors"],
    ["/youth-programs/ice-skating", "Youth & Family"],
    ["/youth-programs/volleyball", "Sports"],
    ["/adult-programs/volleyball", "Sports"],
    ["/events-and-deadlines/drop-hockey/drop-novice-hockey", "Sports"],
    ["/adult-programs/arts-culture", "Arts & Crafts"],
    ["/adult-programs/nature-outdoors", "Outdoors & Recreation"],
    ["/park-board/meeting/november-10-2026", "Public Meetings"],
    ["/events-and-deadlines/firefly-night", "Community"],
    ["/something-new/entirely", null],
  ]
  for (const [path, expected] of cases) {
    assert.equal(categoryFromProgramPath(path), expected, path)
  }
})

const parksEvent = (overrides: Partial<FargoParksEvent>): FargoParksEvent => ({
  title: "Pilates",
  category: "Fargo Park Event & Programs",
  start: "2026-11-05T09:00:00",
  end: "2026-11-05T10:00:00",
  viewNode: "/events-and-deadlines/dates/pilates",
  programPath: "/adult-60-programs/active-agers",
  facility: "Fargo Parks Sports Center",
  ...overrides,
})

test("Fargo Parks: links and identity don't use the shared section URL", () => {
  const fetcher = new FargoParksFetcher()
  const pilates = fetcher.transformToStoredEvent(parksEvent({}))
  const stretch = fetcher.transformToStoredEvent(
    parksEvent({
      title: "Strength, Balance, and Stretch",
      viewNode: "/events-and-deadlines/dates/strength-balance-and-stretch",
    }),
  )
  assert.equal(pilates.url, "https://www.fargoparks.com/events-and-deadlines/dates/pilates")
  assert.notEqual(pilates.url, stretch.url)
  assert.notEqual(pilates.eventId, stretch.eventId)
  assert.equal(pilates.location, "Fargo Parks Sports Center")
})

test("Fargo Parks: an all-day entry with no facility says so", () => {
  const row = new FargoParksFetcher().transformToStoredEvent(
    parksEvent({
      title: "Ice Skating, Session 2 Start Date",
      start: "2026-11-02T00:00:00",
      end: "2026-11-02T23:59:00",
      viewNode: "/events-and-deadlines/dates/ice-skating-session-2",
      programPath: "/youth-programs/ice-skating",
      facility: null,
    }),
  )
  assert.equal(row.location, LOCATION_SEE_LINK)
  assert.equal(row.startTime, null)
})

test("Fargo Parks: a page that won't load costs only its own details", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes("calendar-events-2")) {
      return new Response(
        JSON.stringify([
          {
            field_color: "Fargo Park Event &amp; Programs",
            start: "2026-11-05T09:00:00",
            end: "2026-11-05T10:00:00",
            view_node: "/events-and-deadlines/dates/broken-page",
            view_node_1: "/adult-60-programs/active-agers",
          },
          {
            field_color: "Deadlines",
            start: "2026-11-05T09:00:00",
            view_node: "/events-and-deadlines/dates/a-deadline",
          },
        ]),
      )
    }
    return new Response("nope", { status: 404 })
  }) as typeof fetch

  const events = await new FargoParksFetcher().fetchEvents(14)
  assert.equal(events.length, 1, "deadline dropped")
  assert.equal(events[0].title, "Broken Page")
  assert.equal(events[0].facility, null)
})

const toIcal = (date: string, uid: string) =>
  `BEGIN:VEVENT\r\nUID:${uid}@fargounderground.com\r\nDTSTART;TZID=America/Chicago:${date.replace(/-/g, "")}T180000\r\nDTEND;TZID=America/Chicago:${date.replace(/-/g, "")}T190000\r\nSUMMARY:Event ${uid}\r\nEND:VEVENT\r\n`

test("Fargo Underground: walks past the iCal export's 30-event cap", async () => {
  const requested: string[] = []
  // 10 events a day, capped at 30 per export, starting at the requested date.
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const start = url.searchParams.get("tribe-bar-date")!
    requested.push(start)
    const offset = Math.round(
      (Date.parse(start) - Date.parse(dayFromToday())) / 86_400_000,
    )
    let body = "BEGIN:VCALENDAR\r\n"
    let count = 0
    for (let day = offset; day <= 20 && count < 30; day++) {
      for (let i = 0; i < 10 && count < 30; i++, count++) {
        body += toIcal(dayFromToday(day), `${day}-${i}`)
      }
    }
    return new Response(body + "END:VCALENDAR\r\n")
  }) as typeof fetch

  const events = await new FargoUndergroundFetcher().fetchEvents(14)
  assert.ok(requested.length > 1, "more than one page")
  assert.equal(events.length, 150, "15 days of 10 events, no gaps or repeats")
  assert.equal(
    events.reduce((max, e) => (e.date > max ? e.date : max), ""),
    dayFromToday(14),
  )
})

test("Fargo Underground: a day with a whole batch can't stall the walk", async () => {
  let calls = 0
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls++
    const start = new URL(String(input)).searchParams.get("tribe-bar-date")!
    let body = ""
    for (let i = 0; i < 30; i++) body += toIcal(start, `${start}-${i}`)
    return new Response(body)
  }) as typeof fetch

  const events = await new FargoUndergroundFetcher().fetchEvents(14)
  assert.equal(calls, 15)
  assert.equal(events.length, 450)
})
