import assert from "node:assert/strict"
import { test } from "node:test"
import { findMatches, findSelfMatches, scoreMatch } from "../src/dedup/matcher"
import { StoredEvent } from "../src/types/event"
import { event } from "./helpers"

let id = 1
const stored = (overrides: Partial<StoredEvent>): StoredEvent => ({
  ...event({ date: "2026-11-04" }),
  id: id++,
  createdAt: "",
  updatedAt: "",
  ...overrides,
})

const taproom = "Front Street Taproom, 614 Main Ave, Fargo, ND 58103"

test("Womens' and Ladies' D&D night across sources is one event", () => {
  const womens = stored({
    title: "Women's Drop-In D&D Night",
    startTime: "18:30:00",
    location: taproom,
    source: "fargomoorhead.org",
  })
  const ladies = stored({
    title: "Ladies' Drop-In D&D Night",
    startTime: "18:30:00",
    location: taproom,
    source: "downtownfargo.com",
  })
  const [match] = findMatches([womens], [ladies], 0.65)
  assert.equal(match?.confidence, "high")
})

test("men's and women's games in the same slot stay two events", () => {
  const score = scoreMatch(
    stored({ title: "Men's Basketball vs Hamline", location: taproom }),
    stored({ title: "Women's Basketball vs Hamline", location: taproom }),
  )
  assert.equal(score.titleScore, 0)
  assert.equal(score.confidence, "low")
})

test("the same program at different library branches stays separate", () => {
  const branch = (location: string) =>
    stored({ title: "Teen Take and Make Leather Bracelet", startTime: "10:00:00", location })
  const matches = findSelfMatches([
    branch("Main Library, 101 4th Street North, Fargo, ND 58102"),
    branch("Dr. James Carlson Library, 2801 32nd Avenue South, Fargo, ND 58103"),
    branch("Northport Library, 2714 North Broadway, Fargo, ND 58102"),
  ])
  assert.deepEqual(matches, [])
})

test("sharing a city and ZIP doesn't make two venues alike", () => {
  const score = scoreMatch(
    stored({ title: "Trivia Night", location: "Bar One, 100 Broadway N, Fargo, ND 58102" }),
    stored({ title: "Karaoke", location: "Club Two, 200 1st Ave N, Fargo, ND 58102" }),
  )
  assert.ok(score.venueScore < 0.3, `venue score ${score.venueScore}`)
})

test("two names at one street address count as the same place", () => {
  const score = scoreMatch(
    stored({ location: "Brewhalla, 1666 1st Ave N, Fargo, ND 58102" }),
    stored({ location: "Drekker Brewing Company, 1666 1st Ave N, Fargo, ND 58102" }),
  )
  assert.ok(score.venueScore >= 0.8, `venue score ${score.venueScore}`)
})

test("events on a shared section URL aren't duplicates", () => {
  const url = "https://www.fargoparks.com/youth-programs/nature-outdoors"
  const matches = findSelfMatches([
    stored({ title: "Junior Archery Level 1 - Start Date", url, startTime: "17:30:00", location: null }),
    stored({ title: "Junior Archery Level 2 - Start Date", url, startTime: "18:30:00", location: null }),
  ])
  assert.deepEqual(matches, [])
})

test("variants at one venue in one calendar stay separate", () => {
  const paradox = "Paradox Comics & Games, 814 Main Ave Suite 100, Fargo, ND 58103"
  const at = (title: string) => stored({ title, startTime: "18:00:00", location: paradox })
  for (const [a, b] of [
    ["Friday Night Magic: Modern", "Friday Night Magic: Reality Fracture Season"],
    ["Magic: the Gathering – Star Trek Prerelease", "Magic: the Gathering – Star Trek Prerelease 2HG"],
  ]) {
    assert.deepEqual(findSelfMatches([at(a), at(b)]), [], `${a} / ${b}`)
  }
})

test("a repost with the same or reworded title still merges", () => {
  const boss = "Boss' Comedy Club Fargo, 228 Broadway N, Fargo, ND 58102"
  const at = (title: string) => stored({ title, startTime: "20:00:00", location: boss })
  assert.equal(findSelfMatches([at("Gundam CGE"), at("Gundam CGE")]).length, 1)
  assert.equal(
    findSelfMatches([at("Open Mic Comedy"), at("Boss' Comedy Club Open Mic")]).length,
    1,
  )
})

test("identical URL at the same time is still a repost", () => {
  const url = "https://fargounderground.com/event/some-show/"
  const [match] = findSelfMatches([
    stored({ title: "Some Show", url, startTime: "19:00:00" }),
    stored({ title: "Some Show (Updated!)", url, startTime: "19:00:00" }),
  ])
  assert.equal(match?.reasons[0], "identical url (same-source repost)")
})

test("a row that gained a time still replaces its old copy", () => {
  const url = "https://www.fargomoorhead.org/event/concordia-football/4935/"
  const matches = findSelfMatches([
    stored({ title: "Concordia Football", url, startTime: null }),
    stored({ title: "Concordia Football", url, startTime: "12:00:00" }),
  ])
  assert.equal(matches.length, 1)
})

test("Bo Johnson's shows on consecutive nights share a URL but stay separate", () => {
  const url = "https://www.downtownfargo.com/events/comedy-in-the-cellar---bo-johnson3"
  const show = (date: string) =>
    stored({ title: "Comedy in the Cellar - Bo Johnson", url, date, startTime: "19:30:00", source: "downtownfargo.com" })
  assert.deepEqual(findSelfMatches([show("2026-11-06"), show("2026-11-07")]), [])
})

test("an early and late show on one page stay separate", () => {
  const url = "https://www.downtownfargo.com/events/comedy"
  const matches = findSelfMatches([
    stored({ title: "Comedy", url, startTime: "19:00:00" }),
    stored({ title: "Comedy", url, startTime: "21:30:00" }),
  ])
  assert.deepEqual(matches, [])
})
