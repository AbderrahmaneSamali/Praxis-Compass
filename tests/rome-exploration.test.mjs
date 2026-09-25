import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvidenceProfile, exploreDirections } from '../dist/index.js';

const learnerId = 'rome-test-learner';
const releaseId = 'source-release';
const profile = {
  learnerId, currentRoleId: null, currentRomeCode: 'M1405',
  confirmedInterestCodes: [], experience: '', interests: '', constraints: '', updatedAt: null,
};
const source = { label: 'France Travail ROME v61', reference: `rome:${releaseId}:M1419`, reviewStatus: 'official_source' };
const direction = {
  id: 'rome:M1419', roleId: 'rome:M1419', romeCode: 'M1419', kind: 'rome_exploration',
  title: 'Data analyst', description: 'Analyser des données.', responsibilities: [], interestTags: [],
  requirements: [
    { skillId: 'rome:101', romeOgr: '101', requirementKind: 'savoir_faire', label: 'Analyser', targetLevel: null, importance: null, source },
    { skillId: 'rome:102', romeOgr: '102', requirementKind: 'savoir', label: 'Statistiques', targetLevel: null, importance: null, source },
    { skillId: 'rome:103', romeOgr: '103', requirementKind: 'savoir_etre', label: 'Communiquer', targetLevel: null, importance: null, source },
  ],
  reasons: [{ kind: 'rome_shared_skills', fromCodeRome: 'M1405', sharedSkillOgrs: ['101'], originSkillCount: 5, releaseId }],
  sources: [source], workContexts: [],
};
const evidence = buildEvidenceProfile(
  { learnerId, constraints: { remoteOnly: true, hoursPerWeek: 8 } }, [],
  { now: new Date('2026-09-25T12:00:00Z') },
);

test('direct ROME confirmations retain four gap states without inventing a target level', () => {
  const confirmations = [
    { id: 'one', ogr: '101', response: 'practiced', workExample: 'J’ai analysé des données.' },
    { id: 'two', ogr: '102', response: 'not_yet', workExample: '' },
  ];
  const result = exploreDirections(profile, [direction], evidence, [], confirmations);
  const [possibility] = result.possibilities;
  assert.deepEqual(possibility.requirements.map(item => item.state),
    ['supported', 'development_needed', 'unknown']);
  assert.equal(possibility.requirements[0].targetLevel, null);
  assert.equal(possibility.requirements[0].observedLevel, null);
  assert.equal(possibility.requirements[0].evidenceType, 'rome_self_confirmation');
  assert.equal(possibility.reasons[0].kind, 'rome_shared_skills');
  assert.ok(possibility.startingActions.some(action => action.kind === 'evidence_check'));

  const conflicting = exploreDirections(profile, [direction], evidence, [], [
    ...confirmations,
    { id: 'three', ogr: '101', response: 'not_yet', workExample: '' },
  ]).possibilities[0];
  assert.equal(conflicting.requirements[0].state, 'conflicting');
  assert.equal(conflicting.requirements[0].disagreementResolution, 'unresolved');
});
