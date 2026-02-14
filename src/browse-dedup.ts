import { EventDatabase } from "./db/database"
import { decodeHtmlEntities } from "./dedup/normalize"

const db = new EventDatabase()
const args = process.argv.slice(2)
const limit = parseInt(args[0]) || 50
const offset = parseInt(args[1]) || 0

const events = db.getDeduplicatedEvents(limit, offset)

console.log(
  `\n🎯 Deduplicated Events (${events.length} shown, offset: ${offset}):\n`,
)
console.log("─".repeat(80))

events.forEach((event, i) => {
  const [year, month, day] = event.date.split("-")
  const date = `${parseInt(month)}/${parseInt(day)}/${year}`
  const time = event.startTime
    ? (() => {
        const [h, m] = event.startTime.split(":").map(Number)
        return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
      })()
    : ""

  const title = decodeHtmlEntities(event.title)
  const location = event.location ? decodeHtmlEntities(event.location) : "TBD"

  console.log(`${offset + i + 1}. ${title}`)
  console.log(`   📍 ${location}`)
  console.log(`   📆 ${date} ${time}`)
  console.log(`   🏷️  ${event.source}`)
  console.log(`   🔗 ${event.url}`)
  if (event.altUrl) {
    console.log(`   🔗 ${event.altUrl}`)
  }
  console.log("")
})

console.log("─".repeat(80))
console.log(`Total unique events: ${db.getDeduplicatedCount()}`)
console.log(`Matches stored: ${db.getMatchCount()}`)
console.log(`\nUsage: npx tsx src/browse-dedup.ts [limit] [offset]`)

db.close()
