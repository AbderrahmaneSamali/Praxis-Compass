-- ROME 4.0 v61 and O*NET 30.3 immutable source registries and release-scoped data.
-- source_releases is canonical. esco_releases remains only as a compatibility
-- anchor for existing ESCO foreign keys and is pinned to the canonical row.
--
-- rollback:
--   Export any imported source data, then drop the views, policy functions,
--   source-specific tables, source_releases compatibility triggers/FK, and the
--   nullable PRAXIS anchors/seniority columns added below. Restore the previous
--   mapping_kind CHECK. Imported source and review history cannot be preserved
--   by the pre-024 schema.

CREATE TABLE praxis.source_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('esco', 'rome', 'onet')),
  version text NOT NULL,
  language text NOT NULL CHECK (language ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  source_uri text,
  source_checksum text NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  source_checksums jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_checksums) = 'object'),
  published_on date,
  license_name text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT false,
  UNIQUE (source, version, language),
  UNIQUE (id, source)
);

CREATE UNIQUE INDEX source_releases_one_active_language_idx
  ON praxis.source_releases (source, language) WHERE is_active;

INSERT INTO praxis.source_releases
  (id, source, version, language, source_uri, source_checksum,
   source_checksums, license_name, imported_at, is_active)
SELECT id, 'esco', version, language, source_uri,
       coalesce(source_checksum, repeat('0', 64)),
       CASE WHEN source_checksum IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('legacy_manifest', source_checksum) END,
       'European Commission ESCO terms', imported_at, is_active
FROM praxis.esco_releases
ON CONFLICT (source, version, language) DO NOTHING;

ALTER TABLE praxis.esco_releases
  ADD COLUMN source_release_id uuid;

UPDATE praxis.esco_releases AS legacy
SET source_release_id = registry.id
FROM praxis.source_releases AS registry
WHERE registry.source = 'esco'
  AND registry.version = legacy.version
  AND registry.language = legacy.language;

ALTER TABLE praxis.source_releases
  ADD CONSTRAINT source_releases_id_version_language_key
  UNIQUE (id, version, language);

ALTER TABLE praxis.esco_releases
  ALTER COLUMN source_release_id SET NOT NULL,
  ADD CONSTRAINT esco_releases_source_release_id_key UNIQUE (source_release_id),
  ADD CONSTRAINT esco_releases_source_release_id_fkey
    FOREIGN KEY (source_release_id, version, language)
    REFERENCES praxis.source_releases (id, version, language)
    ON DELETE RESTRICT;

CREATE FUNCTION praxis.prevent_source_release_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.source, NEW.version, NEW.language, NEW.source_uri,
         NEW.source_checksum, NEW.source_checksums, NEW.published_on,
         NEW.license_name, NEW.imported_at)
     IS DISTINCT FROM
     ROW(OLD.source, OLD.version, OLD.language, OLD.source_uri,
         OLD.source_checksum, OLD.source_checksums, OLD.published_on,
         OLD.license_name, OLD.imported_at) THEN
    RAISE EXCEPTION 'source release metadata is immutable; register a new version';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER source_releases_immutable_identity
BEFORE UPDATE ON praxis.source_releases
FOR EACH ROW EXECUTE FUNCTION praxis.prevent_source_release_identity_change();

CREATE FUNCTION praxis.enforce_esco_release_registry_match()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical praxis.source_releases%ROWTYPE;
BEGIN
  SELECT * INTO canonical FROM praxis.source_releases WHERE id=NEW.source_release_id AND source='esco';
  IF NOT FOUND OR canonical.version<>NEW.version OR canonical.language<>NEW.language
     OR (NEW.source_checksum IS NOT NULL AND NEW.source_checksum<>canonical.source_checksum) THEN
    RAISE EXCEPTION 'esco_releases compatibility row diverges from source_releases';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER esco_release_registry_match
BEFORE INSERT OR UPDATE ON praxis.esco_releases
FOR EACH ROW EXECUTE FUNCTION praxis.enforce_esco_release_registry_match();

CREATE TABLE praxis.rome_occupations (
  code_rome character(5) PRIMARY KEY CHECK (code_rome ~ '^[A-Z][0-9]{4}$'),
  first_seen_release_id uuid NOT NULL
    REFERENCES praxis.source_releases(id) ON DELETE RESTRICT
);

