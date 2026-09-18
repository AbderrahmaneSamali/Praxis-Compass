-- Phase 1.1: connect PRAXIS identities to the now-active immutable ESCO schema.
-- Individual source-file checksums supplement the manifest checksum retained in
-- esco_releases.source_checksum. Mapping status and notes make deliberately
-- unanchored product/tool skills explicit rather than encouraging weak matches.
--
-- rollback:
--   ALTER TABLE praxis.occupation
--     DROP CONSTRAINT IF EXISTS occupation_esco_occupation_uri_fkey,
--     DROP COLUMN IF EXISTS esco_mapping_note,
--     DROP COLUMN IF EXISTS esco_mapping_status;
--   ALTER TABLE praxis.skill
--     DROP CONSTRAINT IF EXISTS skill_esco_skill_uri_fkey,
--     DROP COLUMN IF EXISTS esco_mapping_note,
--     DROP COLUMN IF EXISTS esco_mapping_status;
--   ALTER TABLE praxis.esco_releases
--     DROP COLUMN IF EXISTS source_checksums;

ALTER TABLE praxis.esco_releases
  ADD COLUMN source_checksums jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_checksums) = 'object');

ALTER TABLE praxis.skill
  ADD COLUMN esco_mapping_status text NOT NULL DEFAULT 'pending_review'
    CHECK (
      esco_mapping_status IN (
        'anchored',
        'deliberately_unanchored',
        'pending_review'
      )
    ),
  ADD COLUMN esco_mapping_note text,
  ADD CONSTRAINT skill_esco_skill_uri_fkey
    FOREIGN KEY (esco_skill_uri)
    REFERENCES praxis.esco_skills(concept_uri) ON DELETE RESTRICT;

ALTER TABLE praxis.occupation
  ADD COLUMN esco_mapping_status text NOT NULL DEFAULT 'pending_review'
    CHECK (
      esco_mapping_status IN (
        'anchored',
        'deliberately_unanchored',
        'pending_review'
      )
    ),
  ADD COLUMN esco_mapping_note text,
  ADD CONSTRAINT occupation_esco_occupation_uri_fkey
    FOREIGN KEY (esco_occupation_uri)
    REFERENCES praxis.esco_occupations(concept_uri) ON DELETE RESTRICT;

ALTER TABLE praxis.skill
  ADD CONSTRAINT skill_esco_mapping_consistent CHECK (
    (esco_mapping_status = 'anchored' AND esco_skill_uri IS NOT NULL)
    OR
    (esco_mapping_status <> 'anchored' AND esco_skill_uri IS NULL)
  );

ALTER TABLE praxis.occupation
  ADD CONSTRAINT occupation_esco_mapping_consistent CHECK (
    (esco_mapping_status = 'anchored' AND esco_occupation_uri IS NOT NULL)
    OR
    (esco_mapping_status <> 'anchored' AND esco_occupation_uri IS NULL)
  );

COMMENT ON COLUMN praxis.skill.esco_mapping_status IS
  'Review state for the optional immutable ESCO anchor; tool-level PRAXIS skills may be deliberately unanchored.';
COMMENT ON COLUMN praxis.skill.esco_mapping_note IS
  'Human-readable review rationale only; recommendation facts must cite structured record ids.';
COMMENT ON COLUMN praxis.esco_releases.source_checksums IS
  'SHA-256 checksums keyed by source filename; source_checksum is the deterministic checksum of this manifest.';
