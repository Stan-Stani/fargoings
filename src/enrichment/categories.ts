/**
 * Canonical event categories.
 *
 * Upstream calendars attach several tags per event, in no useful order, and
 * every calendar names things differently ("Sports" / "Athletics", "Concert"
 * / "Music & Concerts"). Some tags aren't categories at all: audience tags
 * ("Family Friendly"), admin tags ("Registration Required"), or a calendar's
 * own programme name ("Drifting the Plains"). Several sources publish no
 * category at all.
 *
 * resolveCategory turns all of that into one name from CANONICAL_CATEGORIES.
 * Nothing else may reach display_events.category, so the filter dropdown and
 * API consumers only ever see this list (tests/categories.test.ts enforces
 * it). The decision order, first hit wins:
 *
 *   1. TITLE_OVERRIDES: the title is unambiguous, and beats any upstream tag
 *      ("Jazz Night" tagged Culture & Heritage is Live Music).
 *   2. The most specific upstream tag, mapped through the per-source then the
 *      shared table. "Most specific" is CANONICAL_CATEGORIES order. Tags from
 *      rows merged into this one by dedup count only if its own say nothing.
 *   3. TITLE_RULES, then VENUE_RULES: best guesses from the title and venue.
 *      These beat only the catch-all tags in WEAK_CATEGORIES.
 *   4. A catch-all upstream tag.
 *   5. null. Reported by getDataQualityReport rather than guessed.
 */

/** Every category an event can have, most specific first. */
export const CANONICAL_CATEGORIES = [
  "Programs & Registration",
  "Storytime",
  "Karaoke",
  "Comedy",
  "Trivia & Bingo",
  "Charitable Gaming",
  "Gaming & Tabletop",
  "Open Mic & Jam",
  "Sports",
  "Live Music",
  "Dancing",
  "Film & Media",
  "Literary Arts",
  "Visual Arts",
  "Arts & Crafts",
  "STEM",
  "Technology",
  "Classes & Workshops",
  "Fitness & Yoga",
  "Health & Wellness",
  "Seniors",
  "Public Meetings",
  "Office Hours",
  "Fundraiser",
  "Live Performance",
  "Shopping",
  "Food & Drink",
  "Business",
  "Speakers & Programs",
  "Culture & Heritage",
  "Youth & Family",
  "Outdoors & Recreation",
  "Nightlife",
  "Entertainment",
  "Community",
] as const

export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number]

const CANONICAL_LOOKUP = new Map<string, CanonicalCategory>(
  CANONICAL_CATEGORIES.map((name) => [name.toLowerCase(), name]),
)

export function isCanonicalCategory(name: string): boolean {
  return CANONICAL_LOOKUP.get(name.trim().toLowerCase()) === name.trim()
}

/**
 * Hidden from default listings; they reappear when a user filters to them,
 * searches, or (for Sports) turns on "Show sports". Sports schedules would
 * bury the feed, and "Programs & Registration" rows are start dates and
 * deadlines rather than something to attend.
 */
export const HIDDEN_BY_DEFAULT: CanonicalCategory[] = [
  "Sports",
  "Programs & Registration",
]

/**
 * Catch-all tags. Calendars use these for anything, so a best guess from the
 * title is better evidence than the tag itself.
 */
const WEAK_CATEGORIES = new Set<CanonicalCategory>([
  "Youth & Family",
  "Outdoors & Recreation",
  "Nightlife",
  "Entertainment",
  "Community",
])

/**
 * Upstream tag (lowercase, decoded) → canonical category. null means a known
 * tag that says nothing about what the event is. Tags equal to a canonical
 * name (any case) needn't be listed. Unlisted tags are treated as null and
 * surfaced by getDataQualityReport so they can be added here.
 */
