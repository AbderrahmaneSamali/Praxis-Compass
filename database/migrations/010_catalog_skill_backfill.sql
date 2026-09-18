-- Approved catalog-skill projection, generated from
-- docs/proposals/catalog-skill-mapping.md.
-- The existing attributes.skills JSONB arrays remain the editorial source and
-- are intentionally not modified. These rows are the machine-readable ranking
-- projection of that approved source at catalog-skill-mapping-v1.
--
-- rollback:
--   DELETE FROM praxis.course_skill_outcome
--   WHERE source_version = 'catalog-skill-mapping-v1';
--   Then delete the skill ids listed by this migration only after confirming
--   they have no references from another PRAXIS graph table. Pre-existing rows
--   updated by the label-only upsert must not be deleted.

INSERT INTO praxis.skill
  (id, label_fr, label_en, esco_skill_uri, skill_type, status)
VALUES
  ('skill_plan_work_packages', 'Planifier des lots de travaux', 'Plan work packages', NULL, 'skill', 'published'),
  ('skill_coordinate_stakeholders', 'Coordonner les parties prenantes', 'Coordinate stakeholders', NULL, 'transversal', 'published'),
  ('skill_report_delivery_risks', 'Rendre compte des risques de livraison', 'Report delivery risks', NULL, 'skill', 'published'),
  ('skill_frame_decision_questions', 'Formuler des questions de décision', 'Frame decision questions', NULL, 'transversal', 'published'),
  ('skill_select_useful_evidence', 'Sélectionner des preuves utiles', 'Select useful evidence', NULL, 'skill', 'published'),
  ('skill_present_recommendation', 'Présenter une recommandation', 'Present a recommendation', NULL, 'transversal', 'published'),
  ('skill_identify_operational_risk', 'Identifier les risques opérationnels', 'Identify operational risk', NULL, 'skill', 'published'),
  ('skill_prioritize_risk_exposure', 'Prioriser l’exposition au risque', 'Prioritize risk exposure', NULL, 'skill', 'published'),
  ('skill_design_practical_controls', 'Concevoir des contrôles pratiques', 'Design practical controls', NULL, 'skill', 'published'),
  ('skill_map_quality_process', 'Cartographier un processus qualité', 'Map a quality process', NULL, 'skill', 'published'),
  ('skill_maintain_traceability', 'Maintenir la traçabilité', 'Maintain traceability', NULL, 'skill', 'published'),
  ('skill_document_corrective_action', 'Documenter une action corrective', 'Document corrective action', NULL, 'skill', 'published'),
  ('skill_coordinate_delivery', 'Coordonner la livraison', 'Coordinate delivery', NULL, 'skill', 'published'),
  ('skill_manage_operational_risk', 'Gérer les risques opérationnels', 'Manage operational risk', NULL, 'skill', 'published'),
  ('skill_lead_review_conversations', 'Animer des conversations de revue', 'Lead review conversations', NULL, 'transversal', 'published'),
  ('skill_analyze_operational_data', 'Analyser des données opérationnelles', 'Analyze operational data', NULL, 'skill', 'published'),
  ('skill_explain_evidence', 'Expliquer les preuves', 'Explain evidence', NULL, 'transversal', 'published'),
  ('skill_influence_decision', 'Influencer une décision', 'Influence a decision', NULL, 'transversal', 'published'),
  ('skill_frame_ai_use_case', 'Formuler un cas d’usage IA', 'Frame an AI use case', NULL, 'skill', 'published'),
  ('skill_test_workflow', 'Tester un flux de travail', 'Test a workflow', NULL, 'skill', 'published'),
  ('skill_evaluate_output_quality', 'Évaluer la qualité des résultats', 'Evaluate output quality', NULL, 'skill', 'published'),
  ('skill_prepare_data', 'Préparer les données', 'Prepare data', NULL, 'skill', 'published'),
  ('skill_build_dashboard', 'Construire un tableau de bord', 'Build a dashboard', NULL, 'skill', 'published'),
  ('skill_explain_decision', 'Expliquer une décision', 'Explain a decision', NULL, 'transversal', 'published'),
  ('skill_frame_analytical_question', 'Formuler une question analytique', 'Frame an analytical question', NULL, 'skill', 'published'),
  ('skill_analyze_dataset', 'Analyser un jeu de données', 'Analyze a dataset', NULL, 'skill', 'published'),
  ('skill_communicate_finding', 'Communiquer un résultat', 'Communicate a finding', NULL, 'transversal', 'published'),
  ('skill_set_priorities', 'Définir les priorités', 'Set priorities', NULL, 'transversal', 'published'),
  ('skill_give_feedback', 'Donner du feedback', 'Give feedback', NULL, 'transversal', 'published'),
  ('skill_run_review', 'Conduire une revue', 'Run a review', NULL, 'transversal', 'published'),
  ('skill_read_financial_statements', 'Lire les états financiers clés', 'Read key financial statements', NULL, 'skill', 'published'),
  ('skill_assess_variance', 'Évaluer un écart', 'Assess a variance', NULL, 'skill', 'published'),
  ('skill_present_action', 'Présenter une action', 'Present an action', NULL, 'transversal', 'published'),
  ('skill_clarify_people_need', 'Clarifier un besoin humain', 'Clarify a people need', NULL, 'transversal', 'published'),
  ('skill_structure_evidence', 'Structurer les preuves', 'Structure evidence', NULL, 'transversal', 'published'),
  ('skill_document_decision', 'Documenter une décision', 'Document a decision', NULL, 'transversal', 'published'),
  ('skill_select_ai_use_case', 'Sélectionner un cas d’usage IA', 'Select an AI use case', NULL, 'skill', 'published'),
  ('skill_design_ai_workflow', 'Concevoir un flux de travail IA', 'Design an AI workflow', NULL, 'skill', 'published'),
  ('skill_manage_ai_risk', 'Gérer les risques liés à l’IA', 'Manage AI risk', NULL, 'skill', 'published'),
  ('skill_model_data', 'Modéliser les données', 'Model data', NULL, 'skill', 'published'),
  ('skill_design_metrics', 'Concevoir des indicateurs', 'Design metrics', NULL, 'skill', 'published'),
  ('skill_govern_dashboard', 'Gouverner un tableau de bord', 'Govern a dashboard', NULL, 'skill', 'published'),
  ('skill_choose_analytical_method', 'Choisir une méthode analytique', 'Choose an analytical method', NULL, 'skill', 'published'),
  ('skill_validate_findings', 'Valider les résultats', 'Validate findings', NULL, 'skill', 'published'),
  ('skill_diagnose_process', 'Diagnostiquer un processus', 'Diagnose a process', NULL, 'skill', 'published'),
  ('skill_prioritize_change', 'Prioriser le changement', 'Prioritize change', NULL, 'transversal', 'published'),
  ('skill_plan_adoption', 'Planifier l’adoption', 'Plan adoption', NULL, 'transversal', 'published'),
  ('skill_plan_delivery', 'Planifier la livraison', 'Plan delivery', NULL, 'skill', 'published'),
  ('skill_manage_risk', 'Gérer les risques', 'Manage risk', NULL, 'skill', 'published'),
  ('skill_lead_reviews', 'Animer des revues', 'Lead reviews', NULL, 'transversal', 'published'),
  ('skill_analyze_performance', 'Analyser la performance', 'Analyze performance', NULL, 'skill', 'published'),
  ('skill_test_assumptions', 'Tester des hypothèses', 'Test assumptions', NULL, 'skill', 'published'),
  ('skill_quantitative_reasoning', 'Raisonner quantitativement', 'Reason quantitatively', NULL, 'transversal', 'published'),
  ('skill_solve_structured_problems', 'Résoudre des problèmes structurés', 'Solve structured problems', NULL, 'transversal', 'published'),
  ('skill_check_argument', 'Vérifier un raisonnement', 'Check an argument', NULL, 'transversal', 'published'),
  ('skill_read_code', 'Lire du code', 'Read code', NULL, 'skill', 'published'),
  ('skill_write_program', 'Écrire un programme', 'Write a program', NULL, 'skill', 'published'),
  ('skill_debug_systematically', 'Déboguer systématiquement', 'Debug systematically', NULL, 'skill', 'published'),
  ('skill_explain_ai_concepts', 'Expliquer les concepts fondamentaux de l’IA', 'Explain core AI concepts', NULL, 'knowledge', 'published'),
  ('skill_evaluate_model', 'Évaluer un modèle', 'Evaluate a model', NULL, 'skill', 'published'),
  ('skill_explore_data', 'Explorer les données', 'Explore data', NULL, 'skill', 'published'),
  ('skill_build_analysis', 'Construire une analyse', 'Build an analysis', NULL, 'skill', 'published'),
  ('skill_report_limitations', 'Présenter les limites', 'Report limitations', NULL, 'transversal', 'published'),
  ('skill_review_sources', 'Examiner les sources', 'Review sources', NULL, 'skill', 'published'),
  ('skill_design_method', 'Concevoir une méthode', 'Design a method', NULL, 'skill', 'published'),
  ('skill_write_queries', 'Écrire des requêtes', 'Write queries', NULL, 'skill', 'published'),
  ('skill_check_data_integrity', 'Vérifier l’intégrité des données', 'Check data integrity', NULL, 'skill', 'published')
