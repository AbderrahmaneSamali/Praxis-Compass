import { ALGORITHM_VERSIONS, hashComputationInputs } from '../kernel/index.js';

export type ExperimentalModelFamily =
  | 'production_baseline'
  | 'popularity_baseline'
  | 'graph'
  | 'sequential'
  | 'graph_sequential';

export type ExperimentOutcome = Readonly<{
  eventId: string;
  learnerId: string;
  itemId: string;
  resolvedAt: Date;
  completionStatus: 'completed' | 'dropped';
  assessedSkillGain: boolean | null;
  sourceClass: 'real' | 'fixture' | 'example';
}>;

export type TemporalEvaluationCase = Readonly<{
  caseId: string;
  learnerId: string;
  segment: string;
  historyEventIds: readonly string[];
  targetEventId: string;
  eligibleItemIds: readonly string[];
}>;

export type ExperimentalModelManifest = Readonly<{
  modelId: string;
  family: ExperimentalModelFamily;
  version: string;
  trainingDataEndsAt: Date;
  featureSnapshotEndsAt: Date;
  graphSnapshotEndsAt: Date | null;
  trainingDataHash: string;
  hyperparameterHash: string;
}>;

export type ExperimentalRanking = Readonly<{
  caseId: string;
  modelId: string;
  rankedItemIds: readonly string[];
}>;

export type GraphSequentialExperimentPolicy = Readonly<{
  version: string;
  trainingEndsAt: Date;
  evaluationEndsAt: Date;
  minimumResolvedOutcomes: number;
  minimumCompletedOutcomes: number;
  minimumRealLearners: number;
  minimumObservedItems: number;
  minimumHistoryLength: number;
  minimumEvaluationCases: number;
  minimumCasesPerSegment: number;
  minimumAssessedOutcomeCases: number;
  kValues: readonly number[];
  primaryMetric: 'hit_rate' | 'ndcg' | 'mrr';
  primaryK: number;
  minimumPrimaryMetricLift: number;
  maximumCatalogCoverageLoss: number;
  maximumSegmentMetricLoss: number;
  maximumAssessedGainNdcgLoss: number;
  confidenceLevel: number;
  bootstrapReplicates: number;
  bootstrapSeed: string;
}>;

export type GraphSequentialExperimentInput = Readonly<{
  outcomes: readonly ExperimentOutcome[];
  cases: readonly TemporalEvaluationCase[];
  models: readonly ExperimentalModelManifest[];
  rankings: readonly ExperimentalRanking[];
  policy: GraphSequentialExperimentPolicy;
  computedAt: Date;
}>;

type RankingMetrics = Readonly<{
  k: number;
  hitRate: number;
  ndcg: number;
  mrr: number;
  catalogCoverage: number;
  assessedGainCaseCount: number;
  assessedGainHitRate: number | null;
  assessedGainNdcg: number | null;
}>;

export type ExperimentalModelEvaluation = Readonly<{
  modelId: string;
  family: ExperimentalModelFamily;
  caseCount: number;
  metrics: readonly RankingMetrics[];
  segmentMetrics: readonly Readonly<{
    segment: string;
    caseCount: number;
    metrics: readonly RankingMetrics[];
  }>[];
}>;

export type ExperimentalModelComparison = Readonly<{
  modelId: string;
  baselineModelId: string;
  primaryMetric: GraphSequentialExperimentPolicy['primaryMetric'];
  primaryK: number;
  baselineValue: number;
  challengerValue: number;
  lift: number;
  confidenceInterval: Readonly<{ level: number; lower: number; upper: number }>;
  catalogCoverageDelta: number;
  worstSegmentDelta: number;
  assessedGainNdcgDelta: number;
  decision: 'eligible_for_prospective_trial' | 'retain_baseline' | 'benchmark_only';
  reasons: readonly string[];
}>;