const UPSTREAM_CATEGORIES: Record<string, CanonicalCategory | null> = {
  // Audience and admin tags, programme names, and venue names
  adults: null,
  "all ages": null,
  "big money": null,
  "bison life - connect": null,
  "bison life - discover": null,
  "bison life - grow": null,
  "broadway square": null,
  college: null,
  "college events": null,
  "contact table": null,
  default: null,
  "downtown street fair": null,
  "drifting the plains": null,
  "dtsf signature event": null,
  "fargo park event & programs": null,
  featured: null,
  "free fun": null,
  "holiday entertainment": null,
  "holiday events": null,
  "legacy events": null,
  members: null,
  "no registration required": null,
  "one book one community": null,
  other: null,
  "public event": null,
  "registration required": null,
  seasonal: null,
  "signature event": null,
  "spark center": null,
  "store event": null,
  "special event": null,
  "special events": null,
  "summer reading program": null,

  // Youth & Family (weak: an audience, not an activity)
  "early literacy": "Youth & Family",
  families: "Youth & Family",
  "families & kids": "Youth & Family",
  family: "Youth & Family",
  "family freindly event": "Youth & Family",
  "family friendly": "Youth & Family",
  homeschool: "Youth & Family",
  "school age": "Youth & Family",
  "school’s out discovery days": "Youth & Family",
  teens: "Youth & Family",
  tweens: "Youth & Family",
  "young children": "Youth & Family",

  // Music
  "big band & swing": "Live Music",
  "choral & acapella": "Live Music",
  "classical & orchestral": "Live Music",
  concert: "Live Music",
  concerts: "Live Music",
  "country & western": "Live Music",
  "dempsey's live music": "Live Music",
  "dj & edm": "Live Music",
  "dj & electronic": "Live Music",
  "fargo live music": "Live Music",
  "folk & acoustic": "Live Music",
  "jazz & blues": "Live Music",
  "metal & hardcore": "Live Music",
  music: "Live Music",
  "music & concerts": "Live Music",
  "music concerts": "Live Music",
  "music in the park fargo": "Live Music",
  orchestra: "Live Music",
  rock: "Live Music",
  "rock & pop": "Live Music",
  "roots & bluegrass": "Live Music",
  "south dakota symphony orchestra": "Live Music",

  // Stage
  "ballet & artistic dance": "Live Performance",
  broadway: "Live Performance",
  drama: "Live Performance",
  "live on stage": "Live Performance",
  "live theater": "Live Performance",
  musical: "Live Performance",
  "performing arts": "Live Performance",
  "spotlight theatre company": "Live Performance",
  "the good night theatre collective": "Live Performance",
  theater: "Live Performance",

  // Sports. "Sports & Outdoors" also covers pumpkin patches, corn mazes and
  // swim nights, so it maps to the weak Outdoors category and TITLE_RULES
  // promote the actual games and races to Sports.
  athletics: "Sports",
  "spectator sports": "Sports",
  tournament: "Sports",
  active: "Outdoors & Recreation",
  "nature & outdoors": "Outdoors & Recreation",
  "outdoor recreation": "Outdoors & Recreation",
  outdoors: "Outdoors & Recreation",
  "sports & outdoors": "Outdoors & Recreation",

  // Games
  cyberpunk: "Gaming & Tabletop",
  digimon: "Gaming & Tabletop",
  games: "Gaming & Tabletop",
  gundam: "Gaming & Tabletop",
  lorcana: "Gaming & Tabletop",
  "magic the gathering": "Gaming & Tabletop",
  "one piece": "Gaming & Tabletop",
  pokemon: "Gaming & Tabletop",
  riftbound: "Gaming & Tabletop",
  "star wars": "Gaming & Tabletop",
  tabletop: "Gaming & Tabletop",

  // Arts
  art: "Visual Arts",
  exhibits: "Visual Arts",
  "museum & exhibits": "Visual Arts",
  "museums & exhibits": "Visual Arts",
  "visual arts center": "Visual Arts",
  "arts, crafts and hobbies": "Arts & Crafts",
  craft: "Arts & Crafts",
  "crafting classes": "Arts & Crafts",
  "crafts & hobbies": "Arts & Crafts",
  "art & culture": "Culture & Heritage",
  "arts & culture": "Culture & Heritage",
  cultural: "Culture & Heritage",
  "cultural event": "Culture & Heritage",
  "genealogy & history": "Culture & Heritage",
  history: "Culture & Heritage",

  // Books and film
  "author visits": "Literary Arts",
  "authors & writers": "Literary Arts",
  "book clubs": "Literary Arts",
  "book clubs & discussion": "Literary Arts",
  "writers events": "Literary Arts",
  "classic film series": "Film & Media",
  "cinedome show": "Film & Media",
  film: "Film & Media",
  movies: "Film & Media",

  // Learning and talks
  "camps & classes": "Classes & Workshops",
  "camps & workshops": "Classes & Workshops",
  "cooking classes": "Classes & Workshops",
  "leadership development": "Classes & Workshops",
  "training/certification": "Classes & Workshops",
  educational: "Speakers & Programs",
  "informational events": "Speakers & Programs",
  presentation: "Speakers & Programs",
  presentations: "Speakers & Programs",
  speaker: "Speakers & Programs",

  // Going out
  "cabaret & burlesque": "Nightlife",
  "drag shows": "Nightlife",
  "pub crawls": "Nightlife",
  "dance lessons": "Dancing",
  dance: "Dancing",
  brunches: "Food & Drink",
  "dining & culinary events": "Food & Drink",
  "food, festivals & fairs": "Food & Drink",
  "tastings & tours": "Food & Drink",

  // Commerce and work
  "book sales": "Shopping",
  "farmers & makers markets": "Shopping",
  "friends book sale": "Shopping",
  "home & garden": "Shopping",
  "red river market": "Shopping",
  "trade show": "Shopping",
  "trade shows & exhibitions": "Shopping",
  career: "Business",
  "career exploration": "Business",
  conference: "Business",
  convention: "Business",
  "startupbrew fargo": "Business",
  "conversation & spoken word": "Speakers & Programs",

  // Community
  "active & social events": "Community",
  advocacy: "Community",
  "clubs & groups": "Community",
  "community & civic": "Community",
  "community event": "Community",
  festival: "Community",
  festivals: "Community",
  "festivals & fairs": "Community",
  "fm pride": "Community",
  "lgbtq+": "Community",
  meeting: "Community",
  politics: "Community",
  social: "Community",
  volunteering: "Community",
  wellness: "Health & Wellness",
}

