import type { Pool, PoolClient } from 'pg';
import { randomInt, randomUUID } from 'node:crypto';
import { knownLevels, planLearningPaths } from './learning-path-planner.js';
import { validateLearner, validateWeights } from './validation.js';
import { buildEvidenceProfile, type EvidenceProfile, type LearnerContext, type SkillEvidence } from '../evidence/learner-evidence.js';
import { createAssessmentHandoff, type AssessmentAvailability, type AssessmentHandoff } from '../assessment/assessment-handoff.js';

import {
  ALGORITHM_VERSIONS,
  hashComputationInputs,
  type EvidenceConfidence,
} from '../kernel/index.js';
import {
  applyOutcomePriorEstimate,
  advancesGoal,
  eligibilityIssues,
  candidates,
  exploreTopTen,
  features,
  reasons,
  rerank,
  score,
  RECOMMENDATION_EXPLORATION_PROBABILITY,
} from './recommendation-engine.js';
import type {
  CandidateItem,
  LearnerState,
  RecommendationWeights,
  ScoredRecommendation,
} from './recommendation.types.js';

type WeightRow = Readonly<{ version: string; weights: RecommendationWeights }>;

export type RecommendationOptions = Readonly<{
  /** Explicitly bypasses review, but never publication or hard eligibility. */
  allowAllPublishedOffers?: boolean;
  now?: Date;
  random?: () => number;
  explorationProbability?: number;
  /** Optional evidence freshness policy; no arbitrary expiry is applied by default. */
  evidenceMaxAgeDays?: number;
}>;

export type TargetProfile = Readonly<{
  occupationId: string;
  label: string;
  source: 'authored' | 'derived_from_esco';
  skills: readonly Readonly<{
    skillId: string; label: string; targetLevel: number; importance: number;
    reviewed: boolean; targetLevelBasis: string;
  }>[];
}>;

export type RecommendationResult = Readonly<{
  requestId: string;
  learnerId: string;
  targetOccupationId: string;
  targetStateSource: 'caller_supplied' | 'derived_target';
  status: 'ok' | 'plan_available' | 'insufficient_profile' | 'goal_satisfied' | 'no_eligible_courses';
  missingSkillIds: readonly string[];
  assessmentHandoff: AssessmentHandoff | null;
  evidenceProfile: EvidenceProfile | null;
  recommendations: readonly ScoredRecommendation[];
  relatedRecommendations: readonly ScoredRecommendation[];
  learningPlans: ReturnType<typeof planLearningPaths>;
  weightsVersion: string;
  algorithmVersion: string;
  candidateCount: number;
  zeroCandidates: boolean;
  isExploration: boolean;
  explorationProbability: number;
  scoringAt: string;
  reviewBypassed: boolean;
  exclusions: readonly Readonly<{ itemId: string; issues: readonly string[] }>[];
  droppedItemIds: readonly string[];
  inputsHash: string;
  inputSnapshot: Readonly<Record<string, unknown>>;
}>;

type ItemRow = Readonly<{
  id: string;
  record_type: 'course' | 'pathway';
  slug: string;
  title: string;
  summary: string;
  status: string;
  product_family: string | null;
  sector_code: string | null;
  featured: boolean;
  cold_start_rank: number | null;
  cold_start_source_version: string | null;
  price_mad: string | null;
  duration_hours: string | null;
  languages: readonly string[] | null;
  format: string | null;
  next_session: string | null;
  next_end_date: string | null;
  required_weekly_hours: string | null;
  prerequisites: CandidateItem['prerequisites'];
  provider_id: string | null;
  provider_name: string | null;
  application_url: string | null;
  contact_route: 'provider_email' | 'provider_phone' | 'provider_website' | null;
  delivery_format: string | null;
  is_online: boolean | null;
  location_city: string | null;
  location_country: string | null;
  price_status: 'unspecified' | 'priced' | 'price_on_request';
  admission_status: 'unspecified' | 'scheduled' | 'rolling_admission';
  actionable_offer: boolean;
  data_source: string;
  updated_at: Date;
  target_occupation_id: string | null;
  variant: string | null;
  popularity: string;
  item_successes: string;
  item_trials: number;
  product_family_sector_successes: string;
  product_family_sector_trials: number;
  sector_successes: string;
  sector_trials: number;
  global_successes: string;
  global_trials: number;
  outcomes: CandidateItem['outcomes'];
  steps: CandidateItem['steps'];
}>;

