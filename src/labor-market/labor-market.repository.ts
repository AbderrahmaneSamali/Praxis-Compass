import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { hashComputationInputs } from '../kernel/index.js';
import {
  validateBiasCorrectedLaborMarketBatch,
  type BiasCorrectedLaborMarketBatch,
  type LaborMarketPostingObservation,
  type LaborMarketSourceRelease,
  type OfficialBenchmarkCell,
} from './bias-corrected-ingestion.js';

export type RecordedLaborMarketBatch = Readonly<{ batchId: string; replayed: boolean }>;

type Snapshot = Readonly<{
  sourceReleases: readonly (Omit<LaborMarketSourceRelease, 'retrievedAt'> & { retrievedAt: string })[];
  observations: readonly (Omit<LaborMarketPostingObservation, 'observedAt'> & { observedAt: string })[];
  benchmark: Readonly<{
    sourceId: string;releaseId: string;measure: string;publishedAt: string;cells: readonly OfficialBenchmarkCell[];
  }>;
}>;

/** Persists the raw metadata, benchmark frame, weighting trace, and uncertainty atomically. */
export class LaborMarketRepository {
  constructor(private readonly pool: Pool) {}

  async record(batch: BiasCorrectedLaborMarketBatch): Promise<RecordedLaborMarketBatch> {
    validateBiasCorrectedLaborMarketBatch(batch);
    const snapshot = batch.inputSnapshot as unknown as Snapshot;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; result_hash: string }>(
        'SELECT id,result_hash FROM praxis.labor_market_ingestion_batch WHERE inputs_hash=$1 FOR UPDATE', [batch.inputsHash],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].result_hash !== batch.resultHash)
          throw new RangeError('Labor-market inputs hash is already bound to a different result');
        await client.query('COMMIT');return { batchId: existing.rows[0].id,replayed: true };
      }
      for (const release of snapshot.sourceReleases) {
        const found = await client.query<{ source_id: string; retrieved_at: Date; license: string; coverage_note: string }>(
          'SELECT source_id,retrieved_at,license,coverage_note FROM praxis.labor_market_source_release WHERE release_id=$1',
          [release.releaseId],
        );
        if (found.rows[0]) {
          const row = found.rows[0];
          if (row.source_id !== release.sourceId || new Date(row.retrieved_at).toISOString() !== release.retrievedAt ||
              row.license !== release.license || row.coverage_note !== release.coverageNote)
            throw new RangeError(`Source release ID has conflicting metadata: ${release.releaseId}`);
        } else await client.query(
          `INSERT INTO praxis.labor_market_source_release
           (release_id,source_id,retrieved_at,license,coverage_note) VALUES ($1,$2,$3,$4,$5)`,
          [release.releaseId,release.sourceId,release.retrievedAt,release.license,release.coverageNote],
        );
      }
      const orderedBenchmarkCells = [...snapshot.benchmark.cells].sort((left, right) =>
        hashComputationInputs(left.stratum).localeCompare(hashComputationInputs(right.stratum)));
      const benchmarkCellsHash = hashComputationInputs(orderedBenchmarkCells);
      const benchmarkFound = await client.query<{ source_id: string; period: string; measure: string; cells_hash: string; published_at: Date }>(
        'SELECT source_id,period,measure,cells_hash,published_at FROM praxis.labor_market_benchmark_release WHERE release_id=$1',
        [snapshot.benchmark.releaseId],
      );
      if (benchmarkFound.rows[0]) {
        const row = benchmarkFound.rows[0];
        if (row.source_id !== snapshot.benchmark.sourceId || row.period !== batch.period ||
            row.measure !== snapshot.benchmark.measure || row.cells_hash !== benchmarkCellsHash ||
            new Date(row.published_at).toISOString() !== snapshot.benchmark.publishedAt)
          throw new RangeError('Benchmark release ID has conflicting metadata');
      } else {
        await client.query(
          `INSERT INTO praxis.labor_market_benchmark_release
           (release_id,source_id,period,measure,cells_hash,published_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [snapshot.benchmark.releaseId,snapshot.benchmark.sourceId,batch.period,snapshot.benchmark.measure,
           benchmarkCellsHash,snapshot.benchmark.publishedAt],
        );
        for (const cell of orderedBenchmarkCells) await client.query(
          `INSERT INTO praxis.labor_market_benchmark_cell
           (benchmark_release_id,stratum_key,country_code,region_code,sector_code,occupation_group_code,benchmark_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [snapshot.benchmark.releaseId,hashComputationInputs(cell.stratum),cell.stratum.countryCode,cell.stratum.regionCode,
           cell.stratum.sectorCode,cell.stratum.occupationGroupCode,cell.count],
        );
      }
      const skillIds = [...new Set(batch.skills.map(skill => skill.skillId))];
      if (skillIds.length) {
        const skills = await client.query<{ id: string }>('SELECT id FROM praxis.skill WHERE id=ANY($1::text[])', [skillIds]);
        if (skills.rows.length !== skillIds.length) throw new RangeError('Every labor-market skill must exist in the governed skill catalog');
      }
      const batchId = randomUUID();
      await client.query(
        `INSERT INTO praxis.labor_market_ingestion_batch
         (id,period,benchmark_release_id,source_release_ids,algorithm_version,policy_version,inputs_hash,result_hash,
          input_snapshot,result_snapshot,raw_observations,unique_postings,duplicates_removed,benchmarked_postings,
          unbenchmarked_postings,benchmark_coverage,effective_sample_size,quality_flags)
         VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18::text[])`,
        [batchId,batch.period,snapshot.benchmark.releaseId,snapshot.sourceReleases.map(release => release.releaseId),
         batch.algorithmVersion,batch.policyVersion,batch.inputsHash,batch.resultHash,JSON.stringify(batch.inputSnapshot),
         JSON.stringify(batch),batch.counts.rawObservations,batch.counts.uniquePostings,batch.counts.duplicatesRemoved,
         batch.counts.benchmarkedPostings,batch.counts.unbenchmarkedPostings,batch.benchmarkCoverage.ratio,
         batch.effectiveSampleSize,batch.qualityFlags],
      );
      for (const [index, observation] of snapshot.observations.entries()) await client.query(
        `INSERT INTO praxis.labor_market_posting_observation
         (batch_id,observation_index,source_release_id,external_posting_id,deduplication_key,observed_at,stratum_key,
          country_code,region_code,sector_code,occupation_group_code,skill_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[])`,
        [batchId,index,observation.sourceReleaseId,observation.externalPostingId,observation.deduplicationKey,
         observation.observedAt,hashComputationInputs(observation.stratum),observation.stratum.countryCode,
         observation.stratum.regionCode,observation.stratum.sectorCode,observation.stratum.occupationGroupCode,
         observation.skillIds],
      );
      for (const stratum of batch.strata) await client.query(
        `INSERT INTO praxis.labor_market_stratum_estimate
         (batch_id,stratum_key,country_code,region_code,sector_code,occupation_group_code,observed_postings,
          benchmark_count,raw_adjustment_factor,applied_weight,weight_capped)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [batchId,hashComputationInputs(stratum.stratum),stratum.stratum.countryCode,stratum.stratum.regionCode,
         stratum.stratum.sectorCode,stratum.stratum.occupationGroupCode,stratum.observedPostings,stratum.benchmarkCount,
         stratum.rawAdjustmentFactor,stratum.appliedWeight,stratum.capped],
      );
      for (const skill of batch.skills) await client.query(
        `INSERT INTO praxis.labor_market_skill_demand_estimate
         (batch_id,skill_id,raw_posting_count,adjusted_posting_equivalent,adjusted_share,standard_error,
          benchmarked_raw_posting_count,benchmarked_raw_share,relative_share_change,
          confidence_level,confidence_lower,confidence_upper,effective_sample_size,status,quality_flags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::text[])`,
        [batchId,skill.skillId,skill.rawPostingCount,skill.adjustedPostingEquivalent,skill.adjustedShare,skill.standardError,
         skill.benchmarkedRawPostingCount,skill.benchmarkedRawShare,skill.relativeShareChange,
         skill.confidenceInterval.level,skill.confidenceInterval.lower,skill.confidenceInterval.upper,
         skill.effectiveSampleSize,skill.status,skill.qualityFlags],
      );
      await client.query('COMMIT');return { batchId,replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');throw error;
    } finally {
      client.release();
    }
  }
}
