import assert from "node:assert/strict"
import { test } from "node:test"
import {
  cleanTitle,
  normalizeLocation,
  staleTitleYear,
  timeForDateInText,
  timeFromText,
} from "../src/enrichment/normalize"

test("cleanTitle: examples from the audit", () => {
  const cases: Array<[string, Parameters<typeof cleanTitle>[1], string]> = [
    ["Womens' Drop-In D&D Night", {}, "Women's Drop-In D&D Night"],
    ["FARGO BOARD GAMERS", {}, "Fargo Board Gamers"],
    ["StartupBREW Fargo 11/4/26", { date: "2026-11-04" }, "StartupBREW Fargo"],
    [
      'Monday Matinee "The Buddy Holly Story" PG',
      {},
      'Monday Matinee "The Buddy Holly Story"',
    ],
    [
      "Dual Exhibition - Ted Martin + DMitry Lewman - Gallery4",
      { location: "Gallery 4, 115 Roberts St N, Fargo, ND 58102" },
      "Dual Exhibition - Ted Martin + Dmitry Lewman",
    ],
    [
      "Ice Skating, Session 2 Start Date November 2",
      { date: "2026-11-02" },
      "Ice Skating, Session 2 Start Date",
    ],
    [
      "Sense of Place Book Club – November 2026",
      { date: "2026-11-05" },
      "Sense of Place Book Club",
    ],
  ]
  for (const [input, context, expected] of cases) {
    assert.equal(cleanTitle(input, context), expected)
  }
})

test("cleanTitle: leaves what it shouldn't touch", () => {
  const untouched: Array<[string, Parameters<typeof cleanTitle>[1]]> = [
    // A date that isn't this event's
    ["StartupBREW Fargo 11/4/26", { date: "2026-11-11" }],
    // Part of a name, or not a trailing date at all
    ["Free Friday Movies: Fall 2026", { date: "2026-11-13" }],
    ["Teen Volunteers – Fall 2026", { date: "2026-11-07" }],
    // Styled caps that aren't a whole all-caps title
    ["GODZILLA - Centennial Film Series", {}],
    ["KING 810", {}],
    ["StartupBREW Fargo", {}],
    // Real mixed case
    ["McKenna's DJing with TVs", {}],
    ["IHeart Radio Night", {}],
    ["KPop Demon Hunters Experience", {}],
    ["Augustana University Men's Basketball vs UMary", {}],
    ["Women's Basketball at Children's Hospital", {}],
    // A hyphen that isn't a venue suffix
    ["Comedy in the Cellar - Bo Johnson", { location: "The Cellar Comedy Club" }],
    // A venue named mid-title reads fine and helps tell events apart
    ["Jazz Night at Sidestreet", { location: "Sidestreet Grille & Pub" }],
    // A letter that happens to look like a rating
    ["Plan R", {}],
  ]
  for (const [title, context] of untouched) {
    assert.equal(cleanTitle(title, context), title)
  }
})

test("cleanTitle: keeps acronyms when recasing, and stays idempotent", () => {
  assert.equal(cleanTitle("NDSU BISON FOOTBALL VS UND"), "NDSU Bison Football vs UND")
  assert.equal(cleanTitle('PROM KINGS "FREQUENCIES" EP RELEASE SHOW'), 'Prom Kings "Frequencies" EP Release Show')
  for (const title of [
    "FARGO BOARD GAMERS",
    "Womens' Drop-In D&D Night",
    "StartupBREW Fargo 11/4/26",
  ]) {
    const once = cleanTitle(title, { date: "2026-11-04" })
    assert.equal(cleanTitle(once, { date: "2026-11-04" }), once)
  }
})

