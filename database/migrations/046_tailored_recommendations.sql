-- Deploy with the matching kernel ranker version. Historical weights and
-- impressions are retained. No learner or catalog records are rewritten.
WITH retired AS (
  UPDATE praxis.recommendation_weights
  SET status = 'retired'
  WHERE status = 'active'
  RETURNING weights
)
INSERT INTO praxis.recommendation_weights (version, weights, status, activated_at)
SELECT 'praxis-rank-tailored-v2', weights, 'active', now() FROM retired;

-- Cover completed/dropout evidence reads used by the grouped prior estimator.
CREATE INDEX learning_outcome_rank_evidence_idx
  ON praxis.learning_outcome (source_impression, item_id)
  INCLUDE (completion_status, satisfaction)
  WHERE completion_status IN ('completed', 'dropped');

-- Cover active catalog enumeration and its deterministic ordering.
CREATE INDEX content_records_rank_published_idx
  ON praxis.content_records (updated_at DESC, id)
  WHERE deleted_at IS NULL AND status = 'published';

-- Rollback: deploy the previous kernel, retire praxis-rank-tailored-v2,
-- reactivate praxis-rank-actionable-offers-v1, and drop the two indexes.
-- Retain version rows referenced by historical impressions.
