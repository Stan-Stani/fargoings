import { StoredEvent } from '../types/event';
import {
  stringSimilarity,
  containsSubstring,
  tokenOverlap,
  geoDistance,
  normalizeText,
} from './normalize';

export interface MatchScore {
  eventId1: string;
  eventId2: string;
  titleScore: number;
  venueScore: number;
  timeScore: number;
  geoScore: number;
  totalScore: number;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

interface MatchWeights {
  title: number;
  venue: number;
  time: number;
  geo: number;
}

const DEFAULT_WEIGHTS: MatchWeights = {
  title: 0.5,
  venue: 0.25,
  time: 0.15,
  geo: 0.1,
};

/**
 * Calculate title similarity score (0-1)
 */
function scoreTitles(title1: string, title2: string): { score: number; reason: string } {
  // Check for substring containment first
  if (containsSubstring(title1, title2)) {
    const shorter = title1.length < title2.length ? title1 : title2;
    const longer = title1.length < title2.length ? title2 : title1;
    const ratio = normalizeText(shorter).length / normalizeText(longer).length;

    // If shorter is at least 40% of longer, good match
    if (ratio > 0.4) {
      return { score: 0.95, reason: 'title substring match' };
    }
  }

  // Token overlap
  const overlap = tokenOverlap(title1, title2);
  if (overlap > 0.8) {
    return { score: 0.9, reason: `high token overlap (${Math.round(overlap * 100)}%)` };
  }

  // String similarity (Levenshtein)
  const similarity = stringSimilarity(title1, title2);
  if (similarity > 0.85) {
    return { score: similarity, reason: `string similarity (${Math.round(similarity * 100)}%)` };
  }

  // Moderate token overlap still counts
  if (overlap > 0.6) {
    return { score: overlap * 0.85, reason: `moderate token overlap (${Math.round(overlap * 100)}%)` };
  }

  return { score: Math.max(similarity, overlap * 0.7), reason: 'low similarity' };
}

/**
 * Calculate venue similarity score (0-1)
 */
function scoreVenues(venue1: string | null, venue2: string | null): { score: number; reason: string } {
  if (!venue1 || !venue2) {
    return { score: 0.5, reason: 'venue unknown' };  // neutral if missing
  }

  if (containsSubstring(venue1, venue2)) {
    return { score: 1.0, reason: 'venue name match' };
  }

  const overlap = tokenOverlap(venue1, venue2);
  if (overlap > 0.5) {
    return { score: overlap, reason: `venue token overlap (${Math.round(overlap * 100)}%)` };
  }

  const similarity = stringSimilarity(venue1, venue2);
  return { score: similarity, reason: `venue similarity (${Math.round(similarity * 100)}%)` };
}

/**
 * Calculate time match score (0 or 1)
 */
function scoreTimes(time1: string | null, time2: string | null): { score: number; reason: string } {
  if (!time1 || !time2) {
    return { score: 0.5, reason: 'time unknown' };  // neutral if missing
  }

  // Normalize time format (strip seconds)
  const t1 = time1.substring(0, 5);
  const t2 = time2.substring(0, 5);

  if (t1 === t2) {
    return { score: 1.0, reason: 'exact time match' };
  }

  // Within 30 minutes
  const [h1, m1] = t1.split(':').map(Number);
  const [h2, m2] = t2.split(':').map(Number);
  const mins1 = h1 * 60 + m1;
  const mins2 = h2 * 60 + m2;
  const diff = Math.abs(mins1 - mins2);

  if (diff <= 30) {
    return { score: 0.8, reason: 'time within 30 min' };
  }

  return { score: 0, reason: 'different times' };
}

/**
 * Calculate geographic proximity score (0-1)
 */
function scoreGeo(
  lat1: number | null, lng1: number | null,
  lat2: number | null, lng2: number | null
): { score: number; reason: string } {
  if (!lat1 || !lng1 || !lat2 || !lng2) {
    return { score: 0.5, reason: 'geo unknown' };  // neutral if missing
  }

  const distance = geoDistance(lat1, lng1, lat2, lng2);

  if (distance < 100) {
    return { score: 1.0, reason: 'same location (<100m)' };
  }
  if (distance < 500) {
    return { score: 0.8, reason: 'nearby (<500m)' };
  }
  if (distance < 1000) {
    return { score: 0.5, reason: 'within 1km' };
  }

  return { score: 0, reason: `far apart (${Math.round(distance)}m)` };
}

/**
 * Calculate overall match score between two events
 */
export function scoreMatch(
  event1: StoredEvent,
  event2: StoredEvent,
  weights: MatchWeights = DEFAULT_WEIGHTS
): MatchScore {
  const reasons: string[] = [];

  // Title score
  const titleResult = scoreTitles(event1.title, event2.title);
  reasons.push(`Title: ${titleResult.reason}`);

  // Venue score
  const venueResult = scoreVenues(event1.location, event2.location);
  reasons.push(`Venue: ${venueResult.reason}`);

  // Time score
  const timeResult = scoreTimes(event1.startTime, event2.startTime);
  reasons.push(`Time: ${timeResult.reason}`);

  // Geo score
  const geoResult = scoreGeo(
    event1.latitude, event1.longitude,
    event2.latitude, event2.longitude
  );
  reasons.push(`Geo: ${geoResult.reason}`);

  // Weighted total
  const totalScore =
    titleResult.score * weights.title +
    venueResult.score * weights.venue +
    timeResult.score * weights.time +
    geoResult.score * weights.geo;

  // Determine confidence level
  let confidence: 'high' | 'medium' | 'low';
  if (totalScore >= 0.85 && titleResult.score >= 0.8) {
    confidence = 'high';
  } else if (totalScore >= 0.7 && titleResult.score >= 0.6) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    eventId1: event1.eventId,
    eventId2: event2.eventId,
    titleScore: titleResult.score,
    venueScore: venueResult.score,
    timeScore: timeResult.score,
    geoScore: geoResult.score,
    totalScore,
    confidence,
    reasons,
  };
}

/**
 * Find all potential matches between two sets of events
 */
export function findMatches(
  source1Events: StoredEvent[],
  source2Events: StoredEvent[],
  minScore: number = 0.7
): MatchScore[] {
  const matches: MatchScore[] = [];

  // Group events by date for efficiency
  const source2ByDate = new Map<string, StoredEvent[]>();
  for (const event of source2Events) {
    const existing = source2ByDate.get(event.date) || [];
    existing.push(event);
    source2ByDate.set(event.date, existing);
  }

  // Compare each source1 event to source2 events on the same date
  for (const event1 of source1Events) {
    const candidates = source2ByDate.get(event1.date) || [];

    for (const event2 of candidates) {
      const score = scoreMatch(event1, event2);

      if (score.totalScore >= minScore) {
        matches.push(score);
      }
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.totalScore - a.totalScore);

  return matches;
}
