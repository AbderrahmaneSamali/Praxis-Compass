-- Retire the BIM prototype seed and replace it with roles the catalog serves.
--
-- Why: the 24 seeded catalog records (migrations 001/003) are AI, Power BI,
-- Data Analytics, Management, Finance, HR, Digital Transformation, Project
-- Management, Financial Analysis and academic foundations. None is BIM. The
-- only seeded role profile and the only three pathways were construction, so
-- every recommendation against them was empty or meaningless.
--
-- ARCHIVE, never DELETE. praxis.skill_pathway_ref, navigator_pathway_steps and
-- navigator_skill_estimates hold FK RESTRICT references, and the BIM rows are
-- the only worked example of an authored profile we have. They stay as a
-- reversible reference and are excluded at the repository layer.
--
-- Skill vocabulary note: role profiles are composed from the PRAXIS skill
-- vocabulary that praxis.course_skill_outcome actually covers, not from
-- esco_occupation_skill_relations. The two sets are disjoint — of the 67
-- catalog-covered skills, zero carry an esco_skill_uri — so an ESCO-derived
-- profile would reproduce the same zero-coverage bug in a different industry.
-- docs/ESCO_CONTENT_AUDIT.md §2 states the same conclusion: for skills the
-- PRAXIS layer is primary and ESCO is an adjacent index. Each occupation is
-- still anchored to a real ESCO fr occupation URI for taxonomy provenance.
--
-- Importance is authored per role. docs/ESCO_CONTENT_AUDIT.md §3's
-- inverse-frequency discriminator needs ESCO's essential_for_occupation_count,
-- which does not exist for PRAXIS skills, and catalog frequency is flat (62 of
-- 67 skills appear in exactly one published course), so it cannot rank.
--
-- rollback:
--   UPDATE praxis.occupation SET status='draft' WHERE id='metier_bim_coordinateur';
--   UPDATE praxis.content_records SET status='draft'
--     WHERE slug LIKE 'navigator-bim-coordinateur-%';
--   UPDATE praxis.navigator_role_skill_targets SET archived_at=NULL
--     WHERE role_id='metier_bim_coordinateur';
--   UPDATE praxis.skill_pathway_ref SET archived_at=NULL WHERE archived_at IS NOT NULL;
--   UPDATE praxis.navigator_pathway_steps SET archived_at=NULL WHERE archived_at IS NOT NULL;
--   DELETE FROM praxis.navigator_pathway_steps WHERE content_record_id IN (
--     SELECT id FROM praxis.content_records WHERE slug IN
--       ('professional-advanced-data-analytics','professional-power-bi-expert','insight-lead-pathway',
--        'professional-financial-analysis','professional-project-management','site-coordinator-pathway',
--        'professional-digital-transformation','professional-ai-business'));
--   DELETE FROM praxis.pathway_definition WHERE target_occupation_id IN
--     ('metier_analyste_donnees','metier_analyste_financier','metier_gestionnaire_projet',
--      'metier_responsable_rh','metier_transformation_numerique');
--   DELETE FROM praxis.navigator_role_skill_targets WHERE source_version='praxis-catalog-roles-v1';
--   DELETE FROM praxis.occupation WHERE id IN
--     ('metier_analyste_financier','metier_gestionnaire_projet',
--      'metier_responsable_rh','metier_transformation_numerique');
--   Re-archiving the previously flat data-analyst profile is not reversible by
--   this block; export navigator_role_skill_targets first if it is needed.

-- ---------------------------------------------------------------------------
-- 1. Archival columns. Archived rows stay queryable for audit but are excluded
--    by every repository read.
-- ---------------------------------------------------------------------------
ALTER TABLE praxis.navigator_role_skill_targets ADD COLUMN archived_at timestamptz;
ALTER TABLE praxis.skill_pathway_ref ADD COLUMN archived_at timestamptz;
ALTER TABLE praxis.navigator_pathway_steps ADD COLUMN archived_at timestamptz;

COMMENT ON COLUMN praxis.navigator_role_skill_targets.archived_at IS
  'Non-null means retired seed data. Repository reads must exclude it.';

-- ---------------------------------------------------------------------------
-- 2. Retire the BIM seed.
-- ---------------------------------------------------------------------------
UPDATE praxis.occupation
SET status = 'archived'
WHERE id = 'metier_bim_coordinateur';

