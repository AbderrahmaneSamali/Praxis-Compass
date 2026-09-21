-- Aggregate-only, offline graph/sequential recommender experiments.
-- This migration creates no serving path and never changes recommendation_weights.
-- Learner-level holdouts and rankings remain in the controlled evaluation environment.

CREATE VIEW praxis.recommender_experiment_real_outcome_source
WITH (security_barrier = true) AS
SELECT outcome.id AS event_id,outcome.learner_id,outcome.item_id,
       CASE WHEN outcome.completion_status='completed' THEN outcome.completed_at
            ELSE outcome.updated_at END AS resolved_at,
       outcome.completion_status,
       CASE WHEN progress.assessed_count=0 THEN NULL ELSE progress.any_assessed_gain END AS assessed_skill_gain
FROM praxis.learning_outcome outcome
JOIN praxis.content_records content ON content.id=outcome.item_id
JOIN praxis.provider provider ON provider.id=content.provider_id
LEFT JOIN praxis.recommendation_impression impression ON impression.id=outcome.source_impression
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE evidence_kind='assessed') AS assessed_count,
         bool_or(after_level>before_level) FILTER (WHERE evidence_kind='assessed') AS any_assessed_gain
  FROM praxis.learning_skill_progress progress
  WHERE progress.outcome_id=outcome.id
) progress ON true
WHERE outcome.completion_status IN ('completed','dropped')
  AND content.data_source <> 'fixture'
  AND provider.data_source <> 'fixture'
  AND coalesce(impression.is_example,false)=false;

CREATE TABLE praxis.recommender_experiment_run (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('blocked_insufficient_real_outcomes','offline_evaluated')),
  algorithm_version text NOT NULL,
  policy_version text NOT NULL,
  generated_by_principal text NOT NULL CHECK (generated_by_principal <> ''),
  inputs_hash text NOT NULL UNIQUE CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  result_hash text NOT NULL UNIQUE CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  dataset_manifest jsonb NOT NULL CHECK (jsonb_typeof(dataset_manifest) = 'object'),
  policy_snapshot jsonb NOT NULL CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  model_manifests jsonb NOT NULL CHECK (jsonb_typeof(model_manifests) = 'array'),
  aggregate_result jsonb NOT NULL CHECK (
    jsonb_typeof(aggregate_result) = 'object'
    AND NOT aggregate_result ? 'inputSnapshot'
  ),
  computed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE praxis.recommender_experiment_readiness_gate (
  run_id uuid NOT NULL REFERENCES praxis.recommender_experiment_run(id) ON DELETE RESTRICT,
  gate text NOT NULL,
  actual integer NOT NULL CHECK (actual >= 0),
  required integer NOT NULL CHECK (required > 0),
  ready boolean NOT NULL,
  PRIMARY KEY (run_id,gate),
  CHECK (ready = (actual >= required))
);

CREATE TABLE praxis.recommender_experiment_model_result (
  run_id uuid NOT NULL REFERENCES praxis.recommender_experiment_run(id) ON DELETE RESTRICT,
  model_id text NOT NULL,
  model_family text NOT NULL CHECK (model_family IN (
    'production_baseline','popularity_baseline','graph','sequential','graph_sequential'
  )),
  case_count integer NOT NULL CHECK (case_count > 0),
  metrics jsonb NOT NULL CHECK (jsonb_typeof(metrics) = 'array'),
  segment_metrics jsonb NOT NULL CHECK (jsonb_typeof(segment_metrics) = 'array'),
  PRIMARY KEY (run_id,model_id)
);

CREATE TABLE praxis.recommender_experiment_comparison (
  run_id uuid NOT NULL,
  model_id text NOT NULL,
  baseline_model_id text NOT NULL,
  primary_metric text NOT NULL CHECK (primary_metric IN ('hit_rate','ndcg','mrr')),
  primary_k integer NOT NULL CHECK (primary_k > 0),
  baseline_value numeric(14,12) NOT NULL CHECK (baseline_value BETWEEN 0 AND 1),
  challenger_value numeric(14,12) NOT NULL CHECK (challenger_value BETWEEN 0 AND 1),
  lift numeric(14,12) NOT NULL CHECK (lift BETWEEN -1 AND 1),
  confidence_level numeric(8,7) NOT NULL CHECK (confidence_level > .5 AND confidence_level < 1),
  confidence_lower numeric(14,12) NOT NULL CHECK (confidence_lower BETWEEN -1 AND 1),
  confidence_upper numeric(14,12) NOT NULL CHECK (confidence_upper BETWEEN -1 AND 1),
  catalog_coverage_delta numeric(14,12) NOT NULL CHECK (catalog_coverage_delta BETWEEN -1 AND 1),
  worst_segment_delta numeric(14,12) NOT NULL CHECK (worst_segment_delta BETWEEN -1 AND 1),
  assessed_gain_ndcg_delta numeric(14,12) NOT NULL CHECK (assessed_gain_ndcg_delta BETWEEN -1 AND 1),
  decision text NOT NULL CHECK (decision IN (
    'eligible_for_prospective_trial','retain_baseline','benchmark_only'
  )),
  reasons text[] NOT NULL,
  PRIMARY KEY (run_id,model_id),
  FOREIGN KEY (run_id,model_id)
    REFERENCES praxis.recommender_experiment_model_result(run_id,model_id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id,baseline_model_id)
    REFERENCES praxis.recommender_experiment_model_result(run_id,model_id) ON DELETE RESTRICT,
  CHECK (model_id <> baseline_model_id),
  CHECK (confidence_lower <= confidence_upper)
);

