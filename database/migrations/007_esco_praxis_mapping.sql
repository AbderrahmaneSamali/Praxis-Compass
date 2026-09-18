-- STATUS: APPROVED FOR PHASE 1.1 DATABASE-BACKED ESCO INGESTION.
-- ESCO remains the immutable source taxonomy. PRAXIS classifications live in
-- versioned, many-to-many mapping tables and never overwrite ESCO attributes.

CREATE TABLE IF NOT EXISTS praxis.esco_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  language text NOT NULL CHECK (language ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  source_uri text,
  source_checksum text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT false,
  UNIQUE (version, language)
);

CREATE UNIQUE INDEX IF NOT EXISTS esco_releases_one_active_language_idx
  ON praxis.esco_releases (language)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS praxis.esco_occupations (
  concept_uri text PRIMARY KEY
    CHECK (concept_uri LIKE 'http://data.europa.eu/esco/occupation/%'),
  concept_id uuid NOT NULL UNIQUE,
  first_seen_release_id uuid REFERENCES praxis.esco_releases(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS praxis.esco_occupation_versions (
  occupation_uri text NOT NULL
    REFERENCES praxis.esco_occupations(concept_uri) ON DELETE RESTRICT,
  release_id uuid NOT NULL
    REFERENCES praxis.esco_releases(id) ON DELETE RESTRICT,
  preferred_label text NOT NULL,
  alternative_labels text[] NOT NULL DEFAULT '{}',
  description text NOT NULL DEFAULT '',
  esco_notation text,
  broader_uri text,
  status text,
  source_modified_at timestamptz,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_payload) = 'object'),
  PRIMARY KEY (occupation_uri, release_id)
);

CREATE INDEX IF NOT EXISTS esco_occupation_versions_label_search_idx
  ON praxis.esco_occupation_versions USING gin (
    to_tsvector('simple', preferred_label || ' ' || description)
  );

CREATE TABLE IF NOT EXISTS praxis.esco_skills (
  concept_uri text PRIMARY KEY
    CHECK (concept_uri LIKE 'http://data.europa.eu/esco/skill/%'),
  concept_id uuid NOT NULL UNIQUE,
  first_seen_release_id uuid REFERENCES praxis.esco_releases(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS praxis.esco_skill_versions (
  skill_uri text NOT NULL
    REFERENCES praxis.esco_skills(concept_uri) ON DELETE RESTRICT,
  release_id uuid NOT NULL
    REFERENCES praxis.esco_releases(id) ON DELETE RESTRICT,
  preferred_label text NOT NULL,
  alternative_labels text[] NOT NULL DEFAULT '{}',
  description text NOT NULL DEFAULT '',
  skill_type text,
  reuse_level text,
  broader_label text,
  broader_uri text,
  status text,
  source_modified_at timestamptz,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_payload) = 'object'),
  PRIMARY KEY (skill_uri, release_id)
);

CREATE INDEX IF NOT EXISTS esco_skill_versions_label_search_idx
  ON praxis.esco_skill_versions USING gin (
    to_tsvector('simple', preferred_label || ' ' || description)
  );

CREATE TABLE IF NOT EXISTS praxis.esco_occupation_skill_relations (
  release_id uuid NOT NULL
    REFERENCES praxis.esco_releases(id) ON DELETE RESTRICT,
  occupation_uri text NOT NULL
    REFERENCES praxis.esco_occupations(concept_uri) ON DELETE RESTRICT,
  skill_uri text NOT NULL
    REFERENCES praxis.esco_skills(concept_uri) ON DELETE RESTRICT,
  relationship_type text NOT NULL
    CHECK (relationship_type IN ('essential', 'optional')),
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_payload) = 'object'),
  PRIMARY KEY (release_id, occupation_uri, skill_uri, relationship_type)
);

CREATE INDEX IF NOT EXISTS esco_occupation_skill_by_skill_idx
  ON praxis.esco_occupation_skill_relations
  (release_id, skill_uri, relationship_type, occupation_uri);

