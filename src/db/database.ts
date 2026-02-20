import Database from "better-sqlite3"
import { StoredEvent } from "../types/event"
import { VENUE_RULES } from "../enrichment/venues"

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
  source: string
  createdAt: string
  updatedAt: string
}

export interface DisplayEventQueryResult {
  rows: DisplayEvent[]
  total: number
}

export class EventDatabase {
  private db: Database.Database
  private readonly displayTimeZone = "America/Chicago"

  constructor(dbPath: string = "./events.db") {
    this.db = new Database(dbPath)
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
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_display_events_date ON display_events(date);
      CREATE INDEX IF NOT EXISTS idx_display_events_source ON display_events(source);
    `)
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
        location = @location,
        date = @date,
        startTime = @startTime,
        startDate = @startDate,
        endDate = @endDate,
        latitude = @latitude,
        longitude = @longitude,
        city = @city,
        imageUrl = @imageUrl,
        categories = @categories,
        updatedAt = CURRENT_TIMESTAMP
    `)

    const normalizedEvent = {
      ...event,
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

    // Build result with alt URLs for matched events
    const matchMap = new Map<string, { url: string; source: string }>()
    const matches = this.getMatches("medium")
    for (const match of matches) {
      // eventId2 is fargounderground, eventId1 is fargomoorhead
      const event1 = this.db
        .prepare("SELECT url, source FROM events WHERE eventId = ?")
        .get(match.eventId1) as { url: string; source: string } | undefined
      if (event1) {
        matchMap.set(match.eventId2, { url: event1.url, source: event1.source })
      }
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
    const deduplicatedEvents = this.getDeduplicatedEvents(
      this.getTotalCount(),
      0,
    )

    const deleteStmt = this.db.prepare("DELETE FROM display_events")
    const insertStmt = this.db.prepare(`
      INSERT INTO display_events (eventId, title, url, altUrl, location, date, startTime, city, imageUrl, categories, source)
      VALUES (@eventId, @title, @url, @altUrl, @location, @date, @startTime, @city, @imageUrl, @categories, @source)
    `)

    const transaction = this.db.transaction(() => {
      deleteStmt.run()
      for (const event of deduplicatedEvents) {
        insertStmt.run({
          eventId: event.eventId,
          title: event.title,
          url: event.url,
          altUrl: event.altUrl || null,
          location: event.location,
          date: event.date,
          startTime: event.startTime,
          city: event.city,
          imageUrl: event.imageUrl,
          categories: event.categories,
          source: event.source,
        })
      }
    })

    transaction()
    return deduplicatedEvents.length
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
  ): DisplayEventQueryResult {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const dir = sortDir === "desc" ? "DESC" : "ASC"

    if (!normalizedQuery) {
      const rows = this.getDisplayEvents(limit, offset, sortDir)
      return {
        rows,
        total: this.getDisplayCount(),
      }
    }

    const likeParam = `%${normalizedQuery}%`

    const whereClause = `
      WHERE date >= ?
        AND (
             lower(title) LIKE ?
         OR lower(coalesce(location, '')) LIKE ?
         OR lower(coalesce(city, '')) LIKE ?
         OR lower(coalesce(categories, '')) LIKE ?
         OR lower(coalesce(source, '')) LIKE ?
        )
    `

    const todayInFargo = this.getCurrentDateInTimeZone(this.displayTimeZone)

    const rows = this.db
      .prepare(
        `
      SELECT * FROM display_events
      ${whereClause}
      ORDER BY date ${dir}, COALESCE(startTime, '23:59:59') ${dir}, id ${dir}
      LIMIT ? OFFSET ?
    `,
      )
      .all(
        todayInFargo,
        likeParam,
        likeParam,
        likeParam,
        likeParam,
        likeParam,
        limit,
        offset,
      ) as DisplayEvent[]

    const total = (
      this.db
        .prepare(
          `
      SELECT COUNT(*) as count FROM display_events
      ${whereClause}
    `,
        )
        .get(
          todayInFargo,
          likeParam,
          likeParam,
          likeParam,
          likeParam,
          likeParam,
        ) as { count: number }
    ).count

    return { rows, total }
  }

  /**
   * For events where location is null, check if the title matches a known
   * venue rule and backfill location/city/coords in the events table.
   * Returns the number of rows updated.
   */
  enrichVenueLocations(): number {
    const nullLocationEvents = this.db
      .prepare(
        "SELECT eventId, title FROM events WHERE location IS NULL OR location = ''",
      )
      .all() as { eventId: string; title: string }[]

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
      for (const row of nullLocationEvents) {
        for (const rule of VENUE_RULES) {
          if (rule.titlePattern.test(row.title)) {
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

  close() {
    this.db.close()
  }
}
