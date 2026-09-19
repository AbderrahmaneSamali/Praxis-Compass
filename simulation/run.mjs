// Runs simulated learners through the real engine pipeline
// (evidence -> evidence profile -> target gaps -> ranking -> plans) and grades
// the results against each learner's hidden truth.
//   npm run simulate            (after npm run build)
//   node simulation/run.mjs --learners 400 --seed 7
import { mkdir, writeFile } from 'node:fs/promises';
import { StandaloneRecommendationRepository } from '../dist/index.js';
import { rng, SIM_NOW, WEIGHTS, targetProfile, syntheticCatalog, pilotCourses } from './world.mjs';
import { makeLearner, evidenceFor } from './learners.mjs';
import { grade, gradeBaseline } from './oracle.mjs';

class SimulatedRepository extends StandaloneRecommendationRepository {
  constructor(catalog, { partialTarget = false } = {}) {
    super({}); this.catalog = catalog; this.evidence = new Map(); this.partialTarget = partialTarget; this.current = null;
  }
  async activeWeights() { return { version: 'praxis-rank-reliable-v4', weights: WEIGHTS }; }
  async items() { return this.catalog; }
  async skillEvidence(learnerId) { this.current = learnerId; return this.evidence.get(learnerId) ?? []; }
  async assessmentAvailability() { return []; }
  async neighbourSkillIds() { return new Set(); }
  async deriveTargetProfile(occupationId) {
    const profile = targetProfile(occupationId);
    if (!this.partialTarget) return profile;
    // WHAT-IF ONLY, not engine behaviour: rank against the skills the learner
    // has usable evidence for, leaving the unanswered ones to be asked for.
    const known = new Set((this.evidence.get(this.current) ?? [])
      .filter((row) => row.evidenceType !== 'cv_extracted_unconfirmed').map((row) => row.skillId));
    const skills = profile.skills.filter((skill) => known.has(skill.skillId));
    return skills.length ? { ...profile, skills } : profile;
  }
}

function sum(rows, key) { return rows.reduce((total, row) => total + (row[key] ?? 0), 0); }
function ratio(a, b) { return b ? a / b : null; }

function summarise(rows, baselines) {
  const withGaps = rows.filter((row) => !row.trulySatisfied);
  const reachable = rows.filter((row) => row.reachableGapCount > 0);
  const closures = rows.map((row) => row.planTrueClosure).filter((value) => value !== null);
  const summary = {
    learners: rows.length,
    trulyNeedHelp: withGaps.length,
    servedWhenHelpPossible: ratio(reachable.filter((row) => row.served).length, reachable.length),
    insufficientProfile: ratio(rows.filter((row) => row.status === 'insufficient_profile').length, rows.length),
    wronglyToldDone: ratio(rows.filter((row) => row.wrongGoalSatisfied).length, withGaps.length),
    precisionAt5: ratio(sum(rows, 'useful'), sum(rows, 'recommended')),
    readyAt5: ratio(sum(rows, 'ready'), sum(rows, 'recommended')),
    reachableGapRecallAt5: ratio(sum(rows, 'coveredReachable'), sum(rows, 'reachableGapCount')),
    meanPlanTrueClosure: closures.length ? closures.reduce((a, b) => a + b, 0) / closures.length : null,
    constraintViolations: sum(rows, 'violations'),
  };
  if (baselines) for (const [name, list] of Object.entries(baselines))
    summary[`${name}PrecisionAt5`] = ratio(sum(list, 'useful'), sum(list, 'recommended'));
  return summary;
}

