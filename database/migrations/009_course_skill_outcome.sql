-- Phase 1.2: normalize course-to-skill outcomes and ranking projections.
-- On conflict, the typed content_records columns are authoritative for machine
-- ranking and filtering; attributes remains the editorial presentation blob.
-- The two representations must not diverge. Before write APIs mutate these
-- fields, add a synchronization trigger or one application-owned write path.
--
-- Backfill notes:
--   * sector_code is a stable snake-case projection of attributes.sector.
--   * price_mad is NULL when the editorial value is pending/on request.
--   * duration_hours is populated only when attributes.duration states hours;
--     elapsed weeks/days are not silently converted into learning hours.
--
-- rollback:
--   DROP TABLE IF EXISTS praxis.course_skill_outcome;
--   ALTER TABLE praxis.content_records
--     DROP CONSTRAINT IF EXISTS content_records_price_mad_nonnegative,
--     DROP CONSTRAINT IF EXISTS content_records_duration_hours_positive,
--     DROP CONSTRAINT IF EXISTS content_records_languages_valid,
--     DROP COLUMN IF EXISTS product_family,
--     DROP COLUMN IF EXISTS languages,
--     DROP COLUMN IF EXISTS duration_hours,
--     DROP COLUMN IF EXISTS price_mad,
--     DROP COLUMN IF EXISTS level,
--     DROP COLUMN IF EXISTS sector_code;

CREATE TABLE praxis.course_skill_outcome (
  content_record_id uuid NOT NULL
    REFERENCES praxis.content_records(id) ON DELETE CASCADE,
  skill_id text NOT NULL
    REFERENCES praxis.skill(id) ON DELETE RESTRICT,
  outcome_level smallint NOT NULL CHECK (outcome_level BETWEEN 1 AND 4),
  entry_level smallint NOT NULL DEFAULT 0 CHECK (entry_level BETWEEN 0 AND 4),
  weight numeric(4,3) NOT NULL DEFAULT 1.0 CHECK (weight BETWEEN 0 AND 1),
  evidence_type text NOT NULL DEFAULT 'editorial'
    CHECK (evidence_type IN ('editorial', 'esco_derived', 'validated')),
  source_version text NOT NULL,
  validated_at timestamptz,
  validated_by text,
  PRIMARY KEY (content_record_id, skill_id),
  CHECK (entry_level < outcome_level)
);

CREATE INDEX course_skill_outcome_by_skill_idx
  ON praxis.course_skill_outcome (skill_id, outcome_level DESC);

ALTER TABLE praxis.content_records
  ADD COLUMN sector_code text,
  ADD COLUMN level text,
  ADD COLUMN price_mad numeric(10,2),
  ADD COLUMN duration_hours numeric(6,2),
  ADD COLUMN languages text[],
  ADD COLUMN product_family text;

UPDATE praxis.content_records
SET
  sector_code = CASE attributes->>'sector'
    WHEN 'Built Environment' THEN 'built_environment'
    WHEN 'Digital Operations' THEN 'digital_operations'
    WHEN 'Food Systems' THEN 'food_systems'
    WHEN 'Digital & Data' THEN 'digital_data'
    WHEN 'Management' THEN 'management'
    WHEN 'Finance' THEN 'finance'
    WHEN 'People & Organizations' THEN 'people_organizations'
    WHEN 'Academic Foundations' THEN 'academic_foundations'
    ELSE NULL
  END,
  level = NULLIF(attributes->>'level', ''),
  price_mad = CASE
    WHEN attributes->>'price' ~ '^[0-9,]+ MAD$'
      THEN replace(split_part(attributes->>'price', ' ', 1), ',', '')::numeric(10,2)
    ELSE NULL
  END,
  duration_hours = CASE
    WHEN attributes->>'duration' ~ '^[0-9]+([.][0-9]+)? hours$'
      THEN split_part(attributes->>'duration', ' ', 1)::numeric(6,2)
    ELSE NULL
  END,
  languages = CASE
    WHEN NULLIF(attributes->>'language', '') IS NULL THEN NULL
    ELSE regexp_split_to_array(lower(attributes->>'language'), '\s*/\s*')
  END,
  product_family = NULLIF(attributes->>'productFamily', '')
WHERE attributes <> '{}'::jsonb;

ALTER TABLE praxis.content_records
  ADD CONSTRAINT content_records_price_mad_nonnegative
    CHECK (price_mad IS NULL OR price_mad >= 0),
  ADD CONSTRAINT content_records_duration_hours_positive
    CHECK (duration_hours IS NULL OR duration_hours > 0),
  ADD CONSTRAINT content_records_languages_valid
    CHECK (
      languages IS NULL OR
      languages <@ ARRAY['en', 'fr']::text[]
    );

COMMENT ON TABLE praxis.course_skill_outcome IS
  'Versioned evidence edges describing the skills taught by a catalog record.';
COMMENT ON COLUMN praxis.content_records.sector_code IS
  'Authoritative machine-readable projection of attributes.sector for ranking; the editorial blob must remain synchronized.';
COMMENT ON COLUMN praxis.content_records.level IS
  'Authoritative machine-readable projection of attributes.level for ranking; the editorial blob must remain synchronized.';
COMMENT ON COLUMN praxis.content_records.price_mad IS
  'Authoritative numeric price projection in MAD; NULL means the editorial source did not state a numeric price.';
COMMENT ON COLUMN praxis.content_records.duration_hours IS
  'Authoritative learning-hours projection; NULL means the editorial source stated elapsed duration rather than learning hours.';
COMMENT ON COLUMN praxis.content_records.languages IS
  'Authoritative normalized language-code projection of attributes.language.';
COMMENT ON COLUMN praxis.content_records.product_family IS
  'Authoritative machine-readable projection of attributes.productFamily for ranking; the editorial blob must remain synchronized.';