test("normalizeLocation: examples from the audit", () => {
  const cases: Array<[string, string]> = [
    ["The 1889 Fargo 602 Main Avenue Fargo, ND 58103-1912", "The 1889 Fargo, 602 Main Avenue, Fargo, ND 58103"],
    ["The Cellar Comedy Club 614 Main Avenue Fargo, ND 58103-1912", "The Cellar Comedy Club, 614 Main Avenue, Fargo, ND 58103"],
    ["701 Eateries 701 North University Drive Fargo, ND 58102-4343 United States", "701 Eateries, 701 North University Drive, Fargo, ND 58102"],
    ["Fargo VFW Club, Post 762 202 Broadway North Fargo, ND 58102-4713 United States", "Fargo VFW Club, Post 762, 202 Broadway North, Fargo, ND 58102"],
    ["SIdestreet Grille & Pub, 404 4th ave N, Fargo, ND, 58102", "Sidestreet Grille & Pub, 404 4th ave N, Fargo, ND 58102"],
    ["West Fargo Public Library, 215 3rd St E West Fargo ND 58078", "West Fargo Public Library, 215 3rd St E, West Fargo, ND 58078"],
    ["The Daily Dose Fargo, 3223 13th Ave S, Fargo, North Dakota, 58103, United States", "The Daily Dose Fargo, 3223 13th Ave S, Fargo, ND 58103"],
    ["Bridges 167, 700 11th St S Moorhead, MN 56560", "Bridges 167, 700 11th St S, Moorhead, MN 56560"],
    ["Creative Kitchen 3902 13th Ave SW Fargo, ND", "Creative Kitchen, 3902 13th Ave SW, Fargo, ND"],
    ["Walmart \u2013 3757 55th Ave. S, Fargo, ND", "Walmart, 3757 55th Ave. S, Fargo, ND"],
    ["Herbz %26 Spicez 26 Roberts Street North Fargo, ND 58102-5200 United States", "Herbz & Spicez, 26 Roberts Street North, Fargo, ND 58102"],
  ]
  for (const [input, expected] of cases) {
    assert.equal(normalizeLocation(input), expected)
    assert.equal(normalizeLocation(expected), expected, "idempotent")
  }
})

test("normalizeLocation: leaves names and already-clean addresses alone", () => {
  for (const location of [
    "Gallery 4",
    "Off-site",
    "The Aquarium, 226 Broadway N Fl 2",
    "Main Library, 101 4th Street North, Fargo, ND 58102",
    "Mary W. Sommervold Hall, 301 S. Main Ave",
    "Siouxland Library, Downtown Branch, North Dakota Avenue 200",
  ]) {
    assert.equal(normalizeLocation(location), location)
  }
})

test("staleTitleYear: flags the audit example", () => {
  assert.equal(staleTitleYear("2025 Fall Baccalaureate", "2026-11-02"), 2025)
})

test("staleTitleYear: passes years that aren't stale", () => {
  const fine: Array<[string, string]> = [
    ["2010's LASER Dance Party", "2026-11-06"], // a decade
    ["2020s Throwback Night", "2026-11-06"],
    ["2001: A Space Odyssey", "2026-11-06"], // a theme, long past
    ["2025-26 Season Opener", "2026-11-06"], // a season
    ["Class of 2024 Reunion", "2026-11-06"],
    ["Serving Fargo Since 2021", "2026-11-06"],
    ["TOBYMAC'S HITS DEEP 2027", "2027-03-17"], // this year
    ["Teen Volunteers – Fall 2026", "2026-11-07"],
    ["2025 Year in Review", "2026-01-20"], // early in the next year
    ["Blade Runner 2049", "2026-11-06"], // the future
  ]
  for (const [title, date] of fine) {
    assert.equal(staleTitleYear(title, date), null, title)
  }
})

test("timeFromText reads Simpleview's times field", () => {
  assert.equal(timeFromText("From: 5:00 PM to 8:00 PM"), "17:00:00")
  assert.equal(timeFromText("Starting: 07:30 PM"), "19:30:00")
  assert.equal(timeFromText("12 am"), "00:00:00")
  assert.equal(timeFromText("Call for details"), null)
})

test("timeForDateInText reads season schedules for the right date", () => {
  const football =
    "Schedule Home Games Oct 24 (Thu) / 1 pm vs Augsburg Nov 7 (Sat) / 12 pm vs Macalester Nov 14 (Thu) / 12 pm vs Carleton"
  assert.equal(timeForDateInText(football, "2026-11-07"), "12:00:00")
  assert.equal(timeForDateInText(football, "2026-10-24"), "13:00:00")

  const bounce =
    "When Friday, November 6th: 3 PM- 9 PM Saturday, November 7th: 9 AM-8 PM Sunday, November 8th: 10 AM-7 PM"
  assert.equal(timeForDateInText(bounce, "2026-11-06"), "15:00:00")
  assert.equal(timeForDateInText(bounce, "2026-11-08"), "10:00:00")

  const force = "Home Games 2026 Sep 25: vs Waterloo Black Hawks | 7:05 pm"
  assert.equal(timeForDateInText(force, "2026-09-25"), "19:05:00")
})

test("timeForDateInText won't borrow another date's time", () => {
  // Nov 7 has no time of its own; the next time belongs to Nov 14.
  const text = "Home Games Nov 7 (Sat) vs Macalester Nov 14 (Thu) / 12 pm vs Carleton"
  assert.equal(timeForDateInText(text, "2026-11-07"), null)
  assert.equal(timeForDateInText("Nov 17 at 5 pm", "2026-11-07"), null)
  assert.equal(timeForDateInText("A fun night for everyone!", "2026-11-07"), null)
  assert.equal(timeForDateInText(null, "2026-11-07"), null)
})
