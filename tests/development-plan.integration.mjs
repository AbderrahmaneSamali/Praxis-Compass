import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createLearnerServer} from '../learner/server.mjs';
import {DevelopmentPlanRepository} from '../dist/exploration/development-plan.repository.js';
import {CareerLevelRepository,reviewCareerFramework,frameworkContentHash} from '../dist/exploration/career-levels.js';
import {seedDevelopmentActivities,enableDevelopmentPilots} from '../database/development-activities.mjs';

async function poolForTest(){assert.ok(process.env.PRAXIS_LEARNER_TEST_DATABASE_URL,'Dedicated test DB required');const p=new pg.Pool({connectionString:process.env.PRAXIS_LEARNER_TEST_DATABASE_URL});assert.match((await p.query('SELECT current_database() AS name')).rows[0].name,/_test$/);return p;}

test('plan cases can migrate before source ingestion',async()=>{
 const p=await poolForTest(),c=await p.connect();try{await c.query('BEGIN');await c.query(`CREATE SCHEMA plan_migration_probe;
 CREATE TABLE plan_migration_probe.learner(id uuid PRIMARY KEY);CREATE TABLE plan_migration_probe.rome_occupations(code_rome character(5) PRIMARY KEY);
 CREATE TABLE plan_migration_probe.career_market(code text PRIMARY KEY);`);
 const sql=await readFile(new URL('../database/migrations/068_development_plan_cases.sql',import.meta.url),'utf8');await c.query(sql.replaceAll('praxis.','plan_migration_probe.'));
 assert.equal((await c.query('SELECT count(*)::int AS n FROM plan_migration_probe.development_plan_case')).rows[0].n,0);
 }finally{await c.query('ROLLBACK');c.release();await p.end();}
});

