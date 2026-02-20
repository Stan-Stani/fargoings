import "dotenv/config"
import { EventDatabase } from "./db/database"
import { findMatches } from "./dedup/matcher"
import { decodeHtmlEntities } from "./dedup/normalize"
import { DowntownFargoFetcher } from "./fetchers/downtownfargo-com"
import { FargoFetcher } from "./fetchers/fargomoorhead-com"
import { FargoLibraryFetcher } from "./fetchers/fargolibrary-org"
import { FargoUndergroundFetcher } from "./fetchers/fargounderground-com"
import { WestFargoEventsFetcher } from "./fetchers/westfargoevents-com"

function getLocalDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

async function main() {
  console.log("🎉 Fargo Event Aggregator Starting...\n")

  const db = new EventDatabase()
  const fargoFetcher = new FargoFetcher()
  const undergroundFetcher = new FargoUndergroundFetcher()
  const downtownFetcher = new DowntownFargoFetcher()
  const westFargoFetcher = new WestFargoEventsFetcher()
  const fargoLibraryFetcher = new FargoLibraryFetcher()

  try {
    const today = getLocalDateString(new Date())
    const fargoLastUpdated = db.getSourceLastUpdatedDate("fargomoorhead.org")
    const undergroundLastUpdated = db.getSourceLastUpdatedDate(
      "fargounderground.com",
    )
    const downtownLastUpdated = db.getSourceLastUpdatedDate("downtownfargo.com")
    const westFargoLastUpdated = db.getSourceLastUpdatedDate(
      "westfargoevents.com",
    )
    const fargoLibraryLastUpdated = db.getSourceLastUpdatedDate(
      "fargolibrary.org",
    )
    const freshCount = [
      fargoLastUpdated,
      undergroundLastUpdated,
      downtownLastUpdated,
      westFargoLastUpdated,
      fargoLibraryLastUpdated,
    ].filter((date) => date === today).length
    const staleCount = 5 - freshCount
    console.log(`🧊 Cache status: ${freshCount} fresh, ${staleCount} stale`)

    // Fetch from fargomoorhead.org
    console.log(
      `   fargomoorhead.org cache date: ${fargoLastUpdated || "never"} (today: ${today})`,
    )
    if (fargoLastUpdated === today) {
      console.log("⏭️  Using cached fargomoorhead.org events (fresh today).\n")
    } else {
      console.log("📥 Fetching events from fargomoorhead.org (next 2 weeks)...")
      const fargoEvents = await fargoFetcher.fetchEvents()
      console.log(`✓ Fetched ${fargoEvents.length} events\n`)

      console.log("💾 Storing fargomoorhead.org events...")
      let fargoInserted = 0
      for (const event of fargoEvents) {
        const storedEvent = fargoFetcher.transformToStoredEvent(event)
        db.insertEvent(storedEvent)
        fargoInserted++
      }
      db.setSourceLastUpdatedDate("fargomoorhead.org", today)
      console.log(`✓ Processed ${fargoInserted} events\n`)
    }

    // Fetch from fargounderground.com
    console.log(
      `   fargounderground.com cache date: ${undergroundLastUpdated || "never"} (today: ${today})`,
    )
    if (undergroundLastUpdated === today) {
      console.log(
        "⏭️  Using cached fargounderground.com events (fresh today).\n",
      )
    } else {
      console.log(
        "📥 Fetching events from fargounderground.com (next 2 weeks)...",
      )
      const undergroundEvents = await undergroundFetcher.fetchEvents()
      console.log(`✓ Fetched ${undergroundEvents.length} events\n`)

      console.log("💾 Storing fargounderground.com events...")
      let undergroundInserted = 0
      for (const event of undergroundEvents) {
        const storedEvent = undergroundFetcher.transformToStoredEvent(event)
        db.insertEvent(storedEvent)
        undergroundInserted++
      }
      db.setSourceLastUpdatedDate("fargounderground.com", today)
      console.log(`✓ Processed ${undergroundInserted} events\n`)
    }

    // Fetch from downtownfargo.com
    console.log(
      `   downtownfargo.com cache date: ${downtownLastUpdated || "never"} (today: ${today})`,
    )
    if (downtownLastUpdated === today) {
      console.log("⏭️  Using cached downtownfargo.com events (fresh today).\n")
    } else {
      console.log("📥 Fetching events from downtownfargo.com (next 2 weeks)...")
      const downtownEvents = await downtownFetcher.fetchEvents(14)
      console.log(`✓ Fetched ${downtownEvents.length} events\n`)

      console.log("💾 Storing downtownfargo.com events...")
      let downtownInserted = 0
      for (const event of downtownEvents) {
        const storedEvent = downtownFetcher.transformToStoredEvent(event)
        db.insertEvent(storedEvent)
        downtownInserted++
      }
      db.setSourceLastUpdatedDate("downtownfargo.com", today)
      console.log(`✓ Processed ${downtownInserted} events\n`)
    }

    // Fetch from westfargoevents.com
    console.log(
      `   westfargoevents.com cache date: ${westFargoLastUpdated || "never"} (today: ${today})`,
    )
    if (westFargoLastUpdated === today) {
      console.log(
        "⏭️  Using cached westfargoevents.com events (fresh today).\n",
      )
    } else {
      console.log(
        "📥 Fetching events from westfargoevents.com (next 2 weeks)...",
      )
      const westFargoEvents = await westFargoFetcher.fetchEvents()
      console.log(`✓ Fetched ${westFargoEvents.length} events\n`)

      console.log("💾 Storing westfargoevents.com events...")
      let westFargoInserted = 0
      for (const event of westFargoEvents) {
        const storedEvent = westFargoFetcher.transformToStoredEvent(event)
        db.insertEvent(storedEvent)
        westFargoInserted++
      }
      db.setSourceLastUpdatedDate("westfargoevents.com", today)
      console.log(`✓ Processed ${westFargoInserted} events\n`)
    }

    // Fetch from fargolibrary.org
    console.log(
      `   fargolibrary.org cache date: ${fargoLibraryLastUpdated || "never"} (today: ${today})`,
    )
    if (fargoLibraryLastUpdated === today) {
      console.log("⏭️  Using cached fargolibrary.org events (fresh today).\n")
    } else {
      console.log(
        "📥 Fetching events from fargolibrary.org (next 2 weeks)...",
      )
      const fargoLibraryEvents = await fargoLibraryFetcher.fetchEvents()
      console.log(`✓ Fetched ${fargoLibraryEvents.length} events\n`)

      console.log("💾 Storing fargolibrary.org events...")
      let fargoLibraryInserted = 0
      for (const event of fargoLibraryEvents) {
        const storedEvent = fargoLibraryFetcher.transformToStoredEvent(event)
        db.insertEvent(storedEvent)
        fargoLibraryInserted++
      }
      db.setSourceLastUpdatedDate("fargolibrary.org", today)
      console.log(`✓ Processed ${fargoLibraryInserted} events\n`)
    }

    // Enrich events with known venue locations where data is missing
    const enrichedCount = db.enrichVenueLocations()
    if (enrichedCount > 0) {
      console.log(`🏛️  Enriched ${enrichedCount} events with known venue locations\n`)
    }

    // Deduplicate events across all sources
    console.log("🔍 Finding duplicate events...")
    const fargoStored = db.getEventsBySource("fargomoorhead.org")
    const undergroundStored = db.getEventsBySource("fargounderground.com")
    const downtownStored = db.getEventsBySource("downtownfargo.com")
    const westFargoStored = db.getEventsBySource("westfargoevents.com")

    const fargoLibraryStored = db.getEventsBySource("fargolibrary.org")

    // Find matches between all source pairs
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
      const title = decodeHtmlEntities(event.title)
      const location = event.location
        ? decodeHtmlEntities(event.location)
        : "Location TBD"
      console.log(`   ${index + 1}. ${title}`)
      console.log(`      📍 ${location}`)
      console.log(`      📆 ${eventDate}${timeStr}`)
      console.log(`      🔗 ${event.url}`)
      if (event.altUrl) {
        console.log(`      🔗 ${event.altUrl} (alt)`)
      }
      console.log("")
    })

    console.log("✅ Event aggregation complete!")
  } catch (error) {
    console.error("❌ Error:", error)
    process.exit(1)
  } finally {
    db.close()
  }
}

main()
