import type { EvidenceProfile } from '../evidence/learner-evidence.js';
import type { ExplorationReason, RomeOccupationProfile } from './rome-explorer.types.js';
import type { RequirementKind } from './requirements.js';

export type StartingProfile = Readonly<{
  learnerId: string;
  currentRoleId: string | null;
  currentRomeCode?: string | null;
  currentRomeLabel?: string | null;
  confirmedInterestCodes?: readonly number[];
  experience: string;
  interests: string;
  constraints: string;
  updatedAt: string | null;
}>;

export type DirectionKind = 'adjacent_role' | 'specialization' | 'current_role_growth' | 'rome_exploration';
export type RequirementState = 'supported' | 'development_needed' | 'unknown' | 'conflicting';
export type SourceReference = Readonly<{ label: string; reference: string; reviewStatus: 'demo_unreviewed' | 'reviewed' | 'official_source' }>;
export type RoleRequirement = Readonly<{ skillId: string; label: string; targetLevel: number | null; importance: number | null; source: SourceReference; romeOgr?: string; requirementKind?: RequirementKind }>;
export type RoleDirection = Readonly<{
  id: string; roleId: string; kind: DirectionKind; title: string; description: string;
  responsibilities: readonly string[]; interestTags: readonly string[];
  requirements: readonly RoleRequirement[]; sources: readonly SourceReference[];
  romeCode?: string; reasons?: readonly ExplorationReason[];
  romeProfile?: RomeOccupationProfile;
  workContexts?: readonly Readonly<{ ogr: string; label: string }> [];
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
  reasonsToExplore: readonly string[]; reasons?: readonly ExplorationReason[]; romeCode?: string;
  romeProfile?: RomeOccupationProfile;
  transferableSkills: readonly RequirementAnalysis[];
  requirements: readonly RequirementAnalysis[]; startingActions: readonly DevelopmentAction[];
  uncertainties: readonly string[]; sources: readonly SourceReference[]; saved: boolean;
  workContexts?: readonly Readonly<{ ogr: string; label: string }> [];
}>;
export type RomeConfirmation = Readonly<{ id: string; ogr: string; response: 'practiced' | 'not_yet' | 'unsure'; workExample: string }>;
export type ExplorationResult = Readonly<{
  possibilities: readonly CareerPossibility[]; questions: readonly string[];
  coverageNote: string; evidence: EvidenceProfile;
}>;
