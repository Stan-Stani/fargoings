import 'dotenv/config';
import { EventDatabase } from './db/database';
import { FargoFetcher } from './fetchers/fargomoorhead-com';
import { FargoUndergroundFetcher } from './fetchers/fargounderground-com';
import { DowntownFargoFetcher } from './fetchers/downtownfargo-com';
import { findMatches } from './dedup/matcher';
import { decodeHtmlEntities } from './dedup/normalize';

async function main() {
  console.log('🎉 Fargo Event Aggregator Starting...\n');

  const db = new EventDatabase();
  const fargoFetcher = new FargoFetcher();
  const undergroundFetcher = new FargoUndergroundFetcher();
  const downtownFetcher = new DowntownFargoFetcher();

  try {
    // Fetch from fargomoorhead.org
    console.log('📥 Fetching events from fargomoorhead.org (next 2 weeks)...');
    const fargoEvents = await fargoFetcher.fetchEvents();
    console.log(`✓ Fetched ${fargoEvents.length} events\n`);

    console.log('💾 Storing fargomoorhead.org events...');
    let fargoInserted = 0;
    for (const event of fargoEvents) {
      const storedEvent = fargoFetcher.transformToStoredEvent(event);
      db.insertEvent(storedEvent);
      fargoInserted++;
    }
    console.log(`✓ Processed ${fargoInserted} events\n`);

    // Fetch from fargounderground.com
    console.log('📥 Fetching events from fargounderground.com (next 2 weeks)...');
    const undergroundEvents = await undergroundFetcher.fetchEvents();
    console.log(`✓ Fetched ${undergroundEvents.length} events\n`);

    console.log('💾 Storing fargounderground.com events...');
    let undergroundInserted = 0;
    for (const event of undergroundEvents) {
      const storedEvent = undergroundFetcher.transformToStoredEvent(event);
      db.insertEvent(storedEvent);
      undergroundInserted++;
    }
    console.log(`✓ Processed ${undergroundInserted} events\n`);

    // Fetch from downtownfargo.com (only fetch details for new events)
    console.log('📥 Fetching events from downtownfargo.com (next 2 weeks)...');
    const existingDowntownIds = db.getEventIdsBySource('downtownfargo.com');
    const downtownEvents = await downtownFetcher.fetchEvents(14, existingDowntownIds);
    console.log(`✓ Fetched ${downtownEvents.length} events\n`);

    console.log('💾 Storing downtownfargo.com events...');
    let downtownInserted = 0;
    for (const event of downtownEvents) {
      const storedEvent = downtownFetcher.transformToStoredEvent(event);
      db.insertEvent(storedEvent);
      downtownInserted++;
    }
    console.log(`✓ Processed ${downtownInserted} events\n`);

    // Deduplicate events across all sources
    console.log('🔍 Finding duplicate events...');
    const fargoStored = db.getEventsBySource('fargomoorhead.org');
    const undergroundStored = db.getEventsBySource('fargounderground.com');
    const downtownStored = db.getEventsBySource('downtownfargo.com');

    // Find matches between all source pairs
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
    console.log(`✓ Found ${allMatches.length} matches (${byConfidence.high} high, ${byConfidence.medium} medium, ${byConfidence.low} low)\n`);

    // Stats
    const totalCount = db.getTotalCount();
    const dedupedCount = db.getDeduplicatedCount();
    console.log(`📊 Statistics:`);
    console.log(`   Total events:  ${totalCount}`);
    console.log(`   After dedup:   ${dedupedCount}`);
    console.log(`   Duplicates:    ${totalCount - dedupedCount}`);

    // Show upcoming deduplicated events
    console.log('\n📅 Upcoming Events (next 10, deduplicated):');
    const upcomingEvents = db.getDeduplicatedEvents(10);
    upcomingEvents.forEach((event, index) => {
      // Format date directly to avoid timezone issues (date is stored as YYYY-MM-DD)
      const [year, month, day] = event.date.split('-');
      const eventDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
      let timeStr = '';
      if (event.startTime) {
        const [h, m] = event.startTime.split(':').map(Number);
        const hour = h % 12 || 12;
        const ampm = h < 12 ? 'AM' : 'PM';
        timeStr = ` at ${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
      }
      const title = decodeHtmlEntities(event.title);
      const location = event.location ? decodeHtmlEntities(event.location) : 'Location TBD';
      console.log(`   ${index + 1}. ${title}`);
      console.log(`      📍 ${location}`);
      console.log(`      📆 ${eventDate}${timeStr}`);
      console.log(`      🔗 ${event.url}`);
      if (event.altUrl) {
        console.log(`      🔗 ${event.altUrl} (alt)`);
      }
      console.log('');
    });

    console.log('✅ Event aggregation complete!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
