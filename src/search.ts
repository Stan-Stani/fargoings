import { EventDatabase } from './db/database';
import { decodeHtmlEntities } from './dedup/normalize';

const db = new EventDatabase();
const query = process.argv.slice(2).join(' ');

if (!query) {
  console.log('Usage: npm run search <query>');
  console.log('Example: npm run search comedy');
  process.exit(1);
}

// Search in deduplicated events
const allEvents = db.getDeduplicatedEvents(1000);
const results = allEvents.filter(event => {
  const title = decodeHtmlEntities(event.title).toLowerCase();
  const location = event.location ? decodeHtmlEntities(event.location).toLowerCase() : '';
  const q = query.toLowerCase();
  return title.includes(q) || location.includes(q);
});

console.log(`\n🔍 Search results for "${query}" (${results.length} found):\n`);
console.log('─'.repeat(80));

results.forEach((event, i) => {
  const [year, month, day] = event.date.split('-');
  const date = `${parseInt(month)}/${parseInt(day)}/${year}`;
  const time = event.startTime
    ? (() => {
        const [h, m] = event.startTime.split(':').map(Number);
        return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
      })()
    : '';

  const title = decodeHtmlEntities(event.title);
  const location = event.location ? decodeHtmlEntities(event.location) : 'TBD';

  console.log(`${i + 1}. ${title}`);
  console.log(`   📍 ${location}`);
  console.log(`   📆 ${date} ${time}`);
  console.log(`   🔗 ${event.url}`);
  console.log('');
});

db.close();