/**
 * Where one calendar uses a tag differently from the others. Keys are source
 * ids, then lowercase upstream tags.
 */
const SOURCE_CATEGORIES: Record<
  string,
  Record<string, CanonicalCategory | null>
> = {
  // The Moorhead library files walking groups, language exchanges and senior
  // socials under "Entertainment" and often "Arts, Crafts and Hobbies" too.
  // Actual craft sessions say so in the title (TITLE_RULES).
  "larl.org": {
    entertainment: "Community",
    "arts, crafts and hobbies": "Community",
  },
  // Dance at the Pavilion is a ticketed performance, not a dance you join.
  "washingtonpavilion.org": { dance: "Live Performance" },
}

/** Clear cases that beat whatever the source says. Order matters. */
const TITLE_OVERRIDES: Array<[RegExp, CanonicalCategory]> = [
  [
    /\bstart date\b|\bleagues? (?:starts?|begins?)\b|\bregistration (?:opens|closes|deadline)\b/i,
    "Programs & Registration",
  ],
  [
    /\b(?:football|volleyball|basketball|hockey|baseball|softball|t-ball|soccer|wrestling|lacrosse|archery|pickleball|mma|fargo force|redhawks|woodchippers)\b/i,
    "Sports",
  ],
  [
    /\bstory ?time\b|\brhyme time\b|\bbaby (?:bounce|boost|rhyme)\b|\btoddlers?\b/i,
    "Storytime",
  ],
  [/\btumble time\b/i, "Youth & Family"],
  [/\bkaraoke\b/i, "Karaoke"],
  [/\bcomedy\b|\bcomedian\b|\bstand-?up\b|\bimprov\b/i, "Comedy"],
  [/\btrivia\b/i, "Trivia & Bingo"],
  [
    /\bd&d\b|\bdungeons\b|\bboard gam|\bgame night\b|\btabletop\b|\bmah ?-?jongg?\b|\bmtg\b|\bmagic: the gathering\b|\bnight magic\b/i,
    "Gaming & Tabletop",
  ],
  [
    /\bjazz\b|\bconcerts?\b|\bsymphony\b|\borchestra\b|\bmusical performance\b|\b(?:live|brass|big|cover|tribute) band\b/i,
    "Live Music",
  ],
  [
    /\bsocial dance\b|\bswing (?:basics|dance|lessons?)\b|\bsalsa (?:night|dance|lessons?)\b|\bballroom\b|\bline danc/i,
    "Dancing",
  ],
  [
    /\bsenior social\b|\bsenior center\b|\bsenior citizens?\b|\bactive agers?\b|\baarp\b|\b(?:55|60)\+/i,
    "Seniors",
  ],
  [/\bburlesque\b|\bdrag show\b/i, "Nightlife"],
  [/\bexhibit(?:ion)?s?\b|\bart show\b/i, "Visual Arts"],
  [/\bcooking\b|\bdemo\b|\b101\b/i, "Classes & Workshops"],
  [/\bopen house\b|\bmeetups?\b/i, "Community"],
]

