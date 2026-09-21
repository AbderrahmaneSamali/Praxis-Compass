import { ALGORITHM_VERSIONS, hashComputationInputs } from '../kernel/index.js';
import type { EscoSkillCatalog } from '../extraction/esco-skill-linker.js';

export type SkillConfirmationLocale = 'fr' | 'ar' | 'en';
export type SkillConfirmationAction = 'confirm' | 'reject' | 'correct' | 'unsure';

export type ExtractedSkillProposal = Readonly<{
  id: string;
  learnerId: string;
  sourceEvidenceId?: string;
  cvDocumentId: string;
  catalogVersion: string;
  extractionAlgorithmVersion: string;
  decision: 'linked';
  skillId: string;
  mention: Readonly<{ start: number; end: number; text: string }>;
  extractedAt: Date;
}>;

export type LearnerSkillConfirmationCard = Readonly<{
  cardId: string;
  suggestedSkillId: string;
  label: string;
  sourceProposalIds: readonly string[];
  sourceEvidenceIds: readonly string[];
  mentions: readonly Readonly<{
    cvDocumentId: string; start: number; end: number; text: string;
  }>[];
}>;

export type LearnerSkillConfirmationRequest = Readonly<{
  requestId: string;
  requestDigest: string;
  learnerId: string;
  catalogVersion: string;
  locale: SkillConfirmationLocale;
  createdAt: string;
  algorithmVersion: string;
  masteryRubricVersion: string;
  cards: readonly LearnerSkillConfirmationCard[];
}>;

export type LearnerSkillConfirmationResponse = Readonly<{
  requestId: string;
  requestDigest: string;
  learnerId: string;
  submittedAt: Date;
  responses: readonly Readonly<{
    cardId: string;
    action: SkillConfirmationAction;
    correctedSkillId?: string;
    declaredLevel?: number;
    levelAttestation?: boolean;
    masteryRubricVersion?: string;
  }>[];
}>;

export type ConfirmedSkillEvidenceDraft = Readonly<{
  idempotencyKey: string;
  learnerId: string;
  skillId: string;
  level: number;
  evidenceType: 'cv_extracted_confirmed';
  confidence: 'low';
  observedAt: Date;
  provenance: Readonly<Record<string, unknown>>;
}>;

export type LearnerSkillConfirmationResult = Readonly<{
  requestId: string;
  requestDigest: string;
  learnerId: string;
  catalogVersion: string;
  submittedAt: string;
  algorithmVersion: string;
  decisions: readonly Readonly<{
    cardId: string;
    action: SkillConfirmationAction;
    suggestedSkillId: string;
    selectedSkillId: string | null;
    selectedLabel: string | null;
    declaredLevel: number | null;
    evidenceStatus: 'created' | 'needs_level' | 'none';
    sourceProposalIds: readonly string[];
    sourceEvidenceIds: readonly string[];
  }>[];
  evidenceDrafts: readonly ConfirmedSkillEvidenceDraft[];
  needsLevelSkillIds: readonly string[];
  inputSnapshot: Readonly<Record<string, unknown>>;
  resultHash: string;
}>;

const LOCALES: readonly SkillConfirmationLocale[] = ['fr', 'ar', 'en'];
const ACTIONS: readonly SkillConfirmationAction[] = ['confirm', 'reject', 'correct', 'unsure'];

function required(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value;
}

