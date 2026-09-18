import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvidenceProfile,createAssessmentHandoff,StandaloneRecommendationRepository,hashComputationInputs} from '../dist/index.js';
import {now,learner,item,weights,skill} from './fixtures.mjs';

const context={learnerId:learner.learnerId,constraints:learner.constraints};
const row=(id,extra={})=>({id,learnerId:learner.learnerId,skillId:'a',level:1,evidenceType:'self_declared',confidence:'low',observedAt:now,supersededBy:null,provenance:{source:'test'},...extra});
const target={occupationId:'role',label:'Role',source:'authored',skills:[{skillId:'a',label:'A',targetLevel:3,importance:2,reviewed:true,targetLevelBasis:'authored'}]};
const options={now,explorationProbability:0};
const bank={skillId:'a',language:'fr',blueprintId:'bank',blueprintVersion:'v1',supportedLevels:[1,2,3]};

test('explicit zero self-declaration is known while absent evidence stays unknown',()=>{
 const profile=buildEvidenceProfile(context,[row('zero',{level:0})],{now});
 assert.equal(profile.selectedEvidence[0].level,0);
 assert.equal(buildEvidenceProfile(context,[],{now}).selectedEvidence.length,0);
 assert.throws(()=>buildEvidenceProfile(context,[row('invalid-zero',{level:0,evidenceType:'human_validated'})],{now}),/explicit L0/);
});

test('unconfirmed, superseded, future and explicitly stale evidence cannot supply levels',()=>{
 const profile=buildEvidenceProfile(context,[row('cv',{evidenceType:'cv_extracted_unconfirmed'}),row('old',{supersededBy:'new'}),row('future',{observedAt:new Date(now.getTime()+1)}),row('stale',{observedAt:new Date('2020-01-01')})],{now,maxAgeDays:30});
 assert.equal(profile.learnerState.skills.length,0);
 assert.deepEqual(profile.ignoredEvidence.map(e=>e.reason).sort(),['future_observation','stale','superseded','unconfirmed_cv']);
});
test('confidence is capped by evidence authority and precedence is independent of input order',()=>{
 const rows=[row('cv',{level:3,evidenceType:'cv_extracted_confirmed',confidence:'high'}),row('human',{level:2,evidenceType:'human_validated',confidence:'high',observedAt:new Date('2026-01-01')})];
 const profile=buildEvidenceProfile(context,rows,{now});
 assert.equal(profile.selectedEvidence[0].evidenceId,'human');
 assert.equal(profile.disagreements[0].resolution,'confidence_then_recency');
 assert.equal(profile.inputsHash,buildEvidenceProfile(context,rows.reverse(),{now}).inputsHash);
 assert.equal(buildEvidenceProfile(context,[rows.find(r=>r.id==='cv')],{now}).selectedEvidence[0].confidence,'low');
});
test('equally authoritative simultaneous contradictory levels stay unknown',()=>{
 const profile=buildEvidenceProfile(context,[row('one'),row('two',{level:3})],{now});
 assert.deepEqual(profile.conflictingSkillIds,['a']);assert.equal(profile.learnerState.skills.length,0);
});
test('verified completed production assessment is required for quiz evidence',()=>{
 const proof={sessionId:'session',status:'completed',deliveryMode:'production',coverageAchieved:true,reconciliationStatus:'reconciled_tested',finalLevel:'L2',completedAt:now};
 const quiz=row('quiz',{level:2,evidenceType:'quiz_sufficient_coverage',confidence:'high',provenance:{assessmentSessionId:'session'},assessment:proof});
 assert.equal(buildEvidenceProfile(context,[quiz],{now}).selectedEvidence[0].confidence,'medium');
 assert.equal(buildEvidenceProfile(context,[{...quiz,evidenceType:'quiz_plus_practical'}],{now}).selectedEvidence[0].confidence,'medium');
 for(const change of [{deliveryMode:'pilot'},{coverageAchieved:false},{status:'started'},{finalLevel:'L3'},{reconciliationStatus:'conflict_flagged'}]){
  assert.equal(buildEvidenceProfile(context,[{...quiz,assessment:{...proof,...change}}],{now}).ignoredEvidence[0].reason,'assessment_not_verified');
 }
 assert.equal(buildEvidenceProfile(context,[{...quiz,assessment:undefined}],{now}).selectedEvidence.length,0);
});
test('different learner evidence and caller-supplied context levels are rejected',()=>{
 assert.throws(()=>buildEvidenceProfile(context,[row('foreign',{learnerId:'someone'})],{now}),/different learner/);
 assert.throws(()=>buildEvidenceProfile({...context,prerequisiteLevels:{a:4}},[],{now}),/caller-supplied/);
});
test('handoff identifies missing levels without assuming zero and only offers a supplied eligible bank',()=>{
 const empty={...learner,skills:[]};
 assert.equal(createAssessmentHandoff(target,empty,[],[],[],now).requests[0].action,'confirm_level');
 assert.equal(createAssessmentHandoff(target,empty,[],[bank],[],now).requests[0].action,'take_assessment');
 assert.equal(createAssessmentHandoff(target,empty,[],[{...bank,supportedLevels:[1]}],[],now).requests[0].action,'confirm_level');
 assert.equal(createAssessmentHandoff(target,empty,[],[bank],['a'],now).requests[0].action,'resolve_evidence');
 const l4={...target,skills:[{...target.skills[0],targetLevel:4}]};
 assert.equal(createAssessmentHandoff(l4,empty,[],[bank],[],now).requests[0].action,'provide_practical_evidence');
});
test('unknown prerequisites are prioritized only for relevant otherwise feasible courses',()=>{
 const courses=[item('goal',[{skillId:'a',outcomeLevel:3}],{prerequisites:[{skillId:'foundation',label:'Foundation',minimumLevel:1}]}),item('expensive',[{skillId:'a',outcomeLevel:3}],{priceMad:1000,prerequisites:[{skillId:'unused',label:'Unused',minimumLevel:1}]})];
 const result=createAssessmentHandoff(target,{...learner,skills:[],constraints:{hoursPerWeek:10,budgetMad:200}},courses,[],[],now);
 assert.equal(result.requests[0].skillId,'foundation');assert.equal(result.requests[0].blockedCourseCount,1);
 assert.ok(!result.requests.some(r=>r.skillId==='unused'));
});
test('a known target gap still prompts for external prerequisites',()=>{
 const state={...learner,skills:[skill('a',3,1)]};
 const course=item('goal',[{skillId:'a',entryLevel:1,outcomeLevel:3}],{prerequisites:[{skillId:'foundation',label:'Foundation',minimumLevel:1}]});
 assert.equal(createAssessmentHandoff(target,state,[course],[],[],now).requests[0].skillId,'foundation');
 assert.equal(createAssessmentHandoff(target,state,[],[],[],now).status,'not_needed');
});

