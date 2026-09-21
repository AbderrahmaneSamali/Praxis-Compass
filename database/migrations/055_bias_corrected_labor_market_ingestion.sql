-- Bias-aware ingestion for nonrepresentative online job advertisements.
-- Raw text and applicant data are deliberately excluded. Official benchmark
-- distributions calibrate relative demand; they are not relabeled as vacancies.

CREATE TABLE praxis.labor_market_source_release (
  release_id text PRIMARY KEY,
  source_id text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  license text NOT NULL,
  coverage_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE praxis.labor_market_benchmark_release (
  release_id text PRIMARY KEY,
  source_id text NOT NULL,
  period text NOT NULL CHECK (period ~ '^\d{4}-(Q[1-4]|M(0[1-9]|1[0-2]))$'),
  measure text NOT NULL CHECK (measure IN (
    'recent_hires','recent_job_starters','employment','job_vacancies'
  )),
  cells_hash text NOT NULL CHECK (cells_hash ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE praxis.labor_market_benchmark_cell (
  benchmark_release_id text NOT NULL
    REFERENCES praxis.labor_market_benchmark_release(release_id) ON DELETE RESTRICT,
  stratum_key text NOT NULL CHECK (stratum_key ~ '^[a-f0-9]{64}$'),
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  region_code text,
  sector_code text NOT NULL,
  occupation_group_code text NOT NULL,
  benchmark_count bigint NOT NULL CHECK (benchmark_count >= 0),
  PRIMARY KEY (benchmark_release_id,stratum_key)
);

CREATE TABLE praxis.labor_market_ingestion_batch (
  id uuid PRIMARY KEY,
  period text NOT NULL CHECK (period ~ '^\d{4}-(Q[1-4]|M(0[1-9]|1[0-2]))$'),
  benchmark_release_id text NOT NULL
    REFERENCES praxis.labor_market_benchmark_release(release_id) ON DELETE RESTRICT,
  source_release_ids text[] NOT NULL CHECK (cardinality(source_release_ids) > 0),
  algorithm_version text NOT NULL,
  policy_version text NOT NULL,
  inputs_hash text NOT NULL UNIQUE CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  result_hash text NOT NULL UNIQUE CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  raw_observations integer NOT NULL CHECK (raw_observations > 0),
  unique_postings integer NOT NULL CHECK (unique_postings > 0 AND unique_postings <= raw_observations),
  duplicates_removed integer NOT NULL CHECK (duplicates_removed = raw_observations - unique_postings),
  benchmarked_postings integer NOT NULL CHECK (benchmarked_postings BETWEEN 1 AND unique_postings),
  unbenchmarked_postings integer NOT NULL CHECK (unbenchmarked_postings = unique_postings - benchmarked_postings),
  benchmark_coverage numeric(12,10) NOT NULL CHECK (benchmark_coverage > 0 AND benchmark_coverage <= 1),
  effective_sample_size numeric(18,8) NOT NULL CHECK (effective_sample_size > 0),
  quality_flags text[] NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE praxis.labor_market_posting_observation (
  batch_id uuid NOT NULL REFERENCES praxis.labor_market_ingestion_batch(id) ON DELETE RESTRICT,
  observation_index integer NOT NULL CHECK (observation_index >= 0),
  source_release_id text NOT NULL REFERENCES praxis.labor_market_source_release(release_id) ON DELETE RESTRICT,
  external_posting_id text NOT NULL,
  deduplication_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  stratum_key text NOT NULL CHECK (stratum_key ~ '^[a-f0-9]{64}$'),
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  region_code text,
  sector_code text NOT NULL,
  occupation_group_code text NOT NULL,
  skill_ids text[] NOT NULL,
  PRIMARY KEY (batch_id,observation_index)
);

CREATE INDEX labor_market_posting_dedup_idx
  ON praxis.labor_market_posting_observation (batch_id,deduplication_key);

CREATE TABLE praxis.labor_market_stratum_estimate (
  batch_id uuid NOT NULL REFERENCES praxis.labor_market_ingestion_batch(id) ON DELETE RESTRICT,
  stratum_key text NOT NULL CHECK (stratum_key ~ '^[a-f0-9]{64}$'),
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  region_code text,
  sector_code text NOT NULL,
  occupation_group_code text NOT NULL,
  observed_postings integer NOT NULL CHECK (observed_postings >= 0),
  benchmark_count bigint CHECK (benchmark_count >= 0),
  raw_adjustment_factor numeric(24,12) CHECK (raw_adjustment_factor > 0),
  applied_weight numeric(24,12) CHECK (applied_weight > 0),
  weight_capped boolean NOT NULL,
  PRIMARY KEY (batch_id,stratum_key),
  CHECK ((raw_adjustment_factor IS NULL) = (applied_weight IS NULL))
);

CREATE TABLE praxis.labor_market_skill_demand_estimate (
  batch_id uuid NOT NULL REFERENCES praxis.labor_market_ingestion_batch(id) ON DELETE RESTRICT,
  skill_id text NOT NULL REFERENCES praxis.skill(id) ON DELETE RESTRICT,
  raw_posting_count integer NOT NULL CHECK (raw_posting_count >= 0),
  benchmarked_raw_posting_count integer NOT NULL CHECK (benchmarked_raw_posting_count BETWEEN 0 AND raw_posting_count),
  benchmarked_raw_share numeric(12,10) NOT NULL CHECK (benchmarked_raw_share BETWEEN 0 AND 1),
  adjusted_posting_equivalent numeric(24,12) NOT NULL CHECK (adjusted_posting_equivalent >= 0),
  adjusted_share numeric(12,10) NOT NULL CHECK (adjusted_share BETWEEN 0 AND 1),
  relative_share_change numeric(24,12),
  standard_error numeric(12,10) NOT NULL CHECK (standard_error >= 0),
  confidence_level numeric(8,7) NOT NULL CHECK (confidence_level > 0 AND confidence_level < 1),
  confidence_lower numeric(12,10) NOT NULL CHECK (confidence_lower BETWEEN 0 AND 1),
  confidence_upper numeric(12,10) NOT NULL CHECK (confidence_upper BETWEEN 0 AND 1),
  effective_sample_size numeric(18,8) NOT NULL CHECK (effective_sample_size > 0),
  status text NOT NULL CHECK (status IN ('publishable','insufficient_coverage','insufficient_sample')),
  quality_flags text[] NOT NULL,
  PRIMARY KEY (batch_id,skill_id),
  CHECK (confidence_lower <= adjusted_share AND adjusted_share <= confidence_upper)
);

CREATE OR REPLACE FUNCTION praxis.guard_labor_market_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Labor-market ingestion and estimates are append-only';
END;
$$;

CREATE TRIGGER labor_market_source_release_immutable
BEFORE UPDATE OR DELETE ON praxis.labor_market_source_release
FOR EACH ROW EXECUTE FUNCTION praxis.guard_labor_market_history();
CREATE TRIGGER labor_market_benchmark_release_immutable
BEFORE UPDATE OR DELETE ON praxis.labor_market_benchmark_release
FOR EACH ROW EXECUTE FUNCTION praxis.guard_labor_market_history();
CREATE TRIGGER labor_market_benchmark_cell_immutable
BEFORE UPDATE OR DELETE ON praxis.labor_market_benchmark_cell
FOR EACH ROW EXECUTE FUNCTION praxis.guard_labor_market_history();
CREATE TRIGGER labor_market_ingestion_batch_immutable
BEFORE UPDATE OR DELETE ON praxis.labor_market_ingestion_batch
FOR EACH ROW EXECUTE FUNCTION praxis.guard_labor_market_history();
CREATE TRIGGER labor_market_posting_observation_immutable
BEFORE UPDATE OR DELETE ON praxis.labor_market_posting_observation
FOR EACH ROW EXECUTE FUNCTION praxis.guard_labor_market_history();
CREATE TRIGGER labor_market_stratum_estimate_immutable
BEFORE UPDATE OR DELETE ON praxis.labor_market_stratum_estimate
FOR EACH ROW EXECUTE FUNCTION praxis.guard_labor_market_history();
CREATE TRIGGER labor_market_skill_demand_estimate_immutable
BEFORE UPDATE OR DELETE ON praxis.labor_market_skill_demand_estimate
FOR EACH ROW EXECUTE FUNCTION praxis.guard_labor_market_history();

COMMENT ON TABLE praxis.labor_market_skill_demand_estimate IS
  'Bias-adjusted relative skill shares with uncertainty and release gates. Not an absolute vacancy count and not learner evidence.';
