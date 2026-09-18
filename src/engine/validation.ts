import type { CandidateItem, FeatureVector, LearnerState, RecommendationWeights } from './recommendation.types.js';

export const FEATURE_KEYS = ['gap_coverage', 'precision', 'level_fit', 'evidence_confidence', 'constraint_fit', 'outcome_prior', 'scarcity', 'freshness', 'redundancy_penalty'] as const;
const CONFIDENCES = ['very_low', 'low', 'medium_low', 'medium', 'medium_high', 'high'];

export function finiteRange(value: number, name: string, minimum = 0, maximum = Infinity): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be finite and between ${minimum} and ${maximum}`);
}

export function validDate(value: Date, name: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new RangeError(`${name} must be a valid Date`);
}

export function validateLearner(learner: LearnerState): void {
  if (!learner.learnerId?.trim()) throw new TypeError('learnerId is required');
  const ids = new Set<string>();
  for (const skill of learner.skills) {
    if (!skill.skillId || ids.has(skill.skillId)) throw new TypeError('Learner skill IDs must be nonempty and unique');
    ids.add(skill.skillId);
    finiteRange(skill.declaredLevel, 'declaredLevel', 0, 4);
    finiteRange(skill.targetLevel, 'targetLevel', 0, 4);
    finiteRange(skill.importance, 'importance');
    finiteRange(skill.gap, 'gap', 0, 4);
    if (Math.abs(skill.gap - Math.max(0, skill.targetLevel - skill.declaredLevel)) > 1e-8)
      throw new RangeError(`Inconsistent gap for ${skill.skillId}`);
    if (!CONFIDENCES.includes(skill.confidence)) throw new TypeError('Unknown evidence confidence');
  }
  for (const [id, level] of Object.entries(learner.prerequisiteLevels ?? {})) {
    if (!id) throw new TypeError('Prerequisite skill ID is required');
    finiteRange(level, 'prerequisiteLevel', 0, 4);
    const skill = learner.skills.find((candidate) => candidate.skillId === id);
    if (skill && skill.declaredLevel !== level) throw new RangeError(`Conflicting levels for ${id}`);
  }
  const c = learner.constraints;
  if (c.budgetMad !== undefined) finiteRange(c.budgetMad, 'budgetMad');
  if (c.maxDurationHours !== undefined) finiteRange(c.maxDurationHours, 'maxDurationHours');
  if (c.hoursPerWeek !== undefined) {
    finiteRange(c.hoursPerWeek, 'hoursPerWeek', 0, 168);
    if (c.hoursPerWeek === 0) throw new RangeError('hoursPerWeek must be positive');
  }
  if (c.deadline) validDate(c.deadline, 'deadline');
  if (learner.levelPrior !== undefined) finiteRange(learner.levelPrior, 'levelPrior', -4, 4);
}

export function validateItem(item: CandidateItem): void {
  if (!item.id) throw new TypeError('Course ID is required');
  if (item.priceMad !== null) finiteRange(item.priceMad, 'priceMad');
  if (item.durationHours !== null) {
    finiteRange(item.durationHours, 'durationHours');
    if (item.durationHours === 0) throw new RangeError('durationHours must be positive');
  }
  if (item.requiredWeeklyHours != null) {
    finiteRange(item.requiredWeeklyHours, 'requiredWeeklyHours', 0, 168);
    if (item.requiredWeeklyHours === 0) throw new RangeError('requiredWeeklyHours must be positive');
  }
  for (const [name, date] of Object.entries({ nextSessionAt: item.nextSessionAt, nextEndAt: item.nextEndAt }))
    if (date) validDate(date, name);
  if (item.nextSessionAt && item.nextEndAt && item.nextEndAt < item.nextSessionAt)
    throw new RangeError('Course end precedes start');
  finiteRange(item.outcomePrior, 'outcomePrior', 0, 1);
  const ids = new Set<string>();
  for (const outcome of item.outcomes) {
    if (!outcome.skillId || ids.has(outcome.skillId)) throw new TypeError('Outcome skill IDs must be nonempty and unique');
    ids.add(outcome.skillId);
    finiteRange(outcome.weight, 'outcome weight', 0, 1);
    finiteRange(outcome.catalogFrequency, 'catalogFrequency', 1);
    if (outcome.entryLevel !== null) finiteRange(outcome.entryLevel, 'entryLevel', 0, 4);
    if (outcome.outcomeLevel !== null) finiteRange(outcome.outcomeLevel, 'outcomeLevel', 0, 4);
    if (outcome.entryLevel !== null && outcome.outcomeLevel !== null && outcome.entryLevel >= outcome.outcomeLevel)
      throw new RangeError('Course outcome must exceed entry level');
  }
  for (const prerequisite of item.prerequisites ?? []) {
    if (!prerequisite.skillId) throw new TypeError('Prerequisite skill ID is required');
    finiteRange(prerequisite.minimumLevel, 'minimumLevel', 0, 4);
  }
}

export function validateVector(vector: FeatureVector): void {
  for (const key of FEATURE_KEYS) finiteRange(vector[key], key, 0, 1);
}

export function validateWeights(weights: RecommendationWeights): void {
  for (const key of FEATURE_KEYS) finiteRange(weights[key], `weight ${key}`, 0, 1);
  const sum = FEATURE_KEYS.filter((key) => key !== 'redundancy_penalty').reduce((total, key) => total + weights[key], 0);
  if (sum <= 0 || sum > 1 + 1e-8) throw new RangeError('Positive score weights must sum to a value in (0,1]');
}
