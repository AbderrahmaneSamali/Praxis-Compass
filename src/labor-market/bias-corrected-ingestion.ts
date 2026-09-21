import { ALGORITHM_VERSIONS, hashComputationInputs } from '../kernel/index.js';

export type LaborMarketStratum = Readonly<{
  countryCode: string;
  regionCode: string | null;
  sectorCode: string;
  occupationGroupCode: string;
}>;

export type LaborMarketSourceRelease = Readonly<{
  sourceId: string;
  releaseId: string;
  retrievedAt: Date;
  license: string;
  coverageNote: string;
}>;

export type LaborMarketPostingObservation = Readonly<{
  sourceReleaseId: string;
  externalPostingId: string;
  deduplicationKey: string;
  observedAt: Date;
  stratum: LaborMarketStratum;
  skillIds: readonly string[];
}>;

export type OfficialBenchmarkCell = Readonly<{
  stratum: LaborMarketStratum;
  count: number;
}>;

export type LaborMarketBiasCorrectionInput = Readonly<{
  period: string;
  sourceReleases: readonly LaborMarketSourceRelease[];
  observations: readonly LaborMarketPostingObservation[];
  benchmark: Readonly<{
    sourceId: string;
    releaseId: string;
    measure: 'recent_hires' | 'recent_job_starters' | 'employment' | 'job_vacancies';
    publishedAt: Date;
    cells: readonly OfficialBenchmarkCell[];
  }>;
  policy: Readonly<{
    version: string;
    minimumWeight: number;
    maximumWeight: number;
    minimumBenchmarkCoverage: number;
    minimumEffectiveSampleSize: number;
    minimumSkillObservations: number;
    confidenceLevel: number;
  }>;
}>;

export type LaborMarketSkillDemandEstimate = Readonly<{
  skillId: string;
  rawPostingCount: number;
  benchmarkedRawPostingCount: number;
  benchmarkedRawShare: number;
  adjustedPostingEquivalent: number;
  adjustedShare: number;
  relativeShareChange: number | null;
  standardError: number;
  confidenceInterval: Readonly<{ level: number; lower: number; upper: number }>;
  effectiveSampleSize: number;
  status: 'publishable' | 'insufficient_coverage' | 'insufficient_sample';
  qualityFlags: readonly ('low_benchmark_coverage' | 'low_effective_sample_size' | 'few_skill_observations' |
    'unbenchmarked_skill_observations')[];
}>;

export type BiasCorrectedLaborMarketBatch = Readonly<{
  period: string;
  algorithmVersion: string;
  policyVersion: string;
  inputsHash: string;
  resultHash: string;
  inputSnapshot: Readonly<Record<string, unknown>>;
  counts: Readonly<{
    rawObservations: number;
    uniquePostings: number;
    duplicatesRemoved: number;
    benchmarkedPostings: number;
    unbenchmarkedPostings: number;
  }>;
  benchmarkCoverage: Readonly<{
    totalCells: number;
    coveredCells: number;
    totalMass: number;
    coveredMass: number;
    ratio: number;
  }>;
  effectiveSampleSize: number;
  strata: readonly Readonly<{
    stratum: LaborMarketStratum;
    observedPostings: number;
    benchmarkCount: number | null;
    rawAdjustmentFactor: number | null;
    appliedWeight: number | null;
    capped: boolean;
  }>[];
  skills: readonly LaborMarketSkillDemandEstimate[];
  qualityFlags: readonly (
    'duplicates_removed' | 'duplicate_skill_disagreement' | 'unbenchmarked_observations' | 'uncovered_benchmark_cells' |
    'weight_capping_applied' | 'low_benchmark_coverage' | 'low_effective_sample_size' |
    'selection_bias_may_remain' | 'absolute_vacancy_level_not_identified'
  )[];
}>;

