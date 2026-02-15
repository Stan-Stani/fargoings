export interface Ymd {
  year: number
  month: number
  day: number
}

export interface DateRangeInTimeZone {
  start: Ymd
  end: Ymd
  startDateStr: string
  endDateStr: string
}

export const DEFAULT_BROWSER_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Referer: "https://www.fargomoorhead.org/events/",
  Origin: "https://www.fargomoorhead.org",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}

export function getDatePartsInTimeZone(date: Date, timeZone: string): Ymd {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = formatter.formatToParts(date)

  const year = Number(parts.find((part) => part.type === "year")?.value)
  const month = Number(parts.find((part) => part.type === "month")?.value)
  const day = Number(parts.find((part) => part.type === "day")?.value)

  if (!year || !month || !day) {
    throw new Error(`Failed to parse date parts for timezone ${timeZone}`)
  }

  return { year, month, day }
}

export function addDaysToYmd(ymd: Ymd, days: number): Ymd {
  const date = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

export function formatYmd(ymd: Ymd): string {
  return `${ymd.year}-${String(ymd.month).padStart(2, "0")}-${String(ymd.day).padStart(2, "0")}`
}

export function getDateRangeInTimeZone(
  daysAhead: number,
  timeZone: string,
): DateRangeInTimeZone {
  const start = getDatePartsInTimeZone(new Date(), timeZone)
  const end = addDaysToYmd(start, daysAhead)

  return {
    start,
    end,
    startDateStr: formatYmd(start),
    endDateStr: formatYmd(end),
  }
}

export function toTimeZoneMidnightIso(ymd: Ymd, timeZone: string): string {
  const utcMidnightMillis = Date.UTC(ymd.year, ymd.month - 1, ymd.day, 0, 0, 0)
  const offsetMinutes = getTimeZoneOffsetMinutes(
    new Date(utcMidnightMillis),
    timeZone,
  )
  const zonedMidnightUtcMillis = utcMidnightMillis - offsetMinutes * 60_000
  return new Date(zonedMidnightUtcMillis).toISOString()
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })

  const tzName =
    formatter.formatToParts(date).find((part) => part.type === "timeZoneName")
      ?.value ?? ""
  const match = tzName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)

  if (!match) {
    throw new Error(`Unsupported timezone offset format: ${tzName}`)
  }

  const sign = match[1] === "+" ? 1 : -1
  const hours = Number(match[2])
  const minutes = Number(match[3] || "0")
  return sign * (hours * 60 + minutes)
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
  maxAttempts: number = 3,
): Promise<Response> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init)
      if (response.ok) {
        return response
      }

      const bodyPreview = (await response.text()).slice(0, 500)
      const shouldRetry = response.status >= 500 || response.status === 429

      if (!shouldRetry || attempt === maxAttempts) {
        throw new Error(
          `${label} failed: HTTP ${response.status}. Body preview: ${bodyPreview}`,
        )
      }

      console.warn(
        `⚠️ ${label} attempt ${attempt}/${maxAttempts} failed with ${response.status}; retrying...`,
      )
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts) {
        throw error
      }
      console.warn(
        `⚠️ ${label} attempt ${attempt}/${maxAttempts} errored; retrying...`,
        error,
      )
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 750))
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} failed after retries`)
}
