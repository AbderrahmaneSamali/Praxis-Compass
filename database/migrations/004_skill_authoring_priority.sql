-- PRAXIS Navigator: deterministic skill-authoring priority graph.
-- This remains deliberately relational: at MVP scale the graph is a few
-- stable identifiers and 1-hop relations, not a graph/search subsystem.

CREATE TABLE IF NOT EXISTS praxis.skill_relation (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL CHECK (predicate IN ('broader', 'narrower', 'related')),
  object_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT skill_relation_no_self_reference CHECK (subject_id <> object_id),
  CONSTRAINT skill_relation_unique UNIQUE (subject_id, predicate, object_id, source)
);

-- Lot N5 has not introduced a dedicated pathway aggregate yet. This minimal
-- stable-ID table is intentionally replaceable once the pathway builder lands.
CREATE TABLE IF NOT EXISTS praxis.pathway (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (
    variant IN ('essentielle', 'acceleree', 'certifiante')
  ),
  metier_target_id TEXT,
  version TEXT NOT NULL DEFAULT 'v1'
);

CREATE TABLE IF NOT EXISTS praxis.skill_pathway_ref (
  id BIGSERIAL PRIMARY KEY,
  skill_id TEXT NOT NULL,
  pathway_id TEXT NOT NULL REFERENCES praxis.pathway(id),
  source TEXT NOT NULL DEFAULT 'seed_use_case',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT skill_pathway_ref_unique UNIQUE (skill_id, pathway_id, source)
);

CREATE TABLE IF NOT EXISTS praxis.skill_metier_ref (
  id BIGSERIAL PRIMARY KEY,
  skill_id TEXT NOT NULL,
  metier_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed_use_case',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT skill_metier_ref_unique UNIQUE (skill_id, metier_id, source)
);

CREATE INDEX IF NOT EXISTS skill_relation_subject_idx
  ON praxis.skill_relation (subject_id);
CREATE INDEX IF NOT EXISTS skill_relation_object_idx
  ON praxis.skill_relation (object_id);
CREATE INDEX IF NOT EXISTS skill_pathway_ref_skill_idx
  ON praxis.skill_pathway_ref (skill_id);
CREATE INDEX IF NOT EXISTS skill_pathway_ref_pathway_idx
  ON praxis.skill_pathway_ref (pathway_id);
CREATE INDEX IF NOT EXISTS skill_metier_ref_skill_idx
  ON praxis.skill_metier_ref (skill_id);

INSERT INTO praxis.pathway (id, label, variant, metier_target_id, version)
VALUES
  (
    'path_bim_coord_essential',
    'BIM Coordinateur - Essentielle',
    'essentielle',
    'metier_bim_coordinateur',
    'navigator-v2-section-16'
  ),
  (
    'path_bim_coord_acceleree',
    'BIM Coordinateur - Acceleree',
    'acceleree',
    'metier_bim_coordinateur',
    'navigator-v2-section-16'
  ),
  (
    'path_bim_coord_certifiante',
    'BIM Coordinateur - Certifiante',
    'certifiante',
    'metier_bim_coordinateur',
    'navigator-v2-section-16'
  )
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  variant = EXCLUDED.variant,
  metier_target_id = EXCLUDED.metier_target_id,
  version = EXCLUDED.version;

INSERT INTO praxis.skill_pathway_ref (skill_id, pathway_id, source)
VALUES
  ('skill_ifc_bcf', 'path_bim_coord_essential', 'seed_use_case'),
  ('skill_navisworks', 'path_bim_coord_essential', 'seed_use_case'),
  ('skill_clash_detection', 'path_bim_coord_essential', 'seed_use_case'),
  ('skill_bim_coordination', 'path_bim_coord_essential', 'seed_use_case'),
  ('skill_navisworks', 'path_bim_coord_acceleree', 'seed_use_case'),
  ('skill_bim_coordination', 'path_bim_coord_acceleree', 'seed_use_case'),
  ('skill_cde_coordination', 'path_bim_coord_acceleree', 'seed_use_case'),
  ('skill_bim_coordination', 'path_bim_coord_certifiante', 'seed_use_case'),
  ('skill_iso_19650', 'path_bim_coord_certifiante', 'seed_use_case')
ON CONFLICT (skill_id, pathway_id, source) DO NOTHING;

-- Section 16 supplies one BIM Coordinateur target and nine exact skills from
-- the confirmed CV, targeted test, gaps and trajectories. The metier signal is
-- intentionally broader/weaker than pathway coverage, so all nine stay visible
-- for authoring triage even when a curated pathway does not yet include them.
INSERT INTO praxis.skill_metier_ref (skill_id, metier_id, source)
VALUES
  ('skill_revit', 'metier_bim_coordinateur', 'seed_use_case'),
  ('skill_navisworks', 'metier_bim_coordinateur', 'seed_use_case'),
  ('skill_clash_detection', 'metier_bim_coordinateur', 'seed_use_case'),
  ('skill_ifc_bcf', 'metier_bim_coordinateur', 'seed_use_case'),
  ('skill_iso_19650', 'metier_bim_coordinateur', 'seed_use_case'),
  ('skill_cde_coordination', 'metier_bim_coordinateur', 'seed_use_case'),
  ('skill_bim_coordination', 'metier_bim_coordinateur', 'seed_use_case'),
  ('skill_autocad', 'metier_bim_coordinateur', 'seed_use_case'),
  ('skill_ms_project', 'metier_bim_coordinateur', 'seed_use_case')
ON CONFLICT (skill_id, metier_id, source) DO NOTHING;

-- Navigator v2 section 4.1 describes BIM as the general concept, with clash
-- detection as a narrower concept and Navisworks as an associated skill/tool.
-- We normalize both `child broader parent` and `parent narrower child` in the
-- service, so BIM coordination, clash detection and Navisworks share skill_bim
-- as their explicit 1-hop parent. The related edge stays separate and symmetric
-- at read time; it does not manufacture a broader-parent cluster.
INSERT INTO praxis.skill_relation (subject_id, predicate, object_id, source)
VALUES
  ('skill_bim_coordination', 'broader', 'skill_bim', 'manual'),
  ('skill_bim', 'narrower', 'skill_clash_detection', 'manual'),
  ('skill_bim', 'narrower', 'skill_navisworks', 'manual'),
  ('skill_clash_detection', 'related', 'skill_navisworks', 'manual')
ON CONFLICT (subject_id, predicate, object_id, source) DO NOTHING;
