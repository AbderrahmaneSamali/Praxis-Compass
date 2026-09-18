-- Phase 1.2: introduce enforced PRAXIS skill and occupation identities.
-- ESCO URI foreign keys land after pending migration 007 is approved and applied.
--
-- rollback:
--   ALTER TABLE praxis.pathway
--     DROP CONSTRAINT IF EXISTS pathway_metier_target_id_fkey;
--   ALTER TABLE praxis.navigator_skill_estimates
--     DROP CONSTRAINT IF EXISTS navigator_skill_estimates_role_id_fkey,
--     DROP CONSTRAINT IF EXISTS navigator_skill_estimates_skill_id_fkey;
--   ALTER TABLE praxis.navigator_role_skill_targets
--     DROP CONSTRAINT IF EXISTS navigator_role_skill_targets_role_id_fkey,
--     DROP CONSTRAINT IF EXISTS navigator_role_skill_targets_skill_id_fkey;
--   ALTER TABLE praxis.skill_metier_ref
--     DROP CONSTRAINT IF EXISTS skill_metier_ref_metier_id_fkey,
--     DROP CONSTRAINT IF EXISTS skill_metier_ref_skill_id_fkey;
--   ALTER TABLE praxis.skill_pathway_ref
--     DROP CONSTRAINT IF EXISTS skill_pathway_ref_skill_id_fkey;
--   ALTER TABLE praxis.skill_relation
--     DROP CONSTRAINT IF EXISTS skill_relation_object_id_fkey,
--     DROP CONSTRAINT IF EXISTS skill_relation_subject_id_fkey;
--   DROP INDEX IF EXISTS praxis.skill_esco_uri_idx;
--   DROP TABLE IF EXISTS praxis.occupation;
--   DROP TABLE IF EXISTS praxis.skill;

CREATE TABLE praxis.skill (
  id text PRIMARY KEY CHECK (id ~ '^skill_[a-z0-9_]{2,60}$'),
  label_fr text NOT NULL,
  label_en text,
  -- Prompt 4 adds REFERENCES praxis.esco_skills(concept_uri) after 007 lands.
  esco_skill_uri text,
  skill_type text CHECK (
    skill_type IN ('knowledge', 'skill', 'transversal', 'tool')
  ),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX skill_esco_uri_idx ON praxis.skill (esco_skill_uri)
  WHERE esco_skill_uri IS NOT NULL;

CREATE TABLE praxis.occupation (
  id text PRIMARY KEY,
  label_fr text NOT NULL,
  -- Prompt 4 adds REFERENCES praxis.esco_occupations(concept_uri) after 007 lands.
  esco_occupation_uri text,
  sector_code text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
);

-- Seed every skill and occupation identity referenced by migrations 004-006
-- before validating the new foreign keys.
INSERT INTO praxis.skill
  (id, label_fr, label_en, esco_skill_uri, skill_type, status)
VALUES
  ('skill_revit', 'Revit', 'Revit', NULL, 'tool', 'draft'),
  ('skill_navisworks', 'Navisworks', 'Navisworks', NULL, 'tool', 'draft'),
  ('skill_clash_detection', 'Détection des conflits', 'Clash detection', NULL, 'skill', 'draft'),
  ('skill_cde_coordination', 'CDE / coordination', 'CDE / coordination', NULL, 'skill', 'draft'),
  ('skill_iso_19650', 'ISO 19650', 'ISO 19650', NULL, 'knowledge', 'draft'),
  ('skill_ifc_bcf', 'IFC / BCF', 'IFC / BCF', NULL, 'skill', 'draft'),
  ('skill_bim_coordination', 'Coordination BIM', 'BIM coordination', NULL, 'skill', 'draft'),
  ('skill_bim', 'BIM', 'BIM', NULL, 'knowledge', 'draft'),
  ('skill_autocad', 'AutoCAD', 'AutoCAD', NULL, 'tool', 'draft'),
  ('skill_ms_project', 'Microsoft Project', 'Microsoft Project', NULL, 'tool', 'draft');

INSERT INTO praxis.occupation
  (id, label_fr, esco_occupation_uri, sector_code, status)
VALUES
  (
    'metier_bim_coordinateur',
    'Coordinateur BIM',
    NULL,
    'construction_infrastructure_real_estate',
    'draft'
  );

ALTER TABLE praxis.skill_relation
  ADD CONSTRAINT skill_relation_subject_id_fkey
    FOREIGN KEY (subject_id) REFERENCES praxis.skill(id) ON DELETE RESTRICT,
  ADD CONSTRAINT skill_relation_object_id_fkey
    FOREIGN KEY (object_id) REFERENCES praxis.skill(id) ON DELETE RESTRICT;

ALTER TABLE praxis.skill_pathway_ref
  ADD CONSTRAINT skill_pathway_ref_skill_id_fkey
    FOREIGN KEY (skill_id) REFERENCES praxis.skill(id) ON DELETE RESTRICT;

ALTER TABLE praxis.skill_metier_ref
  ADD CONSTRAINT skill_metier_ref_skill_id_fkey
    FOREIGN KEY (skill_id) REFERENCES praxis.skill(id) ON DELETE RESTRICT,
  ADD CONSTRAINT skill_metier_ref_metier_id_fkey
    FOREIGN KEY (metier_id) REFERENCES praxis.occupation(id) ON DELETE RESTRICT;

ALTER TABLE praxis.navigator_role_skill_targets
  ADD CONSTRAINT navigator_role_skill_targets_skill_id_fkey
    FOREIGN KEY (skill_id) REFERENCES praxis.skill(id) ON DELETE RESTRICT,
  ADD CONSTRAINT navigator_role_skill_targets_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES praxis.occupation(id) ON DELETE RESTRICT;

ALTER TABLE praxis.navigator_skill_estimates
  ADD CONSTRAINT navigator_skill_estimates_skill_id_fkey
    FOREIGN KEY (skill_id) REFERENCES praxis.skill(id) ON DELETE RESTRICT,
  ADD CONSTRAINT navigator_skill_estimates_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES praxis.occupation(id) ON DELETE RESTRICT;

ALTER TABLE praxis.pathway
  ADD CONSTRAINT pathway_metier_target_id_fkey
    FOREIGN KEY (metier_target_id) REFERENCES praxis.occupation(id)
    ON DELETE RESTRICT;
