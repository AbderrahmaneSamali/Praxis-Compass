-- Vendor-neutral recommendation observability. Migration number 019 remains
-- reserved for the previously specified adaptive-assessment migration.
-- Successful request telemetry is joined to its immutable impression; daily
-- aggregate snapshots intentionally contain no learner or item identifiers.
--
-- paired down-migration note:
--   Stop the recommendation API and daily snapshot job. Drop
--   praxis.recommendation_health_snapshot and
--   praxis.recommendation_request_metric, then drop the
--   outcome_prior_source column from recommendation_impression_item. Export
--   snapshots first if their operational history must be retained.

ALTER TABLE praxis.recommendation_impression_item
  ADD COLUMN outcome_prior_source text NOT NULL DEFAULT 'legacy_unknown'
    CHECK (outcome_prior_source IN (
      'item_segment', 'product_family_sector', 'sector', 'global',
      'editorial', 'uninformed', 'legacy_unknown'
    ));

COMMENT ON COLUMN praxis.recommendation_impression_item.outcome_prior_source IS
  'Served-time source of outcome_prior. Any value other than item_segment is a cold-start fallback; legacy_unknown is restricted to rows written before migration 020.';

CREATE TABLE praxis.recommendation_request_metric (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impression_id uuid NOT NULL UNIQUE
    REFERENCES praxis.recommendation_impression(id) ON DELETE CASCADE,
  learner_id uuid NOT NULL
    REFERENCES praxis.learner(id) ON DELETE CASCADE,
  target_occupation_id text NOT NULL
    REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  surface text NOT NULL CHECK (surface ~ '^[a-z][a-z0-9_]{1,79}$'),
  weights_version text NOT NULL
    REFERENCES praxis.recommendation_weights(version) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),

  total_latency_ms numeric(12,3) NOT NULL CHECK (total_latency_ms >= 0),
  context_latency_ms numeric(12,3) NOT NULL CHECK (context_latency_ms >= 0),
  catalog_latency_ms numeric(12,3) NOT NULL CHECK (catalog_latency_ms >= 0),
  neighbourhood_latency_ms numeric(12,3) NOT NULL
    CHECK (neighbourhood_latency_ms >= 0),
  candidate_generation_latency_ms numeric(12,3) NOT NULL
    CHECK (candidate_generation_latency_ms >= 0),
  feature_scoring_latency_ms numeric(12,3) NOT NULL
    CHECK (feature_scoring_latency_ms >= 0),
  rerank_latency_ms numeric(12,3) NOT NULL CHECK (rerank_latency_ms >= 0),
  persistence_latency_ms numeric(12,3) NOT NULL
    CHECK (persistence_latency_ms >= 0),

  candidate_pool_counts jsonb NOT NULL
    CHECK (jsonb_typeof(candidate_pool_counts) = 'object'),
  candidate_before_dedup_count integer NOT NULL
    CHECK (candidate_before_dedup_count >= 0),
  candidate_after_dedup_count integer NOT NULL
    CHECK (candidate_after_dedup_count >= 0),
  candidate_after_cap_count integer NOT NULL
    CHECK (candidate_after_cap_count >= 0),
  served_count integer NOT NULL CHECK (served_count >= 0),
  dropped_item_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  cold_start_item_count integer NOT NULL DEFAULT 0
    CHECK (cold_start_item_count >= 0),
  is_cold_start boolean NOT NULL,
  zero_candidates boolean NOT NULL,

  top_1_score numeric(8,7) CHECK (top_1_score BETWEEN 0 AND 1),
  top_1_to_5_spread numeric(8,7)
    CHECK (top_1_to_5_spread BETWEEN 0 AND 1),
  is_exploration boolean NOT NULL,
  exploration_probability numeric(5,4) NOT NULL
    CHECK (exploration_probability BETWEEN 0 AND 1),

  CHECK (candidate_after_dedup_count <= candidate_before_dedup_count),
  CHECK (candidate_after_cap_count <= candidate_after_dedup_count),
  CHECK (served_count <= candidate_after_cap_count),
  CHECK (cold_start_item_count <= served_count),
  CHECK (is_cold_start = (cold_start_item_count > 0)),
  CHECK (zero_candidates = (candidate_after_cap_count = 0)),
  CHECK (
    (candidate_after_cap_count = 0 AND top_1_score IS NULL)
    OR (candidate_after_cap_count > 0 AND top_1_score IS NOT NULL)
  ),
  CHECK (served_count >= 5 OR top_1_to_5_spread IS NULL)
);

CREATE INDEX recommendation_request_metric_time_brin
  ON praxis.recommendation_request_metric USING brin (recorded_at);
CREATE INDEX recommendation_request_metric_surface_time_idx
  ON praxis.recommendation_request_metric (surface, recorded_at DESC);
CREATE INDEX recommendation_request_metric_zero_candidates_idx
  ON praxis.recommendation_request_metric (recorded_at DESC)
  WHERE zero_candidates;

COMMENT ON TABLE praxis.recommendation_request_metric IS
  'One vendor-neutral observability record per successful recommendation impression; raw rows retain dropped ids and exact stage timings for incident diagnosis.';
COMMENT ON COLUMN praxis.recommendation_request_metric.neighbourhood_latency_ms IS
  'Latency of the bounded 1-2 hop ESCO hierarchy lookup, tracked separately because it is the candidate pipeline risk.';

CREATE TABLE praxis.recommendation_health_snapshot (
  snapshot_date date PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  window_ended_at timestamptz NOT NULL,
  request_count bigint NOT NULL CHECK (request_count >= 0),
  stage_latency_percentiles jsonb NOT NULL
    CHECK (jsonb_typeof(stage_latency_percentiles) = 'object'),
  candidate_counts jsonb NOT NULL
    CHECK (jsonb_typeof(candidate_counts) = 'object'),
  cold_start_rate numeric(8,7) NOT NULL CHECK (cold_start_rate BETWEEN 0 AND 1),
  zero_candidate_rate numeric(8,7) NOT NULL
    CHECK (zero_candidate_rate BETWEEN 0 AND 1),
  top_1_score_distribution jsonb NOT NULL
    CHECK (jsonb_typeof(top_1_score_distribution) = 'object'),
  top_1_to_5_spread_distribution jsonb NOT NULL
    CHECK (jsonb_typeof(top_1_to_5_spread_distribution) = 'object'),
  exploration_observed_rate numeric(8,7) NOT NULL
    CHECK (exploration_observed_rate BETWEEN 0 AND 1),
  exploration_configured_rate numeric(8,7) NOT NULL
    CHECK (exploration_configured_rate BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (window_ended_at > window_started_at),
  CHECK (snapshot_date = (window_started_at AT TIME ZONE 'UTC')::date)
);

COMMENT ON TABLE praxis.recommendation_health_snapshot IS
  'One identifier-free UTC daily aggregate, written after day close so recommendation health trends survive raw telemetry retention.';
