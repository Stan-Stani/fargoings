import "dotenv/config"
import { EventDatabase } from "./db/database"
import { findMatches, findSelfMatches } from "./dedup/matcher"
import { decodeHtmlEntities } from "./dedup/normalize"
import { DowntownFargoFetcher } from "./fetchers/downtownfargo-com"
import { FargoLibraryFetcher } from "./fetchers/fargolibrary-org"
import { FargoFetcher } from "./fetchers/fargomoorhead-com"
import { FargoUndergroundFetcher } from "./fetchers/fargounderground-com"
import { WestFargoEventsFetcher } from "./fetchers/westfargoevents-com"
import { MoorheadLibraryFetcher } from "./fetchers/moorheadlibrary-org"
import { WestFargoLibraryFetcher } from "./fetchers/westfargolibrary-org"
import { logError } from "./log"

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
  const westFargoLibraryFetcher = new WestFargoLibraryFetcher()
  const moorheadLibraryFetcher = new MoorheadLibraryFetcher()

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
    const fargoLibraryLastUpdated =
      db.getSourceLastUpdatedDate("fargolibrary.org")
    const westFargoLibraryLastUpdated = db.getSourceLastUpdatedDate(
      "westfargolibrary.org",
    )
    const moorheadLibraryLastUpdated = db.getSourceLastUpdatedDate(
      "larl.org",
    )
    const freshCount = [
      fargoLastUpdated,
      undergroundLastUpdated,
      downtownLastUpdated,
      westFargoLastUpdated,
      fargoLibraryLastUpdated,
      westFargoLibraryLastUpdated,
      moorheadLibraryLastUpdated,
    ].filter((date) => date === today).length
    const staleCount = 7 - freshCount
    console.log(`🧊 Cache status: ${freshCount} fresh, ${staleCount} stale`)

    // Fetch from fargomoorhead.org
    console.log(
      `   fargomoorhead.org cache date: ${fargoLastUpdated || "never"} (today: ${today})`,
    )
    if (fargoLastUpdated === today) {
      console.log("⏭️  Using cached fargomoorhead.org events (fresh today).\n")
    } else {
      try {
        console.log(
          "📥 Fetching events from fargomoorhead.org (next 2 weeks)...",
        )
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
      } catch (error) {
        logError("❌ fargomoorhead.org fetch failed:", error)
        console.log(
          "⚠️  Skipping fargomoorhead.org refresh; keeping existing cached events.\n",
        )
      }
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
      try {
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
      } catch (error) {
        logError("❌ fargounderground.com fetch failed:", error)
        console.log(
          "⚠️  Skipping fargounderground.com refresh; keeping existing cached events.\n",
        )
      }
    }

    // Fetch from downtownfargo.com
    console.log(
      `   downtownfargo.com cache date: ${downtownLastUpdated || "never"} (today: ${today})`,
    )
    if (downtownLastUpdated === today) {
      console.log("⏭️  Using cached downtownfargo.com events (fresh today).\n")
    } else {
      try {
        console.log(
          "📥 Fetching events from downtownfargo.com (next 2 weeks)...",
        )
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
      } catch (error) {
        logError("❌ downtownfargo.com fetch failed:", error)
        console.log(
          "⚠️  Skipping downtownfargo.com refresh; keeping existing cached events.\n",
        )
      }
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
      try {
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
      } catch (error) {
        logError("❌ westfargoevents.com fetch failed:", error)
        console.log(
          "⚠️  Skipping westfargoevents.com refresh; keeping existing cached events.\n",
        )
      }
    }

    // Fetch from fargolibrary.org
    console.log(
      `   fargolibrary.org cache date: ${fargoLibraryLastUpdated || "never"} (today: ${today})`,
    )
    if (fargoLibraryLastUpdated === today) {
      console.log("⏭️  Using cached fargolibrary.org events (fresh today).\n")
    } else {
      try {
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
      } catch (error) {
        logError("❌ fargolibrary.org fetch failed:", error)
        console.log(
          "⚠️  Skipping fargolibrary.org refresh; keeping existing cached events.\n",
        )
      }
    }

    // Fetch from westfargolibrary.org
    console.log(
      `   westfargolibrary.org cache date: ${westFargoLibraryLastUpdated || "never"} (today: ${today})`,
    )
    if (westFargoLibraryLastUpdated === today) {
      console.log(
        "⏭️  Using cached westfargolibrary.org events (fresh today).\n",
      )
    } else {
      try {
        console.log(
          "📥 Fetching events from westfargolibrary.org (next 2 weeks)...",
        )
        const westFargoLibraryEvents =
          await westFargoLibraryFetcher.fetchEvents()
        console.log(`✓ Fetched ${westFargoLibraryEvents.length} events\n`)

        console.log("💾 Storing westfargolibrary.org events...")
        let westFargoLibraryInserted = 0
        for (const event of westFargoLibraryEvents) {
          const storedEvent =
            westFargoLibraryFetcher.transformToStoredEvent(event)
          db.insertEvent(storedEvent)
          westFargoLibraryInserted++
        }
        db.setSourceLastUpdatedDate("westfargolibrary.org", today)
        console.log(`✓ Processed ${westFargoLibraryInserted} events\n`)
      } catch (error) {
        logError("❌ westfargolibrary.org fetch failed:", error)
        console.log(
          "⚠️  Skipping westfargolibrary.org refresh; keeping existing cached events.\n",
        )
      }
    }

    // Fetch from larl.org
    console.log(
      `   larl.org cache date: ${moorheadLibraryLastUpdated || "never"} (today: ${today})`,
    )
    if (moorheadLibraryLastUpdated === today) {
      console.log(
        "⏭️  Using cached larl.org events (fresh today).\n",
      )
    } else {
      try {
        console.log(
          "📥 Fetching events from larl.org (next 2 weeks)...",
        )
        const moorheadLibraryEvents =
          await moorheadLibraryFetcher.fetchEvents()
        console.log(`✓ Fetched ${moorheadLibraryEvents.length} events\n`)

        console.log("💾 Storing larl.org events...")
        let moorheadLibraryInserted = 0
        for (const event of moorheadLibraryEvents) {
          const storedEvent =
            moorheadLibraryFetcher.transformToStoredEvent(event)
          db.insertEvent(storedEvent)
          moorheadLibraryInserted++
        }
        db.setSourceLastUpdatedDate("larl.org", today)
        console.log(`✓ Processed ${moorheadLibraryInserted} events\n`)
      } catch (error) {
        logError("❌ larl.org fetch failed:", error)
        console.log(
          "⚠️  Skipping larl.org refresh; keeping existing cached events.\n",
        )
      }
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
    const fargoStored = db.getEventsBySource("fargomoorhead.org")
    const undergroundStored = db.getEventsBySource("fargounderground.com")
    const downtownStored = db.getEventsBySource("downtownfargo.com")
    const westFargoStored = db.getEventsBySource("westfargoevents.com")

    const fargoLibraryStored = db.getEventsBySource("fargolibrary.org")
    const westFargoLibraryStored = db.getEventsBySource("westfargolibrary.org")
    const moorheadLibraryStored = db.getEventsBySource("larl.org")

    // Find matches between all source pairs, plus within each source
    // (catches re-posts after a delete, recurring-event ID churn, etc.)
    const allMatches = [
      ...findMatches(fargoStored, undergroundStored, 0.65),
      ...findMatches(fargoStored, downtownStored, 0.65),
      ...findMatches(fargoStored, westFargoStored, 0.65),
      ...findMatches(fargoStored, fargoLibraryStored, 0.65),
      ...findMatches(fargoStored, westFargoLibraryStored, 0.65),
      ...findMatches(downtownStored, undergroundStored, 0.65),
      ...findMatches(downtownStored, westFargoStored, 0.65),
      ...findMatches(undergroundStored, westFargoStored, 0.65),
      ...findMatches(undergroundStored, fargoLibraryStored, 0.65),
      ...findMatches(undergroundStored, westFargoLibraryStored, 0.65),
      ...findMatches(westFargoStored, fargoLibraryStored, 0.65),
      ...findMatches(westFargoStored, westFargoLibraryStored, 0.65),
      ...findMatches(fargoLibraryStored, westFargoLibraryStored, 0.65),
      ...findMatches(fargoStored, moorheadLibraryStored, 0.65),
      ...findMatches(undergroundStored, moorheadLibraryStored, 0.65),
      ...findMatches(westFargoStored, moorheadLibraryStored, 0.65),
      ...findMatches(fargoLibraryStored, moorheadLibraryStored, 0.65),
      ...findMatches(westFargoLibraryStored, moorheadLibraryStored, 0.65),
      ...findSelfMatches(fargoStored),
      ...findSelfMatches(undergroundStored),
      ...findSelfMatches(downtownStored),
      ...findSelfMatches(westFargoStored),
      ...findSelfMatches(fargoLibraryStored),
      ...findSelfMatches(westFargoLibraryStored),
      ...findSelfMatches(moorheadLibraryStored),
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
