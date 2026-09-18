import { ALGORITHM_VERSIONS, EVIDENCE_LADDER, hashComputationInputs } from '../kernel/index.js';
import type { EvidenceConfidence, EvidenceType } from '../kernel/index.js';
import type { LearnerState } from '../engine/recommendation.types.js';
import { finiteRange, validDate, validateLearner } from '../engine/validation.js';

export type LearnerContext = Omit<LearnerState, 'skills' | 'prerequisiteLevels' | 'targetOccupationId'>;

export type SkillEvidence = Readonly<{
  id: string;
  learnerId: string;
  skillId: string;
  level: number;
  evidenceType: EvidenceType;
  confidence: EvidenceConfidence;
  observedAt: Date;
  supersededBy: string | null;
  provenance: Readonly<Record<string, unknown>>;
  /** Verified by the repository from the session, not from a CV or model score. */
  assessment?: Readonly<{
    sessionId: string;
    status: string;
    deliveryMode: string;
    coverageAchieved: boolean | null;
    reconciliationStatus: string | null;
    finalLevel: string | null;
    completedAt: Date | null;
  }>;
}>;

export type EvidenceProfile = Readonly<{
  learnerState: LearnerState;
  algorithmVersion: string;
  asOf: string;
  selectedEvidence: readonly Readonly<{
    skillId: string; evidenceId: string; level: number; confidence: EvidenceConfidence;
    evidenceType: EvidenceType; observedAt: string; provenance: Readonly<Record<string, unknown>>;
  }>[];
  ignoredEvidence: readonly Readonly<{ evidenceId: string; skillId: string; reason: string }>[];
  disagreements: readonly Readonly<{
    skillId: string; evidenceIds: readonly string[]; resolution: 'confidence_then_recency' | 'unresolved';
  }>[];
  conflictingSkillIds: readonly string[];
  inputSnapshot: Readonly<Record<string, unknown>>;
  inputsHash: string;
}>;

export type EvidenceOptions = Readonly<{ now?: Date; maxAgeDays?: number }>;
const CONFIDENCE_ORDER: readonly EvidenceConfidence[] = ['very_low', 'low', 'medium_low', 'medium', 'medium_high', 'high'];

