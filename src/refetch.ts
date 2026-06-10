import "dotenv/config"
import { EventDatabase } from "./db/database"
import {
  buildAllMatches,
  persistMatches,
  runSource,
  SOURCES,
} from "./fetchers/registry"

const ALL_SOURCES = SOURCES.map((def) => def.source)

const SOURCE_ALIASES: Record<string, string> = {}
for (const def of SOURCES) {
  for (const alias of def.aliases) {
    SOURCE_ALIASES[alias] = def.source
  }
}

function parseSelectedSources(argv: string[]): Set<string> {
  const selected = new Set<string>()

  const takeValues = (value: string) => {
    for (const raw of value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const normalized = raw.toLowerCase()
      const mapped =
        SOURCE_ALIASES[normalized] ??
        (ALL_SOURCES.includes(raw) ? raw : undefined)

      if (!mapped) {
        throw new Error(
          `Unknown source '${raw}'. Valid: ${ALL_SOURCES.join(", ")} (aliases: ${Object.keys(SOURCE_ALIASES).join(", ")})`,
        )
      }
      selected.add(mapped)
    }
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--source" || arg === "--sources") {
      const next = argv[i + 1]
      if (!next) {
        throw new Error(`${arg} requires a value`)
      }
      takeValues(next)
      i++
      continue
    }

    if (arg.startsWith("--source=") || arg.startsWith("--sources=")) {
      const [, value] = arg.split("=", 2)
      if (!value) {
        throw new Error(`${arg} requires a value after '='`)
      }
      takeValues(value)
      continue
    }
  }

  // Default: no filter => all sources
  if (selected.size === 0) {
    for (const source of ALL_SOURCES) {
      selected.add(source)
    }
  }

  return selected
}

function getLocalDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

async function main() {
  const selectedSources = parseSelectedSources(process.argv.slice(2))
  const selectedList = Array.from(selectedSources)
  const isAll = selectedList.length === ALL_SOURCES.length
  console.log(
    `🔄 Force re-fetching ${isAll ? "all sources" : `sources: ${selectedList.join(", ")}`} (ignoring cache)...\n`,
  )

  const db = new EventDatabase()

  try {
    const today = getLocalDateString(new Date())

    for (const def of SOURCES) {
      if (!selectedSources.has(def.source)) {
        console.log(`⏭️  Skipping ${def.source}\n`)
        continue
      }
      await runSource(db, def, { force: true, today })
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
    const allMatches = buildAllMatches(db)
    const byConfidence = persistMatches(db, allMatches)
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
    process.exitCode = 1
  } finally {
    db.close()
  }
}

main()
