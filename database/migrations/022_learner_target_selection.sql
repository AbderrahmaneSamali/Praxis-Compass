-- Learner-selected occupation targets and versioned ESCO-derived target profiles.
-- Destination occupations are inputs supplied by learners; no row in this
-- migration represents a destination recommendation.
-- ISCO major group is derived from the first digit of the active ESCO
-- occupation version's esco_notation value.
--
-- rollback:
--   DROP TRIGGER IF EXISTS role_transition_outcome_append_only ON praxis.role_transition_outcome;
--   DROP TRIGGER IF EXISTS role_transition_outcome_consent_gate ON praxis.role_transition_outcome;
--   DROP TRIGGER IF EXISTS learner_target_selection_guard ON praxis.learner_target_selection;
--   DROP FUNCTION IF EXISTS praxis.guard_role_transition_outcome_consent();
--   DROP FUNCTION IF EXISTS praxis.guard_append_only_row();
--   DROP FUNCTION IF EXISTS praxis.guard_target_selection_update();
--   DROP TABLE IF EXISTS praxis.role_transition_outcome;
--   DROP TABLE IF EXISTS praxis.learner_target_selection;
--   DROP INDEX IF EXISTS praxis.esco_occupation_versions_full_search_fr_idx;
--   DROP INDEX IF EXISTS praxis.esco_occupation_versions_full_search_en_idx;
--   DROP FUNCTION IF EXISTS praxis.occupation_search_document(text, text[], text);
--   DROP INDEX IF EXISTS praxis.occupation_esco_uri_unique_idx;
--   ALTER TABLE praxis.navigator_role_skill_targets
--     DROP COLUMN IF EXISTS inputs_hash,
--     DROP COLUMN IF EXISTS algorithm_version,
--     DROP COLUMN IF EXISTS profile_computed_at,
--     DROP COLUMN IF EXISTS profile_source;
--   ALTER TABLE praxis.occupation
--     DROP COLUMN IF EXISTS isco_major_group,
--     DROP COLUMN IF EXISTS label_en;

ALTER TABLE praxis.occupation
  ADD COLUMN label_en text,
  ADD COLUMN isco_major_group smallint
    CHECK (isco_major_group BETWEEN 0 AND 9);

COMMENT ON COLUMN praxis.occupation.isco_major_group IS
  'ISCO-08 major group derived from the first digit of esco_occupation_versions.esco_notation; descriptive metadata only until the evidence-gated Stage 4 policy is approved.';

CREATE UNIQUE INDEX occupation_esco_uri_unique_idx
  ON praxis.occupation (esco_occupation_uri)
  WHERE esco_occupation_uri IS NOT NULL;

UPDATE praxis.occupation AS occupation
SET isco_major_group = substring(version.esco_notation FROM '^[0-9]')::smallint,
    label_en = CASE
      WHEN version.language = 'en' THEN version.preferred_label
      ELSE occupation.label_en
    END
FROM praxis.esco_occupation_versions AS version
JOIN praxis.esco_releases AS release
  ON release.id = version.release_id AND release.is_active
WHERE occupation.esco_occupation_uri = version.occupation_uri
  AND version.esco_notation ~ '^[0-9]';

ALTER TABLE praxis.navigator_role_skill_targets
  ADD COLUMN profile_source text NOT NULL DEFAULT 'authored'
    CHECK (profile_source IN ('derived_from_esco', 'authored')),
  ADD COLUMN algorithm_version text,
  ADD COLUMN inputs_hash text,
  ADD COLUMN profile_computed_at timestamptz,
  ADD CONSTRAINT navigator_role_skill_targets_derived_provenance CHECK (
    profile_source = 'authored'
    OR (
      algorithm_version IS NOT NULL
      AND inputs_hash IS NOT NULL
      AND profile_computed_at IS NOT NULL
    )
  );

COMMENT ON COLUMN praxis.navigator_role_skill_targets.profile_source IS
  'authored rows override derived_from_esco rows for the same role and skill; derived profiles use the registered ESCO target-profile policy.';

