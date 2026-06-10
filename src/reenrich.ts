import { EventDatabase } from "./db/database"
import { buildAllMatches, persistMatches } from "./fetchers/registry"

/**
 * Re-applies venue enrichment rules to all matching events without refetching,
 * then rebuilds dedup matches and display_events.
 *
 * Use this after updating coordinates or addresses in the active city's
 * src/cities/<city>/venues.ts to propagate the changes immediately.
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

    // Rebuild dedup matches across ALL registered sources (the same pass the
    // weekly run does), not a hand-maintained subset.
    console.log("🔍 Rebuilding duplicate matches...")
    const allMatches = buildAllMatches(db)
    const byConfidence = persistMatches(db, allMatches)
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
