import { VenueRule } from "../../enrichment/venues"

/**
 * Canonicalizes the big Sioux Falls venues: experiencesiouxfalls.com (the
 * highest-volume source) and washingtonpavilion.org carry venue names but no
 * coordinates, and the same building shows up under hand-typed variants
 * ("Washington Pavilion" vs "Mary W. Sommervold Hall, 301 S. Main Ave").
 * Coordinates from upstream feeds where available (dtsf.com Tribe venues,
 * Premier Center Simpleview), else OSM Nominatim (2026-06-10).
 */
export const SIOUXFALLS_VENUE_RULES: VenueRule[] = [
  {
    // Sommervold Hall is the Pavilion's concert hall — same building.
    titlePattern: /washington pavilion|sommervold hall/i,
    htmlPattern: /washingtonpavilion\.org/i,
    location: "Washington Pavilion, 301 S. Main Ave",
    city: "Sioux Falls",
    latitude: 43.5443,
    longitude: -96.729,
  },
  {
    titlePattern: /orpheum theater/i,
    location: "Orpheum Theater, 315 N. Phillips Ave",
    city: "Sioux Falls",
    latitude: 43.5503,
    longitude: -96.7271,
  },
  {
    titlePattern: /levitt at the falls/i,
    htmlPattern: /levittsiouxfalls\.org/i,
    location: "Levitt at the Falls, 504 N. Phillips Ave",
    city: "Sioux Falls",
    latitude: 43.5525,
    longitude: -96.7262,
  },
  {
    titlePattern: /premier center/i,
    htmlPattern: /dennysanfordpremiercenter\.com/i,
    location: "Denny Sanford PREMIER Center, 1201 N. West Ave",
    city: "Sioux Falls",
    latitude: 43.5621,
    longitude: -96.7493,
  },
  {
    titlePattern: /sioux falls convention center/i,
    location: "Sioux Falls Convention Center, 1101 N. West Ave",
    city: "Sioux Falls",
    latitude: 43.5616,
    longitude: -96.7501,
  },
  {
    titlePattern: /falls park/i,
    location: "Falls Park, 131 E. Falls Park Dr",
    city: "Sioux Falls",
    latitude: 43.5603,
    longitude: -96.7221,
  },
]
