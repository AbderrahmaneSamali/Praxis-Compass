-- Make both pre-consolidation recommendation stores immutable audit data even
-- when the application connects as the table owner in local environments.
--
-- rollback:
--   DROP TRIGGER IF EXISTS recommendations_retired_reject_writes
--     ON praxis.recommendations_retired;
--   DROP TRIGGER IF EXISTS navigator_pathway_results_retired_reject_writes
--     ON praxis.navigator_pathway_results_retired;
--   DROP FUNCTION IF EXISTS praxis.reject_retired_recommendation_write();

CREATE FUNCTION praxis.reject_retired_recommendation_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is immutable retired audit data', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER recommendations_retired_reject_writes
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON praxis.recommendations_retired
FOR EACH STATEMENT
EXECUTE FUNCTION praxis.reject_retired_recommendation_write();

CREATE TRIGGER navigator_pathway_results_retired_reject_writes
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON praxis.navigator_pathway_results_retired
FOR EACH STATEMENT
EXECUTE FUNCTION praxis.reject_retired_recommendation_write();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON praxis.recommendations_retired,
   praxis.navigator_pathway_results_retired
FROM PUBLIC;

COMMENT ON FUNCTION praxis.reject_retired_recommendation_write() IS
  'Hard guard against dual writes or mutation of pre-Phase-2 recommendation audit rows.';