CREATE TABLE praxis.rome_occupation_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  code_fiche_metier text NOT NULL,
  code_ogr bigint NOT NULL,
  preferred_label text NOT NULL,
  transition_eco text,
  transition_num boolean NOT NULL,
  transition_demo boolean NOT NULL,
  emploi_reglemente boolean NOT NULL,
  emploi_cadre boolean NOT NULL,
  code_rome_parent character(5) NOT NULL,
  PRIMARY KEY (release_id, code_rome),
  UNIQUE (release_id, code_ogr)
);

CREATE TABLE praxis.rome_ogr_entities (
  code_ogr bigint PRIMARY KEY,
  entity_kind text NOT NULL CHECK (entity_kind IN ('Appellation', 'Compétence', 'Savoir', 'Macro-compétence', 'Item')),
  first_seen_release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT
);

CREATE TABLE praxis.rome_appellations (
  code_ogr bigint PRIMARY KEY REFERENCES praxis.rome_ogr_entities(code_ogr) ON DELETE RESTRICT,
  first_seen_release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT
);

CREATE TABLE praxis.rome_appellation_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_ogr bigint NOT NULL REFERENCES praxis.rome_appellations(code_ogr) ON DELETE RESTRICT,
  long_label text NOT NULL,
  short_label text NOT NULL,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  transition_eco text,
  transition_num boolean NOT NULL,
  transition_demo boolean NOT NULL,
  emploi_reglemente boolean NOT NULL,
  emploi_cadre boolean NOT NULL,
  classification text NOT NULL,
  origin text,
  code_rome_parent character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  peu_usite boolean NOT NULL,
  search_weight numeric(3,2) GENERATED ALWAYS AS
    (CASE WHEN peu_usite THEN 0.35 ELSE 1.00 END) STORED,
  PRIMARY KEY (release_id, code_ogr)
);

CREATE TABLE praxis.rome_substitutions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  source_code_ogr bigint NOT NULL REFERENCES praxis.rome_ogr_entities(code_ogr) ON DELETE RESTRICT,
  target_code_ogr bigint NOT NULL REFERENCES praxis.rome_ogr_entities(code_ogr) ON DELETE RESTRICT,
  source_kind text NOT NULL,
  target_kind text NOT NULL,
  source_label text NOT NULL,
  target_label text NOT NULL,
  source_indexation text,
  target_indexation text,
  PRIMARY KEY (release_id, source_code_ogr, target_code_ogr),
  CHECK (source_code_ogr <> target_code_ogr)
);

CREATE TABLE praxis.rome_items (
  code_ogr bigint PRIMARY KEY REFERENCES praxis.rome_ogr_entities(code_ogr) ON DELETE RESTRICT,
  first_seen_release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT
);

CREATE TABLE praxis.rome_item_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_ogr bigint NOT NULL REFERENCES praxis.rome_items(code_ogr) ON DELETE RESTRICT,
  label text NOT NULL,
  rubrique_code text,
  item_kind text NOT NULL CHECK (item_kind IN ('item', 'competence', 'savoir', 'macro_competence')),
  PRIMARY KEY (release_id, code_ogr, item_kind)
);

CREATE TABLE praxis.rome_competence_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_ogr bigint NOT NULL REFERENCES praxis.rome_items(code_ogr) ON DELETE RESTRICT,
  nature text NOT NULL,
  label text NOT NULL,
  definition text NOT NULL,
  macro_competence_ogr bigint REFERENCES praxis.rome_items(code_ogr) ON DELETE RESTRICT,
  macro_competence_code text,
  category text NOT NULL,
  subcategory text NOT NULL,
  transition_eco boolean NOT NULL,
  transition_num boolean NOT NULL,
  heterogeneity_label text,
  origin_label text,
  PRIMARY KEY (release_id, code_ogr)
);

CREATE TABLE praxis.rome_savoir_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_ogr bigint NOT NULL REFERENCES praxis.rome_items(code_ogr) ON DELETE RESTRICT,
  label text NOT NULL,
  category text NOT NULL,
  subcategory text NOT NULL,
  transition_eco boolean NOT NULL,
  transition_num boolean NOT NULL,
  PRIMARY KEY (release_id, code_ogr)
);

CREATE INDEX rome_savoir_category_idx
  ON praxis.rome_savoir_versions (release_id, category, subcategory);

