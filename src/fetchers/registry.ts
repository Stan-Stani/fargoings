import { findMatches, findSelfMatches, MatchScore } from "../dedup/matcher"
import { EventDatabase } from "../db/database"
import { logError } from "../log"
import { StoredEvent } from "../types/event"
import { AquariumFargoFetcher } from "./aquariumfargo-com"
import { DowntownFargoFetcher } from "./downtownfargo-com"
import { DrekkerBrewingFetcher } from "./drekkerbrewing-com"
import { FargoLibraryFetcher } from "./fargolibrary-org"
import { FargoParksFetcher } from "./fargoparks-com"
import { FargoFetcher } from "./fargomoorhead-com"
import { FargoUndergroundFetcher } from "./fargounderground-com"
import { MoorheadLibraryFetcher } from "./moorheadlibrary-org"
import { SidearmSportsFetcher } from "./sidearm-sports"
import { SOURCE_INFO, SourceInfo } from "./sources"
import { WestFargoEventsFetcher } from "./westfargoevents-com"
import { WestFargoLibraryFetcher } from "./westfargolibrary-org"

export type FetchedEvent = Omit<StoredEvent, "id" | "createdAt" | "updatedAt">

export interface SourceDefinition extends SourceInfo {
  /**
   * Fetches and transforms all events for this source. Instantiates the
   * fetcher lazily so env overrides (e.g. the WFPL/LARL relay URLs from
   * .env) are read at call time, after dotenv has loaded.
   */
  fetch: () => Promise<FetchedEvent[]>
}

const FETCH_FNS: Record<string, () => Promise<FetchedEvent[]>> = {
  "fargomoorhead.org": async () => {
    const fetcher = new FargoFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "downtownfargo.com": async () => {
    const fetcher = new DowntownFargoFetcher()
    const events = await fetcher.fetchEvents(14)
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "fargounderground.com": async () => {
    const fetcher = new FargoUndergroundFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "westfargoevents.com": async () => {
    const fetcher = new WestFargoEventsFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "fargolibrary.org": async () => {
    const fetcher = new FargoLibraryFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "westfargolibrary.org": async () => {
    const fetcher = new WestFargoLibraryFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "larl.org": async () => {
    const fetcher = new MoorheadLibraryFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "drekkerbrewing.com": async () => {
    const fetcher = new DrekkerBrewingFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "gobison.com": async () => {
    const fetcher = new SidearmSportsFetcher({
      baseUrl: "https://gobison.com",
      schoolName: "NDSU Athletics",
      sourceId: "gobison.com",
      city: "Fargo",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "msumdragons.com": async () => {
    const fetcher = new SidearmSportsFetcher({
      baseUrl: "https://www.msumdragons.com",
      schoolName: "MSUM Athletics",
      sourceId: "msumdragons.com",
      city: "Moorhead",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "aquariumfargo.com": async () => {
    const fetcher = new AquariumFargoFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "fargoparks.com": async () => {
    const fetcher = new FargoParksFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
}

/**
 * Single source of truth for every event source. Adding a source means one
 * entry in sources.ts plus one fetch closure above — index.ts and refetch.ts
 * both iterate this list, so they can't drift apart.
 */
export const SOURCES: SourceDefinition[] = SOURCE_INFO.map((info) => {
  const fetch = FETCH_FNS[info.source]
  if (!fetch) {
    throw new Error(`No fetch function registered for source ${info.source}`)
  }
  return { ...info, fetch }
})

export interface SourceRunResult {
  source: string
  status: "ok" | "error" | "skipped"
  eventCount: number | null
  durationMs: number
  errorMessage: string | null
}

/**
 * Fetch and store one source, recording the outcome in source_runs.
 *
 * Non-force (weekly cron): skips sources already fetched today; on error the
 * existing cached rows are kept. Force (refetch): fetches first and only
 * deletes the old rows once the fetch succeeded, so a failed fetch never
 * loses data.
 */
export async function runSource(
  db: EventDatabase,
  def: SourceDefinition,
  opts: { force: boolean; today: string },
): Promise<SourceRunResult> {
  const runType = opts.force ? "refetch" : "fetch"
  const startedAt = Date.now()

  if (!opts.force) {
    const lastUpdated = db.getSourceLastUpdatedDate(def.source)
    console.log(
      `   ${def.source} cache date: ${lastUpdated || "never"} (today: ${opts.today})`,
    )
    if (lastUpdated === opts.today) {
      console.log(`⏭️  Using cached ${def.source} events (fresh today).\n`)
      const result: SourceRunResult = {
        source: def.source,
        status: "skipped",
        eventCount: null,
        durationMs: 0,
        errorMessage: null,
      }
      db.recordSourceRun({ ...result, runType })
      return result
    }
  }

  try {
    console.log(`📥 Fetching events from ${def.source}...`)
    const events = await def.fetch()
    console.log(`✓ Fetched ${events.length} events`)

    if (opts.force) {
      db.deleteEventsBySource(def.source)
    }
    for (const event of events) {
      db.insertEvent(event)
    }
    db.setSourceLastUpdatedDate(def.source, opts.today)
    console.log(`✓ Processed ${events.length} events\n`)

    const result: SourceRunResult = {
      source: def.source,
      status: "ok",
      eventCount: events.length,
      durationMs: Date.now() - startedAt,
      errorMessage: null,
    }
    db.recordSourceRun({ ...result, runType })
    return result
  } catch (error) {
    logError(`❌ ${def.source} ${runType} failed:`, error)
    console.log(
      `⚠️  Keeping existing ${def.source} events (no delete performed).\n`,
    )
    const result: SourceRunResult = {
      source: def.source,
      status: "error",
      eventCount: null,
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    }
    db.recordSourceRun({ ...result, runType })
    return result
  }
}

/**
 * Score duplicate matches across all sources: every cross-source pair among
 * the general (non-sports) sources, ordered so the lower-dedupPriority
 * source is the dropped side, plus a same-source pass per source.
 */
export function buildAllMatches(db: EventDatabase): MatchScore[] {
  const storedBySource = new Map<string, StoredEvent[]>()
  for (const def of SOURCES) {
    storedBySource.set(def.source, db.getEventsBySource(def.source))
  }

  const matches: MatchScore[] = []

  const general = SOURCES.filter((def) => !def.sports).sort(
    (a, b) => a.dedupPriority - b.dedupPriority,
  )
  for (let i = 0; i < general.length; i++) {
    for (let j = i + 1; j < general.length; j++) {
      matches.push(
        ...findMatches(
          storedBySource.get(general[i].source)!,
          storedBySource.get(general[j].source)!,
          0.65,
        ),
      )
    }
  }

  // Sports schedules don't legitimately cross-list into the general feeds,
  // so they only self-match — and only on identical URLs, since fuzzy
  // scoring can't tell doubleheaders from reposts.
  for (const def of SOURCES) {
    matches.push(
      ...findSelfMatches(storedBySource.get(def.source)!, {
        urlOnly: def.sports,
      }),
    )
  }

  return matches
}

export function persistMatches(
  db: EventDatabase,
  matches: MatchScore[],
): { high: number; medium: number; low: number } {
  db.clearMatches()
  const byConfidence = { high: 0, medium: 0, low: 0 }
  for (const match of matches) {
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
  return byConfidence
}
