import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createLearnerServer} from '../learner/server.mjs';

test('learner screen stores levels, recomputes recommendations and isolates browser identities',async()=>{
 const url=process.env.PRAXIS_LEARNER_TEST_DATABASE_URL;
 assert.ok(url,'Set PRAXIS_LEARNER_TEST_DATABASE_URL to a migrated dedicated *_test database');
 const pool=new pg.Pool({connectionString:url,max:5}),info=await pool.query('SELECT current_database() AS name');
 assert.ok(info.rows[0].name.endsWith('_test'));const server=createLearnerServer({pool,example:true,
  aiProvider:async request=>({proposals:[{skillId:request.allowedSkills[0].skillId,supportingText:'analyse de données',level:4}]})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const sessions=[];
 try{
  const bootstrap=async()=>{const response=await fetch(`${origin}/api/bootstrap`),data=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];sessions.push(cookie);return {data,cookie};};
  const first=await bootstrap(),other=await bootstrap();assert.ok(first.data.goals.length>0);assert.notEqual(first.cookie,other.cookie);
  const id=first.data.goals.find(g=>g.id==='occupation_esco_d3edb8f83a0647a08fb99b212c006aa2')?.id??first.data.goals[0].id;
  const input={occupationId:id,constraints:{hoursPerWeek:8,budgetMad:500,languages:['fr']}};
  const send=async(session,path,body,headers={})=>fetch(`${origin}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:session.cookie,'X-Praxis-CSRF':session.data.csrf,...headers},body:JSON.stringify(body)});
  const page=await fetch(origin);assert.equal(page.status,200);assert.match(await page.text(),/Plusieurs voies/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const exploreEmpty=await (await send(first,'/api/explore',{})).json();
  assert.equal(exploreEmpty.possibilities.length,0,'ROME directions need a chosen origin or confirmed interest');
  assert.ok(exploreEmpty.questions.length>0);
  const origins=await (await fetch(`${origin}/api/rome/origins?q=data%20scientist`,{headers:{Cookie:first.cookie}})).json();
  assert.ok(origins.origins.some(item=>item.codeRome==='M1405'));
  const profileResponse=await send(first,'/api/profile',{currentRomeCode:'M1405',confirmedInterestCodes:[],experience:'J’ai préparé une analyse de données pour mon équipe.',interests:'données',constraints:'Temps limité'});
  assert.equal(profileResponse.status,200);
  const explored=await (await send(first,'/api/explore',{})).json();
  assert.ok(explored.possibilities.length>=2,'ROME mobility directions should be available');
  assert.ok(explored.possibilities[0].requirements.some(r=>r.state==='unknown'));
  const choice=explored.possibilities[0],secondChoice=explored.possibilities[1];
  assert.equal(choice.reasons[0].kind,'rome_mobility');
  assert.ok(choice.requirements.every(r=>r.targetLevel===null));
  const proposals=await (await send(first,'/api/profile/proposals',{})).json();
  assert.equal(proposals.proposals.length,1);assert.equal(proposals.proposals[0].level,undefined);
  assert.equal((await send(first,'/api/profile/confirmations',{proposalId:proposals.proposalId,confirmed:false,
   declarations:[{skillId:proposals.proposals[0].skillId,level:4,workExample:'J’ai préparé une analyse.'}]})).status,400);
  const compare=await (await send(first,'/api/directions/compare',{ids:[choice.id,secondChoice.id]})).json();
  assert.equal(compare.directions.length,2);assert.deepEqual(compare.directions[0].requirements,choice.requirements);
  assert.equal(compare.requirementsComparison.jobs.length,2);
  const gatewayResponse=await send(first,'/api/agent-gateway/compare',{ids:[choice.id,secondChoice.id]});
  assert.equal(gatewayResponse.status,200,await gatewayResponse.clone().text());
  const gateway=await gatewayResponse.json();
  assert.equal(gateway.directions.length,2);assert.equal(gateway.policyVersion,'praxis-agent-gateway-v1');
  assert.ok(gateway.directions[0].sources.every(source=>source.reviewStatus==='official_source'||source.reviewStatus==='reviewed'));
  assert.ok(!JSON.stringify(gateway).includes('J’ai préparé une analyse de données'));
  assert.equal((await send(first,'/api/agent-gateway/compare',{ids:[choice.id,choice.id]})).status,400);
  assert.equal((await send(other,'/api/agent-gateway/compare',{ids:[choice.id,secondChoice.id]})).status,400,
    'Another learner cannot compare directions absent from their own candidate set');
  assert.equal((await send(first,'/api/agent-gateway/compare',{ids:[choice.id,secondChoice.id],learnerId:'foreign'})).status,400);
  const audits=await pool.query(`SELECT r.outcome,r.tool_count,t.tool_name FROM praxis.agent_gateway_request r
    LEFT JOIN praxis.agent_gateway_tool_call t ON t.request_id=r.id WHERE r.id=$1 ORDER BY t.sequence`,[gateway.requestId]);
  assert.equal(audits.rows.length,4);assert.ok(audits.rows.every(row=>row.outcome==='succeeded'&&row.tool_count===4));
  assert.deepEqual(audits.rows.map(row=>row.tool_name),
    ['get_candidate_directions','get_requirement_states','get_reviewed_sources','get_career_context']);
  assert.equal((await send(first,'/api/exploration/saved',{directionId:choice.id,saved:true})).status,200);
  assert.equal((await send(first,'/api/development-actions/selected',{directionId:choice.id,actionId:choice.startingActions[0].id})).status,200);
  const requirement=choice.requirements[0];
  assert.equal((await send(first,'/api/rome/confirmations',{codeRome:choice.romeCode,ogr:requirement.romeOgr,response:'practiced',workExample:'J’ai appliqué cette compétence dans un projet réel.'})).status,200);
  const own=await (await send(first,'/api/explore',{})).json(),foreign=await (await send(other,'/api/explore',{})).json();
  assert.ok(own.possibilities.find(d=>d.id===choice.id).saved);
  assert.ok(own.selectedActions.includes(choice.startingActions[0].id));
  assert.equal(own.possibilities.find(d=>d.id===choice.id).requirements.find(r=>r.romeOgr===requirement.romeOgr).state,'supported');
  assert.equal((await send(first,'/api/rome/confirmations',{codeRome:choice.romeCode,ogr:requirement.romeOgr,response:'practiced',workExample:'x'})).status,400);
  assert.equal((await send(first,'/api/rome/confirmations',{codeRome:choice.romeCode,ogr:'999999999',response:'practiced',workExample:'Une pratique réelle.'})).status,400);
  assert.equal((await send(first,'/api/rome/confirmations',{codeRome:choice.romeCode,ogr:requirement.romeOgr,response:'not_yet',workExample:''})).status,200);
  const revisedRome=await (await send(first,'/api/explore',{})).json();
  assert.equal(revisedRome.possibilities.find(d=>d.id===choice.id).requirements.find(r=>r.romeOgr===requirement.romeOgr).state,'development_needed');
  assert.ok(!foreign.possibilities.some(d=>d.id===choice.id));
  assert.ok(!foreign.selectedActions.includes(choice.startingActions[0].id));
  assert.equal(foreign.profile.experience,'');
  assert.equal(own.evidence.selectedEvidence.length,0,'Selecting an action does not establish mastery');
  assert.equal((await send(first,'/api/feedback',{directionId:choice.id,useful:true,comment:'Utile'})).status,200);
  const interests=await (await fetch(`${origin}/api/rome/interests`,{headers:{Cookie:other.cookie}})).json();
  assert.ok(interests.interests.length===30);
  assert.equal((await send(other,'/api/profile',{currentRomeCode:null,confirmedInterestCodes:[interests.interests[0].code],experience:'',interests:'',constraints:''})).status,200);
  const interestOnly=await (await send(other,'/api/explore',{})).json();
  assert.ok(interestOnly.possibilities.some(d=>d.reasons.some(r=>r.kind==='rome_interest_centre')));
  assert.equal((await send(first,'/api/recommendations',input,{'X-Praxis-CSRF':'bad'})).status,403);
  assert.equal((await send(first,'/api/recommendations',input,{Origin:'https://evil.example'})).status,403);
  let response=await send(first,'/api/recommendations',input),before=await response.json();assert.equal(response.status,200);assert.equal(before.result.status,'insufficient_profile');
  const skills=before.result.inputSnapshot.targetProfile.skills;
  const declarations=skills.map(skill=>({skillId:skill.skillId,level:0}));
  response=await send(first,'/api/levels',{...input,declarations});const after=await response.json();assert.equal(response.status,200,JSON.stringify(after));
  assert.equal(after.result.missingSkillIds.length,0);assert.ok(after.result.evidenceProfile.selectedEvidence.every(e=>e.level===0 && e.confidence==='low'));
  assert.equal(own.possibilities[0].requirements[0].targetLevel,null,'ROME exploration does not infer a course-linked target level');
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
  const startedResponse=await send(first,'/api/context-survey/start',{});assert.equal(startedResponse.status,200);
  let survey=(await startedResponse.json()).survey;assert.equal(survey.question.id,'motivation');
  assert.equal((await send(other,'/api/context-survey/back',{sessionId:survey.sessionId})).status,404);
  const surveyAnswer=async(questionId,value,declined=false)=>{const response=await send(first,'/api/context-survey/answer',{sessionId:survey.sessionId,questionId,...(declined?{declined:true}:{value})});assert.equal(response.status,200,await response.clone().text());survey=(await response.json()).survey;};
  await surveyAnswer('motivation','employer_required');assert.equal(survey.question.id,'deadline');
  await surveyAnswer('deadline','none');assert.equal(survey.question.id,'hours_per_week');
  await surveyAnswer('hours_per_week','2');assert.equal(survey.question.id,'practice_level');
  await surveyAnswer('practice_level','occasionally');assert.equal(survey.question.id,'recent_work_example');
  await surveyAnswer('recent_work_example',undefined,true);assert.equal(survey.question,null);
  let surveyResponse=await send(first,'/api/context-survey/back',{sessionId:survey.sessionId});assert.equal(surveyResponse.status,200);survey=(await surveyResponse.json()).survey;assert.equal(survey.question.id,'recent_work_example');
  await surveyAnswer('recent_work_example','J’ai analysé les données de ventes et présenté les résultats à mon équipe.');
  const surveyTrace=await pool.query('SELECT id,undone_at FROM praxis.context_survey_answer WHERE session_id=$1 AND question_id=$2 ORDER BY sequence',[survey.sessionId,'recent_work_example']);
  assert.equal(surveyTrace.rows.length,2);assert.ok(surveyTrace.rows[0].undone_at);assert.equal(surveyTrace.rows[1].undone_at,null);
  await assert.rejects(pool.query('UPDATE praxis.context_survey_answer SET prompt_fr=$2 WHERE id=$1',[surveyTrace.rows[1].id,'Changed']),/immutable/);
  surveyResponse=await send(first,'/api/context-survey/complete',{sessionId:survey.sessionId});assert.equal(surveyResponse.status,200,await surveyResponse.clone().text());survey=(await surveyResponse.json()).survey;assert.equal(survey.status,'completed');
  assert.equal((await send(first,'/api/context-survey/complete',{sessionId:survey.sessionId})).status,400);
  const storedContext=await pool.query('SELECT context_version,motivation,situation,hours_per_week,budget_max_mad,languages,recent_work_example FROM praxis.learner_context WHERE id=$1',[survey.contextId]);
  assert.equal(storedContext.rows[0].context_version,'praxis-context-survey-v2');assert.equal(storedContext.rows[0].motivation,'employer_required');assert.equal(storedContext.rows[0].situation,'employed');assert.equal(Number(storedContext.rows[0].hours_per_week),2);
  assert.equal(Number(storedContext.rows[0].budget_max_mad),0,'unasked budget survives the context snapshot');assert.deepEqual(storedContext.rows[0].languages,['fr']);
  assert.match(storedContext.rows[0].recent_work_example,/ventes/);
  const contextualExplore=await (await send(first,'/api/explore',{})).json();assert.equal(contextualExplore.careerContext.hoursPerWeek,2);assert.equal(contextualExplore.careerContext.motivation,'employer_required');
  const contextualGateway=await (await send(first,'/api/agent-gateway/compare',{ids:[choice.id,secondChoice.id]})).json();
  assert.equal(contextualGateway.context.hoursPerWeek,2);
  assert.ok(!JSON.stringify(contextualGateway).includes('J’ai analysé les données de ventes'));
  const auditColumns=await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='praxis' AND table_name IN ('agent_gateway_request','agent_gateway_tool_call')`);
  assert.ok(!auditColumns.rows.some(row=>/example|prompt|content|profile|response_text/i.test(row.column_name)));
  const latest=await (await fetch(`${origin}/api/context-survey/latest`,{headers:{Cookie:first.cookie}})).json();assert.equal(latest.survey.status,'completed');
 }finally{
  await new Promise(resolve=>server.close(resolve));
  // Clean only learners created by this test, preserving the dedicated preview data.
  for(const cookie of sessions){const token=cookie.split('=')[1];const {createHash}=await import('node:crypto');const key=createHash('sha256').update(token).digest('hex');await pool.query('DELETE FROM praxis.learner WHERE id IN (SELECT learner_id FROM praxis.learner_session WHERE session_key=$1)',[key]);}
  await pool.end();
 }
});
