import "dotenv/config"
import { EventDatabase } from "./db/database"

/**
 * Print what the pipeline couldn't fix on its own (`npm run quality`). Same
 * data as GET /api/health/data-quality.
 */
function main() {
  const db = new EventDatabase()
  try {
    const report = db.getDataQualityReport()

    const section = (heading: string, lines: string[]) => {
      console.log(`\n${heading} (${lines.length})`)
      for (const line of lines) console.log(`  ${line}`)
    }

    section(
      "Held for review",
      report.heldForReview.map(
        (e) => `${e.date} ${e.source}: ${e.title} [${e.reason}]`,
      ),
    )
    section(
      "Missing location",
      report.missingLocation.map((e) => `${e.date} ${e.source}: ${e.title}`),
    )
    section(
      "Uncategorized",
      report.uncategorized.map((e) => `${e.date} ${e.source}: ${e.title}`),
    )
    section("Categories outside the canonical list", report.nonCanonicalCategories)
    section(
      "Upstream tags missing from the mapping tables",
      report.unmappedTags.map((t) => `${t.source}: ${t.tag} (${t.count})`),
    )
    section(
      "No start time",
      report.missingStartTime.map((s) => `${s.source}: ${s.count}`),
    )

    // A category outside the list is a bug, not a data problem.
    if (report.nonCanonicalCategories.length > 0) process.exitCode = 1
  } finally {
    db.close()
  }
}

main()
