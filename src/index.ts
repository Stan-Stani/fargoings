import "dotenv/config"
import { EventDatabase } from "./db/database"
import {
  buildAllMatches,
  persistMatches,
  runSource,
  SOURCES,
  SourceRunResult,
} from "./fetchers/registry"

function getLocalDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

async function main() {
  console.log("🎉 Fargo Event Aggregator Starting...\n")

  const db = new EventDatabase()

  try {
    const today = getLocalDateString(new Date())
    const freshCount = SOURCES.filter(
      (def) => db.getSourceLastUpdatedDate(def.source) === today,
    ).length
    console.log(
      `🧊 Cache status: ${freshCount} fresh, ${SOURCES.length - freshCount} stale`,
    )

    const results: SourceRunResult[] = []
    for (const def of SOURCES) {
      results.push(await runSource(db, def, { force: false, today }))
    }

    // Enrich events with known venue locations where data is missing
    const enrichedCount = db.enrichVenueLocations()
    if (enrichedCount > 0) {
      console.log(
        `🏛️  Enriched ${enrichedCount} events with known venue locations\n`,
      )
    }

    // Deduplicate events across all sources
    console.log("🔍 Finding duplicate events...")
    const allMatches = buildAllMatches(db)
    const byConfidence = persistMatches(db, allMatches)
    console.log(
      `✓ Found ${allMatches.length} matches (${byConfidence.high} high, ${byConfidence.medium} medium, ${byConfidence.low} low)\n`,
    )

    const displayCount = db.rebuildDisplayEvents()
    console.log(`✓ Rebuilt display_events (${displayCount} rows)\n`)

    // Stats
    const totalCount = db.getTotalCount()
    const dedupedCount = db.getDeduplicatedCount()
    console.log(`📊 Statistics:`)
    console.log(`   Total events:  ${totalCount}`)
    console.log(`   After dedup:   ${dedupedCount}`)
    console.log(`   Duplicates:    ${totalCount - dedupedCount}`)
    console.log(`   Display rows:  ${db.getDisplayCount()}`)

    // Show upcoming deduplicated events
    console.log("\n📅 Upcoming Events (next 10, deduplicated):")
    const upcomingEvents = db.getDeduplicatedEvents(10)
    upcomingEvents.forEach((event, index) => {
      // Format date directly to avoid timezone issues (date is stored as YYYY-MM-DD)
      const [year, month, day] = event.date.split("-")
      const eventDate = `${parseInt(month)}/${parseInt(day)}/${year}`
      let timeStr = ""
      if (event.startTime) {
        const [h, m] = event.startTime.split(":").map(Number)
        const hour = h % 12 || 12
        const ampm = h < 12 ? "AM" : "PM"
        timeStr = ` at ${hour}:${m.toString().padStart(2, "0")} ${ampm}`
      }
      console.log(`   ${index + 1}. ${event.title}`)
      console.log(`      📍 ${event.location || "Location TBD"}`)
      console.log(`      📆 ${eventDate}${timeStr}`)
      console.log(`      🔗 ${event.url}`)
      if (event.altUrl) {
        console.log(`      🔗 ${event.altUrl} (alt)`)
      }
      console.log("")
    })

    // Greppable health summary; a nonzero exit code is the cron's alert
    // signal (data fetched from healthy sources is already committed —
    // per-source failures never abort the run).
    const okCount = results.filter((r) => r.status === "ok").length
    const skippedCount = results.filter((r) => r.status === "skipped").length
    const errorCount = results.filter((r) => r.status === "error").length
    const health = db.getSourceHealth(SOURCES.map((def) => def.source))
    const flagged = health.filter((h) => h.flagged)
    console.log(
      `HEALTH SUMMARY: ${okCount} ok, ${skippedCount} skipped, ${errorCount} error, ${flagged.length} flagged`,
    )
    if (flagged.length > 0) {
      for (const h of flagged) {
        console.log(`   ⚠️  ${h.source}: ${h.flagReasons.join("; ")}`)
      }
      process.exitCode = 1
    }

    console.log("✅ Event aggregation complete!")
  } catch (error) {
    console.error("❌ Error:", error)
    process.exitCode = 1
  } finally {
    db.close()
  }
}

main()
