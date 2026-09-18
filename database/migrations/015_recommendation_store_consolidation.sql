-- Consolidate pathways and current recommendation persistence after approval of
-- docs/proposals/recommendation-store.md on 2026-08-21.
-- Legacy result rows are retained only in access-revoked *_retired audit tables;
-- they are not relabelled as Phase 2 output and are never copied into the new
-- canonical snapshot store.
--
-- paired down-migration note:
--   Take a database backup before applying. To roll back during the retention
--   window: stop the new recommendation writer; drop the new recommendations,
--   pathway_definition and recommendation_weights tables; recreate praxis.pathway
--   from the deterministic legacy keys retained by pathway_definition; restore
--   text pathway ids on the two migrated reference tables; rename both retired
--   result tables to their original names and restore their grants/FKs. New UUID
--   recommendation snapshots cannot be truthfully converted to legacy scores.

CREATE TABLE praxis.recommendation_weights (
  version text PRIMARY KEY,
  weights jsonb NOT NULL CHECK (jsonb_typeof(weights) = 'object'),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'shadow', 'retired')),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'active' AND activated_at IS NOT NULL) OR status <> 'active')
);

CREATE UNIQUE INDEX recommendation_weights_one_active_idx
  ON praxis.recommendation_weights ((status))
  WHERE status = 'active';

INSERT INTO praxis.recommendation_weights
  (version, weights, status, activated_at)
VALUES (
  'praxis-rank-v1',
  '{
    "gap_coverage": 0.28,
    "precision": 0.18,
    "level_fit": 0.14,
    "evidence_confidence": 0.10,
    "constraint_fit": 0.10,
    "outcome_prior": 0.05,
    "scarcity": 0.08,
    "freshness": 0.07,
    "redundancy_penalty": 0.12
  }'::jsonb,
  'active',
  now()
);

CREATE TABLE praxis.pathway_definition (
  content_record_id uuid PRIMARY KEY
    REFERENCES praxis.content_records(id) ON DELETE CASCADE,
  target_occupation_id text NOT NULL
    REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  variant text NOT NULL CHECK (
    variant IN ('essentielle', 'acceleree', 'certifiante')
  ),
  definition_version text NOT NULL,
  legacy_pathway_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TEMP TABLE pathway_identity_015 (
  legacy_pathway_key text PRIMARY KEY,
  content_record_id uuid NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE
) ON COMMIT DROP;

CREATE TEMP TABLE pathway_migration_counts_015 AS
SELECT
  (SELECT count(*) FROM praxis.pathway) AS pathway_count,
  (SELECT count(*) FROM praxis.skill_pathway_ref) AS skill_ref_count,
  (SELECT count(*) FROM praxis.navigator_pathway_steps) AS step_count;

INSERT INTO pathway_identity_015
  (legacy_pathway_key, content_record_id, slug)
VALUES
  (
    'path_bim_coord_essential',
    md5('praxis:pathway:path_bim_coord_essential')::uuid,
    'navigator-bim-coordinateur-essentielle'
  ),
  (
    'path_bim_coord_acceleree',
    md5('praxis:pathway:path_bim_coord_acceleree')::uuid,
    'navigator-bim-coordinateur-acceleree'
  ),
  (
    'path_bim_coord_certifiante',
    md5('praxis:pathway:path_bim_coord_certifiante')::uuid,
    'navigator-bim-coordinateur-certifiante'
  );

INSERT INTO praxis.content_records
  (
    id, record_type, slug, title, status, summary, attributes, version,
    sector_code, level, languages, product_family
  )
SELECT
  identity.content_record_id,
  'pathway',
  identity.slug,
  pathway.label,
  'draft',
  coalesce(pathway.summary, ''),
  jsonb_build_object(
    'legacyPathwayKey', pathway.id,
    'variant', pathway.variant,
    'sourceVersion', pathway.version,
    'format', 'Guided pathway',
    'language', 'FR'
  ),
  1,
  occupation.sector_code,
  'Scenario',
  ARRAY['fr']::text[],
  'Navigator'
FROM praxis.pathway AS pathway
JOIN pathway_identity_015 AS identity
  ON identity.legacy_pathway_key = pathway.id
JOIN praxis.occupation AS occupation
  ON occupation.id = pathway.metier_target_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO praxis.pathway_definition
  (
    content_record_id, target_occupation_id, variant,
    definition_version, legacy_pathway_key
  )
SELECT
  identity.content_record_id,
  pathway.metier_target_id,
  pathway.variant,
  pathway.version,
  pathway.id
FROM praxis.pathway AS pathway
JOIN pathway_identity_015 AS identity
  ON identity.legacy_pathway_key = pathway.id;

ALTER TABLE praxis.skill_pathway_ref
  ADD COLUMN content_record_id uuid;

UPDATE praxis.skill_pathway_ref AS reference
SET content_record_id = identity.content_record_id
FROM pathway_identity_015 AS identity
WHERE identity.legacy_pathway_key = reference.pathway_id;

ALTER TABLE praxis.skill_pathway_ref
  ALTER COLUMN content_record_id SET NOT NULL,
  ADD CONSTRAINT skill_pathway_ref_content_record_id_fkey
    FOREIGN KEY (content_record_id)
    REFERENCES praxis.content_records(id) ON DELETE CASCADE;

ALTER TABLE praxis.skill_pathway_ref
  DROP CONSTRAINT skill_pathway_ref_unique,
  DROP CONSTRAINT skill_pathway_ref_pathway_id_fkey,
  DROP COLUMN pathway_id,
  ADD CONSTRAINT skill_pathway_ref_unique
    UNIQUE (skill_id, content_record_id, source);

CREATE INDEX skill_pathway_ref_content_record_idx
  ON praxis.skill_pathway_ref (content_record_id);

ALTER TABLE praxis.navigator_pathway_steps
  ADD COLUMN content_record_id uuid;

UPDATE praxis.navigator_pathway_steps AS step
SET content_record_id = identity.content_record_id
FROM pathway_identity_015 AS identity
WHERE identity.legacy_pathway_key = step.pathway_id;

ALTER TABLE praxis.navigator_pathway_steps
  DROP CONSTRAINT navigator_pathway_steps_pkey,
  DROP CONSTRAINT navigator_pathway_steps_pathway_id_fkey,
  ALTER COLUMN content_record_id SET NOT NULL,
  ADD CONSTRAINT navigator_pathway_steps_content_record_id_fkey
    FOREIGN KEY (content_record_id)
    REFERENCES praxis.content_records(id) ON DELETE CASCADE,
  ADD CONSTRAINT navigator_pathway_steps_pkey
    PRIMARY KEY (content_record_id, position),
  DROP COLUMN pathway_id;

ALTER TABLE praxis.diagnostic_sessions
  ADD COLUMN learner_id uuid
    REFERENCES praxis.learner(id) ON DELETE SET NULL;

CREATE INDEX diagnostic_sessions_learner_idx
  ON praxis.diagnostic_sessions (learner_id, created_at DESC);

ALTER TABLE praxis.navigator_pathway_results
  DROP CONSTRAINT navigator_pathway_results_pathway_id_fkey;

ALTER TABLE praxis.navigator_pathway_results
  RENAME TO navigator_pathway_results_retired;

ALTER TABLE praxis.recommendations
  RENAME TO recommendations_retired;

ALTER TABLE praxis.recommendations_retired
  RENAME CONSTRAINT recommendations_pkey
    TO recommendations_retired_pkey;
ALTER TABLE praxis.recommendations_retired
  RENAME CONSTRAINT recommendations_diagnostic_id_rank_key
    TO recommendations_retired_diagnostic_rank_key;
ALTER TABLE praxis.recommendations_retired
  RENAME CONSTRAINT recommendations_diagnostic_id_record_id_key
    TO recommendations_retired_diagnostic_record_key;
ALTER INDEX praxis.recommendations_diagnostic_rank_idx
  RENAME TO recommendations_retired_diagnostic_rank_idx;

COMMENT ON TABLE praxis.navigator_pathway_results_retired IS
  'Retired legacy Navigator snapshot; audit-only, never read or written by the application after migration 015.';
COMMENT ON TABLE praxis.recommendations_retired IS
  'Retired matching-v1 diagnostic snapshot; audit-only, never relabelled as Phase 2 output.';

CREATE TABLE praxis.recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL
    REFERENCES praxis.learner(id) ON DELETE CASCADE,
  target_occupation_id text NOT NULL
    REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  record_id uuid NOT NULL
    REFERENCES praxis.content_records(id) ON DELETE RESTRICT,
  diagnostic_id uuid
    REFERENCES praxis.diagnostic_sessions(id) ON DELETE SET NULL,
  cv_document_id uuid
    REFERENCES praxis.navigator_cv_documents(id) ON DELETE SET NULL,
  score numeric(8,7) NOT NULL CHECK (score BETWEEN 0 AND 1),
  rank smallint NOT NULL CHECK (rank > 0),
  features jsonb NOT NULL CHECK (jsonb_typeof(features) = 'object'),
  reasons jsonb NOT NULL CHECK (
    jsonb_typeof(reasons) = 'array'
    AND NOT jsonb_path_exists(reasons, '$[*] ? (@.type() != "object")')
  ),
  algorithm_version text NOT NULL
    REFERENCES praxis.recommendation_weights(version) ON DELETE RESTRICT,
  inputs_hash text NOT NULL CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learner_id, target_occupation_id, record_id),
  UNIQUE (learner_id, target_occupation_id, rank)
);

