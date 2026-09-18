-- Phase 1.4: append-first learner skill evidence and current-state selection.
-- Evidence rows are immutable except for the one-way NULL -> evidence-id
-- superseded_by transition used to link a prior observation to its successor.
-- The evidence_type and confidence lists below are generated from
-- backend/src/kernel/evidence.ts EVIDENCE_LADDER and pinned by a drift test.
--
-- rollback:
--   DROP TRIGGER IF EXISTS skill_evidence_immutable_update
--     ON praxis.skill_evidence;
--   DROP FUNCTION IF EXISTS praxis.guard_skill_evidence_update();
--   DROP TABLE IF EXISTS praxis.skill_evidence;

CREATE TABLE praxis.skill_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL
    REFERENCES praxis.learner(id) ON DELETE CASCADE,
  skill_id text NOT NULL
    REFERENCES praxis.skill(id) ON DELETE RESTRICT,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 4),
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'cv_extracted_unconfirmed',
    'cv_extracted_confirmed',
    'self_declared',
    'quiz_sufficient_coverage',
    'quiz_plus_practical',
    'human_validated'
  )),
  confidence text NOT NULL CHECK (confidence IN (
    'very_low',
    'low',
    'medium',
    'medium_high',
    'high'
  )),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  observed_at timestamptz NOT NULL,
  superseded_by uuid REFERENCES praxis.skill_evidence(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (superseded_by IS NULL OR superseded_by <> id)
);

CREATE INDEX skill_evidence_current_idx
  ON praxis.skill_evidence (learner_id, skill_id, observed_at DESC)
  WHERE superseded_by IS NULL;

CREATE OR REPLACE FUNCTION praxis.guard_skill_evidence_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.superseded_by IS NOT NULL
     OR NEW.superseded_by IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.learner_id IS DISTINCT FROM OLD.learner_id
     OR NEW.skill_id IS DISTINCT FROM OLD.skill_id
     OR NEW.level IS DISTINCT FROM OLD.level
     OR NEW.evidence_type IS DISTINCT FROM OLD.evidence_type
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.provenance IS DISTINCT FROM OLD.provenance
     OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'skill_evidence is immutable except for first superseded_by assignment';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER skill_evidence_immutable_update
BEFORE UPDATE ON praxis.skill_evidence
FOR EACH ROW EXECUTE FUNCTION praxis.guard_skill_evidence_update();

COMMENT ON TABLE praxis.skill_evidence IS
  'Append-first evidence history. Current state uses non-superseded rows and confidence/recency precedence.';
