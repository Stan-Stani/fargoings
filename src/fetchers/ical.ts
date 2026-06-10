import { decodeHtmlEntities } from "../dedup/normalize"
import { slugify, utcInstantToLocal } from "./shared"

/** One parsed VEVENT, reduced to the fields the fetchers consume. */
export interface ICalEvent {
  uid: string
  title: string
  /** Local wall-clock date, YYYY-MM-DD */
  date: string
  /** Local end date, YYYY-MM-DD */
  endDate: string
  /** Local wall-clock start, HH:MM:SS, or null for all-day entries */
  startTime: string | null
  location: string | null
}

/**
 * Minimal RFC 5545 parser: just the VEVENT fields we consume. Feed values are
 * either `;VALUE=DATE:YYYYMMDD` (all-day) or `;TZID=…:YYYYMMDDThhmmss`
 * (already local — kept as-is to avoid VPS timezone shifts). A trailing `Z`
 * (UTC) is converted to the given timezone.
 */
export function parseICal(raw: string, timeZone: string): ICalEvent[] {
  const lines = unfoldICalLines(raw)
  const events: ICalEvent[] = []

  let current: Record<string, { params: string; value: string }> | null = null

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {}
      continue
    }
    if (line === "END:VEVENT") {
      if (current) {
        const event = toEvent(current, timeZone)
        if (event) events.push(event)
      }
      current = null
      continue
    }
    if (!current) continue

    const colon = line.indexOf(":")
    if (colon === -1) continue
    const namePart = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const semi = namePart.indexOf(";")
    const name = (semi === -1 ? namePart : namePart.slice(0, semi)).toUpperCase()
    const params = semi === -1 ? "" : namePart.slice(semi + 1)
    current[name] = { params, value }
  }

  return events
}

/** RFC 5545 line unfolding: a leading space/tab continues the prior line. */
export function unfoldICalLines(raw: string): string[] {
  const physical = raw.split(/\r\n|\n|\r/)
  const logical: string[] = []
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && logical.length) {
      logical[logical.length - 1] += line.slice(1)
    } else {
      logical.push(line)
    }
  }
  return logical
}

function toEvent(
  fields: Record<string, { params: string; value: string }>,
  timeZone: string,
): ICalEvent | null {
  const dtStart = fields["DTSTART"]
  const summary = fields["SUMMARY"]
  if (!dtStart || !summary) return null

  const start = parseICalDateTime(dtStart.params, dtStart.value, timeZone)
  if (!start) return null

  const dtEnd = fields["DTEND"]
  const end = dtEnd
    ? parseICalDateTime(dtEnd.params, dtEnd.value, timeZone)
    : null

  const uid = (fields["UID"]?.value || "").trim()
  const title = unescapeICalText(summary.value).trim()

  return {
    uid: uid || `${start.date}-${slugify(title)}`,
    title,
    date: start.date,
    endDate: end?.date ?? start.date,
    startTime: start.time,
    location: cleanICalLocation(fields["LOCATION"]?.value),
  }
}

export function parseICalDateTime(
  params: string,
  value: string,
  timeZone: string,
): { date: string; time: string | null } | null {
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly || /VALUE=DATE\b/i.test(params)) {
    const m = dateOnly ?? value.match(/^(\d{4})(\d{2})(\d{2})/)
    if (!m) return null
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null }
  }

  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m

  if (z) {
    const utc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
    const local = utcInstantToLocal(utc, timeZone)
    return { date: local.date, time: local.time }
  }

  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}:${s}` }
}

export function unescapeICalText(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
}

export function cleanICalLocation(value: string | undefined): string | null {
  if (!value) return null
  const text = decodeHtmlEntities(unescapeICalText(value))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+/, ", ")
    .trim()
  return text.length ? text : null
}