export type GraphSequentialExperimentBatch = Readonly<{
  algorithmVersion: string;
  policyVersion: string;
  status: 'blocked_insufficient_real_outcomes' | 'offline_evaluated';
  inputsHash: string;
  resultHash: string;
  computedAt: string;
  inputSnapshot: Readonly<Record<string, unknown>>;
  datasetManifest: Readonly<{
    rawOutcomeCount: number;
    realResolvedOutcomeCount: number;
    excludedNonRealOutcomeCount: number;
    excludedPostWindowOutcomeCount: number;
    realCompletedOutcomeCount: number;
    realLearnerCount: number;
    observedItemCount: number;
    evaluationCaseCount: number;
    segmentCounts: Readonly<Record<string, number>>;
    outcomesHash: string;
    casesHash: string;
  }>;
  readinessGates: readonly Readonly<{
    gate: string;
    actual: number;
    required: number;
    ready: boolean;
  }>[];
  evaluations: readonly ExperimentalModelEvaluation[];
  comparisons: readonly ExperimentalModelComparison[];
  limitations: readonly (
    'historical_policy_bias' | 'no_counterfactual_outcomes' | 'completion_is_not_causal_skill_gain' |
    'offline_metrics_do_not_authorize_production'
  )[];
}>;

export type RecommenderExperimentReview = Readonly<{
  reviewerPrincipal: string;
  modelId: string;
  decision: 'approve_prospective_trial' | 'reject' | 'needs_revision';
  rationale: string;
  reviewedAt: Date;
  checklist: Readonly<{
    temporalLeakageChecked: boolean;
    eligibilityConstraintsChecked: boolean;
    baselineComparisonChecked: boolean;
    subgroupMetricsChecked: boolean;
    privacyChecked: boolean;
  }>;
}>;

function requiredText(value: string, name: string, maximum = 300): string {
  const text = value?.trim();
  if (!text || text.length > maximum) throw new RangeError(`${name} must contain 1-${maximum} characters`);
  return text;
}

function validDate(value: Date, name: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${name} must be a valid Date`);
  return value.toISOString();
}

function nonnegativeInteger(value: number, name: string, minimum = 0): number {
  if (!Number.isInteger(value) || value < minimum) throw new RangeError(`${name} must be an integer >= ${minimum}`);
  return value;
}

function unique(values: readonly string[], name: string): readonly string[] {
  if (!Array.isArray(values) || values.some(value => !value?.trim())) throw new TypeError(`${name} must contain non-empty IDs`);
  const normalized = values.map(value => value.trim());
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${name} must contain unique IDs`);
  return normalized;
}

function canonicalOutcome(outcome: ExperimentOutcome) {
  requiredText(outcome.eventId, 'eventId');requiredText(outcome.learnerId, 'learnerId');requiredText(outcome.itemId, 'itemId');
  if (!['completed','dropped'].includes(outcome.completionStatus)) throw new TypeError('completionStatus must be completed or dropped');
  if (!['real','fixture','example'].includes(outcome.sourceClass)) throw new TypeError('sourceClass must be real, fixture, or example');
  if (outcome.assessedSkillGain !== null && typeof outcome.assessedSkillGain !== 'boolean')
    throw new TypeError('assessedSkillGain must be boolean or null');
  return { ...outcome,eventId: outcome.eventId.trim(),learnerId: outcome.learnerId.trim(),itemId: outcome.itemId.trim(),
    resolvedAt: validDate(outcome.resolvedAt, 'resolvedAt') };
}

