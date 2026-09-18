-- Governed, data-driven adaptive assessment item bank.
--
-- Existing clash-detection rows are engine fixtures, not calibrated production
-- content. They are deliberately moved to pilot status so they cannot create
-- medium-confidence evidence until a reviewed blueprint and reviewed items are
-- explicitly published.
--
-- rollback:
--   DROP VIEW praxis.assessment_item_bank_coverage;
--   DROP TABLE praxis.assessment_item_pilot_metric;
--   DROP TABLE praxis.assessment_item_review;
--   DROP FUNCTION praxis.guard_published_assessment_item();
--   ALTER TABLE praxis.assessment_session DROP COLUMN blueprint_id,
--     DROP COLUMN delivery_mode;
--   ALTER TABLE praxis.assessment_item DROP CONSTRAINT assessment_item_status_check,
--     DROP COLUMN blueprint_id, DROP COLUMN published_at, DROP COLUMN retired_at;
--   DROP TABLE praxis.assessment_blueprint;
--   UPDATE praxis.assessment_item SET status='published'
--     WHERE item_version='navigator-item-v1' AND status='pilot';
--   This removes governance history; export reviews and pilot metrics first.

CREATE TABLE praxis.assessment_blueprint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id text NOT NULL REFERENCES praxis.skill(id) ON DELETE RESTRICT,
  version text NOT NULL,
  language text NOT NULL CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  cells jsonb NOT NULL CHECK (jsonb_typeof(cells) = 'object'),
  sprt_config jsonb NOT NULL CHECK (jsonb_typeof(sprt_config) = 'object'),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pilot', 'published', 'retired')),
  reviewed_by_learner_id uuid REFERENCES praxis.learner(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version, language),
  CHECK ((status <> 'published') OR (reviewed_by_learner_id IS NOT NULL AND reviewed_at IS NOT NULL AND published_at IS NOT NULL)),
  CHECK ((status <> 'retired') OR retired_at IS NOT NULL)
);

CREATE TRIGGER assessment_blueprint_touch_updated_at
BEFORE UPDATE ON praxis.assessment_blueprint
FOR EACH ROW EXECUTE FUNCTION praxis.touch_updated_at();

ALTER TABLE praxis.assessment_item
  ADD COLUMN blueprint_id uuid REFERENCES praxis.assessment_blueprint(id) ON DELETE RESTRICT,
  ADD COLUMN published_at timestamptz,
  ADD COLUMN retired_at timestamptz;

ALTER TABLE praxis.assessment_item
  DROP CONSTRAINT assessment_item_status_check,
  ADD CONSTRAINT assessment_item_status_check
    CHECK (status IN ('draft', 'pilot', 'published', 'retired'));

CREATE INDEX assessment_item_blueprint_serving_idx
  ON praxis.assessment_item (blueprint_id, target_level, sub_skill_id, status);

CREATE TABLE praxis.assessment_item_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES praxis.assessment_item(id) ON DELETE RESTRICT,
  reviewer_learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'needs_revision')),
  rationale jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rationale) = 'object'),
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assessment_item_review_item_time_idx
  ON praxis.assessment_item_review (item_id, reviewed_at DESC);

CREATE TABLE praxis.assessment_item_pilot_metric (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES praxis.assessment_item(id) ON DELETE RESTRICT,
  blueprint_id uuid NOT NULL REFERENCES praxis.assessment_blueprint(id) ON DELETE RESTRICT,
  sample_size integer NOT NULL CHECK (sample_size >= 0),
  correct_count integer NOT NULL CHECK (correct_count BETWEEN 0 AND sample_size),
  median_response_ms integer CHECK (median_response_ms > 0),
  ambiguity_rate numeric(5,4) NOT NULL DEFAULT 0 CHECK (ambiguity_rate BETWEEN 0 AND 1),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, calculated_at)
);

CREATE INDEX assessment_item_pilot_metric_item_time_idx
  ON praxis.assessment_item_pilot_metric (item_id, calculated_at DESC);

CREATE OR REPLACE FUNCTION praxis.guard_published_assessment_item()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' AND (
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

CREATE TRIGGER assessment_item_publication_guard
BEFORE UPDATE ON praxis.assessment_item
FOR EACH ROW EXECUTE FUNCTION praxis.guard_published_assessment_item();

ALTER TABLE praxis.assessment_session
  ADD COLUMN blueprint_id uuid REFERENCES praxis.assessment_blueprint(id) ON DELETE RESTRICT,
  ADD COLUMN delivery_mode text NOT NULL DEFAULT 'production'
    CHECK (delivery_mode IN ('pilot', 'production'));

-- Fixture rows have no expert review or calibration. They remain usable only
-- in explicitly piloted sessions once a reviewer creates the required records.
UPDATE praxis.assessment_item
SET status = 'pilot'
WHERE item_version = 'navigator-item-v1' AND status = 'published';

ALTER TABLE praxis.assessment_item
  ADD CONSTRAINT assessment_item_published_timestamp
    CHECK ((status <> 'published') OR published_at IS NOT NULL),
  ADD CONSTRAINT assessment_item_retired_timestamp
    CHECK ((status <> 'retired') OR retired_at IS NOT NULL);

CREATE VIEW praxis.assessment_item_bank_coverage AS
SELECT blueprint.id AS blueprint_id,
       blueprint.skill_id,
       blueprint.language,
       blueprint.version,
       blueprint.status AS blueprint_status,
       cell.key AS sub_skill_id,
       level.key AS target_level,
       coalesce((level.value ->> 'target')::integer, 0) AS required_items,
       count(item.id) FILTER (WHERE item.status = 'published') AS published_items,
       count(item.id) FILTER (WHERE item.status = 'pilot') AS pilot_items,
       count(item.id) FILTER (WHERE item.status = 'draft') AS draft_items,
       count(item.id) FILTER (WHERE item.status = 'published') >= coalesce((level.value ->> 'target')::integer, 0) AS covered
FROM praxis.assessment_blueprint AS blueprint
CROSS JOIN LATERAL jsonb_each(blueprint.cells) AS cell(key, value)
CROSS JOIN LATERAL jsonb_each(cell.value) AS level(key, value)
LEFT JOIN praxis.assessment_item AS item
  ON item.blueprint_id = blueprint.id
 AND item.sub_skill_id = cell.key
 AND item.target_level = level.key
GROUP BY blueprint.id, blueprint.skill_id, blueprint.language, blueprint.version,
         blueprint.status, cell.key, level.key, level.value;

COMMENT ON VIEW praxis.assessment_item_bank_coverage IS
  'Publication gate: a skill is assessable only when every non-zero blueprint cell has sufficient reviewed published items.';
