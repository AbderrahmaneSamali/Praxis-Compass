import type { EvidenceProfile } from '../evidence/learner-evidence.js';
import type { RequirementAnalysis, RoleRequirement } from './exploration.types.js';

export function analyzeRequirements(requirements: readonly RoleRequirement[], evidence: EvidenceProfile): RequirementAnalysis[] {
  const selected = new Map(evidence.selectedEvidence.map(item => [item.skillId, item]));
  const conflicts = new Set(evidence.conflictingSkillIds);
  const disagreements = new Map(evidence.disagreements.map(item => [item.skillId,item.resolution]));
  return requirements.map(requirement => {
    const found = selected.get(requirement.skillId);
    const state = conflicts.has(requirement.skillId) ? 'conflicting' : !found || requirement.targetLevel === null ? 'unknown'
      : found.level >= requirement.targetLevel ? 'supported' : 'development_needed';
    return { ...requirement, state, observedLevel: found?.level ?? null,
      evidenceType: found?.evidenceType ?? null, evidenceStrength: found?.confidence ?? null,
      evidenceId: found?.evidenceId ?? null,
      disagreementResolution: disagreements.get(requirement.skillId) ?? null };
  });
}
