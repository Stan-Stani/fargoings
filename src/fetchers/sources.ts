/**
 * Pure-data source descriptions — safe to import from anywhere (no fetcher
 * code, so db/web modules can use it without pulling in the scraping stack).
 * The full registry with fetch closures lives in ./registry.ts.
 */
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

export const SOURCE_INFO: SourceInfo[] = [
  {
    source: "fargomoorhead.org",
    aliases: ["fargo", "fargomoorhead"],
    sports: false,
    dedupPriority: 0,
  },
  {
    source: "downtownfargo.com",
    aliases: ["downtown"],
    sports: false,
    dedupPriority: 1,
  },
  {
    source: "fargounderground.com",
    aliases: ["underground", "fargounderground"],
    sports: false,
    dedupPriority: 2,
  },
  {
    source: "westfargoevents.com",
    aliases: ["westfargo"],
    sports: false,
    dedupPriority: 3,
  },
  {
    source: "fargolibrary.org",
    aliases: ["library", "fargolibrary"],
    sports: false,
    dedupPriority: 4,
  },
  {
    source: "westfargolibrary.org",
    aliases: ["westfargolibrary", "wfpl"],
    sports: false,
    dedupPriority: 5,
  },
  {
    source: "larl.org",
    aliases: ["moorhead", "moorheadlibrary", "mph", "larl"],
    sports: false,
    dedupPriority: 6,
  },
  {
    source: "drekkerbrewing.com",
    aliases: ["drekker", "drekkerbrewing"],
    sports: false,
    dedupPriority: 7,
    allowEmpty: true,
  },
  {
    source: "gobison.com",
    aliases: ["ndsu", "bison", "gobison"],
    sports: true,
    dedupPriority: 8,
  },
  {
    source: "msumdragons.com",
    aliases: ["msum", "dragons", "msumdragons"],
    sports: true,
    dedupPriority: 9,
  },
  {
    source: "aquariumfargo.com",
    aliases: ["aquarium"],
    sports: false,
    dedupPriority: 10,
  },
  {
    source: "fargoparks.com",
    aliases: ["parks", "fargoparks"],
    sports: false,
    dedupPriority: 11,
  },
]

export const ALL_SOURCE_IDS = SOURCE_INFO.map((s) => s.source)

/**
 * Sources whose events are sports schedules — hidden from the main feed by
 * default (high volume), revealed via the "Show sports" toggle.
 */
export const SPORTS_SOURCES = SOURCE_INFO.filter((s) => s.sports).map(
  (s) => s.source,
)

/** Sources whose 0-event runs are expected (seasonal feeds), not failures. */
export const ALLOW_EMPTY_SOURCES = SOURCE_INFO.filter((s) => s.allowEmpty).map(
  (s) => s.source,
)
