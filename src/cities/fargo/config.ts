import { CityConfig } from "../types"
import { FARGO_SOURCE_INFO } from "./sources"
import { FARGO_VENUE_RULES } from "./venues"

export const fargoCity: CityConfig = {
  id: "fargo",
  displayName: "Fargo",
  branding: {
    siteTitle: "Fargoings",
    tagline: "Goings-On in Fargo",
    htmlTitle: "Fargoings | Goings-On in Fargo",
  },
  timeZone: "America/Chicago",
  map: {
    // Desktop feels better slightly zoomed out so Fargo + Moorhead fit
    // comfortably.
    center: [46.877, -96.789],
    desktopZoom: 11,
    mobileZoom: 12,
  },
  region: { minLat: 45.5, maxLat: 48, minLng: -98.5, maxLng: -95 },
  venueRules: FARGO_VENUE_RULES,
  // Pre-city-modules path, kept so the existing deploy needs no migration.
  dbPath: "./events.db",
  sourceInfo: FARGO_SOURCE_INFO,
}
