import type { EvidenceProfile } from '../evidence/learner-evidence.js';

export type StartingProfile = Readonly<{
  learnerId: string;
  currentRoleId: string | null;
  experience: string;
  interests: string;
  constraints: string;
  updatedAt: string | null;
}>;

export type DirectionKind = 'adjacent_role' | 'specialization' | 'current_role_growth';
export type RequirementState = 'supported' | 'development_needed' | 'unknown' | 'conflicting';
export type SourceReference = Readonly<{ label: string; reference: string; reviewStatus: 'demo_unreviewed' | 'reviewed' }>;
export type RoleRequirement = Readonly<{ skillId: string; label: string; targetLevel: number; importance: number; source: SourceReference }>;
export type RoleDirection = Readonly<{
  id: string; roleId: string; kind: DirectionKind; title: string; description: string;
  responsibilities: readonly string[]; interestTags: readonly string[];
  requirements: readonly RoleRequirement[]; sources: readonly SourceReference[];
}>;
export type RequirementAnalysis = RoleRequirement & Readonly<{
  state: RequirementState; observedLevel: number | null; evidenceType: string | null;
  evidenceStrength: string | null; evidenceId: string | null;
  disagreementResolution: 'confidence_then_recency' | 'unresolved' | null;
}>;
export type DevelopmentAction = Readonly<{
  id: string; directionId: string; kind: 'project' | 'practice' | 'reflection' | 'conversation' | 'evidence_check';
  title: string; purpose: string; addresses: readonly string[]; instructions: string;
  output: string; prerequisites: string; completionCriteria: string; unlocks: string;
}>;
export type CareerPossibility = Readonly<{
  id: string; kind: DirectionKind; title: string; description: string; responsibilities: readonly string[];
  reasonsToExplore: readonly string[]; transferableSkills: readonly RequirementAnalysis[];
  requirements: readonly RequirementAnalysis[]; startingActions: readonly DevelopmentAction[];
  uncertainties: readonly string[]; sources: readonly SourceReference[]; saved: boolean;
}>;
export type ExplorationResult = Readonly<{
  possibilities: readonly CareerPossibility[]; questions: readonly string[];
  coverageNote: string; evidence: EvidenceProfile;
}>;
