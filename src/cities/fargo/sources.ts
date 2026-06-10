import { SourceInfo } from "../types"

export const FARGO_SOURCE_INFO: SourceInfo[] = [
  {
    source: "fargomoorhead.org",
    aliases: ["fargo", "fargomoorhead"],
    sports: false,
    dedupPriority: 0,
  },
  {
    source: "downtownfargo.com",
    aliases: ["downtown"],
    sports: false,
    dedupPriority: 1,
  },
  {
    source: "fargounderground.com",
    aliases: ["underground", "fargounderground"],
    sports: false,
    dedupPriority: 2,
  },
  {
    source: "westfargoevents.com",
    aliases: ["westfargo"],
    sports: false,
    dedupPriority: 3,
  },
  {
    source: "fargolibrary.org",
    aliases: ["library", "fargolibrary"],
    sports: false,
    dedupPriority: 4,
  },
  {
    source: "westfargolibrary.org",
    aliases: ["westfargolibrary", "wfpl"],
    sports: false,
    dedupPriority: 5,
  },
  {
    source: "larl.org",
    aliases: ["moorhead", "moorheadlibrary", "mph", "larl"],
    sports: false,
    dedupPriority: 6,
  },
  {
    source: "drekkerbrewing.com",
    aliases: ["drekker", "drekkerbrewing"],
    sports: false,
    dedupPriority: 7,
    allowEmpty: true,
  },
  {
    source: "gobison.com",
    aliases: ["ndsu", "bison", "gobison"],
    sports: true,
    dedupPriority: 8,
  },
  {
    source: "msumdragons.com",
    aliases: ["msum", "dragons", "msumdragons"],
    sports: true,
    dedupPriority: 9,
  },
  {
    source: "aquariumfargo.com",
    aliases: ["aquarium"],
    sports: false,
    dedupPriority: 10,
  },
  {
    source: "fargoparks.com",
    aliases: ["parks", "fargoparks"],
    sports: false,
    dedupPriority: 11,
  },
  {
    // NDSU campus/student-org events (Engage) — athletics is gobison.com.
    source: "myndsu.ndsu.edu",
    aliases: ["ndsucampus", "myndsu"],
    sports: false,
    dedupPriority: 12,
  },
  {
    // RSS lists every announced event, often months out.
    source: "fargodome.com",
    aliases: ["fargodome", "dome"],
    sports: false,
    dedupPriority: 13,
    fetchHorizonDays: 365,
  },
  {
    // USHL hockey (Scheels Arena); feed is empty in the offseason.
    source: "fargoforce.com",
    aliases: ["force", "fargoforce"],
    sports: true,
    dedupPriority: 15,
    allowEmpty: true,
    fetchHorizonDays: null,
  },
  {
    // Concordia athletics (PrestoSports) — campus events are separate scope.
    source: "gocobbers.com",
    aliases: ["concordia", "cobbers", "gocobbers"],
    sports: true,
    dedupPriority: 16,
    allowEmpty: true,
    fetchHorizonDays: null,
  },
  {
    // Listing shows all announced live events, often months out.
    source: "fargotheatre.org",
    aliases: ["fargotheatre", "theatre"],
    sports: false,
    dedupPriority: 14,
    fetchHorizonDays: 365,
  },
]
