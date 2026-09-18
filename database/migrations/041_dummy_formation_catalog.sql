-- Expand the explicitly fictional catalog so the recommendation engine can be
-- exercised across every current operational role. Nothing in this migration
-- represents a real provider or a real offer. Production replacement remains
-- safe through praxis.purge_fixture_offers().
--
-- rollback:
--   SELECT praxis.purge_fixture_offers();

INSERT INTO praxis.provider
  (name, legal_name, website_url, contact_email, contact_phone, city, country,
   languages, status, data_source, verified_at, verified_by)
VALUES
  ('PRAXIS Data Lab Démo', 'PRAXIS Data Lab Démo',
   'https://praxis-data-demo.invalid', 'contact@praxis-data-demo.invalid',
   '+212 5 22 00 00 01', 'Casablanca', 'Morocco', ARRAY['fr','en'], 'active',
   'fixture', now(), 'PRAXIS fixture seed'),
  ('PRAXIS Management Academy Démo', 'PRAXIS Management Academy Démo',
   'https://praxis-management-demo.invalid', 'contact@praxis-management-demo.invalid',
   '+212 5 37 00 00 02', 'Rabat', 'Morocco', ARRAY['fr','en'], 'active',
   'fixture', now(), 'PRAXIS fixture seed'),
  ('PRAXIS Industry Quality Lab Démo', 'PRAXIS Industry Quality Lab Démo',
   'https://praxis-industry-demo.invalid', 'contact@praxis-industry-demo.invalid',
   '+212 5 39 00 00 03', 'Tanger', 'Morocco', ARRAY['fr'], 'active',
   'fixture', now(), 'PRAXIS fixture seed')
ON CONFLICT (name) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  website_url = EXCLUDED.website_url,
  contact_email = EXCLUDED.contact_email,
  contact_phone = EXCLUDED.contact_phone,
  city = EXCLUDED.city,
  country = EXCLUDED.country,
  languages = EXCLUDED.languages,
  status = EXCLUDED.status,
  data_source = EXCLUDED.data_source,
  verified_at = EXCLUDED.verified_at,
  verified_by = EXCLUDED.verified_by;

