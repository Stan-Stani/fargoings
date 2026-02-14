import { EventDatabase } from './db/database';

const db = new EventDatabase();
const args = process.argv.slice(2);
const limit = parseInt(args[0]) || 50;
const offset = parseInt(args[1]) || 0;

const events = db.getEvents(limit, offset);

console.log(`\nShowing ${events.length} events (offset: ${offset}):\n`);
console.log('─'.repeat(80));

events.forEach((event, i) => {
  const date = new Date(event.date).toLocaleDateString();
  const time = event.startTime
    ? (() => {
        const [h, m] = event.startTime.split(':').map(Number);
        return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
      })()
    : '';

  console.log(`${offset + i + 1}. ${event.title}`);
  console.log(`   📍 ${event.location || 'TBD'}`);
  console.log(`   📆 ${date} ${time}`);
  console.log(`   🏷️  ${event.source}`);
  console.log(`   🔗 ${event.url}`);
  console.log('');
});

console.log('─'.repeat(80));
console.log(`Total in database: ${db.getTotalCount()}`);
console.log(`\nUsage: npx tsx src/browse.ts [limit] [offset]`);

db.close();
