import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {DevelopmentActivityRepository,activityContentHash,publishDevelopmentActivity} from '../dist/exploration/activities.js';
import {CareerLevelRepository} from '../dist/exploration/career-levels.js';
import {activityDrafts,seedDevelopmentActivities,enableDevelopmentPilots} from '../database/development-activities.mjs';
import {createLearnerServer} from '../learner/server.mjs';

async function poolForTest(){const url=process.env.PRAXIS_LEARNER_TEST_DATABASE_URL;assert.ok(url,'Use a migrated dedicated *_test database');const pool=new pg.Pool({connectionString:url});assert.match((await pool.query('SELECT current_database() AS name')).rows[0].name,/_test$/);return pool;}
const correct=b=>b.criteria.map(c=>({criterionCode:c.code,optionCode:b.options.find(o=>o.criterionCode===c.code&&o.isCorrect).code}));

test('activity migration supports an empty source catalogue',async()=>{
 const pool=await poolForTest(),c=await pool.connect();try{
  await c.query('BEGIN');await c.query(`CREATE SCHEMA activity_migration_probe;
   CREATE TABLE activity_migration_probe.rome_occupations(code_rome character(5) PRIMARY KEY);
   CREATE TABLE activity_migration_probe.rome_ogr_entities(code_ogr bigint PRIMARY KEY);
   CREATE TABLE activity_migration_probe.career_market(code text PRIMARY KEY);
   CREATE TABLE activity_migration_probe.career_level_requirement(framework_id text,id text,PRIMARY KEY(framework_id,id));
   CREATE TABLE activity_migration_probe.rome_development_action(action_id text,code_rome character(5));
   CREATE TABLE activity_migration_probe.learner(id uuid PRIMARY KEY);
   CREATE FUNCTION activity_migration_probe.prevent_source_row_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END; $$;`);
  const sql=await readFile(new URL('../database/migrations/067_development_activities.sql',import.meta.url),'utf8');await c.query(sql.replaceAll('praxis.','activity_migration_probe.'));
  assert.equal((await c.query('SELECT count(*)::int AS n FROM activity_migration_probe.development_activity')).rows[0].n,0);
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});

test('activities retain exact versions, enforce prerequisites and isolate results without granting mastery',async()=>{
 const pool=await poolForTest();await seedDevelopmentActivities(pool);const c=await pool.connect();
 try{
  await c.query('BEGIN');const prefix='activity-test-'+randomUUID()+'-',learner=randomUUID(),other=randomUUID();
  await c.query("INSERT INTO praxis.learner(id,locale) VALUES ($1,'fr'),($2,'fr')",[learner,other]);
  const nested={query:(...args)=>c.query(...args),connect:async()=>({query:(sql,args)=>c.query(sql==='BEGIN'?'SAVEPOINT nested_activity':sql==='COMMIT'?'RELEASE SAVEPOINT nested_activity':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT nested_activity':sql,args),release(){}})};
  const repo=new DevelopmentActivityRepository(nested),preferences=new CareerLevelRepository(c),ids=[];
  const rejectSql=async(sql,args,re)=>{await c.query('SAVEPOINT reject_sql');await assert.rejects(()=>c.query(sql,args),re);await c.query('ROLLBACK TO SAVEPOINT reject_sql');await c.query('RELEASE SAVEPOINT reject_sql');};
  for(const a of activityDrafts){const original=a.key+'-v1',id=prefix+original;ids.push(id);
   await c.query(`INSERT INTO praxis.development_activity SELECT (jsonb_populate_record(NULL::praxis.development_activity,
    to_jsonb(a)||jsonb_build_object('id',$1::text,'activity_key',$1::text,'status','draft','content_hash',NULL,'reviewed_by',NULL,'reviewed_at',NULL))).* FROM praxis.development_activity a WHERE id=$2`,[id,original]);
   for(const table of ['source','scope','skill','step','prerequisite','criterion','option'])await c.query(`INSERT INTO praxis.development_activity_${table}
    SELECT (jsonb_populate_record(NULL::praxis.development_activity_${table},to_jsonb(a)||jsonb_build_object('activity_id',$1::text))).* FROM praxis.development_activity_${table} a WHERE activity_id=$2`,[id,original]);
   if(a.prerequisite)await c.query('UPDATE praxis.development_activity_prerequisite SET required_activity_id=$2 WHERE activity_id=$1',[id,prefix+a.prerequisite+'-v1']);
  }
  const root=prefix+'market-reconciliation-v1',next=prefix+'market-correction-v1',agency=prefix+'agency-team-plan-v1';
  await c.query("INSERT INTO praxis.development_activity_level_target VALUES ($1,'fr-finance-v1','E1-skill','case')",[root]);
  await c.query(`INSERT INTO praxis.development_activity_prerequisite VALUES ($1,'practice','declared_practice',NULL,300440,'Pratique déjà déclarée','Entrée pédagogique uniquement','case')`,[agency]);
  assert.equal((await repo.forOccupation(learner,'C1302')).availability,'market_required');
  await preferences.savePreference(learner,{marketCode:'FR',trackCode:null});await preferences.savePreference(other,{marketCode:'FR',trackCode:null});
  assert.ok(!(await repo.forOccupation(learner,'C1302')).activities.some(a=>a.id===root));
  await assert.rejects(()=>repo.start(learner,'C1302',root,'FR'),/indisponible/);
  const publish=async(id,overrides={})=>publishDevelopmentActivity(nested,id,{actor:'test-operator',decision:'enable_pilot',expectedHash:activityContentHash(await repo.bundle(id)),rationale:'Synthetic test fixture only',...overrides});
  await assert.rejects(()=>publish(root,{expectedHash:'0'.repeat(64)}),/changed/);
  await assert.rejects(()=>publish(root,{decision:'approve',actor:'praxis-original-practice'}),/independent/);
  await rejectSql("UPDATE praxis.development_activity SET status='pilot',content_hash=$2 WHERE id=$1",[root,'a'.repeat(64)],/recorded publication/);
  await assert.rejects(()=>publish(next),/Prerequisite unavailable/);
  for(const id of ids)await publish(id);
  await publish(root,{decision:'approve',actor:'test-independent-reviewer'});
  assert.equal((await repo.bundle(root)).activity.status,'reviewed');
  await rejectSql("UPDATE praxis.development_activity_step SET instruction_fr='changed' WHERE activity_id=$1",[root],/Only draft/);
  await rejectSql("UPDATE praxis.development_activity SET title_fr='changed' WHERE id=$1",[root],/immutable/);
  let catalog=await repo.forOccupation(learner,'C1302');assert.equal(catalog.activities.find(a=>a.id===next).eligibility,'blocked');
  assert.deepEqual(catalog.activities.find(a=>a.id===root).levelTargets,[],'a proposed link does not expose a draft career framework');
  assert.ok(catalog.activities.find(a=>a.id===root).criteria.every(c=>c.options.every(o=>!('isCorrect' in o)&&!('feedback' in o))));
  assert.equal((await repo.forOccupation(learner,'C1303')).activities.some(a=>ids.includes(a.id)),false,'no expansion to unrelated occupations');
  await assert.rejects(()=>repo.start(learner,'C1302',next,'FR'),/prérequis/);await assert.rejects(()=>repo.start(learner,'C1302',root,'MA'),/pays a changé/);
  const b=await repo.bundle(root),answers=correct(b),requestKey=randomUUID(),input={activityId:root,codeRome:'C1302',marketCode:'FR',requestKey,answers};
  await assert.rejects(()=>repo.submit(learner,input),/Commencez/);
  await repo.start(learner,'C1302',root,'FR');await repo.start(learner,'C1302',root,'FR');
  const bad=await repo.submit(learner,{...input,requestKey:randomUUID(),answers:b.criteria.map(c=>({criterionCode:c.code,optionCode:'unknown'}))});assert.equal(bad.outcome,'needs_practice');assert.equal(bad.metCount,0);
  const pass=await repo.submit(learner,input);assert.equal(pass.outcome,'passed');assert.equal(pass.masteryEstablished,false);assert.equal(pass.contentHash,activityContentHash(b));
  assert.deepEqual(await repo.submit(learner,{...input,answers:[...answers].reverse()}),pass,'retry is idempotent even if answer order differs');
  await assert.rejects(()=>repo.submit(learner,{...input,answers:b.criteria.map(c=>({criterionCode:c.code,optionCode:'unknown'}))}),/déjà été enregistrée/);
  await assert.rejects(()=>repo.submit(learner,{...input,marketCode:'MA'}),/déjà été enregistrée/);
  assert.equal((await repo.forOccupation(learner,'C1302')).activities.find(a=>a.id===next).eligibility,'ready');
  assert.equal((await repo.forOccupation(other,'C1302')).activities.find(a=>a.id===next).eligibility,'blocked');
  assert.equal((await repo.forOccupation(learner,'C1301')).activities.find(a=>a.id===next).eligibility,'blocked');
  await assert.rejects(()=>repo.attempt(other,pass.id),/introuvable/);
  await preferences.savePreference(learner,{marketCode:'MA',trackCode:null});assert.equal((await repo.forOccupation(learner,'C1302')).activities.find(a=>a.id===next).eligibility,'blocked');
  await preferences.savePreference(learner,{marketCode:'FR',trackCode:null});
  assert.equal((await repo.forOccupation(learner,'C1207')).activities.find(a=>a.id===agency).eligibility,'needs_information');
  const release=(await c.query("SELECT id FROM praxis.source_releases WHERE source='rome' AND is_active")).rows[0].id;
  await c.query("INSERT INTO praxis.rome_requirement_confirmation(learner_id,code_ogr,release_id,response,work_example,practice_context_id) VALUES ($1,300440,$2,'practiced','','practice_context:work')",[learner,release]);
  assert.equal((await repo.forOccupation(learner,'C1207')).activities.find(a=>a.id===agency).eligibility,'ready');
  assert.equal((await c.query('SELECT count(*)::int AS n FROM praxis.skill_evidence WHERE learner_id=$1',[learner])).rows[0].n,0);
  assert.equal((await c.query('SELECT count(*)::int AS n FROM praxis.learner_career_level_goal WHERE learner_id=$1',[learner])).rows[0].n,0);
  assert.equal((await c.query('SELECT count(*)::int AS n FROM praxis.development_activity_attempt WHERE learner_id=$1',[learner])).rows[0].n,2);
  await rejectSql("UPDATE praxis.development_activity_attempt SET outcome='needs_practice' WHERE id=$1",[pass.id],/append.only/);
  await rejectSql('DELETE FROM praxis.development_activity_answer WHERE attempt_id=$1',[pass.id],/append.only/);
  await c.query("UPDATE praxis.development_activity SET status='retired' WHERE id=$1",[root]);
  assert.equal((await repo.forOccupation(learner,'C1302')).activities.find(a=>a.id===next).prerequisites[0].state,'unavailable');
  assert.equal((await repo.attempt(learner,pass.id)).outcome,'passed','history remains tied to the retired version');
  await c.query('DELETE FROM praxis.learner WHERE id=$1',[learner]);assert.equal((await c.query('SELECT count(*)::int AS n FROM praxis.development_activity_attempt WHERE learner_id=$1',[learner])).rows[0].n,0,'learner erasure cascades');
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});

test('activity HTTP flow uses scoped sessions, selection-only input and replay-safe grading',async()=>{
 const pool=await poolForTest();const ids=await seedDevelopmentActivities(pool);await enableDevelopmentPilots(pool,ids);
 const server=createLearnerServer({pool,example:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,sessions=[];
 try{
  const session=async()=>{const r=await fetch(origin+'/api/bootstrap');const s={cookie:r.headers.get('set-cookie').split(';')[0],data:await r.json()};sessions.push(s);return s;};
  const first=await session(),other=await session();
  const post=(s,path,body,extra={})=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:s.cookie,'X-Praxis-CSRF':s.data.csrf,...extra},body:JSON.stringify(body)});
  const get=(s,path)=>fetch(origin+path,{headers:{Cookie:s.cookie}});
  for(const s of sessions){assert.equal((await post(s,'/api/profile',{currentRomeCode:'C1302',preferredDomainCode:'C13',confirmedInterestCodes:[]})).status,200);}
  assert.equal((await (await get(first,'/api/activities?codeRome=C1302')).json()).availability,'market_required');
  for(const s of sessions)await post(s,'/api/career/preferences',{marketCode:'FR',trackCode:null});
  const catalog=await (await get(first,'/api/activities?codeRome=C1302')).json();assert.equal(catalog.activities.length,3);assert.ok(catalog.activities.every(a=>a.status==='pilot'));
  assert.ok(catalog.activities.every(a=>a.levelTargets.length===0));assert.ok(!JSON.stringify(catalog).includes('isCorrect'));
  assert.equal((await get(first,'/api/activities?codeRome=C1207')).status,404);
  assert.equal((await fetch(origin+'/api/activities?codeRome=C1302')).status,401);
  const base={codeRome:'C1302',marketCode:'FR',activityId:'market-reconciliation-v1'};
  assert.equal((await post(first,'/api/activities/start',{...base,learnerId:'other'})).status,400);
  assert.equal((await post(first,'/api/activities/start',base,{'X-Praxis-CSRF':'wrong'})).status,403);
  assert.equal((await post(first,'/api/activities/start',{...base,activityId:'market-correction-v1'})).status,409);
  assert.equal((await post(first,'/api/activities/start',base)).status,200);
  const payload={...base,requestKey:randomUUID(),answers:[{criterionCode:'difference',optionCode:'90'},{criterionCode:'missing',optionCode:'absent'},{criterionCode:'batch',optionCode:'two'}]};
  assert.equal((await post(first,'/api/activities/submit',{...payload,outcome:'passed'})).status,400);
  assert.equal((await post(first,'/api/activities/submit',{...payload,answers:[{criterionCode:'difference',optionCode:'90'}]})).status,400);
  const [a,b]=await Promise.all([post(first,'/api/activities/submit',payload),post(first,'/api/activities/submit',payload)]);
  assert.equal(a.status,200);assert.equal(b.status,200);const passed=await a.json();assert.equal((await b.json()).id,passed.id);assert.equal(passed.outcome,'passed');
  assert.equal((await get(other,'/api/activities/attempts/'+passed.id)).status,404);
  assert.equal((await post(other,'/api/activities/start',{...base,activityId:'market-correction-v1'})).status,409);
  assert.equal((await post(first,'/api/activities/start',{...base,activityId:'market-correction-v1'})).status,200);
  await post(first,'/api/career/preferences',{marketCode:'MA',trackCode:null});
  assert.equal((await post(first,'/api/activities/start',{...base,activityId:'market-correction-v1',marketCode:'MA'})).status,409);
  const assets=await get(first,'/development-activities.js');assert.equal(assets.status,200);
 }finally{
  await new Promise(r=>server.close(r));
  for(const s of sessions){const key=createHash('sha256').update(s.cookie.split('=')[1]).digest('hex');await pool.query('DELETE FROM praxis.learner WHERE id IN (SELECT learner_id FROM praxis.learner_session WHERE session_key=$1)',[key]);}
  await pool.end();
 }
});
