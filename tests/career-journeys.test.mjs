import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeJourney,gradeProgression,summarize,blindComparisons} from '../evaluation/career-journeys/oracle.mjs';

const scenario={id:'ma-credit',market:'MA',domain:'C12',target:'C1202',activity:'credit-evidence-v1'};
function fixture(){return {snapshot:{profile:{marketCode:'MA'},candidates:[{code:'C1202',domains:[{code:'C12'}]}],
 recommendations:[{directionId:'rome:C1202'}],targets:[{code:'C1202',input:{target:{marketCode:'MA'}},activities:[{id:'credit-evidence-v1',status:'pilot'}],
 plan:{nextMilestoneIds:['exercise:credit-evidence-v1'],milestones:[{id:'exercise:credit-evidence-v1',kind:'exercise',activityId:'credit-evidence-v1',state:'ready',label:'Credit case'}],
  readiness:'not_assessed',masteryEstablished:false,levelAvailability:'unavailable',gaps:[],summary:{requirements:8,unknown:8,exercisesCompleted:0}}}]}};}

test('journey oracle rejects wrong scope, unavailable actions, market substitution and false mastery independently',()=>{
 const clean=gradeJourney(scenario,fixture(),1);assert.ok(Object.values(clean.flags).every(Boolean));
 const dirty=fixture();dirty.snapshot.candidates.push({code:'E1401',domains:[{code:'E14'}]});
 const target=dirty.snapshot.targets[0];target.input.target.marketCode='FR';target.activities[0].status='draft';
 target.plan.milestones[0].state='blocked';target.plan.masteryEstablished=true;target.plan.gaps.push({kind:'career_level'});
 const grade=gradeJourney(scenario,dirty,1);
 for(const key of ['inDomain','exactCoverage','pilotActivity','actionable','activityReady','noFalseLevel','marketScoped'])assert.equal(grade.flags[key],false,key);
 assert.equal(summarize([grade]).safetyPassed,1);
});

test('blind comparison packets omit provider identity and failed runs while preserving both alternatives',()=>{
 const pair={caseId:'fr',market:'FR',status:'completed',baseline:[{focus:'Known first action'}],assistant:[{focus:'Another available action'}],reportFacts:[],modelCalls:2};
 const {review,key}=blindComparisons([pair,{...pair,caseId:'ma',market:'MA'},{...pair,status:'failed'}]);
 assert.equal(review.length,2);assert.equal(key[0].assistantSide,'B');assert.equal(key[1].assistantSide,'A');
 assert.deepEqual(review[0].B,pair.assistant);assert.deepEqual(review[1].A,pair.assistant);
 assert.ok(review.every(r=>r.preferred==='unreviewed'&&r.reviewerId===null));
 assert.ok(!JSON.stringify(review).includes('modelCalls'));assert.ok(!JSON.stringify(review).includes('assistantSide'));
});

test('journey oracle cannot count a wrong or blocked successor as successful progression',()=>{
 const before=gradeJourney(scenario,fixture(),1),after=fixture(),plan=after.snapshot.targets[0].plan;
 plan.summary.exercisesCompleted=1;plan.milestones.push({id:'exercise:credit-sensitivity-v1',state:'blocked'});
 let grade=gradeProgression(before,after,{outcome:'passed'},'credit-sensitivity-v1');assert.equal(grade.successorReady,false);
 plan.milestones[1].state='ready';plan.summary.unknown=0;plan.masteryEstablished=true;
 grade=gradeProgression(before,after,{outcome:'passed'},'credit-sensitivity-v1');assert.equal(grade.successorReady,true);
 assert.equal(grade.unknownUnchanged,false);assert.equal(grade.noMastery,false);
});
