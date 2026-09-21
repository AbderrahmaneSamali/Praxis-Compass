import { ALGORITHM_VERSIONS, hashComputationInputs } from '../kernel/index.js';

export type TaskTaxonomy = 'esco' | 'rome' | 'onet';
export type TaskEntityKind = 'esco_skill' | 'rome_competence' | 'onet_task';
export type SuggestedTaskRelation = 'equivalent' | 'source_narrower' | 'source_broader' | 'related';

export type TaskNodeText = Readonly<{
  language: string;
  kind: 'label' | 'description' | 'parallel_translation';
  text: string;
  provenance: string;
}>;

/**
 * A frozen task-like node from one taxonomy release. Anchor IDs must be
 * governed, cross-taxonomy identifiers; raw within-taxonomy neighbour IDs are
 * not comparable and therefore are deliberately excluded.
 */
export type TaskNetworkNode = Readonly<{
  taxonomy: TaskTaxonomy;
  releaseId: string;
  entityKind: TaskEntityKind;
  entityId: string;
  texts: readonly TaskNodeText[];
  occupationAnchorIds: readonly string[];
  skillAnchorIds: readonly string[];
  networkContextIds: readonly string[];
}>;

export type TaskCrosswalkPolicy = Readonly<{
  version: string;
  topK: number;
  minimumCandidateScore: number;
  minimumProposalScore: number;
  minimumProposalMargin: number;
  minimumTextScoreForDirectionalSuggestion: number;
  weights: Readonly<{
    text: number;
    occupationContext: number;
    skillContext: number;
    networkContext: number;
  }>;
}>;

export type TaskCrosswalkInput = Readonly<{
  sourceNodes: readonly TaskNetworkNode[];
  targetNodes: readonly TaskNetworkNode[];
  policy: TaskCrosswalkPolicy;
  computedAt: Date;
}>;

export type TaskCrosswalkCandidate = Readonly<{
  targetKey: string;
  targetTaxonomy: TaskTaxonomy;
  targetReleaseId: string;
  targetEntityKind: TaskEntityKind;
  targetEntityId: string;
  rank: number;
  score: number;
  components: Readonly<{
    text: number;
    occupationContext: number;
    skillContext: number;
    networkContext: number;
  }>;
  evidence: Readonly<{
    comparedLanguages: readonly string[];
    sharedOccupationAnchorIds: readonly string[];
    sharedSkillAnchorIds: readonly string[];
    sharedNetworkContextIds: readonly string[];
  }>;
  suggestedRelation: SuggestedTaskRelation;
  qualityFlags: readonly TaskCrosswalkQualityFlag[];
}>;

export type TaskCrosswalkQualityFlag =
  | 'no_same_language_text'
  | 'missing_occupation_context'
  | 'missing_skill_context'
  | 'missing_network_context'
  | 'direction_requires_review'
  | 'sparse_target_pool';

export type TaskCrosswalkOutcome = Readonly<{
  sourceKey: string;
  sourceTaxonomy: TaskTaxonomy;
  sourceReleaseId: string;
  sourceEntityKind: TaskEntityKind;
  sourceEntityId: string;
  decision: 'proposed' | 'nil' | 'abstained';
  reason: 'candidate_clear' | 'no_plausible_candidate' | 'score_below_proposal_threshold' | 'ambiguous_margin';
  selectedTargetKey: string | null;
  topScore: number | null;
  runnerUpScore: number | null;
  margin: number | null;
  candidates: readonly TaskCrosswalkCandidate[];
}>;

export type TaskCrosswalkBatch = Readonly<{
  algorithmVersion: string;
  policyVersion: string;
  inputsHash: string;
  resultHash: string;
  computedAt: string;
  inputSnapshot: Readonly<Record<string, unknown>>;
  outcomes: readonly TaskCrosswalkOutcome[];
}>;

export type TaskCrosswalkReview = Readonly<{
  reviewerPrincipal: string;
  decision: 'approved' | 'rejected' | 'needs_revision';
  reviewedRelation: SuggestedTaskRelation | null;
  rationale: string;
  reviewedAt: Date;
  checklist: Readonly<{
    semanticScopeChecked: boolean;
    occupationContextChecked: boolean;
    directionChecked: boolean;
    sourceReleaseChecked: boolean;
  }>;
}>;

const LANGUAGE = /^[a-z]{2}(?:-[A-Z]{2})?$/;

function requiredText(value: string, name: string, maximum = 2_000): string {
  const text = value?.trim();
  if (!text || text.length > maximum) throw new RangeError(`${name} must contain 1-${maximum} characters`);
  return text;
}

