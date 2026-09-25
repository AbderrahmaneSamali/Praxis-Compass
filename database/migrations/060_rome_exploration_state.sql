-- Learner-owned ROME exploration state. Migration 059 holds immutable source
-- rows; this migration keeps confirmations and actions separate from them.
-- The earlier editorial catalogue (058) remains available for demonstration.

ALTER TABLE praxis.exploration_profile
  ADD COLUMN current_rome_code character(5)
    REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT;

CREATE TABLE praxis.exploration_confirmed_interest (
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  centre_code integer NOT NULL REFERENCES praxis.rome_interest_centres(centre_code) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (learner_id, centre_code)
);

CREATE TABLE praxis.rome_requirement_confirmation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  code_ogr bigint NOT NULL REFERENCES praxis.rome_items(code_ogr) ON DELETE RESTRICT,
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  response text NOT NULL CHECK (response IN ('practiced','not_yet','unsure')),
  work_example text NOT NULL DEFAULT '',
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  superseded_by uuid,
  UNIQUE (id, learner_id, code_ogr),
  FOREIGN KEY (superseded_by, learner_id, code_ogr)
    REFERENCES praxis.rome_requirement_confirmation(id, learner_id, code_ogr) ON DELETE RESTRICT,
  CHECK (response <> 'practiced' OR length(trim(work_example)) >= 5)
);
CREATE INDEX rome_requirement_confirmation_active_idx
  ON praxis.rome_requirement_confirmation (learner_id, code_ogr, recorded_at DESC)
  WHERE superseded_by IS NULL;

CREATE FUNCTION praxis.guard_rome_confirmation_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.superseded_by IS NOT NULL OR NEW.superseded_by IS NULL
     OR (to_jsonb(NEW) - 'superseded_by') <> (to_jsonb(OLD) - 'superseded_by') THEN
    RAISE EXCEPTION 'ROME confirmations are append-only except superseded_by';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rome_requirement_confirmation_update_guard
  BEFORE UPDATE ON praxis.rome_requirement_confirmation
  FOR EACH ROW EXECUTE FUNCTION praxis.guard_rome_confirmation_update();

CREATE TABLE praxis.exploration_saved_rome_direction (
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (learner_id, code_rome)
);

CREATE TABLE praxis.exploration_selected_rome_action (
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  action_id text NOT NULL,
  selected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (learner_id, code_rome, action_id)
);

CREATE TABLE praxis.exploration_rome_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  code_rome character(5) REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  useful boolean NOT NULL,
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
