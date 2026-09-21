-- AI-assisted assessment-item drafting with mandatory independent expert review.
-- Generated content can enter only as an uncalibrated draft. The latest review
-- controls promotion, and AI-assisted items need an attesting subject-matter expert.

ALTER TABLE praxis.assessment_item
  DROP CONSTRAINT assessment_item_item_payload_check,
  ADD CONSTRAINT assessment_item_item_payload_check CHECK (
    jsonb_typeof(item_payload) = 'object'
    AND jsonb_typeof(item_payload -> 'options') = 'array'
    AND item_payload ? 'keyOptionId'
    AND (item_payload ? 'stem' OR item_payload ? 'stemFr')
  );

CREATE TABLE praxis.assessment_item_generation_run (
  id uuid PRIMARY KEY,
  request_id text NOT NULL UNIQUE CHECK (request_id ~ '^item-draft-[a-f0-9]{24}$'),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  blueprint_id uuid NOT NULL REFERENCES praxis.assessment_blueprint(id) ON DELETE RESTRICT,
  requested_by_learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  model text NOT NULL,
  model_parameters jsonb NOT NULL CHECK (jsonb_typeof(model_parameters) = 'object'),
  prompt_template_version text NOT NULL,
  source_manifest jsonb NOT NULL CHECK (jsonb_typeof(source_manifest) = 'array'),
  algorithm_version text NOT NULL,
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  result_hash text NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (requested_by_learner_id, request_digest)
);

ALTER TABLE praxis.assessment_item
  ADD COLUMN content_origin text NOT NULL DEFAULT 'human_authored'
    CHECK (content_origin IN ('human_authored', 'ai_assisted')),
  ADD COLUMN generation_run_id uuid
    REFERENCES praxis.assessment_item_generation_run(id) ON DELETE RESTRICT,
  ADD COLUMN generation_candidate_index smallint CHECK (generation_candidate_index >= 0),
  ADD CONSTRAINT assessment_item_generation_origin_consistent CHECK (
    (content_origin = 'human_authored' AND generation_run_id IS NULL AND generation_candidate_index IS NULL)
    OR (content_origin = 'ai_assisted' AND generation_run_id IS NOT NULL AND generation_candidate_index IS NOT NULL)
  ),
  ADD CONSTRAINT assessment_item_generation_candidate_unique UNIQUE (generation_run_id, generation_candidate_index);

CREATE TABLE praxis.assessment_item_generation_candidate (
  generation_run_id uuid NOT NULL
    REFERENCES praxis.assessment_item_generation_run(id) ON DELETE RESTRICT,
  candidate_index smallint NOT NULL CHECK (candidate_index >= 0),
  item_id uuid UNIQUE REFERENCES praxis.assessment_item(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('accepted_as_draft', 'rejected_validation')),
  candidate_snapshot jsonb NOT NULL CHECK (jsonb_typeof(candidate_snapshot) = 'object'),
  validation_issues jsonb NOT NULL CHECK (jsonb_typeof(validation_issues) = 'array'),
  draft_hash text CHECK (draft_hash IS NULL OR draft_hash ~ '^[a-f0-9]{64}$'),
  review_material jsonb NOT NULL CHECK (jsonb_typeof(review_material) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (generation_run_id, candidate_index),
  CHECK ((status = 'accepted_as_draft') = (item_id IS NOT NULL)),
  CHECK ((status = 'accepted_as_draft') = (draft_hash IS NOT NULL))
);

ALTER TABLE praxis.assessment_item_review
  ADD COLUMN reviewer_role text CHECK (reviewer_role IN (
    'subject_matter_expert', 'psychometrician', 'language_reviewer'
  )),
  ADD COLUMN expert_attestation boolean,
  ADD COLUMN review_checklist jsonb CHECK (
    review_checklist IS NULL OR jsonb_typeof(review_checklist) = 'object'
  );

CREATE OR REPLACE FUNCTION praxis.guard_assessment_authoring_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Assessment authoring and review history is append-only';
END;
$$;

CREATE TRIGGER assessment_item_generation_run_immutable
BEFORE UPDATE OR DELETE ON praxis.assessment_item_generation_run
FOR EACH ROW EXECUTE FUNCTION praxis.guard_assessment_authoring_history();

CREATE TRIGGER assessment_item_generation_candidate_immutable
BEFORE UPDATE OR DELETE ON praxis.assessment_item_generation_candidate
FOR EACH ROW EXECUTE FUNCTION praxis.guard_assessment_authoring_history();

CREATE TRIGGER assessment_item_review_immutable
BEFORE UPDATE OR DELETE ON praxis.assessment_item_review
FOR EACH ROW EXECUTE FUNCTION praxis.guard_assessment_authoring_history();

CREATE OR REPLACE FUNCTION praxis.guard_published_assessment_item()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  latest_review praxis.assessment_item_review%ROWTYPE;
  requester uuid;
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

  IF NEW.status IN ('pilot', 'published') THEN
    SELECT * INTO latest_review
    FROM praxis.assessment_item_review review
    WHERE review.item_id = NEW.id
    ORDER BY review.reviewed_at DESC, review.id DESC
    LIMIT 1;

    IF latest_review.id IS NULL OR latest_review.decision <> 'approved' THEN
      RAISE EXCEPTION 'Pilot or published assessment item requires a current approved review';
    END IF;

    IF NEW.content_origin = 'ai_assisted' THEN
      SELECT requested_by_learner_id INTO requester
      FROM praxis.assessment_item_generation_run WHERE id = NEW.generation_run_id;
      IF latest_review.reviewer_role <> 'subject_matter_expert'
         OR latest_review.expert_attestation IS DISTINCT FROM true
         OR latest_review.reviewer_learner_id = requester
         OR latest_review.review_checklist IS NULL
         OR coalesce((latest_review.review_checklist ->> 'factualAccuracy')::boolean, false) IS NOT true
         OR coalesce((latest_review.review_checklist ->> 'singleBestAnswer')::boolean, false) IS NOT true
         OR coalesce((latest_review.review_checklist ->> 'distractorQuality')::boolean, false) IS NOT true
         OR coalesce((latest_review.review_checklist ->> 'objectiveAlignment')::boolean, false) IS NOT true
         OR coalesce((latest_review.review_checklist ->> 'languageQuality')::boolean, false) IS NOT true
         OR coalesce((latest_review.review_checklist ->> 'biasAndAccessibility')::boolean, false) IS NOT true
         OR coalesce((latest_review.review_checklist ->> 'sourceGrounding')::boolean, false) IS NOT true THEN
        RAISE EXCEPTION 'AI-assisted item requires independent subject-matter-expert approval with a complete checklist';
      END IF;
    END IF;
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
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON TABLE praxis.assessment_item_generation_run IS
  'Immutable provenance for AI-assisted draft generation; source text is represented only by a hashed manifest.';
COMMENT ON TABLE praxis.assessment_item_generation_candidate IS
  'Every model candidate, including structurally rejected output. Accepted candidates map only to uncalibrated drafts.';
