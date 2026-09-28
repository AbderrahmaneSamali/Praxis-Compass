import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createLearnerServer} from '../learner/server.mjs';

test('bounded agent runs use owned reports, persist validated tool traces, and cancel without saving advice',async()=>{
 assert.ok(process.env.PRAXIS_LEARNER_TEST_DATABASE_URL,'Dedicated test database required');
 const pool=new pg.Pool({connectionString:process.env.PRAXIS_LEARNER_TEST_DATABASE_URL});
 assert.match((await pool.query('select current_database() as n')).rows[0].n,/_test$/);
 let mode='normal';
 const provider=async(messages,signal)=>{
  if(mode==='slow')return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
  if(mode==='loop'||messages.length===2)return JSON.stringify({type:'tool',name:'get_targets',arguments:{}});
  const data=JSON.parse(messages.at(-1).content).toolResult.data;
  return JSON.stringify({type:'final',order:data.map(t=>t.code),focus:data.map(t=>({code:t.code,milestoneId:t.suggestedMilestones[0]?.id??null}))});
 };
 const server=createLearnerServer({pool,example:true,agentProvider:provider});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port,sessions=[];
 try{
  const session=async()=>{const response=await fetch(origin+'/api/bootstrap'),s={cookie:response.headers.get('set-cookie').split(';')[0],data:await response.json()};sessions.push(s);return s;};
  const first=await session(),other=await session();
  const post=(s,path,body,csrf=s.data.csrf)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,Cookie:s.cookie,'Content-Type':'application/json','X-Praxis-CSRF':csrf},body:JSON.stringify(body)});
  const get=(s,path)=>fetch(origin+path,{headers:{Cookie:s.cookie}});
  assert.equal((await post(first,'/api/profile',{currentRomeCode:'C1302',preferredDomainCode:'C13',confirmedInterestCodes:[]})).status,200);
  await post(first,'/api/career/preferences',{marketCode:'FR',trackCode:null});
  const reportResponse=await post(first,'/api/reports',{targetCodes:['C1302']});assert.equal(reportResponse.status,200,await reportResponse.clone().text());const report=await reportResponse.json();
  assert.equal((await (await get(first,'/api/agent-runs/history')).json()).available,true);
  assert.equal((await post(first,'/api/agent-runs',{reportId:report.id},'bad')).status,403);
  assert.equal((await post(other,'/api/agent-runs',{reportId:report.id})).status,404);
  assert.equal((await post(first,'/api/agent-runs',{reportId:report.id,sql:'SELECT'})).status,400);
  const started=await post(first,'/api/agent-runs',{reportId:report.id});assert.equal(started.status,202,await started.clone().text());const run=await started.json();
  let state;for(let i=0;i<30;i++){state=await (await get(first,'/api/agent-runs/'+run.id)).json();if(state.run.status==='completed')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(state.run.status,'completed');assert.equal(state.run.modelCalls,2);assert.equal(state.run.toolCalls,1);
  assert.equal(state.run.result.reportHash,report.contentHash);assert.equal(state.run.result.targets[0].code,'C1302');
  assert.equal(state.run.result.targets[0].focus?.id,report.snapshot.targets[0].plan.nextMilestoneIds[0]);
  assert.equal(state.run.result.targets[0].focus?.activityId,report.snapshot.targets[0].plan.milestones.find(m=>m.id===report.snapshot.targets[0].plan.nextMilestoneIds[0])?.activityId);
  assert.deepEqual(state.events.map(e=>e.kind),['queued','started','model_call','tool_call','model_call','completed']);
  assert.equal((await get(other,'/api/agent-runs/'+run.id)).status,404);
  const row=await pool.query('select result::text as result from praxis.career_agent_run where id=$1',[run.id]);assert.ok(!row.rows[0].result.includes('system'));
  mode='slow';const pending=await (await post(first,'/api/agent-runs',{reportId:report.id})).json();
  assert.equal((await post(first,'/api/agent-runs',{reportId:report.id})).status,409);
  const cancelled=await post(first,'/api/agent-runs/cancel',{runId:pending.id});assert.equal(cancelled.status,200);
  state=await (await get(first,'/api/agent-runs/'+pending.id)).json();assert.equal(state.run.status,'cancelled');assert.equal(state.run.result,null);
  assert.equal((await post(other,'/api/agent-runs/cancel',{runId:pending.id})).status,404);
  mode='loop';const over=await (await post(first,'/api/agent-runs',{reportId:report.id})).json();
  for(let i=0;i<30;i++){state=await (await get(first,'/api/agent-runs/'+over.id)).json();if(state.run.status==='failed')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(state.run.status,'failed');assert.equal(state.run.errorCode,'tool_budget_exceeded');
  assert.equal(state.run.modelCalls,4);assert.equal(state.run.toolCalls,3);assert.equal(state.run.result,null);
 }finally{
  await new Promise(r=>server.close(r));
  for(const s of sessions){const key=createHash('sha256').update(s.cookie.split('=')[1]).digest('hex');await pool.query('DELETE FROM praxis.learner WHERE id IN (SELECT learner_id FROM praxis.learner_session WHERE session_key=$1)',[key]);}
  await pool.end();
 }
});