ON CONFLICT (id) DO UPDATE
SET
  label_fr = EXCLUDED.label_fr,
  label_en = EXCLUDED.label_en;

CREATE TEMP TABLE catalog_skill_mapping_010 (
  record_type text NOT NULL,
  slug text NOT NULL,
  source_phrase text NOT NULL,
  skill_id text NOT NULL,
  entry_level smallint NOT NULL,
  outcome_level smallint NOT NULL,
  weight numeric(4,3) NOT NULL
) ON COMMIT DROP;

INSERT INTO catalog_skill_mapping_010
  (record_type, slug, source_phrase, skill_id, entry_level, outcome_level, weight)
VALUES
  ('course', 'project-delivery-lab', 'Plan work packages', 'skill_plan_work_packages', 1, 2, 1.000),
  ('course', 'project-delivery-lab', 'Coordinate stakeholders', 'skill_coordinate_stakeholders', 1, 2, 1.000),
  ('course', 'project-delivery-lab', 'Report delivery risks', 'skill_report_delivery_risks', 1, 2, 1.000),
  ('course', 'data-storytelling-sprint', 'Frame decision questions', 'skill_frame_decision_questions', 1, 2, 1.000),
  ('course', 'data-storytelling-sprint', 'Select useful evidence', 'skill_select_useful_evidence', 1, 2, 1.000),
  ('course', 'data-storytelling-sprint', 'Present a clear recommendation', 'skill_present_recommendation', 1, 2, 1.000),
  ('course', 'operational-risk-clinic', 'Identify operational risk', 'skill_identify_operational_risk', 2, 3, 1.000),
  ('course', 'operational-risk-clinic', 'Prioritize exposure', 'skill_prioritize_risk_exposure', 2, 3, 1.000),
  ('course', 'operational-risk-clinic', 'Design practical controls', 'skill_design_practical_controls', 2, 3, 1.000),
  ('course', 'quality-traceability-studio', 'Map a quality process', 'skill_map_quality_process', 0, 1, 1.000),
  ('course', 'quality-traceability-studio', 'Maintain traceability', 'skill_maintain_traceability', 0, 1, 1.000),
  ('course', 'quality-traceability-studio', 'Document corrective action', 'skill_document_corrective_action', 0, 1, 1.000),
  ('pathway', 'site-coordinator-pathway', 'Coordinate delivery', 'skill_coordinate_delivery', 1, 3, 1.000),
  ('pathway', 'site-coordinator-pathway', 'Manage operational risk', 'skill_manage_operational_risk', 1, 3, 1.000),
  ('pathway', 'site-coordinator-pathway', 'Lead review conversations', 'skill_lead_review_conversations', 1, 3, 1.000),
  ('pathway', 'insight-lead-pathway', 'Analyze operational data', 'skill_analyze_operational_data', 1, 3, 1.000),
  ('pathway', 'insight-lead-pathway', 'Explain evidence', 'skill_explain_evidence', 1, 3, 1.000),
  ('pathway', 'insight-lead-pathway', 'Influence a decision', 'skill_influence_decision', 1, 3, 1.000),
  ('course', 'sprint-artificial-intelligence', 'Frame an AI use case', 'skill_frame_ai_use_case', 1, 2, 1.000),
  ('course', 'sprint-artificial-intelligence', 'Test a workflow', 'skill_test_workflow', 1, 2, 1.000),
  ('course', 'sprint-artificial-intelligence', 'Evaluate output quality', 'skill_evaluate_output_quality', 1, 2, 1.000),
  ('course', 'sprint-power-bi', 'Prepare data', 'skill_prepare_data', 1, 2, 1.000),
  ('course', 'sprint-power-bi', 'Build a dashboard', 'skill_build_dashboard', 1, 2, 1.000),
  ('course', 'sprint-power-bi', 'Explain one decision', 'skill_explain_decision', 1, 2, 1.000),
  ('course', 'sprint-data-analytics', 'Frame a question', 'skill_frame_analytical_question', 1, 2, 1.000),
  ('course', 'sprint-data-analytics', 'Analyze a dataset', 'skill_analyze_dataset', 1, 2, 1.000),
  ('course', 'sprint-data-analytics', 'Communicate a finding', 'skill_communicate_finding', 1, 2, 1.000),
  ('course', 'sprint-management', 'Set priorities', 'skill_set_priorities', 1, 2, 1.000),
  ('course', 'sprint-management', 'Give feedback', 'skill_give_feedback', 1, 2, 1.000),
  ('course', 'sprint-management', 'Run a review', 'skill_run_review', 1, 2, 1.000),
  ('course', 'sprint-finance', 'Read key statements', 'skill_read_financial_statements', 1, 2, 1.000),
  ('course', 'sprint-finance', 'Assess a variance', 'skill_assess_variance', 1, 2, 1.000),
  ('course', 'sprint-finance', 'Present an action', 'skill_present_action', 1, 2, 1.000),
  ('course', 'sprint-human-resources', 'Clarify a people need', 'skill_clarify_people_need', 1, 2, 1.000),
  ('course', 'sprint-human-resources', 'Structure evidence', 'skill_structure_evidence', 1, 2, 1.000),
  ('course', 'sprint-human-resources', 'Document a decision', 'skill_document_decision', 1, 2, 1.000),
  ('pathway', 'professional-ai-business', 'Select a use case', 'skill_select_ai_use_case', 1, 2, 1.000),
  ('pathway', 'professional-ai-business', 'Design a workflow', 'skill_design_ai_workflow', 1, 2, 1.000),
  ('pathway', 'professional-ai-business', 'Manage AI risk', 'skill_manage_ai_risk', 1, 2, 1.000),
  ('pathway', 'professional-power-bi-expert', 'Model data', 'skill_model_data', 1, 2, 1.000),
  ('pathway', 'professional-power-bi-expert', 'Design metrics', 'skill_design_metrics', 1, 2, 1.000),
  ('pathway', 'professional-power-bi-expert', 'Govern a dashboard', 'skill_govern_dashboard', 1, 2, 1.000),
  ('pathway', 'professional-advanced-data-analytics', 'Choose a method', 'skill_choose_analytical_method', 1, 2, 1.000),
  ('pathway', 'professional-advanced-data-analytics', 'Validate findings', 'skill_validate_findings', 1, 2, 1.000),
  ('pathway', 'professional-advanced-data-analytics', 'Influence a decision', 'skill_influence_decision', 1, 2, 1.000),
  ('pathway', 'professional-digital-transformation', 'Diagnose a process', 'skill_diagnose_process', 1, 2, 1.000),
  ('pathway', 'professional-digital-transformation', 'Prioritize change', 'skill_prioritize_change', 1, 2, 1.000),
  ('pathway', 'professional-digital-transformation', 'Plan adoption', 'skill_plan_adoption', 1, 2, 1.000),
  ('pathway', 'professional-project-management', 'Plan delivery', 'skill_plan_delivery', 1, 2, 1.000),
  ('pathway', 'professional-project-management', 'Manage risk', 'skill_manage_risk', 1, 2, 1.000),
  ('pathway', 'professional-project-management', 'Lead reviews', 'skill_lead_reviews', 1, 2, 1.000),
  ('pathway', 'professional-financial-analysis', 'Analyze performance', 'skill_analyze_performance', 1, 2, 1.000),
  ('pathway', 'professional-financial-analysis', 'Test assumptions', 'skill_test_assumptions', 1, 2, 1.000),
  ('pathway', 'professional-financial-analysis', 'Present a recommendation', 'skill_present_recommendation', 1, 2, 1.000),
  ('course', 'academic-mathematics', 'Reason quantitatively', 'skill_quantitative_reasoning', 0, 2, 1.000),
  ('course', 'academic-mathematics', 'Solve structured problems', 'skill_solve_structured_problems', 0, 2, 1.000),
  ('course', 'academic-mathematics', 'Check an argument', 'skill_check_argument', 0, 2, 1.000),
  ('course', 'academic-programming', 'Read code', 'skill_read_code', 0, 2, 1.000),
  ('course', 'academic-programming', 'Write a program', 'skill_write_program', 0, 2, 1.000),
  ('course', 'academic-programming', 'Debug systematically', 'skill_debug_systematically', 0, 2, 1.000),
  ('course', 'academic-artificial-intelligence', 'Explain core concepts', 'skill_explain_ai_concepts', 0, 2, 1.000),
  ('course', 'academic-artificial-intelligence', 'Prepare data', 'skill_prepare_data', 0, 2, 1.000),
  ('course', 'academic-artificial-intelligence', 'Evaluate a model', 'skill_evaluate_model', 0, 2, 1.000),
  ('course', 'academic-data-science', 'Explore data', 'skill_explore_data', 0, 2, 1.000),
  ('course', 'academic-data-science', 'Build an analysis', 'skill_build_analysis', 0, 2, 1.000),
  ('course', 'academic-data-science', 'Report limitations', 'skill_report_limitations', 0, 2, 1.000),
  ('course', 'academic-research-methodology', 'Frame a question', 'skill_frame_analytical_question', 0, 2, 1.000),
  ('course', 'academic-research-methodology', 'Review sources', 'skill_review_sources', 0, 2, 1.000),
  ('course', 'academic-research-methodology', 'Design a method', 'skill_design_method', 0, 2, 1.000),
  ('course', 'academic-database-systems', 'Model data', 'skill_model_data', 0, 2, 1.000),
  ('course', 'academic-database-systems', 'Write queries', 'skill_write_queries', 0, 2, 1.000),
  ('course', 'academic-database-systems', 'Check data integrity', 'skill_check_data_integrity', 0, 2, 1.000);

