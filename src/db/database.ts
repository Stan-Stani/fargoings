import Database from 'better-sqlite3';
import path from 'path';
import { StoredEvent } from '../types/event';

export class EventDatabase {
  private db: Database.Database;

  constructor(dbPath: string = './events.db') {
    this.db = new Database(dbPath);
    this.initialize();
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
    `);
  }

  insertEvent(event: Omit<StoredEvent, 'id' | 'createdAt' | 'updatedAt'>): void {
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
    `);

    stmt.run(event);
  }

  getEvents(limit: number = 100, offset: number = 0): StoredEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      ORDER BY date ASC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset) as StoredEvent[];
  }

  getEventsByDateRange(startDate: string, endDate: string): StoredEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE startDate >= ? AND endDate <= ?
      ORDER BY startDate ASC
    `);
    return stmt.all(startDate, endDate) as StoredEvent[];
  }

  getEventsBySource(source: string): StoredEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE source = ?
      ORDER BY startDate ASC
    `);
    return stmt.all(source) as StoredEvent[];
  }

  getTotalCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number };
    return result.count;
  }

  close() {
    this.db.close();
  }
}
