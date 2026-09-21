import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  validateExpertItemReview,
  validateItemDraftBatch,
  type ExpertItemReview,
  type ItemDraftBatch,
} from './item-drafting.js';

export type RecordedItemDraftBatch = Readonly<{
  generationRunId: string;
  replayed: boolean;
  itemIds: readonly string[];
  rejectedCandidateCount: number;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Persists model provenance, rejected candidates, and accepted uncalibrated drafts atomically. */
export class AssessmentItemAuthoringRepository {
  constructor(private readonly pool: Pool) {}

  async recordDraftBatch(requestedByLearnerId: string, batch: ItemDraftBatch): Promise<RecordedItemDraftBatch> {
    if (!UUID.test(requestedByLearnerId)) throw new TypeError('requestedByLearnerId must be a UUID');
    validateItemDraftBatch(batch);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; result_hash: string; requested_by_learner_id: string }>(
        'SELECT id,result_hash,requested_by_learner_id FROM praxis.assessment_item_generation_run WHERE request_id=$1 FOR UPDATE', [batch.requestId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].result_hash !== batch.resultHash ||
            existing.rows[0].requested_by_learner_id !== requestedByLearnerId)
          throw new RangeError('Generation request ID is already bound to different content');
        const items = await client.query<{ item_id: string }>(
          `SELECT item_id FROM praxis.assessment_item_generation_candidate
           WHERE generation_run_id=$1 AND item_id IS NOT NULL ORDER BY candidate_index`, [existing.rows[0].id],
        );
        await client.query('COMMIT');
        return { generationRunId: existing.rows[0].id,replayed: true,itemIds: items.rows.map(row => row.item_id),
          rejectedCandidateCount: batch.candidates.filter(candidate => candidate.status === 'rejected_validation').length };
      }
      const blueprint = await client.query<{ skill_id: string; language: string; status: string }>(
        'SELECT skill_id,language,status FROM praxis.assessment_blueprint WHERE id=$1 FOR UPDATE',
        [batch.inputSnapshot.blueprintId],
      );
      const row = blueprint.rows[0];
      if (!row || row.status === 'retired' || row.skill_id !== batch.inputSnapshot.skillId || row.language !== batch.inputSnapshot.language)
        throw new RangeError('Generation request does not match an active assessment blueprint');
      const requester = await client.query<{ id: string }>(
        'SELECT id FROM praxis.learner WHERE id=$1 AND deleted_at IS NULL', [requestedByLearnerId],
      );
      if (!requester.rows[0]) throw new RangeError('Draft requester does not exist');
      const generationRunId = randomUUID();
      await client.query(
        `INSERT INTO praxis.assessment_item_generation_run
         (id,request_id,request_digest,blueprint_id,requested_by_learner_id,provider,model,model_parameters,
          prompt_template_version,source_manifest,algorithm_version,input_snapshot,result_hash,completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12::jsonb,$13,$14)`,
        [generationRunId,batch.requestId,batch.requestDigest,batch.inputSnapshot.blueprintId,requestedByLearnerId,
         batch.provider,batch.model,JSON.stringify(batch.modelParameters),batch.inputSnapshot.promptTemplateVersion,
         JSON.stringify(batch.inputSnapshot.sourceManifest),batch.algorithmVersion,JSON.stringify(batch.inputSnapshot),
         batch.resultHash,batch.completedAt],
      );
      const itemIds: string[] = [];
      for (const candidate of batch.candidates) {
        let itemId: string | null = null;
        if (candidate.draft) {
          itemId = randomUUID();itemIds.push(itemId);
          await client.query(
            `INSERT INTO praxis.assessment_item
             (id,skill_id,target_level,sub_skill_id,item_payload,item_version,status,language,blueprint_id,
              calibration_status,content_origin,generation_run_id,generation_candidate_index)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,'draft',$7,$8,'uncalibrated','ai_assisted',$9,$10)`,
            [itemId,batch.inputSnapshot.skillId,candidate.draft.targetLevel,candidate.draft.subSkillId,
             JSON.stringify(candidate.draft.itemPayload),`ai-draft-${candidate.draft.draftHash.slice(0, 16)}`,
             candidate.draft.language,batch.inputSnapshot.blueprintId,generationRunId,candidate.candidateIndex],
          );
        }
        await client.query(
          `INSERT INTO praxis.assessment_item_generation_candidate
           (generation_run_id,candidate_index,item_id,status,candidate_snapshot,validation_issues,draft_hash,review_material)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb)`,
          [generationRunId,candidate.candidateIndex,itemId,candidate.status,JSON.stringify(candidate.candidateSnapshot),
           JSON.stringify(candidate.issues),candidate.draft?.draftHash ?? null,
           JSON.stringify(candidate.draft?.reviewMaterial ?? {})],
        );
      }
      await client.query('COMMIT');
      return { generationRunId,replayed: false,itemIds,
        rejectedCandidateCount: batch.candidates.length - itemIds.length };
    } catch (error) {
      await client.query('ROLLBACK');throw error;
    } finally {
      client.release();
    }
  }

  /** Records human judgment only; promotion remains a separate, database-gated action. */
  async recordExpertReview(itemId: string, review: ExpertItemReview): Promise<string> {
    if (!UUID.test(itemId)) throw new TypeError('itemId must be a UUID');
    validateExpertItemReview(review);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const item = await client.query<{ status: string; content_origin: string; requested_by_learner_id: string | null }>(
        `SELECT item.status,item.content_origin,run.requested_by_learner_id
         FROM praxis.assessment_item item
         LEFT JOIN praxis.assessment_item_generation_run run ON run.id=item.generation_run_id
         WHERE item.id=$1 FOR UPDATE OF item`, [itemId],
      );
      const row = item.rows[0];
      if (!row || row.status !== 'draft') throw new RangeError('Only an existing draft item can receive this expert review');
      if (row.content_origin === 'ai_assisted' && row.requested_by_learner_id === review.reviewerLearnerId)
        throw new RangeError('AI-assisted drafts require an independent expert reviewer');
      const reviewId = randomUUID();
      await client.query(
        `INSERT INTO praxis.assessment_item_review
         (id,item_id,reviewer_learner_id,decision,rationale,reviewed_at,reviewer_role,expert_attestation,review_checklist)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb)`,
        [reviewId,itemId,review.reviewerLearnerId,review.decision,JSON.stringify({ text: review.rationale }),review.reviewedAt,
         review.reviewerRole,review.expertAttestation,JSON.stringify(review.checklist)],
      );
      await client.query('COMMIT');return reviewId;
    } catch (error) {
      await client.query('ROLLBACK');throw error;
    } finally {
      client.release();
    }
  }
}
