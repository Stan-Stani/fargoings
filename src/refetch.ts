import { EventDatabase } from "./db/database"
import { findMatches } from "./dedup/matcher"
import { DowntownFargoFetcher } from "./fetchers/downtownfargo-com"
import { FargoLibraryFetcher } from "./fetchers/fargolibrary-org"
import { FargoFetcher } from "./fetchers/fargomoorhead-com"
import { FargoUndergroundFetcher } from "./fetchers/fargounderground-com"
import { WestFargoEventsFetcher } from "./fetchers/westfargoevents-com"
import { logError } from "./log"

function getLocalDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

async function main() {
  console.log("🔄 Force re-fetching all sources (ignoring cache)...\n")

  const db = new EventDatabase()

  try {
    const today = getLocalDateString(new Date())

    // Clear all events and matches
    db.clearMatches()
    console.log("   Cleared existing matches\n")

    // Fetch fargomoorhead.org
    console.log("📥 Fetching fargomoorhead.org...")
    try {
      const fargoFetcher = new FargoFetcher()
      const fargoEvents = await fargoFetcher.fetchEvents()
      db.deleteEventsBySource("fargomoorhead.org")
      for (const event of fargoEvents) {
        db.insertEvent(fargoFetcher.transformToStoredEvent(event))
      }
      db.setSourceLastUpdatedDate("fargomoorhead.org", today)
      console.log(`✓ Stored ${fargoEvents.length} events\n`)
    } catch (error) {
      logError("❌ fargomoorhead.org refetch failed:", error)
      console.log(
        "⚠️  Keeping existing fargomoorhead.org events (no delete performed).\n",
      )
    }

    // Fetch fargounderground.com
    console.log("📥 Fetching fargounderground.com...")
    try {
      const undergroundFetcher = new FargoUndergroundFetcher()
      const undergroundEvents = await undergroundFetcher.fetchEvents()
      db.deleteEventsBySource("fargounderground.com")
      for (const event of undergroundEvents) {
        db.insertEvent(undergroundFetcher.transformToStoredEvent(event))
      }
      db.setSourceLastUpdatedDate("fargounderground.com", today)
      console.log(`✓ Stored ${undergroundEvents.length} events\n`)
    } catch (error) {
      logError("❌ fargounderground.com refetch failed:", error)
      console.log(
        "⚠️  Keeping existing fargounderground.com events (no delete performed).\n",
      )
    }

    // Fetch downtownfargo.com
    console.log("📥 Fetching downtownfargo.com...")
    try {
      const downtownFetcher = new DowntownFargoFetcher()
      const downtownEvents = await downtownFetcher.fetchEvents(14)
      db.deleteEventsBySource("downtownfargo.com")
      for (const event of downtownEvents) {
        db.insertEvent(downtownFetcher.transformToStoredEvent(event))
      }
      db.setSourceLastUpdatedDate("downtownfargo.com", today)
      console.log(`✓ Stored ${downtownEvents.length} events\n`)
    } catch (error) {
      logError("❌ downtownfargo.com refetch failed:", error)
      console.log(
        "⚠️  Keeping existing downtownfargo.com events (no delete performed).\n",
      )
    }

    // Fetch westfargoevents.com
    console.log("📥 Fetching westfargoevents.com...")
    try {
      const westFargoFetcher = new WestFargoEventsFetcher()
      const westFargoEvents = await westFargoFetcher.fetchEvents()
      db.deleteEventsBySource("westfargoevents.com")
      for (const event of westFargoEvents) {
        db.insertEvent(westFargoFetcher.transformToStoredEvent(event))
      }
      db.setSourceLastUpdatedDate("westfargoevents.com", today)
      console.log(`✓ Stored ${westFargoEvents.length} events\n`)
    } catch (error) {
      logError("❌ westfargoevents.com refetch failed:", error)
      console.log(
        "⚠️  Keeping existing westfargoevents.com events (no delete performed).\n",
      )
    }

    // Fetch fargolibrary.org (non-fatal if it 504s)
    console.log("📥 Fetching fargolibrary.org...")
    try {
      const fargoLibraryFetcher = new FargoLibraryFetcher()
      const fargoLibraryEvents = await fargoLibraryFetcher.fetchEvents()
      db.deleteEventsBySource("fargolibrary.org")
      for (const event of fargoLibraryEvents) {
        db.insertEvent(fargoLibraryFetcher.transformToStoredEvent(event))
      }
      db.setSourceLastUpdatedDate("fargolibrary.org", today)
      console.log(`✓ Stored ${fargoLibraryEvents.length} events\n`)
    } catch (error) {
      logError("❌ fargolibrary.org refetch failed:", error)
      console.log(
        "⚠️  Keeping existing fargolibrary.org events (no delete performed).\n",
      )
    }

    // Enrich events with known venue locations where data is missing
    const enrichedCount = db.enrichVenueLocations()
    if (enrichedCount > 0) {
      console.log(
        `🏛️  Enriched ${enrichedCount} events with known venue locations\n`,
      )
    }

    // Rebuild dedup matches across all source pairs
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

    console.log(`📊 Total: ${db.getTotalCount()} events`)
    console.log(`📊 Display: ${db.getDisplayCount()} events`)
    console.log("✅ Re-fetch complete!")
  } catch (error) {
    console.error("❌ Error:", error)
    process.exit(1)
  } finally {
    db.close()
  }
}

main()