function actionableMissing(row: ItemRow): readonly string[] {
  if (row.actionable_offer) return [];
  const missing: string[] = [];
  if (!row.provider_id) missing.push('organisme');
  if (!row.application_url && !row.contact_route) missing.push('contact');
  if (row.duration_hours === null) missing.push('durée');
  if (!row.delivery_format) missing.push('format');
  if (!row.languages?.length) missing.push('langue');
  if (row.is_online !== true && (!row.location_city || !row.location_country)) {
    missing.push('lieu');
  }
  if (row.price_mad === null && row.price_status !== 'price_on_request') {
    missing.push('prix');
  }
  if (!row.next_session && row.admission_status !== 'rolling_admission') {
    missing.push('prochaine session');
  }
  if (missing.length === 0) missing.push('vérification');
  return missing;
}

export class StandaloneRecommendationRepository {
  constructor(private readonly pool: Pool) {}

  /** Reads persisted evidence; assessment proof is joined by learner and skill. */
  async skillEvidence(learnerId: string): Promise<readonly SkillEvidence[]> {
    const result = await this.pool.query<{
      id: string; learner_id: string; skill_id: string; level: number;
      evidence_type: SkillEvidence['evidenceType']; confidence: EvidenceConfidence;
      observed_at: Date; superseded_by: string | null; provenance: Record<string, unknown>;
      assessment: SkillEvidence['assessment'] | null;
    }>(`SELECT e.*, CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
        'sessionId',s.id,'status',s.status,'deliveryMode',s.delivery_mode,
        'coverageAchieved',s.coverage_achieved,'reconciliationStatus',s.reconciliation_status,
        'finalLevel',s.final_level,'completedAt',s.completed_at) END AS assessment
      FROM praxis.skill_evidence e LEFT JOIN praxis.assessment_session s
        ON s.id::text=e.provenance->>'assessmentSessionId'
        AND s.learner_id=e.learner_id AND s.skill_id=e.skill_id
      WHERE e.learner_id=$1 ORDER BY e.skill_id,e.id`, [learnerId]);
    return result.rows.map((row) => ({ id: row.id, learnerId: row.learner_id, skillId: row.skill_id,
      level: row.level, evidenceType: row.evidence_type, confidence: row.confidence,
      observedAt: new Date(row.observed_at), supersededBy: row.superseded_by, provenance: row.provenance,
      ...(row.assessment ? { assessment: { ...row.assessment,
        completedAt: row.assessment.completedAt ? new Date(row.assessment.completedAt) : null } } : {}) }));
  }

  /** Offers only complete, reviewed, calibrated production banks in the requested language. */
  async assessmentAvailability(skillIds: readonly string[], language: string, now = new Date()): Promise<readonly AssessmentAvailability[]> {
    if (!skillIds.length) return [];
    const result = await this.pool.query<{
      skill_id: string; language: string; blueprint_id: string; version: string; supported_levels: number[];
    }>(`WITH cells AS (
        SELECT b.id,b.skill_id,b.language,b.version,c.key AS sub_skill_id,l.key AS target_level,
          coalesce((l.value->>'target')::integer,0) AS required_items
        FROM praxis.assessment_blueprint b
        CROSS JOIN LATERAL jsonb_each(b.cells) c CROSS JOIN LATERAL jsonb_each(c.value) l
        WHERE b.skill_id=ANY($1::text[]) AND b.language=$2 AND b.status='published'
          AND b.reviewed_by_learner_id IS NOT NULL AND b.reviewed_at <= $3 AND b.published_at <= $3
      ), coverage AS (
        SELECT cells.*,count(i.id)::integer AS available_items FROM cells
        LEFT JOIN praxis.assessment_item i ON i.blueprint_id=cells.id
          AND i.skill_id=cells.skill_id AND i.language=cells.language
          AND i.sub_skill_id=cells.sub_skill_id AND i.target_level=cells.target_level
          AND i.status='published' AND i.published_at <= $3
          AND i.calibration_status='calibrated' AND i.calibrated_at <= $3
          AND i.difficulty BETWEEN -4 AND 4 AND i.discrimination > 0 AND i.discrimination <= 4
          AND (SELECT r.decision FROM praxis.assessment_item_review r
               WHERE r.item_id=i.id AND r.reviewed_at <= $3
               ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 1)='approved'
        GROUP BY cells.id,cells.skill_id,cells.language,cells.version,cells.sub_skill_id,cells.target_level,cells.required_items
      ) SELECT id::text AS blueprint_id,skill_id,language,version,
          array_agg(DISTINCT substring(target_level FROM 2)::integer ORDER BY substring(target_level FROM 2)::integer)
            FILTER (WHERE required_items > 0 AND target_level IN ('L1','L2','L3')) AS supported_levels
        FROM coverage GROUP BY id,skill_id,language,version
        HAVING bool_and(required_items >= 0 AND (required_items=0 OR
          (target_level IN ('L1','L2','L3') AND available_items >= required_items)))
          AND bool_or(required_items > 0) ORDER BY id`, [skillIds, language, now]);
    return result.rows.map((row) => ({ skillId: row.skill_id, language: row.language,
      blueprintId: row.blueprint_id, blueprintVersion: row.version, supportedLevels: row.supported_levels }));
  }

