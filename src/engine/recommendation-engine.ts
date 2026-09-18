import {
  courseFinish,
  knownLevels,
  prerequisiteRequirements,
} from './learning-path-planner.js';
import { createHash } from 'node:crypto';
import { finiteRange, validDate, validateItem, validateLearner, validateVector, validateWeights } from './validation.js';

import {
  type EvidenceConfidence,
  withComputationProvenance,
} from '../kernel/index.js';
import type {
  CandidateItem,
  CandidateGeneration,
  CandidatePools,
  FeatureVector,
  LearnerState,
  OutcomePriorEstimatorConfig,
  OutcomePriorEvidence,
  OutcomePriorSource,
  RecommendationReason,
  RecommendationWeights,
  ScoredRecommendation,
} from './recommendation.types.js';

const CONFIDENCE_VALUE: Readonly<Record<EvidenceConfidence, number>> = {
  very_low: 0.1,
  low: 0.3,
  medium_low: 0.45,
  medium: 0.6,
  medium_high: 0.8,
  high: 1,
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Known limits are eligibility gates, not penalties popularity can outweigh. */
export function eligibilityIssues(
  item: CandidateItem,
  learner: LearnerState,
  now = new Date(),
): readonly string[] {
  validateLearner(learner);
  validateItem(item);
  validDate(now, 'now');
  const c = learner.constraints;
  const issues: string[] = [];
  if (
    c.budgetFlexibility !== 'flexible' &&
    c.budgetMad !== undefined &&
    item.priceMad !== null &&
    item.priceMad > c.budgetMad
  )
    issues.push('budget');
  if (
    c.maxDurationHours !== undefined &&
    item.durationHours !== null &&
    item.durationHours > c.maxDurationHours
  )
    issues.push('duration');
  if (
    item.isOnline !== true ||
    !['online_live', 'online_self_paced'].includes(item.deliveryFormat ?? '')
  )
    issues.push('online_only');
  if (
    c.budgetMad !== undefined &&
    c.budgetFlexibility !== 'flexible' &&
    item.priceMad === null
  )
    issues.push('budget_unknown');
  if (
    c.onlineFormat &&
    c.formatFlexibility === 'mandatory' &&
    item.deliveryFormat !== c.onlineFormat
  )
    issues.push('format');
  if (
    c.hoursPerWeek !== undefined &&
    item.requiredWeeklyHours != null &&
    item.requiredWeeklyHours > c.hoursPerWeek
  )
    issues.push('weekly_workload');
  if (
    item.admissionStatus === 'scheduled' &&
    (!item.nextSessionAt ||
      item.nextSessionAt.getTime() <
        new Date(now.toISOString().slice(0, 10)).getTime())
  )
    issues.push('session_unavailable');
  if (c.deadline) {
    const finish = courseFinish(item, learner, now);
    if (!finish) issues.push('completion_unknown');
    else if (finish > c.deadline) issues.push('completion_deadline');
  }
  if (
    c.languageFlexibility !== 'flexible' &&
    c.languages?.length &&
    !item.languages.some((language) => c.languages!.includes(language))
  )
    issues.push('language');
  if (
    c.rejectedFormats?.some(
      (format) =>
        format.toLowerCase() ===
        (item.deliveryFormat ?? item.format)?.toLowerCase(),
    )
  )
    issues.push('rejected_format');
  if (
    item.nextSessionAt &&
    c.rejectedSessionDates?.includes(
      item.nextSessionAt.toISOString().slice(0, 10),
    )
  )
    issues.push('rejected_date');
  const held = knownLevels(learner);
  for (const requirement of prerequisiteRequirements(item)) {
    if (!held.has(requirement.skillId)) issues.push('prerequisite_unknown');
    else if (held.get(requirement.skillId)! < requirement.minimumLevel)
      issues.push('prerequisite');
  }
  return issues;
}

/** A mapped skill alone does not establish that a course advances the learner. */
export function advancesGoal(
  item: CandidateItem,
  learner: LearnerState,
): boolean {
  return coveredGaps(item, learner).some(
    ({ outcome, gap }) =>
      outcome.weight > 0 &&
      (outcome.outcomeLevel === null ||
        outcome.outcomeLevel > gap.declaredLevel),
  );
}

export function candidates(
  pools: CandidatePools,
  cap = 200,
  deadline?: Date,
  priority?: (item: CandidateItem) => number,
): CandidateGeneration {
  if (!Number.isInteger(cap) || cap < 0) throw new RangeError('Candidate cap must be a nonnegative integer');
  if (deadline) validDate(deadline, 'deadline');
  const beforeDedupCount =
    pools.gapItems.length +
    pools.targetPathwayItems.length +
    pools.neighbourhoodItems.length +
    pools.popularityItems.length;
  const deduplicated = new Map<string, CandidateItem>();
  for (const pool of [
    pools.gapItems,
    pools.targetPathwayItems,
    pools.neighbourhoodItems,
    pools.popularityItems,
  ]) {
    for (const item of pool) {
      if (!deduplicated.has(item.id)) deduplicated.set(item.id, item);
    }
  }
  const deduplicatedItems = [...deduplicated.values()];
  const deadlineExcluded = deduplicatedItems
    .filter(
      (item) =>
        deadline !== undefined &&
        item.nextSessionAt !== null &&
        item.nextSessionAt.getTime() > deadline.getTime(),
    )
    .map((item) => item.id);
  const eligibleItems = deduplicatedItems.filter(
    (item) => !deadlineExcluded.includes(item.id),
  );
  if (priority) {
    const priorities = new Map(eligibleItems.map((item) => {
      const value = priority(item);
      finiteRange(value, 'candidate priority');
      return [item.id, value] as const;
    }));
    eligibleItems.sort((a, b) => priorities.get(b.id)! - priorities.get(a.id)! || a.id.localeCompare(b.id));
  }
  const capped = eligibleItems.slice(0, cap);
  const dropped = eligibleItems.slice(cap).map((item) => item.id);
  return {
    items: capped,
    dropped,
    deadlineExcluded,
    beforeDedupCount,
    afterDedupCount: deduplicated.size,
  };
}

function coveredGaps(item: CandidateItem, learner: LearnerState) {
  validateLearner(learner);
  validateItem(item);
  const gapBySkill = new Map(
    learner.skills
      .filter((skill) => skill.gap > 0 && skill.importance > 0)
      .map((skill) => [skill.skillId, skill]),
  );
  return item.outcomes.flatMap((outcome) => {
    const gap = gapBySkill.get(outcome.skillId);
    return gap &&
      outcome.weight > 0 &&
      (outcome.outcomeLevel === null ||
        outcome.outcomeLevel > gap.declaredLevel)
      ? [
          {
            outcome,
            gap,
            progress:
              outcome.outcomeLevel === null
                ? gap.gap * 0.5
                : Math.min(gap.gap, outcome.outcomeLevel - gap.declaredLevel),
          },
        ]
      : [];
  });
}

export function gapCoverage(
  item: CandidateItem,
  learner: LearnerState,
): number {
  validateLearner(learner);
  validateItem(item);
  const denominator = learner.skills.reduce(
    (sum, skill) => sum + skill.gap * skill.importance,
    0,
  );
  if (denominator === 0) return 0.5;
  const numerator = coveredGaps(item, learner).reduce(
    (sum, { outcome, gap, progress }) =>
      sum + progress * gap.importance * outcome.weight,
    0,
  );
  return clamp(numerator / denominator);
}

export function precision(item: CandidateItem, learner: LearnerState): number {
  validateLearner(learner);
  validateItem(item);
  const denominator = item.outcomes.reduce(
    (sum, outcome) => sum + outcome.weight,
    0,
  );
  if (denominator === 0) return 0;
  const numerator = coveredGaps(item, learner).reduce(
    (sum, { outcome, gap, progress }) =>
      sum + progress * gap.importance * outcome.weight,
    0,
  );
  const maxImportance = Math.max(
    1,
    ...learner.skills.map((skill) => skill.gap * skill.importance),
  );
  return clamp(numerator / (denominator * maxImportance));
}

export function levelFit(item: CandidateItem, learner: LearnerState): number {
  const fits = coveredGaps(item, learner).flatMap(({ outcome, gap }) =>
    outcome.entryLevel === null
      ? []
      : [
          clamp(
            1 -
              Math.abs(
                outcome.entryLevel -
                  Math.max(
                    0,
                    Math.min(4, gap.declaredLevel + (learner.levelPrior ?? 0)),
                  ),
              ) /
                4,
          ),
        ],
  );
  return fits.length === 0
    ? 0.5
    : fits.reduce((sum, value) => sum + value, 0) / fits.length;
}

export function evidenceConfidence(
  item: CandidateItem,
  learner: LearnerState,
): number {
  const values = coveredGaps(item, learner).map(
    ({ gap }) => CONFIDENCE_VALUE[gap.confidence],
  );
  return values.length === 0
    ? 0.5
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function constraintFit(
  item: CandidateItem,
  learner: LearnerState,
): number {
  validateLearner(learner);
  validateItem(item);
  const checks: number[] = [];
  const constraints = learner.constraints;
  if (constraints.budgetMad !== undefined && item.priceMad !== null) {
    checks.push(item.priceMad <= constraints.budgetMad ? 1 : 0);
  }
  if (
    constraints.maxDurationHours !== undefined &&
    item.durationHours !== null
  ) {
    checks.push(item.durationHours <= constraints.maxDurationHours ? 1 : 0);
  }
  if (constraints.languages?.length && item.languages.length) {
    checks.push(
      item.languages.some((language) =>
        constraints.languages?.includes(language),
      )
        ? 1
        : 0,
    );
  }
  if (constraints.format && item.format) {
    checks.push(
      item.format.toLowerCase().includes(constraints.format.toLowerCase())
        ? 1
        : 0,
    );
  }
  if (constraints.onlineFormat)
    checks.push(item.deliveryFormat === constraints.onlineFormat ? 1 : 0);
  if (!constraints.onlineFormat && constraints.formatPreferences?.length) {
    const delivery = (item.deliveryFormat ?? item.format ?? '').toLowerCase();
    checks.push(
      constraints.formatPreferences.some((preference) =>
        delivery.includes(preference.toLowerCase()),
      )
        ? 1
        : 0,
    );
  }
  if (constraints.remoteOnly === true) {
    checks.push(item.isOnline === true ? 1 : 0);
  } else if (constraints.locationCity && item.locationCity) {
    checks.push(
      item.locationCity.toLocaleLowerCase() ===
        constraints.locationCity.toLocaleLowerCase()
        ? 1
        : 0,
    );
  }
  if (constraints.rejectedFormats?.length && item.format) {
    checks.push(
      constraints.rejectedFormats.some(
        (format) => format.toLowerCase() === item.format?.toLowerCase(),
      )
        ? 0
        : 1,
    );
  }
  if (constraints.rejectedSessionDates?.length && item.nextSessionAt) {
    const sessionDate = item.nextSessionAt.toISOString().slice(0, 10);
    checks.push(constraints.rejectedSessionDates.includes(sessionDate) ? 0 : 1);
  }
  return checks.length === 0
    ? 0.5
    : checks.reduce((sum, value) => sum + value, 0) / checks.length;
}

export function outcomePrior(item: CandidateItem): number {
  finiteRange(item.outcomePrior, 'outcomePrior', 0, 1);
  return clamp(item.outcomePrior);
}

type OutcomePriorEstimate = Readonly<{
  outcomePrior: number;
  source: OutcomePriorSource;
  trialCount: number;
}>;

function assertStats(stats: OutcomePriorEvidence) {
  for (const [name, value] of Object.entries(stats)) {
    if (
      !Number.isFinite(value.successes) ||
      !Number.isInteger(value.trials) ||
      value.successes < 0 ||
      value.trials < 0 ||
      value.successes > value.trials
    ) {
      throw new RangeError(`Invalid outcome stats for ${name}`);
    }
  }
}

function shrink(
  successes: number,
  trials: number,
  prior: number,
  alpha: number,
) {
  return clamp((successes + alpha * prior) / (trials + alpha));
}

const stampedOutcomePrior = withComputationProvenance(
  'outcomePriorEstimator',
  (
    input: Readonly<{
      evidence: OutcomePriorEvidence;
      editorial: Readonly<{
        featured: boolean;
        coldStartRank: number | null;
        sourceVersion: string | null;
      }>;
      config: OutcomePriorEstimatorConfig;
    }>,
  ): OutcomePriorEstimate => {
    const { config, evidence, editorial } = input;
    assertStats(evidence);
    if (!Number.isFinite(config.alpha) || config.alpha <= 0) {
      throw new RangeError('Outcome-prior alpha must be positive');
    }
    const boundedConfig = [
      config.neutral_prior,
      config.featured_prior,
      config.rank_decay,
    ];
    if (
      boundedConfig.some(
        (value) => !Number.isFinite(value) || value < 0 || value > 1,
      )
    ) {
      throw new RangeError(
        'Outcome-prior editorial configuration must be in [0,1]',
      );
    }
    for (const [name, value] of Object.entries(config.minimum_trials)) {
      if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`Invalid minimum trials for ${name}`);
      }
    }

    const hasEditorial =
      editorial.featured ||
      editorial.coldStartRank !== null ||
      editorial.sourceVersion !== null;
    const editorialPrior = hasEditorial
      ? clamp(
          (editorial.featured ? config.featured_prior : config.neutral_prior) *
            Math.pow(
              config.rank_decay,
              Math.max(0, (editorial.coldStartRank ?? 1) - 1),
            ),
        )
      : config.neutral_prior;

    if (evidence.global.trials >= config.minimum_trials.global) {
      const globalPrior = shrink(
        evidence.global.successes,
        evidence.global.trials,
        editorialPrior,
        config.alpha,
      );
      if (evidence.sector.trials >= config.minimum_trials.sector) {
        const sectorPrior = shrink(
          evidence.sector.successes,
          evidence.sector.trials,
          globalPrior,
          config.alpha,
        );
        if (
          evidence.productFamilySector.trials >=
          config.minimum_trials.product_family_sector
        ) {
          const familyPrior = shrink(
            evidence.productFamilySector.successes,
            evidence.productFamilySector.trials,
            sectorPrior,
            config.alpha,
          );
          if (evidence.itemSegment.trials >= config.minimum_trials.item) {
            return Object.freeze({
              outcomePrior: shrink(
                evidence.itemSegment.successes,
                evidence.itemSegment.trials,
                familyPrior,
                config.alpha,
              ),
              source: 'item_segment',
              trialCount: evidence.itemSegment.trials,
            });
          }
          return Object.freeze({
            outcomePrior: familyPrior,
            source: 'product_family_sector',
            trialCount: evidence.productFamilySector.trials,
          });
        }
        return Object.freeze({
          outcomePrior: sectorPrior,
          source: 'sector',
          trialCount: evidence.sector.trials,
        });
      }
      return Object.freeze({
        outcomePrior: globalPrior,
        source: 'global',
        trialCount: evidence.global.trials,
      });
    }
    return Object.freeze({
      outcomePrior: editorialPrior,
      source: hasEditorial ? 'editorial' : 'uninformed',
      trialCount: 0,
    });
  },
);

