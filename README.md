# Fargoings - Fargo Event Aggregator

A Node.js/TypeScript event aggregator that fetches and stores events from multiple Fargo-Moorhead area sources, with automatic deduplication.

## Features

- Aggregates events from **3 sources**:
  - fargomoorhead.org (API with dynamic token)
  - fargounderground.com (JSON API)
  - downtownfargo.com (POST API + HTML scraping for locations)
- **Automatic deduplication** - Identifies duplicate events across sources using title/date/location matching
- Stores events in SQLite database
- Prevents duplicates with upsert logic
- TypeScript for type safety

## Setup

1. Install dependencies:

```bash
npm install
```

2. Run the aggregator:

```bash
npm start
```

## Scripts

- `npm start` - Fetch events from all sources and deduplicate (uses 1-day cache per source)
- `npm run browse` - Browse deduplicated events (default view)
- `npm run browse:raw` - Browse raw events from all sources (duplicates may appear)
- `npm run browse:dedup` - Browse deduplicated events only
- `npm run browse:display` - Browse rows from `display_events` (web-facing deduped table)
- `npm run web` - Start minimal webpage + API on `http://localhost:8787`
- `npm run web:dev` - Start Vite live-reload frontend on `http://localhost:8787` + API on `http://localhost:8788`
- `npm run search` - Search events by keyword (usage: `npm run search -- "keyword"`)
- `npm run refetch` - Force re-fetch all sources, ignoring daily cache
- `npm run dedup` - Run deduplication on existing events
- `npm run dev` - Run in watch mode
- `npm run build` - Build TypeScript to JavaScript

## Caching

- Cache is tracked per source in the `source_cache` table.
- `npm start` skips network fetch for a source when its cache date is already today.
- `npm start` fetches only stale sources and updates each source cache date after a successful fetch.
- `npm run refetch` always fetches all three sources and refreshes all cache dates.
- On a fresh database (no cache dates yet), all sources are fetched.

## Database Schema

Events are stored with the following fields:

- Event ID, title, URL
- Location, city, coordinates
- Start/end dates and time
- Categories
- Image URL
- Source

Matches (duplicates) are tracked separately with:

- Event IDs from both sources
- Match score and confidence level
- Reasons for the match

Display rows (for web/UI) are materialized in `display_events`:

- One row per deduplicated event
- Canonical URL plus optional alternate URL
- Rebuilt automatically by `npm start` and `npm run refetch`

## Web UI + API

Run:

```bash
npm run web
```

- Webpage: `http://localhost:8787`
- API: `http://localhost:8787/api/events`

For live reload during development:

```bash
npm run web:dev
```

- Frontend (Vite): `http://localhost:8787`
- API (proxied by Vite): `http://localhost:8788/api/events`

API query params:

- `q` (optional): search text across title/location/city/source
- `page` (optional, default `1`)
- `pageSize` (optional, default `25`, max `100`)

## Event Sources

### fargomoorhead.org

- Uses a JSON API with dynamic token authentication
- Token auto-refreshes every 23 hours
- Rich event data including coordinates

### fargounderground.com

- Uses JSON API at `/events.json`
- Good venue and category data

### downtownfargo.com

- Uses POST request to `/events/feed`
- Location data scraped from individual event pages

## Deduplication

The aggregator automatically identifies duplicate events across sources by comparing:

- Event titles (fuzzy matching)
- Dates
- Locations/venues

Matches are classified as high, medium, or low confidence. When browsing deduplicated events, duplicates are merged and alternate source URLs are preserved.
