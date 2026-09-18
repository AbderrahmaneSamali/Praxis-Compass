-- Probabilistic adaptive Navigator extensions.
--
-- Extends, rather than replaces, migration 030's diagnostic ledger. Existing
-- sessions remain replayable under their stored algorithm version. New
-- sessions carry enough input, utility, and posterior evidence for an audit or
-- a future shadow-policy replay.
--
-- rollback:
--   DROP TABLE praxis.diagnostic_observation;
--   ALTER TABLE praxis.diagnostic_inferred_fact
--     DROP COLUMN source_evidence_id, DROP COLUMN inference_strength,
--     DROP COLUMN correction_provenance;
--   ALTER TABLE praxis.diagnostic_step
--     DROP COLUMN answer_payload, DROP COLUMN partition_definition,
--     DROP COLUMN question_locale, DROP COLUMN utility, DROP COLUMN utility_factors,
--     DROP COLUMN likelihood_model, DROP COLUMN selection_reason,
--     DROP COLUMN posterior_before, DROP COLUMN posterior_after;
--   ALTER TABLE praxis.diagnostic_session
--     DROP COLUMN locale, DROP COLUMN taxonomy_releases, DROP COLUMN state,
--     DROP COLUMN resumed_at, DROP COLUMN abandoned_at;
--   Export new-session trace data first; this loses audit detail introduced by
--   this migration and is therefore a practical rollback only.

ALTER TABLE praxis.diagnostic_session
  ADD COLUMN locale text NOT NULL DEFAULT 'fr',
  ADD COLUMN taxonomy_releases jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(taxonomy_releases) = 'object'),
  ADD COLUMN state jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(state) = 'object'),
  ADD COLUMN resumed_at timestamptz,
  ADD COLUMN abandoned_at timestamptz;

COMMENT ON COLUMN praxis.diagnostic_session.taxonomy_releases IS
  'Immutable taxonomy release ids used to form this session posterior.';
COMMENT ON COLUMN praxis.diagnostic_session.state IS
  'Replayable non-authoritative summary: posterior leaders, phase and handoff state.';

ALTER TABLE praxis.diagnostic_step
  ADD COLUMN question_locale text NOT NULL DEFAULT 'fr',
  ADD COLUMN partition_definition jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(partition_definition) = 'object'),
  ADD COLUMN utility numeric(12,8),
  ADD COLUMN utility_factors jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(utility_factors) = 'object'),
  ADD COLUMN likelihood_model jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(likelihood_model) = 'object'),
  ADD COLUMN selection_reason jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(selection_reason) = 'object'),
  ADD COLUMN posterior_before jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(posterior_before) = 'array'),
  ADD COLUMN posterior_after jsonb
    CHECK (posterior_after IS NULL OR jsonb_typeof(posterior_after) = 'array'),
  ADD COLUMN answer_payload jsonb
    CHECK (answer_payload IS NULL OR jsonb_typeof(answer_payload) = 'object');

COMMENT ON COLUMN praxis.diagnostic_step.selection_reason IS
  'Structured evidence explaining why this question won over available alternatives.';
COMMENT ON COLUMN praxis.diagnostic_step.posterior_before IS
  'Top posterior candidates at ask time; full posterior is deterministically replayed from steps.';

ALTER TABLE praxis.diagnostic_inferred_fact
  ADD COLUMN source_evidence_id uuid
    REFERENCES praxis.skill_evidence(id) ON DELETE RESTRICT,
  ADD COLUMN inference_strength numeric(4,3)
    CHECK (inference_strength IS NULL OR (inference_strength > 0 AND inference_strength < 1)),
  ADD COLUMN correction_provenance jsonb
    CHECK (correction_provenance IS NULL OR jsonb_typeof(correction_provenance) = 'object');

CREATE TABLE praxis.diagnostic_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL
    REFERENCES praxis.diagnostic_session(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN (
    'started', 'resumed', 'answer_submitted', 'backtracked', 'abandoned',
    'shortlist_presented', 'target_selected', 'skill_assessment_offered',
    'skill_assessment_started', 'skill_assessment_completed',
    'recommendation_handoff', 'shadow_evaluated'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  algorithm_version text NOT NULL,
  inputs_hash text NOT NULL CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX diagnostic_observation_session_time_idx
  ON praxis.diagnostic_observation (session_id, occurred_at);
CREATE INDEX diagnostic_observation_kind_time_idx
  ON praxis.diagnostic_observation (kind, occurred_at DESC);

COMMENT ON TABLE praxis.diagnostic_observation IS
  'Append-only adaptive-Navigator telemetry and handoff trace; never a source of taxonomy facts.';
