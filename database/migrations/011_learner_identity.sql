-- Phase 1.3: stable learner identity across CV uploads.
-- Legacy duplicate snapshots are resolved by keeping the most recently updated
-- skill estimate and most recently created pathway result per learner/key.
--
-- paired down-migration note:
--   Take a database backup before applying 011. Rollback requires restoring
--   any legacy snapshot rows deduplicated below, then: drop the learner-keyed
--   PK/unique/FK constraints; make cv_document_id NOT NULL; restore the
--   cv_document_id PKs, rank unique constraint, and ON DELETE CASCADE document
--   FKs; drop learner_id from the three Navigator tables; finally drop
--   learner_session and learner. The backup is required because discarded
--   duplicate current-state snapshots cannot be reconstructed reliably.

CREATE TABLE praxis.learner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref text UNIQUE,
  locale text NOT NULL DEFAULT 'fr',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE praxis.learner_session (
  session_key text PRIMARY KEY,
  learner_id uuid NOT NULL
    REFERENCES praxis.learner(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX learner_session_learner_idx
  ON praxis.learner_session (learner_id);

ALTER TABLE praxis.navigator_cv_documents
  ADD COLUMN learner_id uuid
    REFERENCES praxis.learner(id) ON DELETE CASCADE;

ALTER TABLE praxis.navigator_skill_estimates
  ADD COLUMN learner_id uuid
    REFERENCES praxis.learner(id) ON DELETE CASCADE;

ALTER TABLE praxis.navigator_pathway_results
  ADD COLUMN learner_id uuid
    REFERENCES praxis.learner(id) ON DELETE CASCADE;

CREATE TEMP TABLE learner_session_011_backfill (
  session_key text PRIMARY KEY,
  learner_id uuid NOT NULL DEFAULT gen_random_uuid()
) ON COMMIT DROP;

INSERT INTO learner_session_011_backfill (session_key)
SELECT DISTINCT session_key
FROM praxis.navigator_cv_documents;

INSERT INTO praxis.learner (id)
SELECT learner_id
FROM learner_session_011_backfill;

INSERT INTO praxis.learner_session (session_key, learner_id)
SELECT session_key, learner_id
FROM learner_session_011_backfill;

UPDATE praxis.navigator_cv_documents AS document
SET learner_id = backfill.learner_id
FROM learner_session_011_backfill AS backfill
WHERE backfill.session_key = document.session_key;

UPDATE praxis.navigator_skill_estimates AS estimate
SET learner_id = document.learner_id
FROM praxis.navigator_cv_documents AS document
WHERE document.id = estimate.cv_document_id;

UPDATE praxis.navigator_pathway_results AS result
SET learner_id = document.learner_id
FROM praxis.navigator_cv_documents AS document
WHERE document.id = result.cv_document_id;

ALTER TABLE praxis.navigator_cv_documents
  ALTER COLUMN learner_id SET NOT NULL;
ALTER TABLE praxis.navigator_skill_estimates
  ALTER COLUMN learner_id SET NOT NULL;
ALTER TABLE praxis.navigator_pathway_results
  ALTER COLUMN learner_id SET NOT NULL;

-- The legacy tables model current snapshots, not history. Retain one current
-- row for each learner/skill and learner/pathway before changing their keys.
WITH ranked AS (
  SELECT
    cv_document_id,
    skill_id,
    row_number() OVER (
      PARTITION BY learner_id, skill_id
      ORDER BY updated_at DESC, created_at DESC, cv_document_id DESC
    ) AS position
  FROM praxis.navigator_skill_estimates
)
DELETE FROM praxis.navigator_skill_estimates AS estimate
USING ranked
WHERE estimate.cv_document_id = ranked.cv_document_id
  AND estimate.skill_id = ranked.skill_id
  AND ranked.position > 1;

WITH ranked AS (
  SELECT
    cv_document_id,
    pathway_id,
    row_number() OVER (
      PARTITION BY learner_id, pathway_id
      ORDER BY created_at DESC, cv_document_id DESC
    ) AS position
  FROM praxis.navigator_pathway_results
)
DELETE FROM praxis.navigator_pathway_results AS result
USING ranked
WHERE result.cv_document_id = ranked.cv_document_id
  AND result.pathway_id = ranked.pathway_id
  AND ranked.position > 1;

ALTER TABLE praxis.navigator_skill_estimates
  DROP CONSTRAINT navigator_skill_estimates_pkey,
  DROP CONSTRAINT navigator_skill_estimates_cv_document_id_fkey;

ALTER TABLE praxis.navigator_pathway_results
  DROP CONSTRAINT navigator_pathway_results_pkey,
  DROP CONSTRAINT navigator_pathway_results_cv_document_id_rank_key,
  DROP CONSTRAINT navigator_pathway_results_cv_document_id_fkey;

WITH ranked AS (
  SELECT
    learner_id,
    pathway_id,
    row_number() OVER (
      PARTITION BY learner_id
      ORDER BY score DESC, created_at DESC, pathway_id
    ) AS new_rank
  FROM praxis.navigator_pathway_results
)
UPDATE praxis.navigator_pathway_results AS result
SET rank = ranked.new_rank
FROM ranked
WHERE result.learner_id = ranked.learner_id
  AND result.pathway_id = ranked.pathway_id;

ALTER TABLE praxis.navigator_skill_estimates
  ALTER COLUMN cv_document_id DROP NOT NULL,
  ADD CONSTRAINT navigator_skill_estimates_cv_document_id_fkey
    FOREIGN KEY (cv_document_id)
    REFERENCES praxis.navigator_cv_documents(id) ON DELETE SET NULL,
  ADD CONSTRAINT navigator_skill_estimates_pkey
    PRIMARY KEY (learner_id, skill_id);

ALTER TABLE praxis.navigator_pathway_results
  ALTER COLUMN cv_document_id DROP NOT NULL,
  ADD CONSTRAINT navigator_pathway_results_cv_document_id_fkey
    FOREIGN KEY (cv_document_id)
    REFERENCES praxis.navigator_cv_documents(id) ON DELETE SET NULL,
  ADD CONSTRAINT navigator_pathway_results_pkey
    PRIMARY KEY (learner_id, pathway_id),
  ADD CONSTRAINT navigator_pathway_results_learner_rank_key
    UNIQUE (learner_id, rank);

CREATE INDEX navigator_cv_documents_learner_idx
  ON praxis.navigator_cv_documents (learner_id, created_at DESC);

CREATE INDEX navigator_skill_estimates_learner_gap_idx
  ON praxis.navigator_skill_estimates (learner_id, gap DESC);

CREATE INDEX navigator_pathway_results_learner_rank_idx
  ON praxis.navigator_pathway_results (learner_id, rank);

COMMENT ON COLUMN praxis.navigator_skill_estimates.cv_document_id IS
  'Nullable provenance link to the CV active when this learner snapshot was computed; not an identity key.';
COMMENT ON COLUMN praxis.navigator_pathway_results.cv_document_id IS
  'Nullable provenance link to the CV active when this learner ranking was computed; not an identity key.';