CREATE INDEX recommendations_learner_target_rank_idx
  ON praxis.recommendations (learner_id, target_occupation_id, rank);

COMMENT ON TABLE praxis.recommendations IS
  'Sole canonical replaceable recommendation snapshot; immutable serving history belongs to recommendation impressions.';
COMMENT ON COLUMN praxis.recommendations.reasons IS
  'Structured record-backed reason objects only; never free prose or generated catalog claims.';

DO $$
DECLARE
  missing_pathway_records integer;
  migrated_skill_refs integer;
  migrated_steps integer;
  expected_skill_refs integer;
  expected_steps integer;
BEGIN
  SELECT count(*) INTO missing_pathway_records
  FROM praxis.pathway_definition AS definition
  JOIN praxis.content_records AS content
    ON content.id = definition.content_record_id
  WHERE content.record_type <> 'pathway';

  SELECT count(*) INTO migrated_skill_refs
  FROM praxis.skill_pathway_ref;

  SELECT count(*) INTO migrated_steps
  FROM praxis.navigator_pathway_steps;

  SELECT skill_ref_count, step_count
  INTO expected_skill_refs, expected_steps
  FROM pathway_migration_counts_015;

  IF missing_pathway_records <> 0 THEN
    RAISE EXCEPTION '% pathway definitions do not point to pathway records',
      missing_pathway_records;
  END IF;
  IF migrated_skill_refs <> expected_skill_refs
     OR migrated_steps <> expected_steps THEN
    RAISE EXCEPTION
      'Expected % skill refs and % steps after UUID migration; found % and %',
      expected_skill_refs, expected_steps, migrated_skill_refs, migrated_steps;
  END IF;
END
$$;

DROP TABLE praxis.pathway;

-- The application role is deployment-specific. Production deployment must
-- revoke all application grants on both *_retired tables before cutover.