WITH offering AS (
  SELECT * FROM (VALUES
    ('demo-catalog-data-foundations', 'Fondations de l’analyse de données — Démo',
     'Passer d’une question métier à une analyse vérifiable.',
     'Cas pratiques de préparation, analyse et interprétation de données.',
     'PRAXIS Data Lab Démo', 'digital_it_telecom', 'Professional', 'L1-L2',
     2400::numeric, 28::numeric, ARRAY['fr','en']::text[], 'hybrid', false,
     'Casablanca', 'Morocco', 'rolling_admission', NULL::integer,
     'https://praxis-data-demo.invalid/data-foundations', 'DF', 'blue', 1,
     ARRAY['Préparer les données','Analyser un jeu de données','Formuler une question analytique']::text[]),
    ('demo-catalog-sql-modeling', 'SQL et modélisation des données — Démo',
     'Construire des requêtes et des modèles de données fiables.',
     'Atelier SQL progressif avec contrôles d’intégrité et modèle analytique.',
     'PRAXIS Data Lab Démo', 'digital_it_telecom', 'Sprint', 'L1-L2',
     1900::numeric, 20::numeric, ARRAY['fr']::text[], 'online_live', true,
     NULL, NULL, 'scheduled', 7,
     'https://praxis-data-demo.invalid/sql-modeling', 'SQL', 'orange', 2,
     ARRAY['Écrire des requêtes','Modéliser les données','Vérifier l’intégrité des données']::text[]),
    ('demo-catalog-power-bi', 'Tableaux de bord Power BI — Démo',
     'Construire un tableau de bord orienté décision.',
     'Modélisation, visualisation, vérification et restitution d’un tableau de bord.',
     'PRAXIS Data Lab Démo', 'digital_it_telecom', 'Professional', 'L1-L3',
     3600::numeric, 32::numeric, ARRAY['fr','en']::text[], 'hybrid', false,
     'Casablanca', 'Morocco', 'rolling_admission', NULL::integer,
     'https://praxis-data-demo.invalid/power-bi', 'BI', 'blue', 3,
     ARRAY['Construire un tableau de bord','Communiquer un résultat','Valider les résultats']::text[]),
    ('demo-catalog-financial-statements', 'Lecture des états financiers — Démo',
     'Lire les états financiers et identifier les signaux essentiels.',
     'Travail guidé sur bilan, résultat, trésorerie et risques opérationnels.',
     'PRAXIS Management Academy Démo', 'finance_banking_insurance_fintech',
     'Professional', 'L1-L2', 2800::numeric, 24::numeric, ARRAY['fr']::text[],
     'in_person', false, 'Rabat', 'Morocco', 'rolling_admission', NULL::integer,
     'https://praxis-management-demo.invalid/financial-statements', 'FS', 'navy', 4,
     ARRAY['Lire les états financiers clés','Raisonner quantitativement','Identifier les risques opérationnels']::text[]),
    ('demo-catalog-financial-performance', 'Performance et analyse des écarts — Démo',
     'Transformer les écarts financiers en recommandations actionnables.',
     'Analyse de performance, hypothèses, écarts et présentation de décisions.',
     'PRAXIS Management Academy Démo', 'finance_banking_insurance_fintech',
     'Professional', 'L2-L3', 4200::numeric, 36::numeric, ARRAY['fr','en']::text[],
     'hybrid', false, 'Rabat', 'Morocco', 'scheduled', 10,
     'https://praxis-management-demo.invalid/financial-performance', 'FP', 'blue', 5,
     ARRAY['Analyser la performance','Évaluer un écart','Présenter une recommandation']::text[]),
    ('demo-catalog-project-planning', 'Planification et pilotage de projet — Démo',
     'Structurer la livraison d’un projet et ses lots de travail.',
     'Planification, priorités, jalons, coordination et suivi de livraison.',
     'PRAXIS Management Academy Démo', 'industry_production_maintenance',
     'Professional', 'L1-L3', 3300::numeric, 30::numeric, ARRAY['fr']::text[],
     'hybrid', false, 'Rabat', 'Morocco', 'rolling_admission', NULL::integer,
     'https://praxis-management-demo.invalid/project-planning', 'PM', 'navy', 6,
     ARRAY['Planifier la livraison','Planifier des lots de travaux','Coordonner la livraison']::text[]),
    ('demo-catalog-project-risk', 'Risques et parties prenantes — Démo',
     'Piloter les risques et les décisions avec les parties prenantes.',
     'Cas pratiques de registre de risques, arbitrage et communication.',
     'PRAXIS Management Academy Démo', 'industry_production_maintenance',
     'Sprint', 'L2-L3', 2100::numeric, 18::numeric, ARRAY['fr','en']::text[],
     'online_live', true, NULL, NULL, 'scheduled', 12,
     'https://praxis-management-demo.invalid/project-risk', 'PR', 'orange', 7,
     ARRAY['Gérer les risques','Coordonner les parties prenantes','Rendre compte des risques de livraison']::text[]),
    ('demo-catalog-hr-evidence', 'Décisions RH fondées sur les preuves — Démo',
     'Structurer un besoin RH et documenter une décision équitable.',
     'Méthode de clarification, collecte de preuves et recommandation RH.',
     'PRAXIS Management Academy Démo', 'hr_recruitment_training',
     'Professional', 'L1-L3', 3000::numeric, 26::numeric, ARRAY['fr']::text[],
     'in_person', false, 'Rabat', 'Morocco', 'rolling_admission', NULL::integer,
     'https://praxis-management-demo.invalid/hr-evidence', 'HR', 'blue', 8,
     ARRAY['Clarifier un besoin humain','Structurer les preuves','Documenter une décision']::text[]),
    ('demo-catalog-people-feedback', 'Feedback et revues d’équipe — Démo',
     'Conduire des échanges de feedback clairs et utiles.',
     'Pratique encadrée du feedback, des priorités et des revues d’équipe.',
     'PRAXIS Management Academy Démo', 'hr_recruitment_training',
     'Sprint', 'L1-L2', 1600::numeric, 14::numeric, ARRAY['fr']::text[],
     'online_live', true, NULL, NULL, 'scheduled', 6,
     'https://praxis-management-demo.invalid/people-feedback', 'PF', 'orange', 9,
     ARRAY['Donner du feedback','Conduire une revue','Définir les priorités']::text[]),
    ('demo-catalog-digital-adoption', 'Diagnostic de processus et adoption numérique — Démo',
     'Passer du diagnostic d’un processus à un plan d’adoption.',
     'Cartographie, priorisation du changement et planification de l’adoption.',
     'PRAXIS Data Lab Démo', 'digital_it_telecom', 'Professional', 'L2-L3',
     3900::numeric, 34::numeric, ARRAY['fr','en']::text[], 'hybrid', false,
     'Casablanca', 'Morocco', 'rolling_admission', NULL::integer,
     'https://praxis-data-demo.invalid/digital-adoption', 'DT', 'blue', 10,
     ARRAY['Diagnostiquer un processus','Prioriser le changement','Planifier l’adoption']::text[]),
    ('demo-catalog-ai-workflow', 'Cas d’usage et flux de travail IA — Démo',
     'Concevoir un flux IA utile avec des contrôles de risque.',
     'Sélection du cas d’usage, conception du flux et évaluation des résultats.',
     'PRAXIS Data Lab Démo', 'digital_it_telecom', 'Sprint', 'L1-L2',
     2200::numeric, 18::numeric, ARRAY['fr','en']::text[], 'online_live', true,
     NULL, NULL, 'scheduled', 11,
     'https://praxis-data-demo.invalid/ai-workflow', 'AI', 'orange', 11,
     ARRAY['Sélectionner un cas d’usage IA','Concevoir un flux de travail IA','Gérer les risques liés à l’IA']::text[]),
    ('demo-catalog-quality-audit', 'Audit qualité et actions correctives — Démo',
     'Relier constats d’audit, risques et mesures correctives.',
     'Atelier industriel sur le plan d’audit, les preuves et les actions correctives.',
     'PRAXIS Industry Quality Lab Démo', 'industry_production_maintenance',
     'Professional', 'L1-L3', 3400::numeric, 30::numeric, ARRAY['fr']::text[],
     'in_person', false, 'Tanger', 'Morocco', 'rolling_admission', NULL::integer,
     'https://praxis-industry-demo.invalid/quality-audit', 'QA', 'navy', 12,
     ARRAY['Effectuer des audits de la qualité','Gérer des mesures correctives','Identifier les améliorations des processus']::text[])
  ) AS rows(slug, title, summary, description, provider_name, sector_code,
            product_family, level, price_mad, duration_hours, languages,
            delivery_format, is_online, location_city, location_country,
            admission_status, start_in_days, application_url, initials, tone,
            cold_start_rank, skill_labels)
)
INSERT INTO praxis.content_records
  (record_type, slug, title, status, summary, attributes, published_at,
   sector_code, level, price_mad, duration_hours, languages, product_family,
   featured, cold_start_rank, cold_start_source_version, provider_id,
   application_url, contact_route, delivery_format, is_online, location_city,
   location_country, price_status, admission_status, next_start_date,
   last_verified_at, data_source, deleted_at)
