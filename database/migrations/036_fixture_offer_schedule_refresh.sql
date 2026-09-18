-- Refresh fixture offer dates at migration-application time.
--
-- Migration 035 is checksum-pinned and contains the initial demo schedule.
-- This follow-up is deliberately append-only: a clean install applies 035 then
-- replaces its calendar dates with relative, concrete upcoming dates here.
--
-- rollback:
--   No data rollback is required. Fixture offers are removable as one unit via
--   SELECT praxis.purge_fixture_offers(); Restoring their previous dates would
--   reintroduce stale fixture schedules.

UPDATE praxis.content_records
SET next_start_date = current_date + CASE slug
      WHEN 'demo-analyse-donnees-casablanca' THEN 48
      WHEN 'demo-tableaux-bord-power-bi' THEN 62
      WHEN 'demo-methodes-analytiques-ligne' THEN 76
    END,
    last_verified_at = now(),
    attributes = jsonb_set(
      attributes,
      '{nextSession}',
      to_jsonb((current_date + CASE slug
        WHEN 'demo-analyse-donnees-casablanca' THEN 48
        WHEN 'demo-tableaux-bord-power-bi' THEN 62
        WHEN 'demo-methodes-analytiques-ligne' THEN 76
      END)::text),
      true
    )
WHERE data_source = 'fixture'
  AND slug IN (
    'demo-analyse-donnees-casablanca',
    'demo-tableaux-bord-power-bi',
    'demo-methodes-analytiques-ligne'
  );
