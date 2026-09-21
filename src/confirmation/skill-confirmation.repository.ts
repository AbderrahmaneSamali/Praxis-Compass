import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { validateLearnerSkillConfirmationResult } from './learner-skill-confirmation.js';
import type { LearnerSkillConfirmationResult } from './learner-skill-confirmation.js';

export type RecordedSkillConfirmation = Readonly<{
  requestId: string;
  replayed: boolean;
  evidenceIds: readonly string[];
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Persists a server-created confirmation result and evidence in one transaction. */
export class SkillConfirmationRepository {
  constructor(private readonly pool: Pool) {}

  /** Lets the host suppress proposals that already received any explicit learner action. */
  async decidedProposalIds(learnerId: string): Promise<ReadonlySet<string>> {
    if (!learnerId?.trim()) throw new TypeError('learnerId is required');
    const result = await this.pool.query<{ proposal_id: string }>(
      `SELECT DISTINCT proposal_id
       FROM praxis.cv_skill_confirmation_request request
       JOIN praxis.cv_skill_confirmation_decision decision ON decision.request_id=request.request_id
       CROSS JOIN LATERAL unnest(decision.source_proposal_ids) proposal_id
       WHERE request.learner_id=$1 ORDER BY proposal_id`, [learnerId],
    );
    return new Set(result.rows.map(row => row.proposal_id));
  }

  private async resolvedSkillIds(client: PoolClient, catalogIds: readonly string[]): Promise<Map<string, string>> {
    if (!catalogIds.length) return new Map();
    const result = await client.query<{ id: string; esco_skill_uri: string | null }>(
      `SELECT id,esco_skill_uri FROM praxis.skill
       WHERE id=ANY($1::text[]) OR esco_skill_uri=ANY($1::text[])
       ORDER BY id`, [catalogIds],
    );
    const resolved = new Map<string, string>();
    for (const catalogId of catalogIds) {
      const matches = result.rows.filter(row => row.id === catalogId || row.esco_skill_uri === catalogId);
      if (matches.length !== 1) throw new RangeError(`Confirmed catalog skill must map to exactly one local skill: ${catalogId}`);
      resolved.set(catalogId, matches[0]!.id);
    }
    return resolved;
  }

  async record(result: LearnerSkillConfirmationResult): Promise<RecordedSkillConfirmation> {
    validateLearnerSkillConfirmationResult(result);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [result.learnerId]);
      const existing = await client.query<{ learner_id: string; result_hash: string }>(
        `SELECT learner_id,result_hash FROM praxis.cv_skill_confirmation_request WHERE request_id=$1`, [result.requestId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].learner_id !== result.learnerId || existing.rows[0].result_hash !== result.resultHash)
          throw new RangeError('Confirmation request ID is already bound to different content');
        const recorded = await client.query<{ evidence_id: string }>(
          `SELECT evidence_id FROM praxis.cv_skill_confirmation_decision
           WHERE request_id=$1 AND evidence_id IS NOT NULL ORDER BY card_id`, [result.requestId],
        );
        await client.query('COMMIT');
        return { requestId: result.requestId, replayed: true, evidenceIds: recorded.rows.map(row => row.evidence_id) };
      }
      const learner = await client.query<{ id: string }>(
        `SELECT id FROM praxis.learner WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [result.learnerId],
      );
      if (!learner.rows[0]) throw new RangeError('Authenticated learner does not exist');
      const selectedCatalogIds = [...new Set(result.decisions.flatMap(decision => decision.selectedSkillId ? [decision.selectedSkillId] : []))];
      const resolved = await this.resolvedSkillIds(client, selectedCatalogIds);
      await client.query(
        `INSERT INTO praxis.cv_skill_confirmation_request
         (request_id,learner_id,request_digest,catalog_version,algorithm_version,submitted_at,input_snapshot,result_hash,result_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)`,
        [result.requestId,result.learnerId,result.requestDigest,result.catalogVersion,result.algorithmVersion,result.submittedAt,
         JSON.stringify(result.inputSnapshot),result.resultHash,JSON.stringify(result)],
      );
      const drafts = new Map(result.evidenceDrafts.map(draft => [String(draft.provenance.confirmationCardId), draft]));
      const evidenceIds: string[] = [];
      for (const decision of result.decisions) {
        const draft = drafts.get(decision.cardId);
        if ((decision.evidenceStatus === 'created') !== Boolean(draft))
          throw new RangeError('Confirmation decision and evidence draft disagree');
        let evidenceId: string | null = null;
        const localSkillId = decision.selectedSkillId ? resolved.get(decision.selectedSkillId)! : null;
        if (draft) {
          if (draft.skillId !== decision.selectedSkillId || draft.level !== decision.declaredLevel)
            throw new RangeError('Evidence draft does not match its confirmation decision');
          const sourceIds = [...decision.sourceEvidenceIds];
          if (sourceIds.some(id => !UUID.test(id))) throw new TypeError('Persisted sourceEvidenceId values must be UUIDs');
          if (sourceIds.length) {
            const sources = await client.query<{ id: string; superseded_by: string | null }>(
              `SELECT id,superseded_by FROM praxis.skill_evidence
               WHERE learner_id=$1 AND id=ANY($2::uuid[]) AND evidence_type='cv_extracted_unconfirmed' FOR UPDATE`,
              [result.learnerId,sourceIds],
            );
            if (sources.rows.length !== sourceIds.length || sources.rows.some(row => row.superseded_by !== null))
              throw new RangeError('Source evidence must be current unconfirmed CV evidence for this learner');
          }
          evidenceId = randomUUID();
          const provenance = { ...draft.provenance, confirmationIdempotencyKey: draft.idempotencyKey,
            selectedCatalogSkillId: draft.skillId };
          await client.query(
            `INSERT INTO praxis.skill_evidence
             (id,learner_id,skill_id,level,evidence_type,confidence,provenance,observed_at)
             VALUES ($1,$2,$3,$4,'cv_extracted_confirmed','low',$5::jsonb,$6)`,
            [evidenceId,result.learnerId,localSkillId,draft.level,JSON.stringify(provenance),draft.observedAt],
          );
          if (sourceIds.length) await client.query(
            `UPDATE praxis.skill_evidence SET superseded_by=$1
             WHERE learner_id=$2 AND id=ANY($3::uuid[]) AND superseded_by IS NULL`,
            [evidenceId,result.learnerId,sourceIds],
          );
          evidenceIds.push(evidenceId);
        }
        await client.query(
          `INSERT INTO praxis.cv_skill_confirmation_decision
           (request_id,card_id,action,suggested_catalog_skill_id,selected_catalog_skill_id,selected_skill_id,
            declared_level,evidence_status,source_proposal_ids,source_evidence_ids,evidence_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::text[],$11)`,
          [result.requestId,decision.cardId,decision.action,decision.suggestedSkillId,decision.selectedSkillId,
           localSkillId,decision.declaredLevel,decision.evidenceStatus,decision.sourceProposalIds,decision.sourceEvidenceIds,evidenceId],
        );
      }
      await client.query('COMMIT');
      return { requestId: result.requestId, replayed: false, evidenceIds };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