export function estimateOutcomePrior(
  input: Readonly<{
    evidence: OutcomePriorEvidence;
    editorial: Readonly<{
      featured: boolean;
      coldStartRank: number | null;
      sourceVersion: string | null;
    }>;
    config: OutcomePriorEstimatorConfig;
  }>,
) {
  return stampedOutcomePrior(input);
}

export function applyOutcomePriorEstimate(
  item: CandidateItem,
  config: OutcomePriorEstimatorConfig,
): CandidateItem {
  const estimate = estimateOutcomePrior({
    evidence: item.outcomePriorEvidence,
    editorial: {
      featured: item.featured,
      coldStartRank: item.coldStartRank,
      sourceVersion: item.coldStartSourceVersion,
    },
    config,
  });
  return Object.freeze({
    ...item,
    outcomePrior: estimate.value.outcomePrior,
    outcomePriorSource: estimate.value.source,
    outcomePriorTrialCount: estimate.value.trialCount,
    outcomePriorAlgorithmVersion: estimate.provenance.version,
    outcomePriorInputsHash: estimate.provenance.inputsHash,
  });
}

export function scarcity(item: CandidateItem, learner: LearnerState): number {
  const values = coveredGaps(item, learner).map(({ outcome }) =>
    clamp(1 / Math.sqrt(Math.max(1, outcome.catalogFrequency))),
  );
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function freshness(item: CandidateItem, now = new Date()): number {
  validDate(now, 'now');
  if (item.nextSessionAt) validDate(item.nextSessionAt, 'nextSessionAt');
  if (!item.nextSessionAt) return 0.5;
  const days = (item.nextSessionAt.getTime() - now.getTime()) / 86_400_000;
  if (days < 0) return 0;
  return clamp(Math.exp(-days / 120));
}

export function redundancyPenalty(
  item: CandidateItem,
  learner: LearnerState,
): number {
  validateLearner(learner);
  validateItem(item);
  const held = new Map(
    learner.skills.map((skill) => [skill.skillId, skill.declaredLevel]),
  );
  const comparable = item.outcomes.filter(
    (outcome) => outcome.outcomeLevel !== null,
  );
  if (comparable.length === 0) return 0;
  const redundant = comparable.filter(
    (outcome) =>
      (held.get(outcome.skillId) ?? 0) >= (outcome.outcomeLevel ?? 5),
  );
  return redundant.length / comparable.length;
}

export function features(
  item: CandidateItem,
  learner: LearnerState,
  now = new Date(),
): FeatureVector {
  validateLearner(learner);
  validateItem(item);
  validDate(now, 'now');
  return Object.freeze({
    gap_coverage: gapCoverage(item, learner),
    precision: precision(item, learner),
    level_fit: levelFit(item, learner),
    evidence_confidence: evidenceConfidence(item, learner),
    constraint_fit: constraintFit(item, learner),
    outcome_prior: outcomePrior(item),
    scarcity: scarcity(item, learner),
    freshness: freshness(item, now),
    redundancy_penalty: redundancyPenalty(item, learner),
  });
}

const stampedScore = withComputationProvenance(
  'recommendationRanker',
  (
    input: Readonly<{ vector: FeatureVector; weights: RecommendationWeights }>,
  ) => {
    const { vector, weights } = input;
    return clamp(
      vector.gap_coverage * weights.gap_coverage +
        vector.precision * weights.precision +
        vector.level_fit * weights.level_fit +
        vector.evidence_confidence * weights.evidence_confidence +
        vector.constraint_fit * weights.constraint_fit +
        vector.outcome_prior * weights.outcome_prior +
        vector.scarcity * weights.scarcity +
        vector.freshness * weights.freshness -
        vector.redundancy_penalty * weights.redundancy_penalty,
    );
  },
);

export function score(vector: FeatureVector, weights: RecommendationWeights) {
  validateVector(vector);
  validateWeights(weights);
  return stampedScore({ vector, weights });
}

export function reasons(
  item: CandidateItem,
  learner: LearnerState,
): readonly RecommendationReason[] {
  const result: RecommendationReason[] = coveredGaps(item, learner)
    .sort(
      (left, right) =>
        right.gap.gap * right.gap.importance * right.outcome.weight -
        left.gap.gap * left.gap.importance * left.outcome.weight,
    )
    .slice(0, 3)
    .map(({ gap }) => ({
      kind: 'covers_gap',
      skillId: gap.skillId,
      gap: gap.gap,
      importance: gap.importance,
    }));
  const level = coveredGaps(item, learner).find(
    ({ outcome, gap }) =>
      outcome.entryLevel !== null && outcome.entryLevel <= gap.declaredLevel,
  );
  if (
    level?.outcome.entryLevel !== null &&
    level?.outcome.entryLevel !== undefined
  ) {
    result.push({
      kind: 'level_fit',
      skillId: level.outcome.skillId,
      entryLevel: level.outcome.entryLevel,
      declaredLevel: level.gap.declaredLevel,
    });
  }
  if (
    learner.constraints.languages?.some((language) =>
      item.languages.includes(language),
    )
  ) {
    result.push({ kind: 'constraint_match', dimension: 'language' });
  }
  if (
    learner.constraints.locationCity &&
    item.locationCity?.toLocaleLowerCase() ===
      learner.constraints.locationCity.toLocaleLowerCase()
  ) {
    result.push({ kind: 'constraint_match', dimension: 'location' });
  }
  if (
    learner.constraints.budgetMad !== undefined &&
    item.priceMad !== null &&
    item.priceMad <= learner.constraints.budgetMad
  ) {
    result.push({ kind: 'constraint_match', dimension: 'budget' });
  }
  if (
    learner.constraints.maxDurationHours !== undefined &&
    item.durationHours !== null &&
    item.durationHours <= learner.constraints.maxDurationHours
  ) {
    result.push({ kind: 'constraint_match', dimension: 'duration' });
  }
  if (
    learner.constraints.hoursPerWeek !== undefined &&
    learner.constraints.hoursPerWeek > 0 &&
    item.durationHours !== null &&
    item.durationHours > 0
  ) {
    result.push({
      kind: 'time_plan',
      hoursPerWeek: learner.constraints.hoursPerWeek,
      estimatedWeeks: Math.ceil(
        item.durationHours / learner.constraints.hoursPerWeek,
      ),
    });
  }
  const c = learner.constraints;
  if (
    c.budgetFlexibility === 'flexible' &&
    c.budgetMad !== undefined &&
    (item.priceMad === null || item.priceMad > c.budgetMad)
  )
    result.push({ kind: 'tradeoff', dimension: 'budget' });
  if (
    c.languageFlexibility === 'flexible' &&
    c.languages?.length &&
    !item.languages.some((language) => c.languages!.includes(language))
  )
    result.push({ kind: 'tradeoff', dimension: 'language' });
  if (c.onlineFormat && c.onlineFormat !== item.deliveryFormat)
    result.push({ kind: 'tradeoff', dimension: 'format' });
  return result;
}

function stableTie(learnerId: string, itemId: string): string {
  return createHash('sha256').update(`${learnerId}:${itemId}`).digest('hex');
}

export function rerank(
  scored: readonly ScoredRecommendation[],
  learnerId: string,
): readonly ScoredRecommendation[] {
  const ordered = [...scored].sort(
    (left, right) =>
      right.score - left.score ||
      stableTie(learnerId, left.item.id).localeCompare(
        stableTie(learnerId, right.item.id),
      ),
  );
  const top: ScoredRecommendation[] = [];
  const deferred: ScoredRecommendation[] = [];
  const familyCount = new Map<string, number>();
  for (const item of ordered) {
    const family = item.item.productFamily ?? `record:${item.item.id}`;
    if (top.length < 5 && (familyCount.get(family) ?? 0) < 2) {
      top.push(item);
      familyCount.set(family, (familyCount.get(family) ?? 0) + 1);
    } else {
      deferred.push(item);
    }
  }
  const diversified = [...top, ...deferred];
  const actionable = diversified.filter((item) => item.item.actionableOffer);
  const contextual = diversified.filter((item) => !item.item.actionableOffer);

  return actionable.length >= 3 ? [...actionable, ...contextual] : actionable;
}

export function exploreTopTen<T>(
  ranked: readonly T[],
  random: () => number = Math.random,
  epsilon = 0.05,
): Readonly<{ items: readonly T[]; isExploration: boolean }> {
  finiteRange(epsilon, 'epsilon', 0, 1);
  const draw = () => {
    const value = random();
    finiteRange(value, 'random draw', 0, 1);
    if (value === 1) throw new RangeError('Random draw must be less than 1');
    return value;
  };
  if (ranked.length < 2 || draw() >= epsilon) return { items: ranked, isExploration: false };
  const shuffled = [...ranked.slice(0, 10)];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(draw() * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[swap];
    if (current === undefined || replacement === undefined) continue;
    shuffled[index] = replacement;
    shuffled[swap] = current;
  }
  return {
    items: [...shuffled, ...ranked.slice(10)],
    isExploration: true,
  };
}

export const RECOMMENDATION_EXPLORATION_PROBABILITY = 0.05;
