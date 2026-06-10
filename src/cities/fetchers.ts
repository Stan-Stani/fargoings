/**
 * Per-city fetch closures — the scraping stack. Kept separate from
 * cities/index.ts so CityConfig stays pure data: only fetchers/registry.ts
 * imports this module (db/web modules must never pull in fetcher code).
 */
import { getActiveCity } from "./index"
import { CityFetchFns } from "./types"
import { FARGO_FETCH_FNS } from "./fargo/fetchers"
import { SIOUXFALLS_FETCH_FNS } from "./siouxfalls/fetchers"

const CITY_FETCH_FNS: Record<string, CityFetchFns> = {
  fargo: FARGO_FETCH_FNS,
  siouxfalls: SIOUXFALLS_FETCH_FNS,
}

export function getActiveCityFetchFns(): CityFetchFns {
  const city = getActiveCity()
  const fns = CITY_FETCH_FNS[city.id]
  if (!fns) {
    throw new Error(`No fetch functions registered for city "${city.id}"`)
  }
  return fns
}
