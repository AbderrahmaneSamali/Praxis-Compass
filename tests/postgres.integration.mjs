import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {StandaloneRecommendationRepository,StandaloneCareerCompass} from '../dist/index.js';
import {weights,learner,skill} from './fixtures.mjs';

// Use an EMPTY, dedicated *_test database. All fixture DDL/data is rolled back.
test('PostgreSQL catalog, complete targets, weighted Compass, graph bounds and impression SQL',async()=>{
 const connectionString=process.env.PRAXIS_TEST_DATABASE_URL;
 assert.ok(connectionString,'Set PRAXIS_TEST_DATABASE_URL to an empty dedicated *_test database');
 const pool=new pg.Pool({connectionString,connectionTimeoutMillis:3000});
 const client=await pool.connect();
 try {
  const info=await client.query("SELECT current_database() AS name,to_regnamespace('praxis') AS schema");
  assert.ok(info.rows[0].name.endsWith('_test'),'Database name must end in _test');
  assert.equal(info.rows[0].schema,null,'Test database must not already contain a praxis schema');
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA praxis;
   CREATE TABLE praxis.esco_releases(id uuid PRIMARY KEY,language text,is_active boolean,imported_at timestamptz);
   CREATE TABLE praxis.esco_occupations(concept_uri text PRIMARY KEY,concept_id uuid);
   CREATE TABLE praxis.esco_occupation_versions(occupation_uri text,release_id uuid,preferred_label text,description text,language text);
   CREATE TABLE praxis.esco_skills(concept_uri text PRIMARY KEY,concept_id uuid);
   CREATE TABLE praxis.esco_skill_versions(skill_uri text,release_id uuid,preferred_label text);
   CREATE TABLE praxis.esco_occupation_skill_relations(release_id uuid,occupation_uri text,skill_uri text,relationship_type text);
   CREATE TABLE praxis.esco_skill_hierarchy(release_id uuid,narrower_uri text,broader_uri text,relation_type text DEFAULT 'broader');
   CREATE TABLE praxis.occupation(id text PRIMARY KEY,label_fr text,label_en text,esco_occupation_uri text);
   CREATE TABLE praxis.skill(id text PRIMARY KEY,label_fr text,label_en text,esco_skill_uri text,status text DEFAULT 'published');
   CREATE TABLE praxis.navigator_role_skill_targets(role_id text,skill_id text,label text,target_level integer,importance integer,archived_at timestamptz,profile_source text,target_level_basis text);
   CREATE TABLE praxis.provider(id text PRIMARY KEY,name text,status text,verified_at timestamptz,contact_email text,contact_phone text,website_url text);
   CREATE TABLE praxis.content_records(id uuid PRIMARY KEY,record_type text,slug text,title text,summary text,status text,product_family text,sector_code text,featured boolean DEFAULT false,cold_start_rank integer,cold_start_source_version text,price_mad numeric,duration_hours numeric,languages text[],delivery_format text,attributes jsonb DEFAULT '{}',next_start_date date,next_end_date date,required_weekly_hours numeric,provider_id text,application_url text,contact_route text,is_online boolean,location_city text,location_country text,price_status text,admission_status text,actionable_offer boolean,data_source text,updated_at timestamptz DEFAULT now(),deleted_at timestamptz,review_source_url text,reviewed_by text,prerequisites_reviewed boolean,last_verified_at timestamptz);
   CREATE TABLE praxis.course_prerequisite(content_record_id uuid,skill_id text,minimum_level integer);
   CREATE TABLE praxis.course_skill_outcome(content_record_id uuid,skill_id text,entry_level integer,outcome_level integer,weight numeric,evidence_type text,validated_at timestamptz,validated_by text);
   CREATE TABLE praxis.pathway_definition(content_record_id uuid,target_occupation_id text,variant text);
   CREATE TABLE praxis.navigator_pathway_steps(content_record_id uuid,position integer,step_type text,label text,archived_at timestamptz);
   CREATE TABLE praxis.learner_activity(content_record_id uuid);
   CREATE TABLE praxis.learner(id uuid PRIMARY KEY);
   CREATE TABLE praxis.recommendation_weights(version text PRIMARY KEY,weights jsonb,status text,activated_at timestamptz);
   CREATE TABLE praxis.recommendation_impression(id uuid PRIMARY KEY,learner_id uuid REFERENCES praxis.learner(id),surface text,weights_version text REFERENCES praxis.recommendation_weights(version),candidate_count smallint,inputs_hash text,target_occupation_id text REFERENCES praxis.occupation(id),learner_segment text,is_exploration boolean,exploration_probability numeric,served_at timestamptz,learning_plans jsonb,is_example boolean);
   CREATE TABLE praxis.recommendation_impression_item(impression_id uuid REFERENCES praxis.recommendation_impression(id),item_type text,item_id uuid REFERENCES praxis.content_records(id),rank integer,score numeric(6,3),features jsonb,reasons jsonb,outcome_prior_source text,outcome_prior_trial_count integer,outcome_prior_algorithm_version text,outcome_prior_inputs_hash text,PRIMARY KEY(impression_id,item_type,item_id),UNIQUE(impression_id,rank));
   CREATE TABLE praxis.learning_outcome(item_id uuid,source_impression uuid,completion_status text,satisfaction integer);
   CREATE TABLE praxis.skill_evidence(id uuid PRIMARY KEY,learner_id uuid,skill_id text,level integer,evidence_type text,confidence text,observed_at timestamptz,superseded_by uuid,provenance jsonb);
   CREATE TABLE praxis.assessment_session(id uuid PRIMARY KEY,learner_id uuid,skill_id text,status text,delivery_mode text,coverage_achieved boolean,reconciliation_status text,final_level text,completed_at timestamptz);
   CREATE TABLE praxis.assessment_blueprint(id uuid PRIMARY KEY,skill_id text,version text,language text,cells jsonb,status text,reviewed_by_learner_id uuid,reviewed_at timestamptz,published_at timestamptz);
   CREATE TABLE praxis.assessment_item(id uuid PRIMARY KEY,blueprint_id uuid,skill_id text,language text,sub_skill_id text,target_level text,status text,published_at timestamptz,calibration_status text,calibrated_at timestamptz,difficulty numeric,discrimination numeric);
   CREATE TABLE praxis.assessment_item_review(id uuid PRIMARY KEY,item_id uuid,decision text,reviewed_at timestamptz);`);
  const migration47=await readFile(new URL('../database/migrations/047_online_learning_paths.sql',import.meta.url),'utf8');
  const start=migration47.indexOf('CREATE VIEW praxis.reviewed_online_offers AS');
  await client.query(migration47.slice(start,migration47.indexOf(';',start)+1));
  await client.query("INSERT INTO praxis.recommendation_weights VALUES ('old',$1::jsonb,'active',now())",[JSON.stringify(weights)]);
  await client.query(await readFile(new URL('../database/migrations/050_recommendation_reliability.sql',import.meta.url),'utf8'));
  const release='11111111-1111-1111-1111-111111111111';
  await client.query("INSERT INTO praxis.esco_releases VALUES ($1,'fr',true,now())",[release]);
  for(let i=0;i<32;i++){
   const uri=`http://test/skill/${i}`;
   const concept=`22222222-2222-2222-2222-${String(i+1).padStart(12,'0')}`;
   await client.query('INSERT INTO praxis.esco_skills VALUES ($1,$2)',[uri,concept]);
   await client.query('INSERT INTO praxis.esco_skill_versions VALUES ($1,$2,$3)',[uri,release,`Skill ${i}`]);
   await client.query('INSERT INTO praxis.skill(id,label_fr,label_en,esco_skill_uri) VALUES ($1,$2,$2,$3)',[`s${i}`,`Skill ${i}`,uri]);
  }
  for(const [index,name,skills] of [[1,'origin',Array.from({length:12},(_,i)=>i)],[2,'large',Array.from({length:30},(_,i)=>i)],[3,'close',[0,1,2,3,4,5,6,7,30,31]]]){
   const uri=`http://test/${name}`;
   const concept=`33333333-3333-3333-3333-${String(index).padStart(12,'0')}`;
   await client.query('INSERT INTO praxis.esco_occupations VALUES ($1,$2)',[uri,concept]);
   await client.query("INSERT INTO praxis.esco_occupation_versions VALUES ($1,$2,$3,'','fr')",[uri,release,name]);
   await client.query('INSERT INTO praxis.occupation VALUES ($1,$2,$2,$3)',[name,name,uri]);
   for(const i of skills)await client.query("INSERT INTO praxis.esco_occupation_skill_relations VALUES ($1,$2,$3,'essential')",[release,uri,`http://test/skill/${i}`]);
  }
  await client.query("INSERT INTO praxis.provider VALUES ('p','Provider','active',now(),NULL,NULL,'https://example.org')");
  const ids=[];
  for(const [index,status,reviewed] of [[1,'published',true],[2,'published',true],[3,'published',false],[4,'draft',true]]){
   const id=`44444444-4444-4444-4444-${String(index).padStart(12,'0')}`;ids.push(id);
   await client.query(`INSERT INTO praxis.content_records(id,record_type,slug,title,summary,status,price_mad,duration_hours,languages,delivery_format,provider_id,application_url,is_online,price_status,admission_status,actionable_offer,data_source,review_source_url,reviewed_by,prerequisites_reviewed,last_verified_at)
    VALUES ($1::uuid,'course',$1::uuid::text,$1::uuid::text,'',$2,100,10,ARRAY['fr'],'online_self_paced','p','https://example.org',true,'priced','rolling_admission',true,'fixture','https://example.org','test',$3,now())`,[id,status,reviewed]);
   await client.query("INSERT INTO praxis.course_skill_outcome VALUES ($1,'s0',0,1,1,'validated',now(),'test')",[id]);
  }
  // A large parent cannot fan out to all siblings; a small parent can propose a related skill.
  for(let i=0;i<32;i++)await client.query('INSERT INTO praxis.esco_skill_hierarchy(release_id,narrower_uri,broader_uri) VALUES ($1,$2,$3)',[release,`http://test/skill/${i}`,'http://test/large-parent']);
  for(const i of [0,2])await client.query('INSERT INTO praxis.esco_skill_hierarchy(release_id,narrower_uri,broader_uri) VALUES ($1,$2,$3)',[release,`http://test/skill/${i}`,'http://test/small-parent']);
  await client.query('INSERT INTO praxis.learner VALUES ($1)',[learner.learnerId]);
  const runner={query:(...args)=>client.query(...args),connect:async()=>({query:(sql,args)=>client.query(sql==='BEGIN'?'SAVEPOINT impression':sql==='COMMIT'?'RELEASE SAVEPOINT impression':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT impression':sql,args),release(){}})};
  const repo=new StandaloneRecommendationRepository(runner);
  const cutoff=new Date('2030-01-01');
  const bankId='55555555-5555-5555-5555-555555555555',questionId='66666666-6666-6666-6666-666666666666';
  await client.query(`INSERT INTO praxis.assessment_blueprint VALUES ($1,'s0','v1','fr','{"core":{"L3":{"target":1}}}','published',$2,now(),now())`,[bankId,learner.learnerId]);
  assert.equal((await repo.assessmentAvailability(['s0'],'fr',cutoff)).length,0,'Incomplete bank cannot offer assessment');
  await client.query(`INSERT INTO praxis.assessment_item VALUES ($1,$2,'s0','fr','core','L3','published',now(),'calibrated',now(),0,1)`,[questionId,bankId]);
  await client.query("INSERT INTO praxis.assessment_item_review VALUES ('77777777-7777-7777-7777-777777777777',$1,'approved',now())",[questionId]);
  assert.deepEqual((await repo.assessmentAvailability(['s0'],'fr',cutoff))[0].supportedLevels,[3]);
  assert.equal((await repo.assessmentAvailability(['s0'],'en',cutoff)).length,0,'Wrong language cannot offer assessment');
  await client.query("UPDATE praxis.assessment_item SET calibration_status='pilot'");
  assert.equal((await repo.assessmentAvailability(['s0'],'fr',cutoff)).length,0,'Calibration is rechecked after publication');
  await client.query("UPDATE praxis.assessment_item SET calibration_status='calibrated'");
  await client.query("INSERT INTO praxis.assessment_item_review VALUES ('88888888-8888-8888-8888-888888888888',$1,'rejected',now()+interval '1 second')",[questionId]);
  assert.equal((await repo.assessmentAvailability(['s0'],'fr',cutoff)).length,0,'Latest rejection overrides an old approval');
  const sessionId='99999999-9999-9999-9999-999999999999';
  await client.query("INSERT INTO praxis.assessment_session VALUES ($1,$2,'s0','completed','production',true,'reconciled_tested','L1',now())",[sessionId,learner.learnerId]);
  await client.query(`INSERT INTO praxis.skill_evidence VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',$1,'s0',1,'quiz_sufficient_coverage','medium',now(),NULL,$2::jsonb)`,[learner.learnerId,JSON.stringify({assessmentSessionId:sessionId})]);
  const evidenceResult=await repo.recommendFromEvidence({learnerId:learner.learnerId,constraints:learner.constraints},'origin',{now:cutoff,explorationProbability:0});
  assert.equal(evidenceResult.evidenceProfile.selectedEvidence[0].level,1);
  assert.equal(evidenceResult.status,'insufficient_profile');
  assert.ok(evidenceResult.assessmentHandoff.requests.length>0);
  await client.query("UPDATE praxis.assessment_session SET skill_id='s1'");
  assert.equal((await repo.skillEvidence(learner.learnerId))[0].assessment,undefined,'A different skill session cannot prove evidence');
  const profile=await repo.deriveTargetProfile('large','fr');assert.equal(profile.skills.length,30);assert.equal(profile.source,'derived_from_esco');
  const reviewed=await repo.items('origin');assert.equal(reviewed.length,2);assert.ok(reviewed.every(c=>c.outcomes[0].catalogFrequency===2));
  const bypass=await repo.items('origin','default',undefined,{allowAllPublishedOffers:true});assert.equal(bypass.length,3);assert.ok(bypass.every(c=>c.status==='published'&&c.outcomes[0].catalogFrequency===3));
  const neighbours=await repo.neighbourSkillIds(['s0']);assert.ok(neighbours.has('s2'));assert.ok(!neighbours.has('s31'));assert.ok(!neighbours.has('s0'));
  const compass=await new StandaloneCareerCompass(runner).explore('origin','fr',2);
  assert.equal(compass.destinations[0].label,'close');assert.ok(compass.destinations[0].similarityScore>compass.destinations[1].similarityScore);
  assert.ok(compass.destinations[0].bridgePercentage>=compass.destinations[1].bridgePercentage);
  const uriCompass=await new StandaloneCareerCompass(runner).explore('http://test/origin','fr',1);assert.equal(uriCompass.destinations[0].label,'close');
  const result=await repo.recommend({...learner,skills:[skill('s0')]},'origin',{explorationProbability:0});
  assert.equal(result.weightsVersion,'praxis-rank-reliable-v4');assert.equal(result.recommendations.length,2);
  await repo.recordImpression(result,'integration',true);
  const stored=await client.query('SELECT input_snapshot,algorithm_version,is_example FROM praxis.recommendation_impression WHERE id=$1',[result.requestId]);
  assert.deepEqual(stored.rows[0].input_snapshot,result.inputSnapshot);assert.equal(stored.rows[0].algorithm_version,result.algorithmVersion);assert.equal(stored.rows[0].is_example,true);
  const ranks=await client.query('SELECT item_id,rank FROM praxis.recommendation_impression_item WHERE impression_id=$1 ORDER BY rank',[result.requestId]);
  assert.deepEqual(ranks.rows.map(r=>r.item_id),result.recommendations.map(r=>r.item.id));
  await client.query("INSERT INTO praxis.learning_outcome VALUES ($1,$2,'completed',5)",[ids[0],result.requestId]);
  await client.query("UPDATE praxis.content_records SET data_source='real' WHERE id=$1",[ids[0]]);
  assert.equal((await repo.items('origin'))[0].outcomePriorEvidence.global.trials,0,'Example-source outcomes cannot train production priors');
 } finally {await client.query('ROLLBACK');client.release();await pool.end();}
});