SELECT
  'course', offering.slug, offering.title, 'published', offering.summary,
  jsonb_build_object(
    'sector', offering.sector_code,
    'productFamily', offering.product_family,
    'description', offering.description,
    'format', offering.delivery_format,
    'duration', offering.duration_hours || ' hours',
    'level', offering.level,
    'price', offering.price_mad || ' MAD',
    'nextSession', CASE
      WHEN offering.admission_status = 'rolling_admission' THEN 'Admission continue'
      ELSE to_char(current_date + offering.start_in_days, 'YYYY-MM-DD')
    END,
    'language', array_to_string(offering.languages, ' / '),
    'skills', to_jsonb(offering.skill_labels),
    'validator', 'Données de démonstration — non validées',
    'relation', 'Catalogue fictif pour tester le moteur',
    'initials', offering.initials,
    'tone', offering.tone,
    'provisional', true,
    'fixtureWarning', 'Offre fictive; ne pas contacter ni présenter comme réelle.'
  ),
  now(), offering.sector_code, offering.level, offering.price_mad,
  offering.duration_hours, offering.languages, offering.product_family,
  false, offering.cold_start_rank, 'dummy-catalog-v1', provider.id,
  offering.application_url, 'provider_website', offering.delivery_format,
  offering.is_online, offering.location_city, offering.location_country,
  'priced', offering.admission_status,
  CASE WHEN offering.admission_status = 'scheduled'
       THEN current_date + offering.start_in_days ELSE NULL END,
  now(), 'fixture', NULL
