import { ALGORITHM_VERSIONS, hashComputationInputs } from '../kernel/index.js';

export type IrtLevel = 'L1' | 'L2' | 'L3';
export type IrtCategory = 'below_L1' | IrtLevel;

export type CalibratedIrtItem = Readonly<{
  id: string;
  difficulty: number;
  discrimination: number;
  calibrationStatus: 'calibrated';
  difficultyStandardError?: number;
  discriminationStandardError?: number;
  exposureRate?: number;
}>;

export type IrtResponse = Readonly<{
  item: CalibratedIrtItem;
  correct: boolean | null;
}>;

export type IrtPosteriorOptions = Readonly<{
  prior: Readonly<{ mean: number; standardDeviation: number; version: string }>;
  levelThresholds: readonly Readonly<{ level: IrtLevel; minimumTheta: number }>[];
  grid?: Readonly<{ minimum: number; maximum: number; step: number }>;
  credibleMass?: number;
}>;

export type IrtPosterior = Readonly<{
  model: '2PL';
  algorithmVersion: string;
  inputsHash: string;
  resultHash: string;
  inputSnapshot: Readonly<Record<string, unknown>>;
  prior: Readonly<{ mean: number; standardDeviation: number; version: string }>;
  distribution: readonly Readonly<{ theta: number; probability: number }>[];
  responseCounts: Readonly<{ total: number; scored: number; omitted: number; correct: number }>;
  eapTheta: number;
  mapTheta: number;
  posteriorStandardDeviation: number;
  credibleInterval: Readonly<{ mass: number; lower: number; upper: number }>;
  testInformationAtEap: number;
  posteriorExpectedTestInformation: number;
  dataInformationFraction: number;
  masteryProbabilities: Readonly<Record<IrtLevel, number>>;
  categoryProbabilities: Readonly<Record<IrtCategory, number>>;
  calibrationUncertainty: 'not_applicable' | 'marginalized' | 'conditional_point_estimates' | 'mixed';
  qualityFlags: readonly (
    'no_scored_responses' | 'prior_dominated' | 'grid_boundary_mass' |
    'item_parameter_uncertainty_not_propagated' | 'mixed_item_parameter_uncertainty' |
    'dif_not_modeled'
  )[];
}>;

export type IrtStoppingPolicy = Readonly<{
  minimumScoredItems: number;
  maximumScoredItems: number;
  maximumPosteriorStandardDeviation: number;
  minimumCategoryProbability: number;
  minimumTestInformation: number;
  version: string;
}>;

export type IrtStoppingDecision = Readonly<{
  shouldStop: boolean;
  outcome: 'continue' | 'level' | 'below_assessed_range' | 'inconclusive';
  level: IrtLevel | null;
  probability: number;
  reason: 'minimum_items' | 'coverage' | 'precision_reached' | 'maximum_items_uncertain' | 'maximum_items_without_coverage';
  policyVersion: string;
  algorithmVersion: string;
  inputsHash: string;
}>;

const LEVELS: readonly IrtLevel[] = ['L1', 'L2', 'L3'];
const GH_Z = [-2.8569700138728056, -1.355626179974266, 0, 1.355626179974266, 2.8569700138728056] as const;
const GH_W = [0.01125741132772069, 0.2220759220056126, 0.5333333333333333, 0.2220759220056126, 0.01125741132772069] as const;

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function probability(value: number, name: string): number {
  finite(value, name);
  if (value <= 0 || value >= 1) throw new RangeError(`${name} must be strictly between zero and one`);
  return value;
}

function logistic(value: number): number {
  if (value >= 0) { const exp = Math.exp(-value); return 1 / (1 + exp); }
  const exp = Math.exp(value); return exp / (1 + exp);
}

function validateItem(item: CalibratedIrtItem): void {
  if (!item.id?.trim() || item.calibrationStatus !== 'calibrated')
    throw new TypeError('IRT requires a named calibrated item');
  finite(item.difficulty, 'item difficulty'); finite(item.discrimination, 'item discrimination');
  if (item.difficulty < -4 || item.difficulty > 4 || item.discrimination <= 0 || item.discrimination > 4)
    throw new RangeError('IRT item parameters must satisfy difficulty [-4,4] and discrimination (0,4]');
  for (const [value, name] of [[item.difficultyStandardError, 'difficultyStandardError'],
    [item.discriminationStandardError, 'discriminationStandardError']] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new RangeError(`${name} must be non-negative`);
  }
  if ((item.difficultyStandardError === undefined) !== (item.discriminationStandardError === undefined))
    throw new TypeError('Supply both item-parameter standard errors or neither');
  if (item.exposureRate !== undefined && (!Number.isFinite(item.exposureRate) || item.exposureRate < 0 || item.exposureRate > 1))
    throw new RangeError('exposureRate must be between zero and one');
}