function validatePolicy(policy: GraphSequentialExperimentPolicy): void {
  requiredText(policy.version, 'policy version', 100);requiredText(policy.bootstrapSeed, 'bootstrapSeed', 200);
  const training = new Date(validDate(policy.trainingEndsAt, 'trainingEndsAt')).getTime();
  const evaluation = new Date(validDate(policy.evaluationEndsAt, 'evaluationEndsAt')).getTime();
  if (evaluation <= training) throw new RangeError('evaluationEndsAt must be after trainingEndsAt');
  nonnegativeInteger(policy.minimumResolvedOutcomes, 'minimumResolvedOutcomes', 1);
  nonnegativeInteger(policy.minimumCompletedOutcomes, 'minimumCompletedOutcomes', 1);
  nonnegativeInteger(policy.minimumRealLearners, 'minimumRealLearners', 1);
  nonnegativeInteger(policy.minimumObservedItems, 'minimumObservedItems', 2);
  nonnegativeInteger(policy.minimumHistoryLength, 'minimumHistoryLength', 1);
  nonnegativeInteger(policy.minimumEvaluationCases, 'minimumEvaluationCases', 1);
  nonnegativeInteger(policy.minimumCasesPerSegment, 'minimumCasesPerSegment', 1);
  nonnegativeInteger(policy.minimumAssessedOutcomeCases, 'minimumAssessedOutcomeCases', 1);
  nonnegativeInteger(policy.bootstrapReplicates, 'bootstrapReplicates', 100);
  if (!Number.isFinite(policy.minimumPrimaryMetricLift) || policy.minimumPrimaryMetricLift < -1 || policy.minimumPrimaryMetricLift > 1)
    throw new RangeError('minimumPrimaryMetricLift must be in [-1,1]');
  if (!Number.isFinite(policy.maximumCatalogCoverageLoss) || policy.maximumCatalogCoverageLoss < 0 || policy.maximumCatalogCoverageLoss > 1)
    throw new RangeError('maximumCatalogCoverageLoss must be in [0,1]');
  if (!Number.isFinite(policy.maximumSegmentMetricLoss) || policy.maximumSegmentMetricLoss < 0 || policy.maximumSegmentMetricLoss > 1)
    throw new RangeError('maximumSegmentMetricLoss must be in [0,1]');
  if (!Number.isFinite(policy.maximumAssessedGainNdcgLoss) || policy.maximumAssessedGainNdcgLoss < 0 || policy.maximumAssessedGainNdcgLoss > 1)
    throw new RangeError('maximumAssessedGainNdcgLoss must be in [0,1]');
  if (!Number.isFinite(policy.confidenceLevel) || policy.confidenceLevel <= .5 || policy.confidenceLevel >= 1)
    throw new RangeError('confidenceLevel must be in (.5,1)');
  if (!['hit_rate','ndcg','mrr'].includes(policy.primaryMetric)) throw new TypeError('primaryMetric is invalid');
  const kValues = unique(policy.kValues.map(String), 'kValues').map(Number);
  if (kValues.some(value => !Number.isInteger(value) || value < 1 || value > 100)) throw new RangeError('kValues must be integers in [1,100]');
  if (!kValues.includes(policy.primaryK)) throw new RangeError('primaryK must be included in kValues');
}

function metricValue(metric: RankingMetrics, name: GraphSequentialExperimentPolicy['primaryMetric']): number {
  return name === 'hit_rate' ? metric.hitRate : name === 'ndcg' ? metric.ndcg : metric.mrr;
}

