import test from 'node:test';
import assert from 'node:assert/strict';
import {planLearningPaths,courseFinish,features,score,candidates,scarcity,eligibilityIssues,exploreTopTen,StandaloneRecommendationRepository,StandaloneCareerCompass,hashComputationInputs} from '../dist/index.js';
import {now,weights,skill,learner,item,chain} from './fixtures.mjs';

const options={now,explorationProbability:0};
class FixtureRepository extends StandaloneRecommendationRepository {
  constructor(supplied=[],pool={}) {super(pool);this.supplied=supplied;}
  async activeWeights(){return {version:'test-v4',weights};}
  async items(){return this.supplied;}
  async assessmentAvailability(){return [];}
  async neighbourSkillIds(){return new Set(['adjacent']);}
  async deriveTargetProfile(id){return {occupationId:id,label:id,source:'authored',skills:[{skillId:id==='role-b'?'b':'a',label:'target',targetLevel:1,importance:1,reviewed:true,targetLevelBasis:'praxis_authored'}]};}
}

test('single eligible course yields a complete one-step plan',()=>{
 const result=planLearningPaths([item('one',[{skillId:'a'}])],learner,now);
 assert.equal(result.status,'complete');assert.equal(result.plans[0].projectedCoverage,1);
 assert.equal(result.plans[0].complete,true);assert.equal(result.plans[0].steps.length,1);
});
test('partial two-step plan continues through third prerequisite course',()=>{
 const result=planLearningPaths(chain(),{...learner,skills:['a','b','c'].map(id=>skill(id))},now);
 assert.equal(result.status,'complete');assert.equal(result.plans[0].projectedCoverage,1);
 assert.deepEqual(result.plans[0].steps.map(s=>s.itemId),['first','second','third']);
});
test('prerequisite-only course can unlock a target course',()=>{
 const courses=[item('prep',[{skillId:'foundation'}]),item('goal',[{skillId:'a'}],{prerequisites:[{skillId:'foundation',label:'foundation',minimumLevel:1}]})];
 const result=planLearningPaths(courses,learner,now);
 assert.deepEqual(result.plans[0].steps.map(s=>s.itemId),['prep','goal']);assert.equal(result.plans[0].complete,true);
});
test('budget is cumulative across a plan and reports a binding rejection',()=>{
 const result=planLearningPaths(chain(),{...learner,skills:['a','b','c'].map(id=>skill(id)),constraints:{hoursPerWeek:10,budgetMad:250}},now);
 assert.equal(result.status,'partial');assert.ok(result.plans.every(p=>p.totalPriceMad<=250));assert.ok(result.blockingConstraints.budget>0);
});
test('cyclic prerequisites terminate without fabricating readiness',()=>{
 const courses=[item('A',[{skillId:'a'}],{prerequisites:[{skillId:'b',label:'b',minimumLevel:1}]}),item('B',[{skillId:'b'}],{prerequisites:[{skillId:'a',label:'a',minimumLevel:1}]})];
 const result=planLearningPaths(courses,learner,now);
 assert.equal(result.status,'no_plan');assert.equal(result.plans.length,0);assert.ok(result.blockingConstraints.prerequisite_unknown>0);
});
test('search limits are exposed when a chain cannot yet be completed',()=>{
 const result=planLearningPaths(chain(),{...learner,skills:['a','b','c'].map(id=>skill(id))},now,{maxDepth:2,maxCandidates:200,beamWidth:64});
 assert.equal(result.status,'partial');assert.equal(result.searchTruncated,true);assert.equal(result.limits.maxDepth,2);
});
test('incomplete prerequisite closure reports a search bound even before a course is eligible',()=>{
 const courses=['a','b','c','d'].map((id,i)=>item(id,[{skillId:id}],i?{prerequisites:[{skillId:['a','b','c','d'][i-1],label:'previous',minimumLevel:1}]}:{}));
 const result=planLearningPaths(courses,{...learner,skills:[skill('d')]},now,{maxDepth:2,maxCandidates:200,beamWidth:64});
 assert.equal(result.status,'no_plan');assert.equal(result.searchTruncated,true);
});
test('zero-weight outcome never advances a planner state',()=>{
 const result=planLearningPaths([item('zero',[{skillId:'a',weight:0}])],learner,now);
 assert.equal(result.status,'no_plan');assert.equal(result.plans.length,0);
});
test('unknown completion time is explained instead of producing a dated plan',()=>{
 const result=planLearningPaths([item('one',[{skillId:'a'}])],{...learner,constraints:{}},now);
 assert.equal(result.status,'no_plan');assert.ok(result.blockingConstraints.completion_unknown>0);
});
test('scheduled courses cannot precede completion of their prerequisites',()=>{
 const courses=[item('prep',[{skillId:'foundation'}],{admissionStatus:'scheduled',nextSessionAt:new Date('2026-09-19'),nextEndAt:new Date('2026-09-22T23:59:59.999Z')}),item('goal',[{skillId:'a'}],{admissionStatus:'scheduled',nextSessionAt:new Date('2026-09-22'),nextEndAt:new Date('2026-09-25T23:59:59.999Z'),prerequisites:[{skillId:'foundation',label:'foundation',minimumLevel:1}]})];
 assert.equal(planLearningPaths(courses,learner,now).plans.length,0);
});
test('scheduled course can start on the day after prerequisite completion',()=>{
 const courses=[item('prep',[{skillId:'foundation'}],{admissionStatus:'scheduled',nextSessionAt:new Date('2026-09-19'),nextEndAt:new Date('2026-09-22T23:59:59.999Z')}),item('goal',[{skillId:'a'}],{admissionStatus:'scheduled',nextSessionAt:new Date('2026-09-23'),nextEndAt:new Date('2026-09-25T23:59:59.999Z'),prerequisites:[{skillId:'foundation',label:'foundation',minimumLevel:1}]})];
 assert.equal(planLearningPaths(courses,learner,now).plans[0].complete,true);
});
test('scheduled start cannot precede a self-paced prerequisite finishing later that day',()=>{
 const courses=[item('prep',[{skillId:'foundation'}]),item('goal',[{skillId:'a'}],{admissionStatus:'scheduled',nextSessionAt:new Date('2026-09-25'),nextEndAt:new Date('2026-09-28T23:59:59.999Z'),prerequisites:[{skillId:'foundation',label:'foundation',minimumLevel:1}]})];
 const result=planLearningPaths(courses,learner,now);
 assert.equal(result.plans.length,0);assert.ok(result.blockingConstraints.session_unavailable>0);
});
test('related candidates are returned separately from evidenced goal progress',async()=>{
 const repo=new FixtureRepository([item('direct',[{skillId:'a'}]),item('adjacent-only',[{skillId:'adjacent'}],{popularity:999})]);
 const result=await repo.recommend(learner,'role-a',options);
 assert.deepEqual(result.recommendations.map(r=>r.item.id),['direct']);assert.deepEqual(result.relatedRecommendations.map(r=>r.item.id),['adjacent-only']);
 assert.equal(result.relatedRecommendations[0].features.gap_coverage,0);assert.equal(result.relatedRecommendations[0].reasons[0].kind,'related_skills');
 assert.equal(result.candidateCount,2);
});
test('empty learner profile has an explicit insufficient-evidence status',async()=>{
 const result=await new FixtureRepository([item('one',[{skillId:'a'}])]).recommend({...learner,skills:[]},'role-a',options);
 assert.equal(result.status,'insufficient_profile');assert.equal(result.recommendations.length,0);assert.equal(result.relatedRecommendations.length,0);
});
test('satisfied goal does not trigger generic recommendations',async()=>{
 const result=await new FixtureRepository([item('one',[{skillId:'a'}])]).recommend({...learner,skills:[skill('a',1,1)]},'role-a',options);
 assert.equal(result.status,'goal_satisfied');assert.equal(result.recommendations.length,0);
});
test('target-bound caller state rejects a different target',async()=>{
 await assert.rejects(new FixtureRepository().recommend({...learner,targetOccupationId:'role-a'},'role-b',options),/does not match/);
});
test('high-level target API recomputes gaps from the requested role',async()=>{
 const repo=new FixtureRepository([item('a-course',[{skillId:'a'}]),item('b-course',[{skillId:'b'}])]);
 const state={...learner,skills:[skill('a'),skill('b')]};
 assert.deepEqual((await repo.recommendForTarget(state,'role-a',options)).recommendations.map(r=>r.item.id),['a-course']);
 assert.deepEqual((await repo.recommendForTarget(state,'role-b',options)).recommendations.map(r=>r.item.id),['b-course']);
});
test('unknown target skills are requested, never silently assigned level zero',async()=>{
 const result=await new FixtureRepository([item('b-course',[{skillId:'b'}])]).recommendForTarget(learner,'role-b',options);
 assert.equal(result.status,'insufficient_profile');assert.deepEqual(result.missingSkillIds,['b']);assert.equal(result.recommendations.length,0);
});
test('unpublished and incomplete offers are excluded even with a repository fixture',async()=>{
 const result=await new FixtureRepository([item('draft',[{skillId:'a'}],{status:'draft'}),item('incomplete',[{skillId:'a'}],{actionableOffer:false})]).recommend(learner,'role-a',{...options,allowAllPublishedOffers:true});
 assert.equal(result.recommendations.length,0);assert.equal(result.learningPlans.plans.length,0);assert.equal(result.reviewBypassed,true);
 assert.ok(result.exclusions.find(e=>e.itemId==='draft').issues.includes('unpublished'));
});
test('complete prerequisite plan is surfaced when no direct course is eligible',async()=>{
 const repo=new FixtureRepository([item('prep',[{skillId:'foundation'}]),item('goal',[{skillId:'a'}],{prerequisites:[{skillId:'foundation',label:'foundation',minimumLevel:1}]})]);
 const result=await repo.recommend(learner,'role-a',options);assert.equal(result.status,'plan_available');assert.equal(result.learningPlans.plans[0].complete,true);
});
test('candidate cap preserves highest eventual score within the direct pool',()=>{
 const courses=Array.from({length:201},(_,i)=>item(String(i),[{skillId:'a'}]));
 const result=candidates({gapItems:courses,targetPathwayItems:[],neighbourhoodItems:[],popularityItems:[]},200,undefined,c=>Number(c.id));
 assert.equal(result.items[0].id,'200');assert.deepEqual(result.dropped,['0']);
});
test('repository scores before capping and retains the better final recommendation',async()=>{
 const fillers=Array.from({length:200},(_,i)=>item(`filler-${i}`,[{skillId:'a',outcomeLevel:4,entryLevel:null}],{languages:['en']}));
 const better=item('best-score',[{skillId:'a',outcomeLevel:3}],{nextSessionAt:new Date(now.getTime()+86400000)});
 const state={...learner,skills:[skill('a',4)],constraints:{hoursPerWeek:10,languages:['fr'],languageFlexibility:'flexible'}};
 const result=await new FixtureRepository([...fillers,better]).recommend(state,'role-a',options);
 assert.ok(result.recommendations.some(r=>r.item.id==='best-score'));assert.equal(result.candidateCount,200);
 assert.ok(!result.droppedItemIds.includes('best-score'));
});
test('common skills receive a lower scarcity score than rare skills',()=>{
 assert.ok(scarcity(item('common',[{skillId:'a',catalogFrequency:100}]),learner)<scarcity(item('rare',[{skillId:'a',catalogFrequency:1}]),learner));
});
test('invalid numerical input is rejected at public boundaries',()=>{
 const one=item('one',[{skillId:'a'}]);
 assert.throws(()=>score({...features(one,learner,now),gap_coverage:NaN},weights),RangeError);
 assert.throws(()=>score(features(one,learner,now),{...weights,freshness:Infinity}),RangeError);
 assert.throws(()=>courseFinish(one,{...learner,constraints:{hoursPerWeek:-10}},now),RangeError);
 assert.throws(()=>features(one,{...learner,skills:[{...skill('a'),gap:0}]},now),/Inconsistent gap/);
 assert.throws(()=>features(one,{...learner,skills:[skill('a'),skill('a')]},now),/unique/);
 assert.throws(()=>eligibilityIssues(one,learner,new Date('invalid')),RangeError);
});
test('hard budget, language, workload and prerequisites remain eligibility gates',()=>{
 const one=item('one',[{skillId:'a',entryLevel:1,outcomeLevel:2}],{priceMad:1000,languages:['en'],requiredWeeklyHours:20});
 const issues=eligibilityIssues(one,{...learner,constraints:{budgetMad:100,languages:['fr'],hoursPerWeek:10}},now);
 for(const issue of ['budget','language','weekly_workload','prerequisite'])assert.ok(issues.includes(issue));
});
test('exploration preserves membership and exposes its metadata',async()=>{
 const result=await new FixtureRepository([item('one',[{skillId:'a'}]),item('two',[{skillId:'a'}])]).recommend(learner,'role-a',{now,explorationProbability:1,random:()=>0});
 assert.equal(result.isExploration,true);assert.equal(result.explorationProbability,1);
 assert.deepEqual(result.recommendations.map(r=>r.item.id).sort(),['one','two']);
 assert.equal(result.scoringAt,now.toISOString());
 assert.equal(result.inputsHash,hashComputationInputs(result.inputSnapshot));
 assert.deepEqual(result.inputSnapshot.recommendations.map(r=>r.item.id),result.recommendations.map(r=>r.item.id));
 assert.throws(()=>exploreTopTen([1,2],()=>1),RangeError);
});
test('impression persistence records served ranks and full replay snapshot atomically',async()=>{
 const queries=[];let released=false;
 const client={query:async(sql,args)=>{queries.push({sql,args});return {rows:sql.startsWith('SELECT id')?[{id:'role-a'}]:[]}},release:()=>{released=true}};
 const repo=new FixtureRepository([item('00000000-0000-0000-0000-000000000010',[{skillId:'a'}])],{connect:async()=>client});
 const result=await repo.recommend(learner,'role-a',options);
 assert.equal(await repo.recordImpression(result),result.requestId);assert.equal(queries[0].sql,'BEGIN');assert.equal(queries.at(-1).sql,'COMMIT');assert.equal(released,true);
 const header=queries.find(q=>q.sql.includes('INSERT INTO praxis.recommendation_impression\n'));
 assert.deepEqual(JSON.parse(header.args[13]),result.inputSnapshot);
 const entry=queries.find(q=>q.sql.includes('INSERT INTO praxis.recommendation_impression_item'));
 assert.equal(entry.args[3],1);assert.equal(entry.args[4],result.recommendations[0].score);
});
test('failed impression write rolls back and releases the connection',async()=>{
 const queries=[];let released=false;
 const client={query:async(sql)=>{queries.push(sql);if(sql.startsWith('INSERT'))throw new Error('write failed');return {rows:sql.startsWith('SELECT id')?[{id:'role-a'}]:[]}},release:()=>{released=true}};
 const repo=new FixtureRepository([item('one',[{skillId:'a'}])],{connect:async()=>client});
 await assert.rejects(repo.recordImpression(await repo.recommend(learner,'role-a',options)),/write failed/);
 assert.equal(queries.at(-1),'ROLLBACK');assert.equal(released,true);
});
test('recording rejects results altered after their replay snapshot was captured',async()=>{
 const repo=new FixtureRepository([item('one',[{skillId:'a'}])]);
 const result=await repo.recommend(learner,'role-a',options);
 await assert.rejects(repo.recordImpression({...result,recommendations:[]}),/does not match/);
});
test('Compass exposes the weighted ranking metric separately from raw overlap',async()=>{
 let call=0;
 const rows=[{occupationId:'close',conceptUri:'close',label:'Close',description:'',language:'fr',shared:8,weightedCoverage:.8,skills:Array.from({length:10},(_,i)=>({skillId:String(i),label:String(i),targetLevel:3,reviewed:false,shared:i<8}))},{occupationId:'large',conceptUri:'large',label:'Large',description:'',language:'fr',shared:12,weightedCoverage:.4,skills:Array.from({length:30},(_,i)=>({skillId:String(i),label:String(i),targetLevel:3,reviewed:false,shared:i<12}))}];
 const result=await new StandaloneCareerCompass({query:async()=>({rows:++call===1?[{label:'Origin'}]:rows})}).explore('role-a','fr',2);
 assert.deepEqual(result.destinations.map(d=>d.bridgePercentage),[80,40]);assert.deepEqual(result.destinations.map(d=>d.similarityScore),[.8,.4]);
 assert.equal(result.metric,'idf_weighted_destination_coverage');assert.equal(result.evidenceBasis,'occupation_taxonomy');
});