FROM offering
JOIN praxis.provider AS provider ON provider.name = offering.provider_name
ON CONFLICT (record_type, slug) DO UPDATE SET
  title = EXCLUDED.title,
  status = EXCLUDED.status,
  summary = EXCLUDED.summary,
  attributes = EXCLUDED.attributes,
  published_at = coalesce(praxis.content_records.published_at, EXCLUDED.published_at),
  sector_code = EXCLUDED.sector_code,
  level = EXCLUDED.level,
  price_mad = EXCLUDED.price_mad,
  duration_hours = EXCLUDED.duration_hours,
  languages = EXCLUDED.languages,
  product_family = EXCLUDED.product_family,
  featured = EXCLUDED.featured,
  cold_start_rank = EXCLUDED.cold_start_rank,
  cold_start_source_version = EXCLUDED.cold_start_source_version,
  provider_id = EXCLUDED.provider_id,
  application_url = EXCLUDED.application_url,
  contact_route = EXCLUDED.contact_route,
  delivery_format = EXCLUDED.delivery_format,
  is_online = EXCLUDED.is_online,
  location_city = EXCLUDED.location_city,
  location_country = EXCLUDED.location_country,
  price_status = EXCLUDED.price_status,
  admission_status = EXCLUDED.admission_status,
  next_start_date = EXCLUDED.next_start_date,
  last_verified_at = EXCLUDED.last_verified_at,
  data_source = EXCLUDED.data_source,
  deleted_at = NULL;

INSERT INTO praxis.course_skill_outcome
  (content_record_id, skill_id, entry_level, outcome_level, weight,
   evidence_type, source_version, validated_at, validated_by)
SELECT content.id, edge.skill_id, edge.entry_level, edge.outcome_level,
       edge.weight, 'editorial', 'dummy-catalog-v1', NULL, NULL
