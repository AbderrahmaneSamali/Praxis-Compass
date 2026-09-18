-- Curated first-launch scope for Digital / IT / Telecommunications.
-- This is a product-discovery scope, not a claim that métier skill levels have
-- been validated. Requirements remain governed by their own review workflow.

CREATE TABLE praxis.occupation_launch_scope (
  scope_code text NOT NULL,
  occupation_uri text NOT NULL
    REFERENCES praxis.esco_occupations(concept_uri) ON DELETE RESTRICT,
  priority_rank smallint NOT NULL CHECK (priority_rank > 0),
  selection_reason text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_code, occupation_uri),
  UNIQUE (scope_code, priority_rank)
);

WITH selected(occupation_uri, priority_rank, selection_reason) AS (
  VALUES
    ('http://data.europa.eu/esco/occupation/f2b15a0e-e65a-438a-affb-29b9d50b77d1', 1, 'Core software engineering'),
    ('http://data.europa.eu/esco/occupation/c40a2919-48a9-40ea-b506-1f34f693496d', 2, 'Web delivery'),
    ('http://data.europa.eu/esco/occupation/2ed56c3f-61d6-4f7e-9ef8-8849eb102e4c', 3, 'Mobile delivery'),
    ('http://data.europa.eu/esco/occupation/d3edb8f8-3a06-47a0-8fb9-9b212c006aa2', 4, 'Data analysis'),
    ('http://data.europa.eu/esco/occupation/258e46f9-0075-4a2e-adae-1ff0477e0f30', 5, 'Data science'),
    ('http://data.europa.eu/esco/occupation/35553663-deab-4d9a-bf22-15c1625d28e8', 6, 'Artificial intelligence'),
    ('http://data.europa.eu/esco/occupation/207d7b18-6540-432e-8aa6-785ed434572f', 7, 'Business intelligence'),
    ('http://data.europa.eu/esco/occupation/8c57af09-719c-42b3-be40-6ed4946236cc', 8, 'Data platforms'),
    ('http://data.europa.eu/esco/occupation/349ee6f6-c295-4c38-9b98-48765b55280e', 9, 'Cloud operations'),
    ('http://data.europa.eu/esco/occupation/cc867bee-ab5c-427f-9244-f7a204d9574b', 10, 'DevOps'),
    ('http://data.europa.eu/esco/occupation/2fb96c6c-8d0b-4ef0-b1ee-3e493305e4eb', 11, 'Cloud architecture'),
    ('http://data.europa.eu/esco/occupation/cf2b03cd-feb7-4f47-90f6-ff1ed6016d3d', 12, 'Networks'),
    ('http://data.europa.eu/esco/occupation/9e2e6e1e-363b-4e1b-a673-7bc0f7343300', 13, 'Systems administration'),
    ('http://data.europa.eu/esco/occupation/0464b062-cea6-4164-b10d-956c61956ae7', 14, 'Cybersecurity operations'),
    ('http://data.europa.eu/esco/occupation/7754d570-9519-48c2-b1c9-8e165f8bca0f', 15, 'Cybersecurity risk'),
    ('http://data.europa.eu/esco/occupation/106f79e4-6264-45f1-9e7a-297435cd684b', 16, 'Software quality assurance'),
    ('http://data.europa.eu/esco/occupation/faed411a-f920-4100-86a8-b877928b429c', 17, 'User experience'),
    ('http://data.europa.eu/esco/occupation/8b6388a4-4904-471b-9331-d3b1211f5525', 18, 'ICT project delivery'),
    ('http://data.europa.eu/esco/occupation/719f101d-1866-49d3-8d5c-2256f606a8b9', 19, 'Digital transformation'),
    ('http://data.europa.eu/esco/occupation/02eb0ae6-ecdd-4602-9c8e-60ffe6dbe1e2', 20, 'Telecommunications engineering')
)
INSERT INTO praxis.occupation_launch_scope
  (scope_code, occupation_uri, priority_rank, selection_reason)
SELECT 'digital_it_telecom_v1', occupation_uri, priority_rank, selection_reason
FROM selected;

-- Make every launch occupation discoverable through the sector filter. Keep
-- an existing primary sector if one exists; otherwise Digital becomes primary.
WITH launch AS (
  SELECT occupation_uri
  FROM praxis.occupation_launch_scope
  WHERE scope_code = 'digital_it_telecom_v1'
), taxonomy AS (
  SELECT taxonomy.id AS taxonomy_version_id, sector.id AS sector_id
  FROM praxis.praxis_taxonomy_versions taxonomy
  JOIN praxis.praxis_sectors sector
    ON sector.taxonomy_version_id = taxonomy.id
   AND sector.code = 'digital_it_telecom'
  WHERE taxonomy.version = 'praxis-2026.1'
)
INSERT INTO praxis.occupation_sector_mapping
  (occupation_uri, taxonomy_version_id, sector_id, attachment_type,
   relevance_score, mapping_method, confidence_score, validation_status,
   validated, rationale, evidence, algorithm_version)
SELECT launch.occupation_uri, taxonomy.taxonomy_version_id, taxonomy.sector_id,
       CASE WHEN EXISTS (
         SELECT 1 FROM praxis.occupation_sector_mapping current
         WHERE current.occupation_uri = launch.occupation_uri
           AND current.taxonomy_version_id = taxonomy.taxonomy_version_id
           AND current.attachment_type = 'primary' AND current.valid_to IS NULL
       ) THEN 'secondary' ELSE 'primary' END,
       0.950, 'manual', 0.850, 'proposed', false,
       'Selected for the Digital/IT/Telecom v1 launch scope; sector mapping awaits human review.',
       jsonb_build_object('source', 'digital_it_telecom_v1', 'kind', 'launch_scope'),
       'digital-launch-scope-v1'
FROM launch CROSS JOIN taxonomy
ON CONFLICT (occupation_uri, sector_id) WHERE valid_to IS NULL
DO UPDATE SET relevance_score = EXCLUDED.relevance_score,
              rationale = EXCLUDED.rationale,
              evidence = EXCLUDED.evidence,
              algorithm_version = EXCLUDED.algorithm_version;

CREATE OR REPLACE VIEW praxis.active_occupation_launch_scope AS
SELECT scope.scope_code, scope.priority_rank, scope.occupation_uri,
       version.preferred_label, version.esco_notation, version.language,
       scope.selection_reason
FROM praxis.occupation_launch_scope scope
JOIN praxis.esco_occupation_versions version
  ON version.occupation_uri = scope.occupation_uri
JOIN praxis.esco_releases release
  ON release.id = version.release_id AND release.is_active
WHERE scope.status = 'active';

COMMENT ON TABLE praxis.occupation_launch_scope IS
  'Explicit, ordered product launch scopes. Membership enables discovery but does not validate métier requirements or proficiency levels.';