function itemProbabilityAndDerivative(theta: number, item: CalibratedIrtItem): { probability: number; derivative: number } {
  validateItem(item);
  const difficultySe = item.difficultyStandardError, discriminationSe = item.discriminationStandardError;
  if (difficultySe === undefined || discriminationSe === undefined || (difficultySe === 0 && discriminationSe === 0)) {
    const p = logistic(item.discrimination * (theta - item.difficulty));
    return { probability: p, derivative: item.discrimination * p * (1 - p) };
  }
  const logDiscriminationVariance = Math.log1p((discriminationSe / item.discrimination) ** 2);
  const logDiscriminationSe = Math.sqrt(logDiscriminationVariance);
  let p = 0, derivative = 0;
  for (let ai = 0; ai < GH_Z.length; ai++) for (let bi = 0; bi < GH_Z.length; bi++) {
    const a = Math.exp(Math.log(item.discrimination) + logDiscriminationSe * GH_Z[ai]! - .5 * logDiscriminationVariance);
    const b = item.difficulty + difficultySe * GH_Z[bi]!;
    const conditional = logistic(a * (theta - b)), weight = GH_W[ai]! * GH_W[bi]!;
    p += weight * conditional; derivative += weight * a * conditional * (1 - conditional);
  }
  return { probability: p, derivative };
}

function itemInformation(theta: number, item: CalibratedIrtItem): number {
  const value = itemProbabilityAndDerivative(theta, item);
  const denominator = Math.max(1e-12, value.probability * (1 - value.probability));
  return value.derivative ** 2 / denominator;
}

function validateThresholds(thresholds: IrtPosteriorOptions['levelThresholds']): Readonly<Record<IrtLevel, number>> {
  if (thresholds.length !== LEVELS.length) throw new RangeError('Supply one explicit theta threshold for each of L1, L2, and L3');
  const values = new Map<IrtLevel, number>();
  for (const threshold of thresholds) {
    if (!LEVELS.includes(threshold.level) || values.has(threshold.level)) throw new TypeError('Level thresholds must be unique L1-L3 values');
    values.set(threshold.level, finite(threshold.minimumTheta, `${threshold.level} threshold`));
  }
  if (!(values.get('L1')! < values.get('L2')! && values.get('L2')! < values.get('L3')!))
    throw new RangeError('Level thresholds must increase from L1 to L3');
  return { L1: values.get('L1')!, L2: values.get('L2')!, L3: values.get('L3')! };
}

function quantile(distribution: IrtPosterior['distribution'], target: number): number {
  let cumulative = 0;
  for (const point of distribution) { cumulative += point.probability; if (cumulative >= target) return point.theta; }
  return distribution[distribution.length - 1]!.theta;
}

