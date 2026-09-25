-- Paired rollback for migrations/062_context_survey.sql.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM praxis.schema_migrations
             WHERE substring(filename from 1 for 3)::integer > 62) THEN
    RAISE EXCEPTION 'Rollback 062 requires rolling back later migrations first';
  END IF;
END $$;
DROP TRIGGER context_survey_answer_immutable_update ON praxis.context_survey_answer;
DROP FUNCTION praxis.guard_context_survey_answer_update();
DROP TABLE praxis.context_survey_answer;
DROP TABLE praxis.context_survey_session;
DROP TABLE praxis.context_survey_question;
DROP TABLE praxis.context_survey_version;
DELETE FROM praxis.schema_migrations WHERE filename='062_context_survey.sql';
COMMIT;