function probability(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be in [0,1]`);
  return value;
}

function uniqueStrings(values: readonly string[], name: string): readonly string[] {
  if (!Array.isArray(values) || values.some(value => !value?.trim())) throw new TypeError(`${name} must contain non-empty IDs`);
  const normalized = values.map(value => value.trim());
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${name} must not contain duplicates`);
  return [...normalized].sort();
}

function nodeKey(node: TaskNetworkNode): string {
  return `${node.taxonomy}:${node.releaseId}:${node.entityKind}:${node.entityId}`;
}

function validateNode(node: TaskNetworkNode): void {
  requiredText(node.releaseId, 'releaseId', 200);
  requiredText(node.entityId, 'entityId', 500);
  const expected: Record<TaskTaxonomy, TaskEntityKind> = {
    esco: 'esco_skill', rome: 'rome_competence', onet: 'onet_task',
  };
  if (node.entityKind !== expected[node.taxonomy]) throw new TypeError('entityKind must match the source taxonomy');
  if (!Array.isArray(node.texts) || !node.texts.length) throw new RangeError('Every task node needs at least one text');
  let hasLabel = false;
  const textKeys = new Set<string>();
  for (const text of node.texts) {
    if (!LANGUAGE.test(text.language)) throw new TypeError('Task text language must be a BCP-47 language tag');
    requiredText(text.text, 'task text');requiredText(text.provenance, 'task text provenance', 1_000);
    hasLabel ||= text.kind === 'label';
    const key = `${text.language}:${text.kind}:${text.text.trim()}`;
    if (textKeys.has(key)) throw new TypeError('Task node texts must be unique');
    textKeys.add(key);
  }
  if (!hasLabel) throw new RangeError('Every task node needs a label text');
  uniqueStrings(node.occupationAnchorIds, 'occupationAnchorIds');
  uniqueStrings(node.skillAnchorIds, 'skillAnchorIds');
  uniqueStrings(node.networkContextIds, 'networkContextIds');
}

function canonicalNode(node: TaskNetworkNode): TaskNetworkNode {
  validateNode(node);
  return {
    taxonomy: node.taxonomy,
    releaseId: node.releaseId.trim(),
    entityKind: node.entityKind,
    entityId: node.entityId.trim(),
    texts: node.texts.map(text => ({ ...text,text: text.text.trim(),provenance: text.provenance.trim() }))
      .sort((left, right) => `${left.language}:${left.kind}:${left.text}:${left.provenance}`
        .localeCompare(`${right.language}:${right.kind}:${right.text}:${right.provenance}`)),
    occupationAnchorIds: uniqueStrings(node.occupationAnchorIds, 'occupationAnchorIds'),
    skillAnchorIds: uniqueStrings(node.skillAnchorIds, 'skillAnchorIds'),
    networkContextIds: uniqueStrings(node.networkContextIds, 'networkContextIds'),
  };
}

