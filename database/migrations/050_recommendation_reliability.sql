-- Additive replay snapshot. Applied migrations remain checksum-pinned and unchanged.
ALTER TABLE praxis.recommendation_impression
  ADD COLUMN input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(input_snapshot) = 'object'),
  ADD COLUMN algorithm_version text;

-- The formula weights are preserved; the serving implementation has changed.
WITH retired AS (
  UPDATE praxis.recommendation_weights SET status='retired'
  WHERE status='active' RETURNING weights
)
INSERT INTO praxis.recommendation_weights(version,weights,status,activated_at)
SELECT 'praxis-rank-reliable-v4',weights,'active',now() FROM retired;

-- Rollback application/kernel together, retire v4 and reactivate the prior row.
-- Retain historical impressions and their snapshots.
