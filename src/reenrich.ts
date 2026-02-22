import { EventDatabase } from "./db/database"
import { findMatches } from "./dedup/matcher"

/**
 * Re-applies venue enrichment rules to all matching events without refetching,
 * then rebuilds dedup matches and display_events.
 *
 * Use this after updating coordinates or addresses in src/enrichment/venues.ts
 * to propagate the changes to the database immediately.
 */
async function main() {
  console.log("🏛️  Re-enriching venue locations (no fetch)...\n")

  const db = new EventDatabase()

  try {
    // Re-apply venue rules to all title-matching events (overwrites stale data)
    const enrichedCount = db.reapplyVenueLocations()
    console.log(
      `✓ Updated ${enrichedCount} events with current venue locations\n`,
    )

    // Rebuild dedup matches
    console.log("🔍 Rebuilding duplicate matches...")
    const fargoStored = db.getEventsBySource("fargomoorhead.org")
    const undergroundStored = db.getEventsBySource("fargounderground.com")
    const downtownStored = db.getEventsBySource("downtownfargo.com")
    const westFargoStored = db.getEventsBySource("westfargoevents.com")
    const fargoLibraryStored = db.getEventsBySource("fargolibrary.org")

    const allMatches = [
      ...findMatches(fargoStored, undergroundStored, 0.65),
      ...findMatches(fargoStored, downtownStored, 0.65),
      ...findMatches(fargoStored, westFargoStored, 0.65),
      ...findMatches(fargoStored, fargoLibraryStored, 0.65),
      ...findMatches(downtownStored, undergroundStored, 0.65),
      ...findMatches(downtownStored, westFargoStored, 0.65),
      ...findMatches(undergroundStored, westFargoStored, 0.65),
      ...findMatches(undergroundStored, fargoLibraryStored, 0.65),
      ...findMatches(westFargoStored, fargoLibraryStored, 0.65),
    ]

    db.clearMatches()
    const byConfidence = { high: 0, medium: 0, low: 0 }
    for (const match of allMatches) {
      db.insertMatch({
        eventId1: match.eventId1,
        eventId2: match.eventId2,
        score: match.totalScore,
        confidence: match.confidence,
        reasons: match.reasons,
        matchType: "auto",
      })
      byConfidence[match.confidence]++
    }
    console.log(
      `✓ Found ${allMatches.length} matches (${byConfidence.high} high, ${byConfidence.medium} medium, ${byConfidence.low} low)\n`,
    )

    const displayCount = db.rebuildDisplayEvents()
    console.log(`✓ Rebuilt display_events (${displayCount} rows)\n`)

    console.log("✅ Re-enrichment complete!")
  } catch (error) {
    console.error("❌ Error:", error)
    process.exit(1)
  } finally {
    db.close()
  }
}

main()
