ALTER TABLE praxis.pathway
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scenario'
    CHECK (status IN ('scenario', 'published', 'archived'));

CREATE TABLE IF NOT EXISTS praxis.navigator_role_skill_targets (
  role_id text NOT NULL,
  skill_id text NOT NULL,
  label text NOT NULL,
  target_level smallint NOT NULL CHECK (target_level BETWEEN 1 AND 3),
  importance smallint NOT NULL CHECK (importance BETWEEN 1 AND 3),
  behavior_anchors jsonb NOT NULL CHECK (jsonb_typeof(behavior_anchors) = 'array'),
  source_version text NOT NULL,
  PRIMARY KEY (role_id, skill_id)
);

CREATE TABLE IF NOT EXISTS praxis.navigator_pathway_steps (
  pathway_id text NOT NULL REFERENCES praxis.pathway(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position > 0),
  step_type text NOT NULL CHECK (step_type IN ('workshop', 'sprint', 'bootcamp', 'program', 'external_validation')),
  label text NOT NULL,
  PRIMARY KEY (pathway_id, position)
);

CREATE TABLE IF NOT EXISTS praxis.navigator_skill_estimates (
  cv_document_id uuid NOT NULL
    REFERENCES praxis.navigator_cv_documents(id) ON DELETE CASCADE,
  role_id text NOT NULL,
  skill_id text NOT NULL,
  declared_level smallint NOT NULL CHECK (declared_level BETWEEN 0 AND 3),
  target_level smallint NOT NULL CHECK (target_level BETWEEN 1 AND 3),
  importance smallint NOT NULL CHECK (importance BETWEEN 1 AND 3),
  gap smallint NOT NULL CHECK (gap BETWEEN 0 AND 3),
  evidence_type text NOT NULL DEFAULT 'self_declared',
  algorithm_version text NOT NULL,
  inputs_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cv_document_id, skill_id)
);

CREATE TABLE IF NOT EXISTS praxis.navigator_pathway_results (
  cv_document_id uuid NOT NULL
    REFERENCES praxis.navigator_cv_documents(id) ON DELETE CASCADE,
  pathway_id text NOT NULL REFERENCES praxis.pathway(id) ON DELETE RESTRICT,
  score numeric(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  rank smallint NOT NULL CHECK (rank > 0),
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  algorithm_version text NOT NULL,
  inputs_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cv_document_id, pathway_id),
  UNIQUE (cv_document_id, rank)
);

CREATE INDEX IF NOT EXISTS navigator_skill_estimates_document_idx
  ON praxis.navigator_skill_estimates (cv_document_id, gap DESC);
CREATE INDEX IF NOT EXISTS navigator_pathway_results_document_idx
  ON praxis.navigator_pathway_results (cv_document_id, rank);

INSERT INTO praxis.navigator_role_skill_targets
  (role_id, skill_id, label, target_level, importance, behavior_anchors, source_version)
VALUES
  ('metier_bim_coordinateur', 'skill_revit', 'Revit', 3, 2,
   '["Je découvre l’outil", "Je réalise des tâches guidées", "Je travaille seul sur des cas standards", "Je traite les cas complexes et accompagne les autres"]'::jsonb,
   'navigator-v2-section-16'),
  ('metier_bim_coordinateur', 'skill_navisworks', 'Navisworks', 3, 3,
   '["Je n’ai pas encore pratiqué", "Je navigue et contrôle avec un guide", "Je coordonne un modèle standard en autonomie", "Je configure et pilote une revue complexe"]'::jsonb,
   'navigator-v2-section-16'),
  ('metier_bim_coordinateur', 'skill_clash_detection', 'Clash detection', 3, 3,
   '["Je n’ai pas encore pratiqué", "Je lance un contrôle préparé", "Je paramètre, analyse et suit les conflits courants", "Je conçois la stratégie de détection et arbitre les cas complexes"]'::jsonb,
   'navigator-v2-section-16'),
  ('metier_bim_coordinateur', 'skill_cde_coordination', 'CDE / coordination', 2, 2,
   '["Je découvre le processus", "Je dépose et consulte selon une procédure", "Je coordonne les statuts, validations et échanges courants", "Je gouverne le processus et résous les exceptions"]'::jsonb,
   'navigator-v2-section-16'),
  ('metier_bim_coordinateur', 'skill_iso_19650', 'ISO 19650', 2, 2,
   '["Je ne connais pas encore le référentiel", "J’en reconnais les principes avec assistance", "J’applique les règles d’information sur un projet", "Je structure et contrôle leur application"]'::jsonb,
   'navigator-v2-section-16'),
  ('metier_bim_coordinateur', 'skill_ifc_bcf', 'IFC / BCF', 2, 2,
   '["Je découvre les formats", "J’ouvre ou exporte avec assistance", "Je contrôle les échanges et traite les remarques courantes", "Je diagnostique et sécurise les échanges complexes"]'::jsonb,
   'navigator-v2-section-16')
ON CONFLICT (role_id, skill_id) DO UPDATE SET
  label = EXCLUDED.label,
  target_level = EXCLUDED.target_level,
  importance = EXCLUDED.importance,
  behavior_anchors = EXCLUDED.behavior_anchors,
  source_version = EXCLUDED.source_version;

UPDATE praxis.pathway SET
  summary = CASE id
    WHEN 'path_bim_coord_essential' THEN 'Couvre les écarts critiques avec une charge limitée.'
    WHEN 'path_bim_coord_acceleree' THEN 'Priorise une employabilité opérationnelle rapide.'
    WHEN 'path_bim_coord_certifiante' THEN 'Ajoute le référentiel et une preuve formelle uniquement lorsqu’elle est validée.'
  END,
  status = 'scenario'
WHERE id IN (
  'path_bim_coord_essential',
  'path_bim_coord_acceleree',
  'path_bim_coord_certifiante'
);

INSERT INTO praxis.navigator_pathway_steps (pathway_id, position, step_type, label)
VALUES
  ('path_bim_coord_essential', 1, 'workshop', 'Atelier IFC / BCF'),
  ('path_bim_coord_essential', 2, 'sprint', 'PRAXIS Sprint — Navisworks & Clash Detection'),
  ('path_bim_coord_essential', 3, 'bootcamp', 'Bootcamp BIM Coordination'),
  ('path_bim_coord_acceleree', 1, 'sprint', 'PRAXIS Sprint — Navisworks'),
  ('path_bim_coord_acceleree', 2, 'bootcamp', 'Bootcamp BIM Coordination intensif'),
  ('path_bim_coord_acceleree', 3, 'workshop', 'Atelier CDE / BCF'),
  ('path_bim_coord_certifiante', 1, 'bootcamp', 'Bootcamp BIM Coordination'),
  ('path_bim_coord_certifiante', 2, 'program', 'Programme BIM Management & ISO 19650'),
  ('path_bim_coord_certifiante', 3, 'external_validation', 'Préparation externe — sous réserve d’une offre validée')
ON CONFLICT (pathway_id, position) DO UPDATE SET
  step_type = EXCLUDED.step_type,
  label = EXCLUDED.label;

DROP TRIGGER IF EXISTS navigator_skill_estimates_touch_updated_at
  ON praxis.navigator_skill_estimates;
CREATE TRIGGER navigator_skill_estimates_touch_updated_at
BEFORE UPDATE ON praxis.navigator_skill_estimates
FOR EACH ROW EXECUTE FUNCTION praxis.touch_updated_at();
