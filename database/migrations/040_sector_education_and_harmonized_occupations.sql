-- Make sector preference and educational background first-class learner context,
-- and expose one governed read model for the reviewed ESCO/ROME/O*NET anchors.
-- Education is context only: it must never be converted into skill mastery.
--
-- rollback:
--   DROP VIEW IF EXISTS praxis.harmonized_occupation_profile;
--   ALTER TABLE praxis.learner_context
--     DROP COLUMN graduation_year,
--     DROP COLUMN current_program,
--     DROP COLUMN field_of_study,
--     DROP COLUMN highest_education_level,
--     DROP COLUMN education_status,
--     DROP COLUMN preferred_sector_code;

ALTER TABLE praxis.learner_context
  ADD COLUMN preferred_sector_code text
    CHECK (preferred_sector_code ~ '^[a-z][a-z0-9_]{1,49}$'),
  ADD COLUMN education_status text
    CHECK (education_status IN ('currently_studying','completed','interrupted','not_disclosed')),
  ADD COLUMN highest_education_level text
    CHECK (highest_education_level IN (
      'none','secondary','technical_vocational','bac_plus_2','licence',
      'master','doctorate','other'
    )),
  ADD COLUMN field_of_study text,
  ADD COLUMN current_program text,
  ADD COLUMN graduation_year smallint CHECK (graduation_year BETWEEN 1900 AND 2200);

COMMENT ON COLUMN praxis.learner_context.preferred_sector_code IS
  'Learner-stated PRAXIS sector code used to filter occupation discovery. It is snapshotted as a code so historical context survives taxonomy releases.';
COMMENT ON COLUMN praxis.learner_context.highest_education_level IS
  'Self-declared education context. Never infer a PRAXIS L0-L3 skill level from this field alone.';

CREATE VIEW praxis.harmonized_occupation_profile
WITH (security_barrier = true) AS
SELECT occupation.id AS occupation_id,
       occupation.label_fr,
       occupation.esco_occupation_uri,
       occupation.isco_major_group,
       occupation.sector_code AS praxis_sector_code,
       occupation.rome_code_rome,
       rome.preferred_label AS rome_label,
       rome.emploi_reglemente AS rome_emploi_reglemente,
       rome.emploi_cadre AS rome_emploi_cadre,
       occupation.onet_soc_code,
       onet.title AS onet_title,
       occupation.onet_job_zone,
       zone.name AS onet_job_zone_name,
       jsonb_strip_nulls(jsonb_build_object(
         'esco', CASE WHEN occupation.esco_occupation_uri IS NULL THEN NULL ELSE
           jsonb_build_object('occupation_uri', occupation.esco_occupation_uri,
                              'isco_major_group', occupation.isco_major_group) END,
         'rome', CASE WHEN occupation.rome_code_rome IS NULL THEN NULL ELSE
           jsonb_build_object('code_rome', occupation.rome_code_rome,
                              'label', rome.preferred_label,
                              'emploi_reglemente', rome.emploi_reglemente,
                              'emploi_cadre', rome.emploi_cadre) END,
         'onet', CASE WHEN occupation.onet_soc_code IS NULL THEN NULL ELSE
           jsonb_build_object('soc_code', occupation.onet_soc_code,
                              'title', onet.title,
                              'job_zone', occupation.onet_job_zone,
                              'job_zone_name', zone.name) END
       )) AS source_coverage
FROM praxis.occupation AS occupation
LEFT JOIN LATERAL (
  SELECT version.preferred_label, version.emploi_reglemente, version.emploi_cadre
  FROM praxis.rome_occupation_versions AS version
  JOIN praxis.source_releases AS release ON release.id = version.release_id
  WHERE version.code_rome = occupation.rome_code_rome
    AND release.source = 'rome' AND release.is_active
  ORDER BY release.imported_at DESC
  LIMIT 1
) AS rome ON true
LEFT JOIN LATERAL (
  SELECT version.title, version.release_id
  FROM praxis.onet_occupation_versions AS version
  JOIN praxis.source_releases AS release ON release.id = version.release_id
  WHERE version.onet_soc_code = occupation.onet_soc_code
    AND release.source = 'onet' AND release.is_active
  ORDER BY release.imported_at DESC
  LIMIT 1
) AS onet ON true
LEFT JOIN praxis.onet_job_zone_reference AS zone
  ON zone.release_id = onet.release_id
 AND zone.job_zone = occupation.onet_job_zone;

COMMENT ON VIEW praxis.harmonized_occupation_profile IS
  'Governed occupation read model: ESCO is the spine; ROME and O*NET appear only through reviewed anchors on praxis.occupation. No fuzzy crosswalk and no automatic level conversion.';
