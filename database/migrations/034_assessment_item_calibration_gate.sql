-- Calibration metadata and a hard publication gate for assessment items.
-- Pilot data may inform these values; it never produces learner mastery
-- evidence. A published item must have an explicit calibrated status.
--
-- rollback:
--   ALTER TABLE praxis.assessment_item DROP CONSTRAINT assessment_item_calibration_status_check,
--     DROP COLUMN difficulty, DROP COLUMN discrimination,
--     DROP COLUMN calibration_status, DROP COLUMN calibrated_at;
--   Re-apply the exact function body from 033_assessment_publication_insert_guard.sql.
--   This preserves review and blueprint gates while deliberately removing only
--   calibration enforcement; do not do this on a live learner surface.

ALTER TABLE praxis.assessment_item
  ADD COLUMN difficulty numeric(6,3)
    CHECK (difficulty BETWEEN -4 AND 4),
  ADD COLUMN discrimination numeric(6,3)
    CHECK (discrimination > 0 AND discrimination <= 4),
  ADD COLUMN calibration_status text NOT NULL DEFAULT 'uncalibrated'
    CHECK (calibration_status IN ('uncalibrated', 'pilot', 'calibrated', 'rejected')),
  ADD COLUMN calibrated_at timestamptz;

CREATE OR REPLACE FUNCTION praxis.guard_published_assessment_item()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' AND (
    NEW.item_payload IS DISTINCT FROM OLD.item_payload
    OR NEW.target_level IS DISTINCT FROM OLD.target_level
    OR NEW.sub_skill_id IS DISTINCT FROM OLD.sub_skill_id
    OR NEW.blueprint_id IS DISTINCT FROM OLD.blueprint_id
    OR NEW.item_version IS DISTINCT FROM OLD.item_version
  ) THEN
    RAISE EXCEPTION 'Published assessment items are immutable; create a new version instead';
  END IF;
  IF NEW.status = 'published' THEN
    IF NEW.blueprint_id IS NULL THEN
      RAISE EXCEPTION 'Published assessment item requires a blueprint';
    END IF;
    IF NEW.calibration_status <> 'calibrated'
       OR NEW.difficulty IS NULL OR NEW.discrimination IS NULL
       OR NEW.calibrated_at IS NULL THEN
      RAISE EXCEPTION 'Published assessment item requires calibrated pilot evidence';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM praxis.assessment_item_review AS review
       WHERE review.item_id = NEW.id AND review.decision = 'approved'
    ) THEN
      RAISE EXCEPTION 'Published assessment item requires an approved review';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