CREATE TABLE praxis.rome_competence_hierarchy (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  competence_ogr bigint NOT NULL REFERENCES praxis.rome_items(code_ogr) ON DELETE RESTRICT,
  macro_competence_ogr bigint NOT NULL REFERENCES praxis.rome_items(code_ogr) ON DELETE RESTRICT,
  domain_code text NOT NULL,
  domain_label text NOT NULL,
  issue_code text NOT NULL,
  issue_label text NOT NULL,
  objective_code text NOT NULL,
  objective_label text NOT NULL,
  macro_competence_code text NOT NULL,
  PRIMARY KEY (release_id, competence_ogr, macro_competence_ogr)
);

CREATE TABLE praxis.rome_occupation_item_relations (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  code_ogr bigint NOT NULL REFERENCES praxis.rome_items(code_ogr) ON DELETE RESTRICT,
  coeur_metier boolean NOT NULL,
  PRIMARY KEY (release_id, code_rome, code_ogr)
);

CREATE TABLE praxis.rome_fiche_item_links (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  composition_bloc_code text NOT NULL,
  rubrique_code text NOT NULL DEFAULT '',
  code_ogr bigint NOT NULL REFERENCES praxis.rome_items(code_ogr) ON DELETE RESTRICT,
  PRIMARY KEY (release_id, code_rome, composition_bloc_code, rubrique_code, code_ogr)
);

CREATE TABLE praxis.rome_professional_domains (
  domain_code text PRIMARY KEY,
  first_seen_release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT
);

CREATE TABLE praxis.rome_professional_domain_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  domain_code text NOT NULL REFERENCES praxis.rome_professional_domains(domain_code) ON DELETE RESTRICT,
  domain_label text NOT NULL,
  grand_domain_code text NOT NULL,
  grand_domain_label text NOT NULL,
  PRIMARY KEY (release_id, domain_code)
);

CREATE TABLE praxis.rome_occupation_professional_domains (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  domain_code text NOT NULL REFERENCES praxis.rome_professional_domains(domain_code) ON DELETE RESTRICT,
  PRIMARY KEY (release_id, code_rome, domain_code)
);

CREATE TABLE praxis.rome_work_contexts (
  code_ogr bigint PRIMARY KEY,
  first_seen_release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT
);

CREATE TABLE praxis.rome_work_context_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_ogr bigint NOT NULL REFERENCES praxis.rome_work_contexts(code_ogr) ON DELETE RESTRICT,
  label text NOT NULL,
  context_type_code text NOT NULL,
  context_type_label text NOT NULL,
  PRIMARY KEY (release_id, code_ogr)
);

CREATE TABLE praxis.onet_occupations (
  onet_soc_code text PRIMARY KEY CHECK (onet_soc_code ~ '^[0-9]{2}-[0-9]{4}\.[0-9]{2}$'),
  first_seen_release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT
);

CREATE TABLE praxis.onet_occupation_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  onet_soc_code text NOT NULL REFERENCES praxis.onet_occupations(onet_soc_code) ON DELETE RESTRICT,
  title text NOT NULL,
  PRIMARY KEY (release_id, onet_soc_code)
);

CREATE TABLE praxis.onet_software_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL UNIQUE,
  first_seen_release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT
);

CREATE TABLE praxis.onet_software_product_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES praxis.onet_software_products(id) ON DELETE RESTRICT,
  element_id text NOT NULL,
  element_name text NOT NULL,
  hot_technology boolean NOT NULL,
  PRIMARY KEY (release_id, product_id),
  UNIQUE (release_id, product_id, element_id)
);

CREATE TABLE praxis.onet_occupation_software (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  onet_soc_code text NOT NULL REFERENCES praxis.onet_occupations(onet_soc_code) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES praxis.onet_software_products(id) ON DELETE RESTRICT,
  hot_technology boolean NOT NULL,
  in_demand boolean NOT NULL,
  PRIMARY KEY (release_id, onet_soc_code, product_id)
);

CREATE VIEW praxis.onet_in_demand_software
WITH (security_barrier = true) AS
SELECT association.release_id, association.onet_soc_code,
       association.product_id, product.canonical_name,
       version.element_id, version.element_name
FROM praxis.onet_occupation_software AS association
JOIN praxis.onet_software_products AS product ON product.id = association.product_id
JOIN praxis.onet_software_product_versions AS version
  ON version.release_id = association.release_id
 AND version.product_id = association.product_id
WHERE association.in_demand;

