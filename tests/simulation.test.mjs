import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceProfile } from '../dist/index.js';
import { rng, course, pilotCourses, syntheticCatalog, SIM_NOW } from '../simulation/world.mjs';
import { makeLearner, evidenceFor } from '../simulation/learners.mjs';
import { violations, ready, useful, grade } from '../simulation/oracle.mjs';

const learner = {
  index: 1, occupationId: 'sim-data-analyst', archetype: 'switcher',
  truth: { skill_prepare_data: 0, skill_build_dashboard: 2, sim_sql: 1, skill_model_data: 1, sim_statistics: 1 },
  context: { learnerId: '00000000-0000-4000-8000-000000000001', constraints: { budgetMad: 500, budgetFlexibility: 'mandatory', languages: ['fr'], languageFlexibility: 'mandatory', hoursPerWeek: 6 } },
};

test('oracle flags every hard-constraint and publication breach independently of the engine', () => {
  const bad = course('bad', [['skill_prepare_data', 0, 1]], { status: 'draft', actionableOffer: false, priceMad: 900, languages: ['en'], requiredWeeklyHours: 10 });
  assert.deepEqual(violations(bad, learner).sort(), ['budget', 'language', 'offer_incomplete', 'unpublished', 'weekly_workload']);
  assert.deepEqual(violations(course('ok', [['skill_prepare_data', 0, 1]]), learner), []);
});

test('oracle judges usefulness and readiness from the hidden truth, not declarations', () => {
  assert.equal(useful(course('known', [['skill_build_dashboard', 1, 2]]), learner), false); // already at target
  assert.equal(useful(course('gap', [['skill_prepare_data', 0, 1]]), learner), true);
  assert.equal(ready(course('too-hard', [['skill_prepare_data', 1, 2]]), learner.truth), false);
});

test('a result that serves a draft or a known skill is graded as a failure', () => {
  const served = [course('draft', [['skill_prepare_data', 0, 1]], { status: 'draft' }), course('known', [['skill_build_dashboard', 1, 2]])];
  const g = grade({ status: 'ok', recommendations: served.map((item) => ({ item })), learningPlans: { plans: [] } }, learner, served);
  assert.equal(g.violations, 1);
  assert.equal(g.useful, 1);
});

test('the same seed rebuilds the same catalog, learners and evidence', () => {
  const build = () => { const r = rng(42); const l = makeLearner(7, r); return JSON.stringify([syntheticCatalog(42), l, evidenceFor(l, 'cv', r, { recall: 0.5 })]); };
  assert.equal(build(), build());
});

test('simulated evidence rows are accepted by the real evidence adapter', () => {
  const r = rng(3);
  for (const behaviour of ['assessed', 'honest', 'overconfident', 'underconfident', 'skips', 'cv', 'cv_unconfirmed']) {
    const l = makeLearner(9, r);
    const profile = buildEvidenceProfile(l.context, evidenceFor(l, behaviour, r), { now: SIM_NOW });
    if (behaviour === 'cv_unconfirmed') assert.equal(profile.learnerState.skills.length, 0);
  }
});

test('the real pilot courses stay drafts unless a scenario explicitly publishes them', () => {
  assert.ok(pilotCourses().every((item) => item.status === 'draft' && item.dataSource === 'official_catalog'));
  assert.ok(syntheticCatalog(1).every((item) => item.dataSource === 'simulation' && item.title.startsWith('SIM')));
});