function rankValue(rank: number | null, k: number, metric: GraphSequentialExperimentPolicy['primaryMetric']): number {
  if (rank === null || rank > k) return 0;
  return metric === 'hit_rate' ? 1 : metric === 'ndcg' ? 1 / Math.log2(rank + 1) : 1 / rank;
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function quantile(sorted: readonly number[], probability: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * probability, lower = Math.floor(position), upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function seededRandom(seed: string): () => number {
  let state = Number.parseInt(hashComputationInputs(seed).slice(0, 8), 16) >>> 0;
  return () => {
    state ^= state << 13;state ^= state >>> 17;state ^= state << 5;state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

type ValidatedData = Readonly<{
  outcomes: readonly ReturnType<typeof canonicalOutcome>[];
  realOutcomes: readonly ReturnType<typeof canonicalOutcome>[];
  cases: readonly (Omit<TemporalEvaluationCase, 'historyEventIds' | 'eligibleItemIds'> & {
    historyEventIds: readonly string[];eligibleItemIds: readonly string[];
  })[];
  models: readonly (Omit<ExperimentalModelManifest, 'trainingDataEndsAt' | 'featureSnapshotEndsAt' | 'graphSnapshotEndsAt'> & {
    trainingDataEndsAt: string;featureSnapshotEndsAt: string;graphSnapshotEndsAt: string | null;
  })[];
  rankings: readonly ExperimentalRanking[];
}>;

function validateAndCanonicalize(input: GraphSequentialExperimentInput): ValidatedData {
  validatePolicy(input.policy);validDate(input.computedAt, 'computedAt');
  const outcomes = input.outcomes.map(canonicalOutcome).sort((a, b) => a.eventId.localeCompare(b.eventId));
  if (new Set(outcomes.map(outcome => outcome.eventId)).size !== outcomes.length) throw new TypeError('Outcome event IDs must be unique');
  const trainingEndsAt = input.policy.trainingEndsAt.getTime(), evaluationEndsAt = input.policy.evaluationEndsAt.getTime();
  const outcomeById = new Map(outcomes.map(outcome => [outcome.eventId, outcome]));
  const realOutcomes = outcomes.filter(outcome => outcome.sourceClass === 'real' &&
    new Date(outcome.resolvedAt).getTime() <= evaluationEndsAt);
  const cases = input.cases.map(testCase => {
    requiredText(testCase.caseId, 'caseId');requiredText(testCase.learnerId, 'case learnerId');requiredText(testCase.segment, 'segment', 240);
    requiredText(testCase.targetEventId, 'targetEventId');
    const suppliedHistoryEventIds = [...unique(testCase.historyEventIds, 'historyEventIds')];
    const eligibleItemIds = [...unique(testCase.eligibleItemIds, 'eligibleItemIds')].sort();
    const history = suppliedHistoryEventIds.map(id => outcomeById.get(id));
    const target = outcomeById.get(testCase.targetEventId);
    if (history.some(outcome => !outcome) || !target) throw new RangeError('Every evaluation case must reference known outcome events');
    if (history.some(outcome => outcome!.sourceClass !== 'real') || target.sourceClass !== 'real')
      throw new RangeError('Evaluation cases may reference only real outcomes');
    if (history.some(outcome => outcome!.learnerId !== testCase.learnerId) || target.learnerId !== testCase.learnerId)
      throw new RangeError('Evaluation case events must belong to its learner');
    if (history.some(outcome => new Date(outcome!.resolvedAt).getTime() > trainingEndsAt))
      throw new RangeError('Evaluation histories must end at or before the training cutoff');
    const targetTime = new Date(target.resolvedAt).getTime();
    if (targetTime <= trainingEndsAt || targetTime > evaluationEndsAt || target.completionStatus !== 'completed')
      throw new RangeError('Evaluation target must be a completion inside the post-cutoff evaluation window');
    if (!eligibleItemIds.includes(target.itemId)) throw new RangeError('Evaluation target must have been eligible at prediction time');
    const historyEventIds = history.map(outcome => outcome!).sort((left, right) =>
      new Date(left.resolvedAt).getTime() - new Date(right.resolvedAt).getTime() || left.eventId.localeCompare(right.eventId))
      .map(outcome => outcome.eventId);
    return { ...testCase,caseId: testCase.caseId.trim(),learnerId: testCase.learnerId.trim(),segment: testCase.segment.trim(),
      targetEventId: testCase.targetEventId.trim(),historyEventIds,eligibleItemIds };
  }).sort((a, b) => a.caseId.localeCompare(b.caseId));
  if (new Set(cases.map(testCase => testCase.caseId)).size !== cases.length) throw new TypeError('Evaluation case IDs must be unique');
  if (new Set(cases.map(testCase => testCase.learnerId)).size !== cases.length)
    throw new TypeError('Use one temporal holdout case per learner to preserve independent evaluation units');
  const models = input.models.map(model => {
    requiredText(model.modelId, 'modelId');requiredText(model.version, 'model version', 200);
    if (!['production_baseline','popularity_baseline','graph','sequential','graph_sequential'].includes(model.family))
      throw new TypeError('Model family is invalid');
    if (!/^[a-f0-9]{64}$/.test(model.trainingDataHash) || !/^[a-f0-9]{64}$/.test(model.hyperparameterHash))
      throw new TypeError('Model data and hyperparameter hashes must be SHA-256 hex digests');
    const trainingDataEndsAt = validDate(model.trainingDataEndsAt, 'model trainingDataEndsAt');
    const featureSnapshotEndsAt = validDate(model.featureSnapshotEndsAt, 'model featureSnapshotEndsAt');
    const graphSnapshotEndsAt = model.graphSnapshotEndsAt === null ? null : validDate(model.graphSnapshotEndsAt, 'model graphSnapshotEndsAt');
    if (new Date(trainingDataEndsAt).getTime() > trainingEndsAt || new Date(featureSnapshotEndsAt).getTime() > trainingEndsAt ||
        (graphSnapshotEndsAt && new Date(graphSnapshotEndsAt).getTime() > trainingEndsAt))
      throw new RangeError('Every model and feature snapshot must stop at or before the training cutoff');
    if ((model.family === 'graph' || model.family === 'graph_sequential') && graphSnapshotEndsAt === null)
      throw new RangeError('Graph models require a graph snapshot cutoff');
    return { ...model,modelId: model.modelId.trim(),version: model.version.trim(),trainingDataEndsAt,featureSnapshotEndsAt,graphSnapshotEndsAt };
  }).sort((a, b) => a.modelId.localeCompare(b.modelId));
  if (new Set(models.map(model => model.modelId)).size !== models.length) throw new TypeError('Model IDs must be unique');
  if (models.filter(model => model.family === 'production_baseline').length !== 1)
    throw new RangeError('Exactly one production baseline model is required');
  if (!models.some(model => ['graph','sequential','graph_sequential'].includes(model.family)))
    throw new RangeError('At least one graph or sequential challenger is required');
  const caseById = new Map(cases.map(testCase => [testCase.caseId, testCase]));
  const modelIds = new Set(models.map(model => model.modelId));
  const rankingKeys = new Set<string>();
  const rankings = input.rankings.map(ranking => {
    const testCase = caseById.get(ranking.caseId);
    if (!testCase || !modelIds.has(ranking.modelId)) throw new RangeError('Ranking references an unknown case or model');
    const rankedItemIds = unique(ranking.rankedItemIds, 'rankedItemIds');
    if (!rankedItemIds.length || rankedItemIds.some(itemId => !testCase.eligibleItemIds.includes(itemId)))
      throw new RangeError('Rankings must be non-empty subsets of the served-time eligible item set');
    const key = `${ranking.caseId}:${ranking.modelId}`;
    if (rankingKeys.has(key)) throw new TypeError('Each case-model ranking must be unique');rankingKeys.add(key);
    return { caseId: ranking.caseId.trim(),modelId: ranking.modelId.trim(),rankedItemIds };
  }).sort((a, b) => `${a.caseId}:${a.modelId}`.localeCompare(`${b.caseId}:${b.modelId}`));
  if (rankings.length !== cases.length * models.length) throw new RangeError('Every model must rank every evaluation case');
  return { outcomes,realOutcomes,cases,models,rankings };
}

function evaluateModel(model: ValidatedData['models'][number], data: ValidatedData,
  policy: GraphSequentialExperimentPolicy): ExperimentalModelEvaluation {
  const outcomeById = new Map(data.realOutcomes.map(outcome => [outcome.eventId, outcome]));
  const rankingByCase = new Map(data.rankings.filter(row => row.modelId === model.modelId).map(row => [row.caseId, row.rankedItemIds]));
  const evaluate = (cases: ValidatedData['cases']): RankingMetrics[] => [...policy.kValues].sort((a, b) => a - b).map(k => {
    const rows = cases.map(testCase => {
      const target = outcomeById.get(testCase.targetEventId)!;
      const index = rankingByCase.get(testCase.caseId)!.indexOf(target.itemId), rank = index < 0 ? null : index + 1;
      return { rank,gain: target.assessedSkillGain === true };
    });
    const gainRows = rows.filter(row => row.gain);
    const recommended = new Set(cases.flatMap(testCase => rankingByCase.get(testCase.caseId)!.slice(0, k)));
    const eligible = new Set(cases.flatMap(testCase => testCase.eligibleItemIds));
    return { k,hitRate: mean(rows.map(row => rankValue(row.rank, k, 'hit_rate'))),
      ndcg: mean(rows.map(row => rankValue(row.rank, k, 'ndcg'))),mrr: mean(rows.map(row => rankValue(row.rank, k, 'mrr'))),
      catalogCoverage: eligible.size ? recommended.size / eligible.size : 0,assessedGainCaseCount: gainRows.length,
      assessedGainHitRate: gainRows.length ? mean(gainRows.map(row => rankValue(row.rank, k, 'hit_rate'))) : null,
      assessedGainNdcg: gainRows.length ? mean(gainRows.map(row => rankValue(row.rank, k, 'ndcg'))) : null };
  });
  const segments = [...new Set(data.cases.map(testCase => testCase.segment))].sort();
  return { modelId: model.modelId,family: model.family,caseCount: data.cases.length,metrics: evaluate(data.cases),
    segmentMetrics: segments.map(segment => { const cases = data.cases.filter(testCase => testCase.segment === segment);
      return { segment,caseCount: cases.length,metrics: evaluate(cases) }; }) };
}

function compareModel(challenger: ExperimentalModelEvaluation, baseline: ExperimentalModelEvaluation,
  data: ValidatedData, policy: GraphSequentialExperimentPolicy): ExperimentalModelComparison {
  const baselineRanking = new Map(data.rankings.filter(row => row.modelId === baseline.modelId).map(row => [row.caseId,row.rankedItemIds]));
  const challengerRanking = new Map(data.rankings.filter(row => row.modelId === challenger.modelId).map(row => [row.caseId,row.rankedItemIds]));
  const outcomes = new Map(data.realOutcomes.map(outcome => [outcome.eventId,outcome]));
  const deltas = data.cases.map(testCase => {
    const target = outcomes.get(testCase.targetEventId)!.itemId;
    const baseIndex = baselineRanking.get(testCase.caseId)!.indexOf(target), challengeIndex = challengerRanking.get(testCase.caseId)!.indexOf(target);
    return rankValue(challengeIndex < 0 ? null : challengeIndex + 1, policy.primaryK, policy.primaryMetric) -
      rankValue(baseIndex < 0 ? null : baseIndex + 1, policy.primaryK, policy.primaryMetric);
  });
  const random = seededRandom(`${policy.bootstrapSeed}:${challenger.modelId}:${baseline.modelId}`), bootstrapped: number[] = [];
  for (let replicate = 0; replicate < policy.bootstrapReplicates; replicate += 1) {
    const sample: number[] = [];
    for (let index = 0; index < deltas.length; index += 1) sample.push(deltas[Math.floor(random() * deltas.length)]!);
    bootstrapped.push(mean(sample));
  }
  bootstrapped.sort((a, b) => a - b);
  const alpha = (1 - policy.confidenceLevel) / 2;
  const baselineMetric = baseline.metrics.find(metric => metric.k === policy.primaryK)!;
  const challengerMetric = challenger.metrics.find(metric => metric.k === policy.primaryK)!;
  const lift = metricValue(challengerMetric, policy.primaryMetric) - metricValue(baselineMetric, policy.primaryMetric);
  const coverageDelta = challengerMetric.catalogCoverage - baselineMetric.catalogCoverage;
  const segmentDeltas = challenger.segmentMetrics.map(segment => {
    const baselineSegment = baseline.segmentMetrics.find(row => row.segment === segment.segment)!;
    return metricValue(segment.metrics.find(metric => metric.k === policy.primaryK)!, policy.primaryMetric) -
      metricValue(baselineSegment.metrics.find(metric => metric.k === policy.primaryK)!, policy.primaryMetric);
  });
  const worstSegmentDelta = Math.min(...segmentDeltas);
  const assessedGainNdcgDelta = (challengerMetric.assessedGainNdcg ?? 0) - (baselineMetric.assessedGainNdcg ?? 0);
  const interval = { level: policy.confidenceLevel,lower: quantile(bootstrapped, alpha),upper: quantile(bootstrapped, 1 - alpha) };
  const experimental = ['graph','sequential','graph_sequential'].includes(challenger.family);
  const reasons: string[] = [];
  if (interval.lower <= policy.minimumPrimaryMetricLift) reasons.push('primary_metric_lower_bound_does_not_clear_lift_gate');
  if (coverageDelta < -policy.maximumCatalogCoverageLoss) reasons.push('catalog_coverage_loss_exceeds_gate');
  if (worstSegmentDelta < -policy.maximumSegmentMetricLoss) reasons.push('segment_noninferiority_gate_failed');
  if (assessedGainNdcgDelta < -policy.maximumAssessedGainNdcgLoss) reasons.push('assessed_gain_noninferiority_gate_failed');
  const decision = !experimental ? 'benchmark_only' : reasons.length ? 'retain_baseline' : 'eligible_for_prospective_trial';
  return { modelId: challenger.modelId,baselineModelId: baseline.modelId,primaryMetric: policy.primaryMetric,
    primaryK: policy.primaryK,baselineValue: metricValue(baselineMetric, policy.primaryMetric),
    challengerValue: metricValue(challengerMetric, policy.primaryMetric),lift,confidenceInterval: interval,
    catalogCoverageDelta: coverageDelta,worstSegmentDelta,assessedGainNdcgDelta,decision,reasons };
}

/** Evaluates offline candidates only; no return value authorizes production serving. */
export function evaluateGraphSequentialExperiment(input: GraphSequentialExperimentInput): GraphSequentialExperimentBatch {
  const data = validateAndCanonicalize(input), policy = input.policy;
  const segmentCounts = Object.fromEntries([...new Set(data.cases.map(testCase => testCase.segment))].sort()
    .map(segment => [segment,data.cases.filter(testCase => testCase.segment === segment).length]));
  const completed = data.realOutcomes.filter(outcome => outcome.completionStatus === 'completed');
  const gates = [
    { gate: 'real_resolved_outcomes',actual: data.realOutcomes.length,required: policy.minimumResolvedOutcomes },
    { gate: 'real_completed_outcomes',actual: completed.length,required: policy.minimumCompletedOutcomes },
    { gate: 'real_learners',actual: new Set(data.realOutcomes.map(outcome => outcome.learnerId)).size,required: policy.minimumRealLearners },
    { gate: 'observed_items',actual: new Set(data.realOutcomes.map(outcome => outcome.itemId)).size,required: policy.minimumObservedItems },
    { gate: 'evaluation_cases',actual: data.cases.length,required: policy.minimumEvaluationCases },
    { gate: 'assessed_outcome_cases',actual: data.cases.filter(testCase =>
      data.realOutcomes.find(outcome => outcome.eventId === testCase.targetEventId)?.assessedSkillGain !== null).length,
      required: policy.minimumAssessedOutcomeCases },
    ...Object.entries(segmentCounts).map(([segment, count]) => ({ gate: `segment:${segment}`,actual: count,required: policy.minimumCasesPerSegment })),
    ...data.cases.map(testCase => ({ gate: `history:${testCase.caseId}`,actual: testCase.historyEventIds.length,required: policy.minimumHistoryLength })),
  ].map(gate => ({ ...gate,ready: gate.actual >= gate.required }));
  const ready = gates.every(gate => gate.ready);
  const evaluations = ready ? data.models.map(model => evaluateModel(model, data, policy)) : [];
  const baseline = evaluations.find(model => model.family === 'production_baseline');
  const comparisons = ready && baseline ? evaluations.filter(model => model.modelId !== baseline.modelId)
    .map(model => compareModel(model, baseline, data, policy)) : [];
  const canonicalPolicy = { ...policy,trainingEndsAt: validDate(policy.trainingEndsAt, 'trainingEndsAt'),
    evaluationEndsAt: validDate(policy.evaluationEndsAt, 'evaluationEndsAt'),kValues: [...policy.kValues].sort((a, b) => a - b) };
  const inputSnapshot = JSON.parse(JSON.stringify({ outcomes: data.outcomes,cases: data.cases,models: data.models,
    rankings: data.rankings,policy: canonicalPolicy,computedAt: validDate(input.computedAt, 'computedAt'),
    algorithmVersion: ALGORITHM_VERSIONS.graphSequentialExperiment })) as Record<string, unknown>;
  const datasetManifest = { rawOutcomeCount: data.outcomes.length,realResolvedOutcomeCount: data.realOutcomes.length,
    excludedNonRealOutcomeCount: data.outcomes.filter(outcome => outcome.sourceClass !== 'real').length,
    excludedPostWindowOutcomeCount: data.outcomes.filter(outcome => outcome.sourceClass === 'real' &&
      new Date(outcome.resolvedAt).getTime() > input.policy.evaluationEndsAt.getTime()).length,
    realCompletedOutcomeCount: completed.length,
    realLearnerCount: new Set(data.realOutcomes.map(outcome => outcome.learnerId)).size,
    observedItemCount: new Set(data.realOutcomes.map(outcome => outcome.itemId)).size,evaluationCaseCount: data.cases.length,
    segmentCounts,outcomesHash: hashComputationInputs(data.outcomes),casesHash: hashComputationInputs(data.cases) };
  const inputsHash = hashComputationInputs(inputSnapshot);
  const core = { algorithmVersion: ALGORITHM_VERSIONS.graphSequentialExperiment,policyVersion: policy.version,
    status: ready ? 'offline_evaluated' as const : 'blocked_insufficient_real_outcomes' as const,inputsHash,
    computedAt: validDate(input.computedAt, 'computedAt'),inputSnapshot,datasetManifest,readinessGates: gates,
    evaluations,comparisons,limitations: ['historical_policy_bias','no_counterfactual_outcomes',
      'completion_is_not_causal_skill_gain','offline_metrics_do_not_authorize_production'] as const };
  return { ...core,resultHash: hashComputationInputs(core) };
}

export function validateGraphSequentialExperimentBatch(batch: GraphSequentialExperimentBatch): void {
  const { resultHash, ...core } = batch;
  if (batch.algorithmVersion !== ALGORITHM_VERSIONS.graphSequentialExperiment ||
      batch.inputsHash !== hashComputationInputs(batch.inputSnapshot) || resultHash !== hashComputationInputs(core))
    throw new RangeError('Graph/sequential experiment batch failed provenance validation');
  const snapshot = batch.inputSnapshot as unknown as Omit<GraphSequentialExperimentInput, 'computedAt' | 'outcomes' | 'models'> & {
    computedAt: string;
    outcomes: readonly (Omit<ExperimentOutcome,'resolvedAt'> & {resolvedAt:string})[];
    models: readonly (Omit<ExperimentalModelManifest,'trainingDataEndsAt'|'featureSnapshotEndsAt'|'graphSnapshotEndsAt'> &
      {trainingDataEndsAt:string;featureSnapshotEndsAt:string;graphSnapshotEndsAt:string|null})[];
    policy: Omit<GraphSequentialExperimentPolicy,'trainingEndsAt'|'evaluationEndsAt'> & {trainingEndsAt:string;evaluationEndsAt:string};
  };
  const replay = evaluateGraphSequentialExperiment({ ...snapshot,computedAt: new Date(snapshot.computedAt),
    outcomes: snapshot.outcomes.map(outcome => ({ ...outcome,resolvedAt: new Date(outcome.resolvedAt) })),
    models: snapshot.models.map(model => ({ ...model,trainingDataEndsAt: new Date(model.trainingDataEndsAt),
      featureSnapshotEndsAt: new Date(model.featureSnapshotEndsAt),graphSnapshotEndsAt: model.graphSnapshotEndsAt ? new Date(model.graphSnapshotEndsAt) : null })),
    policy: { ...snapshot.policy,trainingEndsAt: new Date(snapshot.policy.trainingEndsAt),evaluationEndsAt: new Date(snapshot.policy.evaluationEndsAt) } });
  if (replay.resultHash !== batch.resultHash) throw new RangeError('Graph/sequential experiment batch is not reproducible');
}

export function validateRecommenderExperimentReview(review: RecommenderExperimentReview): void {
  requiredText(review.reviewerPrincipal, 'reviewerPrincipal');requiredText(review.modelId, 'modelId');
  requiredText(review.rationale, 'review rationale', 4_000);validDate(review.reviewedAt, 'reviewedAt');
  if (!['approve_prospective_trial','reject','needs_revision'].includes(review.decision))
    throw new TypeError('Experiment review decision is invalid');
  if (review.decision === 'approve_prospective_trial' && Object.values(review.checklist).some(value => value !== true))
    throw new RangeError('Prospective-trial approval requires a complete governance checklist');
}