COMMENT ON VIEW praxis.onet_in_demand_software IS
  'Mandatory downstream O*NET occupation-software surface. The raw table is complete; only pair-specific In Demand=Y is an occupation signal. Hot Technology is global product metadata and must never generate a target profile.';

CREATE TABLE praxis.onet_job_zone_reference (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  job_zone smallint NOT NULL CHECK (job_zone BETWEEN 2 AND 5),
  name text NOT NULL,
  experience text NOT NULL,
  education text NOT NULL,
  job_training text NOT NULL,
  examples text NOT NULL,
  svp_range text NOT NULL,
  PRIMARY KEY (release_id, job_zone)
);

CREATE TABLE praxis.onet_occupation_job_zones (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  onet_soc_code text NOT NULL REFERENCES praxis.onet_occupations(onet_soc_code) ON DELETE RESTRICT,
  job_zone smallint NOT NULL,
  source_date text NOT NULL,
  domain_source text NOT NULL,
  PRIMARY KEY (release_id, onet_soc_code),
  FOREIGN KEY (release_id, job_zone)
    REFERENCES praxis.onet_job_zone_reference(release_id, job_zone) ON DELETE RESTRICT
);

CREATE TABLE praxis.source_cross_domain_proposal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  source_entity_kind text NOT NULL CHECK (source_entity_kind IN ('rome_occupation')),
  source_entity_id text NOT NULL,
  taxonomy_version_id uuid NOT NULL REFERENCES praxis.praxis_taxonomy_versions(id) ON DELETE RESTRICT,
  cross_domain_id uuid NOT NULL,
  mapping_method text NOT NULL DEFAULT 'automatic' CHECK (mapping_method = 'automatic'),
  validation_status text NOT NULL DEFAULT 'proposed'
    CHECK (validation_status IN ('proposed', 'under_review', 'validated', 'rejected')),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cross_domain_id, taxonomy_version_id)
    REFERENCES praxis.praxis_cross_domains(id, taxonomy_version_id) ON DELETE RESTRICT,
  UNIQUE (source_release_id, source_entity_kind, source_entity_id, cross_domain_id)
);

ALTER TABLE praxis.praxis_mapping_review_events
  DROP CONSTRAINT praxis_mapping_review_events_mapping_kind_check,
  ADD CONSTRAINT praxis_mapping_review_events_mapping_kind_check CHECK (
    mapping_kind IN (
      'occupation_sector', 'skill_sector', 'skill_cross_domain',
      'occupation_skill_target', 'navigator_role_skill_target',
      'course_skill_outcome', 'source_cross_domain', 'occupation_seniority'
    )
  );

ALTER TABLE praxis.skill
  ADD COLUMN rome_item_ogr bigint REFERENCES praxis.rome_items(code_ogr) ON DELETE RESTRICT,
  ADD COLUMN onet_software_product_id uuid REFERENCES praxis.onet_software_products(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX skill_rome_item_anchor_idx
  ON praxis.skill (rome_item_ogr) WHERE rome_item_ogr IS NOT NULL;
CREATE UNIQUE INDEX skill_onet_software_anchor_idx
  ON praxis.skill (onet_software_product_id) WHERE onet_software_product_id IS NOT NULL;

ALTER TABLE praxis.occupation
  ADD COLUMN rome_code_rome character(5) REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  ADD COLUMN onet_soc_code text REFERENCES praxis.onet_occupations(onet_soc_code) ON DELETE RESTRICT,
  ADD COLUMN isco_seniority_provenance jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(isco_seniority_provenance) = 'object'),
  ADD COLUMN rome_emploi_cadre boolean,
  ADD COLUMN rome_seniority_provenance jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(rome_seniority_provenance) = 'object'),
  ADD COLUMN onet_job_zone smallint CHECK (onet_job_zone BETWEEN 2 AND 5),
  ADD COLUMN onet_seniority_provenance jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(onet_seniority_provenance) = 'object');

UPDATE praxis.occupation
SET isco_seniority_provenance = jsonb_build_object(
  'source', 'esco', 'derivation', 'first digit of ESCO ISCO notation',
  'algorithm_version', 'praxis-isco-major-group-v1'
)
WHERE isco_major_group IS NOT NULL;

