/**
 * Field cleanup applied once at store time (see EventDatabase.insertEvent), so
 * every source and every later step sees the same spelling. All of it is
 * idempotent: migration 6 runs it over rows that were stored before it existed.
 */

/** Words kept uppercase when a title written in all caps is recased. */
const ACRONYMS = new Set([
  "AARP",
  "AC",
  "BBQ",
  "DC",
  "DJ",
  "DSA",
  "EDM",
  "FM",
  "HS",
  "II",
  "III",
  "IV",
  "MC",
  "MLB",
  "MMA",
  "MN",
  "MSUM",
  "NBA",
  "ND",
  "NDSU",
  "NFL",
  "NHL",
  "SD",
  "SDSO",
  "STEM",
  "TV",
  "UFC",
  "UND",
  "USA",
  "VFW",
  "WWE",
])

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "be",
  "by",
  "do",
  "for",
  "go",
  "in",
  "is",
  "it",
  "me",
  "my",
  "no",
  "of",
  "on",
  "or",
  "so",
  "the",
  "to",
  "up",
  "us",
  "vs",
  "we",
  "with",
])

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]

function monthPattern(monthIndex: number): string {
  const name = MONTH_NAMES[monthIndex]
  // "may" has no shorter form; "sept" is a common extra spelling.
  const short = name.slice(0, 3)
  const extra = name === "september" ? "|sept" : ""
  return name === short ? name : `${name}|${short}${extra}`
}

const ANY_MONTH = MONTH_NAMES.map((_, i) => monthPattern(i)).join("|")

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * Lowercase a stray second capital: "DMitry" → "Dmitry", "SIdestreet" →
 * "Sidestreet". Needs four lowercase letters after it, and skips single-letter
 * prefixes, because plenty of names really are written this way: "KPop",
 * "UMary", "UConn", "IHeart", "DJing".
 */
function fixStrayCapital(text: string): string {
  return text.replace(/\b([A-Z])([A-Z])([a-z]{4,})\b/g, (word, a, b, rest) =>
    /[IUEXQ]/.test(a) ? word : `${a}${b.toLowerCase()}${rest}`,
  )
}

/** Recase one all-caps word, keeping acronyms and vowel-less abbreviations. */
function recaseWord(word: string, isFirst: boolean): string {
  return word
    .split(/([-/])/)
    .map((part) => {
      const letters = part.replace(/[^A-Za-z]/g, "")
      if (!letters) return part
      if (ACRONYMS.has(letters)) return part
      const lower = part.toLowerCase()
      if (!isFirst && SMALL_WORDS.has(lower)) return lower
      // Two letters that aren't a word ("EP"), or no vowels ("MSHSL"): an
      // abbreviation.
      if (letters.length <= 2 || !/[AEIOUY]/.test(letters)) return part
      const firstLetter = lower.search(/[a-z]/)
      return (
        lower.slice(0, firstLetter) +
        lower.charAt(firstLetter).toUpperCase() +
        lower.slice(firstLetter + 1)
      )
    })
    .join("")
}

/**
 * "FARGO BOARD GAMERS" → "Fargo Board Gamers". Needs two alphabetic words, so
 * single-word acts and names like "KING 810" keep their styling, and leaves
 * deliberately mixed titles ("GODZILLA - Centennial Film Series") alone.
 */
function recaseAllCaps(title: string): string {
  if (/[a-z]/.test(title)) return title
  const words = title.split(" ")
  if (words.filter((word) => /[A-Z]{2}/.test(word)).length < 2) return title
  return words.map((word, i) => recaseWord(word, i === 0)).join(" ")
}