DO $$
DECLARE
  mapping_count integer;
  missing_catalog_count integer;
  missing_source_phrase_count integer;
BEGIN
  SELECT count(*) INTO mapping_count
  FROM catalog_skill_mapping_010;

  IF mapping_count <> 72 THEN
    RAISE EXCEPTION
      'catalog-skill-mapping-v1 expected 72 mappings, found %',
      mapping_count;
  END IF;

  SELECT count(*) INTO missing_catalog_count
  FROM (
    SELECT DISTINCT record_type, slug
    FROM catalog_skill_mapping_010
  ) AS approved_record
  LEFT JOIN praxis.content_records AS content
    ON content.record_type = approved_record.record_type
   AND content.slug = approved_record.slug
  WHERE content.id IS NULL;

  IF missing_catalog_count <> 0 THEN
    RAISE EXCEPTION
      'catalog-skill-mapping-v1 references % missing catalog records',
      missing_catalog_count;
  END IF;

  SELECT count(*) INTO missing_source_phrase_count
  FROM catalog_skill_mapping_010 AS mapping
  JOIN praxis.content_records AS content
    ON content.record_type = mapping.record_type
   AND content.slug = mapping.slug
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(
      COALESCE(content.attributes->'skills', '[]'::jsonb)
    ) AS source_phrase(value)
    WHERE source_phrase.value = mapping.source_phrase
  );

  IF missing_source_phrase_count <> 0 THEN
    RAISE EXCEPTION
      'catalog-skill-mapping-v1 has % phrases absent from attributes.skills',
      missing_source_phrase_count;
  END IF;
