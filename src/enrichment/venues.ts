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
   */
  htmlPattern?: RegExp
  location: string
  city: string
  latitude: number
  longitude: number
}
