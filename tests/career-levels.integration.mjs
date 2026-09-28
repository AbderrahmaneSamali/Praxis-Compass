import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {CareerLevelRepository,frameworkContentHash,reviewCareerFramework} from '../dist/exploration/career-levels.js';

test('career migration can run before occupation source ingestion',async()=>{
 const url=process.env.PRAXIS_LEARNER_TEST_DATABASE_URL;assert.ok(url);
 const pool=new pg.Pool({connectionString:url}),client=await pool.connect();
 try{
  assert.match((await client.query('SELECT current_database() AS name')).rows[0].name,/_test$/);await client.query('BEGIN');
  const schema='career_migration_probe';
  await client.query(`CREATE SCHEMA ${schema};
   CREATE TABLE ${schema}.rome_professional_domains(domain_code text PRIMARY KEY);
   CREATE TABLE ${schema}.rome_occupations(code_rome character(5) PRIMARY KEY);
   CREATE TABLE ${schema}.rome_ogr_entities(code_ogr bigint PRIMARY KEY);
   CREATE TABLE ${schema}.skill(id text PRIMARY KEY);
   CREATE TABLE ${schema}.learner(id uuid PRIMARY KEY);
   CREATE FUNCTION ${schema}.prevent_source_row_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END; $$;`);
  const sql=await readFile(new URL('../database/migrations/066_career_level_frameworks.sql',import.meta.url),'utf8');
  await client.query(sql.replaceAll('praxis.',schema+'.'));
  assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${schema}.career_market`)).rows[0].n,2);
  assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${schema}.career_family`)).rows[0].n,0);
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});

