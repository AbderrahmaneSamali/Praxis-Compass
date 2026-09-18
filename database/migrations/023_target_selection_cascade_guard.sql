-- Preserve append-only target selections while allowing the schema-declared
-- learner ON DELETE CASCADE to complete privacy/fixture deletion workflows.
-- Direct DELETE remains forbidden; only a nested FK cascade may remove rows.
--
-- rollback:
--   CREATE OR REPLACE FUNCTION praxis.guard_target_selection_update()
--   RETURNS trigger LANGUAGE plpgsql AS $$
--   BEGIN
--     IF TG_OP = 'DELETE' THEN
--       RAISE EXCEPTION 'learner_target_selection is append-only';
--     END IF;
--     IF OLD.superseded_by IS NOT NULL
--        OR NEW.id <> OLD.id
--        OR NEW.learner_id <> OLD.learner_id
--        OR NEW.occupation_id <> OLD.occupation_id
--        OR NEW.origin_occupation_id IS DISTINCT FROM OLD.origin_occupation_id
--        OR NEW.source <> OLD.source
--        OR NEW.selected_at <> OLD.selected_at
--        OR NEW.superseded_by IS NULL THEN
--       RAISE EXCEPTION 'only first-time superseded_by assignment is allowed';
--     END IF;
--     RETURN NEW;
--   END
--   $$;

CREATE OR REPLACE FUNCTION praxis.guard_target_selection_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'learner_target_selection is append-only';
  END IF;
  IF OLD.superseded_by IS NOT NULL
     OR NEW.id <> OLD.id
     OR NEW.learner_id <> OLD.learner_id
     OR NEW.occupation_id <> OLD.occupation_id
     OR NEW.origin_occupation_id IS DISTINCT FROM OLD.origin_occupation_id
     OR NEW.source <> OLD.source
     OR NEW.selected_at <> OLD.selected_at
     OR NEW.superseded_by IS NULL THEN
    RAISE EXCEPTION 'only first-time superseded_by assignment is allowed';
  END IF;
  RETURN NEW;
END
$$;
