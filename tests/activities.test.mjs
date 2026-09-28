import test from 'node:test';
import assert from 'node:assert/strict';
import {activityDrafts} from '../database/development-activities.mjs';
import {gradeActivity,resolveActivityPrerequisites,activityContentHash,validateActivity} from '../dist/exploration/activities.js';

function bundle(a=activityDrafts[0]){
 return {activity:{id:a.key+'-v1',key:a.key,version:1,title:a.title,purpose:a.purpose,output:a.output,limitations:'Fictional test only',minutes:a.minutes,materials:a.materials,author:'test',status:'draft',reviewer:null,reviewedAt:null,contentHash:null},
 sources:[{id:'case'}],scopes:a.codes.map(codeRome=>({codeRome,marketCode:'FR',sourceId:'case'})),skills:[{ogr:a.ogr,sourceId:'case'}],steps:a.steps.map((instruction,i)=>({code:'s'+i,position:i+1,instruction})),prerequisites:[],levelTargets:[],
 criteria:a.criteria.map((c,i)=>({...c,position:i+1,sourceId:'case'})),options:a.criteria.flatMap(c=>c.options.map((o,i)=>({...o,criterionCode:c.code,position:i+1})))};
}
test('six original cases have deterministic checked answer keys and explicit pedagogical prerequisites',()=>{
 const expected={
  'credit-evidence':['1000','commitments','request'],'credit-sensitivity':['200','negative200','analyse'],
  'market-reconciliation':['90','absent','two'],'market-correction':['980','check','separate'],
  'agency-team-plan':['split','30','replan'],'market-quality':['10','75','test'],
 };
 assert.equal(4000-3000,1000);assert.equal(4000-2500-500-800,200);assert.equal(3600-2500-500-800,-200);
 assert.equal(980-890,90);assert.equal(120-60-30,30);assert.equal(80-30,50);assert.equal(20/200*100,10);assert.equal(15/20*100,75);
 for(const a of activityDrafts){const b=bundle(a);assert.deepEqual(validateActivity(b),[]);const answers=a.criteria.map((c,i)=>({criterionCode:c.code,optionCode:expected[a.key][i]}));
  const r=gradeActivity(b,answers);assert.equal(r.outcome,'passed',a.key);assert.equal(r.metCount,3);assert.equal(r.masteryEstablished,false);assert.equal(r.evidenceKind,'exercise_result');
  assert.equal(gradeActivity(b,a.criteria.map(c=>({criterionCode:c.code,optionCode:'unknown'}))).outcome,'needs_practice');
 }
 assert.equal(activityDrafts.find(a=>a.key==='market-quality').prerequisite,'market-correction');
 assert.equal(activityDrafts.find(a=>a.key==='market-correction').prerequisite,'market-reconciliation');
});
test('grading rejects missing, duplicate, invented and caller-scored answers',()=>{
 const b=bundle(),answers=b.criteria.map(c=>({criterionCode:c.code,optionCode:'unknown'}));
 for(const input of [null,{},[],answers.slice(1),[answers[0],answers[0],answers[0]],answers.map(a=>({...a,met:true})),answers.map(a=>({...a,optionCode:'invented'}))])assert.throws(()=>gradeActivity(b,input));
 const mixed=gradeActivity(b,[{criterionCode:'missing',optionCode:'commitments'},{criterionCode:'next',optionCode:'approve'},{criterionCode:'remainder',optionCode:'unknown'}]);
 assert.equal(mixed.outcome,'needs_practice');assert.equal(mixed.metCount,1);assert.equal(mixed.results[0].criterionCode,'remainder');
});
test('unknown practice and unavailable prerequisites stay explicit; taxonomy relationships do not unlock tasks',()=>{
 const prerequisites=[{code:'p',kind:'activity_passed',requiredActivityId:'intro',skillOgr:null},{code:'s',kind:'declared_practice',requiredActivityId:null,skillOgr:'123'}];
 let r=resolveActivityPrerequisites(prerequisites,new Set(),new Set(['intro']),new Map());assert.deepEqual(r.map(p=>p.state),['unmet','unknown']);
 r=resolveActivityPrerequisites(prerequisites,new Set(['intro']),new Set(['intro']),new Map([['123','practiced']]));assert.deepEqual(r.map(p=>p.state),['met','met']);assert.match(r[1].explanation,/sans preuve/);
 r=resolveActivityPrerequisites(prerequisites,new Set(['intro']),new Set(),new Map([['123','not_yet']]));assert.deepEqual(r.map(p=>p.state),['unavailable','unmet']);
 r=resolveActivityPrerequisites(prerequisites,new Set(['parent-topic']),new Set(['intro']),new Map([['123','conflicting']]));assert.deepEqual(r.map(p=>p.state),['unmet','unknown']);
});
test('activity validation and hashes bind materials, steps and assessment feedback',()=>{
 const b=bundle(),hash=activityContentHash(b);b.activity.status='pilot';b.activity.contentHash=hash;assert.equal(activityContentHash(b),hash);
 b.options[0].feedback='Changed feedback';assert.notEqual(activityContentHash(b),hash);
 b.options=b.options.filter(o=>o.isCorrect);assert.ok(validateActivity(b).some(x=>x.includes('incorrect choices')));
 b.activity.materials={intro:'test',columns:['a'],rows:[['too','many']]};assert.ok(validateActivity(b).some(x=>x.includes('case data')));
});