/** Grid-based Bayesian EAP posterior for dichotomous calibrated 2PL items. */
export function estimateIrtPosterior(responses: readonly IrtResponse[], options: IrtPosteriorOptions): IrtPosterior {
  const prior = options.prior;
  finite(prior.mean, 'prior mean');finite(prior.standardDeviation, 'prior standardDeviation');
  if (prior.standardDeviation <= 0 || !prior.version?.trim()) throw new RangeError('Prior needs a positive standard deviation and version');
  const thresholds = validateThresholds(options.levelThresholds);
  const grid = options.grid ?? { minimum: -4, maximum: 4, step: .05 };
  finite(grid.minimum, 'grid minimum');finite(grid.maximum, 'grid maximum');finite(grid.step, 'grid step');
  if (grid.minimum >= grid.maximum || grid.step <= 0) throw new RangeError('IRT grid bounds and step are invalid');
  if (thresholds.L1 < grid.minimum || thresholds.L3 > grid.maximum)
    throw new RangeError('Level thresholds must fall within the IRT grid');
  const pointCount = Math.floor((grid.maximum - grid.minimum) / grid.step + 1e-9) + 1;
  if (pointCount < 81 || pointCount > 2001) throw new RangeError('IRT grid must contain between 81 and 2001 points');
  const credibleMass = options.credibleMass ?? .95;probability(credibleMass, 'credibleMass');
  const itemIds = new Set<string>();
  for (const response of responses) {
    validateItem(response.item);
    if (itemIds.has(response.item.id)) throw new TypeError('An item may appear only once in a posterior update');
    itemIds.add(response.item.id);
    if (response.correct !== null && typeof response.correct !== 'boolean') throw new TypeError('Response must be correct, incorrect, or null for omitted');
  }
  const points = Array.from({ length: pointCount }, (_, index) => grid.minimum + index * grid.step);
  const logWeights = points.map(theta => {
    const z = (theta - prior.mean) / prior.standardDeviation;
    let logWeight = -.5 * z * z - Math.log(prior.standardDeviation) - .5 * Math.log(2 * Math.PI);
    for (const response of responses) if (response.correct !== null) {
      const p = Math.min(1 - 1e-12, Math.max(1e-12, itemProbabilityAndDerivative(theta, response.item).probability));
      logWeight += response.correct ? Math.log(p) : Math.log1p(-p);
    }
    return logWeight;
  });
  const maxLog = Math.max(...logWeights), unscaled = logWeights.map(value => Math.exp(value - maxLog));
  const total = unscaled.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new RangeError('IRT posterior could not be normalized');
  const distribution = points.map((theta, index) => ({ theta, probability: unscaled[index]! / total }));
  const eapTheta = distribution.reduce((sum, point) => sum + point.theta * point.probability, 0);
  const variance = distribution.reduce((sum, point) => sum + (point.theta - eapTheta) ** 2 * point.probability, 0);
  const posteriorStandardDeviation = Math.sqrt(Math.max(0, variance));
  const mapTheta = distribution.reduce((best, point) => point.probability > best.probability ? point : best).theta;
  const scored = responses.filter(response => response.correct !== null), correct = scored.filter(response => response.correct).length;
  const informationAtEap = scored.reduce((sum, response) => sum + itemInformation(eapTheta, response.item), 0);
  const posteriorExpectedInformation = distribution.reduce((sum, point) => sum + point.probability *
    scored.reduce((inner, response) => inner + itemInformation(point.theta, response.item), 0), 0);
  const priorInformation = 1 / prior.standardDeviation ** 2;
  const dataInformationFraction = informationAtEap / (informationAtEap + priorInformation);
  const masteryProbabilities = Object.fromEntries(LEVELS.map(level => [level,
    distribution.filter(point => point.theta >= thresholds[level]).reduce((sum, point) => sum + point.probability, 0)])) as Record<IrtLevel, number>;
  const categoryProbabilities: Record<IrtCategory, number> = {
    below_L1: 1 - masteryProbabilities.L1,
    L1: masteryProbabilities.L1 - masteryProbabilities.L2,
    L2: masteryProbabilities.L2 - masteryProbabilities.L3,
    L3: masteryProbabilities.L3,
  };
  const withUncertainty = responses.filter(response => response.correct !== null && response.item.difficultyStandardError !== undefined).length;
  const calibrationUncertainty: IrtPosterior['calibrationUncertainty'] = !scored.length ? 'not_applicable' : withUncertainty === scored.length ? 'marginalized' :
    withUncertainty === 0 ? 'conditional_point_estimates' : 'mixed';
  const qualityFlags: IrtPosterior['qualityFlags'][number][] = [];
  if (!scored.length) qualityFlags.push('no_scored_responses');
  if (dataInformationFraction < .5) qualityFlags.push('prior_dominated');
  const boundaryMass = distribution.slice(0, 2).concat(distribution.slice(-2)).reduce((sum, point) => sum + point.probability, 0);
  if (boundaryMass > .01) qualityFlags.push('grid_boundary_mass');
  if (calibrationUncertainty === 'conditional_point_estimates') qualityFlags.push('item_parameter_uncertainty_not_propagated');
  if (calibrationUncertainty === 'mixed') qualityFlags.push('mixed_item_parameter_uncertainty');
  qualityFlags.push('dif_not_modeled');
  const inputSnapshot = JSON.parse(JSON.stringify({ responses: responses.map(response => ({ correct: response.correct,
    item: response.item })).sort((a, b) => a.item.id.localeCompare(b.item.id)), options: { ...options,
      grid, credibleMass }, algorithmVersion: ALGORITHM_VERSIONS.irtPosterior }));
  const resultCore = { model: '2PL' as const, algorithmVersion: ALGORITHM_VERSIONS.irtPosterior,
    inputsHash: hashComputationInputs(inputSnapshot), inputSnapshot, prior: { ...prior }, distribution,
    responseCounts: { total: responses.length, scored: scored.length, omitted: responses.length - scored.length, correct },
    eapTheta, mapTheta, posteriorStandardDeviation,
    credibleInterval: { mass: credibleMass, lower: quantile(distribution, (1 - credibleMass) / 2),
      upper: quantile(distribution, 1 - (1 - credibleMass) / 2) },
    testInformationAtEap: informationAtEap, posteriorExpectedTestInformation: posteriorExpectedInformation, dataInformationFraction,
    masteryProbabilities, categoryProbabilities, calibrationUncertainty, qualityFlags };
  return { ...resultCore, resultHash: hashComputationInputs(resultCore) };
}

