-- Close the publication guard gap in 032: an item inserted directly with
-- status=published must meet the same review/blueprint requirements as one
-- promoted from draft or pilot.
--
-- rollback:
--   DROP TRIGGER assessment_item_publication_guard ON praxis.assessment_item;
--   CREATE TRIGGER assessment_item_publication_guard
--     BEFORE UPDATE ON praxis.assessment_item
--     FOR EACH ROW EXECUTE FUNCTION praxis.guard_published_assessment_item();
--   The weaker pre-033 insert behaviour is intentionally not restored in
--   production; this block exists only for a controlled schema rollback.

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

DROP TRIGGER assessment_item_publication_guard ON praxis.assessment_item;
CREATE TRIGGER assessment_item_publication_guard
BEFORE INSERT OR UPDATE ON praxis.assessment_item
FOR EACH ROW EXECUTE FUNCTION praxis.guard_published_assessment_item();