CREATE TABLE IF NOT EXISTS praxis.esco_occupation_hierarchy (
  release_id uuid NOT NULL
    REFERENCES praxis.esco_releases(id) ON DELETE RESTRICT,
  narrower_uri text NOT NULL
    REFERENCES praxis.esco_occupations(concept_uri) ON DELETE RESTRICT,
  broader_uri text NOT NULL,
  relation_type text NOT NULL DEFAULT 'broader'
    CHECK (relation_type IN ('broader', 'narrower', 'related')),
  PRIMARY KEY (release_id, narrower_uri, broader_uri, relation_type),
  CHECK (narrower_uri <> broader_uri)
);

CREATE TABLE IF NOT EXISTS praxis.esco_skill_hierarchy (
  release_id uuid NOT NULL
    REFERENCES praxis.esco_releases(id) ON DELETE RESTRICT,
  narrower_uri text NOT NULL
    REFERENCES praxis.esco_skills(concept_uri) ON DELETE RESTRICT,
  broader_uri text NOT NULL,
  relation_type text NOT NULL DEFAULT 'broader'
    CHECK (relation_type IN ('broader', 'narrower', 'related')),
  PRIMARY KEY (release_id, narrower_uri, broader_uri, relation_type),
  CHECK (narrower_uri <> broader_uri)
);

CREATE TABLE IF NOT EXISTS praxis.praxis_taxonomy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  description text NOT NULL DEFAULT '',
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
  CHECK ((status = 'published' AND published_at IS NOT NULL) OR status <> 'published')
);

CREATE TABLE IF NOT EXISTS praxis.praxis_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_version_id uuid NOT NULL
    REFERENCES praxis.praxis_taxonomy_versions(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  label_fr text NOT NULL,
  label_en text,
  description text NOT NULL DEFAULT '',
  sort_order smallint NOT NULL CHECK (sort_order > 0),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (taxonomy_version_id, code),
  UNIQUE (id, taxonomy_version_id)
);

CREATE TABLE IF NOT EXISTS praxis.praxis_cross_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_version_id uuid NOT NULL
    REFERENCES praxis.praxis_taxonomy_versions(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  label_fr text NOT NULL,
  label_en text,
  description text NOT NULL DEFAULT '',
  sort_order smallint NOT NULL CHECK (sort_order > 0),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (taxonomy_version_id, code),
  UNIQUE (id, taxonomy_version_id)
);

