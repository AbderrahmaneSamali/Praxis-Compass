import type { EvidenceConfidence } from '../kernel/index.js';

export type LearnerSkill = Readonly<{
  skillId: string;
  declaredLevel: number;
  targetLevel: number;
  importance: number;
  gap: number;
  confidence: EvidenceConfidence;
}>;

export type LearnerConstraints = Readonly<{
  budgetFlexibility?: 'mandatory' | 'flexible';
  languageFlexibility?: 'mandatory' | 'flexible';
  formatFlexibility?: 'mandatory' | 'flexible';
  onlineFormat?: 'online_live' | 'online_self_paced';
  budgetMad?: number;
  maxDurationHours?: number;
  languages?: readonly string[];
  format?: string;
  formatPreferences?: readonly ('présentiel' | 'en ligne' | 'hybride')[];
  locationCity?: string;
  remoteOnly?: boolean;
  deadline?: Date;
  hoursPerWeek?: number;
  intensityPreference?: 'intensive' | 'progressif';
  rejectedFormats?: readonly string[];
  rejectedSessionDates?: readonly string[];
  timingRejections?: number;
}>;

export type LearnerState = Readonly<{
  /** Binds caller-assembled target gaps to an occupation. */
  targetOccupationId?: string;
  prerequisiteLevels?: Readonly<Record<string, number>>;
  learnerId: string;
  skills: readonly LearnerSkill[];
  constraints: LearnerConstraints;
  levelPrior?: number;
  segment?: string;
}>;

export type LearningOutcome = Readonly<{
  skillId: string;
  entryLevel: number | null;
  outcomeLevel: number | null;
  weight: number;
  catalogFrequency: number;
}>;

export type CandidateItem = Readonly<{
  nextEndAt?: Date | null;
  requiredWeeklyHours?: number | null;
  prerequisites?: readonly Readonly<{
    skillId: string;
    label: string;
    minimumLevel: number;
  }>[];
  id: string;
  recordType: 'course' | 'pathway';
  slug: string;
  title: string;
  summary: string;
  status: string;
  productFamily: string | null;
  sectorCode: string | null;
  featured: boolean;
  coldStartRank: number | null;
  coldStartSourceVersion: string | null;
  priceMad: number | null;
  durationHours: number | null;
  languages: readonly string[];
  format: string | null;
  nextSessionAt: Date | null;
  providerId: string | null;
  providerName: string | null;
  applicationUrl: string | null;
  contactRoute: 'provider_email' | 'provider_phone' | 'provider_website' | null;
  deliveryFormat: string | null;
  isOnline: boolean | null;
  locationCity: string | null;
  locationCountry: string | null;
  priceStatus: 'unspecified' | 'priced' | 'price_on_request';
  admissionStatus: 'unspecified' | 'scheduled' | 'rolling_admission';
  actionableOffer: boolean;
  actionableMissing: readonly string[];
  dataSource: string;
  updatedAt: Date;
  targetOccupationId: string | null;
  variant: string | null;
  popularity: number;
  outcomePrior: number;
  outcomePriorSource?: OutcomePriorSource;
  outcomePriorTrialCount?: number;
  outcomePriorAlgorithmVersion?: string;
  outcomePriorInputsHash?: string;
  outcomePriorEvidence: OutcomePriorEvidence;
  outcomes: readonly LearningOutcome[];
  steps: readonly Readonly<{
    position: number;
    type: string;
    label: string;
  }>[];
}>;

export type OutcomeStats = Readonly<{
  successes: number;
  trials: number;
}>;

export type OutcomePriorEvidence = Readonly<{
  itemSegment: OutcomeStats;
  productFamilySector: OutcomeStats;
  sector: OutcomeStats;
  global: OutcomeStats;
}>;

export type OutcomePriorSource =
  | 'item_segment'
  | 'product_family_sector'
  | 'sector'
  | 'global'
  | 'editorial'
  | 'uninformed'
  | 'legacy_unknown';

export type CandidatePools = Readonly<{
  gapItems: readonly CandidateItem[];
  targetPathwayItems: readonly CandidateItem[];
  neighbourhoodItems: readonly CandidateItem[];
  popularityItems: readonly CandidateItem[];
}>;

export type CandidateGeneration = Readonly<{
  items: readonly CandidateItem[];
  dropped: readonly string[];
  deadlineExcluded: readonly string[];
  beforeDedupCount: number;
  afterDedupCount: number;
}>;

export type FeatureVector = Readonly<{
  gap_coverage: number;
  precision: number;
  level_fit: number;
  evidence_confidence: number;
  constraint_fit: number;
  outcome_prior: number;
  scarcity: number;
  freshness: number;
  redundancy_penalty: number;
}>;

export type RecommendationWeights = Readonly<{
  gap_coverage: number;
  precision: number;
  level_fit: number;
  evidence_confidence: number;
  constraint_fit: number;
  outcome_prior: number;
  scarcity: number;
  freshness: number;
  redundancy_penalty: number;
  outcome_prior_estimator: OutcomePriorEstimatorConfig;
}>;

export type OutcomePriorEstimatorConfig = Readonly<{
  alpha: number;
  minimum_trials: Readonly<{
    item: number;
    product_family_sector: number;
    sector: number;
    global: number;
  }>;
  neutral_prior: number;
  featured_prior: number;
  rank_decay: number;
}>;

export type RecommendationReason =
  | Readonly<{ kind: 'related_skills'; skillIds: readonly string[] }>
  | Readonly<{ kind: 'tradeoff'; dimension: 'budget' | 'language' | 'format' }>
  | Readonly<{
      kind: 'time_plan';
      hoursPerWeek: number;
      estimatedWeeks: number;
    }>
  | Readonly<{
      kind: 'covers_gap';
      skillId: string;
      gap: number;
      importance: number;
    }>
  | Readonly<{
      kind: 'level_fit';
      skillId: string;
      entryLevel: number;
      declaredLevel: number;
    }>
  | Readonly<{
      kind: 'constraint_match';
      dimension: 'budget' | 'duration' | 'language' | 'format' | 'location';
    }>;

export type ScoredRecommendation = Readonly<{
  item: CandidateItem;
  features: FeatureVector;
  score: number;
  reasons: readonly RecommendationReason[];
  inputsHash: string;
  algorithmVersion: string;
}>;
