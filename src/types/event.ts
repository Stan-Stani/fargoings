export interface FargoEvent {
  _id: string;
  title: string;
  url: string;
  location?: string;
  date: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  recurrence?: string;
  recurType: number;
  latitude?: number;
  longitude?: number;
  recid: string;
  accountId: number;
  city?: string;
  region?: string;
  categories: EventCategory[];
  media_raw?: EventMedia[];
  listing?: EventListing;
}

export interface EventCategory {
  catName: string;
  catId: string;
}

export interface EventMedia {
  mediaurl: string;
  sortorder: number;
  mediatype: string;
}

export interface EventListing {
  primary_category?: {
    primary: boolean;
    subcatid: number;
    subcatname: string;
    catname: string;
    catid: number;
  };
  recid: number;
  acctid: number;
  city: string;
  region: string;
  title: string;
  url: string;
  rankname?: string;
}

export interface FargoAPIResponse {
  docs: {
    count: number;
    docs: FargoEvent[];
  };
}

export interface StoredEvent {
  id: number;
  eventId: string;
  title: string;
  url: string;
  location: string | null;
  date: string; // Next occurrence date
  startTime: string | null;
  startDate: string;
  endDate: string;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  imageUrl: string | null;
  categories: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

// Fargo Underground types (The Events Calendar WordPress plugin)
export interface FargoUndergroundEvent {
  id: number;
  title: string;
  description: string;
  url: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  timezone: string;
  cost: string;
  venue: FargoUndergroundVenue | null;
  organizer: FargoUndergroundOrganizer[];
  categories: FargoUndergroundCategory[];
  tags: FargoUndergroundTag[];
  image: FargoUndergroundImage | null;
  featured: boolean;
}

export interface FargoUndergroundVenue {
  id: number;
  venue: string;
  address: string;
  city: string;
  country: string;
  province: string;
  zip: string;
  phone: string;
  website: string;
  geo_lat: number;
  geo_lng: number;
}

export interface FargoUndergroundOrganizer {
  id: number;
  organizer: string;
  phone: string;
  website: string;
  email: string;
}

export interface FargoUndergroundCategory {
  id: number;
  name: string;
  slug: string;
  description: string;
}

export interface FargoUndergroundTag {
  id: number;
  name: string;
  slug: string;
}

export interface FargoUndergroundImage {
  url: string;
  id: number;
  extension: string;
  width: number;
  height: number;
}

export interface FargoUndergroundAPIResponse {
  events: FargoUndergroundEvent[];
  total: number;
  total_pages: number;
  rest_url: string;
  next_rest_url?: string;
}
