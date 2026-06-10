/**
 * City module types. A city module is one directory under src/cities/<id>/
 * exporting a CityConfig (pure data — safe to import from db/web modules)
 * plus a sibling fetchers.ts with the fetch closures (scraping stack).
 * The active city is resolved once from the CITY env var in ./index.ts.
 */
import { StoredEvent } from "../types/event"
import { VenueRule } from "../enrichment/venues"

export interface SourceInfo {
  /** Canonical source id stored on events (e.g. "larl.org"). */
  source: string
  /** CLI aliases accepted by `npm run refetch -- --source <alias>`. */
  aliases: string[]
  /**
   * Sports schedules are high-volume, hidden behind the "Show sports"
   * toggle, and only ever self-matched (URL-identity only) in dedup.
   */
  sports: boolean
  /**
   * Total order for cross-source dedup: when two sources list the same
   * event, the row from the LOWER-priority source is dropped (its URL is
   * kept as altUrl on the surviving row).
   */
  dedupPriority: number
  /**
   * This source's feed is legitimately empty for long stretches (e.g. a
   * seasonal schedule between seasons), so a 0-event run is not the
   * silent-relay-death signature and must not flag health.
   */
  allowEmpty?: boolean
  /**
   * How many days ahead this source's fetch reliably covers. Events dated
   * beyond the horizon may simply be outside the fetch window, so
   * possibly-cancelled detection only applies within it. Omitted = 14 (the
   * default daysAhead everywhere); null = never apply cancelled detection.
   */
  fetchHorizonDays?: number | null
}

export type FetchedEvent = Omit<StoredEvent, "id" | "createdAt" | "updatedAt">

export type CityFetchFns = Record<string, () => Promise<FetchedEvent[]>>

export interface CityBranding {
  /** Site name, e.g. "Fargoings" */
  siteTitle: string
  /** e.g. "Goings-On in Fargo" */
  tagline: string
  /** Full document/header title, e.g. "Fargoings | Goings-On in Fargo" */
  htmlTitle: string
}

export interface CityConfig {
  /** Matches the CITY env value, e.g. "fargo" */
  id: string
  displayName: string
  branding: CityBranding
  /** IANA timezone for date math everywhere (fetch windows, display, API presets). */
  timeZone: string
  map: {
    center: [number, number]
    desktopZoom: number
    mobileZoom: number
  }
  /**
   * Coordinates outside this box are upstream geocoding junk (e.g. virtual
   * events pinned to the US centroid) — treated as unmappable by the API.
   */
  region: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  venueRules: VenueRule[]
  /** Sqlite path; fargo keeps "./events.db" for back-compat. */
  dbPath: string
  /** Pure source metadata; fetch closures live in cities/<id>/fetchers.ts. */
  sourceInfo: SourceInfo[]
}
