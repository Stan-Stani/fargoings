import { AquariumFargoFetcher } from "../../fetchers/aquariumfargo-com"
import { DowntownFargoFetcher } from "../../fetchers/downtownfargo-com"
import { FargodomeFetcher } from "../../fetchers/fargodome-com"
import { DrekkerBrewingFetcher } from "../../fetchers/drekkerbrewing-com"
import { FargoLibraryFetcher } from "../../fetchers/fargolibrary-org"
import { FargoParksFetcher } from "../../fetchers/fargoparks-com"
import { FargoTheatreFetcher } from "../../fetchers/fargotheatre-org"
import { FargoFetcher } from "../../fetchers/fargomoorhead-com"
import { FargoUndergroundFetcher } from "../../fetchers/fargounderground-com"
import { GoCobbersFetcher } from "../../fetchers/gocobbers-com"
import { MoorheadLibraryFetcher } from "../../fetchers/moorheadlibrary-org"
import { MyNdsuFetcher } from "../../fetchers/myndsu-ndsu-edu"
import { SidearmSportsFetcher } from "../../fetchers/sidearm-sports"
import { WestFargoEventsFetcher } from "../../fetchers/westfargoevents-com"
import { WestFargoLibraryFetcher } from "../../fetchers/westfargolibrary-org"
import { CityFetchFns } from "../types"

export const FARGO_FETCH_FNS: CityFetchFns = {
  "fargomoorhead.org": async () => {
    const fetcher = new FargoFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "downtownfargo.com": async () => {
    const fetcher = new DowntownFargoFetcher()
    const events = await fetcher.fetchEvents(14)
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "fargounderground.com": async () => {
    const fetcher = new FargoUndergroundFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "westfargoevents.com": async () => {
    const fetcher = new WestFargoEventsFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "fargolibrary.org": async () => {
    const fetcher = new FargoLibraryFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "westfargolibrary.org": async () => {
    const fetcher = new WestFargoLibraryFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "larl.org": async () => {
    const fetcher = new MoorheadLibraryFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "drekkerbrewing.com": async () => {
    const fetcher = new DrekkerBrewingFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "gobison.com": async () => {
    const fetcher = new SidearmSportsFetcher({
      baseUrl: "https://gobison.com",
      schoolName: "NDSU Athletics",
      sourceId: "gobison.com",
      city: "Fargo",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "msumdragons.com": async () => {
    const fetcher = new SidearmSportsFetcher({
      baseUrl: "https://www.msumdragons.com",
      schoolName: "MSUM Athletics",
      sourceId: "msumdragons.com",
      city: "Moorhead",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "aquariumfargo.com": async () => {
    const fetcher = new AquariumFargoFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "fargoparks.com": async () => {
    const fetcher = new FargoParksFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "myndsu.ndsu.edu": async () => {
    const fetcher = new MyNdsuFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "fargodome.com": async () => {
    const fetcher = new FargodomeFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "fargoforce.com": async () => {
    const fetcher = new SidearmSportsFetcher({
      baseUrl: "https://fargoforce.com",
      schoolName: "Fargo Force",
      sourceId: "fargoforce.com",
      city: "Fargo",
    })
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "gocobbers.com": async () => {
    const fetcher = new GoCobbersFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
  "fargotheatre.org": async () => {
    const fetcher = new FargoTheatreFetcher()
    const events = await fetcher.fetchEvents()
    return events.map((event) => fetcher.transformToStoredEvent(event))
  },
}
