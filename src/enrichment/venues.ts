/**
 * Known venue enrichment rules.
 *
 * When an event has no location data but its title matches a known venue,
 * we can backfill the location, city, and coordinates.
 *
 * Paradox Comics & Games is the primary case: they post events to
 * fargounderground.com without venue details attached.
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

export const VENUE_RULES: VenueRule[] = [
  {
    titlePattern: /paradox/i,
    /**
     * paradoxcnc.com is the Paradox Comics & Games website. Matching the domain
     * is far more specific than matching the word "paradox" alone, which can
     * appear in unrelated sidebar content, recommendations, or other events
     * listed on the same page.
     */
    htmlPattern: /paradoxcnc\.com/i,
    location: "Paradox Comics & Games, 242 Broadway N",
    city: "Fargo",
    latitude: 46.877,
    longitude: -96.789,
  },
]
