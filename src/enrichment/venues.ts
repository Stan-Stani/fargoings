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
    location: "Paradox Comics & Games, 814 Main Ave Suite 100",
    city: "Fargo",
    latitude: 46.8744,
    longitude: -96.7919,
  },
  {
    // Normalizes both fargodome.com rows (location "FARGODOME", no coords)
    // and aggregator copies, which also helps cross-source geo matching.
    titlePattern: /fargodome/i,
    htmlPattern: /fargodome\.com/i,
    location: "FARGODOME, 1800 N University Dr",
    city: "Fargo",
    latitude: 46.8975,
    longitude: -96.802,
  },
  {
    // fargotheatre.org rows carry no location at all; the listing page is
    // the venue's own site, so every row is at the theatre itself.
    titlePattern: /fargo theatre/i,
    htmlPattern: /fargotheatre\.org/i,
    location: "Fargo Theatre, 314 Broadway N",
    city: "Fargo",
    latitude: 46.8762,
    longitude: -96.7898,
  },
]
