// Scores an engine result against the learner's hidden truth. The checks here
// are written independently of the engine so the engine cannot grade itself.
import { OCCUPATIONS } from './world.mjs';

const TOP_K = 5;

function trueGaps(learner) {
  return OCCUPATIONS[learner.occupationId].skills
    .filter(([skillId, target, importance]) => importance > 0 && learner.truth[skillId] < target)
    .map(([skillId, target]) => ({ skillId, target }));
}

/** Hard constraints and publication, re-checked from scratch. */
export function violations(item, learner) {
  const c = learner.context.constraints;
  const found = [];
  if (item.status !== 'published') found.push('unpublished');
  if (!item.actionableOffer) found.push('offer_incomplete');
  if (c.budgetMad !== undefined && c.budgetFlexibility !== 'flexible' && (item.priceMad ?? Infinity) > c.budgetMad) found.push('budget');
  if (c.languageFlexibility !== 'flexible' && c.languages?.length && !item.languages.some((l) => c.languages.includes(l))) found.push('language');
  if (item.requiredWeeklyHours != null && c.hoursPerWeek !== undefined && item.requiredWeeklyHours > c.hoursPerWeek) found.push('weekly_workload');
  return found;
}

/** Could the learner, at their TRUE levels, start this course? */
export function ready(item, levels) {
  return item.outcomes.every((o) => o.entryLevel === null || (levels[o.skillId] ?? 0) >= o.entryLevel) &&
    (item.prerequisites ?? []).every((p) => (levels[p.skillId] ?? 0) >= p.minimumLevel);
}

/** Does the course raise at least one skill the learner TRULY lacks? */
export function useful(item, learner, gaps = trueGaps(learner)) {
  const gapIds = new Set(gaps.map((g) => g.skillId));
  return item.outcomes.some((o) => o.weight > 0 && gapIds.has(o.skillId) && (o.outcomeLevel ?? 4) > learner.truth[o.skillId]);
}

/** Best achievable: which true gaps could ANY eligible, ready, useful course in the catalog advance? */
export function reachableGaps(catalog, learner) {
  const gaps = trueGaps(learner);
  const ok = catalog.filter((item) => violations(item, learner).length === 0 && ready(item, learner.truth));
  return gaps.filter((g) => ok.some((item) => item.outcomes.some((o) => o.skillId === g.skillId && o.weight > 0 && (o.outcomeLevel ?? 4) > learner.truth[g.skillId])));
}

/** Replays a plan from TRUE levels and returns the share of true gaps it actually closes. */
function planTrueClosure(plan, catalog, learner) {
  const gaps = trueGaps(learner);
  if (!plan || !gaps.length) return null;
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const levels = { ...learner.truth };
  for (const step of plan.steps) {
    const item = byId.get(step.itemId);
    if (!item || !ready(item, levels)) break; // learner cannot actually follow the plan past here
    for (const o of item.outcomes) if (o.weight > 0 && o.outcomeLevel !== null) levels[o.skillId] = Math.max(levels[o.skillId] ?? 0, o.outcomeLevel);
  }
  return gaps.filter((g) => levels[g.skillId] >= g.target).length / gaps.length;
}

export function grade(result, learner, catalog) {
  const gaps = trueGaps(learner);
  const reachable = reachableGaps(catalog, learner);
  const recs = result.recommendations.slice(0, TOP_K).map((r) => r.item);
  const covered = new Set();
  let usefulCount = 0, readyCount = 0, violationCount = 0;
  for (const item of recs) {
    const u = useful(item, learner, gaps), rd = ready(item, learner.truth);
    if (u) usefulCount++;
    if (rd) readyCount++;
    if (violations(item, learner).length) violationCount++;
    if (u && rd) for (const o of item.outcomes) if (gaps.some((g) => g.skillId === o.skillId)) covered.add(o.skillId);
  }
  const served = recs.length > 0 || result.learningPlans.plans.length > 0;
  return {
    status: result.status,
    trulySatisfied: gaps.length === 0,
    trueGapCount: gaps.length,
    reachableGapCount: reachable.length,
    served,
    // Engine said "done" while real gaps remain, or asked for more while none existed.
    wrongGoalSatisfied: result.status === 'goal_satisfied' && gaps.length > 0,
    recommended: recs.length,
    useful: usefulCount,
    ready: readyCount,
    violations: violationCount,
    coveredReachable: reachable.filter((g) => covered.has(g.skillId)).length,
    planTrueClosure: planTrueClosure(result.learningPlans.plans[0], catalog, learner),
  };
}

/** Same metrics for a naive recommender drawing from the engine's own eligible pool. */
export function gradeBaseline(pick, result, learner) {
  const excluded = new Set(result.exclusions.map((e) => e.itemId));
  const eligible = result.inputSnapshot.items.filter((item) => !excluded.has(item.id));
  const recs = pick(eligible).slice(0, TOP_K);
  const gaps = trueGaps(learner);
  return {
    recommended: recs.length,
    useful: recs.filter((item) => useful(item, learner, gaps)).length,
    ready: recs.filter((item) => ready(item, learner.truth)).length,
  };
}