FROM (VALUES
  ('demo-catalog-data-foundations','skill_prepare_data',0,2,1.0::numeric),
  ('demo-catalog-data-foundations','skill_analyze_dataset',0,2,1.0::numeric),
  ('demo-catalog-data-foundations','skill_frame_analytical_question',0,2,0.9::numeric),
  ('demo-catalog-sql-modeling','skill_write_queries',0,2,1.0::numeric),
  ('demo-catalog-sql-modeling','skill_model_data',0,2,0.9::numeric),
  ('demo-catalog-sql-modeling','skill_check_data_integrity',0,2,0.8::numeric),
  ('demo-catalog-power-bi','skill_build_dashboard',0,3,1.0::numeric),
  ('demo-catalog-power-bi','skill_communicate_finding',0,3,0.9::numeric),
  ('demo-catalog-power-bi','skill_validate_findings',0,2,0.8::numeric),
  ('demo-catalog-financial-statements','skill_read_financial_statements',0,3,1.0::numeric),
  ('demo-catalog-financial-statements','skill_quantitative_reasoning',0,2,0.8::numeric),
  ('demo-catalog-financial-statements','skill_identify_operational_risk',0,2,0.7::numeric),
  ('demo-catalog-financial-performance','skill_analyze_performance',1,3,1.0::numeric),
  ('demo-catalog-financial-performance','skill_assess_variance',1,3,1.0::numeric),
  ('demo-catalog-financial-performance','skill_present_recommendation',1,2,0.8::numeric),
  ('demo-catalog-project-planning','skill_plan_delivery',0,3,1.0::numeric),
  ('demo-catalog-project-planning','skill_plan_work_packages',0,3,1.0::numeric),
  ('demo-catalog-project-planning','skill_coordinate_delivery',0,2,0.8::numeric),
  ('demo-catalog-project-risk','skill_manage_risk',1,3,1.0::numeric),
  ('demo-catalog-project-risk','skill_coordinate_stakeholders',1,3,1.0::numeric),
  ('demo-catalog-project-risk','skill_report_delivery_risks',0,2,0.8::numeric),
  ('demo-catalog-hr-evidence','skill_clarify_people_need',0,3,1.0::numeric),
  ('demo-catalog-hr-evidence','skill_structure_evidence',0,3,1.0::numeric),
  ('demo-catalog-hr-evidence','skill_document_decision',0,3,0.9::numeric),
  ('demo-catalog-people-feedback','skill_give_feedback',0,3,1.0::numeric),
  ('demo-catalog-people-feedback','skill_run_review',0,2,0.9::numeric),
  ('demo-catalog-people-feedback','skill_set_priorities',0,2,0.8::numeric),
  ('demo-catalog-digital-adoption','skill_diagnose_process',0,3,1.0::numeric),
  ('demo-catalog-digital-adoption','skill_prioritize_change',0,3,1.0::numeric),
  ('demo-catalog-digital-adoption','skill_plan_adoption',0,3,1.0::numeric),
  ('demo-catalog-ai-workflow','skill_select_ai_use_case',0,3,1.0::numeric),
  ('demo-catalog-ai-workflow','skill_design_ai_workflow',0,2,0.9::numeric),
  ('demo-catalog-ai-workflow','skill_manage_ai_risk',0,2,0.8::numeric),
  ('demo-catalog-quality-audit','skill_esco_d83cba1585114d07b89a9fde0d1d8241',0,3,1.0::numeric),
  ('demo-catalog-quality-audit','skill_esco_286e486ca09447158e5ba2370b09a408',0,3,1.0::numeric),
  ('demo-catalog-quality-audit','skill_esco_958b8802ec3e481397f76c8f48610dbd',0,3,0.9::numeric)
) AS edge(slug, skill_id, entry_level, outcome_level, weight)
JOIN praxis.content_records AS content
  ON content.record_type = 'course' AND content.slug = edge.slug
ON CONFLICT (content_record_id, skill_id) DO UPDATE SET
  entry_level = EXCLUDED.entry_level,
  outcome_level = EXCLUDED.outcome_level,
  weight = EXCLUDED.weight,
  evidence_type = EXCLUDED.evidence_type,
  source_version = EXCLUDED.source_version,
  validated_at = NULL,
  validated_by = NULL;

DO $$
DECLARE
  offer_count integer;
  outcome_count integer;
BEGIN
  SELECT count(*) INTO offer_count
  FROM praxis.actionable_offers WHERE slug LIKE 'demo-catalog-%';
  SELECT count(*) INTO outcome_count
  FROM praxis.course_skill_outcome AS outcome
  JOIN praxis.content_records AS content ON content.id = outcome.content_record_id
  WHERE content.slug LIKE 'demo-catalog-%';
  IF offer_count <> 12 OR outcome_count <> 36 THEN
    RAISE EXCEPTION 'Dummy catalog integrity failure: % offers, % outcomes',
      offer_count, outcome_count;
  END IF;
END
$$;