class Repository extends StandaloneRecommendationRepository {
 constructor(rows=[],courses=[],pool={}){super(pool);this.rows=rows;this.courses=courses;}
 async skillEvidence(){return this.rows;}
 async deriveTargetProfile(){return target;}
 async activeWeights(){return {version:'test',weights};}
 async items(){return this.courses;}
 async neighbourSkillIds(){return new Set();}
 async assessmentAvailability(ids,language){this.bankRequest={ids,language};return language==='fr'?[bank]:[];}
}
test('persisted evidence feeds target gaps and replay provenance',async()=>{
 const result=await new Repository([row('declaration')],[item('course',[{skillId:'a',entryLevel:1,outcomeLevel:3}])]).recommendFromEvidence(context,'role',options);
 assert.equal(result.status,'ok');assert.equal(result.recommendations.length,1);
 assert.equal(result.inputSnapshot.learnerState.skills[0].gap,2);
 assert.equal(result.evidenceProfile.selectedEvidence[0].evidenceId,'declaration');
 assert.equal(result.inputsHash,hashComputationInputs(result.inputSnapshot));
});
test('an incomplete profile returns an actionable handoff while retaining insufficient-profile semantics',async()=>{
 const repo=new Repository();const result=await repo.recommendFromEvidence(context,'role',options,'en');
 assert.equal(result.status,'insufficient_profile');assert.deepEqual(result.missingSkillIds,['a']);
 assert.equal(result.assessmentHandoff.requests[0].action,'confirm_level');assert.equal(repo.bankRequest.language,'en');
});
test('unresolved evidence propagates into the handoff and mutated handoffs cannot be recorded',async()=>{
 const repo=new Repository([row('one'),row('two',{level:3})]);const result=await repo.recommendFromEvidence(context,'role',options);
 assert.equal(result.assessmentHandoff.requests[0].action,'resolve_evidence');
 await assert.rejects(()=>repo.recordImpression({...result,assessmentHandoff:null}),/replay snapshot/);
 await assert.rejects(()=>repo.recordImpression({...result,evidenceProfile:null}),/replay snapshot/);
});
test('evidence repository maps joined assessment timestamps without trusting provenance-only proof',async()=>{
 let query;
 const repo=new StandaloneRecommendationRepository({query:async(sql)=>{query=sql;return {rows:[{id:'e',learner_id:learner.learnerId,skill_id:'a',level:2,evidence_type:'quiz_sufficient_coverage',confidence:'medium',observed_at:now,superseded_by:null,provenance:{assessmentSessionId:'s'},assessment:{sessionId:'s',status:'completed',deliveryMode:'production',coverageAchieved:true,reconciliationStatus:'reconciled_tested',finalLevel:'L2',completedAt:now.toISOString()}}]};}});
 const profile=buildEvidenceProfile(context,await repo.skillEvidence(context.learnerId),{now});
 assert.equal(profile.selectedEvidence.length,1);assert.match(query,/s.learner_id=e.learner_id AND s.skill_id=e.skill_id/);
});
