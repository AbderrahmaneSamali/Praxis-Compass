import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { hashComputationInputs } from '../kernel/index.js';
import {
  validateTaskCrosswalkBatch,
  validateTaskCrosswalkReview,
  type TaskCrosswalkBatch,
  type TaskCrosswalkReview,
  type TaskNetworkNode,
} from './task-network-crosswalk.js';

export type RecordedTaskCrosswalkBatch = Readonly<{
  runId: string;
  replayed: boolean;
  candidateIds: readonly string[];
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Snapshot = Readonly<{
  sourceNodes: readonly TaskNetworkNode[];
  targetNodes: readonly TaskNetworkNode[];
}>;

function nodeKey(node: TaskNetworkNode): string {
  return `${node.taxonomy}:${node.releaseId}:${node.entityKind}:${node.entityId}`;
}

function primaryLabel(node: TaskNetworkNode): string {
  return node.texts.find(text => text.kind === 'label')!.text;
}

/** Stores frozen task nodes, all ranked candidates, and explicit NIL/abstention outcomes atomically. */
export class TaskNetworkCrosswalkRepository {
  constructor(private readonly pool: Pool) {}

  async recordBatch(generatedByPrincipal: string, batch: TaskCrosswalkBatch): Promise<RecordedTaskCrosswalkBatch> {
    const principal = generatedByPrincipal?.trim();
    if (!principal || principal.length > 300) throw new RangeError('generatedByPrincipal must contain 1-300 characters');
    validateTaskCrosswalkBatch(batch);
    const snapshot = batch.inputSnapshot as unknown as Snapshot;
    const nodes = [...snapshot.sourceNodes, ...snapshot.targetNodes];
    if (nodes.some(node => !UUID.test(node.releaseId))) throw new TypeError('Persisted source release IDs must be UUIDs');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; result_hash: string; generated_by_principal: string }>(
        `SELECT id,result_hash,generated_by_principal FROM praxis.task_network_crosswalk_run
         WHERE inputs_hash=$1 FOR UPDATE`, [batch.inputsHash],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.result_hash !== batch.resultHash || row.generated_by_principal !== principal)
          throw new RangeError('Crosswalk inputs hash is already bound to a different result or principal');
        const candidates = await client.query<{ id: string }>(
          'SELECT id FROM praxis.task_network_crosswalk_candidate WHERE run_id=$1 ORDER BY source_node_id,candidate_rank', [row.id],
        );
        await client.query('COMMIT');
        return { runId: row.id,replayed: true,candidateIds: candidates.rows.map(candidate => candidate.id) };
      }
      const releaseIds = [...new Set(nodes.map(node => node.releaseId))];
      const releases = await client.query<{ id: string; source: string }>(
        'SELECT id,source FROM praxis.source_releases WHERE id=ANY($1::uuid[])', [releaseIds],
      );
      if (releases.rows.length !== releaseIds.length) throw new RangeError('Every task node must reference a registered source release');
      const releaseSources = new Map(releases.rows.map(row => [row.id, row.source]));
      if (nodes.some(node => releaseSources.get(node.releaseId) !== node.taxonomy))
        throw new RangeError('Task-node taxonomy does not match its registered source release');
      const databaseNodeIds = new Map<string, string>();
      for (const node of nodes) {
        const identity = nodeKey(node), nodeHash = hashComputationInputs(node);
        const found = await client.query<{ id: string; node_hash: string }>(
          `SELECT id,node_hash FROM praxis.source_task_network_node
           WHERE source_release_id=$1 AND entity_kind=$2 AND source_entity_id=$3`,
          [node.releaseId,node.entityKind,node.entityId],
        );
        if (found.rows[0]) {
          if (found.rows[0].node_hash !== nodeHash) throw new RangeError(`Task-node identity has conflicting content: ${identity}`);
          databaseNodeIds.set(identity, found.rows[0].id);continue;
        }
        const id = randomUUID();
        await client.query(
          `INSERT INTO praxis.source_task_network_node
           (id,source_release_id,source_system,entity_kind,source_entity_id,primary_label,texts,
            occupation_anchor_ids,skill_anchor_ids,network_context_ids,node_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::text[],$9::text[],$10::text[],$11)`,
          [id,node.releaseId,node.taxonomy,node.entityKind,node.entityId,primaryLabel(node),JSON.stringify(node.texts),
           node.occupationAnchorIds,node.skillAnchorIds,node.networkContextIds,nodeHash],
        );
        databaseNodeIds.set(identity, id);
      }
      const runId = randomUUID();
      await client.query(
        `INSERT INTO praxis.task_network_crosswalk_run
         (id,source_system,target_system,source_release_id,target_release_id,algorithm_version,policy_version,
          generated_by_principal,inputs_hash,result_hash,input_snapshot,result_snapshot,computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)`,
        [runId,snapshot.sourceNodes[0]!.taxonomy,snapshot.targetNodes[0]!.taxonomy,snapshot.sourceNodes[0]!.releaseId,
         snapshot.targetNodes[0]!.releaseId,batch.algorithmVersion,batch.policyVersion,principal,batch.inputsHash,
         batch.resultHash,JSON.stringify(batch.inputSnapshot),JSON.stringify(batch),batch.computedAt],
      );
      const candidateIds: string[] = [];
      const candidateBySourceAndRank = new Map<string, string>();
      for (const outcome of batch.outcomes) for (const candidate of outcome.candidates) {
        const id = randomUUID();candidateIds.push(id);
        candidateBySourceAndRank.set(`${outcome.sourceKey}:${candidate.rank}`, id);
        await client.query(
          `INSERT INTO praxis.task_network_crosswalk_candidate
           (id,run_id,source_node_id,target_node_id,candidate_rank,score,score_components,evidence,
            suggested_relation,quality_flags)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::text[])`,
          [id,runId,databaseNodeIds.get(outcome.sourceKey),databaseNodeIds.get(candidate.targetKey),candidate.rank,
           candidate.score,JSON.stringify(candidate.components),JSON.stringify(candidate.evidence),
           candidate.suggestedRelation,candidate.qualityFlags],
        );
      }
      for (const outcome of batch.outcomes) {
        const selectedId = outcome.decision === 'proposed' ? candidateBySourceAndRank.get(`${outcome.sourceKey}:1`)! : null;
        await client.query(
          `INSERT INTO praxis.task_network_crosswalk_outcome
           (run_id,source_node_id,decision,reason,selected_candidate_id,top_score,runner_up_score,score_margin)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [runId,databaseNodeIds.get(outcome.sourceKey),outcome.decision,outcome.reason,selectedId,
           outcome.topScore,outcome.runnerUpScore,outcome.margin],
        );
      }
      await client.query('COMMIT');return { runId,replayed: false,candidateIds };
    } catch (error) {
      await client.query('ROLLBACK');throw error;
    } finally {
      client.release();
    }
  }

  /** Records independent expert judgment; it never mutates the algorithmic proposal. */
  async recordReview(candidateId: string, review: TaskCrosswalkReview): Promise<string> {
    if (!UUID.test(candidateId)) throw new TypeError('candidateId must be a UUID');
    validateTaskCrosswalkReview(review);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const candidate = await client.query<{ generated_by_principal: string }>(
        `SELECT run.generated_by_principal FROM praxis.task_network_crosswalk_candidate candidate
         JOIN praxis.task_network_crosswalk_run run ON run.id=candidate.run_id
         WHERE candidate.id=$1 FOR UPDATE OF candidate`, [candidateId],
      );
      if (!candidate.rows[0]) throw new RangeError('Crosswalk candidate does not exist');
      if (candidate.rows[0].generated_by_principal === review.reviewerPrincipal.trim())
        throw new RangeError('Crosswalk review must be independent of the generation principal');
      const id = randomUUID();
      await client.query(
        `INSERT INTO praxis.task_network_crosswalk_review
         (id,candidate_id,reviewer_principal,decision,reviewed_relation,rationale,review_checklist,reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [id,candidateId,review.reviewerPrincipal.trim(),review.decision,review.reviewedRelation,review.rationale,
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