/** Selects levels from existing evidence. It never invents a level for an unknown skill. */
export function buildEvidenceProfile(context: LearnerContext, evidence: readonly SkillEvidence[], options: EvidenceOptions = {}): EvidenceProfile {
  const now = options.now ?? new Date();
  validDate(now, 'now');
  if ('skills' in context || 'prerequisiteLevels' in context || 'targetOccupationId' in context)
    throw new TypeError('Learner context must not contain caller-supplied levels or a target profile');
  if (options.maxAgeDays !== undefined) finiteRange(options.maxAgeDays, 'maxAgeDays');
  validateLearner({ ...context, skills: [] });
  const ids = new Set<string>();
  const groups = new Map<string, { row: SkillEvidence; confidence: EvidenceConfidence }[]>();
  const ignoredEvidence: { evidenceId: string; skillId: string; reason: string }[] = [];
  for (const row of [...evidence].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!row.id?.trim() || ids.has(row.id) || !row.skillId?.trim()) throw new TypeError('Evidence IDs must be nonempty and unique; skillId is required');
    ids.add(row.id);
    if (row.learnerId !== context.learnerId) throw new RangeError('Evidence belongs to a different learner');
    finiteRange(row.level, 'evidence level', 0, 4);
    if (!Number.isInteger(row.level) || (row.level === 0 && row.evidenceType !== 'self_declared'))
      throw new RangeError('Evidence level must be L1-L4, or an explicit L0 self-declaration');
    validDate(row.observedAt, 'observedAt');
    if (!Object.hasOwn(EVIDENCE_LADDER, row.evidenceType) || !CONFIDENCE_ORDER.includes(row.confidence)) throw new TypeError('Unknown evidence type or confidence');
    if (!row.provenance || typeof row.provenance !== 'object' || Array.isArray(row.provenance)) throw new TypeError('Evidence provenance must be an object');
    hashComputationInputs(row.provenance);
    const ladder = EVIDENCE_LADDER[row.evidenceType];
    let ignored: string | undefined;
    if (row.supersededBy) ignored = 'superseded';
    else if (row.observedAt > now) ignored = 'future_observation';
    else if (!ladder.usableAlone) ignored = 'unconfirmed_cv';
    else if (options.maxAgeDays !== undefined && now.getTime() - row.observedAt.getTime() > options.maxAgeDays * 86_400_000) ignored = 'stale';
    else if (row.evidenceType === 'quiz_sufficient_coverage' || row.evidenceType === 'quiz_plus_practical') {
      const session = row.assessment;
      if (session?.completedAt) validDate(session.completedAt, 'assessment completedAt');
      if (!session || row.provenance.assessmentSessionId !== session.sessionId ||
          session.status !== 'completed' || session.deliveryMode !== 'production' ||
          session.coverageAchieved !== true || session.reconciliationStatus !== 'reconciled_tested' ||
          session.finalLevel !== `L${row.level}` || !session.completedAt ||
          session.completedAt > row.observedAt || row.level > 3) ignored = 'assessment_not_verified';
    }
    if (ignored) {
      ignoredEvidence.push({ evidenceId: row.id, skillId: row.skillId, reason: ignored });
      continue;
    }
    // Stored/model confidence cannot exceed the evidence type's authority.
    // A session proves the quiz component only; practical validation is not implemented here.
    const authority = row.evidenceType === 'quiz_plus_practical' ? 'medium' : ladder.confidence;
    const confidence = CONFIDENCE_ORDER[Math.min(CONFIDENCE_ORDER.indexOf(row.confidence), CONFIDENCE_ORDER.indexOf(authority))];
    const list = groups.get(row.skillId) ?? [];
    list.push({ row, confidence }); groups.set(row.skillId, list);
  }
  const selectedEvidence: EvidenceProfile['selectedEvidence'][number][] = [];
  const disagreements: EvidenceProfile['disagreements'][number][] = [];
  const conflictingSkillIds: string[] = [];
  for (const [skillId, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => CONFIDENCE_ORDER.indexOf(b.confidence) - CONFIDENCE_ORDER.indexOf(a.confidence) ||
      b.row.observedAt.getTime() - a.row.observedAt.getTime() || a.row.id.localeCompare(b.row.id));
    const best = list[0];
    const tied = list.filter((entry) => entry.confidence === best.confidence && entry.row.observedAt.getTime() === best.row.observedAt.getTime());
    const unresolved = new Set(tied.map((entry) => entry.row.level)).size > 1;
    if (new Set(list.map((entry) => entry.row.level)).size > 1) disagreements.push({
      skillId, evidenceIds: list.map((entry) => entry.row.id), resolution: unresolved ? 'unresolved' : 'confidence_then_recency',
    });
    if (unresolved) { conflictingSkillIds.push(skillId); continue; }
    selectedEvidence.push({ skillId, evidenceId: best.row.id, level: best.row.level, confidence: best.confidence,
      evidenceType: best.row.evidenceType, observedAt: best.row.observedAt.toISOString(),
      provenance: JSON.parse(JSON.stringify(best.row.provenance)),
    });
  }
  const learnerState: LearnerState = { ...context, skills: selectedEvidence.map((selected) => ({
    skillId: selected.skillId, declaredLevel: selected.level, targetLevel: selected.level,
    importance: 1, gap: 0, confidence: selected.confidence,
  })) };
  validateLearner(learnerState);
  const inputSnapshot = JSON.parse(JSON.stringify({ context, evidence: [...evidence].sort((a, b) => a.id.localeCompare(b.id)),
    asOf: now.toISOString(), maxAgeDays: options.maxAgeDays ?? null, algorithmVersion: ALGORITHM_VERSIONS.learnerEvidenceAdapter }));
  return { learnerState, algorithmVersion: ALGORITHM_VERSIONS.learnerEvidenceAdapter, asOf: now.toISOString(),
    selectedEvidence, ignoredEvidence, disagreements, conflictingSkillIds, inputSnapshot, inputsHash: hashComputationInputs(inputSnapshot) };
}
