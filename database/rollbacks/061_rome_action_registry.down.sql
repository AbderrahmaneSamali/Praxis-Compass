-- Paired rollback for migrations/061_rome_action_registry.sql.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM praxis.schema_migrations
             WHERE substring(filename from 1 for 3)::integer > 61) THEN
    RAISE EXCEPTION 'Rollback 061 requires rolling back later migrations first';
  END IF;
END $$;
ALTER TABLE praxis.exploration_selected_rome_action
  DROP CONSTRAINT exploration_selected_rome_action_registry_fk;
DROP TABLE praxis.rome_development_action;
DELETE FROM praxis.schema_migrations WHERE filename='061_rome_action_registry.sql';
COMMIT;
