-- Versioned hierarchical outcome-prior estimator and explicit editorial cold
-- start signals. The previous weights JSON is retained unchanged; only its
-- lifecycle status is retired so the new version can become active atomically.
-- Estimator and ranker version literals are generated from ALGORITHM_VERSIONS
-- and pinned by backend unit tests.
--
-- rollback:
--   Stop recommendation writers. Retire praxis-rank-cold-start-v1 and reactivate
--   praxis-rank-v1. Drop the four outcome-prior provenance columns from
--   recommendation_impression_item, then drop featured, cold_start_rank and
--   cold_start_source_version from content_records. Delete the new weights row
--   only after all impression rows referencing it have passed retention.

ALTER TABLE praxis.content_records
  ADD COLUMN featured boolean NOT NULL DEFAULT false,
  ADD COLUMN cold_start_rank smallint CHECK (cold_start_rank > 0),
  ADD COLUMN cold_start_source_version text,
  ADD CONSTRAINT content_records_cold_start_versioned_check CHECK (
    (cold_start_rank IS NULL AND featured = false)
    OR cold_start_source_version IS NOT NULL
  );

COMMENT ON COLUMN praxis.content_records.featured IS
  'Explicit editorial cold-start evidence; requires cold_start_source_version.';
COMMENT ON COLUMN praxis.content_records.cold_start_rank IS
  'Lower is preferred. Editorial ordering is used only when behavioural evidence is below configured trust thresholds.';

ALTER TABLE praxis.recommendation_impression_item
  ADD COLUMN outcome_prior_trial_count integer CHECK (outcome_prior_trial_count >= 0),
  ADD COLUMN outcome_prior_algorithm_version text,
  ADD COLUMN outcome_prior_inputs_hash text
    CHECK (outcome_prior_inputs_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT recommendation_impression_item_prior_provenance_check CHECK (
    (outcome_prior_algorithm_version IS NULL) = (outcome_prior_inputs_hash IS NULL)
  );

COMMENT ON COLUMN praxis.recommendation_impression_item.outcome_prior_trial_count IS
  'Trials at the fallback level selected by the served-time estimator.';
COMMENT ON COLUMN praxis.recommendation_impression_item.outcome_prior_inputs_hash IS
  'Hash of the hierarchical counts, editorial signals and estimator config used for the stored outcome_prior feature.';

UPDATE praxis.recommendation_weights
SET status = 'retired'
WHERE version = 'praxis-rank-v1' AND status = 'active';

INSERT INTO praxis.recommendation_weights
  (version, weights, status, activated_at)
VALUES (
  'praxis-rank-cold-start-v1',
  '{
    "gap_coverage": 0.28,
    "precision": 0.18,
    "level_fit": 0.14,
    "evidence_confidence": 0.10,
    "constraint_fit": 0.10,
    "outcome_prior": 0.05,
    "scarcity": 0.08,
    "freshness": 0.07,
    "redundancy_penalty": 0.12,
    "outcome_prior_estimator": {
      "alpha": 25,
      "minimum_trials": {
        "item": 20,
        "product_family_sector": 50,
        "sector": 100,
        "global": 200
      },
      "neutral_prior": 0.50,
      "featured_prior": 0.70,
      "rank_decay": 0.03
    }
  }'::jsonb,
  'active',
  now()
);