END
$$;

INSERT INTO praxis.course_skill_outcome
  (
    content_record_id,
    skill_id,
    outcome_level,
    entry_level,
    weight,
    evidence_type,
    source_version
  )
SELECT
  content.id,
  mapping.skill_id,
  mapping.outcome_level,
  mapping.entry_level,
  mapping.weight,
  'editorial',
  'catalog-skill-mapping-v1'
FROM catalog_skill_mapping_010 AS mapping
JOIN praxis.content_records AS content
  ON content.record_type = mapping.record_type
 AND content.slug = mapping.slug
ON CONFLICT (content_record_id, skill_id) DO NOTHING;

DO $$
DECLARE
  missing_edge_count integer;
BEGIN
  SELECT count(*) INTO missing_edge_count
  FROM catalog_skill_mapping_010 AS mapping
  JOIN praxis.content_records AS content
    ON content.record_type = mapping.record_type
   AND content.slug = mapping.slug
  LEFT JOIN praxis.course_skill_outcome AS outcome
    ON outcome.content_record_id = content.id
   AND outcome.skill_id = mapping.skill_id
  WHERE outcome.skill_id IS NULL;

  IF missing_edge_count <> 0 THEN
    RAISE EXCEPTION
      'catalog-skill-mapping-v1 failed to project % approved edges',
      missing_edge_count;
  END IF;
END
$$;
