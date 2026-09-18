-- Retired recommendation rows are immutable audit records, not live child
-- aggregates. Detach their legacy ownership FKs so deleting a live learner,
-- diagnostic, CV, or catalog record cannot cascade into or update audit data.
-- The identifier values remain on the retired rows for offline audit joins.
--
-- paired down-migration note:
--   Re-add these FKs only after proving every historical id still resolves:
--   recommendations_retired.diagnostic_id -> diagnostic_sessions(id),
--   recommendations_retired.record_id -> content_records(id),
--   navigator_pathway_results_retired.learner_id -> learner(id), and
--   navigator_pathway_results_retired.cv_document_id -> navigator_cv_documents(id).
--   Cascading actions are incompatible with the immutable-write guards.

ALTER TABLE praxis.recommendations_retired
  DROP CONSTRAINT recommendations_diagnostic_id_fkey,
  DROP CONSTRAINT recommendations_record_id_fkey;

ALTER TABLE praxis.navigator_pathway_results_retired
  DROP CONSTRAINT navigator_pathway_results_learner_id_fkey,
  DROP CONSTRAINT navigator_pathway_results_cv_document_id_fkey;

COMMENT ON COLUMN praxis.recommendations_retired.diagnostic_id IS
  'Historical diagnostic identifier; deliberately not a live FK after immutable retirement.';
COMMENT ON COLUMN praxis.recommendations_retired.record_id IS
  'Historical catalog identifier; deliberately not a live FK after immutable retirement.';
COMMENT ON COLUMN praxis.navigator_pathway_results_retired.learner_id IS
  'Historical learner identifier; deliberately not a live FK after immutable retirement.';
COMMENT ON COLUMN praxis.navigator_pathway_results_retired.cv_document_id IS
  'Historical CV identifier; deliberately not a live FK after immutable retirement.';
