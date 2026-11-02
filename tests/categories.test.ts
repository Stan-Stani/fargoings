import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import {
  CANONICAL_CATEGORIES,
  isCanonicalCategory,
  isKnownUpstreamTag,
  resolveCategory,
} from "../src/enrichment/categories"
import { allRows, dbWith, event, tags } from "./helpers"

const resolve = (
  title: string,
  source: string,
  names: string[] = [],
  location: string | null = null,
) => resolveCategory({ title, source, names, location })

// Audit of /api/events?preset=week, Nov 2-8 2026: [title, source, upstream
// tags as stored, expected category].
const AUDIT_CASES: Array<[string, string, string[], string]> = [
  ["Jazz Night at Sidestreet", "fargounderground.com", ["Culture & Heritage", "Entertainment", "Food & Drink", "Jazz & Blues"], "Live Music"],
  ["Language Exchange", "larl.org", ["Entertainment", "Arts, Crafts and Hobbies"], "Community"],
  ["Senior Social", "larl.org", ["Entertainment"], "Seniors"],
  ["Decades in Motion Walking Group", "larl.org", ["Entertainment", "Arts, Crafts and Hobbies"], "Community"],
  ["Teeter Tots Storytime", "westfargolibrary.org", ["Literary Arts"], "Storytime"],
  ["Baby Boost Storytime", "westfargolibrary.org", ["Literary Arts"], "Storytime"],
  ["Open Mic Comedy in the Cellar", "downtownfargo.com", [], "Comedy"],
  ["Camp Karaoke", "downtownfargo.com", [], "Karaoke"],
  ["Karaoke at Rhombus Guys", "downtownfargo.com", [], "Karaoke"],
  ["Olive St. Mahjong Guided Play Event", "fargomoorhead.org", ["Cultural", "Family Friendly"], "Gaming & Tabletop"],
  ["Women's Drop-In D&D Night", "fargomoorhead.org", ["Nightlife", "Other"], "Gaming & Tabletop"],
  ["Fargo Board Gamers", "fargomoorhead.org", ["Entertainment"], "Gaming & Tabletop"],
  ["Swing Basics & Social Dance", "fargomoorhead.org", ["Performing Arts"], "Dancing"],
  ["Baker Holiday Open House", "fargomoorhead.org", ["Arts & Crafts"], "Community"],
  ["Tumble Time with Fargo All-Stars", "fargolibrary.org", ["Health & Wellness"], "Youth & Family"],
  // The source page describes a networking event, so its tag stands.
  ["Tea Time Tuesdays", "fargounderground.com", ["Business"], "Business"],
  // Section 4: nothing upstream
  ["Cooking Classics | A Tour of Italy", "downtownfargo.com", [], "Classes & Workshops"],
  ["Norwegian Desserts Demo", "downtownfargo.com", [], "Classes & Workshops"],
  ["5th Annual Open House, Radisson Blu + 84 Italian", "downtownfargo.com", [], "Community"],
  ["Caring for Your Family & Loved Ones with AARP", "westfargolibrary.org", [], "Seniors"],
  // Section 6: sports
  ["Minnesota High School Sectional Final Football", "fargodome.com", ["Sports"], "Sports"],
  ["Concordia Football", "fargomoorhead.org", ["Sports & Outdoors", "Family Friendly"], "Sports"],
  ["NDSU Women's Volleyball", "fargomoorhead.org", ["Sports & Outdoors", "Family Friendly"], "Sports"],
  ["IWSCA Agility Trial", "fargomoorhead.org", ["Sports & Outdoors"], "Sports"],
  ["Drop-In Novice Hockey", "fargoparks.com", ["Fargo Park Event & Programs"], "Sports"],
  // Section 3: registration milestones, not events
  ["Winter Volleyball League Starts", "fargoparks.com", ["Sports"], "Programs & Registration"],
  ["Junior Archery Level 2 - Start Date", "fargoparks.com", ["Youth & Family"], "Programs & Registration"],
  ["Ice Skating, Session 2 Start Date", "fargoparks.com", ["Youth & Family"], "Programs & Registration"],
]

for (const [title, source, names, expected] of AUDIT_CASES) {
  test(`audit: ${title} → ${expected}`, () => {
    assert.equal(resolve(title, source, names), expected)
  })
}

