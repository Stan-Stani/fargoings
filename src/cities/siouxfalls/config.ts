import { CityConfig } from "../types"
import { SIOUXFALLS_SOURCE_INFO } from "./sources"
import { SIOUXFALLS_VENUE_RULES } from "./venues"

export const siouxFallsCity: CityConfig = {
  id: "siouxfalls",
  displayName: "Sioux Falls",
  branding: {
    siteTitle: "SooGoings",
    tagline: "Goings-On in Sioux Falls",
    htmlTitle: "SooGoings | Goings-On in Sioux Falls",
  },
  timeZone: "America/Chicago",
  map: {
    center: [43.5446, -96.7311],
    desktopZoom: 11,
    mobileZoom: 12,
  },
  // Generous metro box (Brandon, Harrisburg, Tea, Hartford all inside),
  // mirroring Fargo's loose bounds — it only rejects geocoding junk.
  region: { minLat: 42.8, maxLat: 44.2, minLng: -97.5, maxLng: -96.0 },
  venueRules: SIOUXFALLS_VENUE_RULES,
  dbPath: "./events-siouxfalls.db",
  sourceInfo: SIOUXFALLS_SOURCE_INFO,
}
