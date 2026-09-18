-- Activate reviewed ROME identities for the eight live PRAXIS roles and
-- register the official O*NET↔ESCO crosswalk used for six O*NET identities.
-- No taxonomy level is converted into PRAXIS L0-L3 mastery.
--
-- rollback:
--   DROP VIEW IF EXISTS praxis.harmonized_occupation_profile;
--   UPDATE praxis.occupation SET rome_code_rome=NULL, onet_soc_code=NULL,
--     rome_emploi_cadre=NULL, onet_job_zone=NULL,
--     rome_seniority_provenance='{}'::jsonb,
--     onet_seniority_provenance='{}'::jsonb;
--   DROP TABLE praxis.esco_onet_occupation_crosswalk;
--   DROP TABLE praxis.occupation_source_anchor_review;
--   DELETE FROM praxis.source_releases WHERE source='onet_esco_crosswalk';

ALTER TABLE praxis.source_releases
  DROP CONSTRAINT source_releases_source_check,
  ADD CONSTRAINT source_releases_source_check
    CHECK (source IN ('esco', 'rome', 'onet', 'onet_esco_crosswalk'));

INSERT INTO praxis.source_releases
  (source, version, language, source_uri, source_checksum, source_checksums,
   published_on, license_name, is_active)
VALUES
  ('onet_esco_crosswalk', '2019-2022', 'en',
   'https://www.onetcenter.org/crosswalks/esco/ESCO_to_ONET-SOC.xlsx',
   'bf6c854f7ffc935eba67a296d6d7fa4d40b70fb26bcdb5ecb5621374bca6f35b',
   jsonb_build_object(
     'xlsx_sha256', 'bf6c854f7ffc935eba67a296d6d7fa4d40b70fb26bcdb5ecb5621374bca6f35b',
     'normalized_csv_sha256', 'ecc2f87df9bb0e31e09071a0a5d409d7707ab26da8049edbfcdb9071e07725e5'
   ),
   make_date(2022, 11, 1), 'O*NET Database License / CC BY 4.0', true)
ON CONFLICT (source, version, language) DO NOTHING;

CREATE TABLE praxis.esco_onet_occupation_crosswalk (
  crosswalk_release_id uuid NOT NULL
    REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  esco_code text NOT NULL CHECK (esco_code ~ '^[0-9]{4}(\.[0-9]+)*$'),
  esco_title text NOT NULL CHECK (esco_title <> ''),
  onet_soc_code text NOT NULL
    CHECK (onet_soc_code ~ '^[0-9]{2}-[0-9]{4}\.[0-9]{2}$'),
  onet_title text NOT NULL CHECK (onet_title <> ''),
  PRIMARY KEY (crosswalk_release_id, esco_code, onet_soc_code)
);

CREATE INDEX esco_onet_crosswalk_esco_code_idx
  ON praxis.esco_onet_occupation_crosswalk (esco_code);
CREATE INDEX esco_onet_crosswalk_onet_code_idx
  ON praxis.esco_onet_occupation_crosswalk (onet_soc_code);

COMMENT ON TABLE praxis.esco_onet_occupation_crosswalk IS
  'Published O*NET Resource Center ESCO↔O*NET-SOC 2019 crosswalk. Source mappings are many-to-many and never imply a PRAXIS proficiency level.';

CREATE TABLE praxis.occupation_source_anchor_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occupation_id text NOT NULL
    REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('rome', 'onet')),
  source_entity_id text NOT NULL,
  source_release_id uuid NOT NULL
    REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  crosswalk_release_id uuid
    REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision = 'approved'),
  review_basis text NOT NULL CHECK (review_basis IN (
    'exact_rome_preferred_or_appellation',
    'published_human_validated_esco_onet_crosswalk'
  )),
  reviewer_principal text NOT NULL,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (occupation_id, source)
);

WITH rome_release AS (
  SELECT id FROM praxis.source_releases
  WHERE source='rome' AND language='fr' AND is_active
), reviewed(occupation_id, code_rome, matched_label) AS (
  VALUES
    ('metier_analyste_financier', 'M1201', 'Analyste financier / Analyste financière'),
    ('metier_bim_coordinateur', 'F1125', 'Coordinateur / Coordinatrice BIM'),
    ('metier_gestionnaire_projet', 'M1828', 'Project Manager'),
    ('metier_responsable_rh', 'M1503', 'Responsable des Ressources Humaines -RRH-'),
    ('metier_transformation_numerique', 'M1426', 'Chief digital officer - Responsable de la transformation digitale'),
    ('occupation_esco_258e46f900754a2eadae1ff0477e0f30', 'M1405', 'Data scientist'),
    ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'M1419', 'Data analyst'),
    ('occupation_esco_fdb16700109e4d02949e3213f278df93', 'H1502', 'Responsable en qualité industrielle')
)
INSERT INTO praxis.occupation_source_anchor_review
  (occupation_id, source, source_entity_id, source_release_id, decision,
   review_basis, reviewer_principal, evidence)
