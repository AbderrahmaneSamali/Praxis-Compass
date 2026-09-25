/** Structured, record-citing reasons: never free prose (CLAUDE.md). */
export type ExplorationReason =
  | Readonly<{
      kind: 'rome_mobility';
      /** ROME code the move starts from. */
      fromCodeRome: string;
      toCodeRome: string;
      /** France Travail's own order for this origin; cited, never re-ranked. */
      sourceOrder: number;
      releaseId: string;
    }>
  | Readonly<{
      kind: 'rome_interest_centre';
      centreCode: number;
      centreLabel: string;
      /** France Travail marks some links as the job's principal interest. */
      principal: boolean;
      releaseId: string;
    }>
  | Readonly<{
      kind: 'rome_shared_skills';
      fromCodeRome: string;
      /** OGR codes of the savoir-faire both jobs list. */
      sharedSkillOgrs: readonly string[];
      originSkillCount: number;
      releaseId: string;
    }>;

export type Riasec = Readonly<{ major: string; minor: string | null }>;

export type RomeOrigin = Readonly<{
  codeRome: string;
  jobLabel: string;
  /** The ROME title (appellation) that matched the search. */
  matchedTitle: string;
  matchedTitleOgr: string;
}>;

export type RomeInterestCentre = Readonly<{
  code: number;
  label: string;
  definition: string;
}>;

export type RomeOccupationProfile = Readonly<{
  codeRome: string;
  label: string;
  definition: readonly string[];
  /** "Accès au métier": diplomas, experience, conditions, in source order. */
  access: readonly string[];
  riasec: Riasec | null;
  interestCentres: readonly (RomeInterestCentre & Readonly<{ principal: boolean }>)[];
  sectors: readonly Readonly<{
    code: number;
    label: string;
    parentLabel: string | null;
    principal: boolean;
  }>[];
  professionalDomains: readonly Readonly<{ code: string; label: string; grandDomain: string }>[];
  regulated: boolean;
  releaseId: string;
}>;

export type RomeDirection = Readonly<{
  codeRome: string;
  label: string;
  riasec: Riasec | null;
  reasons: readonly ExplorationReason[];
}>;

export type PossibilityGroup = Readonly<{
  items: readonly RomeDirection[];
  /** Jobs in the group before `limit` was applied. */
  total: number;
}>;

/**
 * Directions grouped by why they appear. A job can sit in several groups; its
 * reasons always list every group it belongs to. Order within a group:
 * - mobility: France Travail's own order;
 * - interests: jobs linked to more of the learner's confirmed interests
 *   first (a count shown to the learner), then France Travail's "principal"
 *   links, then alphabetical;
 * - sharedSkills: alphabetical; never ranked by overlap.
 */
export type RomePossibilities = Readonly<{
  origin: Readonly<{ codeRome: string; label: string }> | null;
  confirmedInterests: readonly Readonly<{ code: number; label: string }>[];
  groups: Readonly<{
    mobility: PossibilityGroup;
    interests: PossibilityGroup;
    sharedSkills: PossibilityGroup;
  }>;
  releaseId: string;
}>;