test("the names that disagreed across sources now fold together", () => {
  const source = "fargomoorhead.org"
  assert.equal(resolve("A Thing", source, ["Food, Festivals & Fairs"]), "Food & Drink")
  assert.equal(resolve("A Thing", "fargounderground.com", ["Food & Drink"]), "Food & Drink")
  assert.equal(resolve("Big Game Night", source, ["Athletics"]), "Gaming & Tabletop")
  assert.equal(resolve("Game", source, ["Athletics"]), "Sports")
})

test("Sports & Outdoors keeps non-sports out of the hidden Sports category", () => {
  const source = "fargomoorhead.org"
  for (const title of ["Buffalo River Pumpkin Patch", "Family Swim Night", "Firefly Night"]) {
    assert.equal(resolve(title, source, ["Sports & Outdoors"]), "Outdoors & Recreation", title)
  }
  for (const title of ["Junkyard Dash 5K", "Corgi Races", "FMKC Obedience & Rally Trial"]) {
    assert.equal(resolve(title, source, ["Sports & Outdoors"]), "Sports", title)
  }
})

test("keyword overrides don't fire on near-misses", () => {
  assert.notEqual(resolve("Jazzercise", "x", ["Fitness & Yoga"]), "Live Music")
  assert.notEqual(resolve("Libraries Dance - Gobbling Turkeys", "x", ["Storytime"]), "Dancing")
  assert.equal(resolve("Baby Driver Screening", "x", ["Film"]), "Film & Media")
  assert.notEqual(resolve("NDSU Senior Recital", "x", ["Music"]), "Seniors")
  assert.equal(resolve("Magic Show for Kids", "x", ["Family"]), "Youth & Family")
})

test("a survivor's own tag beats tags from rows merged into it", () => {
  const input = {
    title: "An Evening of Alton Brown",
    source: "fargotheatre.org",
    names: ["Live Performance"],
    mergedNames: ["Music & Concerts"],
  }
  assert.equal(resolveCategory(input), "Live Performance")
  assert.equal(
    resolveCategory({ ...input, source: "downtownfargo.com", names: [] }),
    "Live Music",
  )
})

test("every upstream tag ever seen is in a mapping table", () => {
  const seen = JSON.parse(
    readFileSync("tests/fixtures/upstream-tags.json", "utf8"),
  ) as Record<string, string[]>
  const unknown: string[] = []
  for (const [source, names] of Object.entries(seen)) {
    for (const name of names) {
      if (!isKnownUpstreamTag(name, source)) unknown.push(`${source}: ${name}`)
    }
  }
  assert.deepEqual(unknown, [])
})

test("no input can produce a category outside the canonical list", () => {
  const seen = JSON.parse(
    readFileSync("tests/fixtures/upstream-tags.json", "utf8"),
  ) as Record<string, string[]>
  for (const [source, names] of Object.entries(seen)) {
    for (const name of names) {
      const category = resolve("Untitled", source, [name])
      assert.ok(
        category === null || isCanonicalCategory(category),
        `${source}: ${name} → ${category}`,
      )
    }
  }
  assert.equal(resolve("Untitled", "x", ["Some New Tag We Never Saw"]), null)
})

test("no event reaches the API with a category outside the canonical list", () => {
  const db = dbWith(
    AUDIT_CASES.map(([title, source, names]) =>
      event({ title, source, categories: tags(...names) }),
    ).concat(
      event({ title: "Untagged Mystery", categories: "[]" }),
      event({ title: "Bad Tag", categories: tags("Some New Tag We Never Saw") }),
      event({ title: "Not JSON", categories: "Entertainment" }),
      event({ title: "Escaped", categories: tags("Food &amp; Drink") }),
    ),
  )
  const rows = allRows(db)
  assert.ok(rows.length > AUDIT_CASES.length / 2, "rows reached the query")
  for (const row of rows) {
    assert.ok(
      row.category === null ||
        (CANONICAL_CATEGORIES as readonly string[]).includes(row.category),
      `${row.title} → ${row.category}`,
    )
  }
  assert.deepEqual(db.getDataQualityReport().nonCanonicalCategories, [])
  db.close()
})

test("the report names tags missing from the mapping tables", () => {
  const db = dbWith([
    event({ title: "Bad Tag", categories: tags("Some New Tag We Never Saw") }),
  ])
  const { unmappedTags } = db.getDataQualityReport()
  assert.equal(unmappedTags.length, 1)
  assert.equal(unmappedTags[0].tag, "Some New Tag We Never Saw")
  db.close()
})
