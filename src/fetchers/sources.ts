/**
 * Pure-data source descriptions for the ACTIVE CITY — safe to import from
 * anywhere (no fetcher code, so db/web modules can use it without pulling in
 * the scraping stack). The per-city source lists live in
 * src/cities/<city>/sources.ts; the full registry with fetch closures lives
 * in ./registry.ts.
 */
import { getActiveCity } from "../cities"

export type { SourceInfo } from "../cities/types"

export const SOURCE_INFO = getActiveCity().sourceInfo

export const ALL_SOURCE_IDS = SOURCE_INFO.map((s) => s.source)

/**
 * Sources whose events are sports schedules — hidden from the main feed by
 * default (high volume), revealed via the "Show sports" toggle.
 */
export const SPORTS_SOURCES = SOURCE_INFO.filter((s) => s.sports).map(
  (s) => s.source,
)

/**
 * Campus/student-life sources — hidden from the main feed by default,
 * revealed via the "Show campus" toggle.
 */
export const CAMPUS_SOURCES = SOURCE_INFO.filter((s) => s.campus).map(
  (s) => s.source,
)

/**
 * Student-geared events that general-audience sources also list
 * (homecomings). Matched on title and hidden alongside CAMPUS_SOURCES.
 */
export const CAMPUS_TITLE_PATTERNS = ["%homecoming%"]

/** Sources whose 0-event runs are expected (seasonal feeds), not failures. */
export const ALLOW_EMPTY_SOURCES = SOURCE_INFO.filter((s) => s.allowEmpty).map(
  (s) => s.source,
)
