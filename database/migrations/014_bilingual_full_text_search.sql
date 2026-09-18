-- Phase 1.1: language-aware, accent-folded ESCO and catalog search indexes.
-- The immutable wrapper is required because PostgreSQL marks unaccent(text)
-- STABLE, while index expressions must be IMMUTABLE.
--
-- rollback:
--   DROP INDEX IF EXISTS praxis.esco_occupation_versions_label_trgm_idx;
--   DROP INDEX IF EXISTS praxis.esco_skill_versions_label_trgm_idx;
--   DROP INDEX IF EXISTS praxis.esco_occupation_versions_label_search_fr_idx;
--   DROP INDEX IF EXISTS praxis.esco_occupation_versions_label_search_en_idx;
--   DROP INDEX IF EXISTS praxis.esco_skill_versions_label_search_fr_idx;
--   DROP INDEX IF EXISTS praxis.esco_skill_versions_label_search_en_idx;
--   DROP INDEX IF EXISTS praxis.content_records_search_fr_idx;
--   DROP INDEX IF EXISTS praxis.content_records_search_en_idx;
--   DROP FUNCTION IF EXISTS praxis.unaccent_immutable(text);
--   ALTER TABLE praxis.esco_occupation_versions DROP COLUMN IF EXISTS language;
--   ALTER TABLE praxis.esco_skill_versions DROP COLUMN IF EXISTS language;
-- Extensions are intentionally retained on rollback because other consumers may
-- depend on them after this migration has been deployed.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION praxis.unaccent_immutable(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, value)
$$;

ALTER TABLE praxis.esco_occupation_versions
  ADD COLUMN language text;
ALTER TABLE praxis.esco_skill_versions
  ADD COLUMN language text;

UPDATE praxis.esco_occupation_versions version
SET language = release.language
FROM praxis.esco_releases release
WHERE release.id = version.release_id;

UPDATE praxis.esco_skill_versions version
SET language = release.language
FROM praxis.esco_releases release
WHERE release.id = version.release_id;

ALTER TABLE praxis.esco_occupation_versions
  ALTER COLUMN language SET NOT NULL,
  ADD CONSTRAINT esco_occupation_versions_language_format
    CHECK (language ~ '^[a-z]{2}(?:-[A-Z]{2})?$');
ALTER TABLE praxis.esco_skill_versions
  ALTER COLUMN language SET NOT NULL,
  ADD CONSTRAINT esco_skill_versions_language_format
    CHECK (language ~ '^[a-z]{2}(?:-[A-Z]{2})?$');

DROP INDEX IF EXISTS praxis.content_records_search_gin;
DROP INDEX IF EXISTS praxis.esco_occupation_versions_label_search_idx;
DROP INDEX IF EXISTS praxis.esco_skill_versions_label_search_idx;

CREATE INDEX content_records_search_en_idx
  ON praxis.content_records USING gin (
    to_tsvector(
      'english',
      praxis.unaccent_immutable(coalesce(title, '') || ' ' || coalesce(summary, ''))
    )
  )
  WHERE languages @> ARRAY['en']::text[];

CREATE INDEX content_records_search_fr_idx
  ON praxis.content_records USING gin (
    to_tsvector(
      'french',
      praxis.unaccent_immutable(coalesce(title, '') || ' ' || coalesce(summary, ''))
    )
  )
  WHERE languages @> ARRAY['fr']::text[];

CREATE INDEX esco_occupation_versions_label_search_en_idx
  ON praxis.esco_occupation_versions USING gin (
    to_tsvector(
      'english',
      praxis.unaccent_immutable(preferred_label || ' ' || description)
    )
  )
  WHERE language = 'en';

CREATE INDEX esco_occupation_versions_label_search_fr_idx
  ON praxis.esco_occupation_versions USING gin (
    to_tsvector(
      'french',
      praxis.unaccent_immutable(preferred_label || ' ' || description)
    )
  )
  WHERE language = 'fr';

CREATE INDEX esco_skill_versions_label_search_en_idx
  ON praxis.esco_skill_versions USING gin (
    to_tsvector(
      'english',
      praxis.unaccent_immutable(preferred_label || ' ' || description)
    )
  )
  WHERE language = 'en';

CREATE INDEX esco_skill_versions_label_search_fr_idx
  ON praxis.esco_skill_versions USING gin (
    to_tsvector(
      'french',
      praxis.unaccent_immutable(preferred_label || ' ' || description)
    )
  )
  WHERE language = 'fr';

CREATE INDEX esco_occupation_versions_label_trgm_idx
  ON praxis.esco_occupation_versions USING gin (
    preferred_label gin_trgm_ops
  );

CREATE INDEX esco_skill_versions_label_trgm_idx
  ON praxis.esco_skill_versions USING gin (
    preferred_label gin_trgm_ops
  );