  async activeWeights(client?: PoolClient): Promise<WeightRow> {
    const runner = client ?? this.pool;
    const result = await runner.query<WeightRow>(
      `SELECT version, weights
       FROM praxis.recommendation_weights
       WHERE status = 'active'
       ORDER BY activated_at DESC
       LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('No active recommendation weights version');
    return row;
  }

  async neighbourSkillIds(
    gapSkillIds: readonly string[],
    client?: PoolClient,
  ): Promise<ReadonlySet<string>> {
    if (gapSkillIds.length === 0) return new Set();
    const runner = client ?? this.pool;
    const result = await runner.query<{ skill_id: string }>(
      `WITH RECURSIVE release AS (
         SELECT id FROM praxis.esco_releases WHERE is_active ORDER BY imported_at DESC LIMIT 1
       ), neighbourhood(concept_uri, depth) AS (
         SELECT esco_skill_uri, 0
         FROM praxis.skill
         WHERE id = ANY($1::text[]) AND esco_skill_uri IS NOT NULL
         UNION
         SELECT edge.next_uri, neighbourhood.depth + 1
         FROM neighbourhood
         CROSS JOIN LATERAL (
           (SELECT hierarchy.broader_uri AS next_uri
            FROM praxis.esco_skill_hierarchy hierarchy JOIN release ON release.id=hierarchy.release_id
            WHERE hierarchy.narrower_uri=neighbourhood.concept_uri
            ORDER BY hierarchy.broader_uri LIMIT 3)
           UNION
           (SELECT hierarchy.narrower_uri AS next_uri
            FROM praxis.esco_skill_hierarchy hierarchy JOIN release ON release.id=hierarchy.release_id
            WHERE hierarchy.broader_uri=neighbourhood.concept_uri
              AND (SELECT count(*) FROM praxis.esco_skill_hierarchy degree
                   WHERE degree.release_id=release.id AND degree.broader_uri=neighbourhood.concept_uri) <= 30
            ORDER BY hierarchy.narrower_uri LIMIT 20)
         ) edge
         WHERE neighbourhood.depth < 2
       )
       SELECT DISTINCT skill.id AS skill_id
       FROM neighbourhood
       JOIN praxis.skill AS skill
         ON skill.esco_skill_uri = neighbourhood.concept_uri
       WHERE neighbourhood.depth BETWEEN 1 AND 2 AND NOT skill.id = ANY($1::text[])`,
      [gapSkillIds],
    );
    return new Set(result.rows.map((row) => row.skill_id));
  }

  async items(
    targetOccupationId: string,
    learnerSegment = 'default',
    client?: PoolClient,
    options: { allowAllPublishedOffers?: boolean } = {},
  ): Promise<readonly CandidateItem[]> {
    const runner = client ?? this.pool;
    const tableName = options.allowAllPublishedOffers
      ? 'praxis.content_records'
      : 'praxis.reviewed_online_offers';

    const result = await runner.query<ItemRow>(
      `WITH eligible_catalog AS MATERIALIZED (
         SELECT * FROM ${tableName} WHERE deleted_at IS NULL AND status = 'published'
       ), catalog_frequencies AS (
         SELECT outcome.skill_id, count(DISTINCT outcome.content_record_id)::integer AS frequency
         FROM praxis.course_skill_outcome outcome
         JOIN eligible_catalog catalog ON catalog.id=outcome.content_record_id
         WHERE outcome.weight > 0 GROUP BY outcome.skill_id
       ), eligible_outcomes AS MATERIALIZED (
         SELECT outcome.item_id, source.learner_segment,
                catalog.product_family, catalog.sector_code,
                CASE outcome.completion_status
                  WHEN 'completed'
                    THEN 0.5 + coalesce(outcome.satisfaction, 3) / 10.0
                  WHEN 'dropped' THEN 0.0
                END::numeric AS success
         FROM praxis.learning_outcome AS outcome
         JOIN praxis.recommendation_impression AS source
           ON source.id = outcome.source_impression
         JOIN praxis.content_records AS catalog ON catalog.id = outcome.item_id
         WHERE outcome.completion_status IN ('completed', 'dropped')
           AND NOT source.is_example AND catalog.data_source <> 'fixture'
       ), item_totals AS (
         SELECT item_id, sum(success) AS successes, count(*)::integer AS trials
         FROM eligible_outcomes WHERE learner_segment = $1::text GROUP BY item_id
       ), family_totals AS (
         SELECT product_family, sector_code, sum(success) AS successes, count(*)::integer AS trials
         FROM eligible_outcomes GROUP BY product_family, sector_code
       ), sector_totals AS (
         SELECT sector_code, sum(success) AS successes, count(*)::integer AS trials
         FROM eligible_outcomes GROUP BY sector_code
       ), global_totals AS (
         SELECT coalesce(sum(success), 0) AS successes, count(*)::integer AS trials
         FROM eligible_outcomes
       )
       SELECT
         content.id, content.record_type, content.slug, content.title,
         content.summary, content.status, content.product_family,
         content.sector_code, content.featured, content.cold_start_rank,
         content.cold_start_source_version,
         content.price_mad::text, content.duration_hours::text,
         content.languages,
         coalesce(content.delivery_format, content.attributes->>'format') AS format,
         coalesce(content.next_start_date::text, content.attributes->>'nextSession') AS next_session,
         content.provider_id, provider.name AS provider_name,
         content.application_url, content.contact_route, content.delivery_format,
         content.is_online, content.location_city, content.location_country,
         content.price_status, content.admission_status, content.actionable_offer,
         content.data_source, content.next_end_date::text, content.required_weekly_hours::text,
         coalesce(prerequisites.items, '[]'::jsonb) AS prerequisites,
         content.updated_at, definition.target_occupation_id,
         definition.variant,
         (SELECT count(*)::text FROM praxis.learner_activity AS activity
          WHERE activity.content_record_id = content.id) AS popularity,
         coalesce(item_stats.successes, 0)::text AS item_successes,
         coalesce(item_stats.trials, 0) AS item_trials,
         coalesce(product_family_sector_stats.successes, 0)::text
           AS product_family_sector_successes,
         coalesce(product_family_sector_stats.trials, 0) AS product_family_sector_trials,
         coalesce(sector_stats.successes, 0)::text AS sector_successes,
         coalesce(sector_stats.trials, 0) AS sector_trials,
         global_stats.successes::text AS global_successes,
         global_stats.trials AS global_trials,
         coalesce(outcomes.items, '[]'::jsonb) AS outcomes,
         coalesce(steps.items, '[]'::jsonb) AS steps
       FROM eligible_catalog AS content
       LEFT JOIN praxis.provider AS provider ON provider.id = content.provider_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('skillId',r.skill_id,'label',s.label_fr,'minimumLevel',r.minimum_level) ORDER BY r.skill_id) AS items
         FROM praxis.course_prerequisite r JOIN praxis.skill s ON s.id=r.skill_id
         WHERE r.content_record_id=content.id
       ) prerequisites ON true
       LEFT JOIN praxis.pathway_definition AS definition
         ON definition.content_record_id = content.id
       LEFT JOIN item_totals AS item_stats ON item_stats.item_id = content.id
       LEFT JOIN family_totals AS product_family_sector_stats
         ON product_family_sector_stats.product_family = content.product_family
         AND product_family_sector_stats.sector_code = content.sector_code
       LEFT JOIN sector_totals AS sector_stats ON sector_stats.sector_code = content.sector_code
       CROSS JOIN global_totals AS global_stats
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'skillId', edge.skill_id,
           'entryLevel', edge.entry_level,
           'outcomeLevel', edge.outcome_level,
           'weight', edge.weight,
           'catalogFrequency', coalesce((SELECT frequency FROM catalog_frequencies WHERE skill_id=edge.skill_id), 1)
         ) ORDER BY edge.skill_id) AS items
         FROM (
           SELECT outcome.skill_id, outcome.entry_level,
                  outcome.outcome_level, outcome.weight
           FROM praxis.course_skill_outcome AS outcome
           WHERE outcome.content_record_id = content.id
         ) AS edge
       ) AS outcomes ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'position', step.position,
           'type', step.step_type,
           'label', step.label
         ) ORDER BY step.position) AS items
         FROM praxis.navigator_pathway_steps AS step
         WHERE step.content_record_id = content.id
           AND step.archived_at IS NULL
       ) AS steps ON true
       WHERE content.deleted_at IS NULL
         AND content.status = 'published'
       ORDER BY content.updated_at DESC, content.id`,
      [learnerSegment],
    );

    return result.rows.map((row) => ({
      id: row.id,
      recordType: row.record_type,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      status: row.status,
      productFamily: row.product_family,
      sectorCode: row.sector_code,
      featured: row.featured,
      coldStartRank: row.cold_start_rank,
      coldStartSourceVersion: row.cold_start_source_version,
      priceMad: row.price_mad === null ? null : Number(row.price_mad),
      durationHours:
        row.duration_hours === null ? null : Number(row.duration_hours),
      languages: row.languages ?? [],
      format: row.format,
      nextSessionAt:
        row.next_session && Number.isFinite(Date.parse(row.next_session))
          ? new Date(row.next_session)
          : null,
      nextEndAt: row.next_end_date
        ? new Date(row.next_end_date + 'T23:59:59.999Z')
        : null,
      requiredWeeklyHours:
        row.required_weekly_hours === null
          ? null
          : Number(row.required_weekly_hours),
      prerequisites: row.prerequisites ?? [],
      providerId: row.provider_id,
      providerName: row.provider_name,
      applicationUrl: row.application_url,
      contactRoute: row.contact_route,
      deliveryFormat: row.delivery_format,
      isOnline: row.is_online,
      locationCity: row.location_city,
      locationCountry: row.location_country,
      priceStatus: row.price_status,
      admissionStatus: row.admission_status,
      actionableOffer: row.actionable_offer,
      actionableMissing: actionableMissing(row),
      dataSource: row.data_source,
      updatedAt: row.updated_at,
      targetOccupationId: row.target_occupation_id,
      variant: row.variant,
      popularity: Number(row.popularity ?? 0),
      outcomePrior: 0.5,
      outcomePriorEvidence: {
        itemSegment: {
          successes: Number(row.item_successes),
          trials: row.item_trials,
        },
        productFamilySector: {
          successes: Number(row.product_family_sector_successes),
          trials: row.product_family_sector_trials,
        },
        sector: {
          successes: Number(row.sector_successes),
          trials: row.sector_trials,
        },
        global: {
          successes: Number(row.global_successes),
          trials: row.global_trials,
        },
      },
      outcomes: row.outcomes ?? [],
      steps: row.steps ?? [],
    }));
  }

  async deriveTargetProfile(
    occupationId: string,
    locale: 'fr' | 'en' = 'fr',
  ): Promise<TargetProfile> {
    // 1. Check authored profile targets first (from pilot catalog)
    const authored = await this.pool.query<{
      skill_id: string;
      label: string;
      target_level: number;
      importance: number;
      occupation_label: string;
      target_level_basis: string;
    }>(
      `SELECT
         target.skill_id,
         CASE WHEN $2='en' THEN coalesce(s.label_en,target.label,s.label_fr)
              ELSE coalesce(target.label,s.label_fr) END AS label,
         target.target_level,
         target.importance,
         CASE WHEN $2='en' THEN coalesce(occupation.label_en,occupation.label_fr)
              ELSE occupation.label_fr END AS occupation_label,
         target.target_level_basis
       FROM praxis.navigator_role_skill_targets AS target
       JOIN praxis.occupation AS occupation ON occupation.id = target.role_id
       LEFT JOIN praxis.skill AS s ON s.id = target.skill_id
       WHERE target.role_id = $1
         AND target.archived_at IS NULL
         AND target.profile_source = 'authored'
       ORDER BY target.importance DESC, target.label`,
      [occupationId, locale],
    );

    if (authored.rows.length > 0) {
      return {
        occupationId,
        source: 'authored',
        label: authored.rows[0].occupation_label,
        skills: authored.rows.map((row) => ({
          skillId: row.skill_id,
          label: row.label,
          targetLevel: row.target_level,
          importance: row.importance,
          reviewed: true,
          targetLevelBasis: row.target_level_basis,
        })),
      };
    }

    // 2. Fall back to ESCO essential skills
    const result = await this.pool.query<{
      skill_id: string;
      label: string;
      target_level: number;
      importance: number;
      occupation_label: string;
      target_level_basis: string;
      reviewed: boolean;
    }>(
      `WITH release AS (
         SELECT id FROM praxis.esco_releases WHERE is_active
         ORDER BY CASE WHEN language=$2 THEN 0 WHEN language='en' THEN 1 ELSE 2 END, imported_at DESC LIMIT 1
       ), origin AS (
         SELECT concept_uri FROM praxis.esco_occupations
         WHERE 'occupation_esco_' || replace(concept_id::text,'-','') = $1 OR concept_uri=$1
         UNION
         SELECT esco_occupation_uri FROM praxis.occupation WHERE id = $1
       )
       SELECT
         coalesce(s.id, 'skill_esco_' || replace(es.concept_id::text, '-', '')) AS skill_id,
         coalesce(sv.preferred_label, s.label_fr) AS label,
         coalesce(t.target_level, 3) AS target_level,
         coalesce(t.importance, 3) AS importance,
         coalesce(ov.preferred_label, po.label_fr) AS occupation_label,
         coalesce(t.target_level_basis, 'esco_relation_default') AS target_level_basis,
         coalesce(t.profile_source = 'authored', false) AS reviewed
       FROM praxis.esco_occupation_skill_relations r
       JOIN release ON release.id = r.release_id
       JOIN origin ON origin.concept_uri = r.occupation_uri
       JOIN praxis.esco_skills es ON es.concept_uri = r.skill_uri
       JOIN praxis.esco_skill_versions sv ON sv.skill_uri = r.skill_uri AND sv.release_id = release.id
       JOIN praxis.esco_occupation_versions ov ON ov.occupation_uri = r.occupation_uri AND ov.release_id = release.id
       LEFT JOIN praxis.skill s ON s.esco_skill_uri = r.skill_uri
       LEFT JOIN praxis.occupation po ON po.esco_occupation_uri = r.occupation_uri
       LEFT JOIN praxis.navigator_role_skill_targets t ON t.role_id = po.id AND t.skill_id = s.id AND t.archived_at IS NULL
       WHERE r.relationship_type = 'essential'
       ORDER BY importance DESC, label, skill_id`,
      [occupationId, locale],
    );

    if (result.rows.length === 0) {
      throw new Error(`Occupation not found or has no essential skills: ${occupationId}`);
    }

    return {
      occupationId,
      source: 'derived_from_esco',
      label: result.rows[0]?.occupation_label ?? occupationId,
      skills: result.rows.map((row) => ({
        skillId: row.skill_id,
        label: row.label,
        targetLevel: row.target_level,
        importance: row.importance,
        reviewed: row.reviewed,
        targetLevelBasis: row.target_level_basis,
      })),
    };
  }

  async recommend(
    learnerState: LearnerState,
    targetOccupationId: string,
    options: RecommendationOptions = {},
  ): Promise<RecommendationResult> {
    validateLearner(learnerState);
    if (!targetOccupationId.trim()) throw new TypeError('Target occupation is required');
    if (learnerState.targetOccupationId && learnerState.targetOccupationId !== targetOccupationId)
      throw new RangeError('Learner target profile does not match targetOccupationId');
    const now = options.now ?? new Date();
    const weightRow = await this.activeWeights();
    const weights = weightRow.weights;
    validateWeights(weights);
    const rawItems = await this.items(
      targetOccupationId,
      learnerState.segment ?? 'default',
      undefined,
      options,
    );

    const exclusions: {itemId: string; issues: readonly string[]}[] = [];
    const eligibleItems = rawItems.filter((item) => {
      const issues = [...eligibilityIssues(item, learnerState, now),
        ...(item.status !== 'published' ? ['unpublished'] : []),
        ...(!item.actionableOffer ? ['offer_incomplete'] : [])];
      if (issues.length) exclusions.push({itemId:item.id,issues});
      return issues.length === 0;
    });
    const items = eligibleItems.map((item) => applyOutcomePriorEstimate(item, weights.outcome_prior_estimator));
    const gapSkillIds = learnerState.skills
      .filter((skill) => skill.gap > 0 && skill.importance > 0)
      .map((skill) => skill.skillId);

    const neighbourSkillIds = gapSkillIds.length ? await this.neighbourSkillIds(gapSkillIds) : new Set<string>();
    const direct = (item: CandidateItem) => advancesGoal(item, learnerState);
    const related = (item: CandidateItem) => item.outcomes.some((outcome) => outcome.weight > 0 && neighbourSkillIds.has(outcome.skillId));

    const pools = {
      gapItems: items.filter(direct),
      targetPathwayItems: items.filter(
        (item) => gapSkillIds.length > 0 && item.targetOccupationId === targetOccupationId,
      ),
      neighbourhoodItems: items.filter(related),
      popularityItems: items.filter((item) => direct(item) || related(item))
        .sort((left, right) => right.popularity - left.popularity)
        .slice(0, 20),
    };

    const computations = new Map<string, ScoredRecommendation>();
    for (const item of new Map(Object.values(pools).flat().map((item) => [item.id,item])).values()) {
      const vector = features(item, learnerState, now);
      const computation = score(vector, weights);
      const itemReasons = direct(item) ? reasons(item, learnerState) : [{kind:'related_skills' as const,skillIds:item.outcomes.filter((o)=>neighbourSkillIds.has(o.skillId)).map((o)=>o.skillId)}];
      computations.set(item.id, {
        item,
        features: vector,
        score: computation.value,
        reasons: itemReasons,
        inputsHash: computation.provenance.inputsHash,
        algorithmVersion: computation.provenance.version,
      });
    }
    // Evaluate the eventual score before truncating. Direct progress has a separate relevance tier.
    const generated = candidates(pools, 200, learnerState.constraints.deadline,
      (item) => (direct(item) ? 2 : 0) + computations.get(item.id)!.score);
    const scored = generated.items.map((item) => computations.get(item.id)!);

    const deterministic = rerank(scored.filter((result)=>direct(result.item)), learnerState.learnerId).slice(0, 10);
    const explorationProbability = options.explorationProbability ?? RECOMMENDATION_EXPLORATION_PROBABILITY;
    const served = exploreTopTen(
      deterministic,
      options.random ?? (() => randomInt(1_000_000) / 1_000_000),
      explorationProbability,
    );
    const learningPlans = planLearningPaths(rawItems, learnerState, now);
    const relatedRecommendations = rerank(scored.filter((result)=>!direct(result.item)),learnerState.learnerId).slice(0,5);
    const inputSnapshot = JSON.parse(JSON.stringify({learnerState,targetOccupationId,weightsVersion:weightRow.version,weights,algorithmVersion:ALGORITHM_VERSIONS.recommendationRanker,
      scoringAt:now.toISOString(),reviewBypassed:options.allowAllPublishedOffers === true,items:rawItems,
      recommendations:served.items,relatedRecommendations,learningPlans,
      assessmentHandoff:null,evidenceProfile:null,
      isExploration:served.isExploration,explorationProbability,exclusions,droppedItemIds:generated.dropped}));
    return {
      requestId: randomUUID(),
      learnerId:learnerState.learnerId,
      targetOccupationId,
      targetStateSource:'caller_supplied',
      status: learnerState.skills.length === 0 ? 'insufficient_profile'
        : gapSkillIds.length === 0 ? 'goal_satisfied'
        : served.items.length ? 'ok'
        : learningPlans.plans.length ? 'plan_available' : 'no_eligible_courses',
      missingSkillIds:[],
      assessmentHandoff:null,evidenceProfile:null,
      recommendations: served.items,
      relatedRecommendations,
      learningPlans,
      weightsVersion: weightRow.version,
      algorithmVersion:ALGORITHM_VERSIONS.recommendationRanker,
      candidateCount: generated.items.length,
      zeroCandidates: served.items.length === 0,
      isExploration:served.isExploration,
      explorationProbability,
      scoringAt:now.toISOString(),
      reviewBypassed:options.allowAllPublishedOffers === true,
      exclusions,
      droppedItemIds:generated.dropped,
      inputsHash:hashComputationInputs(inputSnapshot),
      inputSnapshot,
    };
  }

  /** Constructs complete target gaps without treating absent evidence as level zero. */
  async recommendForTarget(learner: LearnerState, occupationId: string, options: RecommendationOptions = {}, locale: 'fr' | 'en' = 'fr'): Promise<RecommendationResult> {
    validateLearner(learner);
    const target = await this.deriveTargetProfile(occupationId,locale);
    return this.recommendTarget(learner,target,options,locale);
  }

  /** Caller supplies constraints and identity; levels come exclusively from persisted evidence. */
  async recommendFromEvidence(context: LearnerContext, occupationId: string, options: RecommendationOptions = {}, locale: 'fr' | 'en' = 'fr'): Promise<RecommendationResult> {
    const now = options.now ?? new Date();
    const profile = buildEvidenceProfile(context,await this.skillEvidence(context.learnerId),
      {now,maxAgeDays:options.evidenceMaxAgeDays});
    const target = await this.deriveTargetProfile(occupationId,locale);
    const result = await this.recommendTarget(profile.learnerState,target,{...options,now},locale,profile.conflictingSkillIds);
    const inputSnapshot = JSON.parse(JSON.stringify({...result.inputSnapshot,evidenceProfile:profile}));
    return {...result,evidenceProfile:profile,inputSnapshot,inputsHash:hashComputationInputs(inputSnapshot)};
  }

  private async recommendTarget(learner: LearnerState, target: TargetProfile, options: RecommendationOptions, locale: string,
    conflicts: readonly string[] = []): Promise<RecommendationResult> {
    const occupationId = target.occupationId;
    if (learner.targetOccupationId && learner.targetOccupationId !== occupationId) throw new RangeError('Target profile mismatch');
    const now = options.now ?? new Date();
    const held = knownLevels(learner);
    const originalSkills = new Map(learner.skills.map((skill)=>[skill.skillId,skill]));
    const missingSkillIds = target.skills.filter((skill)=>!held.has(skill.skillId)).map((skill)=>skill.skillId);
    const targeted: LearnerState = {...learner,targetOccupationId:occupationId,prerequisiteLevels:Object.fromEntries(held),
      skills: missingSkillIds.length ? [] : target.skills.map((skill)=>({skillId:skill.skillId,
        declaredLevel:held.get(skill.skillId)!,targetLevel:skill.targetLevel,importance:skill.importance,
        gap:Math.max(0,skill.targetLevel-held.get(skill.skillId)!),confidence:originalSkills.get(skill.skillId)?.confidence ?? 'very_low'}))};
    const result = await this.recommend(targeted,occupationId,{...options,now});
    // Reuse the exact catalog snapshot scored above rather than performing a second catalog read.
    const catalog = (result.inputSnapshot.items as CandidateItem[]).map((item) => ({...item,
      updatedAt:new Date(item.updatedAt),nextSessionAt:item.nextSessionAt ? new Date(item.nextSessionAt) : null,
      nextEndAt:item.nextEndAt ? new Date(item.nextEndAt) : null}));
    const pending = createAssessmentHandoff(target,learner,catalog,[],conflicts,now);
    const banks = await this.assessmentAvailability(pending.requests.map((request)=>request.skillId),locale,now);
    const assessmentHandoff = createAssessmentHandoff(target,learner,catalog,banks,conflicts,now);
    const inputSnapshot = JSON.parse(JSON.stringify({...result.inputSnapshot,targetProfile:target,missingSkillIds,
      targetStateSource:'derived_target',assessmentHandoff}));
    return {...result,targetStateSource:'derived_target',missingSkillIds,assessmentHandoff,inputSnapshot,inputsHash:hashComputationInputs(inputSnapshot)};
  }

  async plan(learner: LearnerState, occupationId: string, options: RecommendationOptions = {}) {
    validateLearner(learner);
    if (learner.targetOccupationId && learner.targetOccupationId !== occupationId) throw new RangeError('Target profile mismatch');
    return planLearningPaths(await this.items(occupationId,learner.segment ?? 'default',undefined,options),learner,options.now ?? new Date());
  }

  /** Opt-in write boundary: the caller records the result actually displayed, not every preview. */
  async recordImpression(result: RecommendationResult, surface = 'standalone', isExample = false): Promise<string> {
    if (!/^[a-z][a-z0-9_]{1,79}$/.test(surface)) throw new TypeError('Invalid impression surface');
    if (hashComputationInputs(result.inputSnapshot) !== result.inputsHash) throw new RangeError('Input snapshot hash mismatch');
    const snapshot = result.inputSnapshot;
    const served = JSON.parse(JSON.stringify(result.recommendations));
    if (hashComputationInputs(served) !== hashComputationInputs(snapshot.recommendations) ||
        hashComputationInputs(JSON.parse(JSON.stringify(result.assessmentHandoff))) !== hashComputationInputs(snapshot.assessmentHandoff) ||
        hashComputationInputs(JSON.parse(JSON.stringify(result.evidenceProfile))) !== hashComputationInputs(snapshot.evidenceProfile) ||
        hashComputationInputs(JSON.parse(JSON.stringify(result.relatedRecommendations))) !== hashComputationInputs(snapshot.relatedRecommendations) ||
        snapshot.targetOccupationId !== result.targetOccupationId ||
        (snapshot.learnerState as LearnerState).learnerId !== result.learnerId ||
        snapshot.weightsVersion !== result.weightsVersion || snapshot.algorithmVersion !== result.algorithmVersion ||
        snapshot.scoringAt !== result.scoringAt || snapshot.isExploration !== result.isExploration ||
        snapshot.explorationProbability !== result.explorationProbability ||
        hashComputationInputs(JSON.parse(JSON.stringify(result.learningPlans))) !== hashComputationInputs(snapshot.learningPlans))
      throw new RangeError('Served result does not match its replay snapshot');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query<{id:string}>(`SELECT id FROM praxis.occupation
        WHERE id=$1 OR esco_occupation_uri=$1 OR esco_occupation_uri IN
          (SELECT concept_uri FROM praxis.esco_occupations WHERE 'occupation_esco_' || replace(concept_id::text,'-','')=$1)
        ORDER BY CASE WHEN id=$1 THEN 0 ELSE 1 END LIMIT 1`,[result.targetOccupationId]);
      if (!target.rows[0]) throw new Error('Target occupation must exist in praxis.occupation before recording an impression');
      await client.query(`INSERT INTO praxis.recommendation_impression
        (id,learner_id,surface,weights_version,candidate_count,inputs_hash,target_occupation_id,learner_segment,
         is_exploration,exploration_probability,served_at,learning_plans,is_example,input_snapshot,algorithm_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,$15)`,
        [result.requestId,result.learnerId,surface,result.weightsVersion,result.candidateCount,result.inputsHash,target.rows[0].id,
         (result.inputSnapshot.learnerState as LearnerState).segment ?? 'default',result.isExploration,result.explorationProbability,
         result.scoringAt,JSON.stringify(result.learningPlans),isExample,JSON.stringify(result.inputSnapshot),result.algorithmVersion]);
      for (const [index,recommendation] of result.recommendations.entries()) {
        const item = recommendation.item;
        await client.query(`INSERT INTO praxis.recommendation_impression_item
          (impression_id,item_type,item_id,rank,score,features,reasons,outcome_prior_source,outcome_prior_trial_count,
           outcome_prior_algorithm_version,outcome_prior_inputs_hash)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`,
          [result.requestId,item.recordType,item.id,index+1,recommendation.score,JSON.stringify(recommendation.features),
           JSON.stringify(recommendation.reasons),item.outcomePriorSource ?? 'legacy_unknown',item.outcomePriorTrialCount ?? null,
           item.outcomePriorAlgorithmVersion ?? null,item.outcomePriorInputsHash ?? null]);
      }
      await client.query('COMMIT');
      return result.requestId;
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