CREATE TABLE IF NOT EXISTS praxis.occupation_sector_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occupation_uri text NOT NULL
    REFERENCES praxis.esco_occupations(concept_uri) ON DELETE RESTRICT,
  taxonomy_version_id uuid NOT NULL
    REFERENCES praxis.praxis_taxonomy_versions(id) ON DELETE RESTRICT,
  sector_id uuid NOT NULL,
  attachment_type text NOT NULL
    CHECK (attachment_type IN ('primary', 'secondary')),
  relevance_score numeric(4,3) NOT NULL
    CHECK (relevance_score BETWEEN 0 AND 1),
  mapping_method text NOT NULL
    CHECK (mapping_method IN ('automatic', 'manual', 'reviewed')),
  confidence_score numeric(4,3)
    CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  validation_status text NOT NULL DEFAULT 'proposed'
    CHECK (validation_status IN ('proposed', 'under_review', 'validated', 'rejected')),
  validated boolean NOT NULL DEFAULT false,
  rationale text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence) = 'object'),
  algorithm_version text,
  validated_at timestamptz,
  validated_by text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (sector_id, taxonomy_version_id)
    REFERENCES praxis.praxis_sectors(id, taxonomy_version_id) ON DELETE RESTRICT,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK (NOT validated OR (validated_at IS NOT NULL AND validated_by IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS occupation_sector_mapping_current_idx
  ON praxis.occupation_sector_mapping (occupation_uri, sector_id)
  WHERE valid_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS occupation_sector_one_primary_idx
  ON praxis.occupation_sector_mapping (occupation_uri, taxonomy_version_id)
  WHERE attachment_type = 'primary' AND valid_to IS NULL;

CREATE TABLE IF NOT EXISTS praxis.skill_sector_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_uri text NOT NULL
    REFERENCES praxis.esco_skills(concept_uri) ON DELETE RESTRICT,
  taxonomy_version_id uuid NOT NULL
    REFERENCES praxis.praxis_taxonomy_versions(id) ON DELETE RESTRICT,
  sector_id uuid NOT NULL,
  attachment_type text NOT NULL
    CHECK (attachment_type IN ('sector_specific', 'cross_sector', 'supporting')),
  relevance_score numeric(4,3) NOT NULL
    CHECK (relevance_score BETWEEN 0 AND 1),
  mapping_method text NOT NULL
    CHECK (mapping_method IN ('automatic', 'manual', 'reviewed')),
  confidence_score numeric(4,3)
    CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  validation_status text NOT NULL DEFAULT 'proposed'
    CHECK (validation_status IN ('proposed', 'under_review', 'validated', 'rejected')),
  validated boolean NOT NULL DEFAULT false,
  rationale text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence) = 'object'),
  algorithm_version text,
  validated_at timestamptz,
  validated_by text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (sector_id, taxonomy_version_id)
    REFERENCES praxis.praxis_sectors(id, taxonomy_version_id) ON DELETE RESTRICT,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK (NOT validated OR (validated_at IS NOT NULL AND validated_by IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_sector_mapping_current_idx
  ON praxis.skill_sector_mapping (skill_uri, sector_id)
  WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS praxis.skill_cross_domain_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_uri text NOT NULL
    REFERENCES praxis.esco_skills(concept_uri) ON DELETE RESTRICT,
  taxonomy_version_id uuid NOT NULL
    REFERENCES praxis.praxis_taxonomy_versions(id) ON DELETE RESTRICT,
  cross_domain_id uuid NOT NULL,
  attachment_type text NOT NULL DEFAULT 'supporting'
    CHECK (attachment_type IN ('primary', 'secondary', 'supporting')),
  relevance_score numeric(4,3) NOT NULL
    CHECK (relevance_score BETWEEN 0 AND 1),
  mapping_method text NOT NULL
    CHECK (mapping_method IN ('automatic', 'manual', 'reviewed')),
  confidence_score numeric(4,3)
    CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  validation_status text NOT NULL DEFAULT 'proposed'
    CHECK (validation_status IN ('proposed', 'under_review', 'validated', 'rejected')),
  validated boolean NOT NULL DEFAULT false,
  rationale text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence) = 'object'),
  algorithm_version text,
  validated_at timestamptz,
  validated_by text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cross_domain_id, taxonomy_version_id)
    REFERENCES praxis.praxis_cross_domains(id, taxonomy_version_id) ON DELETE RESTRICT,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK (NOT validated OR (validated_at IS NOT NULL AND validated_by IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_cross_domain_mapping_current_idx
  ON praxis.skill_cross_domain_mapping (skill_uri, cross_domain_id)
  WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS praxis.praxis_mapping_review_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mapping_kind text NOT NULL
    CHECK (mapping_kind IN ('occupation_sector', 'skill_sector', 'skill_cross_domain')),
  mapping_id uuid NOT NULL,
  decision text NOT NULL
    CHECK (decision IN ('submitted', 'approved', 'rejected', 'reopened', 'superseded')),
  reviewer text,
  notes text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(snapshot) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS praxis_mapping_review_events_mapping_idx
  ON praxis.praxis_mapping_review_events (mapping_kind, mapping_id, occurred_at DESC);

INSERT INTO praxis.praxis_taxonomy_versions
  (version, status, description)
VALUES
  ('praxis-2026.1', 'draft',
   'Eight vertical sector universes and six horizontal cross-functional domains. Management exists only as Management & Leadership in the horizontal layer.')
ON CONFLICT (version) DO UPDATE SET
  description = EXCLUDED.description;

INSERT INTO praxis.praxis_sectors
  (taxonomy_version_id, code, label_fr, label_en, sort_order)
SELECT taxonomy.id, seed.code, seed.label_fr, seed.label_en, seed.sort_order
FROM praxis.praxis_taxonomy_versions taxonomy
CROSS JOIN (VALUES
  ('construction_infrastructure_real_estate', 'Construction, Infrastructure & Immobilier', 'Construction, Infrastructure & Real Estate', 1),
  ('agriculture_agroindustry_food', 'Agriculture, Agro-industrie & Food', 'Agriculture, Agro-industry & Food', 2),
  ('industry_production_maintenance', 'Industrie, Production & Maintenance', 'Industry, Production & Maintenance', 3),
  ('mines_energy_water_resources', 'Mines, Énergie, Eau & Ressources naturelles', 'Mining, Energy, Water & Natural Resources', 4),
  ('digital_it_telecom', 'Digital, IT & Télécommunications', 'Digital, IT & Telecommunications', 5),
  ('finance_banking_insurance_fintech', 'Finance, Banque, Assurance & FinTech', 'Finance, Banking, Insurance & FinTech', 6),
  ('health_pharma_life_sciences', 'Santé, Pharma & Life Sciences', 'Health, Pharma & Life Sciences', 7),
  ('transport_logistics_supply_chain', 'Transport, Logistique & Supply Chain', 'Transport, Logistics & Supply Chain', 8)
) AS seed(code, label_fr, label_en, sort_order)
WHERE taxonomy.version = 'praxis-2026.1'
ON CONFLICT (taxonomy_version_id, code) DO UPDATE SET
  label_fr = EXCLUDED.label_fr,
  label_en = EXCLUDED.label_en,
  sort_order = EXCLUDED.sort_order;

INSERT INTO praxis.praxis_cross_domains
  (taxonomy_version_id, code, label_fr, label_en, sort_order)
SELECT taxonomy.id, seed.code, seed.label_fr, seed.label_en, seed.sort_order
FROM praxis.praxis_taxonomy_versions taxonomy
CROSS JOIN (VALUES
  ('data_ai_digital', 'Data, IA & Digital', 'Data, AI & Digital', 1),
  ('management_leadership', 'Management & Leadership', 'Management & Leadership', 2),
  ('project_management', 'Project Management', 'Project Management', 3),
  ('quality_qhse_operational_excellence', 'Qualité, QHSE & Excellence opérationnelle', 'Quality, QHSE & Operational Excellence', 4),
  ('finance_performance', 'Finance & Performance', 'Finance & Performance', 5),
  ('sustainability_esg_green_skills', 'Sustainability, ESG & Green Skills', 'Sustainability, ESG & Green Skills', 6)
) AS seed(code, label_fr, label_en, sort_order)
WHERE taxonomy.version = 'praxis-2026.1'
ON CONFLICT (taxonomy_version_id, code) DO UPDATE SET
  label_fr = EXCLUDED.label_fr,
  label_en = EXCLUDED.label_en,
  sort_order = EXCLUDED.sort_order;

COMMENT ON TABLE praxis.esco_occupation_versions IS
  'Immutable release-specific ESCO occupation attributes; PRAXIS mappings must not update this table.';
COMMENT ON TABLE praxis.esco_skill_versions IS
  'Immutable release-specific ESCO skill attributes; PRAXIS mappings must not update this table.';
COMMENT ON TABLE praxis.occupation_sector_mapping IS
  'Versioned many-to-many PRAXIS sector overlay for ESCO occupations.';
COMMENT ON TABLE praxis.skill_cross_domain_mapping IS
  'Versioned many-to-many PRAXIS cross-domain overlay for ESCO skills.';
COMMENT ON TABLE praxis.praxis_sectors IS
  'Vertical PRAXIS sector universes. Management is intentionally excluded from this dimension.';
COMMENT ON TABLE praxis.praxis_cross_domains IS
  'Horizontal PRAXIS domains, including Management & Leadership.';