test('career frameworks: publication guards, market isolation, goals and retirement',async()=>{
 const url=process.env.PRAXIS_LEARNER_TEST_DATABASE_URL;assert.ok(url,'Use a dedicated migrated *_test database');
 const pool=new pg.Pool({connectionString:url}),client=await pool.connect();
 try{
  assert.match((await client.query('SELECT current_database() AS name')).rows[0].name,/_test$/);
  await client.query('BEGIN');const repo=new CareerLevelRepository(client),learner=randomUUID(),other=randomUUID(),prefix='test-'+randomUUID();
  await client.query("INSERT INTO praxis.learner(id,locale) VALUES ($1,'fr'),($2,'fr')",[learner,other]);
  const rejectSql=async(sql,values,pattern)=>{await client.query('SAVEPOINT rejection');await assert.rejects(()=>client.query(sql,values),pattern);await client.query('ROLLBACK TO SAVEPOINT rejection');await client.query('RELEASE SAVEPOINT rejection');};
  // The operator service runs inside this outer rollback: no test framework is ever persisted as reviewed.
  const nestedPool={connect:async()=>({query:(sql,values)=>client.query(sql==='BEGIN'?'SAVEPOINT operator_review':sql==='COMMIT'?'RELEASE SAVEPOINT operator_review':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT operator_review':sql,values),release(){}})};
  async function fixture(market){
   const id=prefix+'-'+market,version=900000;
   await client.query(`INSERT INTO praxis.career_framework(id,family_id,market_code,version,title_fr,scope_fr,limitations_fr,authored_by)
    VALUES ($1,'finance',$2,$3,'TEST framework','C1302 test only','TEST ONLY','test-author')`,[id,market,version]);
   await client.query(`INSERT INTO praxis.career_framework_source VALUES ($1,'source','TEST original','TEST',NULL,current_date,'test','authored_proposal','test','test')`,[id]);
   for(const [code,track,order] of [['E1','expertise',1],['E2','expertise',2],['M1','management',1]]){
    await client.query(`INSERT INTO praxis.career_level VALUES ($1,$2,$3,$4,$5,'Defined autonomy','Defined scope','Defined influence',$6,'editorial_proposal','source')`,[id,code,track,market+' '+code,order,track==='management']);
    await client.query(`INSERT INTO praxis.career_level_occupation VALUES ($1,$2,'C1302','TEST applicability','source')`,[id,code]);
    await client.query(`INSERT INTO praxis.career_level_requirement(framework_id,id,level_code,dimension,label_fr,expected_behavior_fr,source_id) VALUES ($1,$2,$2,'autonomy','TEST autonomy','TEST behavior','source')`,[id,code]);
    await client.query(`INSERT INTO praxis.career_level_evidence_criterion VALUES ($1,$2,'case','TEST criterion','structured_scenario','source')`,[id,code]);
   }
   await client.query(`INSERT INTO praxis.career_level_transition VALUES ($1,'E1','E2','progression','TEST progression','source'),($1,'E2','M1','track_change','TEST transition','source')`,[id]);return id;
  }
  const fr=await fixture('FR'),ma=await fixture('MA');
  assert.deepEqual(await repo.preference(learner),{marketCode:null,trackCode:null});
  assert.equal((await repo.forOccupation(learner,'C1302')).availability,'market_required');
  await assert.rejects(()=>repo.savePreference(learner,{marketCode:'ZZ',trackCode:null}));
  await repo.savePreference(learner,{marketCode:'FR',trackCode:'expertise'});
  const draft=await repo.forOccupation(learner,'C1302');assert.equal(draft.availability,'unavailable');assert.deepEqual(draft.frameworks,[]);
  const goal={frameworkId:fr,trackCode:'expertise',targetLevelCode:'E2',currentLevelCode:null};
  await assert.rejects(()=>repo.saveGoal(learner,'C1302',goal));
  await rejectSql(`INSERT INTO praxis.learner_career_level_goal(learner_id,code_rome,market_code,framework_id,track_code,target_level_code) VALUES ($1,'C1302','FR',$2,'expertise','E2')`,[learner,fr],/Only reviewed/);
  const review=async(id,extra={})=>reviewCareerFramework(nestedPool,id,{reviewer:'test-independent-reviewer',decision:'approve',rationale:'Synthetic test only',expectedHash:frameworkContentHash(await repo.bundle(id)),...extra});
  await assert.rejects(()=>review(fr,{reviewer:'test-author'}),/independent/);
  await assert.rejects(()=>review(fr,{expectedHash:'0'.repeat(64)}),/changed/);
  await rejectSql(`UPDATE praxis.career_framework SET status='reviewed',reviewed_by='test-reviewer',reviewed_at=now(),content_hash=$2 WHERE id=$1`,[fr,'a'.repeat(64)],/matching recorded review/);
  // Invalid graph/content cannot be approved.
  await client.query(`INSERT INTO praxis.career_level_transition VALUES ($1,'E2','E1','progression','TEST cycle','source')`,[fr]);
  await assert.rejects(()=>review(fr),/cycle/);await client.query(`DELETE FROM praxis.career_level_transition WHERE framework_id=$1 AND from_code='E2' AND to_code='E1'`,[fr]);
  await client.query(`UPDATE praxis.career_level_transition SET kind='progression' WHERE framework_id=$1 AND to_code='M1'`,[fr]);
  await assert.rejects(()=>review(fr),/kind/);await client.query(`UPDATE praxis.career_level_transition SET kind='track_change' WHERE framework_id=$1 AND to_code='M1'`,[fr]);
  await client.query(`DELETE FROM praxis.career_level_evidence_criterion WHERE framework_id=$1 AND requirement_id='M1'`,[fr]);
  await assert.rejects(()=>review(fr),/evidence criteria/);
  await client.query(`INSERT INTO praxis.career_level_evidence_criterion VALUES ($1,'M1','case','TEST criterion','structured_scenario','source')`,[fr]);
  await review(fr);await review(ma);
  assert.equal((await repo.forOccupation(learner,'C1302')).frameworks[0].framework.marketCode,'FR');
  assert.deepEqual((await repo.forOccupation(learner,'C1302')).frameworks[0].levels.map(l=>l.code),['E1','E2']);
  assert.deepEqual((await repo.forOccupation(learner,'C1303')).frameworks,[]);
  const stored=await repo.saveGoal(learner,'C1302',goal);assert.deepEqual(stored.goal,goal);
  assert.equal(stored.frameworks[0].readiness,'not_assessed');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM praxis.skill_evidence WHERE learner_id=$1',[learner])).rows[0].n,0);
  assert.equal((await repo.forOccupation(other,'C1302')).goal,null);assert.equal((await repo.preference(other)).marketCode,null);
  await assert.rejects(()=>repo.saveGoal(learner,'C1302',{...goal,trackCode:'management'}));
  await assert.rejects(()=>repo.saveGoal(learner,'C1302',{...goal,currentLevelCode:'Staff'}));
  await rejectSql(`UPDATE praxis.learner_career_level_goal SET market_code='MA' WHERE learner_id=$1`,[learner],/foreign key/);
  await rejectSql(`UPDATE praxis.career_level SET label_fr='Tampered' WHERE framework_id=$1`,[fr],/Only draft/);
  await rejectSql(`UPDATE praxis.career_framework SET title_fr='Tampered' WHERE id=$1`,[fr],/immutable/);
  await rejectSql(`DELETE FROM praxis.career_framework_review WHERE framework_id=$1`,[fr],/immutable|append.only/i);
  await repo.savePreference(learner,{marketCode:'MA',trackCode:null});
  const maroc=await repo.forOccupation(learner,'C1302');assert.equal(maroc.frameworks[0].framework.id,ma);assert.equal(maroc.goal,null);
  await assert.rejects(()=>repo.saveGoal(learner,'C1302',goal),'No French framework in Moroccan selection');
  await repo.savePreference(learner,{marketCode:'FR',trackCode:'management'});
  assert.equal((await repo.forOccupation(learner,'C1302')).previousGoalUnavailable,true);
  await repo.savePreference(learner,{marketCode:'FR',trackCode:null});
  assert.deepEqual((await repo.forOccupation(learner,'C1302')).goal,goal);
  assert.equal((await repo.clearGoal(learner,'C1302')).goal,null);
  await repo.saveGoal(learner,'C1302',goal);
  await client.query(`UPDATE praxis.career_framework SET status='retired' WHERE id=$1`,[fr]);
  const retired=await repo.forOccupation(learner,'C1302');assert.equal(retired.availability,'unavailable');assert.equal(retired.goal,null);assert.equal(retired.previousGoalUnavailable,true);
  assert.equal((await repo.clearGoal(learner,'C1302')).previousGoalUnavailable,false);
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});