test('HTTP plans preserve unknowns, immutable replay and country/session scope through exercise progress',async()=>{
 const pool=await poolForTest();await enableDevelopmentPilots(pool,await seedDevelopmentActivities(pool));
 const server=createLearnerServer({pool,example:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,sessions=[];
 try{
  const session=async()=>{const r=await fetch(origin+'/api/bootstrap'),s={cookie:r.headers.get('set-cookie').split(';')[0],data:await r.json()};sessions.push(s);return s;};
  const first=await session(),other=await session();
  const post=(s,path,body,extra={})=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:s.cookie,'X-Praxis-CSRF':s.data.csrf,...extra},body:JSON.stringify(body)});
  const get=(s,path)=>fetch(origin+path,{headers:{Cookie:s.cookie}});
  const create=async(s=first)=>{const r=await post(s,'/api/development-plan',{codeRome:'C1302'});assert.equal(r.status,200,await r.clone().text());return r.json();};
  for(const s of sessions)assert.equal((await post(s,'/api/profile',{currentRomeCode:'C1302',preferredDomainCode:'C13',confirmedInterestCodes:[]})).status,200);
  const unset=await create();assert.equal(unset.plan.levelAvailability,'market_required');assert.equal(unset.plan.summary.exercises,0);
  assert.ok(unset.plan.summary.requirements>3);assert.equal(unset.plan.summary.unknown,unset.plan.summary.requirements);
  for(const s of sessions)await post(s,'/api/career/preferences',{marketCode:'FR',trackCode:null});
  const [initial,duplicate]=await Promise.all([create(),create()]);assert.equal(initial.id,duplicate.id,'concurrent identical snapshots deduplicate');
  assert.equal(initial.plan.summary.exercises,3);assert.equal(initial.plan.summary.exercisesCompleted,0);assert.equal(initial.input.careerGoal,null);
  assert.ok(initial.input.requirements.every(r=>r.kind==='occupation'));assert.ok(!JSON.stringify(initial).includes('fr-finance-v1'));
  assert.ok(!JSON.stringify(initial).includes('isCorrect'));assert.ok(!JSON.stringify(initial).includes('workExample'));
  assert.equal((await post(first,'/api/development-plan',{codeRome:'C1207'})).status,404);
  assert.equal((await post(first,'/api/development-plan',{codeRome:'C1302',learnerId:randomUUID()})).status,400);
  assert.equal((await post(first,'/api/development-plan',{codeRome:'C1302'},{'X-Praxis-CSRF':'wrong'})).status,403);
  assert.equal((await get(other,'/api/development-plan/cases/'+initial.id)).status,404);
  assert.equal((await post(other,'/api/development-plan/replay',{caseId:initial.id})).status,404);
  assert.equal((await fetch(origin+'/api/development-plan/cases/'+initial.id)).status,401);
  const base={codeRome:'C1302',marketCode:'FR',activityId:'market-reconciliation-v1'};
  await post(first,'/api/activities/start',base);assert.equal((await create()).id,initial.id,'starting a case alone is not evidence');
  const submission=await post(first,'/api/activities/submit',{...base,requestKey:randomUUID(),answers:[{criterionCode:'difference',optionCode:'90'},{criterionCode:'missing',optionCode:'absent'},{criterionCode:'batch',optionCode:'two'}]});assert.equal(submission.status,200);const outcome=await submission.json();
  const progressed=await create();assert.notEqual(progressed.id,initial.id);assert.equal(progressed.plan.summary.exercisesCompleted,1);assert.equal(progressed.plan.summary.unknown,initial.plan.summary.unknown);
  assert.ok(progressed.input.attempts.some(t=>t.id===outcome.id));assert.equal(progressed.plan.milestones.find(m=>m.activityId==='market-correction-v1').state,'ready');
  assert.equal((await create(other)).plan.summary.exercisesCompleted,0);
  const confirmed=await post(first,'/api/rome/confirmations',{codeRome:'C1302',ogr:'121569',response:'practiced',practiceContextId:'practice_context:work'});assert.equal(confirmed.status,200,await confirmed.clone().text());
  const declared=await create();assert.ok(declared.plan.summary.declaredPractice>0);assert.equal(declared.plan.masteryEstablished,false);
  const replay=await post(first,'/api/development-plan/replay',{caseId:initial.id});assert.equal(replay.status,200);const replayed=await replay.json();assert.equal(replayed.verified,true);assert.equal(replayed.plan.summary.exercisesCompleted,0);assert.deepEqual(replayed.plan,initial.plan);
  await post(first,'/api/career/preferences',{marketCode:'MA',trackCode:null});const ma=await create();assert.equal(ma.plan.target.marketCode,'MA');assert.equal(ma.plan.summary.exercisesCompleted,0);assert.equal(ma.input.careerGoal,null);
  await post(first,'/api/profile',{currentRomeCode:'C1202',preferredDomainCode:'C12',confirmedInterestCodes:[]});
  assert.equal((await post(first,'/api/development-plan',{codeRome:'C1302'})).status,404);
  assert.equal((await get(first,'/api/development-plan/cases/'+initial.id)).status,200,'owned history survives changed candidate scope');
  const history=await (await get(first,'/api/development-plan/history?codeRome=C1302')).json();assert.equal(history.cases.length,5);assert.equal(history.nextOffset,null);
  assert.equal((await get(first,'/api/development-plan/history?codeRome=C1302&offset=-1')).status,400);
  const client=await pool.connect();try{await client.query('BEGIN');await assert.rejects(()=>client.query("UPDATE praxis.development_plan_case SET output_hash=$2 WHERE id=$1",[initial.id,'a'.repeat(64)]),/immutable/);await client.query('ROLLBACK');}finally{client.release();}
  const owner=(await pool.query('SELECT learner_id FROM praxis.development_plan_case WHERE id=$1',[initial.id])).rows[0].learner_id;
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM praxis.skill_evidence WHERE learner_id=$1',[owner])).rows[0].n,0);
  assert.equal((await get(first,'/development-plan.js')).status,200);
 }finally{
  await new Promise(r=>server.close(r));
  for(const s of sessions){const key=createHash('sha256').update(s.cookie.split('=')[1]).digest('hex');const owner=(await pool.query('SELECT learner_id FROM praxis.learner_session WHERE session_key=$1',[key])).rows[0]?.learner_id;
   await pool.query('DELETE FROM praxis.learner WHERE id=$1',[owner]);assert.equal((await pool.query('SELECT count(*)::int AS n FROM praxis.development_plan_case WHERE learner_id=$1',[owner])).rows[0].n,0);}
  await pool.end();
 }
});

