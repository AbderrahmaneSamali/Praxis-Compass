-- Paired down-migration for migrations/050_recommendation_reliability.sql.
-- 050 is applied and checksum-pinned, so its rollback lives here instead of
-- in the migration file. This directory is not read by the migration runner.
--
-- Operational order:
--   1. Redeploy the application/kernel that serves 'praxis-rank-online-paths-v3'.
--   2. Run this script in one transaction.
--   3. Keep the schema_migrations row for 050: the input_snapshot and
--      algorithm_version columns stay, so historical impressions and their
--      replay snapshots are retained. v3 writers ignore both columns and get
--      the '{}' default and NULL.
--   4. Re-applying v4 later requires a new forward migration, not a rerun of 050.

BEGIN;

UPDATE praxis.recommendation_weights
   SET status = 'retired'
 WHERE version = 'praxis-rank-reliable-v4'
   AND status = 'active';

UPDATE praxis.recommendation_weights
   SET status = 'active', activated_at = now()
 WHERE version = 'praxis-rank-online-paths-v3';

-- Exactly one active weights row must remain (recommendation_weights_one_active_idx).
DO $$
BEGIN
  IF (SELECT count(*) FROM praxis.recommendation_weights
       WHERE version = 'praxis-rank-online-paths-v3' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'rollback 050: praxis-rank-online-paths-v3 is not active';
  END IF;
END $$;

COMMIT;
