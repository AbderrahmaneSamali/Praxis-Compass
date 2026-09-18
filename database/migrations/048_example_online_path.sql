-- Entirely fictional examples. Never qualify as real launch evidence.
-- The target skill is drawn from existing role requirements; no career facts are invented.
DO $$
DECLARE provider_uuid uuid; foundation_uuid uuid; advanced_uuid uuid; target_skill text; target_label text;
BEGIN
  SELECT t.skill_id,s.label_fr INTO target_skill,target_label
  FROM praxis.navigator_role_skill_targets t JOIN praxis.skill s ON s.id=t.skill_id
  WHERE t.archived_at IS NULL AND s.status='published'
  ORDER BY t.role_id,t.importance DESC,t.skill_id LIMIT 1;
  IF target_skill IS NULL THEN
    RAISE NOTICE 'No authored target exists: online example skipped';
    RETURN;
  END IF;
  INSERT INTO praxis.skill(id,label_fr,skill_type,status)
  VALUES('skill_demo_online_foundation','Fondamentaux de projet — EXEMPLE FICTIF','skill','draft');
  INSERT INTO praxis.provider(name,website_url,languages,status,data_source,verified_at,verified_by)
  VALUES('PRAXIS Démo Online-48 — organisme fictif','https://online-48.example',ARRAY['fr','en'],'active','fixture',now(),'fixture-seed-not-human-review')
  RETURNING id INTO provider_uuid;

  INSERT INTO praxis.content_records(record_type,slug,title,summary,status,attributes,published_at,
    provider_id,application_url,delivery_format,is_online,price_mad,price_status,
    duration_hours,languages,admission_status,last_verified_at,data_source,
    required_weekly_hours,review_source_url,reviewed_by,prerequisites_reviewed)
  VALUES('course','example-online-foundation-48','EXEMPLE — Fondamentaux en ligne',
    'Données fictives pour tester un parcours. Aucune inscription réelle.',
    'published','{}',now(),provider_uuid,'https://online-48.example/foundation','online_self_paced',true,
    400,'priced',10,ARRAY['fr'],'rolling_admission',now(),'fixture',5,
    'https://online-48.example/foundation','fixture-seed-not-human-review',true)
  RETURNING id INTO foundation_uuid;
  INSERT INTO praxis.course_skill_outcome(content_record_id,skill_id,entry_level,outcome_level,weight,evidence_type,source_version,validated_at,validated_by)
  VALUES(foundation_uuid,'skill_demo_online_foundation',0,2,1,'validated','fictional-online-example-v1',now(),'fixture-seed-not-human-review');

  INSERT INTO praxis.content_records(record_type,slug,title,summary,status,attributes,published_at,
    provider_id,application_url,delivery_format,is_online,price_mad,price_status,
    duration_hours,languages,admission_status,next_start_date,next_end_date,last_verified_at,data_source,
    required_weekly_hours,review_source_url,reviewed_by,prerequisites_reviewed)
  VALUES('course','example-online-applied-48','EXEMPLE — Atelier : ' || left(target_label,140),
    'Atelier fictif nécessitant les fondamentaux. Aucune promesse de compétence réelle.',
    'published','{}',now(),provider_uuid,'https://online-48.example/applied','online_live',true,
    800,'priced',15,ARRAY['fr'],'scheduled',CURRENT_DATE+35,CURRENT_DATE+56,now(),'fixture',5,
    'https://online-48.example/applied','fixture-seed-not-human-review',true)
  RETURNING id INTO advanced_uuid;
  INSERT INTO praxis.course_skill_outcome(content_record_id,skill_id,entry_level,outcome_level,weight,evidence_type,source_version,validated_at,validated_by)
  VALUES(advanced_uuid,target_skill,0,3,1,'validated','fictional-online-example-v1',now(),'fixture-seed-not-human-review');
  INSERT INTO praxis.course_prerequisite(content_record_id,skill_id,minimum_level,source_url,reviewed_by,reviewed_at)
  VALUES(advanced_uuid,'skill_demo_online_foundation',2,'https://online-48.example/applied','fixture-seed-not-human-review',now());
END $$;