UPDATE praxis.navigator_role_skill_targets
SET archived_at = now()
WHERE role_id = 'metier_bim_coordinateur';

UPDATE praxis.content_records
SET status = 'archived', updated_at = now()
WHERE slug LIKE 'navigator-bim-coordinateur-%';

UPDATE praxis.skill_pathway_ref
SET archived_at = now()
WHERE content_record_id IN (
  SELECT id FROM praxis.content_records
  WHERE slug LIKE 'navigator-bim-coordinateur-%'
);

UPDATE praxis.navigator_pathway_steps
SET archived_at = now()
WHERE content_record_id IN (
  SELECT id FROM praxis.content_records
  WHERE slug LIKE 'navigator-bim-coordinateur-%'
);

-- The flat ESCO-derived data-analyst profile: 67 skills all at importance 3.
-- docs/ESCO_CONTENT_AUDIT.md §3 shows this collapses gap x importance into a
-- tie. Retired in favour of the authored profile seeded below.
UPDATE praxis.navigator_role_skill_targets
SET archived_at = now()
WHERE role_id = 'occupation_esco_d3edb8f83a0647a08fb99b212c006aa2';

-- ---------------------------------------------------------------------------
-- 3. Occupations the catalog can serve, each anchored to ESCO fr v1.2.1.
-- ---------------------------------------------------------------------------
UPDATE praxis.occupation
SET label_fr = 'Analyste de données',
    sector_code = 'digital_it_telecom',
    status = 'published'
WHERE id = 'occupation_esco_d3edb8f83a0647a08fb99b212c006aa2';

INSERT INTO praxis.occupation
  (id, label_fr, esco_occupation_uri, sector_code, status, esco_mapping_status,
   esco_mapping_note, isco_major_group)
VALUES
  ('metier_analyste_financier', 'Analyste financier',
   'http://data.europa.eu/esco/occupation/8d586ee9-0ab1-4155-a3b0-2ca786c8e48c',
   'finance_banking_insurance_fintech', 'published', 'anchored',
   'ESCO fr 2413.1 analyste financier/analyste financière.', 2),
  ('metier_gestionnaire_projet', 'Gestionnaire de projet',
   'http://data.europa.eu/esco/occupation/bea99fea-0383-4c63-b944-70d4799de2c5',
   'industry_production_maintenance', 'published', 'anchored',
   'ESCO fr 1219.6 gestionnaire de projet.', 1),
  ('metier_responsable_rh', 'Responsable des ressources humaines',
   'http://data.europa.eu/esco/occupation/d3e32e5e-7f24-48e3-b939-e4f800eb62fb',
   'unclassified', 'published', 'anchored',
   'ESCO fr 2423.3 responsable des ressources humaines.', 2),
  ('metier_transformation_numerique', 'Gestionnaire de la transformation numérique',
   'http://data.europa.eu/esco/occupation/719f101d-1866-49d3-8d5c-2256f606a8b9',
   'digital_it_telecom', 'published', 'anchored',
   'ESCO fr 1330.1.1.1 gestionnaire de la transformation numérique.', 1);

-- ---------------------------------------------------------------------------
-- 4. Authored role profiles, capped at 12 skills, drawn only from skills the
--    published catalog actually teaches. Labels are the existing French
--    praxis.skill labels; nothing is translated here.
-- ---------------------------------------------------------------------------
INSERT INTO praxis.navigator_role_skill_targets
  (role_id, skill_id, label, target_level, importance, behavior_anchors,
   source_version, profile_source)
SELECT seed.role_id, seed.skill_id, skill.label_fr, seed.target_level,
       seed.importance,
       -- Level-generic anchors taken from the kernel MASTERY_LEVELS
       -- descriptors, so the ladder wording has a single source.
       jsonb_build_array(
         'Découverte — Comprend le vocabulaire et exécute avec guidage.',
         'Application — Réalise une tâche standard de manière autonome.',
         'Maîtrise — Résout des situations variées, justifie et améliore.',
         'Expertise / transmission — Traite les cas complexes, conçoit, supervise et transmet.'
       ),
       'praxis-catalog-roles-v1', 'authored'