export function validateIrtPosterior(posterior: IrtPosterior): void {
  const { resultHash, ...core } = posterior;
  if (posterior.algorithmVersion !== ALGORITHM_VERSIONS.irtPosterior ||
    posterior.inputsHash !== hashComputationInputs(posterior.inputSnapshot) ||
    resultHash !== hashComputationInputs(core))
    throw new RangeError('IRT posterior failed provenance validation');
}

export function evaluateIrtStopping(
  posterior: IrtPosterior,
  coverageAchieved: boolean,
  policy: IrtStoppingPolicy,
): IrtStoppingDecision {
  validateIrtPosterior(posterior);
  if (!Number.isInteger(policy.minimumScoredItems) || !Number.isInteger(policy.maximumScoredItems) ||
    policy.minimumScoredItems < 1 || policy.maximumScoredItems < policy.minimumScoredItems)
    throw new RangeError('Stopping item limits are invalid');
  finite(policy.maximumPosteriorStandardDeviation, 'maximumPosteriorStandardDeviation');
  finite(policy.minimumTestInformation, 'minimumTestInformation');
  if (policy.maximumPosteriorStandardDeviation <= 0 || policy.minimumTestInformation < 0 || !policy.version?.trim())
    throw new RangeError('Stopping precision, information, and version are invalid');
  probability(policy.minimumCategoryProbability, 'minimumCategoryProbability');
  const ordered = Object.entries(posterior.categoryProbabilities) as [IrtCategory, number][];
  const [category, categoryProbability] = ordered.reduce((best, entry) => entry[1] > best[1] ? entry : best);
  const scored = posterior.responseCounts.scored;
  let outcome: IrtStoppingDecision['outcome'] = 'continue', reason: IrtStoppingDecision['reason'] = 'minimum_items',
    shouldStop = false, level: IrtLevel | null = null;
  if (scored >= policy.maximumScoredItems && !coverageAchieved) {
    outcome = 'inconclusive';reason = 'maximum_items_without_coverage';shouldStop = true;
  } else if (scored < policy.minimumScoredItems) {
    reason = 'minimum_items';
  } else if (!coverageAchieved) {
    reason = 'coverage';
  } else if (posterior.posteriorStandardDeviation <= policy.maximumPosteriorStandardDeviation &&
    posterior.testInformationAtEap >= policy.minimumTestInformation && categoryProbability >= policy.minimumCategoryProbability) {
    outcome = category === 'below_L1' ? 'below_assessed_range' : 'level';
    level = category === 'below_L1' ? null : category;reason = 'precision_reached';shouldStop = true;
  } else if (scored >= policy.maximumScoredItems) {
    outcome = 'inconclusive';reason = 'maximum_items_uncertain';shouldStop = true;
  }
  const core = { shouldStop, outcome, level, probability: categoryProbability, reason, policyVersion: policy.version,
    algorithmVersion: ALGORITHM_VERSIONS.irtStoppingPolicy };
  return { ...core, inputsHash: hashComputationInputs({ posteriorInputsHash: posterior.inputsHash, coverageAchieved, policy, core }) };
}

/** Selects the eligible, non-administered item with maximum posterior expected Fisher information. */
export function selectNextIrtItem(
  posterior: IrtPosterior,
  candidates: readonly CalibratedIrtItem[],
  administeredItemIds: ReadonlySet<string>,
  maxExposureRate = 1,
): Readonly<{ item: CalibratedIrtItem; expectedInformation: number; algorithmVersion: string }> | null {
  validateIrtPosterior(posterior);finite(maxExposureRate, 'maxExposureRate');
  if (maxExposureRate < 0 || maxExposureRate > 1) throw new RangeError('maxExposureRate must be between zero and one');
  const ids = new Set<string>();
  const eligible = candidates.filter(item => {
    validateItem(item);if (ids.has(item.id)) throw new TypeError('Candidate item IDs must be unique');ids.add(item.id);
    return !administeredItemIds.has(item.id) && (item.exposureRate ?? 0) <= maxExposureRate;
  });
  const ranked = eligible.map(item => ({ item, expectedInformation: posterior.distribution.reduce((sum, point) =>
    sum + point.probability * itemInformation(point.theta, item), 0), algorithmVersion: ALGORITHM_VERSIONS.irtPosterior }))
    .sort((a, b) => b.expectedInformation - a.expectedInformation || a.item.id.localeCompare(b.item.id));
  return ranked[0] ?? null;
}
