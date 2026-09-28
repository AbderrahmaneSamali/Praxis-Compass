// Reproducible, isolated journey evaluation over the real catalog and pilot exercises.
// It creates temporary learners in a dedicated *_test database and deletes them afterward.
import 'dotenv/config';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import pg from 'pg';
import {createLearnerServer} from '../../learner/server.mjs';
import {nvidiaProvider} from '../../dist/index.js';
import {ALGORITHM_VERSIONS} from '../../dist/kernel/algorithm-versions.js';
import {gradeJourney,gradeProgression,journeyChecks,summarize,blindComparisons} from './oracle.mjs';

const cases=[
 {id:'fr-banking-credit',market:'FR',domain:'C12',origin:'C1202',target:'C1202',activity:'credit-evidence-v1'},
 {id:'ma-banking-credit',market:'MA',domain:'C12',origin:'C1202',target:'C1202',activity:'credit-evidence-v1'},
 {id:'fr-banking-team',market:'FR',domain:'C12',origin:'C1207',target:'C1207',activity:'agency-team-plan-v1'},
 {id:'ma-banking-team',market:'MA',domain:'C12',origin:'C1207',target:'C1207',activity:'agency-team-plan-v1'},
 {id:'fr-finance-operations',market:'FR',domain:'C13',origin:'C1302',target:'C1302',activity:'market-reconciliation-v1',progress:true},
 {id:'ma-finance-operations',market:'MA',domain:'C13',origin:'C1302',target:'C1302',activity:'market-reconciliation-v1',progress:true},
];
const nextAfterMarketReconciliation='market-correction-v1';
const pct=(a,b)=>b?`${(100*a/b).toFixed(0)}%`:'—';
const testUrl=()=>{
 const source=process.env.PRAXIS_LEARNER_TEST_DATABASE_URL??process.env.DATABASE_URL;
 if(!source)throw new Error('Configure PRAXIS_LEARNER_TEST_DATABASE_URL or DATABASE_URL');
 const url=new URL(source);
 if(!process.env.PRAXIS_LEARNER_TEST_DATABASE_URL)url.pathname='/praxis_rome_test';
 if(!decodeURIComponent(url.pathname).endsWith('_test'))throw new Error('Journey evaluation requires a dedicated *_test database');
 return url.toString();
};