SELECT reviewed.occupation_id, 'rome', reviewed.code_rome, rome_release.id,
       'approved', 'exact_rome_preferred_or_appellation',
       'project_owner_directive_2026-09-04',
       jsonb_build_object(
         'question', 'Is this THE ROME fiche for this PRAXIS occupation?',
         'matched_label', reviewed.matched_label,
         'source', 'France Travail ROME 4.0 v61',
         'reviewed_as', 'identity'
       )
FROM reviewed CROSS JOIN rome_release;

WITH onet_release AS (
  SELECT id FROM praxis.source_releases
  WHERE source='onet' AND language='en' AND is_active
), crosswalk_release AS (
  SELECT id FROM praxis.source_releases
  WHERE source='onet_esco_crosswalk' AND is_active
), reviewed(occupation_id, esco_code, onet_soc_code) AS (
  VALUES
    ('metier_analyste_financier', '2413.1', '13-2051.00'),
    ('metier_gestionnaire_projet', '1219.6', '13-1082.00'),
    ('metier_responsable_rh', '2423.3', '11-3121.00'),
    ('occupation_esco_258e46f900754a2eadae1ff0477e0f30', '2511.4', '15-2051.00'),
    ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', '2511.3', '15-2051.01'),
    ('occupation_esco_fdb16700109e4d02949e3213f278df93', '1321.2.2', '11-3051.01')
)
INSERT INTO praxis.occupation_source_anchor_review
  (occupation_id, source, source_entity_id, source_release_id,
   crosswalk_release_id, decision, review_basis, reviewer_principal, evidence)
SELECT reviewed.occupation_id, 'onet', reviewed.onet_soc_code,
       onet_release.id, crosswalk_release.id, 'approved',
       'published_human_validated_esco_onet_crosswalk',
       'project_owner_directive_2026-09-04',
       jsonb_build_object(
         'esco_code', reviewed.esco_code,
         'onet_soc_code', reviewed.onet_soc_code,
         'source', 'O*NET Resource Center ESCO crosswalk',
         'method', 'AI-assisted with human validation by source publisher'
       )
FROM reviewed CROSS JOIN onet_release CROSS JOIN crosswalk_release;

UPDATE praxis.occupation AS occupation
SET rome_code_rome = review.source_entity_id::character(5),
    rome_emploi_cadre = version.emploi_cadre,
    rome_seniority_provenance = jsonb_build_object(
      'source', 'rome', 'release_id', review.source_release_id,
      'review_id', review.id, 'field', 'emploi_cadre'
    )
FROM praxis.occupation_source_anchor_review AS review
JOIN praxis.rome_occupation_versions AS version
  ON version.release_id=review.source_release_id
 AND version.code_rome=review.source_entity_id::character(5)
WHERE review.occupation_id=occupation.id AND review.source='rome';

UPDATE praxis.occupation AS occupation
SET onet_soc_code = review.source_entity_id,
    onet_job_zone = zone.job_zone,
    onet_seniority_provenance = jsonb_build_object(
      'source', 'onet', 'release_id', review.source_release_id,
      'crosswalk_release_id', review.crosswalk_release_id,
      'review_id', review.id, 'field', 'job_zone',
      'note', 'Job Zone is source context only; it is not a PRAXIS L0-L3 level.'
    )
FROM praxis.occupation_source_anchor_review AS review
JOIN praxis.onet_occupation_job_zones AS zone
  ON zone.release_id=review.source_release_id
 AND zone.onet_soc_code=review.source_entity_id
WHERE review.occupation_id=occupation.id AND review.source='onet';

-- Rebuild the governed read model so every consumer sees the reviewed links.
DROP VIEW praxis.harmonized_occupation_profile;

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
  ORDER BY release.imported_at DESC LIMIT 1
) AS rome ON true
LEFT JOIN LATERAL (
  SELECT version.title, version.release_id
  FROM praxis.onet_occupation_versions AS version
  JOIN praxis.source_releases AS release ON release.id = version.release_id
  WHERE version.onet_soc_code = occupation.onet_soc_code
    AND release.source = 'onet' AND release.is_active
  ORDER BY release.imported_at DESC LIMIT 1
) AS onet ON true
LEFT JOIN praxis.onet_job_zone_reference AS zone
  ON zone.release_id = onet.release_id
 AND zone.job_zone = occupation.onet_job_zone;

COMMENT ON VIEW praxis.harmonized_occupation_profile IS
  'Governed occupation read model. ESCO is the spine; exact reviewed ROME identities and published human-validated O*NET↔ESCO links enrich it without converting external levels to PRAXIS L0-L3.';