CREATE FUNCTION praxis.occupation_search_document(
  preferred_label text,
  alternative_labels text[],
  description text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN praxis.unaccent_immutable(
  coalesce(preferred_label, '') || ' ' ||
  array_to_string(coalesce(alternative_labels, '{}'), ' ') || ' ' ||
  coalesce(description, '')
);

CREATE INDEX esco_occupation_versions_full_search_en_idx
  ON praxis.esco_occupation_versions USING gin (
    to_tsvector(
      'english',
      praxis.occupation_search_document(
        preferred_label, alternative_labels, description
      )
    )
  ) WHERE language = 'en';

CREATE INDEX esco_occupation_versions_full_search_fr_idx
  ON praxis.esco_occupation_versions USING gin (
    to_tsvector(
      'french',
      praxis.occupation_search_document(
        preferred_label, alternative_labels, description
      )
    )
  ) WHERE language = 'fr';

CREATE TABLE praxis.learner_target_selection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL
    REFERENCES praxis.learner(id) ON DELETE CASCADE,
  occupation_id text NOT NULL
    REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  origin_occupation_id text
    REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  source text NOT NULL
    CHECK (source IN ('picker', 'adjacency_panel', 'cv_inferred')),
  superseded_by uuid
    REFERENCES praxis.learner_target_selection(id) DEFERRABLE INITIALLY DEFERRED,
  selected_at timestamptz NOT NULL DEFAULT now(),
  CHECK (superseded_by IS NULL OR superseded_by <> id)
);

CREATE INDEX learner_target_selection_current_idx
  ON praxis.learner_target_selection (learner_id, selected_at DESC)
  WHERE superseded_by IS NULL;

CREATE INDEX learner_target_selection_occupation_idx
  ON praxis.learner_target_selection (occupation_id, selected_at DESC);

CREATE TABLE praxis.role_transition_outcome (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL
    REFERENCES praxis.learner(id) ON DELETE CASCADE,
  origin_occupation_id text
    REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  target_occupation_id text NOT NULL
    REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN
    ('attained', 'partially_attained', 'abandoned', 'still_pursuing')),
  evidence_source text NOT NULL CHECK (evidence_source IN
    ('self_reported', 'employer_confirmed', 'credential_verified')),
  consent_id uuid
    REFERENCES praxis.consent_records(id) ON DELETE RESTRICT,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX role_transition_outcome_pair_idx
  ON praxis.role_transition_outcome
  (origin_occupation_id, target_occupation_id, observed_at DESC);

CREATE FUNCTION praxis.guard_target_selection_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
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

CREATE TRIGGER learner_target_selection_guard
BEFORE UPDATE OR DELETE ON praxis.learner_target_selection
FOR EACH ROW EXECUTE FUNCTION praxis.guard_target_selection_update();

CREATE FUNCTION praxis.guard_append_only_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER role_transition_outcome_append_only
BEFORE UPDATE OR DELETE ON praxis.role_transition_outcome
FOR EACH ROW EXECUTE FUNCTION praxis.guard_append_only_row();

CREATE FUNCTION praxis.guard_role_transition_outcome_consent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.evidence_source = 'employer_confirmed' AND NOT EXISTS (
    SELECT 1
    FROM praxis.consent_records AS consent
    WHERE consent.id = NEW.consent_id
      AND consent.status = 'active'
      AND consent.valid_from <= NEW.observed_at
      AND (consent.valid_until IS NULL OR consent.valid_until > NEW.observed_at)
      AND (
        coalesce(consent.scope->'uses', '[]'::jsonb) ? 'role_transition_outcome'
        OR coalesce(consent.scope->'uses', '[]'::jsonb) ? 'role_transition_outcome:employer_confirmed'
      )
  ) THEN
    RAISE EXCEPTION 'active consent covering employer-confirmed role transition is required';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER role_transition_outcome_consent_gate
BEFORE INSERT ON praxis.role_transition_outcome
FOR EACH ROW EXECUTE FUNCTION praxis.guard_role_transition_outcome_consent();
