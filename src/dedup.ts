import { EventDatabase } from './db/database';
import { findMatches, MatchScore } from './dedup/matcher';

async function main() {
  console.log('🔍 Event Deduplication Starting...\n');

  const db = new EventDatabase();

  try {
    // Get events from each source
    const fargoEvents = db.getEventsBySource('fargomoorhead.org');
    const undergroundEvents = db.getEventsBySource('fargounderground.com');

    console.log(`📊 Events by source:`);
    console.log(`   fargomoorhead.org:    ${fargoEvents.length}`);
    console.log(`   fargounderground.com: ${undergroundEvents.length}\n`);

    // Find matches
    console.log('🔄 Finding matches (this may take a moment)...\n');
    const matches = findMatches(fargoEvents, undergroundEvents, 0.65);

    console.log(`✓ Found ${matches.length} potential matches\n`);

    // Clear old matches and insert new ones
    db.clearMatches();

    // Group by confidence
    const byConfidence = { high: 0, medium: 0, low: 0 };

    for (const match of matches) {
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

    console.log(`📈 Matches by confidence:`);
    console.log(`   High:   ${byConfidence.high}`);
    console.log(`   Medium: ${byConfidence.medium}`);
    console.log(`   Low:    ${byConfidence.low}\n`);

    // Show sample matches
    console.log('─'.repeat(80));
    console.log('📋 Sample high-confidence matches:\n');

    const highMatches = matches.filter(m => m.confidence === 'high').slice(0, 5);
    for (const match of highMatches) {
      const event1 = fargoEvents.find(e => e.eventId === match.eventId1);
      const event2 = undergroundEvents.find(e => e.eventId === match.eventId2);

      if (event1 && event2) {
        console.log(`Match (score: ${match.totalScore.toFixed(2)}):`);
        console.log(`  [fargomoorhead]    "${event1.title}"`);
        console.log(`  [fargounderground] "${event2.title}"`);
        console.log(`  Reasons: ${match.reasons.join(', ')}`);
        console.log('');
      }
    }

    // Show dedup stats
    console.log('─'.repeat(80));
    const totalEvents = db.getTotalCount();
    const dedupedCount = db.getDeduplicatedCount();
    const duplicatesRemoved = totalEvents - dedupedCount;

    console.log(`\n📊 Deduplication Results:`);
    console.log(`   Total events:       ${totalEvents}`);
    console.log(`   After dedup:        ${dedupedCount}`);
    console.log(`   Duplicates removed: ${duplicatesRemoved}`);

    console.log('\n✅ Deduplication complete!');
    console.log('   Use "npx tsx src/browse-dedup.ts" to view deduplicated events.');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
