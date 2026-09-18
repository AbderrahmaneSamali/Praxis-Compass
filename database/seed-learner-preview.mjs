import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1}),client=await pool.connect();
try{
 const info=await client.query('SELECT current_database() AS name');
 if(!info.rows[0].name.endsWith('_test'))throw new Error('Preview fixtures require a dedicated *_test database');
 await client.query('BEGIN');
 const provider=await client.query(`INSERT INTO praxis.provider(name,website_url,languages,status,data_source,verified_at,verified_by)
  VALUES ('Praxis écran apprenant — organisme FICTIF','https://learner-preview.example',ARRAY['fr'],'active','fixture',now(),'local-test-fixture')
  ON CONFLICT(name) DO UPDATE SET verified_at=now() RETURNING id`);
 const goals=await client.query(`SELECT DISTINCT o.id,o.label_fr FROM praxis.occupation o JOIN praxis.navigator_role_skill_targets t ON t.role_id=o.id
  WHERE o.status='published' AND t.archived_at IS NULL AND t.profile_source='authored'`);
 for(const goal of goals.rows){
  const slug='learner-preview-'+goal.id.replaceAll('_','-');
  const course=await client.query(`INSERT INTO praxis.content_records(record_type,slug,title,summary,status,published_at,provider_id,
   application_url,delivery_format,is_online,price_mad,price_status,duration_hours,languages,admission_status,last_verified_at,data_source,
   review_source_url,reviewed_by,prerequisites_reviewed)
   VALUES ('course',$1,$2,'Offre fictive pour vérifier le parcours apprenant. Aucune inscription ni promesse de résultat réel.','published',now(),$3,
    'https://learner-preview.example','online_self_paced',true,250,'priced',12,ARRAY['fr'],'rolling_admission',now(),'fixture',
    'https://learner-preview.example','local-test-fixture',true)
   ON CONFLICT(record_type,slug) DO UPDATE SET last_verified_at=now() RETURNING id`,[slug,'EXEMPLE — Premiers pas : '+goal.label_fr,provider.rows[0].id]);
  await client.query(`INSERT INTO praxis.course_skill_outcome(content_record_id,skill_id,entry_level,outcome_level,weight,evidence_type,source_version,validated_at,validated_by)
   SELECT $1,t.skill_id,0,3,1,'validated','learner-preview-fictional-v1',now(),'local-test-fixture'
   FROM praxis.navigator_role_skill_targets t WHERE t.role_id=$2 AND t.archived_at IS NULL AND t.profile_source='authored'
   ORDER BY t.importance DESC,t.skill_id LIMIT 2 ON CONFLICT(content_record_id,skill_id) DO NOTHING`,[course.rows[0].id,goal.id]);
 }
 await client.query('COMMIT');console.log(`Seeded ${goals.rows.length} explicitly fictional offers in the dedicated preview database.`);
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
