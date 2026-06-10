import { SourceInfo } from "../types"

export const SIOUXFALLS_SOURCE_INFO: SourceInfo[] = [
  {
    // CVB community calendar (user-submitted) — the broadest source, so it
    // wins cross-source dedup like fargomoorhead.org does for Fargo.
    source: "experiencesiouxfalls.com",
    aliases: ["esf", "experiencesiouxfalls", "visitsiouxfalls"],
    sports: false,
    dedupPriority: 0,
  },
  {
    source: "dtsf.com",
    aliases: ["dtsf", "downtownsiouxfalls"],
    sports: false,
    dedupPriority: 1,
  },
  {
    // Performing arts + science center; also covers the Orpheum Theater.
    // Shows are announced months out.
    source: "washingtonpavilion.org",
    aliases: ["pavilion", "washingtonpavilion"],
    sports: false,
    dedupPriority: 2,
    fetchHorizonDays: 365,
  },
  {
    // ~50 free outdoor concerts per season; feed is empty all winter.
    source: "levittsiouxfalls.org",
    aliases: ["levitt", "levittsiouxfalls"],
    sports: false,
    dedupPriority: 3,
    allowEmpty: true,
  },
  {
    // Arena shows announced months out (Simpleview, ASM-managed complex).
    source: "dennysanfordpremiercenter.com",
    aliases: ["premiercenter", "premier", "dennysanford"],
    sports: false,
    dedupPriority: 4,
    fetchHorizonDays: 365,
  },
  {
    source: "siouxlandlib.org",
    aliases: ["siouxland", "siouxlandlib", "library"],
    sports: false,
    dedupPriority: 5,
  },
  {
    // Augustana University athletics (Sidearm).
    source: "goaugie.com",
    aliases: ["augie", "augustana", "goaugie"],
    sports: true,
    dedupPriority: 6,
    allowEmpty: true,
    fetchHorizonDays: null,
  },
  {
    // University of Sioux Falls athletics (Sidearm).
    source: "usfcougars.com",
    aliases: ["usf", "cougars", "usfcougars"],
    sports: true,
    dedupPriority: 7,
    allowEmpty: true,
    fetchHorizonDays: null,
  },
  {
    // USHL hockey (Sidearm); feed is empty in the offseason.
    source: "sfstampede.com",
    aliases: ["stampede", "sfstampede"],
    sports: true,
    dedupPriority: 8,
    allowEmpty: true,
    fetchHorizonDays: null,
  },
]