function normalizeText(value: string): readonly string[] {
  return [...new Set(value.normalize('NFKD').toLocaleLowerCase('und')
    .replace(/\p{Mark}/gu, '').match(/[\p{Letter}\p{Number}]+/gu) ?? [])].sort();
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left), b = new Set(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function intersection(left: readonly string[], right: readonly string[]): readonly string[] {
  const target = new Set(right);
  return [...new Set(left.filter(value => target.has(value)))].sort();
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function strictSubset(left: readonly string[], right: readonly string[]): boolean {
  return left.length > 0 && left.length < right.length && left.every(value => right.includes(value));
}

function combinedAnchors(node: TaskNetworkNode): readonly string[] {
  return [
    ...node.occupationAnchorIds.map(value => `occupation:${value}`),
    ...node.skillAnchorIds.map(value => `skill:${value}`),
    ...node.networkContextIds.map(value => `network:${value}`),
  ].sort();
}

function textSimilarity(source: TaskNetworkNode, target: TaskNetworkNode): { score: number; languages: readonly string[] } {
  let score = 0;
  const languages = new Set<string>();
  for (const left of source.texts) for (const right of target.texts) {
    if (left.language !== right.language) continue;
    languages.add(left.language);
    score = Math.max(score, jaccard(normalizeText(left.text), normalizeText(right.text)));
  }
  return { score,languages: [...languages].sort() };
}

function suggestedRelation(source: TaskNetworkNode, target: TaskNetworkNode, textScore: number, threshold: number): SuggestedTaskRelation {
  const left = combinedAnchors(source), right = combinedAnchors(target);
  if (textScore < threshold || !left.length || !right.length) return 'related';
  if (sameSet(left, right)) return 'equivalent';
  if (strictSubset(left, right)) return 'source_narrower';
  if (strictSubset(right, left)) return 'source_broader';
  return 'related';
}

function scoreCandidate(source: TaskNetworkNode, target: TaskNetworkNode, policy: TaskCrosswalkPolicy): Omit<TaskCrosswalkCandidate, 'rank'> {
  const text = textSimilarity(source, target);
  const occupationContext = jaccard(source.occupationAnchorIds, target.occupationAnchorIds);
  const skillContext = jaccard(source.skillAnchorIds, target.skillAnchorIds);
  const networkContext = jaccard(source.networkContextIds, target.networkContextIds);
  const components = { text: text.score,occupationContext,skillContext,networkContext };
  const qualityFlags: TaskCrosswalkQualityFlag[] = [];
  if (!text.languages.length) qualityFlags.push('no_same_language_text');
  if (!source.occupationAnchorIds.length || !target.occupationAnchorIds.length) qualityFlags.push('missing_occupation_context');
  if (!source.skillAnchorIds.length || !target.skillAnchorIds.length) qualityFlags.push('missing_skill_context');
  if (!source.networkContextIds.length || !target.networkContextIds.length) qualityFlags.push('missing_network_context');
  qualityFlags.push('direction_requires_review');
  const weightedScore = components.text * policy.weights.text +
    components.occupationContext * policy.weights.occupationContext +
    components.skillContext * policy.weights.skillContext + components.networkContext * policy.weights.networkContext;
  const score = Math.abs(weightedScore - 1) < 1e-12 ? 1 : Math.abs(weightedScore) < 1e-12 ? 0 : weightedScore;
  return {
    targetKey: nodeKey(target),targetTaxonomy: target.taxonomy,targetReleaseId: target.releaseId,
    targetEntityKind: target.entityKind,targetEntityId: target.entityId,
    score,
    components,
    evidence: {
      comparedLanguages: text.languages,
      sharedOccupationAnchorIds: intersection(source.occupationAnchorIds, target.occupationAnchorIds),
      sharedSkillAnchorIds: intersection(source.skillAnchorIds, target.skillAnchorIds),
      sharedNetworkContextIds: intersection(source.networkContextIds, target.networkContextIds),
    },
    suggestedRelation: suggestedRelation(source, target, text.score, policy.minimumTextScoreForDirectionalSuggestion),
    qualityFlags,
  };
}

function validatePolicy(policy: TaskCrosswalkPolicy): void {
  requiredText(policy.version, 'policy version', 100);
  if (!Number.isInteger(policy.topK) || policy.topK < 1 || policy.topK > 100) throw new RangeError('topK must be an integer in [1,100]');
  probability(policy.minimumCandidateScore, 'minimumCandidateScore');
  probability(policy.minimumProposalScore, 'minimumProposalScore');
  probability(policy.minimumProposalMargin, 'minimumProposalMargin');
  probability(policy.minimumTextScoreForDirectionalSuggestion, 'minimumTextScoreForDirectionalSuggestion');
  if (policy.minimumProposalScore < policy.minimumCandidateScore)
    throw new RangeError('minimumProposalScore cannot be below minimumCandidateScore');
  const weights = Object.values(policy.weights);
  weights.forEach((weight, index) => probability(weight, `weight ${index}`));
  if (Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-9)
    throw new RangeError('Crosswalk weights must sum to 1');
}

/** Produces review candidates only. No result from this function is an authoritative mapping. */
export function proposeTaskNetworkCrosswalk(input: TaskCrosswalkInput): TaskCrosswalkBatch {
  validatePolicy(input.policy);
  if (!(input.computedAt instanceof Date) || !Number.isFinite(input.computedAt.getTime()))
    throw new TypeError('computedAt must be a valid Date');
  if (!input.sourceNodes.length || !input.targetNodes.length) throw new RangeError('Source and target task nodes are required');
  const sourceNodes = input.sourceNodes.map(canonicalNode).sort((a, b) => nodeKey(a).localeCompare(nodeKey(b)));
  const targetNodes = input.targetNodes.map(canonicalNode).sort((a, b) => nodeKey(a).localeCompare(nodeKey(b)));
  const all = [...sourceNodes, ...targetNodes];
  const keys = all.map(nodeKey);
  if (new Set(keys).size !== keys.length) throw new TypeError('Task node identities must be unique across the batch');
  const sourceTaxonomies = new Set(sourceNodes.map(node => node.taxonomy));
  const targetTaxonomies = new Set(targetNodes.map(node => node.taxonomy));
  if (sourceTaxonomies.size !== 1 || targetTaxonomies.size !== 1 || [...sourceTaxonomies][0] === [...targetTaxonomies][0])
    throw new TypeError('A run must cross exactly two distinct taxonomies');
  if (new Set(sourceNodes.map(node => node.releaseId)).size !== 1 ||
      new Set(targetNodes.map(node => node.releaseId)).size !== 1)
    throw new TypeError('Each side of a crosswalk run must use exactly one frozen source release');
  const outcomes = sourceNodes.map(source => {
    const ranked = targetNodes.map(target => scoreCandidate(source, target, input.policy))
      .sort((a, b) => b.score - a.score || a.targetKey.localeCompare(b.targetKey))
      .slice(0, input.policy.topK)
      .map((candidate, index): TaskCrosswalkCandidate => ({ ...candidate,rank: index + 1,
        qualityFlags: targetNodes.length < input.policy.topK
          ? [...candidate.qualityFlags, 'sparse_target_pool'] : candidate.qualityFlags }));
    const plausible = ranked.filter(candidate => candidate.score >= input.policy.minimumCandidateScore);
    const top = plausible[0] ?? null, runnerUp = plausible[1] ?? null;
    const margin = top ? top.score - (runnerUp?.score ?? 0) : null;
    let decision: TaskCrosswalkOutcome['decision'] = 'proposed';
    let reason: TaskCrosswalkOutcome['reason'] = 'candidate_clear';
    if (!top) { decision = 'nil';reason = 'no_plausible_candidate'; }
    else if (top.score < input.policy.minimumProposalScore) { decision = 'abstained';reason = 'score_below_proposal_threshold'; }
    else if (margin! < input.policy.minimumProposalMargin) { decision = 'abstained';reason = 'ambiguous_margin'; }
    return {
      sourceKey: nodeKey(source),sourceTaxonomy: source.taxonomy,sourceReleaseId: source.releaseId,
      sourceEntityKind: source.entityKind,sourceEntityId: source.entityId,decision,reason,
      selectedTargetKey: decision === 'proposed' ? top!.targetKey : null,
      topScore: top?.score ?? null,runnerUpScore: runnerUp?.score ?? null,margin,candidates: ranked,
    } satisfies TaskCrosswalkOutcome;
  });
  const inputSnapshot = JSON.parse(JSON.stringify({ sourceNodes,targetNodes,
    policy: input.policy,computedAt: input.computedAt.toISOString(),algorithmVersion: ALGORITHM_VERSIONS.taskNetworkCrosswalk })) as Record<string, unknown>;
  const inputsHash = hashComputationInputs(inputSnapshot);
  const core = { algorithmVersion: ALGORITHM_VERSIONS.taskNetworkCrosswalk,policyVersion: input.policy.version,
    inputsHash,computedAt: input.computedAt.toISOString(),inputSnapshot,outcomes };
  return { ...core,resultHash: hashComputationInputs(core) };
}

export function validateTaskCrosswalkBatch(batch: TaskCrosswalkBatch): void {
  const { resultHash, ...core } = batch;
  if (batch.algorithmVersion !== ALGORITHM_VERSIONS.taskNetworkCrosswalk ||
      batch.inputsHash !== hashComputationInputs(batch.inputSnapshot) || resultHash !== hashComputationInputs(core))
    throw new RangeError('Task-crosswalk batch failed provenance validation');
  const snapshot = batch.inputSnapshot as unknown as TaskCrosswalkInput & { computedAt: string };
  const replay = proposeTaskNetworkCrosswalk({ ...snapshot,computedAt: new Date(snapshot.computedAt) });
  if (replay.resultHash !== batch.resultHash) throw new RangeError('Task-crosswalk batch is not reproducible');
}

export function validateTaskCrosswalkReview(review: TaskCrosswalkReview): void {
  requiredText(review.reviewerPrincipal, 'reviewerPrincipal', 300);
  requiredText(review.rationale, 'review rationale', 4_000);
  if (!(review.reviewedAt instanceof Date) || !Number.isFinite(review.reviewedAt.getTime()))
    throw new TypeError('reviewedAt must be a valid Date');
  if (review.decision === 'approved') {
    if (!review.reviewedRelation) throw new RangeError('Approval requires a reviewer-selected relation');
    if (Object.values(review.checklist).some(value => value !== true))
      throw new RangeError('Approval requires a complete expert checklist');
  } else if (review.reviewedRelation !== null) {
    throw new RangeError('Only an approved review may assign a relation');
  }
}