test('reviewed goal uses only exact target criteria; drafts and cross-market goals never enter a case',async()=>{
 const pool=await poolForTest(),c=await pool.connect();try{
  await c.query('BEGIN');const learner=randomUUID(),id='plan-fixture-'+randomUUID();
  await c.query("INSERT INTO praxis.learner(id,locale) VALUES ($1,'fr')",[learner]);await c.query("INSERT INTO praxis.exploration_profile(learner_id,current_rome_code,preferred_domain_code) VALUES ($1,'C1302','C13')",[learner]);
  const nested={query:(...args)=>c.query(...args),connect:async()=>({query:(sql,args)=>c.query(sql.startsWith('BEGIN')?'SAVEPOINT plan_nested':sql==='COMMIT'?'RELEASE SAVEPOINT plan_nested':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT plan_nested':sql,args),release(){}})};
  const plans=new DevelopmentPlanRepository(nested),levels=new CareerLevelRepository(c);await levels.savePreference(learner,{marketCode:'FR',trackCode:'expertise'});
  await c.query(`INSERT INTO praxis.career_framework(id,family_id,market_code,version,title_fr,scope_fr,limitations_fr,authored_by) VALUES ($1,'finance','FR',900001,'Test plan framework','Test only','Test only','test-author')`,[id]);
  await c.query(`INSERT INTO praxis.career_framework_source VALUES ($1,'source','Test source','Test',NULL,current_date,'test','authored_proposal','test','test')`,[id]);
  for(const [code,position] of [['E1',1],['E2',2]]){
   await c.query(`INSERT INTO praxis.career_level VALUES ($1,$2,'expertise',$2,$3,'Defined autonomy','Defined scope','Defined influence',false,'editorial_proposal','source')`,[id,code,position]);
   await c.query(`INSERT INTO praxis.career_level_occupation VALUES ($1,$2,'C1302','Test scope','source')`,[id,code]);
   await c.query(`INSERT INTO praxis.career_level_requirement(framework_id,id,level_code,dimension,label_fr,expected_behavior_fr,skill_ogr,source_id) VALUES ($1,$2,$2,'skill','Reconcile','Review and explain',121569,'source')`,[id,code]);
   await c.query(`INSERT INTO praxis.career_level_evidence_criterion VALUES ($1,$2,'review','Explain discrepancies','reviewed_work','source')`,[id,code]);
  }
  await c.query(`INSERT INTO praxis.career_level_transition VALUES ($1,'E1','E2','progression','Explicit transition','source')`,[id]);
  const draft=await plans.create(learner,'C1302');assert.ok(!JSON.stringify(draft).includes(id));
  await reviewCareerFramework(nested,id,{reviewer:'independent-test-reviewer',decision:'approve',rationale:'Synthetic rolled back test',expectedHash:frameworkContentHash(await levels.bundle(id))});
  await levels.saveGoal(learner,'C1302',{frameworkId:id,trackCode:'expertise',targetLevelCode:'E2',currentLevelCode:'E1'});
  const selected=await plans.create(learner,'C1302');assert.equal(selected.plan.levelAvailability,'selected');assert.equal(selected.plan.careerGoal.targetLevelCode,'E2');
  const requirements=selected.plan.gaps.filter(g=>g.kind==='career_level');assert.equal(requirements.length,1,'No implied inheritance from level ordering or transition edges');
  assert.equal(requirements[0].id,`framework:${id}:E2`);assert.equal(requirements[0].criteria[0].label,'Explain discrepancies');assert.equal(requirements[0].targetAssessment,'not_assessed');
  await levels.savePreference(learner,{marketCode:'MA',trackCode:'expertise'});const ma=await plans.create(learner,'C1302');assert.equal(ma.plan.careerGoal,null);assert.ok(!JSON.stringify(ma).includes(id));
  await levels.savePreference(learner,{marketCode:'FR',trackCode:'expertise'});await c.query("UPDATE praxis.career_framework SET status='retired' WHERE id=$1",[id]);
  const retired=await plans.create(learner,'C1302');assert.equal(retired.plan.levelAvailability,'goal_unavailable');assert.equal(retired.plan.careerGoal,null);
  assert.equal((await plans.replay(learner,selected.id)).verified,true,'Retirement cannot change historical computation');
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
