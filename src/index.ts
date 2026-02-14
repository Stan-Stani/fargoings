import 'dotenv/config';
import { EventDatabase } from './db/database';
import { FargoFetcher } from './fetchers/fargomoorhead-com';
import { FargoUndergroundFetcher } from './fetchers/fargounderground-com';

async function main() {
  console.log('🎉 Fargo Event Aggregator Starting...\n');

  const db = new EventDatabase();
  const fargoFetcher = new FargoFetcher();
  const undergroundFetcher = new FargoUndergroundFetcher();

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

    const totalCount = db.getTotalCount();
    console.log(`📊 Database Statistics:`);
    console.log(`   Total events in database: ${totalCount}`);

    console.log('\n📅 Upcoming Events (next 10):');
    const upcomingEvents = db.getEvents(10);
    upcomingEvents.forEach((event, index) => {
      const eventDate = new Date(event.date).toLocaleDateString();
      let timeStr = '';
      if (event.startTime) {
        const [h, m] = event.startTime.split(':').map(Number);
        const hour = h % 12 || 12;
        const ampm = h < 12 ? 'AM' : 'PM';
        timeStr = ` at ${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
      }
      console.log(`   ${index + 1}. ${event.title}`);
      console.log(`      📍 ${event.location || 'Location TBD'}`);
      console.log(`      📆 ${eventDate}${timeStr}`);
      console.log(`      🔗 ${event.url}\n`);
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