async function runCell({ name, catalog, behaviour, recall, learners, seed, partialTarget = false }) {
  const repo = new SimulatedRepository(catalog, { partialTarget });
  const r = rng(seed);
  const rows = [], randomRows = [], popularRows = [], byArchetype = {};
  for (let i = 1; i <= learners; i++) {
    const learner = makeLearner(i, r);
    repo.evidence.set(learner.context.learnerId, evidenceFor(learner, behaviour, r, { recall }));
    const result = await repo.recommendFromEvidence(learner.context, learner.occupationId,
      { now: SIM_NOW, explorationProbability: 0 });
    const row = { archetype: learner.archetype, ...grade(result, learner, catalog) };
    rows.push(row);
    (byArchetype[learner.archetype] ??= []).push(row);
    if (result.recommendations.length) {
      randomRows.push(gradeBaseline((pool) => [...pool].sort(() => r() - 0.5), result, learner));
      popularRows.push(gradeBaseline((pool) => [...pool].sort((a, b) => b.popularity - a.popularity), result, learner));
    }
  }
  return {
    name, behaviour, recall: behaviour.startsWith('cv') ? recall : null,
    overall: summarise(rows, { randomEligible: randomRows, mostPopular: popularRows }),
    byArchetype: Object.fromEntries(Object.entries(byArchetype).map(([key, list]) => [key, summarise(list)])),
  };
}

function arg(flag, fallback) {
  const at = process.argv.indexOf(flag);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
}

const learners = arg('--learners', 300);
const seed = arg('--seed', 20260919);
const full = [...syntheticCatalog(seed), ...pilotCourses('draft')];

const cells = [];
// 1. How evidence quality changes advice quality (full synthetic catalog).
for (const behaviour of ['assessed', 'honest', 'overconfident', 'underconfident', 'skips'])
  cells.push(await runCell({ name: `evidence:${behaviour}`, catalog: full, behaviour, learners, seed }));
// 2. How CV-reader recall changes who gets advice at all.
for (const recall of [0.2, 0.3, 0.6, 0.9])
  cells.push(await runCell({ name: `cv:recall=${recall}`, catalog: full, behaviour: 'cv', recall, learners, seed }));
cells.push(await runCell({ name: 'cv:unconfirmed', catalog: full, behaviour: 'cv_unconfirmed', recall: 0.9, learners, seed }));
// What-if: advise on answered skills instead of withholding all advice until every skill is known.
cells.push(await runCell({ name: 'what-if partial advice: skips', catalog: full, behaviour: 'skips', learners, seed, partialTarget: true }));
for (const recall of [0.3, 0.6])
  cells.push(await runCell({ name: `what-if partial advice: cv:recall=${recall}`, catalog: full, behaviour: 'cv', recall, learners, seed, partialTarget: true }));
// 3. Only the three real pilot courses: as drafts today, and if published after review.
for (const status of ['draft', 'published'])
  cells.push(await runCell({ name: `pilot-only:${status}`, catalog: pilotCourses(status), behaviour: 'honest', learners, seed }));

const report = {
  kind: 'synthetic_learner_simulation',
  warning: 'Synthetic learners, synthetic catalog and assumed behaviour models. Measures engine logic under stated assumptions; not evidence about real learners.',
  seed, learnersPerCell: learners, simulatedAt: SIM_NOW.toISOString(), cells,
};

const pct = (value) => (value === null ? '—' : `${Math.round(value * 100)}%`);
const lines = [
  '| Scenario | Served (when help exists) | Asked for more info | Told "done" wrongly | Useful @5 | Ready @5 | Gap recall @5 | Plan closes gaps | Violations | Random @5 | Popular @5 |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...cells.map(({ name, overall: o }) => `| ${name} | ${pct(o.servedWhenHelpPossible)} | ${pct(o.insufficientProfile)} | ${pct(o.wronglyToldDone)} | ${pct(o.precisionAt5)} | ${pct(o.readyAt5)} | ${pct(o.reachableGapRecallAt5)} | ${pct(o.meanPlanTrueClosure)} | ${o.constraintViolations} | ${pct(o.randomEligiblePrecisionAt5)} | ${pct(o.mostPopularPrecisionAt5)} |`),
];
const markdown = `# Simulation report (synthetic)\n\n${report.warning}\n\nSeed ${seed}, ${learners} learners per scenario.\n\n${lines.join('\n')}\n`;

await mkdir(new URL('./out/', import.meta.url), { recursive: true });
await writeFile(new URL('./out/report.json', import.meta.url), JSON.stringify(report, null, 2));
await writeFile(new URL('./out/report.md', import.meta.url), markdown);
console.log(markdown);