/** "Womens'" → "Women's". The apostrophe lands wrong often enough to fix. */
function fixGroupPossessives(title: string): string {
  return title
    .replace(/\b(Wom|Chil?dr)ens['’]/g, (_, stem) => `${stem}en's`)
    .replace(/\bMens['’]/g, "Men's")
    .replace(/\bWomens\b/g, "Women's")
    .replace(/\bMens\b/g, "Men's")
}

/** Drop a trailing date when it is the event's own date. */
function stripOwnDate(title: string, date: string | undefined): string {
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return title
  const year = match[1]
  const month = Number(match[2])
  const day = Number(match[3])
  const shortYear = year.slice(2)
  const sep = String.raw`\s*[-–—|:,]?\s*`
  const named = monthPattern(month - 1)
  const patterns = [
    // 11/4, 11/4/26, 11-4-2026
    new RegExp(
      String.raw`${sep}0?${month}[/-]0?${day}(?:[/-](?:${year}|${shortYear}))?$`,
    ),
    // November 4, Nov. 4th, November 4, 2026
    new RegExp(
      String.raw`${sep}(?:${named})\.?\s+0?${day}(?:st|nd|rd|th)?(?:,?\s*${year})?$`,
      "i",
    ),
    // " – November 2026". The separator is required: "Fall 2026" style names
    // and a bare "November 2026" mid-sentence are left alone.
    new RegExp(
      String.raw`\s*[-–—|:,]\s*(?:${named})\.?,?\s*${year}$`,
      "i",
    ),
  ]
  for (const pattern of patterns) {
    const stripped = title.replace(pattern, "").trim()
    if (stripped !== title && stripped.length >= 3) return stripped
  }
  return title
}

function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** "Dual Exhibition - Ted Martin - Gallery4" at Gallery 4 loses the suffix. */
function stripTrailingVenue(
  title: string,
  location: string | null | undefined,
): string {
  if (!location) return title
  const venue = compact(location.split(",")[0])
  if (!venue) return title
  const parts = title.split(/\s+[-–—|]\s+/)
  if (parts.length < 2) return title
  if (compact(parts[parts.length - 1]) !== venue) return title
  const lastSeparator = title.search(
    new RegExp(
      String.raw`\s+[-–—|]\s+${escapeRegExp(parts[parts.length - 1])}$`,
    ),
  )
  return lastSeparator > 0 ? title.slice(0, lastSeparator).trim() : title
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * `Monday Matinee "The Buddy Holly Story" PG` → drop the rating. Requires the
 * closing quote: a trailing "R" or "G" on anything else may be part of a name.
 */
function stripTrailingRating(title: string): string {
  return title.replace(/(["”])\s+(?:PG-13|PG|NC-17|NR|G|R)$/, "$1")
}

export interface TitleContext {
  /** The event's own date, YYYY-MM-DD. */
  date?: string
  location?: string | null
}

/** Normalize an event title. Falls back to the input rather than emptying it. */
export function cleanTitle(title: string, context: TitleContext = {}): string {
  let result = collapseWhitespace(title)
  result = fixGroupPossessives(result)
  result = fixStrayCapital(result)
  result = recaseAllCaps(result)
  result = stripOwnDate(result, context.date)
  result = stripTrailingVenue(result, context.location)
  result = stripTrailingRating(result)
  return result || collapseWhitespace(title)
}

/** Longest first, so "West Fargo" isn't read as a street ending in "West". */
const LOCALITIES = [
  "West Fargo",
  "Fargo",
  "Moorhead",
  "Dilworth",
  "Horace",
  "Harwood",
  "Casselton",
  "Sioux Falls",
  "Brandon",
  "Harrisburg",
  "Hartford",
  "Dell Rapids",
].join("|")

/**
 * "Name 123 Some Street City, ST ZIP" with the commas missing, as downtown
 * Fargo's map links and the West Fargo library feed write them. The name is
 * greedy so a venue that starts with digits ("701 Eateries 701 N University")
 * splits on the street number, not its own name.
 */
const UNPUNCTUATED_ADDRESS = new RegExp(
  String.raw`^(.+)\s+(\d+\s+[^,]+?),?\s+(${LOCALITIES}),?\s+(ND|MN|SD)(?:\s+(\d{5}))?$`,
  "i",
)

/** A state only where a state goes: "North Dakota Avenue" is a street. */
const STATE_NAMES: Array<[RegExp, string]> = [
  [/,\s*North Dakota(?=\s*(?:,|\d{5}|$))/gi, ", ND"],
  [/,\s*Minnesota(?=\s*(?:,|\d{5}|$))/gi, ", MN"],
  [/,\s*South Dakota(?=\s*(?:,|\d{5}|$))/gi, ", SD"],
]

/**
 * One spelling for addresses: "Name, Street, City, ST ZIP". Known venues get
 * replaced wholesale by the venue table later on; this handles everything else.
 */
export function normalizeLocation(raw: string): string {
  let result = collapseWhitespace(raw)
  result = fixStrayCapital(result)
  result = result.replace(/(?:,\s*|\s+)United States$|,\s*U\.?S\.?A\.?$/i, "")
  for (const [pattern, abbreviation] of STATE_NAMES) {
    result = result.replace(pattern, abbreviation)
  }
  result = result
    .replace(/\b(ND|MN|SD),\s*(\d{5})\b/g, "$1 $2")
    .replace(/\b(\d{5})-\d{4}\b/g, "$1")
    .replace(/,(?=\S)/g, ", ")
    .replace(/%26/g, "&")

  const match = result.match(UNPUNCTUATED_ADDRESS)
  if (match) {
    const [, name, street, city, state, zip] = match
    const venue = name.replace(/[,\s\u2013\u2014-]+$/, "")
    result = `${venue}, ${street.trim()}, ${city}, ${state.toUpperCase()}${zip ? ` ${zip}` : ""}`
  }
  return result.trim()
}

/**
 * The stale year in a title like "2025 Fall Baccalaureate" on an event dated
 * in 2026 (a recurring series the source never ended), or null. Deliberately
 * narrow, because a hit holds the event out of the feed:
 *  - only the five years before the event, so themes ("2001: A Space Odyssey",
 *    "1999 Prom Night") pass
 *  - not decades ("2010's"), season ranges ("2025-26"), or history ("Class of
 *    2024", "Since 2021")
 *  - not January/February events naming the year just ended ("2025 in Review")
 */
export function staleTitleYear(title: string, date: string): number | null {
  const eventYear = Number(date.slice(0, 4))
  const eventMonth = Number(date.slice(5, 7))
  if (!eventYear) return null

  for (const match of title.matchAll(/\b(20\d{2})\b/g)) {
    const year = Number(match[1])
    if (year >= eventYear || year < eventYear - 5) continue

    const before = title.slice(0, match.index)
    const after = title.slice(match.index + match[0].length)
    if (/^['’]?s\b/i.test(after)) continue
    if (/^\s*[-–—/]\s*\d/.test(after)) continue
    if (/\b(?:class of|since|est\.?|established|founded|vintage)\s*$/i.test(before)) {
      continue
    }
    if (eventMonth <= 2 && year === eventYear - 1) continue
    return year
  }
  return null
}

function to24Hour(hours: number, minutes: number, meridiem: string): string | null {
  if (hours < 1 || hours > 12 || minutes > 59) return null
  const isPm = meridiem.toLowerCase() === "p"
  const hour24 = (hours % 12) + (isPm ? 12 : 0)
  return `${String(hour24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`
}

const TIME_OF_DAY = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b/i

/** "From: 5:00 PM to 8:00 PM" or "Starting: 07:30 PM" → "17:00:00". */
export function timeFromText(text: string | null | undefined): string | null {
  const match = text?.match(TIME_OF_DAY)
  if (!match) return null
  return to24Hour(Number(match[1]), Number(match[2] ?? 0), match[3])
}

/**
 * The start time a free-text schedule gives for one date. Season listings put
 * these in the description ("Nov 7 (Sat) / 12 pm vs Macalester", "Friday,
 * November 6th: 3 PM- 9 PM") and leave the structured time empty. A time only
 * counts if it follows this date before any other date is mentioned.
 */
export function timeForDateInText(
  text: string | null | undefined,
  date: string,
): string | null {
  const match = date.match(/^\d{4}-(\d{2})-(\d{2})$/)
  if (!text || !match) return null
  const month = Number(match[1])
  const day = Number(match[2])

  const plain = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
  const thisDate = new RegExp(
    String.raw`\b(?:${monthPattern(month - 1)})\.?\s+0?${day}(?:st|nd|rd|th)?\b`,
    "gi",
  )
  const nextDate = new RegExp(String.raw`\b(?:${ANY_MONTH})\.?\s+\d`, "i")

  for (const found of plain.matchAll(thisDate)) {
    let window = plain.slice(found.index + found[0].length).slice(0, 70)
    const cut = window.search(nextDate)
    if (cut >= 0) window = window.slice(0, cut)
    const time = timeFromText(window)
    if (time) return time
  }
  return null
}
