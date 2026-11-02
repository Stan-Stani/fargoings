import { VenueRule } from "../../enrichment/venues"

/**
 * The Fargo venue table: one canonical name, address and coordinates per
 * venue, plus every spelling sources use for it. Sources disagree on all of
 * it ("Front Street Taproom" bare, with 58102, and with 58103-1912), which
 * also stops cross-source duplicates from matching on venue.
 *
 * Addresses come from the venue's own listing where one exists (Fargo Parks
 * facility pages, fargomoorhead.org listings, larl.org). Coordinates come from
 * upstream feeds, otherwise OSM Nominatim (2026-11-02).
 */
export const FARGO_VENUE_RULES: VenueRule[] = [
  {
    titlePattern: /paradox/i,
    /**
     * paradoxcnc.com is the Paradox Comics & Games website. Matching the domain
     * is far more specific than matching the word "paradox" alone, which can
     * appear in unrelated sidebar content, recommendations, or other events
     * listed on the same page.
     */
    htmlPattern: /paradoxcnc\.com/i,
    location: "Paradox Comics & Games, 814 Main Ave Suite 100, Fargo, ND 58103",
    city: "Fargo",
    latitude: 46.8744,
    longitude: -96.7919,
  },
  {
    // Normalizes both fargodome.com rows (location "FARGODOME", no coords)
    // and aggregator copies, which also helps cross-source geo matching.
    titlePattern: /fargodome/i,
    htmlPattern: /fargodome\.com/i,
    location: "FARGODOME, 1800 N University Dr, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8975,
    longitude: -96.802,
  },
  {
    // fargotheatre.org rows carry no location at all; the listing page is
    // the venue's own site, so every row is at the theatre itself.
    titlePattern: /fargo theatre/i,
    htmlPattern: /fargotheatre\.org/i,
    location: "Fargo Theatre, 314 Broadway N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8762,
    longitude: -96.7898,
  },

  // Downtown
  {
    locationPattern: /^front street taproom/i,
    location: "Front Street Taproom, 614 Main Ave, Fargo, ND 58103",
    city: "Fargo",
    latitude: 46.8741865,
    longitude: -96.7888348,
  },
  {
    // Same building as the Taproom. fargomoorhead.org also lists a "The
    // Cellar" at another address, so the bare name needs the street to match.
    locationPattern:
      /cellar comedy club|^the cellar\b.*(?:614 main|front street taproom)/i,
    location: "The Cellar Comedy Club, 614 Main Ave, Fargo, ND 58103",
    city: "Fargo",
    latitude: 46.8741865,
    longitude: -96.7888348,
  },
  {
    locationPattern: /^the 1889\b/i,
    location: "The 1889, 602 Main Ave, Fargo, ND 58103",
    city: "Fargo",
    latitude: 46.8745447,
    longitude: -96.7881628,
  },
  {
    locationPattern: /rhombus guys/i,
    location: "Rhombus Guys, 606 Main Ave, Fargo, ND 58103",
    city: "Fargo",
    latitude: 46.8741955,
    longitude: -96.7884404,
  },
  {
    locationPattern: /sidestreet grille/i,
    location: "Sidestreet Grille & Pub, 404 4th Ave N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8798407,
    longitude: -96.7849167,
  },
  {
    locationPattern: /fargo vfw club|^vfw, 202 broadway/i,
    location: "Fargo VFW Club Post 762, 202 Broadway N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8781689,
    longitude: -96.7881193,
  },
  {
    locationPattern: /radisson blu fargo/i,
    location: "Radisson Blu Fargo, 201 5th St N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.878137,
    longitude: -96.786076,
  },
  {
    locationPattern: /^the aquarium\b/i,
    location: "The Aquarium, 226 Broadway N Fl 2, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8789686,
    longitude: -96.788096,
  },
  {
    locationPattern: /broadway square/i,
    location: "Broadway Square, 201 Broadway N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.878142,
    longitude: -96.787568,
  },
  {
    locationPattern: /^plains art museum\b/i,
    location: "Plains Art Museum, 704 1st Ave N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8769526,
    longitude: -96.7918307,
  },
  {
    locationPattern: /sons of norway/i,
    location: "Sons of Norway, 722 2nd Ave N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8780874,
    longitude: -96.7921065,
  },
  {
    locationPattern: /^parachigo\b/i,
    location: "Parachigo, 14 8th St S, Fargo, ND 58103",
    city: "Fargo",
    latitude: 46.8742,
    longitude: -96.791,
  },
  {
    locationPattern: /gallery ?4\b/i,
    location: "Gallery 4, 115 Roberts St N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8776264,
    longitude: -96.7894176,
  },

  // Elsewhere in Fargo
  {
    locationPattern: /701 eateries/i,
    location: "701 Eateries, 701 N University Dr, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.883279,
    longitude: -96.798079,
  },
  {
    locationPattern: /^drekker brewing/i,
    location: "Drekker Brewing Company, 1666 1st Ave N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8762631,
    longitude: -96.8078035,
  },
  {
    // The market and hotel next door. Some listings give Drekker's number.
    locationPattern: /^brewhalla\b/i,
    location: "Brewhalla, 1702 1st Ave N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8764647,
    longitude: -96.8087356,
  },
  {
    locationPattern: /^pole body\b/i,
    location: "Pole Body, 508 Oak St N Unit A, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8813844,
    longitude: -96.7792453,
  },
  {
    locationPattern: /^wild terra\b/i,
    location: "Wild Terra Cider, 6 12th St N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.8763556,
    longitude: -96.7973285,
  },

  // Fargo Parks facilities (src/fetchers/fargoparks-com.ts stores the bare
  // facility name). Addresses and coordinates from each facility's page.
  {
    locationPattern: /metro recreation center/i,
    location: "Metro Recreation Center, 3110 Main Ave, Fargo, ND 58103",
    city: "Fargo",
    latitude: 46.875252,
    longitude: -96.829342,
  },
  {
    locationPattern: /cornerstone bank arena/i,
    location: "Cornerstone Bank Arena, 4404 23rd Ave SW, Fargo, ND 58104",
    city: "Fargo",
    latitude: 46.843452,
    longitude: -96.858411,
  },
  {
    locationPattern: /yunker farm/i,
    location: "Yunker Farm Park & Dog Park, 1201 28th Ave N, Fargo, ND 58102",
    city: "Fargo",
    latitude: 46.91451,
    longitude: -96.796154,
  },
  {
    locationPattern: /fargo parks sports center/i,
    location: "Fargo Parks Sports Center, 6100 38th St S, Fargo, ND 58104",
    city: "Fargo",
    latitude: 46.8049729,
    longitude: -96.8458715,
  },

  // West Fargo
  {
    locationPattern: /^the sandbox\b|sandbox restaurant/i,
    location: "The Sandbox, 3147 Bluestem Dr, West Fargo, ND 58078",
    city: "West Fargo",
    latitude: 46.8354319,
    longitude: -96.8841808,
  },
  {
    locationPattern: /west fargo (?:public )?library/i,
    location: "West Fargo Public Library, 215 3rd St E, West Fargo, ND 58078",
    city: "West Fargo",
    latitude: 46.8745611,
    longitude: -96.89554,
  },

  // Moorhead
  {
    // The library moved: larl.org lists 450 Center Ave, while some calendars
    // still have the old 118 5th St S.
    locationPattern: /moorhead public library/i,
    location: "Moorhead Public Library, 450 Center Ave, Moorhead, MN 56560",
    city: "Moorhead",
    latitude: 46.8751218,
    longitude: -96.7719468,
  },
  {
    // fargomoorhead.org lists planetarium shows with no venue name, only this
    // street address and "Bridges 167".
    locationPattern: /\bbridges (?:hall )?(?:room )?167\b/i,
    location: "MSUM Planetarium, Bridges Hall 167, 700 11th St S, Moorhead, MN 56563",
    city: "Moorhead",
    latitude: 46.8667874,
    longitude: -96.7623774,
  },
  {
    locationPattern: /rourke art (?:gallery|museum)/i,
    location: "The Rourke Art Gallery + Museum, 521 Main Ave, Moorhead, MN 56560",
    city: "Moorhead",
    latitude: 46.8735916,
    longitude: -96.7712697,
  },
]