type DeduplicatedPosting = Readonly<{
  deduplicationKey: string;
  stratum: LaborMarketStratum;
  skillIds: readonly string[];
  sourceReleaseIds: readonly string[];
  externalPostingIds: readonly string[];
  firstObservedAt: string;
  skillDisagreement: boolean;
}>;

const COUNTRY = /^[A-Z]{2}$/;
const PERIOD = /^\d{4}-(Q[1-4]|M(0[1-9]|1[0-2]))$/;

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function requiredText(value: string, name: string, maximum = 300): string {
  const text = value?.trim();
  if (!text || text.length > maximum) throw new RangeError(`${name} must contain 1-${maximum} characters`);
  return text;
}

function validDate(value: Date, name: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${name} must be a valid Date`);
  return value.toISOString();
}

function validateStratum(stratum: LaborMarketStratum): void {
  if (!COUNTRY.test(stratum.countryCode)) throw new TypeError('countryCode must be an uppercase ISO alpha-2 code');
  if (stratum.regionCode !== null) requiredText(stratum.regionCode, 'regionCode', 100);
  requiredText(stratum.sectorCode, 'sectorCode', 100);
  requiredText(stratum.occupationGroupCode, 'occupationGroupCode', 100);
}

function stratumKey(stratum: LaborMarketStratum): string {
  validateStratum(stratum);
  return hashComputationInputs(stratum);
}

function inverseNormalCdf(probability: number): number {
  // Acklam's approximation; used only for confidence-interval display.
  const a = [-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239];
  const b = [-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572];
  const c = [-.007784894002430293,-.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783];
  const d = [.007784695709041462,.3224671290700398,2.445134137142996,3.754408661907416];
  if (probability <= 0 || probability >= 1) throw new RangeError('Normal quantile probability must be inside (0,1)');
  if (probability < .02425) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (probability > 1 - .02425) return -inverseNormalCdf(1 - probability);
  const q = probability - .5, r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function wilsonInterval(share: number, sampleSize: number, confidenceLevel: number): { lower: number; upper: number } {
  if (sampleSize <= 0) return { lower: 0,upper: 1 };
  const z = inverseNormalCdf(.5 + confidenceLevel / 2), z2 = z * z;
  const denominator = 1 + z2 / sampleSize;
  const center = (share + z2 / (2 * sampleSize)) / denominator;
  const half = z * Math.sqrt((share * (1 - share) + z2 / (4 * sampleSize)) / sampleSize) / denominator;
  return { lower: Math.max(0, center - half),upper: Math.min(1, center + half) };
}

function deduplicate(observations: readonly LaborMarketPostingObservation[], releases: ReadonlySet<string>): DeduplicatedPosting[] {
  const groups = new Map<string, LaborMarketPostingObservation[]>();
  for (const observation of observations) {
    if (!releases.has(observation.sourceReleaseId)) throw new RangeError('Observation references an unknown source release');
    requiredText(observation.externalPostingId, 'externalPostingId', 500);
    requiredText(observation.deduplicationKey, 'deduplicationKey', 128);
    validDate(observation.observedAt, 'observedAt');validateStratum(observation.stratum);
    if (!Array.isArray(observation.skillIds) || new Set(observation.skillIds).size !== observation.skillIds.length ||
        observation.skillIds.some(skillId => !skillId?.trim())) throw new TypeError('skillIds must be unique non-empty IDs');
    const list = groups.get(observation.deduplicationKey) ?? [];list.push(observation);groups.set(observation.deduplicationKey, list);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([deduplicationKey, rows]) => {
    const keys = new Set(rows.map(row => stratumKey(row.stratum)));
    if (keys.size !== 1) throw new RangeError(`Duplicate posting has conflicting strata: ${deduplicationKey}`);
    const normalizedSkillSets = new Set(rows.map(row => [...row.skillIds].sort().join('\u001f')));
    return { deduplicationKey,stratum: { ...rows[0]!.stratum },
      skillIds: [...new Set(rows.flatMap(row => row.skillIds))].sort(),
      sourceReleaseIds: [...new Set(rows.map(row => row.sourceReleaseId))].sort(),
      externalPostingIds: [...new Set(rows.map(row => row.externalPostingId))].sort(),
      firstObservedAt: rows.map(row => validDate(row.observedAt, 'observedAt')).sort()[0]!,
      skillDisagreement: normalizedSkillSets.size > 1 };
  });
}

/**
 * Bias-corrects the distribution of a deduplicated online-job-ad sample using
 * an official population frame. It does not identify an absolute vacancy total.
 */
export function biasCorrectLaborMarketIngestion(input: LaborMarketBiasCorrectionInput): BiasCorrectedLaborMarketBatch {
  if (!PERIOD.test(input.period)) throw new TypeError('period must use YYYY-Qn or YYYY-Mmm');
  if (!input.sourceReleases.length) throw new RangeError('At least one source release is required');
  const releaseIds = new Set<string>();
  const normalizedReleases = input.sourceReleases.map(release => {
    requiredText(release.sourceId, 'sourceId', 200);requiredText(release.releaseId, 'releaseId', 200);
    requiredText(release.license, 'license', 500);requiredText(release.coverageNote, 'coverageNote', 2000);
    if (releaseIds.has(release.releaseId)) throw new TypeError('Source release IDs must be unique');releaseIds.add(release.releaseId);
    return { ...release,retrievedAt: validDate(release.retrievedAt, 'retrievedAt') };
  });
  requiredText(input.benchmark.sourceId, 'benchmark sourceId', 200);
  requiredText(input.benchmark.releaseId, 'benchmark releaseId', 200);
  const publishedAt = validDate(input.benchmark.publishedAt, 'benchmark publishedAt');
  if (!input.benchmark.cells.length) throw new RangeError('Official benchmark cells are required');
  const benchmarkByKey = new Map<string, OfficialBenchmarkCell>();
  for (const cell of input.benchmark.cells) {
    const key = stratumKey(cell.stratum);
    if (!Number.isInteger(cell.count) || cell.count < 0) throw new RangeError('Benchmark counts must be non-negative integers');
    if (benchmarkByKey.has(key)) throw new TypeError('Official benchmark strata must be unique');
    benchmarkByKey.set(key, cell);
  }
  const totalBenchmarkMass = [...benchmarkByKey.values()].reduce((sum, cell) => sum + cell.count, 0);
  if (totalBenchmarkMass <= 0) throw new RangeError('Official benchmark must have positive total mass');
  const policy = input.policy;
  requiredText(policy.version, 'policy version', 100);
  for (const [value, name] of [[policy.minimumWeight,'minimumWeight'],[policy.maximumWeight,'maximumWeight'],
    [policy.minimumBenchmarkCoverage,'minimumBenchmarkCoverage'],[policy.minimumEffectiveSampleSize,'minimumEffectiveSampleSize'],
    [policy.minimumSkillObservations,'minimumSkillObservations'],[policy.confidenceLevel,'confidenceLevel']] as const) finite(value, name);
  if (policy.minimumWeight <= 0 || policy.maximumWeight < policy.minimumWeight || policy.minimumBenchmarkCoverage <= 0 ||
      policy.minimumBenchmarkCoverage > 1 || policy.minimumEffectiveSampleSize <= 0 ||
      !Number.isInteger(policy.minimumSkillObservations) || policy.minimumSkillObservations < 1 ||
      policy.confidenceLevel <= 0 || policy.confidenceLevel >= 1) throw new RangeError('Bias-correction policy values are invalid');

  const postings = deduplicate(input.observations, releaseIds);
  if (!postings.length) throw new RangeError('At least one posting observation is required');
  const postingsByStratum = new Map<string, DeduplicatedPosting[]>();
  for (const posting of postings) {
    const key = stratumKey(posting.stratum), rows = postingsByStratum.get(key) ?? [];rows.push(posting);postingsByStratum.set(key, rows);
  }
  const coveredBenchmarkKeys = [...benchmarkByKey.entries()].filter(([key, cell]) => cell.count > 0 && (postingsByStratum.get(key)?.length ?? 0) > 0);
  const coveredMass = coveredBenchmarkKeys.reduce((sum, [, cell]) => sum + cell.count, 0);
  if (coveredMass <= 0) throw new RangeError('No observed stratum overlaps the positive official benchmark frame');
  const benchmarkedPostingCount = coveredBenchmarkKeys.reduce((sum, [key]) => sum + postingsByStratum.get(key)!.length, 0);
  const weights = new Map<string, { raw: number; applied: number; capped: boolean }>();
  for (const [key, cell] of coveredBenchmarkKeys) {
    const observed = postingsByStratum.get(key)!.length;
    const raw = (cell.count / coveredMass) / (observed / benchmarkedPostingCount);
    const capped = Math.min(policy.maximumWeight, Math.max(policy.minimumWeight, raw));
    weights.set(key, { raw,applied: capped,capped: capped !== raw });
  }
  const allStratumKeys = new Set([...postingsByStratum.keys(), ...benchmarkByKey.keys()]);
  const strata = [...allStratumKeys].map(key => {
    const observedRows = postingsByStratum.get(key) ?? [], benchmark = benchmarkByKey.get(key), weight = weights.get(key);
    return { stratum: { ...(observedRows[0]?.stratum ?? benchmark!.stratum) },observedPostings: observedRows.length,
      benchmarkCount: benchmark?.count ?? null,rawAdjustmentFactor: weight?.raw ?? null,
      appliedWeight: weight?.applied ?? null,capped: weight?.capped ?? false };
  }).sort((left, right) => stratumKey(left.stratum).localeCompare(stratumKey(right.stratum)));
  const weightedPostings = postings.flatMap(posting => {
    const weight = weights.get(stratumKey(posting.stratum));return weight ? [{ posting,weight: weight.applied }] : [];
  });
  const sumWeights = weightedPostings.reduce((sum, row) => sum + row.weight, 0);
  const sumSquaredWeights = weightedPostings.reduce((sum, row) => sum + row.weight ** 2, 0);
  const effectiveSampleSize = sumWeights ** 2 / sumSquaredWeights;
  const benchmarkCoverageRatio = coveredMass / totalBenchmarkMass;
  const skillIds = [...new Set(postings.flatMap(posting => posting.skillIds))].sort();
  const skills = skillIds.map((skillId): LaborMarketSkillDemandEstimate => {
    const rawPostingCount = postings.filter(posting => posting.skillIds.includes(skillId)).length;
    const benchmarkedSkillObservations = weightedPostings.filter(row => row.posting.skillIds.includes(skillId));
    const benchmarkedRawPostingCount = benchmarkedSkillObservations.length;
    const benchmarkedRawShare = benchmarkedRawPostingCount / benchmarkedPostingCount;
    const adjustedPostingEquivalent = benchmarkedSkillObservations
      .reduce((sum, row) => sum + row.weight, 0);
    const adjustedShare = adjustedPostingEquivalent / sumWeights;
    const standardError = Math.sqrt(Math.max(0, adjustedShare * (1 - adjustedShare) / effectiveSampleSize));
    const interval = wilsonInterval(adjustedShare, effectiveSampleSize, policy.confidenceLevel);
    const qualityFlags: LaborMarketSkillDemandEstimate['qualityFlags'][number][] = [];
    if (benchmarkCoverageRatio < policy.minimumBenchmarkCoverage) qualityFlags.push('low_benchmark_coverage');
    if (effectiveSampleSize < policy.minimumEffectiveSampleSize) qualityFlags.push('low_effective_sample_size');
    if (rawPostingCount < policy.minimumSkillObservations) qualityFlags.push('few_skill_observations');
    if (benchmarkedSkillObservations.length < rawPostingCount) qualityFlags.push('unbenchmarked_skill_observations');
    const status = benchmarkCoverageRatio < policy.minimumBenchmarkCoverage || benchmarkedSkillObservations.length < rawPostingCount ? 'insufficient_coverage' :
      effectiveSampleSize < policy.minimumEffectiveSampleSize || rawPostingCount < policy.minimumSkillObservations ?
        'insufficient_sample' : 'publishable';
    return { skillId,rawPostingCount,benchmarkedRawPostingCount,benchmarkedRawShare,adjustedPostingEquivalent,adjustedShare,
      relativeShareChange: benchmarkedRawShare > 0 ? adjustedShare / benchmarkedRawShare - 1 : null,standardError,
      confidenceInterval: { level: policy.confidenceLevel,...interval },effectiveSampleSize,status,qualityFlags };
  });
  const qualityFlags: BiasCorrectedLaborMarketBatch['qualityFlags'][number][] = [];
  if (input.observations.length > postings.length) qualityFlags.push('duplicates_removed');
  if (postings.some(posting => posting.skillDisagreement)) qualityFlags.push('duplicate_skill_disagreement');
  if (postings.length > benchmarkedPostingCount) qualityFlags.push('unbenchmarked_observations');
  if (coveredBenchmarkKeys.length < [...benchmarkByKey.values()].filter(cell => cell.count > 0).length)
    qualityFlags.push('uncovered_benchmark_cells');
  if ([...weights.values()].some(weight => weight.capped)) qualityFlags.push('weight_capping_applied');
  if (benchmarkCoverageRatio < policy.minimumBenchmarkCoverage) qualityFlags.push('low_benchmark_coverage');
  if (effectiveSampleSize < policy.minimumEffectiveSampleSize) qualityFlags.push('low_effective_sample_size');
  qualityFlags.push('selection_bias_may_remain','absolute_vacancy_level_not_identified');
  const inputSnapshot = JSON.parse(JSON.stringify({ period: input.period,sourceReleases: normalizedReleases,
    observations: input.observations.map(observation => ({ ...observation,observedAt: validDate(observation.observedAt, 'observedAt') })),
    benchmark: { ...input.benchmark,publishedAt,cells: input.benchmark.cells },policy,
    algorithmVersion: ALGORITHM_VERSIONS.laborMarketBiasCorrection })) as Record<string, unknown>;
  const inputsHash = hashComputationInputs(inputSnapshot);
  const core = { period: input.period,algorithmVersion: ALGORITHM_VERSIONS.laborMarketBiasCorrection,
    policyVersion: policy.version,inputsHash,inputSnapshot,
    counts: { rawObservations: input.observations.length,uniquePostings: postings.length,
      duplicatesRemoved: input.observations.length - postings.length,benchmarkedPostings: benchmarkedPostingCount,
      unbenchmarkedPostings: postings.length - benchmarkedPostingCount },
    benchmarkCoverage: { totalCells: benchmarkByKey.size,coveredCells: coveredBenchmarkKeys.length,
      totalMass: totalBenchmarkMass,coveredMass,ratio: benchmarkCoverageRatio },
    effectiveSampleSize,strata,skills,qualityFlags };
  return { ...core,resultHash: hashComputationInputs(core) };
}

export function validateBiasCorrectedLaborMarketBatch(batch: BiasCorrectedLaborMarketBatch): void {
  const { resultHash, ...core } = batch;
  if (batch.algorithmVersion !== ALGORITHM_VERSIONS.laborMarketBiasCorrection ||
      batch.inputsHash !== hashComputationInputs(batch.inputSnapshot) || resultHash !== hashComputationInputs(core))
    throw new RangeError('Labor-market batch failed provenance validation');
}
