import { EventDatabase } from './db/database';
import { findMatches } from './dedup/matcher';
import { FargoFetcher } from './fetchers/fargomoorhead-com';
import { FargoUndergroundFetcher } from './fetchers/fargounderground-com';
import { DowntownFargoFetcher } from './fetchers/downtownfargo-com';

function getLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function main() {
  console.log('🔄 Force re-fetching all sources (ignoring cache)...\n');

  const db = new EventDatabase();

  try {
    const today = getLocalDateString(new Date());

    // Clear all events and matches
    db.clearMatches();
    db.deleteEventsBySource('fargomoorhead.org');
    db.deleteEventsBySource('fargounderground.com');
    db.deleteEventsBySource('downtownfargo.com');
    console.log('   Cleared existing events\n');

    // Fetch fargomoorhead.org
    console.log('📥 Fetching fargomoorhead.org...');
    const fargoFetcher = new FargoFetcher();
    const fargoEvents = await fargoFetcher.fetchEvents();
    for (const event of fargoEvents) {
      db.insertEvent(fargoFetcher.transformToStoredEvent(event));
    }
    db.setSourceLastUpdatedDate('fargomoorhead.org', today);
    console.log(`✓ Stored ${fargoEvents.length} events\n`);

    // Fetch fargounderground.com
    console.log('📥 Fetching fargounderground.com...');
    const undergroundFetcher = new FargoUndergroundFetcher();
    const undergroundEvents = await undergroundFetcher.fetchEvents();
    for (const event of undergroundEvents) {
      db.insertEvent(undergroundFetcher.transformToStoredEvent(event));
    }
    db.setSourceLastUpdatedDate('fargounderground.com', today);
    console.log(`✓ Stored ${undergroundEvents.length} events\n`);

    // Fetch downtownfargo.com
    console.log('📥 Fetching downtownfargo.com...');
    const downtownFetcher = new DowntownFargoFetcher();
    const downtownEvents = await downtownFetcher.fetchEvents(14);
    for (const event of downtownEvents) {
      db.insertEvent(downtownFetcher.transformToStoredEvent(event));
    }
    db.setSourceLastUpdatedDate('downtownfargo.com', today);
    console.log(`✓ Stored ${downtownEvents.length} events\n`);

    // Rebuild dedup matches across all source pairs
    console.log('🔍 Rebuilding duplicate matches...');
    const fargoStored = db.getEventsBySource('fargomoorhead.org');
    const undergroundStored = db.getEventsBySource('fargounderground.com');
    const downtownStored = db.getEventsBySource('downtownfargo.com');

    const allMatches = [
      ...findMatches(fargoStored, undergroundStored, 0.65),
      ...findMatches(fargoStored, downtownStored, 0.65),
      ...findMatches(downtownStored, undergroundStored, 0.65),
    ];

    db.clearMatches();
    const byConfidence = { high: 0, medium: 0, low: 0 };
    for (const match of allMatches) {
      db.insertMatch({
        eventId1: match.eventId1,
        eventId2: match.eventId2,
        score: match.totalScore,
        confidence: match.confidence,
        reasons: match.reasons,
        matchType: 'auto',
      });
      byConfidence[match.confidence]++;
    }
    console.log(
      `✓ Found ${allMatches.length} matches (${byConfidence.high} high, ${byConfidence.medium} medium, ${byConfidence.low} low)\n`,
    );

    console.log(`📊 Total: ${db.getTotalCount()} events`);
    console.log('✅ Re-fetch complete!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
