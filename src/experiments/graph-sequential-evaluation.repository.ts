import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  validateGraphSequentialExperimentBatch,
  validateRecommenderExperimentReview,
  type GraphSequentialExperimentBatch,
  type ExperimentOutcome,
  type RecommenderExperimentReview,
} from './graph-sequential-evaluation.js';

export type RecordedRecommenderExperiment = Readonly<{ runId: string;replayed: boolean }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Persists aggregate experiment evidence only; learner-level cases stay in the controlled evaluation environment. */
export class GraphSequentialExperimentRepository {
  constructor(private readonly pool: Pool) {}

  /** Reads the governed real-outcome view; fixture/example rows are excluded by the database. */
  async loadRealOutcomeCohort(evaluationEndsAt: Date): Promise<readonly ExperimentOutcome[]> {
    if (!(evaluationEndsAt instanceof Date) || !Number.isFinite(evaluationEndsAt.getTime()))
      throw new TypeError('evaluationEndsAt must be a valid Date');
    const result = await this.pool.query<{
      event_id: string;learner_id: string;item_id: string;resolved_at: Date;
      completion_status: 'completed' | 'dropped';assessed_skill_gain: boolean | null;
    }>(
      `SELECT event_id,learner_id,item_id,resolved_at,completion_status,assessed_skill_gain
       FROM praxis.recommender_experiment_real_outcome_source
       WHERE resolved_at <= $1 ORDER BY event_id`, [evaluationEndsAt],
    );
    return result.rows.map(row => ({ eventId: row.event_id,learnerId: row.learner_id,itemId: row.item_id,
      resolvedAt: new Date(row.resolved_at),completionStatus: row.completion_status,
      assessedSkillGain: row.assessed_skill_gain,sourceClass: 'real' }));
  }

  async recordBatch(generatedByPrincipal: string, batch: GraphSequentialExperimentBatch): Promise<RecordedRecommenderExperiment> {
    const principal = generatedByPrincipal?.trim();
    if (!principal || principal.length > 300) throw new RangeError('generatedByPrincipal must contain 1-300 characters');
    validateGraphSequentialExperimentBatch(batch);
    const snapshot = batch.inputSnapshot as unknown as { policy: Record<string, unknown>;models: readonly Record<string, unknown>[] };
    const { inputSnapshot: _privateInputSnapshot, ...aggregateResult } = batch;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string;result_hash: string;generated_by_principal: string }>(
        `SELECT id,result_hash,generated_by_principal FROM praxis.recommender_experiment_run
         WHERE inputs_hash=$1 FOR UPDATE`, [batch.inputsHash],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.result_hash !== batch.resultHash || row.generated_by_principal !== principal)
          throw new RangeError('Experiment inputs hash is already bound to a different result or principal');
        await client.query('COMMIT');return { runId: row.id,replayed: true };
      }
      const runId = randomUUID();
      await client.query(
        `INSERT INTO praxis.recommender_experiment_run
         (id,status,algorithm_version,policy_version,generated_by_principal,inputs_hash,result_hash,
          dataset_manifest,policy_snapshot,model_manifests,aggregate_result,computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12)`,
        [runId,batch.status,batch.algorithmVersion,batch.policyVersion,principal,batch.inputsHash,batch.resultHash,
         JSON.stringify(batch.datasetManifest),JSON.stringify(snapshot.policy),JSON.stringify(snapshot.models),
         JSON.stringify(aggregateResult),batch.computedAt],
      );
      for (const gate of batch.readinessGates) await client.query(
        `INSERT INTO praxis.recommender_experiment_readiness_gate
         (run_id,gate,actual,required,ready) VALUES ($1,$2,$3,$4,$5)`,
        [runId,gate.gate,gate.actual,gate.required,gate.ready],
      );
      for (const evaluation of batch.evaluations) await client.query(
        `INSERT INTO praxis.recommender_experiment_model_result
         (run_id,model_id,model_family,case_count,metrics,segment_metrics)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [runId,evaluation.modelId,evaluation.family,evaluation.caseCount,JSON.stringify(evaluation.metrics),
         JSON.stringify(evaluation.segmentMetrics)],
      );
      for (const comparison of batch.comparisons) await client.query(
        `INSERT INTO praxis.recommender_experiment_comparison
         (run_id,model_id,baseline_model_id,primary_metric,primary_k,baseline_value,challenger_value,lift,
          confidence_level,confidence_lower,confidence_upper,catalog_coverage_delta,worst_segment_delta,
          assessed_gain_ndcg_delta,decision,reasons)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::text[])`,
        [runId,comparison.modelId,comparison.baselineModelId,comparison.primaryMetric,comparison.primaryK,
         comparison.baselineValue,comparison.challengerValue,comparison.lift,comparison.confidenceInterval.level,
         comparison.confidenceInterval.lower,comparison.confidenceInterval.upper,comparison.catalogCoverageDelta,
         comparison.worstSegmentDelta,comparison.assessedGainNdcgDelta,comparison.decision,comparison.reasons],
      );
      await client.query('COMMIT');return { runId,replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');throw error;
    } finally {
      client.release();
    }
  }

  /** Human approval can authorize only a separately controlled prospective trial, never production serving. */
  async recordReview(runId: string, review: RecommenderExperimentReview): Promise<string> {
    if (!UUID.test(runId)) throw new TypeError('runId must be a UUID');
    validateRecommenderExperimentReview(review);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ generated_by_principal: string;comparison_decision: string | null }>(
        `SELECT run.generated_by_principal,comparison.decision AS comparison_decision
         FROM praxis.recommender_experiment_run run
         JOIN praxis.recommender_experiment_model_result model ON model.run_id=run.id AND model.model_id=$2
         LEFT JOIN praxis.recommender_experiment_comparison comparison
           ON comparison.run_id=run.id AND comparison.model_id=model.model_id
         WHERE run.id=$1 FOR UPDATE OF run`, [runId,review.modelId],
      );
      const row = result.rows[0];
      if (!row) throw new RangeError('Experiment run or model does not exist');
      if (row.generated_by_principal === review.reviewerPrincipal.trim())
        throw new RangeError('Experiment review must be independent of the generation principal');
      if (review.decision === 'approve_prospective_trial' && row.comparison_decision !== 'eligible_for_prospective_trial')
        throw new RangeError('Only an offline-eligible challenger may be approved for a prospective trial');
      const id = randomUUID();
      await client.query(
        `INSERT INTO praxis.recommender_experiment_review
         (id,run_id,model_id,reviewer_principal,decision,rationale,review_checklist,reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [id,runId,review.modelId,review.reviewerPrincipal.trim(),review.decision,review.rationale,
         JSON.stringify(review.checklist),review.reviewedAt],
      );
      await client.query('COMMIT');return id;
    } catch (error) {
      await client.query('ROLLBACK');throw error;
    } finally {
      client.release();
    }
  }
}
