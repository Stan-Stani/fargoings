import { CommunicoFetcher } from "../../fetchers/communico"
import { ExperienceSiouxFallsFetcher } from "../../fetchers/experiencesiouxfalls-com"
import { SidearmSportsFetcher } from "../../fetchers/sidearm-sports"
import { SimpleviewFetcher } from "../../fetchers/simpleview"
import { TribeRestFetcher } from "../../fetchers/tribe-rest"
import { CityFetchFns } from "../types"

export const SIOUXFALLS_FETCH_FNS: CityFetchFns = {
  "experiencesiouxfalls.com": async () => {
    const fetcher = new ExperienceSiouxFallsFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "dtsf.com": async () => {
    const fetcher = new TribeRestFetcher({
      apiBase: "https://www.dtsf.com/wp-json/tribe/events/v1/events",
      sourceId: "dtsf.com",
      eventIdPrefix: "dtsf",
      label: "Downtown Sioux Falls fetch",
      defaultCity: "Sioux Falls",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "washingtonpavilion.org": async () => {
    const fetcher = new TribeRestFetcher({
      apiBase:
        "https://www.washingtonpavilion.org/wp-json/tribe/events/v1/events",
      sourceId: "washingtonpavilion.org",
      eventIdPrefix: "wpav",
      label: "Washington Pavilion fetch",
      defaultCity: "Sioux Falls",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "levittsiouxfalls.org": async () => {
    const fetcher = new TribeRestFetcher({
      apiBase:
        "https://www.levittsiouxfalls.org/wp-json/tribe/events/v1/events",
      sourceId: "levittsiouxfalls.org",
      eventIdPrefix: "levitt",
      label: "Levitt at the Falls fetch",
      defaultCity: "Sioux Falls",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "dennysanfordpremiercenter.com": async () => {
    const fetcher = new SimpleviewFetcher({
      siteBase: "https://www.dennysanfordpremiercenter.com",
      sourceId: "dennysanfordpremiercenter.com",
      label: "Premier Center fetch",
      defaultCity: "Sioux Falls",
      defaultLocation: "Denny Sanford PREMIER Center, 1201 N. West Ave",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "siouxlandlib.org": async () => {
    // Branch ids/coords from api.communico.co/v1/siouxland/locations —
    // the five Sioux Falls city branches plus Brandon (closest suburb).
    const fetcher = new CommunicoFetcher({
      baseUrl: "https://siouxland.libnet.info/eeventcaldata",
      relayEnvVar: "SIOUXLAND_EVENTS_URL",
      sourceId: "siouxlandlib.org",
      eventIdPrefix: "sxld",
      label: "Siouxland Libraries fetch",
      branches: [
        {
          id: "485",
          location: "Downtown Library, 200 N. Dakota Ave.",
          city: "Sioux Falls",
          latitude: 43.549325,
          longitude: -96.728993,
        },
        {
          id: "482",
          location: "Caille Branch Library, 4100 S. Carnegie Cir.",
          city: "Sioux Falls",
          latitude: 43.507689,
          longitude: -96.765154,
        },
        {
          id: "489",
          location: "Oak View Branch Library, 3700 E. 3rd St.",
          city: "Sioux Falls",
          latitude: 43.555785,
          longitude: -96.680498,
        },
        {
          id: "490",
          location: "Prairie West Branch Library, 7630 W. 26th St.",
          city: "Sioux Falls",
          latitude: 43.529316,
          longitude: -96.822571,
        },
        {
          id: "491",
          location: "Ronning Branch Library, 3100 E. 49th St.",
          city: "Sioux Falls",
          latitude: 43.507889,
          longitude: -96.687835,
        },
        {
          id: "481",
          location: "Brandon Community Library, 305 S. Splitrock Blvd.",
          city: "Brandon",
          latitude: 43.592322,
          longitude: -96.573746,
        },
      ],
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "goaugie.com": async () => {
    const fetcher = new SidearmSportsFetcher({
      baseUrl: "https://goaugie.com",
      schoolName: "Augustana Athletics",
      sourceId: "goaugie.com",
      city: "Sioux Falls",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "usfcougars.com": async () => {
    const fetcher = new SidearmSportsFetcher({
      baseUrl: "https://usfcougars.com",
      schoolName: "USF Athletics",
      sourceId: "usfcougars.com",
      city: "Sioux Falls",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "sfstampede.com": async () => {
    const fetcher = new SidearmSportsFetcher({
      baseUrl: "https://sfstampede.com",
      schoolName: "Sioux Falls Stampede",
      sourceId: "sfstampede.com",
      city: "Sioux Falls",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
}
