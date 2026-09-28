import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDevelopmentPlan,replayDevelopmentCase,DEVELOPMENT_CASE_SCHEMA} from '../dist/exploration/development-plan.js';
import {hashComputationInputs} from '../dist/kernel/computation-provenance.js';
import {ALGORITHM_VERSIONS} from '../dist/kernel/algorithm-versions.js';

const requirement=(id,ogr)=>({id,kind:'occupation',label:id,dimension:'skill',skillOgr:ogr,skillId:null,expectedBehavior:null,sourceId:'catalog',criteria:[]});
const activity=(id,ogrs,prerequisites=[])=>({id,version:1,title:id,status:'pilot',contentHash:id+'-hash',minutes:20,skillOgrs:ogrs,levelRequirementIds:[],sourceIds:['exercise-source'],prerequisites,criteria:[{code:'one',label:'Expected action',expectedBehavior:'Expected case outcome'}]});
const predecessor=id=>({code:'predecessor',kind:'activity_passed',requiredActivityId:id,skillOgr:null,label:id,rationale:'Explicit prerequisite',sourceId:'exercise-source'});
const confirmation=(ogr,response,id=ogr)=>({id,ogr,response,releaseId:'release',recordedAt:'2026-09-27',practiceContextId:response==='practiced'?'practice_context:work':null});
const attempt=(activityId,outcome,id=activityId)=>({id,activityId,title:activityId,contentHash:activityId+'-hash',outcome,submittedAt:'2026-09-27',metCount:outcome==='passed'?1:0,totalCount:1,results:[{criterionCode:'one',met:outcome==='passed'}]});
function fixture(){return {schemaVersion:DEVELOPMENT_CASE_SCHEMA,target:{codeRome:'C1302',title:'Operations',releaseId:'release',marketCode:'FR',marketLabel:'France',domainCode:'C13',trackCode:null},careerGoal:null,levelAvailability:'unavailable',
 requirements:[requirement('r1','1'),requirement('r2','2'),requirement('r3','3')],sources:[{id:'catalog',label:'Catalogue',reference:'release',status:'official_source'},{id:'exercise-source',label:'Case',reference:'case-v1',status:'pilot'}],
 confirmations:[],evidence:{adapterVersion:'adapter',selected:[],ignored:[],conflictingSkillIds:[],disagreements:[]},activities:[activity('first',['1']),activity('second',['2'],[predecessor('first')])],attempts:[]};}
const milestone=(plan,id)=>plan.milestones.find(m=>m.id===id);

