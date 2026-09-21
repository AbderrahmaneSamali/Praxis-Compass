-- Bayesian 2PL posterior traces and item-calibration uncertainty.
-- Existing SPRT decisions remain intact and replayable under their own version.
-- This migration adds a parallel append-only trace for the IRT policy.

ALTER TABLE praxis.assessment_item
  ADD COLUMN difficulty_standard_error numeric(8,6)
    CHECK (difficulty_standard_error >= 0),
  ADD COLUMN discrimination_standard_error numeric(8,6)
    CHECK (discrimination_standard_error >= 0),
  ADD COLUMN calibration_sample_size integer
    CHECK (calibration_sample_size > 0),
  ADD CONSTRAINT assessment_item_parameter_uncertainty_pair CHECK (
    (difficulty_standard_error IS NULL) = (discrimination_standard_error IS NULL)
  );

COMMENT ON COLUMN praxis.assessment_item.difficulty_standard_error IS
  'Sampling standard error for the calibrated 2PL difficulty parameter.';
COMMENT ON COLUMN praxis.assessment_item.discrimination_standard_error IS
  'Sampling standard error for the calibrated 2PL discrimination parameter.';

-- An omission is observed assessment behavior but contributes no likelihood.
ALTER TABLE praxis.assessment_response
  ALTER COLUMN correctness DROP NOT NULL,
  ADD COLUMN response_status text NOT NULL DEFAULT 'answered'
    CHECK (response_status IN ('answered', 'omitted')),
  ADD CONSTRAINT assessment_response_status_consistent CHECK (
    (response_status = 'answered' AND correctness IS NOT NULL)
    OR (response_status = 'omitted' AND correctness IS NULL)
  );

CREATE TABLE praxis.assessment_irt_posterior (
  session_id uuid NOT NULL
    REFERENCES praxis.assessment_session(id) ON DELETE CASCADE,
  step smallint NOT NULL CHECK (step >= 0),
  model text NOT NULL CHECK (model = '2PL'),
  algorithm_version text NOT NULL,
  inputs_hash text NOT NULL CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  result_hash text NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  total_responses smallint NOT NULL CHECK (total_responses = step),
  scored_responses smallint NOT NULL CHECK (scored_responses BETWEEN 0 AND total_responses),
  omitted_responses smallint NOT NULL CHECK (omitted_responses = total_responses - scored_responses),
  correct_responses smallint NOT NULL CHECK (correct_responses BETWEEN 0 AND scored_responses),
  eap_theta numeric(12,8) NOT NULL,
  map_theta numeric(12,8) NOT NULL,
  posterior_standard_deviation numeric(12,8) NOT NULL CHECK (posterior_standard_deviation >= 0),
  credible_mass numeric(8,7) NOT NULL CHECK (credible_mass > 0 AND credible_mass < 1),
  credible_lower numeric(12,8) NOT NULL,
  credible_upper numeric(12,8) NOT NULL,
  test_information_at_eap numeric(16,10) NOT NULL CHECK (test_information_at_eap >= 0),
  posterior_expected_test_information numeric(16,10) NOT NULL
    CHECK (posterior_expected_test_information >= 0),
  data_information_fraction numeric(8,7) NOT NULL CHECK (data_information_fraction BETWEEN 0 AND 1),
  calibration_uncertainty text NOT NULL CHECK (calibration_uncertainty IN (
    'not_applicable', 'marginalized', 'conditional_point_estimates', 'mixed'
  )),
  mastery_probabilities jsonb NOT NULL CHECK (jsonb_typeof(mastery_probabilities) = 'object'),
  category_probabilities jsonb NOT NULL CHECK (jsonb_typeof(category_probabilities) = 'object'),
  quality_flags text[] NOT NULL DEFAULT ARRAY[]::text[],
  stopping_decision jsonb NOT NULL CHECK (jsonb_typeof(stopping_decision) = 'object'),
  computed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (session_id, step),
  UNIQUE (session_id, result_hash),
  CHECK (credible_lower <= credible_upper)
);

CREATE OR REPLACE FUNCTION praxis.guard_assessment_irt_posterior_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Assessment IRT posterior traces are append-only';
END;
$$;

CREATE TRIGGER assessment_irt_posterior_immutable
BEFORE UPDATE ON praxis.assessment_irt_posterior
FOR EACH ROW EXECUTE FUNCTION praxis.guard_assessment_irt_posterior_update();

COMMENT ON TABLE praxis.assessment_irt_posterior IS
  'Append-only Bayesian 2PL posterior and stopping-policy trace. Probabilities retain uncertainty and are not themselves mastery evidence.';
