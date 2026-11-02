import Database from "better-sqlite3"
import { decodeHtmlEntities, normalizeText } from "../dedup/normalize"
import {
  isJunkLocation,
  VenueRule,
  venueRuleMatches,
} from "../enrichment/venues"
import {
  ALLOW_EMPTY_SOURCES,
  CAMPUS_SOURCES,
  CAMPUS_TITLE_PATTERNS,
  SOURCE_INFO,
  SPORTS_SOURCES,
} from "../fetchers/sources"
import {
  HIDDEN_BY_DEFAULT,
  isCanonicalCategory,
  isKnownUpstreamTag,
  resolveCategory,
} from "../enrichment/categories"
import {
  cleanTitle,
  normalizeLocation,
  staleTitleYear,
} from "../enrichment/normalize"
import { StoredEvent } from "../types/event"
import { getActiveCity } from "../cities"

export { SPORTS_SOURCES }

export interface EventMatch {
  id: number
  eventId1: string
  eventId2: string
  score: number
  confidence: string
  reasons: string
  matchType: string
  createdAt: string
}

export interface DisplayEvent {
  id: number
  eventId: string
  title: string
  url: string
  altUrl: string | null
  location: string | null
  date: string
  startTime: string | null
  city: string | null
  imageUrl: string | null
  categories: string
  /** Canonical category (see resolveCategory), computed at rebuild time. */
  category: string | null
  source: string
  latitude: number | null
  longitude: number | null
  /** 1 when the source stopped listing this future event (see flagPossiblyCancelled). */
  possiblyCancelled: number
  /** Series key when this row is part of a detected weekly/biweekly series. */
  recurringGroup: string | null
  /** Distinct upcoming dates in the series (within the stored window). */
  recurringCount: number | null
  recurringCadence: "daily" | "weekly" | "biweekly" | null
  /** Last day of a multi-day run, when known (see tagOngoingEvents). */
  ongoingThrough: string | null
  createdAt: string
  updatedAt: string
}

export interface DisplayEventQueryResult {
  rows: DisplayEvent[]
  total: number
}

export interface SourceRunRecord {
  source: string
  runType: string
  status: "ok" | "error" | "skipped"
  eventCount: number | null
  durationMs: number | null
  errorMessage: string | null
  /** UTC "YYYY-MM-DD HH:MM:SS" run start — comparable with CURRENT_TIMESTAMP. */
  startedAt: string | null
}

export interface EventIssue {
  source: string
  title: string
  date: string
  url: string
}

/** Things worth a human look. See getDataQualityReport. */
export interface DataQualityReport {
  /** Upcoming events with no venue, except Fargo Parks (which marks its own). */
  missingLocation: EventIssue[]
  /** Held out of the feed: the title names a year before the event's. */
  heldForReview: (EventIssue & { reason: string })[]
  /** Upcoming events no rule could categorize. */
  uncategorized: EventIssue[]
  /** Must stay empty: categories outside CANONICAL_CATEGORIES. */
  nonCanonicalCategories: string[]
  /** Upstream tags missing from the mapping tables. */
  unmappedTags: { source: string; tag: string; count: number }[]
  /** Upcoming events shown as "All day / time TBA", per source. */
  missingStartTime: { source: string; count: number }[]
}

export interface SourceHealth {
  source: string
  lastRunAt: string | null
  lastStatus: string | null
  lastEventCount: number | null
  lastSuccessAt: string | null
  lastErrorMessage: string | null
  consecutiveFailures: number
  flagged: boolean
  flagReasons: string[]
}

/**
 * An event spanning this many days or more is a multi-day run. One day isn't
 * enough: a late show ending after midnight has endDate = date + 1.
 */
const MIN_RUN_DAYS = 2

export class EventDatabase {
  private db: Database.Database
  private readonly displayTimeZone = getActiveCity().timeZone

  constructor(dbPath: string = getActiveCity().dbPath) {
    this.db = new Database(dbPath)
    // The weekly cron writer and the long-running API reader share this
    // file; WAL + a busy timeout keep readers from hitting SQLITE_BUSY
    // during the rebuild transaction.
    this.db.pragma("journal_mode = WAL")
    this.db.pragma("busy_timeout = 5000")
    this.initialize()
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eventId TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        location TEXT,
        date TEXT NOT NULL,
        startTime TEXT,
        startDate TEXT NOT NULL,
        endDate TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        city TEXT,
        imageUrl TEXT,
        categories TEXT,
        source TEXT NOT NULL,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_events_eventId ON events(eventId);
      CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
      CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);

