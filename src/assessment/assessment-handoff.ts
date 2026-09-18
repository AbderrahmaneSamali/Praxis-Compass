import { ALGORITHM_VERSIONS } from '../kernel/index.js';
import { eligibilityIssues } from '../engine/recommendation-engine.js';
import { knownLevels, prerequisiteRequirements } from '../engine/learning-path-planner.js';
import { finiteRange, validDate, validateLearner } from '../engine/validation.js';
import type { CandidateItem, LearnerState } from '../engine/recommendation.types.js';
import type { TargetProfile } from '../engine/recommendation.repository.js';

export type AssessmentAvailability = Readonly<{
  skillId: string; language: string; blueprintId: string; blueprintVersion: string;
  supportedLevels: readonly number[];
}>;

export type AssessmentHandoff = Readonly<{
  status: 'not_needed' | 'action_required';
  targetOccupationId: string;
  algorithmVersion: string;
  requests: readonly Readonly<{
    skillId: string; label: string; requiredLevel: number; importance: number;
    blockedCourseCount: number;
    reasons: readonly ('missing_level' | 'prerequisite_unknown' | 'conflicting_evidence')[];
    action: 'take_assessment' | 'confirm_level' | 'resolve_evidence' | 'provide_practical_evidence';
    assessment: AssessmentAvailability | null;
  }>[];
}>;

/** Transparent heuristic priority: relevant courses blocked, then target importance. */
export function createAssessmentHandoff(target: TargetProfile, learner: LearnerState, items: readonly CandidateItem[],
  availability: readonly AssessmentAvailability[] = [], conflictingSkillIds: readonly string[] = [], now = new Date()): AssessmentHandoff {
  validateLearner(learner); validDate(now, 'now');
  if (!target.occupationId?.trim()) throw new TypeError('Target occupation is required');
  if (learner.targetOccupationId && learner.targetOccupationId !== target.occupationId) throw new RangeError('Target profile mismatch');
  const targetIds = new Set<string>();
  for (const skill of target.skills) {
    if (!skill.skillId?.trim() || targetIds.has(skill.skillId)) throw new TypeError('Target skill IDs must be nonempty and unique');
    targetIds.add(skill.skillId);
    finiteRange(skill.targetLevel, 'targetLevel', 0, 4); finiteRange(skill.importance, 'importance');
    if (!Number.isInteger(skill.targetLevel)) throw new RangeError('Target level must be a rubric level');
  }
  const held = knownLevels(learner);
  const conflicts = new Set(conflictingSkillIds);
  const requests = new Map<string, {
    skillId: string; label: string; requiredLevel: number; importance: number;
    blocked: Set<string>; reasons: Set<'missing_level' | 'prerequisite_unknown' | 'conflicting_evidence'>;
  }>();
  for (const skill of target.skills) if (!held.has(skill.skillId)) requests.set(skill.skillId, {
    skillId: skill.skillId, label: skill.label, requiredLevel: skill.targetLevel, importance: skill.importance,
    blocked: new Set(), reasons: new Set([conflicts.has(skill.skillId) ? 'conflicting_evidence' : 'missing_level']),
  });
  const relevant = new Map(target.skills.filter((skill) => skill.importance > 0 && (held.get(skill.skillId) ?? -1) < skill.targetLevel)
    .map((skill) => [skill.skillId, skill]));
  for (const item of items) {
    if (item.status !== 'published' || !item.actionableOffer) continue;
    const outcomes = item.outcomes.filter((outcome) => outcome.weight > 0 && relevant.has(outcome.skillId) &&
      (outcome.outcomeLevel === null || outcome.outcomeLevel > (held.get(outcome.skillId) ?? -1)));
    if (!outcomes.length || eligibilityIssues(item, learner, now).some((issue) => issue !== 'prerequisite_unknown')) continue;
    for (const prerequisite of prerequisiteRequirements(item)) if (!held.has(prerequisite.skillId)) {
      const request = requests.get(prerequisite.skillId) ?? {
        skillId: prerequisite.skillId, label: prerequisite.label, requiredLevel: prerequisite.minimumLevel,
        importance: Math.max(...outcomes.map((outcome) => relevant.get(outcome.skillId)!.importance)),
        blocked: new Set<string>(), reasons: new Set<'missing_level' | 'prerequisite_unknown' | 'conflicting_evidence'>(),
      };
      request.requiredLevel = Math.max(request.requiredLevel, prerequisite.minimumLevel);
      request.blocked.add(item.id); request.reasons.add('prerequisite_unknown');
      if (conflicts.has(prerequisite.skillId)) request.reasons.add('conflicting_evidence');
      requests.set(prerequisite.skillId, request);
    }
  }
  const ordered = [...requests.values()].sort((a, b) => b.blocked.size - a.blocked.size || b.importance - a.importance || a.skillId.localeCompare(b.skillId));
  return { status: ordered.length ? 'action_required' : 'not_needed', targetOccupationId: target.occupationId,
    algorithmVersion: ALGORITHM_VERSIONS.assessmentHandoff, requests: ordered.map((request) => {
      const assessment = availability.filter((bank) => bank.skillId === request.skillId && bank.supportedLevels.includes(request.requiredLevel))
        .sort((a, b) => a.blueprintId.localeCompare(b.blueprintId))[0] ?? null;
      return { skillId: request.skillId, label: request.label, requiredLevel: request.requiredLevel, importance: request.importance,
        blockedCourseCount: request.blocked.size, reasons: [...request.reasons].sort(),
        action: conflicts.has(request.skillId) ? 'resolve_evidence' as const
          : request.requiredLevel >= 4 ? 'provide_practical_evidence' as const
          : assessment ? 'take_assessment' as const : 'confirm_level' as const,
        assessment: conflicts.has(request.skillId) || request.requiredLevel >= 4 ? null : assessment,
      };
    }) };
}
