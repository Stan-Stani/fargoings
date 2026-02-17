/**
 * Text normalization utilities for event matching
 */
import { decode } from "he";

export function decodeHtmlEntities(text: string): string {
  return decode(text);
}

export function normalizeText(text: string): string {
  return decodeHtmlEntities(text)
    .toLowerCase()
    .replace(/[–—]/g, '-')           // normalize dashes
    .replace(/[""]/g, '"')           // normalize quotes
    .replace(/['']/g, "'")           // normalize apostrophes
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .replace(/[^\w\s'-]/g, ' ')      // remove punctuation except apostrophes/hyphens
    .split(/\s+/)
    .filter(token => token.length > 1);  // filter single chars
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,  // substitution
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j] + 1       // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio (0-1) based on Levenshtein distance
 */
export function stringSimilarity(a: string, b: string): number {
  const normA = normalizeText(a);
  const normB = normalizeText(b);

  if (normA === normB) return 1;
  if (normA.length === 0 || normB.length === 0) return 0;

  const distance = levenshteinDistance(normA, normB);
  const maxLen = Math.max(normA.length, normB.length);
  return 1 - distance / maxLen;
}

/**
 * Check if one string contains the other (after normalization)
 */
export function containsSubstring(a: string, b: string): boolean {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  return normA.includes(normB) || normB.includes(normA);
}

/**
 * Calculate token overlap ratio (Jaccard-like)
 */
export function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  // Use the smaller set as denominator (more lenient for subset matching)
  const minSize = Math.min(tokensA.size, tokensB.size);
  return intersection / minSize;
}

/**
 * Calculate geographic distance in meters between two lat/lng points
 */
export function geoDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