test('unknown skills, missing activities and unconnected assessment remain explicit',()=>{
 const p=buildDevelopmentPlan(fixture());assert.equal(p.summary.unknown,3);assert.equal(p.summary.withoutActivity,1);
 assert.equal(milestone(p,'exercise:first').state,'ready');assert.equal(milestone(p,'exercise:second').state,'blocked');
 assert.deepEqual(milestone(p,'exercise:second').dependsOn,['exercise:first']);assert.equal(p.nextMilestoneIds[0],'exercise:first');
 assert.ok(p.gaps.every(g=>g.targetAssessment==='not_assessed'&&g.professionalMastery==='not_established'));
 assert.ok(p.milestones.filter(m=>m.kind==='assessment').every(m=>m.state==='unavailable'));assert.equal(p.readiness,'not_assessed');
 assert.equal(p.summary.remainingExerciseMinutes,40);
});
test('exercise passes unlock explicit successors and never convert unknowns to mastery',()=>{
 const i=fixture();i.attempts=[attempt('first','passed','p'),attempt('first','needs_practice','later')];
 const p=buildDevelopmentPlan(i);assert.equal(p.summary.unknown,3);assert.equal(p.summary.exercisesCompleted,1);
 assert.equal(milestone(p,'exercise:first').state,'completed');assert.equal(milestone(p,'exercise:second').state,'ready');
 assert.deepEqual(p.gaps.find(g=>g.id==='r1').exerciseAttemptIds,['later','p']);assert.equal(p.masteryEstablished,false);
 const bad=fixture();bad.attempts=[{...attempt('first','passed'),contentHash:'wrong-version'}];assert.equal(milestone(buildDevelopmentPlan(bad),'exercise:second').state,'blocked');
});
test('declarations, contradictions, independent assessments and inferences remain distinct',()=>{
 const i=fixture();i.confirmations=[confirmation('1','practiced'),confirmation('2','not_yet'),confirmation('3','practiced','a'),confirmation('3','unsure','b')];
 assert.deepEqual(buildDevelopmentPlan(i).gaps.map(g=>g.state),['declared_practice','development_needed','conflicting']);
 i.requirements.push({...requirement('r4',null),skillId:'praxis:exact'},{...requirement('r5',null),skillId:'praxis:inferred'},{...requirement('r6',null),skillId:'praxis:zero'});
 i.evidence.selected=[{id:'external',skillId:'praxis:exact',level:3,type:'human_validated',confidence:'high',observedAt:'2026-01-01',assessmentSessionId:null},
  {id:'inference',skillId:'praxis:inferred',level:3,type:'cv_experience_inferred',confidence:'medium_low',observedAt:'2026-01-01',assessmentSessionId:null},
  {id:'zero',skillId:'praxis:zero',level:0,type:'self_declared',confidence:'low',observedAt:'2026-01-01',assessmentSessionId:null}];
 const p=buildDevelopmentPlan(i);assert.equal(p.gaps[3].state,'evidence_available');assert.equal(p.gaps[3].targetAssessment,'not_assessed');assert.equal(p.gaps[4].state,'unknown');assert.equal(p.gaps[5].state,'development_needed');
 i.evidence.conflictingSkillIds=['praxis:exact'];assert.equal(buildDevelopmentPlan(i).gaps[3].state,'conflicting');
 i.confirmations[0].releaseId='old';assert.throws(()=>buildDevelopmentPlan(i),/another source release/);
});
test('practice prerequisites use direct confirmations; withdrawn predecessors stay unavailable',()=>{
 const i=fixture();i.activities[0].prerequisites=[{code:'practice',kind:'declared_practice',requiredActivityId:null,skillOgr:'3',label:'Practice',rationale:'Explicit',sourceId:'exercise-source'}];
 let p=buildDevelopmentPlan(i);assert.equal(milestone(p,'exercise:first').state,'needs_information');assert.equal(p.nextMilestoneIds[0],'clarify:r3');
 i.confirmations=[confirmation('3','not_yet')];assert.equal(milestone(buildDevelopmentPlan(i),'exercise:first').state,'blocked');
 i.confirmations=[confirmation('3','practiced')];assert.equal(milestone(buildDevelopmentPlan(i),'exercise:first').state,'ready');
 i.activities.shift();i.attempts=[attempt('first','passed')];p=buildDevelopmentPlan(i);assert.equal(milestone(p,'exercise:second').state,'unavailable');assert.equal(p.exerciseResults[0].currentlyAvailable,false);
});
test('only explicit activity edges create prerequisites; cycles and unproven career requirements are rejected',()=>{
 const i=fixture();i.activities=[activity('first',[],[]),activity('second',['2'],[predecessor('first')])];
 const p=buildDevelopmentPlan(i);assert.deepEqual(p.milestones.filter(m=>m.kind==='exercise').map(m=>m.id),['exercise:first','exercise:second']);
 i.activities[0].prerequisites=[predecessor('second')];assert.throws(()=>buildDevelopmentPlan(i),/Cyclic/);
 const draft=fixture();draft.requirements.push({...requirement('level',null),kind:'career_level'});assert.throws(()=>buildDevelopmentPlan(draft),/available goal/);
 draft.levelAvailability='selected';const plan=buildDevelopmentPlan(draft);assert.equal(plan.gaps.find(g=>g.id==='level').state,'unknown');
});
test('case survives JSON/database round trips, and replay detects input, output and version changes',()=>{
 const input=fixture(),plan=buildDevelopmentPlan(input),record={id:'case',createdAt:'2026-09-27',schemaVersion:DEVELOPMENT_CASE_SCHEMA,algorithmVersion:ALGORITHM_VERSIONS.developmentPlan,
  inputHash:hashComputationInputs(input),outputHash:hashComputationInputs(plan),input,plan};
 assert.equal(replayDevelopmentCase(JSON.parse(JSON.stringify(record))).verified,true);
 const reordered=structuredClone(input);reordered.requirements.reverse();reordered.activities.reverse();assert.deepEqual(buildDevelopmentPlan(reordered),plan);
 for(const change of [r=>r.input.confirmations.push(confirmation('1','practiced')),r=>r.plan.summary.unknown=0]){const r=structuredClone(record);change(r);assert.throws(()=>replayDevelopmentCase(r),/integrity mismatch/);}
 assert.throws(()=>replayDevelopmentCase({...record,algorithmVersion:'future'}),/Unsupported/);
 const corrupted=structuredClone(record);corrupted.plan.summary.unknown=0;corrupted.outputHash=hashComputationInputs(corrupted.plan);assert.throws(()=>replayDevelopmentCase(corrupted),/replay mismatch/);
});
