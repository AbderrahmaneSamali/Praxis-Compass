import { PraxisEngine } from '../src/index.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('================================================================');
  console.log('   🧭 PRAXIS STANDALONE ENGINE & CAREER COMPASS DEMO');
  console.log('================================================================\n');

  const engine = new PraxisEngine();

  try {
    // 1. Search for a starting occupation
    const query = process.argv[2] ?? 'analyste de données';
    console.log(`🔍 Searching for starting occupation: "${query}"...`);
    const searchResults = await engine.compass.search(query, 'fr', 3);

    if (searchResults.length === 0) {
      console.log(`❌ No occupation found matching "${query}".`);
      return;
    }

    const startRole = searchResults[0];
    console.log(`✅ Selected Role: ${startRole.label} (ID: ${startRole.occupationId})\n`);

    // 2. Run the Career Compass (Next Horizons & Skill Bridges)
    console.log('────────────────────────────────────────────────────────────────');
    console.log(`🧭 CAREER COMPASS: Where can you go after "${startRole.label}"?`);
    console.log('────────────────────────────────────────────────────────────────\n');

    const compass = await engine.compass.explore(startRole.occupationId, 'fr', 4);

    for (const [index, dest] of compass.destinations.entries()) {
      console.log(`[Horizon ${index + 1}] 🚀 ${dest.label}`);
      console.log(`   • Weighted target coverage: ${dest.bridgePercentage}%`);
      console.log(`   • Shared taxonomy skills: ${dest.shared} / ${dest.totalSkills} (${dest.rawOverlapPercentage}% raw overlap)`);
      console.log(`   • Bridge Skills Needed:    ${dest.bridgeSkills.length} skills to acquire`);

      console.log('\n   🟢 Top Shared Skills (Shared by the occupation profiles):');
      for (const skill of dest.sharedSkills.slice(0, 4)) {
        console.log(`      ✓ ${skill.label}`);
      }

      console.log('\n   🔴 Top Bridge Skills (Skills to develop):');
      for (const skill of dest.bridgeSkills.slice(0, 5)) {
        console.log(`      + ${skill.label}`);
      }
      console.log('   ─────────────────────────────────────────────────────────────\n');
    }

    // 3. Run the Recommendation Ranker for the starting role
    console.log('────────────────────────────────────────────────────────────────');
    console.log(`🎯 RECOMMENDATION RANKER: Courses advancing "${startRole.label}"`);
    console.log('────────────────────────────────────────────────────────────────\n');

    const targetProfile = await engine.ranker.deriveTargetProfile(startRole.occupationId, 'fr');
    console.log(`Target profile has ${targetProfile.skills.length} essential skills.`);

    // Mock a learner state with gaps in all essential skills
    const learnerState = {
      learnerId: '00000000-0000-0000-0000-000000000001',
      constraints: {
        budgetMad: 5000,
        hoursPerWeek: 10,
      },
      skills: targetProfile.skills.map((skill) => ({
        skillId: skill.skillId,
        declaredLevel: 0, // Beginner
        targetLevel: skill.targetLevel,
        importance: skill.importance,
        gap: skill.targetLevel,
        confidence: 'medium' as const,
      })),
    };

    console.log('Scoring candidate courses using 9-feature linear model...');
    const rankResult = await engine.ranker.recommend(
      learnerState,
      startRole.occupationId,
      { allowAllPublishedOffers: true },
    );

    if (rankResult.zeroCandidates || rankResult.recommendations.length === 0) {
      console.log('\n⚠️  Zero eligible courses found in catalog for these specific skills.');
      console.log('   (The engine truthfully served 0 rather than hallucinating mock courses.)');
    } else {
      console.log(`\n🎉 Found ${rankResult.recommendations.length} ranked course recommendations:\n`);
      for (const [rank, rec] of rankResult.recommendations.entries()) {
        console.log(`   [Rank ${rank + 1}] 📚 ${rec.item.title}`);
      console.log(`      Score: ${(rec.score * 100).toFixed(1)} / 100 | Format: ${rec.item.deliveryFormat ?? 'Unknown'} | Price: ${rec.item.priceMad === null ? 'Unknown' : `${rec.item.priceMad} MAD`}`);
        console.log(`      Gap Coverage: ${(rec.features.gap_coverage * 100).toFixed(0)}% | Precision: ${(rec.features.precision * 100).toFixed(0)}%`);
        console.log(`      Key Reasons: ${rec.reasons.map((r) => r.kind).join(', ')}`);
        console.log('');
      }
    }

    console.log(`Result status: ${rankResult.status} | Review bypass: ${rankResult.reviewBypassed}`);
    console.log(`Learning plans: ${rankResult.learningPlans.plans.length} (${rankResult.learningPlans.status})`);
    console.log(`Search limit reached: ${rankResult.learningPlans.searchTruncated}`);

    console.log('================================================================');
    console.log('   DEMO RUN COMPLETED SUCCESSFULLY');
    console.log('================================================================');
  } finally {
    await engine.close();
  }
}

main().catch((error) => {
  console.error('Fatal error during demo run:', error);
  process.exit(1);
});