      CREATE TABLE IF NOT EXISTS event_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eventId1 TEXT NOT NULL,
        eventId2 TEXT NOT NULL,
        score REAL NOT NULL,
        confidence TEXT NOT NULL,
        reasons TEXT,
        matchType TEXT DEFAULT 'auto',
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(eventId1, eventId2),
        FOREIGN KEY (eventId1) REFERENCES events(eventId),
        FOREIGN KEY (eventId2) REFERENCES events(eventId)
      );

      CREATE INDEX IF NOT EXISTS idx_matches_event1 ON event_matches(eventId1);
      CREATE INDEX IF NOT EXISTS idx_matches_event2 ON event_matches(eventId2);

      CREATE TABLE IF NOT EXISTS source_cache (
        source TEXT PRIMARY KEY,
        lastUpdatedDate TEXT NOT NULL,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS display_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eventId TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        altUrl TEXT,
        location TEXT,
        date TEXT NOT NULL,
        startTime TEXT,
        city TEXT,
        imageUrl TEXT,
        categories TEXT,
        source TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_display_events_date ON display_events(date);
      CREATE INDEX IF NOT EXISTS idx_display_events_source ON display_events(source);
    `)

    // Migrate existing display_events tables that predate the latitude/longitude columns
    const cols = (
      this.db.prepare("PRAGMA table_info(display_events)").all() as {
        name: string
      }[]
    ).map((c) => c.name)
    if (!cols.includes("latitude")) {
      this.db.exec(
        "ALTER TABLE display_events ADD COLUMN latitude REAL; ALTER TABLE display_events ADD COLUMN longitude REAL;",
      )
    }

    this.runMigrations()
  }

  /**
   * Versioned one-shot migrations via PRAGMA user_version. Each migration
   * runs once, in order, inside a transaction. The first process to open
   * the DB after a deploy applies them (cron, API server, or a CLI script —
   * all construct EventDatabase).
   */
  private runMigrations() {
    const version = this.db.pragma("user_version", { simple: true }) as number

    if (version < 1) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS source_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            runAt TEXT DEFAULT CURRENT_TIMESTAMP,
            runType TEXT NOT NULL,
            status TEXT NOT NULL,
            eventCount INTEGER,
            durationMs INTEGER,
            errorMessage TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_source_runs_source
            ON source_runs(source, id DESC);
        `)
        const displayCols = (
          this.db.prepare("PRAGMA table_info(display_events)").all() as {
            name: string
          }[]
        ).map((c) => c.name)
        if (!displayCols.includes("category")) {
          this.db.exec("ALTER TABLE display_events ADD COLUMN category TEXT")
        }
        this.db.pragma("user_version = 1")
      })()
    }

    if (version < 2) {
      // One-time decode of HTML entities now that insertEvent stores decoded
      // text (the API no longer decodes per request). display_events is
      // included so prod renders correctly before the next weekly rebuild.
      this.db.transaction(() => {
        for (const table of ["events", "display_events"]) {
          const rows = this.db
            .prepare(
              `SELECT id, title, location, city FROM ${table}
               WHERE title LIKE '%&%' OR location LIKE '%&%' OR city LIKE '%&%'`,
            )
            .all() as {
            id: number
            title: string
            location: string | null
            city: string | null
          }[]
          const update = this.db.prepare(
            `UPDATE ${table} SET title = ?, location = ?, city = ? WHERE id = ?`,
          )
          for (const row of rows) {
            const title = decodeHtmlEntities(row.title)
            const location = row.location
              ? decodeHtmlEntities(row.location)
              : row.location
            const city = row.city ? decodeHtmlEntities(row.city) : row.city
            if (
              title !== row.title ||
              location !== row.location ||
              city !== row.city
            ) {
              update.run(title, location, city, row.id)
            }
          }
        }
        // Backfill the category column for existing display rows.
        this.populateDisplayCategories()
        this.db.pragma("user_version = 2")
      })()
    }

    if (version < 3) {
      // Recurring-series detection ("Trivia every Tuesday"). Tagged at
      // rebuild time; tagged here too so prod collapses repeats immediately
      // after deploy instead of waiting for the next weekly rebuild.
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE display_events ADD COLUMN recurringGroup TEXT;
          ALTER TABLE display_events ADD COLUMN recurringCount INTEGER;
          ALTER TABLE display_events ADD COLUMN recurringCadence TEXT;
          CREATE INDEX IF NOT EXISTS idx_display_events_recurring
            ON display_events(recurringGroup);
        `)
        this.tagRecurringSeries()
        this.db.pragma("user_version = 3")
      })()
    }

    if (version < 4) {
      // Possibly-cancelled detection: track when an event was last seen
      // upstream (lastSeenAt) and when each fetch run started (startedAt) so
      // the rebuild can flag future rows that vanished from their source.
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE events ADD COLUMN lastSeenAt TEXT;
          ALTER TABLE source_runs ADD COLUMN startedAt TEXT;
          ALTER TABLE display_events ADD COLUMN possiblyCancelled INTEGER DEFAULT 0;
        `)
        // Best available approximation for existing rows; venue enrichment
        // also bumps updatedAt, so this can only over-estimate freshness
        // (no false flags from the backfill).
        this.db.exec("UPDATE events SET lastSeenAt = updatedAt")
        this.db.pragma("user_version = 4")
      })()
    }

    if (version < 5) {
      // downtownfargo eventIds now embed the occurrence date
      // (dtf_<slug>_<YYYY-MM-DD>) because the source reuses one URL for
      // every occurrence of a recurring event — with slug-only ids the
      // latest occurrence in the fetch window overwrote the nearer ones.
      // Rewrite existing rows to the new scheme so the next fetch upserts
      // onto them instead of inserting duplicates. Matches go first: the
      // rewrite joins events on the old ids. (Every dtf_ row is slug-only
      // at this point — the migration runs before the new fetcher can
      // write.) OR IGNORE covers the degenerate case of a match row whose
      // rewritten pair already exists. FK checks must wait for commit:
      // mid-transaction, matches point at parent ids that don't exist yet.
      this.db.transaction(() => {
        this.db.pragma("defer_foreign_keys = ON")
        for (const col of ["eventId1", "eventId2"]) {
          this.db.exec(`
            UPDATE OR IGNORE event_matches
               SET ${col} = (SELECT e.eventId || '_' || e.date
                               FROM events e WHERE e.eventId = ${col})
             WHERE ${col} GLOB 'dtf_*'
               AND EXISTS (SELECT 1 FROM events e WHERE e.eventId = ${col})
          `)
        }
        this.db.exec(`
          UPDATE events SET eventId = eventId || '_' || date
           WHERE source = 'downtownfargo.com'
        `)
        this.db.pragma("user_version = 5")
      })()
    }

    if (version < 6) {
      // Canonical categories, cleaned titles and locations, the venue table,
      // stale-title holds and multi-day runs. Rebuilt here so prod is right
      // as soon as this deploys. Merges that depend on the cleaned data need
      // a dedup pass (`npm run dedup`), which the next fetch also does.
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE display_events ADD COLUMN endDate TEXT;
          ALTER TABLE display_events ADD COLUMN ongoingThrough TEXT;
        `)
        this.normalizeStoredEvents()
        this.enrichVenueLocations()
        // These rows' endDate is the end of a whole recurrence (a weekly
        // trivia night "through April"). The fetcher now only sets a real end
        // for continuous runs, and the next fetch restores those.
        this.db.exec(
          "UPDATE events SET endDate = date WHERE source = 'fargomoorhead.org'",
        )
        this.rebuildDisplayEvents()
        this.db.pragma("user_version = 6")
      })()
    }
  }

  /** Apply cleanTitle/normalizeLocation to rows stored before they existed. */
  private normalizeStoredEvents(): void {
    const rows = this.db
      .prepare("SELECT id, title, location, date FROM events")
      .all() as {
      id: number
      title: string
      location: string | null
      date: string
    }[]
    const update = this.db.prepare(
      "UPDATE events SET title = ?, location = ? WHERE id = ?",
    )
    for (const row of rows) {
      const location = row.location && normalizeLocation(row.location)
      const title = cleanTitle(row.title, { date: row.date, location })
      if (title !== row.title || location !== row.location) {
        update.run(title, location, row.id)
      }
    }
  }

  /** Every category name in the categories JSON, decoded, in order. */
  private extractCategoryNames(categoriesRaw: string | null): string[] {
    if (!categoriesRaw) {
      return []
    }

    try {
      const parsed = JSON.parse(categoriesRaw) as unknown
      if (!Array.isArray(parsed)) return []

      const names: string[] = []
      for (const item of parsed) {
        if (typeof item === "string") {
          names.push(decodeHtmlEntities(item))
        } else if (item && typeof item === "object") {
          const record = item as Record<string, unknown>
          if (typeof record.catName === "string") {
            names.push(decodeHtmlEntities(record.catName))
          } else if (typeof record.name === "string") {
            names.push(decodeHtmlEntities(record.name))
          }
        }
      }
      return names
    } catch {
      return [decodeHtmlEntities(categoriesRaw)]
    }
  }

  /**
   * Set display_events.category for every row. Tags from rows that dedup
   * merged into this one count too, so a survivor from a source with no tags
   * (downtownfargo.com) keeps what the dropped copy knew. Callers run this
   * inside their own transaction.
   */
  private populateDisplayCategories(): void {
    const mergedNames = new Map<string, string[]>()
    const merged = this.db
      .prepare(
        `SELECT m.eventId2 AS kept, e.categories AS categories
         FROM event_matches m
         JOIN events e ON e.eventId = m.eventId1
         WHERE m.confidence IN ('high', 'medium')`,
      )
      .all() as { kept: string; categories: string | null }[]
    for (const row of merged) {
      const names = mergedNames.get(row.kept) ?? []
      names.push(...this.extractCategoryNames(row.categories))
      mergedNames.set(row.kept, names)
    }

    const rows = this.db
      .prepare(
        "SELECT id, eventId, title, location, categories, source FROM display_events",
      )
      .all() as {
      id: number
      eventId: string
      title: string
      location: string | null
      categories: string | null
      source: string
    }[]
    const update = this.db.prepare(
      "UPDATE display_events SET category = ? WHERE id = ?",
    )
    for (const row of rows) {
      const category = resolveCategory({
        title: row.title,
        location: row.location,
        source: row.source,
        names: this.extractCategoryNames(row.categories),
        mergedNames: mergedNames.get(row.eventId),
      })
      update.run(category, row.id)
    }
  }

  private normalizeDate(date: string): string {
    if (!date) {
      return date
    }

    const ymdMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (ymdMatch) {
      return date
    }

    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) {
      return date
    }

    const year = parsed.getFullYear()
    const month = String(parsed.getMonth() + 1).padStart(2, "0")
    const day = String(parsed.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  private normalizeTime(startTime: string | null): string | null {
    if (!startTime) {
      return null
    }

    const normalized = startTime.trim()

    const hmsMatch = normalized.match(/^(\d{2}):(\d{2}):(\d{2})$/)
    if (hmsMatch) {
      return normalized
    }

    const hmMatch = normalized.match(/^(\d{1,2}):(\d{2})$/)
    if (hmMatch) {
      const hours = Number(hmMatch[1])
      const minutes = Number(hmMatch[2])
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`
      }
    }

    const ampmMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
    if (ampmMatch) {
      let hours = Number(ampmMatch[1])
      const minutes = Number(ampmMatch[2])
      const period = ampmMatch[3].toUpperCase()

      if (hours >= 1 && hours <= 12 && minutes >= 0 && minutes <= 59) {
        if (period === "AM") {
          hours = hours % 12
        } else {
          hours = (hours % 12) + 12
        }
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`
      }
    }

    return startTime
  }

  private getCurrentDateInTimeZone(timeZone: string): string {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })

    const parts = formatter.formatToParts(new Date())
    const year = parts.find((part) => part.type === "year")?.value
    const month = parts.find((part) => part.type === "month")?.value
    const day = parts.find((part) => part.type === "day")?.value

    if (!year || !month || !day) {
      throw new Error(`Unable to compute current date for timezone ${timeZone}`)
    }

    return `${year}-${month}-${day}`
  }

  insertEvent(
    event: Omit<StoredEvent, "id" | "createdAt" | "updatedAt">,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (eventId, title, url, location, date, startTime, startDate, endDate, latitude, longitude, city, imageUrl, categories, source, lastSeenAt)
      VALUES (@eventId, @title, @url, @location, @date, @startTime, @startDate, @endDate, @latitude, @longitude, @city, @imageUrl, @categories, @source, CURRENT_TIMESTAMP)
      ON CONFLICT(eventId) DO UPDATE SET
        title = @title,
        url = @url,
        location = COALESCE(@location, events.location),
        date = @date,
        startTime = @startTime,
        startDate = @startDate,
        endDate = @endDate,
        latitude = COALESCE(@latitude, events.latitude),
        longitude = COALESCE(@longitude, events.longitude),
        city = COALESCE(@city, events.city),
        imageUrl = COALESCE(@imageUrl, events.imageUrl),
        categories = @categories,
        updatedAt = CURRENT_TIMESTAMP,
        -- "Seen upstream" signal; distinct from updatedAt, which venue
        -- enrichment also bumps.
        lastSeenAt = CURRENT_TIMESTAMP
    `)

    const date = this.normalizeDate(event.date)
    const location = event.location
      ? normalizeLocation(decodeHtmlEntities(event.location))
      : event.location
    const normalizedEvent = {
      ...event,
      // Decode HTML entities and normalize once at store time; the API serves
      // these fields verbatim. (categories JSON stays raw — the display
      // category is decoded when display_events.category is populated.)
      title: cleanTitle(decodeHtmlEntities(event.title), { date, location }),
      location,
      city: event.city ? decodeHtmlEntities(event.city) : event.city,
      date,
      startTime: this.normalizeTime(event.startTime),
      startDate: this.normalizeDate(event.startDate),
      endDate: this.normalizeDate(event.endDate),
    }

    stmt.run(normalizedEvent)
  }

  getEvents(limit: number = 100, offset: number = 0): StoredEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      ORDER BY date ASC, COALESCE(startTime, '23:59:59') ASC, id ASC
      LIMIT ? OFFSET ?
    `)
    return stmt.all(limit, offset) as StoredEvent[]
  }

  getEventsByDateRange(startDate: string, endDate: string): StoredEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE startDate >= ? AND endDate <= ?
      ORDER BY startDate ASC
    `)
    return stmt.all(startDate, endDate) as StoredEvent[]
  }

  getEventsBySource(source: string): StoredEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE source = ?
      ORDER BY startDate ASC
    `)
    return stmt.all(source) as StoredEvent[]
  }

  getSourceLastUpdatedDate(source: string): string | undefined {
    const stmt = this.db.prepare(`
      SELECT lastUpdatedDate
      FROM source_cache
      WHERE source = ?
    `)
    const row = stmt.get(source) as
      | { lastUpdatedDate: string | null }
      | undefined
    return row?.lastUpdatedDate || undefined
  }

  setSourceLastUpdatedDate(source: string, date: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO source_cache (source, lastUpdatedDate)
      VALUES (?, ?)
      ON CONFLICT(source) DO UPDATE SET
        lastUpdatedDate = excluded.lastUpdatedDate,
        updatedAt = CURRENT_TIMESTAMP
    `)
    stmt.run(source, date)
  }

  recordSourceRun(run: SourceRunRecord): void {
    this.db
      .prepare(
        `
      INSERT INTO source_runs (source, runType, status, eventCount, durationMs, errorMessage, startedAt)
      VALUES (@source, @runType, @status, @eventCount, @durationMs, @errorMessage, @startedAt)
    `,
      )
      .run(run)
    this.pruneSourceRuns()
  }

  /** Keep only the most recent N runs per source. */
  pruneSourceRuns(keepPerSource: number = 60): void {
    this.db
      .prepare(
        `
      DELETE FROM source_runs WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY source ORDER BY id DESC) AS rn
          FROM source_runs
        ) WHERE rn > ?
      )
    `,
      )
      .run(keepPerSource)
  }

  /**
   * Per-source health derived from source_runs. A source is flagged when its
   * last completed (non-skipped) run errored, when it has failed twice in a
   * row, or when it returned 0 events despite returning some within the last
   * 30 days (the silent-relay-death signature; sources marked allowEmpty are
   * exempt — their feeds go legitimately quiet between seasons). Sources with
   * no recorded runs yet are reported but not flagged.
   */
  getSourceHealth(expectedSources: string[] = []): SourceHealth[] {
    const rows = this.db
      .prepare("SELECT * FROM source_runs ORDER BY id DESC")
      .all() as (SourceRunRecord & { id: number; runAt: string })[]

    const bySource = new Map<string, (SourceRunRecord & { runAt: string })[]>()
    for (const row of rows) {
      // When an expected list is given, sources outside it are ignored —
      // old source_runs rows from a retired/unlisted source must not flag
      // health forever.
      if (expectedSources.length > 0 && !expectedSources.includes(row.source)) {
        continue
      }
      const list = bySource.get(row.source) || []
      list.push(row)
      bySource.set(row.source, list)
    }
    for (const source of expectedSources) {
      if (!bySource.has(source)) {
        bySource.set(source, [])
      }
    }

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const isRecent = (runAt: string) => {
      const parsed = new Date(runAt.replace(" ", "T") + "Z")
      return !Number.isNaN(parsed.getTime()) && parsed.getTime() >= thirtyDaysAgo
    }

    const health: SourceHealth[] = []
    for (const [source, runs] of bySource) {
      // Newest first; skipped runs are cache hits, not health signals.
      const completed = runs.filter((r) => r.status !== "skipped")
      const last = completed[0] ?? null
      const lastSuccess = completed.find((r) => r.status === "ok") ?? null
      const lastError = completed.find((r) => r.status === "error") ?? null

      let consecutiveFailures = 0
      for (const run of completed) {
        if (run.status !== "error") break
        consecutiveFailures++
      }

      const flagReasons: string[] = []
      if (last?.status === "error") {
        flagReasons.push("last run failed")
      }
      if (consecutiveFailures >= 2) {
        flagReasons.push(`${consecutiveFailures} consecutive failures`)
      }
      if (
        last?.status === "ok" &&
        last.eventCount === 0 &&
        !ALLOW_EMPTY_SOURCES.includes(source) &&
        completed.some(
          (r) =>
            r.status === "ok" &&
            (r.eventCount ?? 0) > 0 &&
            isRecent(r.runAt),
        )
      ) {
        flagReasons.push("returned 0 events (recently returned more)")
      }

      health.push({
        source,
        lastRunAt: runs[0]?.runAt ?? null,
        lastStatus: last?.status ?? null,
        lastEventCount: last?.eventCount ?? null,
        lastSuccessAt: lastSuccess?.runAt ?? null,
        lastErrorMessage: lastError?.errorMessage ?? null,
        consecutiveFailures,
        flagged: flagReasons.length > 0,
        flagReasons,
      })
    }

    health.sort((a, b) => a.source.localeCompare(b.source))
    return health
  }

  getEventIdsBySource(source: string): Set<string> {
    const stmt = this.db.prepare(`
      SELECT eventId FROM events
      WHERE source = ?
    `)
    const rows = stmt.all(source) as { eventId: string }[]
    return new Set(rows.map((r) => r.eventId))
  }

  deleteEventsBySource(source: string): number {
    // First get event IDs for this source
    const eventIds = this.getEventIdsBySource(source)

    // Delete any matches referencing these events
    const deleteMatchesStmt = this.db.prepare(`
      DELETE FROM event_matches
      WHERE eventId1 IN (SELECT eventId FROM events WHERE source = ?)
         OR eventId2 IN (SELECT eventId FROM events WHERE source = ?)
    `)
    deleteMatchesStmt.run(source, source)

    // Then delete the events
    const stmt = this.db.prepare(`DELETE FROM events WHERE source = ?`)
    const result = stmt.run(source)
    return result.changes
  }

  getTotalCount(): number {
    const result = this.db
      .prepare("SELECT COUNT(*) as count FROM events")
      .get() as { count: number }
    return result.count
  }

  // Match management methods

  insertMatch(match: {
    eventId1: string
    eventId2: string
    score: number
    confidence: string
    reasons: string[]
    matchType?: string
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO event_matches (eventId1, eventId2, score, confidence, reasons, matchType)
      VALUES (@eventId1, @eventId2, @score, @confidence, @reasons, @matchType)
      ON CONFLICT(eventId1, eventId2) DO UPDATE SET
        score = @score,
        confidence = @confidence,
        reasons = @reasons,
        matchType = @matchType
    `)

    stmt.run({
      eventId1: match.eventId1,
      eventId2: match.eventId2,
      score: match.score,
      confidence: match.confidence,
      reasons: JSON.stringify(match.reasons),
      matchType: match.matchType || "auto",
    })
  }

  clearMatches(): void {
    this.db.exec("DELETE FROM event_matches")
  }

  getMatches(minConfidence?: string): EventMatch[] {
    let sql = "SELECT * FROM event_matches"
    if (minConfidence) {
      const confidenceLevels = ["low", "medium", "high"]
      const minIndex = confidenceLevels.indexOf(minConfidence)
      const allowed = confidenceLevels
        .slice(minIndex)
        .map((c) => `'${c}'`)
        .join(",")
      sql += ` WHERE confidence IN (${allowed})`
    }
    sql += " ORDER BY score DESC"
    return this.db.prepare(sql).all() as EventMatch[]
  }

  getMatchCount(): number {
    const result = this.db
      .prepare("SELECT COUNT(*) as count FROM event_matches")
      .get() as { count: number }
    return result.count
  }

  /**
   * Get deduplicated events, preferring fargounderground.com as primary source
   * (richer data) but including URLs from both sources
   */
  getDeduplicatedEvents(
    limit: number = 100,
    offset: number = 0,
  ): (StoredEvent & { altUrl?: string; altSource?: string })[] {
    // Get all matched event IDs from fargomoorhead.org (secondary source)
    const matchedSecondaryIds = this.db
      .prepare(
        `
      SELECT eventId1 FROM event_matches WHERE confidence IN ('high', 'medium')
    `,
      )
      .all() as { eventId1: string }[]

    const excludeIds = new Set(matchedSecondaryIds.map((r) => r.eventId1))

    // Get all events, excluding matched secondary source events
    const allEvents = this.db
      .prepare(
        `
      SELECT * FROM events ORDER BY date ASC, COALESCE(startTime, '23:59:59') ASC, id ASC
    `,
      )
      .all() as StoredEvent[]

    // Build result with alt URLs for matched events.
    // Convention: eventId1 is the dropped row, eventId2 is the kept row.
    // For same-source matches (re-posts, recurring-id churn), we still drop
    // eventId1 but don't expose its URL as an alternate — both URLs point to
    // the same domain and the dropped one is usually a stale slug.
    const matchMap = new Map<string, { url: string; source: string }>()
    const matches = this.getMatches("medium")
    const lookupStmt = this.db.prepare(
      "SELECT url, source FROM events WHERE eventId = ?",
    )
    for (const match of matches) {
      const event1 = lookupStmt.get(match.eventId1) as
        | { url: string; source: string }
        | undefined
      if (!event1) continue
      const event2 = lookupStmt.get(match.eventId2) as
        | { url: string; source: string }
        | undefined
      if (event2 && event2.source === event1.source) continue
      matchMap.set(match.eventId2, { url: event1.url, source: event1.source })
    }

    const result: (StoredEvent & { altUrl?: string; altSource?: string })[] = []
    for (const event of allEvents) {
      if (excludeIds.has(event.eventId)) {
        continue // Skip duplicates from secondary source
      }

      const alt = matchMap.get(event.eventId)
      result.push({
        ...event,
        altUrl: alt?.url,
        altSource: alt?.source,
      })
    }

    return result.slice(offset, offset + limit)
  }

  getDeduplicatedCount(): number {
    const matchedCount = this.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM event_matches WHERE confidence IN ('high', 'medium')
    `,
      )
      .get() as { count: number }

    return this.getTotalCount() - matchedCount.count
  }

  rebuildDisplayEvents(): number {
    const todayInFargo = this.getCurrentDateInTimeZone(this.displayTimeZone)

    // Single SQL pass replacing the old load-everything-into-JS rebuild.
    // Semantics match getDeduplicatedEvents(): drop rows that appear as
    // eventId1 (the dropped side) of a high/medium match; surface the
    // dropped row's URL as altUrl only for cross-source matches. Past
    // events are excluded — the query layer already clamps to today, so
    // they were dead rows. The exception is a multi-day run already under
    // way (an exhibit that opened last week), which shows on today. Only if
    // the source's latest fetch worked and still lists it: fargomoorhead.org
    // stores one row per day it has seen a long run, and yesterday's copy
    // must not resurface alongside today's.
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM display_events").run()
      const result = this.db
        .prepare(
          `
        INSERT INTO display_events (eventId, title, url, altUrl, location, date, startTime, city, imageUrl, categories, source, latitude, longitude, endDate)
        SELECT
          e.eventId,
          e.title,
          e.url,
          (
            SELECT e1.url
            FROM event_matches m
            JOIN events e1 ON e1.eventId = m.eventId1
            WHERE m.eventId2 = e.eventId
              AND m.confidence IN ('high', 'medium')
              AND e1.source <> e.source
            ORDER BY m.score DESC, m.id DESC
            LIMIT 1
          ),
          e.location,
          MAX(e.date, @today),
          e.startTime,
          e.city,
          e.imageUrl,
          e.categories,
          e.source,
          e.latitude,
          e.longitude,
          e.endDate
        FROM events e
        WHERE (
            e.date >= @today
            OR (
              e.endDate >= @today
              AND julianday(e.endDate) - julianday(e.date) >= ${MIN_RUN_DAYS}
              AND e.lastSeenAt >= (
                SELECT MAX(r.startedAt) FROM source_runs r
                WHERE r.source = e.source AND r.status = 'ok'
              )
              AND (
                SELECT r.status FROM source_runs r
                WHERE r.source = e.source AND r.status <> 'skipped'
                ORDER BY r.id DESC LIMIT 1
              ) = 'ok'
            )
          )
          AND e.eventId NOT IN (
            SELECT eventId1 FROM event_matches WHERE confidence IN ('high', 'medium')
          )
      `,
        )
        .run({ today: todayInFargo })
      const held = this.holdStaleEvents()
      this.populateDisplayCategories()
      this.tagRecurringSeries()
      this.tagOngoingEvents(todayInFargo)
      this.flagPossiblyCancelled()
      return result.changes - held
    })

    return transaction()
  }

  /**
   * Take events whose title names an earlier year out of the feed (see
   * staleTitleYear). They stay in `events` and show up in
   * getDataQualityReport, so they come back on their own if the source fixes
   * the title. Returns how many rows were removed.
   */
  private holdStaleEvents(): number {
    const rows = this.db
      .prepare("SELECT id, title, date FROM display_events")
      .all() as { id: number; title: string; date: string }[]
    const remove = this.db.prepare("DELETE FROM display_events WHERE id = ?")
    let held = 0
    for (const row of rows) {
      if (staleTitleYear(row.title, row.date) !== null) {
        remove.run(row.id)
        held++
      }
    }
    return held
  }

  /**
   * Set ongoingThrough on multi-day runs, so one row can stand in for the
   * whole run. A run's end is the event's own end date when it spans at least
   * MIN_RUN_DAYS, otherwise the last date of a daily series. A daily series
   * that reaches the end of the fetch window may well continue, so it gets no
   * end date rather than a wrong one, and the UI just says "ongoing".
   */
  private tagOngoingEvents(today: string): void {
    this.db.exec(`
      UPDATE display_events SET ongoingThrough = endDate
      WHERE endDate IS NOT NULL
        AND julianday(endDate) - julianday(date) >= ${MIN_RUN_DAYS}
    `)

    const series = this.db
      .prepare(
        `SELECT recurringGroup, source, MAX(date) AS lastDate
         FROM display_events
         WHERE recurringCadence = 'daily'
         GROUP BY recurringGroup`,
      )
      .all() as { recurringGroup: string; source: string; lastDate: string }[]
    const setEnd = this.db.prepare(
      `UPDATE display_events SET ongoingThrough = ?
       WHERE recurringGroup = ? AND ongoingThrough IS NULL`,
    )
    for (const { recurringGroup, source, lastDate } of series) {
      const horizon =
        SOURCE_INFO.find((info) => info.source === source)?.fetchHorizonDays ??
        14
      const [y, m, d] = today.split("-").map(Number)
      const windowEnd = new Date(Date.UTC(y, m - 1, d + horizon - 1))
        .toISOString()
        .slice(0, 10)
      if (lastDate < windowEnd) setEnd.run(lastDate, recurringGroup)
    }
  }

  /**
   * Flag future display rows whose raw event was NOT returned by the most
   * recent successful fetch of its source — the upstream listing vanished,
   * which usually means cancelled (or moved, which regenerates the eventId).
   * Only applies within the source's fetch horizon: an event dated beyond
   * what the fetch window covers simply wasn't asked for, not removed.
   * Sports schedules and horizon-null sources are exempt. Skipped (cache
   * fresh) and errored runs are naturally safe because the reference point
   * is the last *successful* run, whose own inserts all have
   * lastSeenAt >= startedAt. Callers run it inside their own transaction.
   */
  private flagPossiblyCancelled(): void {
    const lastOkRun = this.db.prepare(
      `SELECT startedAt FROM source_runs
       WHERE source = ? AND status = 'ok' AND startedAt IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
    )
    const flag = this.db.prepare(
      `UPDATE display_events SET possiblyCancelled = 1
       WHERE source = @source
         AND date <= @horizonEnd
         AND eventId IN (
           SELECT eventId FROM events
           WHERE source = @source AND lastSeenAt < @startedAt
         )`,
    )

    for (const info of SOURCE_INFO) {
      if (info.sports) continue
      const horizonDays = info.fetchHorizonDays === undefined ? 14 : info.fetchHorizonDays
      if (horizonDays === null) continue

      const run = lastOkRun.get(info.source) as
        | { startedAt: string }
        | undefined
      if (!run) continue

      // startedAt is UTC; the horizon counts from the run's local date.
      const runDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: this.displayTimeZone,
      }).format(new Date(run.startedAt.replace(" ", "T") + "Z"))
      const [y, m, d] = runDate.split("-").map(Number)
      const horizonEnd = new Date(Date.UTC(y, m - 1, d + horizonDays))
        .toISOString()
        .slice(0, 10)

      flag.run({
        source: info.source,
        horizonEnd,
        startedAt: run.startedAt,
      })
    }
  }

  /**
   * Detect recurring series ("Trivia every Tuesday") among display rows and
   * tag them so the query layer can collapse a series to its next
   * occurrence. A group is the same (source, normalized title, location); it
   * counts as a series when its distinct dates are uniformly 7 days apart
   * (or uniformly 14 → "biweekly") — with ≥3 dates, or with exactly 2 dates
   * when every row also shares one non-null start time and a non-null
   * location (the usual 14-day fetch window only ever shows 2 occurrences of
   * a weekly event, but the stricter rule keeps two-part workshops intact).
   * A group on consecutive days at one start time is "daily": an exhibit whose
   * source lists every open day as its own event. That needs an exhibit-like
   * event on 2+ days, or 5+ days of anything else, so a comedian's run of
   * Thursday-to-Saturday shows stays three separate shows.
   * Sports schedules are excluded; weekly games are the product, not noise.
   * Callers run it inside their own transaction.
   */
  private tagRecurringSeries(): void {
    const placeholders = SPORTS_SOURCES.map(() => "?").join(", ")
    const rows = this.db
      .prepare(
        `SELECT id, source, title, location, date, startTime, category FROM display_events
         ${SPORTS_SOURCES.length ? `WHERE source NOT IN (${placeholders})` : ""}`,
      )
      .all(...SPORTS_SOURCES) as {
      id: number
      source: string
      title: string
      location: string | null
      date: string
      startTime: string | null
      category: string | null
    }[]

    const groups = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = `${row.source}|${normalizeText(row.title)}|${row.location ?? ""}`
      const list = groups.get(key) || []
      list.push(row)
      groups.set(key, list)
    }

    const dayNumber = (date: string) =>
      Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) /
      86_400_000

    const update = this.db.prepare(
      `UPDATE display_events
       SET recurringGroup = ?, recurringCount = ?, recurringCadence = ?
       WHERE id = ?`,
    )

    for (const [key, members] of groups) {
      const dates = Array.from(new Set(members.map((m) => m.date))).sort()
      if (dates.length < 2) continue

      const gaps: number[] = []
      for (let i = 1; i < dates.length; i++) {
        gaps.push(dayNumber(dates[i]) - dayNumber(dates[i - 1]))
      }
      const uniform = (n: number) => gaps.every((g) => g === n)
      const first = members[0]
      const isExhibit =
        first.category === "Visual Arts" ||
        /exhibit|gallery|museum/i.test(`${first.title} ${first.location ?? ""}`)
      // Weekends off still count as consecutive: an exhibit open Mon-Fri.
      const consecutive =
        gaps.every((g) => g <= 3) &&
        gaps.filter((g) => g === 1).length * 2 >= gaps.length &&
        new Set(members.map((m) => m.startTime)).size === 1
      const cadence = uniform(7)
        ? "weekly"
        : uniform(14)
          ? "biweekly"
          : consecutive && dates.length >= (isExhibit ? 2 : 5)
            ? "daily"
            : null
      if (!cadence) continue

      if (dates.length === 2 && cadence !== "daily") {
        const startTimes = new Set(members.map((m) => m.startTime))
        if (
          cadence !== "weekly" ||
          startTimes.size !== 1 ||
          startTimes.has(null) ||
          members[0].location == null
        ) {
          continue
        }
      }

      for (const member of members) {
        update.run(key, dates.length, cadence, member.id)
      }
    }
  }

  getDisplayEvents(
    limit: number = 100,
    offset: number = 0,
    sortDir: "asc" | "desc" = "asc",
  ): DisplayEvent[] {
    const dir = sortDir === "desc" ? "DESC" : "ASC"
    const todayInFargo = this.getCurrentDateInTimeZone(this.displayTimeZone)
    const stmt = this.db.prepare(`
      SELECT * FROM display_events
      WHERE date >= ?
      ORDER BY date ${dir}, COALESCE(startTime, '23:59:59') ${dir}, id ${dir}
      LIMIT ? OFFSET ?
    `)
    return stmt.all(todayInFargo, limit, offset) as DisplayEvent[]
  }

  /** Categories actually shown on current rows (feeds the filter dropdown). */
  getDistinctCategories(): string[] {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT category FROM display_events WHERE category IS NOT NULL ORDER BY category COLLATE NOCASE",
      )
      .all() as { category: string }[]
    return rows.map((row) => row.category)
  }

  getDisplayCount(): number {
    const todayInFargo = this.getCurrentDateInTimeZone(this.displayTimeZone)
    const result = this.db
      .prepare("SELECT COUNT(*) as count FROM display_events WHERE date >= ?")
      .get(todayInFargo) as { count: number }
    return result.count
  }

  queryDisplayEvents(
    searchQuery: string,
    limit: number,
    offset: number,
    sortDir: "asc" | "desc" = "asc",
    category: string = "",
    dateFrom: string = "",
    dateTo: string = "",
    includeSports: boolean = false,
    collapseRepeats: boolean = false,
    includeCampus: boolean = false,
  ): DisplayEventQueryResult {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const normalizedCategory = category.trim().toLowerCase()
    const dir = sortDir === "desc" ? "DESC" : "ASC"
    const todayInFargo = this.getCurrentDateInTimeZone(this.displayTimeZone)

    // dateFrom defaults to today (never show past events)
    const effectiveDateFrom =
      dateFrom && dateFrom >= todayInFargo ? dateFrom : todayInFargo

    const conditions: string[] = ["date >= ?"]
    const params: unknown[] = [effectiveDateFrom]

    if (dateTo) {
      conditions.push("date <= ?")
      params.push(dateTo)
    }

    if (normalizedQuery) {
      const likeParam = `%${normalizedQuery}%`
      conditions.push(`(
             lower(title) LIKE ?
         OR lower(coalesce(location, '')) LIKE ?
         OR lower(coalesce(city, '')) LIKE ?
         OR lower(coalesce(categories, '')) LIKE ?
         OR lower(coalesce(source, '')) LIKE ?
        )`)
      params.push(likeParam, likeParam, likeParam, likeParam, likeParam)
    }

    if (normalizedCategory) {
      // Canonical names match exactly, so a row's label and the filter it
      // appears under always agree. Any other name (an old link to "Jazz &
      // Blues") still finds rows that carry it upstream.
      if (isCanonicalCategory(category.trim())) {
        conditions.push("lower(coalesce(category, '')) = ?")
        params.push(normalizedCategory)
      } else {
        conditions.push(
          "(lower(coalesce(category, '')) = ? OR lower(coalesce(categories, '')) LIKE ?)",
        )
        params.push(normalizedCategory, `%${normalizedCategory}%`)
      }
    }

    // Sports schedules (college athletics, etc.) are high-volume and would
    // bury the rest of the feed, so they're hidden unless explicitly asked
    // for (the "Show sports" toggle, or picking Sports in the filter).
    const wantsSports = includeSports || normalizedCategory === "sports"
    if (!wantsSports && SPORTS_SOURCES.length > 0) {
      conditions.push(
        `source NOT IN (${SPORTS_SOURCES.map(() => "?").join(", ")})`,
      )
      params.push(...SPORTS_SOURCES)
    }

    // Same idea for sports and start-date rows from general calendars, except
    // that a search also finds them: someone typing "volleyball" means it.
    if (!normalizedQuery && !normalizedCategory) {
      const hidden = HIDDEN_BY_DEFAULT.filter(
        (name) => !(name === "Sports" && includeSports),
      )
      conditions.push(
        `coalesce(category, '') NOT IN (${hidden.map(() => "?").join(", ")})`,
      )
      params.push(...hidden)
    }

    // Student-life calendars and homecomings are aimed at enrolled students;
    // hidden unless the "Show campus" toggle is on.
    if (!includeCampus) {
      if (CAMPUS_SOURCES.length > 0) {
        conditions.push(
          `source NOT IN (${CAMPUS_SOURCES.map(() => "?").join(", ")})`,
        )
        params.push(...CAMPUS_SOURCES)
      }
      for (const pattern of CAMPUS_TITLE_PATTERNS) {
        conditions.push("lower(title) NOT LIKE ?")
        params.push(pattern)
      }
    }

    // Collapse a recurring series to its next occurrence *within the
    // filtered range* — computed live (not baked at rebuild) so it stays
    // correct as days pass between weekly rebuilds and under the
    // today/weekend/week presets.
    if (collapseRepeats) {
      conditions.push(`(
        recurringGroup IS NULL OR date = (
          SELECT MIN(d2.date) FROM display_events d2
          WHERE d2.recurringGroup = display_events.recurringGroup
            AND d2.date >= ?
            AND (? = '' OR d2.date <= ?)
        )
      )`)
      params.push(effectiveDateFrom, dateTo, dateTo)
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`
    const orderClause = `ORDER BY date ${dir}, COALESCE(startTime, '23:59:59') ${dir}, id ${dir}`

    const rows = this.db
      .prepare(
        `SELECT * FROM display_events ${whereClause} ${orderClause} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as DisplayEvent[]

    const total = (
      this.db
        .prepare(
          `SELECT COUNT(*) as count FROM display_events ${whereClause}`,
        )
        .get(...params) as { count: number }
    ).count

    return { rows, total }
  }

  /**
   * Re-apply all venue rules to every event whose title or location matches,
   * regardless of whether location data is already set. Use this after
   * updating venue coordinates in venues.ts to fix stale enrichment data
   * without refetching.
   * Returns the number of rows updated.
   */
  reapplyVenueLocations(): number {
    const allEvents = this.db
      .prepare("SELECT eventId, title, location FROM events")
      .all() as { eventId: string; title: string; location: string | null }[]

    const updateStmt = this.db.prepare(`
      UPDATE events
      SET location = @location,
          city = @city,
          latitude = @latitude,
          longitude = @longitude,
          updatedAt = CURRENT_TIMESTAMP
      WHERE eventId = @eventId
    `)

    let count = 0
    const transaction = this.db.transaction(() => {
      for (const row of allEvents) {
        for (const rule of getActiveCity().venueRules) {
          if (venueRuleMatches(rule, row.title, row.location)) {
            updateStmt.run({
              location: rule.location,
              city: rule.city,
              latitude: rule.latitude,
              longitude: rule.longitude,
              eventId: row.eventId,
            })
            count++
            break
          }
        }
      }
    })
    transaction()
    return count
  }

  /**
   * Null out stored locations that are pure geographic filler (see
   * isJunkLocation), e.g. the bare "ND" that fargounderground.com's iCal feed
   * exports for venue records with only the state set. New rows are already
   * cleaned at ingest (cleanICalLocation); this catches rows stored before
   * that cleaning existed, which upserts alone never fix because the upsert
   * COALESCE-preserves the old location when the incoming one is null.
   * Returns the number of rows cleared.
   */
  clearJunkLocations(): number {
    const rows = this.db
      .prepare("SELECT DISTINCT location FROM events WHERE location IS NOT NULL")
      .all() as { location: string }[]

    const clearStmt = this.db.prepare(`
      UPDATE events
      SET location = NULL, updatedAt = CURRENT_TIMESTAMP
      WHERE location = ?
    `)

    let count = 0
    const transaction = this.db.transaction(() => {
      for (const { location } of rows) {
        if (isJunkLocation(location)) {
          count += clearStmt.run(location).changes
        }
      }
    })
    transaction()
    return count
  }

  /**
   * Upcoming events with no location — the candidates for page-based venue
   * enrichment (src/enrichment/pages.ts). `today` is a local YYYY-MM-DD.
   */
  getLocationlessUpcomingEvents(
    today: string,
  ): { eventId: string; url: string }[] {
    return this.db
      .prepare(
        `SELECT eventId, url FROM events
         WHERE location IS NULL AND url IS NOT NULL AND url != '' AND date >= ?
         ORDER BY date ASC`,
      )
      .all(today) as { eventId: string; url: string }[]
  }

  /** Apply one venue rule's location/city/coords to a single event. */
  applyVenueRule(eventId: string, rule: VenueRule): void {
    this.db
      .prepare(
        `UPDATE events
         SET location = @location,
             city = @city,
             latitude = @latitude,
             longitude = @longitude,
             updatedAt = CURRENT_TIMESTAMP
         WHERE eventId = @eventId`,
      )
      .run({
        location: rule.location,
        city: rule.city,
        latitude: rule.latitude,
        longitude: rule.longitude,
        eventId,
      })
  }

  /**
   * For events that match a known venue rule by title or location, ensure
   * their location/city/coords match the rule. This both backfills missing
   * data AND corrects wrong data from sources (e.g. outdated addresses).
   * Only writes when data actually differs from the rule.
   * Returns the number of rows updated.
   */
  enrichVenueLocations(): number {
    const allEvents = this.db
      .prepare(
        "SELECT eventId, title, location, city, latitude, longitude FROM events",
      )
      .all() as {
        eventId: string
        title: string
        location: string | null
        city: string | null
        latitude: number | null
        longitude: number | null
      }[]

    const updateStmt = this.db.prepare(`
      UPDATE events
      SET location = @location,
          city = @city,
          latitude = @latitude,
          longitude = @longitude,
          updatedAt = CURRENT_TIMESTAMP
      WHERE eventId = @eventId
    `)

    let count = 0
    const transaction = this.db.transaction(() => {
      for (const row of allEvents) {
        for (const rule of getActiveCity().venueRules) {
          if (venueRuleMatches(rule, row.title, row.location)) {
            if (
              row.location !== rule.location ||
              row.city !== rule.city ||
              row.latitude !== rule.latitude ||
              row.longitude !== rule.longitude
            ) {
              updateStmt.run({
                location: rule.location,
                city: rule.city,
                latitude: rule.latitude,
                longitude: rule.longitude,
                eventId: row.eventId,
              })
              count++
            }
            break
          }
        }
      }
    })
    transaction()
    return count
  }

  /**
   * What the pipeline couldn't fix on its own: held events, missing venues,
   * uncategorized rows and upstream tags that need adding to the tables.
   * Served at /api/health/data-quality and by `npm run quality`.
   */
  getDataQualityReport(): DataQualityReport {
    const today = this.getCurrentDateInTimeZone(this.displayTimeZone)
    const issueColumns = "source, title, date, url"

    const missingLocation = this.db
      .prepare(
        `SELECT ${issueColumns} FROM display_events
         WHERE location IS NULL AND source <> 'fargoparks.com' AND date >= ?
         ORDER BY source, date`,
      )
      .all(today) as EventIssue[]

    const uncategorized = this.db
      .prepare(
        `SELECT ${issueColumns} FROM display_events
         WHERE category IS NULL AND date >= ?
         ORDER BY source, date`,
      )
      .all(today) as EventIssue[]

    const upcoming = this.db
      .prepare(
        `SELECT ${issueColumns}, categories FROM events WHERE date >= ?
         ORDER BY date`,
      )
      .all(today) as (EventIssue & { categories: string | null })[]

    const heldForReview: DataQualityReport["heldForReview"] = []
    const unmapped = new Map<string, DataQualityReport["unmappedTags"][number]>()
    for (const { categories, ...event } of upcoming) {
      const year = staleTitleYear(event.title, event.date)
      if (year !== null) {
        heldForReview.push({
          ...event,
          reason: `title names ${year}, event is in ${event.date.slice(0, 4)}`,
        })
      }
      for (const tag of this.extractCategoryNames(categories)) {
        if (isKnownUpstreamTag(tag, event.source)) continue
        const key = `${event.source}|${tag}`
        const entry = unmapped.get(key) ?? { source: event.source, tag, count: 0 }
        entry.count++
        unmapped.set(key, entry)
      }
    }

    const nonCanonicalCategories = this.getDistinctCategories().filter(
      (name) => !isCanonicalCategory(name),
    )

    const missingStartTime = this.db
      .prepare(
        `SELECT source, COUNT(*) AS count FROM display_events
         WHERE startTime IS NULL AND date >= ?
         GROUP BY source ORDER BY count DESC`,
      )
      .all(today) as { source: string; count: number }[]

    return {
      missingLocation,
      heldForReview,
      uncategorized,
      nonCanonicalCategories,
      unmappedTags: Array.from(unmapped.values()).sort(
        (a, b) => b.count - a.count,
      ),
      missingStartTime,
    }
  }

  close() {
    this.db.close()
  }
}
