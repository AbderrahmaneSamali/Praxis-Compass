-- PRAXIS migration 038: observability must accept an honest zero-served result.
--
-- A candidate can be rejected after ranking because it has no actionable offer.
-- In that case there is no rank-one score to record, even though candidate
-- generation was non-empty. Telemetry must never turn this catalog signal into
-- an API failure.
--
-- rollback:
--   ALTER TABLE praxis.recommendation_request_metric
--     DROP CONSTRAINT IF EXISTS recommendation_request_metric_top_score_for_served_check;
--   ALTER TABLE praxis.recommendation_request_metric
--     ADD CONSTRAINT recommendation_request_metric_check6 CHECK (
--       (candidate_after_cap_count = 0 AND top_1_score IS NULL)
--       OR (candidate_after_cap_count > 0 AND top_1_score IS NOT NULL)
--     );

ALTER TABLE praxis.recommendation_request_metric
  DROP CONSTRAINT IF EXISTS recommendation_request_metric_check6;

ALTER TABLE praxis.recommendation_request_metric
  ADD CONSTRAINT recommendation_request_metric_top_score_for_served_check
  CHECK (
    (served_count = 0 AND top_1_score IS NULL)
    OR (served_count > 0 AND top_1_score IS NOT NULL)
  );

COMMENT ON CONSTRAINT recommendation_request_metric_top_score_for_served_check
  ON praxis.recommendation_request_metric IS
  'Top-one score exists only for a served recommendation. Candidate-only runs can legitimately serve zero actionable offers.';