FROM (VALUES
  -- Analyste de données
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_analyze_dataset', 3, 3),
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_frame_analytical_question', 3, 3),
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_build_dashboard', 3, 3),
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_prepare_data', 3, 3),
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_communicate_finding', 3, 2),
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_model_data', 2, 2),
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_write_queries', 2, 2),
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_check_data_integrity', 2, 2),
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_explore_data', 2, 2),
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_choose_analytical_method', 2, 2),
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_validate_findings', 2, 1),
  ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'skill_quantitative_reasoning', 2, 1),
  -- Analyste financier
  ('metier_analyste_financier', 'skill_read_financial_statements', 3, 3),
  ('metier_analyste_financier', 'skill_analyze_performance', 3, 3),
  ('metier_analyste_financier', 'skill_assess_variance', 3, 3),
  ('metier_analyste_financier', 'skill_test_assumptions', 3, 3),
  ('metier_analyste_financier', 'skill_present_recommendation', 2, 2),
  ('metier_analyste_financier', 'skill_present_action', 2, 2),
  ('metier_analyste_financier', 'skill_select_useful_evidence', 2, 2),
  ('metier_analyste_financier', 'skill_quantitative_reasoning', 2, 2),
  ('metier_analyste_financier', 'skill_solve_structured_problems', 2, 1),
  ('metier_analyste_financier', 'skill_identify_operational_risk', 2, 1),
  ('metier_analyste_financier', 'skill_prioritize_risk_exposure', 2, 1),
  -- Gestionnaire de projet
  ('metier_gestionnaire_projet', 'skill_plan_delivery', 3, 3),
  ('metier_gestionnaire_projet', 'skill_manage_risk', 3, 3),
  ('metier_gestionnaire_projet', 'skill_plan_work_packages', 3, 3),
  ('metier_gestionnaire_projet', 'skill_coordinate_stakeholders', 3, 3),
  ('metier_gestionnaire_projet', 'skill_lead_reviews', 2, 2),
  ('metier_gestionnaire_projet', 'skill_report_delivery_risks', 2, 2),
  ('metier_gestionnaire_projet', 'skill_set_priorities', 2, 2),
  ('metier_gestionnaire_projet', 'skill_coordinate_delivery', 2, 2),
  ('metier_gestionnaire_projet', 'skill_run_review', 2, 1),
  ('metier_gestionnaire_projet', 'skill_give_feedback', 2, 1),
  ('metier_gestionnaire_projet', 'skill_manage_operational_risk', 2, 1),
  ('metier_gestionnaire_projet', 'skill_document_decision', 2, 1),
  -- Responsable des ressources humaines
  ('metier_responsable_rh', 'skill_clarify_people_need', 3, 3),
  ('metier_responsable_rh', 'skill_structure_evidence', 3, 3),
  ('metier_responsable_rh', 'skill_document_decision', 3, 3),
  ('metier_responsable_rh', 'skill_give_feedback', 3, 3),
  ('metier_responsable_rh', 'skill_run_review', 2, 2),
  ('metier_responsable_rh', 'skill_set_priorities', 2, 2),
  ('metier_responsable_rh', 'skill_present_recommendation', 2, 2),
  ('metier_responsable_rh', 'skill_frame_decision_questions', 2, 1),
  ('metier_responsable_rh', 'skill_document_corrective_action', 2, 1),
  -- Gestionnaire de la transformation numérique
  ('metier_transformation_numerique', 'skill_diagnose_process', 3, 3),
  ('metier_transformation_numerique', 'skill_plan_adoption', 3, 3),
  ('metier_transformation_numerique', 'skill_prioritize_change', 3, 3),
  ('metier_transformation_numerique', 'skill_select_ai_use_case', 3, 3),
  ('metier_transformation_numerique', 'skill_design_ai_workflow', 2, 2),
  ('metier_transformation_numerique', 'skill_manage_ai_risk', 2, 2),
  ('metier_transformation_numerique', 'skill_frame_ai_use_case', 2, 2),
  ('metier_transformation_numerique', 'skill_explain_ai_concepts', 2, 1),
  ('metier_transformation_numerique', 'skill_evaluate_output_quality', 2, 1),
  ('metier_transformation_numerique', 'skill_set_priorities', 2, 1),
  ('metier_transformation_numerique', 'skill_influence_decision', 2, 1)
) AS seed(role_id, skill_id, target_level, importance)
JOIN praxis.skill ON skill.id = seed.skill_id;

