/**
 * Active-city resolution. Every module that needs city context (db, api,
 * registry, entry points) calls getActiveCity(); the city is picked once
 * from the CITY env var (default "fargo").
 *
 * dotenv is loaded HERE, not just in the entry points: browse/search/dedup/
 * reenrich never imported dotenv, and a CITY set only in .env must still
 * reach them before the sources shim reads getActiveCity() at module scope.
 */
import "dotenv/config"
import { CityConfig } from "./types"
import { fargoCity } from "./fargo/config"
import { siouxFallsCity } from "./siouxfalls/config"

const CITY_CONFIGS: Record<string, CityConfig> = {
  [fargoCity.id]: fargoCity,
  [siouxFallsCity.id]: siouxFallsCity,
}

let activeCity: CityConfig | null = null

export function getActiveCity(): CityConfig {
  if (activeCity) {
    return activeCity
  }
  const id = (process.env.CITY ?? "fargo").toLowerCase()
  const config = CITY_CONFIGS[id]
  if (!config) {
    // Fail fast: a typo'd CITY must never silently scrape the wrong city
    // into the wrong database.
    throw new Error(
      `Unknown CITY "${id}". Valid cities: ${Object.keys(CITY_CONFIGS).join(", ")}`,
    )
  }
  activeCity = config
  return config
}