async function run(){
 const withNvidia=process.argv.includes('--with-nvidia');
 if(withNvidia&&!process.env.NVIDIA_API_KEY)throw new Error('Set NVIDIA_API_KEY before requesting a live comparison');
 const pool=new pg.Pool({connectionString:testUrl(),max:5});
 let database;
 try{database=(await pool.query('SELECT current_database() AS name')).rows[0].name;
  if(!database.endsWith('_test'))throw new Error('Refusing to create evaluation learners outside a test database');
 }catch(error){await pool.end();throw error;}
 const server=createLearnerServer({pool,example:true,agentProvider:withNvidia?nvidiaProvider(process.env.NVIDIA_API_KEY):null});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,sessions=[],rows=[],guardChecks=[],comparisons=[];
 const start=async()=>{
  const response=await fetch(origin+'/api/bootstrap');
  if(!response.ok)throw new Error(`Bootstrap failed: ${response.status}`);
  const session={cookie:response.headers.get('set-cookie').split(';')[0],csrf:null};
  sessions.push(session);session.csrf=(await response.json()).csrf;return session;
 };
 const post=async(session,path,body)=>{
  const response=await fetch(origin+path,{method:'POST',headers:{Origin:origin,Cookie:session.cookie,'Content-Type':'application/json','X-Praxis-CSRF':session.csrf},body:JSON.stringify(body)});
  const payload=await response.json();return {status:response.status,payload};
 };
 const must=async(session,path,body)=>{
  const result=await post(session,path,body);
  if(result.status!==200)throw new Error(`${path}: ${result.status} ${JSON.stringify(result.payload).slice(0,300)}`);
  return result.payload;
 };
 const get=async(session,path)=>{const response=await fetch(origin+path,{headers:{Cookie:session.cookie}});return {status:response.status,payload:await response.json()};};
 const guard=(name,passed)=>guardChecks.push({name,passed:Boolean(passed)});
 try{
  const releases=(await pool.query("SELECT id FROM praxis.source_releases WHERE source='rome' AND is_active ORDER BY id")).rows.map(x=>x.id);
  if(releases.length!==1)throw new Error('Exactly one active source release is required');
  for(const scenario of cases){
   const session=await start();
   await must(session,'/api/profile',{currentRomeCode:scenario.origin,preferredDomainCode:scenario.domain,confirmedInterestCodes:[]});
   await must(session,'/api/career/preferences',{marketCode:scenario.market,trackCode:null});
   const report=await must(session,'/api/reports',{targetCodes:[scenario.target]});
   const expectedCount=(await pool.query(`SELECT count(DISTINCT d.code_rome)::int AS count FROM praxis.rome_occupation_professional_domains d
    WHERE d.release_id=$1 AND d.domain_code=$2`,[releases[0],scenario.domain])).rows[0].count;
   const row=gradeJourney(scenario,report,expectedCount);
   guard(scenario.id+'-cross-domain-report-rejected',(await post(session,'/api/reports',{targetCodes:[scenario.domain==='C12'?'C1302':'C1202']})).status===404);
   const drafts=(await pool.query(`SELECT f.id,l.code,l.track_code FROM praxis.career_framework f
    JOIN praxis.career_level l ON l.framework_id=f.id JOIN praxis.career_level_occupation o ON o.framework_id=f.id AND o.level_code=l.code
    WHERE f.status='draft' AND f.market_code=$1 AND o.code_rome=$2 ORDER BY f.id,l.code LIMIT 1`,[scenario.market,scenario.target])).rows;
   if(!drafts.length)throw new Error('Expected draft fixture is missing; seed career drafts in the test database');
   const draft=drafts[0];guard(scenario.id+'-draft-goal-rejected',(await post(session,'/api/career/goal',{
    codeRome:scenario.target,frameworkId:draft.id,trackCode:draft.track_code,targetLevelCode:draft.code,currentLevelCode:null})).status>=400);
   if(withNvidia&&scenario.progress){
    const multi=await must(session,'/api/reports',{targetCodes:['C1302','C1301','C1303']});
    const started=await post(session,'/api/agent-runs',{reportId:multi.id});
    if(started.status!==202)throw new Error('Live agent could not start');
    let state;
    for(let i=0;i<130;i++){
     state=(await get(session,'/api/agent-runs/'+started.payload.id)).payload.run;
     if(['completed','failed','cancelled'].includes(state.status))break;
     await new Promise(resolve=>setTimeout(resolve,500));
    }
    const targetCodes=multi.snapshot.targets.map(t=>t.code);
    const priority=multi.snapshot.recommendations.map(r=>r.directionId.replace(/^rome:/,'')).filter(code=>targetCodes.includes(code));
    const baselineOrder=[...priority,...targetCodes.filter(code=>!priority.includes(code))];
    comparisons.push({caseId:scenario.id,market:scenario.market,status:state.status,modelCalls:state.modelCalls,toolCalls:state.toolCalls,
     baseline:baselineOrder.map(code=>{const t=multi.snapshot.targets.find(t=>t.code===code),focus=t.plan.milestones.find(m=>m.id===t.plan.nextMilestoneIds[0]);return {code:t.code,title:t.plan.target.title,focus:focus?.label??null};}),
     assistant:state.result?.targets.map(t=>({code:t.code,title:t.title,focus:t.focus?.label??null}))??null,errorCode:state.errorCode,
     reportFacts:{profile:multi.snapshot.profile,targets:multi.snapshot.targets.map(t=>({code:t.code,summary:t.plan.summary,notices:t.plan.notices,
      sources:t.input.sources.map(s=>({label:s.label,reference:s.reference})),
      availableActions:t.plan.milestones.filter(m=>m.state==='ready').map(m=>({kind:m.kind,label:m.label,explanation:m.explanation})),
      activities:t.activities.map(a=>({title:a.title,purpose:a.purpose,materials:a.materials,steps:a.steps,prerequisites:a.prerequisites,criteria:a.criteria,limitations:a.limitations}))}))}});
   }
   if(scenario.progress){
    const base={codeRome:scenario.target,marketCode:scenario.market,activityId:scenario.activity};
    await must(session,'/api/activities/start',base);
    const answer=await must(session,'/api/activities/submit',{...base,requestKey:randomUUID(),answers:[
     {criterionCode:'difference',optionCode:'90'},{criterionCode:'missing',optionCode:'absent'},{criterionCode:'batch',optionCode:'two'}]});
    const progressed=await must(session,'/api/reports',{targetCodes:[scenario.target]});
    row.progress=gradeProgression(row,progressed,answer,nextAfterMarketReconciliation);
    const otherMarket=scenario.market==='FR'?'MA':'FR';
    await must(session,'/api/career/preferences',{marketCode:otherMarket,trackCode:null});
    const changed=await must(session,'/api/reports',{targetCodes:[scenario.target]});
    const newPlan=changed.snapshot.targets[0].plan;
    guard(scenario.id+'-exercise-does-not-transfer-market',newPlan.summary.exercisesCompleted===0&&newPlan.summary.unknown===row.unknownCount);
    guard(scenario.id+'-successor-blocked-in-other-market',(await post(session,'/api/activities/start',{...base,marketCode:otherMarket,activityId:nextAfterMarketReconciliation})).status===409);
    const historical=(await get(session,'/api/reports/'+progressed.id)).payload;
    guard(scenario.id+'-historical-market-frozen',historical.contentHash===progressed.contentHash&&historical.snapshot.profile.marketCode===scenario.market&&historical.snapshot.targets[0].plan.summary.exercisesCompleted===1);
   }
   rows.push(row);
  }
  const unset=await start();
  await must(unset,'/api/profile',{currentRomeCode:'C1302',preferredDomainCode:'C13',confirmedInterestCodes:[]});
  const missing=await must(unset,'/api/reports',{targetCodes:['C1302']});
  const missingPlan=missing.snapshot.targets[0].plan;
  guard('missing-market-first-step-is-country',missingPlan.nextMilestoneIds[0]==='context:market');
  guard('missing-market-no-exercises',missingPlan.summary.exercises===0&&missing.snapshot.targets[0].activities.length===0);
  guard('missing-market-no-level',missingPlan.levelAvailability==='market_required'&&missingPlan.careerGoal===null);
  await must(unset,'/api/profile',{currentRomeCode:'C1202',preferredDomainCode:'C13',confirmedInterestCodes:[]});
  await must(unset,'/api/career/preferences',{marketCode:'MA',trackCode:null});
  const outsideOrigin=await must(unset,'/api/reports',{targetCodes:['C1302']});
  guard('starting-occupation-outside-domain-excluded',!outsideOrigin.snapshot.candidates.some(c=>c.code==='C1202')&&!outsideOrigin.snapshot.recommendations.some(r=>r.directionId==='rome:C1202'));
  const metrics=summarize(rows,guardChecks),{safetyPassed,safetyTotal,targetInTopFive:topFive}=metrics;
  const report={kind:'career_journey_evaluation',version:1,generatedAt:new Date().toISOString(),sourceRelease:releases[0],
   algorithmVersions:ALGORITHM_VERSIONS,
   scope:'Fictional learner journeys over the real occupation catalog and PRAXIS pilot exercises in an isolated test database. No real learner outcomes. NVIDIA calls occur only with --with-nvidia.',
   predefinedCases:cases.map(({id,market,domain,origin,target,activity,progress})=>({id,market,domain,origin,target,activity,progress:Boolean(progress)})),
   metrics,
   decision:{specialistAgents:'defer',reason:'No independently labelled learner usefulness judgments; safety and catalog coverage alone cannot establish improvement.'},rows,guardChecks,comparisons};
  const lines=[`# Career journey evaluation`,
   '',report.scope,``, `Source release: ${releases[0]}.`,
   `Safety and source checks: **${safetyPassed}/${safetyTotal} (${pct(safetyPassed,safetyTotal)})**.`,
   `Chosen occupation visible in top five: **${topFive}/${rows.length} (${pct(topFive,rows.length)})**.`,
   `Exercise progression journeys: **${report.metrics.progressionPassed}/${report.metrics.progressionCount}**.`,
   '', '| Journey | Candidates | Top five | First action | Safety checks |', '|---|---:|:---:|---|:---:|',
   ...rows.map(row=>`| ${row.id} | ${row.candidateCount}/${row.expectedCount} | ${row.flags.targetInTopFive?'yes':'no'} | ${row.firstStep.kind??'none'}: ${row.firstStep.label??'none'} | ${journeyChecks.every(k=>row.flags[k])&&(!row.progress||Object.values(row.progress).every(Boolean))?'pass':'FAIL'} |`),
   '', `Boundary checks: ${guardChecks.filter(c=>c.passed).length}/${guardChecks.length}.`,
   `Live assistant comparisons: ${comparisons.filter(c=>c.status==='completed').length}/${comparisons.length}; ${comparisons.reduce((n,c)=>n+c.modelCalls,0)} model requests.`,
   '', '## Decision', '', 'Defer specialist agents. This benchmark measures scope, action availability, progression, and claim safety. It does not measure whether an LLM improves the ranking or advice for people. A live provider and independently labelled usefulness judgments are required for that comparison.',
   '', 'France and Morocco career-level frameworks remain drafts. The same fictional pilot exercises are available in both markets and do not establish regulatory or professional equivalence.',
   ''];
  const out=new URL('./out/',import.meta.url);await mkdir(out,{recursive:true});
  await writeFile(new URL('latest.json',out),JSON.stringify(report,null,2));await writeFile(new URL('latest.md',out),lines.join('\n'));
  if(withNvidia){const blind=blindComparisons(comparisons);
   await writeFile(new URL('review-pairs.json',out),JSON.stringify(blind.review,null,2));
   await writeFile(new URL('comparison-key.json',out),JSON.stringify(blind.key,null,2));}
  console.log(lines.join('\n'));
  if(safetyPassed!==safetyTotal||topFive!==rows.length||comparisons.some(c=>c.status!=='completed'))process.exitCode=1;
 }finally{
  await new Promise(resolve=>server.close(resolve));
  try{for(const s of sessions){
    const key=createHash('sha256').update(s.cookie.split('=')[1]).digest('hex');
    const owner=(await pool.query('SELECT learner_id FROM praxis.learner_session WHERE session_key=$1',[key])).rows[0]?.learner_id;
    if(owner)await pool.query('DELETE FROM praxis.learner WHERE id=$1',[owner]);
   }}finally{await pool.end();}
 }
}
await run();