/** Best guesses for events with no useful upstream tag. Order matters. */
const TITLE_RULES: Array<[RegExp, CanonicalCategory]> = [
  [/\bbingo\b/i, "Trivia & Bingo"],
  [/\bmeat raffle\b|\braffle\b/i, "Charitable Gaming"],
  [/\bpuzzle\b|\bpok[eé]mon\b|\blet's play\b/i, "Gaming & Tabletop"],
  [/\bsupport group\b|\bcaregiver/i, "Health & Wellness"],
  [/open mic|\bjam session\b/i, "Open Mic & Jam"],
  [
    /\b5k\b|\b10k\b|\bmarathon\b|\brac(?:es|ing)\b|\bspeedway\b|\btournament\b|\bgolf\b|\bcornhole\b|\b(?:agility|obedience|scent work|fastcat)\b/i,
    "Sports",
  ],
  [/\byoga\b|\bpilates\b/i, "Fitness & Yoga"],
  [/screening|\bfilm\b|\bmovies?\b|\bmatinee\b|\bcinema\b/i, "Film & Media"],
  [/\blive music\b|\bbluegrass\b|\bdj\b| w\/ |\bfeat(\.|uring)\b/i, "Live Music"],
  [/\bdrag\b/i, "Nightlife"],
  [/\bdance\b|\bswing\b|\bsalsa\b/i, "Dancing"],
  [
    /ceramics|\bclay\b|pottery|wheel throwing|\bknit|crochet|\bsew|screen ?print|printmaking|\bpaint|\bdrawing\b|\bcraft/i,
    "Arts & Crafts",
  ],
  [/gallery|opening reception/i, "Visual Arts"],
  [
    /\bbaking\b|\bworkshop\b|\bclass\b|\bintro to\b|\bseminar\b|\bself-?defen[cs]e\b/i,
    "Classes & Workshops",
  ],
  [/book club|author|reading party|poetry|\bwriting\b/i, "Literary Arts"],
  [
    /\blecture\b|\ban evening with\b|\bspeaker\b|\bsummit\b|\bpanel\b|scams|\bfinancial\b/i,
    "Speakers & Programs",
  ],
  [/\bmarket\b|\bvendors?\b|\bpop-?up\b/i, "Shopping"],
  [/\bdinner\b|\bbrunch\b|\btasting\b|\bbrewery tour\b|happy hour|food truck/i, "Food & Drink"],
  [/\bstem\b|\bcoding\b|\brobotics\b/i, "STEM"],
  [/\bboard\b meeting|\blibrary board\b|\bcouncil\b|town hall/i, "Public Meetings"],
  [/social club|\bparty\b|homecoming|\bfestival\b|\bfair\b/i, "Community"],
]

/** Venues where an otherwise-unlabeled event is almost always one kind. */
const VENUE_RULES: Array<[RegExp, CanonicalCategory]> = [
  [/\baquarium\b.*broadway|troll lounge|parachigo/i, "Live Music"],
  [/comedy club/i, "Comedy"],
  [/fargo theatre/i, "Live Performance"],
]

function firstMatch<T>(
  rules: Array<[RegExp, T]>,
  text: string | null,
): T | null {
  if (!text) return null
  for (const [pattern, value] of rules) {
    if (pattern.test(text)) return value
  }
  return null
}

/** Trim, lowercase and collapse an upstream tag into a table key. */
function tagKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

/** One upstream tag as a canonical category, or null. */
function canonicalFromTag(
  name: string,
  source: string,
): CanonicalCategory | null {
  const key = tagKey(name)
  const sourceTable = SOURCE_CATEGORIES[source]
  if (sourceTable && key in sourceTable) return sourceTable[key]
  if (key in UPSTREAM_CATEGORIES) return UPSTREAM_CATEGORIES[key]
  return CANONICAL_LOOKUP.get(key) ?? null
}

/** True when a tag is in a mapping table, so a null result was deliberate. */
export function isKnownUpstreamTag(name: string, source: string): boolean {
  const key = tagKey(name)
  return (
    key in (SOURCE_CATEGORIES[source] ?? {}) ||
    key in UPSTREAM_CATEGORIES ||
    CANONICAL_LOOKUP.has(key)
  )
}

/** The most specific of the given upstream tags, or null. */
function mostSpecificTag(
  names: string[],
  source: string,
): CanonicalCategory | null {
  let best: CanonicalCategory | null = null
  let bestRank = Infinity
  for (const name of names) {
    const category = canonicalFromTag(name, source)
    if (!category) continue
    const rank = CANONICAL_CATEGORIES.indexOf(category)
    if (rank < bestRank) {
      best = category
      bestRank = rank
    }
  }
  return best
}

export interface CategoryInput {
  title: string
  location?: string | null
  source: string
  /** Upstream tags on the event itself. */
  names: string[]
  /**
   * Tags from rows merged into this one by dedup, so a survivor from a source
   * with no tags keeps what the dropped copy knew. The survivor's own tags
   * win: fargotheatre.org knows its shows better than an aggregator does.
   */
  mergedNames?: string[]
}

/** The display category for an event. See the file comment for the order. */
export function resolveCategory(input: CategoryInput): CanonicalCategory | null {
  const { title, location = null, source, names, mergedNames = [] } = input

  const override = firstMatch(TITLE_OVERRIDES, title)
  if (override) return override

  const own = mostSpecificTag(names, source)
  const tagged =
    own && !WEAK_CATEGORIES.has(own)
      ? own
      : mostSpecificTag([...names, ...mergedNames], source)
  if (tagged && !WEAK_CATEGORIES.has(tagged)) return tagged

  return (
    firstMatch(TITLE_RULES, title) ??
    firstMatch(VENUE_RULES, location) ??
    tagged
  )
}
