import type { Pool } from 'pg';
import {
  evaluateIrtStopping,
  validateIrtPosterior,
  type IrtPosterior,
  type IrtStoppingDecision,
  type IrtStoppingPolicy,
} from './irt-posterior.js';

export type RecordedIrtPosterior = Readonly<{
  sessionId: string;
  step: number;
  replayed: boolean;
  stoppingDecision: IrtStoppingDecision;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Records one immutable posterior/stopping trace after the corresponding responses exist. */
export class AssessmentIrtRepository {
  constructor(private readonly pool: Pool) {}

  async record(
    sessionId: string,
    posterior: IrtPosterior,
    coverageAchieved: boolean,
    policy: IrtStoppingPolicy,
  ): Promise<RecordedIrtPosterior> {
    if (!UUID.test(sessionId)) throw new TypeError('sessionId must be a UUID');
    validateIrtPosterior(posterior);
    if (!Number.isInteger(posterior.responseCounts.total) || posterior.responseCounts.total > 32767)
      throw new RangeError('IRT trace step exceeds the persistence range');
    const stoppingDecision = evaluateIrtStopping(posterior, coverageAchieved, policy);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query<{ id: string }>(
        'SELECT id FROM praxis.assessment_session WHERE id=$1 FOR UPDATE', [sessionId],
      );
      if (!session.rows[0]) throw new RangeError('Assessment session does not exist');
      const responseCount = await client.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM praxis.assessment_response WHERE session_id=$1', [sessionId],
      );
      if (responseCount.rows[0]?.total !== posterior.responseCounts.total)
        throw new RangeError('Persisted response count does not match the IRT posterior');
      const existing = await client.query<{ result_hash: string }>(
        'SELECT result_hash FROM praxis.assessment_irt_posterior WHERE session_id=$1 AND step=$2',
        [sessionId, posterior.responseCounts.total],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].result_hash !== posterior.resultHash)
          throw new RangeError('IRT step is already bound to a different posterior');
        await client.query('COMMIT');
        return { sessionId, step: posterior.responseCounts.total, replayed: true, stoppingDecision };
      }
      await client.query(
        `INSERT INTO praxis.assessment_irt_posterior
         (session_id,step,model,algorithm_version,inputs_hash,result_hash,input_snapshot,result_snapshot,
          total_responses,scored_responses,omitted_responses,correct_responses,eap_theta,map_theta,
          posterior_standard_deviation,credible_mass,credible_lower,credible_upper,test_information_at_eap,
          posterior_expected_test_information,data_information_fraction,calibration_uncertainty,
          mastery_probabilities,category_probabilities,quality_flags,stopping_decision)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                 $21,$22,$23::jsonb,$24::jsonb,$25::text[],$26::jsonb)`,
        [sessionId,posterior.responseCounts.total,posterior.model,posterior.algorithmVersion,posterior.inputsHash,
         posterior.resultHash,JSON.stringify(posterior.inputSnapshot),JSON.stringify(posterior),
         posterior.responseCounts.total,posterior.responseCounts.scored,posterior.responseCounts.omitted,
         posterior.responseCounts.correct,posterior.eapTheta,posterior.mapTheta,posterior.posteriorStandardDeviation,
         posterior.credibleInterval.mass,posterior.credibleInterval.lower,posterior.credibleInterval.upper,
         posterior.testInformationAtEap,posterior.posteriorExpectedTestInformation,posterior.dataInformationFraction,
         posterior.calibrationUncertainty,JSON.stringify(posterior.masteryProbabilities),
         JSON.stringify(posterior.categoryProbabilities),posterior.qualityFlags,JSON.stringify(stoppingDecision)],
      );
      await client.query('COMMIT');
      return { sessionId, step: posterior.responseCounts.total, replayed: false, stoppingDecision };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
