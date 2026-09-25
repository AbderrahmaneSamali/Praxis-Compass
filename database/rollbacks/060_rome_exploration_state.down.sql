-- Paired rollback for migrations/060_rome_exploration_state.sql.
-- Removes learner ROME confirmations, saved directions, actions and feedback.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM praxis.schema_migrations
             WHERE substring(filename from 1 for 3)::integer > 60) THEN
    RAISE EXCEPTION 'Rollback 060 requires rolling back later migrations first';
  END IF;
END $$;
DROP TABLE praxis.exploration_rome_feedback,
  praxis.exploration_selected_rome_action,
  praxis.exploration_saved_rome_direction,
  praxis.rome_requirement_confirmation,
  praxis.exploration_confirmed_interest;
DROP FUNCTION praxis.guard_rome_confirmation_update();
ALTER TABLE praxis.exploration_profile DROP COLUMN current_rome_code;
DELETE FROM praxis.schema_migrations WHERE filename='060_rome_exploration_state.sql';
COMMIT;