CREATE TABLE praxis.occupation_seniority_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occupation_id text NOT NULL REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  signals jsonb NOT NULL CHECK (jsonb_typeof(signals) = 'object'),
  mapping_method text NOT NULL DEFAULT 'automatic' CHECK (mapping_method = 'automatic'),
  validation_status text NOT NULL DEFAULT 'proposed'
    CHECK (validation_status IN ('proposed', 'under_review', 'validated', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION praxis.capture_seniority_disagreement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  esco_high boolean;
  rome_high boolean;
  onet_high boolean;
  populated integer;
  distinct_values integer;
  proposal_id uuid;
BEGIN
  esco_high := CASE WHEN NEW.isco_major_group IS NULL THEN NULL ELSE NEW.isco_major_group IN (1, 2) END;
  rome_high := NEW.rome_emploi_cadre;
  onet_high := CASE WHEN NEW.onet_job_zone IS NULL THEN NULL ELSE NEW.onet_job_zone >= 4 END;
  SELECT count(*), count(DISTINCT value)
  INTO populated, distinct_values
  FROM unnest(ARRAY[esco_high, rome_high, onet_high]) AS value
  WHERE value IS NOT NULL;
  IF populated >= 2 AND distinct_values > 1 THEN
    INSERT INTO praxis.occupation_seniority_review (occupation_id, signals)
    VALUES (NEW.id, jsonb_build_object(
      'isco_major_group', NEW.isco_major_group,
      'rome_emploi_cadre', NEW.rome_emploi_cadre,
      'onet_job_zone', NEW.onet_job_zone,
      'provenance', jsonb_build_object(
        'esco', NEW.isco_seniority_provenance,
        'rome', NEW.rome_seniority_provenance,
        'onet', NEW.onet_seniority_provenance)))
    RETURNING id INTO proposal_id;
    INSERT INTO praxis.praxis_mapping_review_events
      (mapping_kind, mapping_id, decision, notes, snapshot)
    VALUES ('occupation_seniority', proposal_id, 'submitted',
            'Independent source seniority signals disagree; no value was resolved.',
            jsonb_build_object('occupation_id', NEW.id));
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER occupation_capture_seniority_disagreement
AFTER INSERT OR UPDATE OF isco_major_group, rome_emploi_cadre, onet_job_zone
ON praxis.occupation
FOR EACH ROW EXECUTE FUNCTION praxis.capture_seniority_disagreement();

CREATE FUNCTION praxis.occupation_direction_guard(origin_id text, target_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
WITH pair AS (
  SELECT origin.*, target.isco_major_group AS target_isco,
         target.rome_emploi_cadre AS target_rome,
         target.onet_job_zone AS target_onet
  FROM praxis.occupation origin
  JOIN praxis.occupation target ON target.id = target_id
  WHERE origin.id = origin_id
), comparisons AS (
  SELECT allowed FROM pair CROSS JOIN LATERAL (VALUES
    (CASE WHEN isco_major_group IS NULL OR target_isco IS NULL THEN NULL
          ELSE target_isco <= isco_major_group END),
    (CASE WHEN rome_emploi_cadre IS NULL OR target_rome IS NULL THEN NULL
          ELSE target_rome OR NOT rome_emploi_cadre END),
    (CASE WHEN onet_job_zone IS NULL OR target_onet IS NULL THEN NULL
          ELSE target_onet >= onet_job_zone END)
  ) AS signal(allowed)
  WHERE allowed IS NOT NULL
)
SELECT CASE WHEN count(*) = 0 THEN false ELSE bool_and(allowed) END
FROM comparisons
$$;

COMMENT ON FUNCTION praxis.occupation_direction_guard(text, text) IS
  'Future destination-direction guard only: every comparable source must agree the target is non-descending; a single available signal must itself indicate the more-senior/equal reading. Destination recommendation remains disabled.';

COMMENT ON COLUMN praxis.skill.rome_item_ogr IS
  'Nullable reviewed ROME anchor. Never populated by source ingest or label matching.';
COMMENT ON COLUMN praxis.skill.onet_software_product_id IS
  'Nullable reviewed O*NET software anchor. Never populated by source ingest or label matching.';
COMMENT ON COLUMN praxis.occupation.rome_code_rome IS
  'Nullable reviewed ROME occupation anchor; source ingest never populates cross-source anchors.';
COMMENT ON COLUMN praxis.occupation.onet_soc_code IS
  'Nullable reviewed O*NET occupation anchor; source ingest never populates cross-source anchors.';
