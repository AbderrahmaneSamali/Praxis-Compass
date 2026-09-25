-- Paired rollback for migrations/059_rome_exploration_sources.sql.
-- This removes only the supplemental ROME v61 exploration data and tables.
-- Run only before any later migration depends on them; reload with the same
-- checksummed archive after reapplying 059.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM praxis.schema_migrations
    WHERE substring(filename from 1 for 3)::integer > 59
  ) THEN
    RAISE EXCEPTION 'Rollback 059 requires rolling back later migrations first';
  END IF;
END $$;

DROP TABLE praxis.rome_occupation_texts,
  praxis.rome_occupation_activity_sectors,
  praxis.rome_activity_sector_versions,
  praxis.rome_activity_sectors,
  praxis.rome_occupation_interest_centres,
  praxis.rome_interest_centre_versions,
  praxis.rome_interest_centres,
  praxis.rome_macro_competence_riasec,
  praxis.rome_occupation_riasec,
  praxis.rome_mobility,
  praxis.source_release_supplements;

DROP FUNCTION praxis.prevent_source_row_change();
DELETE FROM praxis.schema_migrations WHERE filename='059_rome_exploration_sources.sql';
COMMIT;