CREATE TABLE praxis.recommender_experiment_review (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  model_id text NOT NULL,
  reviewer_principal text NOT NULL CHECK (reviewer_principal <> ''),
  decision text NOT NULL CHECK (decision IN ('approve_prospective_trial','reject','needs_revision')),
  rationale text NOT NULL CHECK (rationale <> ''),
  review_checklist jsonb NOT NULL CHECK (jsonb_typeof(review_checklist) = 'object'),
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (run_id,model_id)
    REFERENCES praxis.recommender_experiment_model_result(run_id,model_id) ON DELETE RESTRICT,
  CHECK (decision <> 'approve_prospective_trial' OR (
    coalesce((review_checklist->>'temporalLeakageChecked')::boolean,false)
    AND coalesce((review_checklist->>'eligibilityConstraintsChecked')::boolean,false)
    AND coalesce((review_checklist->>'baselineComparisonChecked')::boolean,false)
    AND coalesce((review_checklist->>'subgroupMetricsChecked')::boolean,false)
    AND coalesce((review_checklist->>'privacyChecked')::boolean,false)
  ))
);

CREATE OR REPLACE FUNCTION praxis.guard_recommender_experiment_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Recommender experiment evidence and reviews are append-only';
END;
$$;

CREATE TRIGGER recommender_experiment_run_immutable
BEFORE UPDATE OR DELETE ON praxis.recommender_experiment_run
FOR EACH ROW EXECUTE FUNCTION praxis.guard_recommender_experiment_history();
CREATE TRIGGER recommender_experiment_gate_immutable
BEFORE UPDATE OR DELETE ON praxis.recommender_experiment_readiness_gate
FOR EACH ROW EXECUTE FUNCTION praxis.guard_recommender_experiment_history();
CREATE TRIGGER recommender_experiment_model_result_immutable
BEFORE UPDATE OR DELETE ON praxis.recommender_experiment_model_result
FOR EACH ROW EXECUTE FUNCTION praxis.guard_recommender_experiment_history();
CREATE TRIGGER recommender_experiment_comparison_immutable
BEFORE UPDATE OR DELETE ON praxis.recommender_experiment_comparison
FOR EACH ROW EXECUTE FUNCTION praxis.guard_recommender_experiment_history();
CREATE TRIGGER recommender_experiment_review_immutable
BEFORE UPDATE OR DELETE ON praxis.recommender_experiment_review
FOR EACH ROW EXECUTE FUNCTION praxis.guard_recommender_experiment_history();

CREATE OR REPLACE FUNCTION praxis.enforce_recommender_experiment_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generator text;
DECLARE comparison_decision text;
BEGIN
  SELECT run.generated_by_principal,comparison.decision
    INTO generator,comparison_decision
  FROM praxis.recommender_experiment_run run
  LEFT JOIN praxis.recommender_experiment_comparison comparison
    ON comparison.run_id=run.id AND comparison.model_id=NEW.model_id
  WHERE run.id=NEW.run_id;
  IF generator=NEW.reviewer_principal THEN
    RAISE EXCEPTION 'Recommender experiment review must be independent';
  END IF;
  IF NEW.decision='approve_prospective_trial'
     AND comparison_decision IS DISTINCT FROM 'eligible_for_prospective_trial' THEN
    RAISE EXCEPTION 'Only an offline-eligible model may proceed to a prospective trial';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recommender_experiment_review_guard
BEFORE INSERT ON praxis.recommender_experiment_review
FOR EACH ROW EXECUTE FUNCTION praxis.enforce_recommender_experiment_review();

CREATE VIEW praxis.reviewed_recommender_prospective_trial_candidates
WITH (security_barrier = true) AS
SELECT comparison.run_id,comparison.model_id,comparison.baseline_model_id,
       comparison.primary_metric,comparison.primary_k,comparison.lift,
       comparison.confidence_lower,comparison.confidence_upper,
       comparison.catalog_coverage_delta,comparison.worst_segment_delta,
       comparison.assessed_gain_ndcg_delta,
       latest.reviewer_principal,latest.reviewed_at
FROM praxis.recommender_experiment_comparison comparison
JOIN LATERAL (
  SELECT review.decision,review.reviewer_principal,review.reviewed_at,review.created_at,review.id
  FROM praxis.recommender_experiment_review review
  WHERE review.run_id=comparison.run_id AND review.model_id=comparison.model_id
  ORDER BY review.created_at DESC,review.id DESC
  LIMIT 1
) latest ON latest.decision='approve_prospective_trial'
WHERE comparison.decision='eligible_for_prospective_trial';

COMMENT ON TABLE praxis.recommender_experiment_run IS
  'Offline aggregate evidence only. Learner-level holdouts are intentionally excluded and no row authorizes production serving.';
COMMENT ON VIEW praxis.reviewed_recommender_prospective_trial_candidates IS
  'Independently reviewed candidates for a separate prospective trial. This view is not consumed by the production ranker.';
COMMENT ON VIEW praxis.recommender_experiment_real_outcome_source IS
  'Controlled Stage 8 source for resolved non-fixture, non-example outcomes and assessed-gain labels.';
