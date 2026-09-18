import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createLearnerServer} from '../learner/server.mjs';

test('learner screen stores levels, recomputes recommendations and isolates browser identities',async()=>{
 const url=process.env.PRAXIS_LEARNER_TEST_DATABASE_URL;
 assert.ok(url,'Set PRAXIS_LEARNER_TEST_DATABASE_URL to a migrated dedicated *_test database');
 const pool=new pg.Pool({connectionString:url,max:5}),info=await pool.query('SELECT current_database() AS name');
 assert.ok(info.rows[0].name.endsWith('_test'));const server=createLearnerServer({pool,example:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const sessions=[];
 try{
  const bootstrap=async()=>{const response=await fetch(`${origin}/api/bootstrap`),data=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];sessions.push(cookie);return {data,cookie};};
  const first=await bootstrap(),other=await bootstrap();assert.ok(first.data.goals.length>0);assert.notEqual(first.cookie,other.cookie);
  const id=first.data.goals.find(g=>g.id==='occupation_esco_d3edb8f83a0647a08fb99b212c006aa2')?.id??first.data.goals[0].id;
  const input={occupationId:id,constraints:{hoursPerWeek:8,budgetMad:500,languages:['fr']}};
  const send=async(session,path,body,headers={})=>fetch(`${origin}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:session.cookie,'X-Praxis-CSRF':session.data.csrf,...headers},body:JSON.stringify(body)});
  const page=await fetch(origin);assert.equal(page.status,200);assert.match(await page.text(),/Votre prochain pas/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await send(first,'/api/recommendations',input,{'X-Praxis-CSRF':'bad'})).status,403);
  assert.equal((await send(first,'/api/recommendations',input,{Origin:'https://evil.example'})).status,403);
  let response=await send(first,'/api/recommendations',input),before=await response.json();assert.equal(response.status,200);assert.equal(before.result.status,'insufficient_profile');
  const skills=before.result.inputSnapshot.targetProfile.skills;
  const declarations=skills.map(skill=>({skillId:skill.skillId,level:0}));
  response=await send(first,'/api/levels',{...input,declarations});const after=await response.json();assert.equal(response.status,200,JSON.stringify(after));
  assert.equal(after.result.missingSkillIds.length,0);assert.ok(after.result.evidenceProfile.selectedEvidence.every(e=>e.level===0 && e.confidence==='low'));
  assert.ok(after.result.recommendations.length>0,'Dedicated fixture offers are needed to exercise eligible course results');
  assert.equal((await send(first,'/api/levels',{...input,declarations:[{skillId:skills[0].skillId,level:2,workExample:'x'}]})).status,400);
  assert.equal((await send(first,'/api/levels',{...input,declarations:[{skillId:'foreign-skill',level:1,workExample:'example'}]})).status,400);
  response=await send(first,'/api/levels',{...input,declarations:[{skillId:skills[0].skillId,level:1,workExample:'J’ai réalisé une tâche avec guidage.'}]});assert.equal(response.status,200);
  const revised=await response.json();assert.equal(revised.result.evidenceProfile.selectedEvidence.find(e=>e.skillId===skills[0].skillId).level,1);
  assert.ok(revised.result.evidenceProfile.ignoredEvidence.some(e=>e.reason==='superseded'));
  const secondResult=await (await send(other,'/api/recommendations',input)).json();assert.equal(secondResult.result.status,'insufficient_profile');
  assert.equal((await send(other,'/api/impressions',{requestId:revised.result.requestId})).status,400);
  const writes=await Promise.all([send(first,'/api/impressions',{requestId:revised.result.requestId}),send(first,'/api/impressions',{requestId:revised.result.requestId})]);assert.ok(writes.every(r=>r.status===200));
  const stored=await pool.query('SELECT is_example,input_snapshot FROM praxis.recommendation_impression WHERE id=$1',[revised.result.requestId]);assert.equal(stored.rows[0].is_example,true);
  assert.deepEqual(stored.rows[0].input_snapshot,revised.result.inputSnapshot);
  const restored=await (await fetch(`${origin}/api/bootstrap`,{headers:{Cookie:first.cookie}})).json();assert.equal(restored.occupationId,id);assert.equal(restored.constraints.budgetMad,500);
  const poor=await (await send(first,'/api/recommendations',{...input,constraints:{...input.constraints,budgetMad:0}})).json();assert.equal(poor.result.recommendations.length,0);
  const changedPreferences=await (await fetch(`${origin}/api/bootstrap`,{headers:{Cookie:first.cookie}})).json();assert.equal(changedPreferences.constraints.budgetMad,0);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  // Clean only learners created by this test, preserving the dedicated preview data.
  for(const cookie of sessions){const token=cookie.split('=')[1];const {createHash}=await import('node:crypto');const key=createHash('sha256').update(token).digest('hex');await pool.query('DELETE FROM praxis.learner WHERE id IN (SELECT learner_id FROM praxis.learner_session WHERE session_key=$1)',[key]);}
  await pool.end();
 }
});
