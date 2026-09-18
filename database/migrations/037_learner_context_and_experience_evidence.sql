-- Tier 1 learner context and CV-experience evidence.
-- Context rows are immutable snapshots. A later answer inserts a replacement
-- and marks the prior snapshot superseded; a blank field means "not answered",
-- while declined_fields preserves an explicit preference not to answer.
--
-- rollback:
--   DROP TRIGGER IF EXISTS learner_context_immutable_update ON praxis.learner_context;
--   DROP FUNCTION IF EXISTS praxis.guard_learner_context_update();
--   DROP TABLE IF EXISTS praxis.learner_context;
--   ALTER TABLE praxis.skill_evidence DROP CONSTRAINT skill_evidence_evidence_type_check;
--   ALTER TABLE praxis.skill_evidence ADD CONSTRAINT skill_evidence_evidence_type_check
--     CHECK (evidence_type IN ('cv_extracted_unconfirmed','cv_extracted_confirmed',
--       'self_declared','quiz_sufficient_coverage','quiz_plus_practical','human_validated'));
--   (Do not roll back once cv_experience_inferred rows exist.)

CREATE TABLE praxis.learner_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  context_version text NOT NULL,
  motivation text CHECK (motivation IN ('career_change','promotion','employer_required','job_seeking','exploration')),
  situation text CHECK (situation IN ('employed','seeking','studying','between_contracts')),
  deadline date,
  budget_band text CHECK (budget_band IN ('range','unknown')),
  budget_min_mad numeric(10,2) CHECK (budget_min_mad >= 0),
  budget_max_mad numeric(10,2) CHECK (budget_max_mad >= 0),
  hours_per_week numeric(5,2) CHECK (hours_per_week > 0 AND hours_per_week <= 168),
  format_pref text[] CHECK (format_pref <@ ARRAY['présentiel','en ligne','hybride']::text[]),
  location_city text,
  remote_only boolean,
  languages text[],
  intensity_pref text CHECK (intensity_pref IN ('intensive','progressif')),
  prefilled_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  declined_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  superseded_by uuid REFERENCES praxis.learner_context(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (budget_band IS DISTINCT FROM 'range' OR (budget_min_mad IS NOT NULL AND budget_max_mad IS NOT NULL)),
  CHECK (budget_min_mad IS NULL OR budget_max_mad IS NULL OR budget_min_mad <= budget_max_mad),
  CHECK (remote_only IS DISTINCT FROM true OR location_city IS NULL),
  CHECK (superseded_by IS NULL OR superseded_by <> id)
);

CREATE INDEX learner_context_current_idx
  ON praxis.learner_context (learner_id, created_at DESC)
  WHERE superseded_by IS NULL;

CREATE OR REPLACE FUNCTION praxis.guard_learner_context_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.superseded_by IS NOT NULL OR NEW.superseded_by IS NULL
     OR to_jsonb(NEW) - 'superseded_by' IS DISTINCT FROM to_jsonb(OLD) - 'superseded_by' THEN
    RAISE EXCEPTION 'learner_context is immutable except for first superseded_by assignment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER learner_context_immutable_update
BEFORE UPDATE ON praxis.learner_context
FOR EACH ROW EXECUTE FUNCTION praxis.guard_learner_context_update();

ALTER TABLE praxis.skill_evidence
  DROP CONSTRAINT skill_evidence_evidence_type_check,
  ADD CONSTRAINT skill_evidence_evidence_type_check CHECK (evidence_type IN (
    'cv_extracted_unconfirmed', 'cv_extracted_confirmed', 'self_declared',
    'cv_experience_inferred', 'quiz_sufficient_coverage',
    'quiz_plus_practical', 'human_validated'
  ));

ALTER TABLE praxis.skill_evidence
  DROP CONSTRAINT skill_evidence_confidence_check,
  ADD CONSTRAINT skill_evidence_confidence_check CHECK (confidence IN (
    'very_low', 'low', 'medium_low', 'medium', 'medium_high', 'high'
  ));

COMMENT ON TABLE praxis.learner_context IS
  'Append-only learner-stated planning context. NULL is unanswered; declined_fields is an explicit no-answer.';
COMMENT ON COLUMN praxis.skill_evidence.evidence_type IS
  'cv_experience_inferred is a confirmed-CV duration/recency inference: below tested evidence, above raw extraction.';
