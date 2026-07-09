/**
 * Known venue enrichment rules.
 *
 * When an event has no location data but its title matches a known venue,
 * we can backfill the location, city, and coordinates. The rules themselves
 * are per-city data: see src/cities/<city>/venues.ts (e.g. Paradox Comics &
 * Games posts to fargounderground.com without venue details attached).
 */

export interface VenueRule {
  /** Regex tested against the event title (case-insensitive) */
  titlePattern: RegExp
  /**
   * More specific regex for matching this venue in raw HTML content (event pages,
   * ticket pages). Should be narrower than titlePattern to avoid false positives
   * from unrelated sidebar content or recommendations on listing pages.
   * Consumed by enrichVenuesFromEventPages (src/enrichment/pages.ts).
   */
  htmlPattern?: RegExp
  location: string
  city: string
  latitude: number
  longitude: number
}

/**
 * The Events Calendar's iCal export builds LOCATION by joining the venue
 * record's non-empty fields (name, street, city, state, zip, country). Some
 * organizers attach venue records with only the state filled in (e.g. Paradox
 * Comics' fargounderground.com posts since June 2026), which exports as
 * LOCATION:ND — and the web UI then collapses all such events into a bogus
 * "ND" venue group. A location is junk when every comma-separated part is a
 * state, zip code, or country; city names are deliberately not on the list
 * ("Fargo, ND" is thin but still real venue data).
 */
const JUNK_LOCATION_PART =
  /^(?:ND|MN|SD|North Dakota|Minnesota|South Dakota|US|USA|United States|\d{5}(?:-\d{4})?)$/i

export function isJunkLocation(location: string): boolean {
  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 && parts.every((part) => JUNK_LOCATION_PART.test(part))
}
