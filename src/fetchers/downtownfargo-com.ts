import { StoredEvent } from "../types/event"

interface DowntownFargoEvent {
  className: string | null
  title: string
  start: string
  end: string
  allDay: boolean
  url: string
}

interface DowntownFargoEventWithDetails extends DowntownFargoEvent {
  location?: string
}

export class DowntownFargoFetcher {
  private readonly feedUrl = "https://www.downtownfargo.com/events/feed"
  private readonly baseUrl = "https://www.downtownfargo.com"

  async fetchEvents(daysAhead: number = 14): Promise<DowntownFargoEventWithDetails[]> {
    const startDate = new Date()
    startDate.setHours(0, 0, 0, 0)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + daysAhead)

    const startStr = startDate.toISOString().split("T")[0]
    const endStr = endDate.toISOString().split("T")[0]

    console.log(
      `   Date range: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`,
    )

    const body = new URLSearchParams({
      searchText: "",
      category: "",
      start: startStr,
      end: endStr,
    })

    try {
      const response = await fetch(this.feedUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json",
        },
        body: body.toString(),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const events = (await response.json()) as DowntownFargoEvent[]

      console.log(`   Found ${events.length} events`)

      const eventsWithDetails: DowntownFargoEventWithDetails[] = []

      if (events.length > 0) {
        console.log(`   Fetching location details for ${events.length} events...`)
      }
      for (const event of events) {
        const location = await this.fetchEventLocation(event.url)
        eventsWithDetails.push({ ...event, location })
      }

      return eventsWithDetails
    } catch (error) {
      console.error("Error fetching Downtown Fargo events:", error)
      throw error
    }
  }

  private async fetchEventLocation(
    eventPath: string,
  ): Promise<string | undefined> {
    try {
      const response = await fetch(`${this.baseUrl}${eventPath}`)
      if (!response.ok) return undefined

      const html = await response.text()

      // Look for venue name and address in the page
      // Pattern: Venue name followed by Google Maps link with address
      const venueMatch = html.match(
        /o-details-block__details-copy[^>]*>\s*([^<]+)</,
      )
      const addressMatch = html.match(/maps\.google\.com\/\?q=\(([^)]+)\)/)

      if (addressMatch) {
        // Extract from Google Maps link: "(Venue Name Address City, ST ZIP)"
        return addressMatch[1].replace(/\s+/g, " ").trim()
      }

      if (venueMatch) {
        return venueMatch[1].trim()
      }

      return undefined
    } catch {
      return undefined
    }
  }

  transformToStoredEvent(
    event: DowntownFargoEventWithDetails,
  ): Omit<StoredEvent, "id" | "createdAt" | "updatedAt"> {
    // Parse start datetime (format: "2026-02-14T10:00:00-06:00")
    const startDateTime = new Date(event.start)
    const date = `${startDateTime.getFullYear()}-${String(startDateTime.getMonth() + 1).padStart(2, "0")}-${String(startDateTime.getDate()).padStart(2, "0")}`

    // Extract time as HH:MM:SS
    const hours = String(startDateTime.getHours()).padStart(2, "0")
    const minutes = String(startDateTime.getMinutes()).padStart(2, "0")
    const startTime = `${hours}:${minutes}:00`

    // Parse end date
    const endDateTime = new Date(event.end)
    const endDate = `${endDateTime.getFullYear()}-${String(endDateTime.getMonth() + 1).padStart(2, "0")}-${String(endDateTime.getDate()).padStart(2, "0")}`

    return {
      eventId: `dtf_${event.url.replace("/events/", "")}`,
      title: event.title,
      url: `https://www.downtownfargo.com${event.url}`,
      location: event.location || null,
      date,
      startTime: event.allDay ? null : startTime,
      startDate: date,
      endDate,
      latitude: null,
      longitude: null,
      city: "Fargo",
      imageUrl: null,
      categories: JSON.stringify([]),
      source: "downtownfargo.com",
    }
  }
}