function validDate(value: Date, name: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${name} must be a valid Date`);
}

function catalogSkills(catalog: EscoSkillCatalog): Map<string, EscoSkillCatalog['concepts'][number]> {
  required(catalog.version ?? '', 'catalog version');
  const skills = new Map<string, EscoSkillCatalog['concepts'][number]>();
  for (const concept of catalog.concepts) {
    if (concept.type !== 'skill') continue;
    required(concept.uri, 'catalog skill URI');
    if (skills.has(concept.uri)) throw new TypeError('Catalog skill URIs must be unique');
    skills.set(concept.uri, concept);
  }
  return skills;
}

function labelFor(concept: EscoSkillCatalog['concepts'][number], locale: SkillConfirmationLocale): string {
  const labels = concept.labels as Readonly<Partial<Record<SkillConfirmationLocale, string>>>;
  const label = labels[locale] ?? labels.fr ?? labels.ar ?? labels.en ?? Object.values(labels).find(Boolean);
  if (!label?.trim()) throw new TypeError(`Catalog skill ${concept.uri} needs a display label`);
  return label;
}

function requestPayload(request: Omit<LearnerSkillConfirmationRequest, 'requestId' | 'requestDigest'>): unknown {
  return request;
}

function validateRequestIntegrity(request: LearnerSkillConfirmationRequest): void {
  const { requestId, requestDigest, ...payload } = request;
  const expected = hashComputationInputs(requestPayload(payload));
  if (requestDigest !== expected || requestId !== `cv-confirm-${expected.slice(0, 24)}`)
    throw new RangeError('Confirmation request was changed after creation');
}

/** Builds learner-facing cards from linked mentions; model scores never appear in the request. */
export function buildLearnerSkillConfirmationRequest(
  learnerId: string,
  proposals: readonly ExtractedSkillProposal[],
  catalog: EscoSkillCatalog,
  locale: SkillConfirmationLocale,
  now = new Date(),
): LearnerSkillConfirmationRequest {
  required(learnerId, 'learnerId');
  if (!LOCALES.includes(locale)) throw new TypeError('Confirmation locale must be fr, ar, or en');
  validDate(now, 'now');
  if (!proposals.length) throw new RangeError('At least one linked extraction proposal is required');
  const catalogVersion = required(catalog.version ?? '', 'catalog version');
  const skills = catalogSkills(catalog), proposalIds = new Set<string>(), evidenceIds = new Set<string>();
  const groups = new Map<string, ExtractedSkillProposal[]>();
  for (const proposal of [...proposals].sort((a, b) => a.id.localeCompare(b.id))) {
    required(proposal.id, 'proposal id');
    if (proposalIds.has(proposal.id)) throw new TypeError('Proposal IDs must be unique');
    proposalIds.add(proposal.id);
    if (proposal.learnerId !== learnerId) throw new RangeError('Extraction proposal belongs to a different learner');
    if (proposal.catalogVersion !== catalogVersion) throw new RangeError('Extraction proposal uses a different catalog version');
    if (proposal.decision !== 'linked' || !skills.has(proposal.skillId))
      throw new RangeError('Only linked skills from the frozen catalog can be confirmed');
    required(proposal.cvDocumentId, 'cvDocumentId');
    required(proposal.extractionAlgorithmVersion, 'extractionAlgorithmVersion');
    validDate(proposal.extractedAt, 'extractedAt');
    if (proposal.extractedAt > now) throw new RangeError('Extraction proposal cannot be from the future');
    if (!Number.isInteger(proposal.mention.start) || !Number.isInteger(proposal.mention.end) ||
      proposal.mention.start < 0 || proposal.mention.end <= proposal.mention.start ||
      Array.from(proposal.mention.text).length !== proposal.mention.end - proposal.mention.start)
      throw new RangeError('Mention text must match its Unicode code-point span length');
    if (proposal.sourceEvidenceId) {
      required(proposal.sourceEvidenceId, 'sourceEvidenceId');
      if (evidenceIds.has(proposal.sourceEvidenceId)) throw new TypeError('sourceEvidenceId must belong to one proposal only');
      evidenceIds.add(proposal.sourceEvidenceId);
    }
    const group = groups.get(proposal.skillId) ?? [];
    group.push(proposal); groups.set(proposal.skillId, group);
  }
  const cards = [...groups.entries()].map(([skillId, entries]) => {
    const concept = skills.get(skillId)!;
    const sourceProposalIds = entries.map(entry => entry.id).sort();
    const cardId = `skill-${hashComputationInputs({ skillId, sourceProposalIds }).slice(0, 20)}`;
    return { cardId, suggestedSkillId: skillId, label: labelFor(concept, locale), sourceProposalIds,
      sourceEvidenceIds: entries.flatMap(entry => entry.sourceEvidenceId ? [entry.sourceEvidenceId] : []).sort(),
      mentions: entries.map(entry => ({ cvDocumentId: entry.cvDocumentId, start: entry.mention.start,
        end: entry.mention.end, text: entry.mention.text })) };
  }).sort((a, b) => a.label.localeCompare(b.label, locale) || a.suggestedSkillId.localeCompare(b.suggestedSkillId));
  const payload = { learnerId, catalogVersion, locale, createdAt: now.toISOString(),
    algorithmVersion: ALGORITHM_VERSIONS.learnerSkillConfirmation,
    masteryRubricVersion: ALGORITHM_VERSIONS.masteryRubric, cards };
  const requestDigest = hashComputationInputs(requestPayload(payload));
  return { requestId: `cv-confirm-${requestDigest.slice(0, 24)}`, requestDigest, ...payload };
}

/** Applies a complete learner response. Presence confirmation alone never creates a mastery level. */
export function applyLearnerSkillConfirmation(
  request: LearnerSkillConfirmationRequest,
  response: LearnerSkillConfirmationResponse,
  catalog: EscoSkillCatalog,
): LearnerSkillConfirmationResult {
  validateRequestIntegrity(request);
  const skills = catalogSkills(catalog);
  if (required(catalog.version ?? '', 'catalog version') !== request.catalogVersion) throw new RangeError('Confirmation catalog version changed');
  if (response.requestId !== request.requestId || response.requestDigest !== request.requestDigest ||
    response.learnerId !== request.learnerId) throw new RangeError('Response does not belong to this request and learner');
  validDate(response.submittedAt, 'submittedAt');
  if (response.submittedAt < new Date(request.createdAt)) throw new RangeError('Response predates the confirmation request');
  if (!Array.isArray(response.responses)) throw new TypeError('responses are required');
  const cards = new Map(request.cards.map(card => [card.cardId, card])), answers = new Map<string, typeof response.responses[number]>();
  for (const answer of response.responses) {
    const card = cards.get(answer.cardId);
    if (!card || answers.has(answer.cardId)) throw new TypeError('Unknown or duplicate confirmation card');
    if (!ACTIONS.includes(answer.action)) throw new TypeError('Unknown confirmation action');
    if (answer.action === 'correct') {
      if (!answer.correctedSkillId || answer.correctedSkillId === card.suggestedSkillId || !skills.has(answer.correctedSkillId))
        throw new RangeError('A correction must choose a different skill from the frozen catalog');
    } else if (answer.correctedSkillId !== undefined) throw new TypeError('Only a correction may supply correctedSkillId');
    const accepts = answer.action === 'confirm' || answer.action === 'correct';
    if (answer.declaredLevel !== undefined) {
      if (!accepts || !Number.isInteger(answer.declaredLevel) || answer.declaredLevel < 1 || answer.declaredLevel > 4)
        throw new RangeError('Only accepted skills may have an explicit L1-L4 declaration');
      if (answer.levelAttestation !== true || answer.masteryRubricVersion !== request.masteryRubricVersion)
        throw new RangeError('A declared level requires explicit attestation to the displayed rubric version');
    } else if (answer.levelAttestation !== undefined || answer.masteryRubricVersion !== undefined)
      throw new TypeError('Level attestation fields require a declaredLevel');
    answers.set(answer.cardId, answer);
  }
  if (answers.size !== cards.size) throw new RangeError('Every confirmation card needs an explicit learner response');
  const decisions: LearnerSkillConfirmationResult['decisions'][number][] = [],
    evidenceDrafts: ConfirmedSkillEvidenceDraft[] = [], needsLevelSkillIds: string[] = [], selectedIds = new Set<string>();
  for (const card of request.cards) {
    const answer = answers.get(card.cardId)!;
    const selectedSkillId = answer.action === 'confirm' ? card.suggestedSkillId :
      answer.action === 'correct' ? answer.correctedSkillId! : null;
    if (selectedSkillId) {
      if (selectedIds.has(selectedSkillId)) throw new RangeError('Two confirmation cards cannot resolve to the same skill');
      selectedIds.add(selectedSkillId);
    }
    const declaredLevel = answer.declaredLevel ?? null;
    const evidenceStatus = !selectedSkillId ? 'none' : declaredLevel === null ? 'needs_level' : 'created';
    const selectedLabel = selectedSkillId ? labelFor(skills.get(selectedSkillId)!, request.locale) : null;
    decisions.push({ cardId: card.cardId, action: answer.action, suggestedSkillId: card.suggestedSkillId,
      selectedSkillId, selectedLabel, declaredLevel, evidenceStatus, sourceProposalIds: card.sourceProposalIds,
      sourceEvidenceIds: card.sourceEvidenceIds });
    if (selectedSkillId && declaredLevel === null) needsLevelSkillIds.push(selectedSkillId);
    if (selectedSkillId && declaredLevel !== null) {
      const idempotencyKey = hashComputationInputs({ requestDigest: request.requestDigest, cardId: card.cardId,
        skillId: selectedSkillId, declaredLevel });
      evidenceDrafts.push({ idempotencyKey, learnerId: request.learnerId, skillId: selectedSkillId,
        level: declaredLevel, evidenceType: 'cv_extracted_confirmed', confidence: 'low',
        observedAt: new Date(response.submittedAt.getTime()), provenance: {
          source: 'learner_cv_confirmation', confirmationRequestId: request.requestId,
          confirmationRequestDigest: request.requestDigest, confirmationCardId: card.cardId,
          sourceProposalIds: [...card.sourceProposalIds], sourceEvidenceIds: [...card.sourceEvidenceIds],
          catalogVersion: request.catalogVersion, confirmationAlgorithmVersion: request.algorithmVersion,
          masteryRubricVersion: request.masteryRubricVersion, learnerAttestedLevel: true,
        } });
    }
  }
  const inputSnapshot = JSON.parse(JSON.stringify({ requestId: request.requestId, requestDigest: request.requestDigest,
    learnerId: request.learnerId, submittedAt: response.submittedAt.toISOString(),
    responses: response.responses.map(answer => ({ ...answer })).sort((a, b) => a.cardId.localeCompare(b.cardId)),
    algorithmVersion: request.algorithmVersion }));
  const resultCore = { requestId: request.requestId, requestDigest: request.requestDigest, learnerId: request.learnerId,
    catalogVersion: request.catalogVersion, submittedAt: response.submittedAt.toISOString(),
    algorithmVersion: request.algorithmVersion, decisions, evidenceDrafts, needsLevelSkillIds, inputSnapshot };
  return { ...resultCore, resultHash: hashComputationInputs(resultCore) };
}

export function validateLearnerSkillConfirmationResult(result: LearnerSkillConfirmationResult): void {
  const { resultHash, ...core } = result;
  if (result.algorithmVersion !== ALGORITHM_VERSIONS.learnerSkillConfirmation ||
    hashComputationInputs(core) !== resultHash) throw new RangeError('Confirmation result failed integrity validation');
}
