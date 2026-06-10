import Database from "better-sqlite3"
import { decodeHtmlEntities, normalizeText } from "../dedup/normalize"
import { ALLOW_EMPTY_SOURCES, SPORTS_SOURCES } from "../fetchers/sources"
import { StoredEvent } from "../types/event"
import { VENUE_RULES } from "../enrichment/venues"

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
  /** First category name, decoded — precomputed at rebuild time for the API. */
  category: string | null
  source: string
  latitude: number | null
  longitude: number | null
  /** Series key when this row is part of a detected weekly/biweekly series. */
  recurringGroup: string | null
  /** Distinct upcoming dates in the series (within the stored window). */
  recurringCount: number | null
  recurringCadence: "weekly" | "biweekly" | null
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

export class EventDatabase {
  private db: Database.Database
  private readonly displayTimeZone = "America/Chicago"

  constructor(dbPath: string = "./events.db") {
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
  }

  /** First category name from the categories JSON, decoded, or null. */
  private extractCategory(categoriesRaw: string | null): string | null {
    if (!categoriesRaw) {
      return null
    }

    try {
      const parsed = JSON.parse(categoriesRaw) as unknown

      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0]

        if (typeof first === "string") {
          return decodeHtmlEntities(first)
        }

        if (first && typeof first === "object") {
          const record = first as Record<string, unknown>

          if (typeof record.catName === "string") {
            return decodeHtmlEntities(record.catName)
          }

          if (typeof record.name === "string") {
            return decodeHtmlEntities(record.name)
          }
        }
      }
    } catch {
      return decodeHtmlEntities(categoriesRaw)
    }

    return null
  }

  /**
   * Set display_events.category from the categories JSON. One UPDATE per
   * distinct categories string, so this touches far fewer rows than a
   * per-row pass. Callers run it inside their own transaction.
   */
  private populateDisplayCategories(): void {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT categories FROM display_events WHERE categories IS NOT NULL",
      )
      .all() as { categories: string }[]
    const update = this.db.prepare(
      "UPDATE display_events SET category = ? WHERE categories = ?",
    )
    for (const row of rows) {
      update.run(this.extractCategory(row.categories), row.categories)
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
      INSERT INTO events (eventId, title, url, location, date, startTime, startDate, endDate, latitude, longitude, city, imageUrl, categories, source)
      VALUES (@eventId, @title, @url, @location, @date, @startTime, @startDate, @endDate, @latitude, @longitude, @city, @imageUrl, @categories, @source)
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
        updatedAt = CURRENT_TIMESTAMP
    `)

    const normalizedEvent = {
      ...event,
      // Decode HTML entities once at store time; the API serves these
      // fields verbatim. (categories JSON stays raw — the display category
      // is decoded when display_events.category is populated.)
      title: decodeHtmlEntities(event.title),
      location: event.location ? decodeHtmlEntities(event.location) : event.location,
      city: event.city ? decodeHtmlEntities(event.city) : event.city,
      date: this.normalizeDate(event.date),
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
      INSERT INTO source_runs (source, runType, status, eventCount, durationMs, errorMessage)
      VALUES (@source, @runType, @status, @eventCount, @durationMs, @errorMessage)
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
    // they were dead rows.
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM display_events").run()
      const result = this.db
        .prepare(
          `
        INSERT INTO display_events (eventId, title, url, altUrl, location, date, startTime, city, imageUrl, categories, source, latitude, longitude)
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
          e.date,
          e.startTime,
          e.city,
          e.imageUrl,
          e.categories,
          e.source,
          e.latitude,
          e.longitude
        FROM events e
        WHERE e.date >= @today
          AND e.eventId NOT IN (
            SELECT eventId1 FROM event_matches WHERE confidence IN ('high', 'medium')
          )
      `,
        )
        .run({ today: todayInFargo })
      this.populateDisplayCategories()
      this.tagRecurringSeries()
      return result.changes
    })

    return transaction()
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
   * Sports schedules are excluded; weekly games are the product, not noise.
   * Callers run it inside their own transaction.
   */
  private tagRecurringSeries(): void {
    const placeholders = SPORTS_SOURCES.map(() => "?").join(", ")
    const rows = this.db
      .prepare(
        `SELECT id, source, title, location, date, startTime FROM display_events
         ${SPORTS_SOURCES.length ? `WHERE source NOT IN (${placeholders})` : ""}`,
      )
      .all(...SPORTS_SOURCES) as {
      id: number
      source: string
      title: string
      location: string | null
      date: string
      startTime: string | null
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
      const cadence = uniform(7) ? "weekly" : uniform(14) ? "biweekly" : null
      if (!cadence) continue

      if (dates.length === 2) {
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

  getDistinctCategories(): string[] {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT categories FROM display_events WHERE categories IS NOT NULL AND categories != '[]'",
      )
      .all() as { categories: string }[]

    const names = new Set<string>()
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.categories) as unknown
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === "object") {
              const rec = item as Record<string, unknown>
              if (typeof rec.catName === "string" && rec.catName) {
                names.add(rec.catName)
              }
            } else if (typeof item === "string" && item) {
              names.add(item)
            }
          }
        }
      } catch {
        // skip unparseable rows
      }
    }

    return Array.from(names).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    )
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
      conditions.push("lower(coalesce(categories, '')) LIKE ?")
      params.push(`%${normalizedCategory}%`)
    }

    // Sports schedules (college athletics, etc.) are high-volume and would
    // bury the rest of the feed, so they're hidden unless explicitly asked
    // for (the "Show sports" toggle).
    if (!includeSports && SPORTS_SOURCES.length > 0) {
      conditions.push(
        `source NOT IN (${SPORTS_SOURCES.map(() => "?").join(", ")})`,
      )
      params.push(...SPORTS_SOURCES)
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
        for (const rule of VENUE_RULES) {
          if (
            rule.titlePattern.test(row.title) ||
            (row.location != null && rule.titlePattern.test(row.location))
          ) {
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
        for (const rule of VENUE_RULES) {
          if (
            rule.titlePattern.test(row.title) ||
            (row.location != null && rule.titlePattern.test(row.location))
          ) {
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

  close() {
    this.db.close()
  }
}