-- ---------------------------------------------------------------------------
-- 5. Point EXISTING published pathway records at the new roles. No course is
--    invented: every record below already exists in the catalog.
-- ---------------------------------------------------------------------------
INSERT INTO praxis.pathway_definition
  (content_record_id, target_occupation_id, variant, definition_version)
SELECT content.id, seed.role_id, seed.variant, 'praxis-catalog-roles-v1'
FROM (VALUES
  ('professional-advanced-data-analytics', 'occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'certifiante'),
  ('professional-power-bi-expert', 'occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'acceleree'),
  ('insight-lead-pathway', 'occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'essentielle'),
  ('professional-financial-analysis', 'metier_analyste_financier', 'essentielle'),
  ('professional-project-management', 'metier_gestionnaire_projet', 'essentielle'),
  ('site-coordinator-pathway', 'metier_gestionnaire_projet', 'acceleree'),
  ('professional-digital-transformation', 'metier_transformation_numerique', 'essentielle'),
  ('professional-ai-business', 'metier_transformation_numerique', 'acceleree')
) AS seed(slug, role_id, variant)
JOIN praxis.content_records AS content
  ON content.slug = seed.slug AND content.record_type = 'pathway'
WHERE NOT EXISTS (
  SELECT 1 FROM praxis.pathway_definition AS existing
  WHERE existing.content_record_id = content.id
);

-- ---------------------------------------------------------------------------
-- 6. Ordered steps for those pathways, composed from published catalog courses.
-- ---------------------------------------------------------------------------
INSERT INTO praxis.navigator_pathway_steps
  (content_record_id, position, step_type, label)
SELECT content.id, seed.position, seed.step_type, seed.label
FROM (VALUES
  ('professional-advanced-data-analytics', 1, 'workshop', 'Data Analytics'),
  ('professional-advanced-data-analytics', 2, 'sprint', 'Power BI'),
  ('professional-advanced-data-analytics', 3, 'bootcamp', 'Advanced Data Analytics'),
  ('professional-power-bi-expert', 1, 'workshop', 'Power BI'),
  ('professional-power-bi-expert', 2, 'sprint', 'Database Systems'),
  ('professional-power-bi-expert', 3, 'bootcamp', 'Power BI Expert'),
  ('insight-lead-pathway', 1, 'workshop', 'Data Analytics'),
  ('insight-lead-pathway', 2, 'sprint', 'Data Storytelling Sprint'),
  ('insight-lead-pathway', 3, 'program', 'Operations Analyst → Insight Lead'),
  ('professional-financial-analysis', 1, 'workshop', 'Finance'),
  ('professional-financial-analysis', 2, 'sprint', 'Data Storytelling Sprint'),
  ('professional-financial-analysis', 3, 'bootcamp', 'Financial Analysis'),
  ('professional-project-management', 1, 'workshop', 'Management'),
  ('professional-project-management', 2, 'sprint', 'Project Delivery Lab'),
  ('professional-project-management', 3, 'bootcamp', 'Project Management'),
  ('site-coordinator-pathway', 1, 'workshop', 'Management'),
  ('site-coordinator-pathway', 2, 'sprint', 'Operational Risk Clinic'),
  ('site-coordinator-pathway', 3, 'program', 'Site Coordinator → Project Lead'),
  ('professional-digital-transformation', 1, 'workshop', 'Management'),
  ('professional-digital-transformation', 2, 'sprint', 'Artificial Intelligence'),
  ('professional-digital-transformation', 3, 'bootcamp', 'Digital Transformation'),
  ('professional-ai-business', 1, 'workshop', 'Artificial Intelligence'),
  ('professional-ai-business', 2, 'sprint', 'Data Storytelling Sprint'),
  ('professional-ai-business', 3, 'bootcamp', 'Artificial Intelligence for Business')
) AS seed(slug, position, step_type, label)
JOIN praxis.content_records AS content
  ON content.slug = seed.slug AND content.record_type = 'pathway'
WHERE NOT EXISTS (
  SELECT 1 FROM praxis.navigator_pathway_steps AS existing
  WHERE existing.content_record_id = content.id
    AND existing.position = seed.position
);
