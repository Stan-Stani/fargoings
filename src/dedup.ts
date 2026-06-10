import { EventDatabase } from "./db/database"
import { buildAllMatches, persistMatches } from "./fetchers/registry"

/**
 * Rebuild dedup matches + display_events from the events already in the DB,
 * without refetching anything. Useful after matcher changes.
 */
async function main() {
  console.log("🔍 Event Deduplication Starting...\n")

  const db = new EventDatabase()

  try {
    const matches = buildAllMatches(db)
    const byConfidence = persistMatches(db, matches)

    console.log(`✓ Found ${matches.length} matches`)
    console.log(`📈 Matches by confidence:`)
    console.log(`   High:   ${byConfidence.high}`)
    console.log(`   Medium: ${byConfidence.medium}`)
    console.log(`   Low:    ${byConfidence.low}\n`)

    const displayCount = db.rebuildDisplayEvents()
    console.log(`✓ Rebuilt display_events (${displayCount} rows)`)

    console.log("─".repeat(80))
    console.log("📋 Sample high-confidence matches:\n")
    for (const match of matches
      .filter((m) => m.confidence === "high")
      .slice(0, 10)) {
      console.log(
        `   ${match.eventId1} → ${match.eventId2} (${match.totalScore.toFixed(2)}): ${match.reasons.join("; ")}`,
      )
    }

    console.log("\n✅ Deduplication complete!")
  } catch (error) {
    console.error("❌ Error:", error)
    process.exitCode = 1
  } finally {
    db.close()
  }
}

main()
