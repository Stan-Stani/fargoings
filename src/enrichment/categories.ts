/**
 * Display-category selection and inference.
 *
 * Upstream calendars attach several category names per event, and the first
 * one is often an audience or admin tag ("College", "Registration Required",
 * "Family Friendly") rather than what the event *is* — fargomoorhead.org
 * files a comic-shop board-game meetup under "College". Several sources
 * (downtownfargo.com, the Aquarium, Fargo Theatre, West Fargo Library)
 * publish no category at all. pickCategory skips the tags; inferCategory
 * fills the gaps from the title and venue.
 */

/** Audience/admin tags that describe who or how, not what. Lowercase. */
const NON_DESCRIPTIVE = new Set([
  "adults",
  "all ages",
  "college",
  "college events",
  "early literacy",
  "families",
  "families & kids",
  "family",
  "family freindly event",
  "family friendly",
  "fargo park event & programs",
  "featured",
  "homeschool",
  "no registration required",
  "other",
  "registration required",
  "school age",
  "spark center",
  "special event",
  "summer reading program",
  "teens",
  "tweens",
  "young children",
])

/**
 * Pure admin tags — not even worth showing as a last-resort fallback
 * (audience tags like "Family Friendly" still are). Lowercase.
 */
const ADMIN_ONLY = new Set([
  "fargo park event & programs",
  "featured",
  "no registration required",
  "other",
  "registration required",
  "spark center",
  "special event",
])

/**
 * Upstream synonyms folded into one display name, so the category dropdown
 * lists "Live Music" once instead of alongside "Concert" and "Music &
 * Concerts". Keys lowercase.
 */
const CANONICAL: Record<string, string> = {
  art: "Visual Arts",
  "arts, crafts and hobbies": "Arts & Crafts",
  athletics: "Sports",
  "book clubs & discussion": "Literary Arts",
  "clubs & groups": "Community",
  "community & civic": "Community",
  "community event": "Community",
  concert: "Live Music",
  craft: "Arts & Crafts",
  "crafts & hobbies": "Arts & Crafts",
  cultural: "Culture & Heritage",
  "cultural event": "Culture & Heritage",
  educational: "Speakers & Programs",
  film: "Film & Media",
  games: "Gaming & Tabletop",
  "informational events": "Speakers & Programs",
  movies: "Film & Media",
  music: "Live Music",
  "music & concerts": "Live Music",
  "performing arts": "Live Performance",
  presentations: "Speakers & Programs",
  social: "Community",
  speaker: "Speakers & Programs",
}

/** Fold an upstream name into its display name. */
export function canonicalCategory(name: string): string {
  const trimmed = name.trim()
  return CANONICAL[trimmed.toLowerCase()] ?? trimmed
}

/**
 * First upstream category name that describes the event (canonicalized), or
 * null when every name is an audience/admin tag (the caller then infers
 * from the title).
 */
export function pickCategory(names: string[]): string | null {
  for (const name of names) {
    const trimmed = name.trim()
    if (trimmed && !NON_DESCRIPTIVE.has(trimmed.toLowerCase()))
      return canonicalCategory(trimmed)
  }
  return null
}

/**
 * Last resort when neither upstream names nor the title say what an event
 * is: the first audience tag ("Family Friendly"), skipping pure admin tags.
 */
export function fallbackCategory(names: string[]): string | null {
  for (const name of names) {
    const trimmed = name.trim()
    if (trimmed && !ADMIN_ONLY.has(trimmed.toLowerCase()))
      return canonicalCategory(trimmed)
  }
  return null
}

/** Ordered: the first matching rule wins, so specific rules come first. */
const TITLE_RULES: Array<[RegExp, string]> = [
  [/\btrivia\b|\bbingo\b/i, "Trivia & Bingo"],
  [/\bkaraoke\b|open mic|\bjam session\b/i, "Open Mic & Jam"],
  [/\bcomedy\b|\bcomedian\b|stand-?up|\bimprov\b/i, "Comedy"],
  [/\bmeat raffle\b|\braffle\b/i, "Charitable Gaming"],
  [/screening|\bfilm\b|\bmovies?\b|\bmatinee\b|\bcinema\b/i, "Film & Media"],
  [/\bsymphony\b|\borchestra\b|\bconcert\b|\blive music\b|\bjazz\b|\bbluegrass\b|\bdj\b| w\/ |\bfeat(\.|uring)\b/i, "Live Music"],
  [/\bd&d\b|dungeons|board gam|tabletop|\bmtg\b|magic: the gathering/i, "Gaming & Tabletop"],
  [/\bdance\b|\bswing\b|\bsalsa\b|\bdrag\b|\bburlesque\b/i, "Nightlife"],
  [/ceramics|\bclay\b|pottery|wheel throwing|\bknit|crochet|\bsew|screen ?print|printmaking|\bpaint|\bdrawing\b|\bcraft/i, "Arts & Crafts"],
  [/exhibit|gallery|art show|opening reception/i, "Visual Arts"],
  [/\bworkshop\b|\bclass\b|\bintro to\b|\b101\b|\bseminar\b/i, "Classes & Workshops"],
  [/book club|author|reading party|\bstorytime\b|poetry/i, "Literary Arts"],
  [/\blecture\b|\ban evening with\b|\bspeaker\b|\bsummit\b|\bpanel\b|scams|\bfinancial\b/i, "Speakers & Programs"],
  [/\bmarket\b|\bfair\b|\bvendors?\b|\bpop-?up\b/i, "Shopping"],
  [/\bdinner\b|\bbrunch\b|\btasting\b|\bbrewery tour\b|happy hour|food truck/i, "Food & Drink"],
  [/\bstem\b|\bcoding\b|\brobotics\b/i, "STEM"],
  [/\bboard\b meeting|^library board$|\bcouncil\b|town hall/i, "Public Meetings"],
  [/\bmeetup\b|social club|\bparty\b|homecoming/i, "Community"],
]

/** Venues where an otherwise-unlabeled event is almost always one kind. */
const VENUE_RULES: Array<[RegExp, string]> = [
  [/\baquarium\b.*broadway|troll lounge|parachigo/i, "Live Music"],
  [/comedy club/i, "Comedy"],
  [/fargo theatre/i, "Live Performance"],
]

/** Best-guess display category from the title (then venue), or null. */
export function inferCategory(
  title: string,
  location: string | null = null,
): string | null {
  for (const [pattern, category] of TITLE_RULES) {
    if (pattern.test(title)) return category
  }
  if (location) {
    for (const [pattern, category] of VENUE_RULES) {
      if (pattern.test(location)) return category
    }
  }
  return null
}
