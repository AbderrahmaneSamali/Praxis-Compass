import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALGORITHM_VERSIONS,
  GraphSequentialExperimentRepository,
  evaluateGraphSequentialExperiment,
  validateGraphSequentialExperimentBatch,
  validateRecommenderExperimentReview,
} from '../dist/index.js';

const hash=character=>character.repeat(64);
const before=new Date('2026-06-30T00:00:00Z'),after=new Date('2026-07-15T00:00:00Z');
const event=(eventId,learnerId,itemId,resolvedAt,overrides={})=>({eventId,learnerId,itemId,resolvedAt,
 completionStatus:'completed',assessedSkillGain:false,sourceClass:'real',...overrides});
const outcomes=[],cases=[],rankings=[];
for(let index=1;index<=4;index+=1){
 const learnerId=`learner-${index}`,target=index%2?`target-a`:`target-b`,segment=index<=2?'new-career':'upskilling';
 outcomes.push(event(`h-${index}-1`,learnerId,'foundation',new Date('2026-05-01T00:00:00Z')),
  event(`h-${index}-2`,learnerId,'intermediate',new Date('2026-06-01T00:00:00Z')),
  event(`t-${index}`,learnerId,target,after,{assessedSkillGain:index%2===1}));
 cases.push({caseId:`case-${index}`,learnerId,segment,historyEventIds:[`h-${index}-2`,`h-${index}-1`],
  targetEventId:`t-${index}`,eligibleItemIds:['other','target-b','target-a']});
 const alternate=target==='target-a'?'target-b':'target-a';
 rankings.push({caseId:`case-${index}`,modelId:'production-v4',rankedItemIds:['other',target,alternate]},
  {caseId:`case-${index}`,modelId:'graph-seq-v1',rankedItemIds:[target,'other',alternate]});
}
const models=[
 {modelId:'production-v4',family:'production_baseline',version:'v4',trainingDataEndsAt:before,featureSnapshotEndsAt:before,
  graphSnapshotEndsAt:null,trainingDataHash:hash('a'),hyperparameterHash:hash('b')},
 {modelId:'graph-seq-v1',family:'graph_sequential',version:'pilot-1',trainingDataEndsAt:before,featureSnapshotEndsAt:before,
  graphSnapshotEndsAt:before,trainingDataHash:hash('c'),hyperparameterHash:hash('d')},
];
const policy={version:'offline-pilot-v1',trainingEndsAt:new Date('2026-06-30T23:59:59Z'),
 evaluationEndsAt:new Date('2026-07-31T23:59:59Z'),minimumResolvedOutcomes:12,minimumCompletedOutcomes:12,
 minimumRealLearners:4,minimumObservedItems:4,minimumHistoryLength:2,minimumEvaluationCases:4,minimumCasesPerSegment:2,
 minimumAssessedOutcomeCases:2,
 kValues:[2,1],primaryMetric:'ndcg',primaryK:1,minimumPrimaryMetricLift:.05,maximumCatalogCoverageLoss:.5,
 maximumSegmentMetricLoss:.05,maximumAssessedGainNdcgLoss:.05,
 confidenceLevel:.95,bootstrapReplicates:200,bootstrapSeed:'stage-8-test'};
const input=(overrides={})=>({outcomes,cases,models,rankings,policy,computedAt:new Date('2026-08-01T00:00:00Z'),...overrides});

test('sufficient real outcomes unlock leakage-safe offline evaluation only',()=>{
 const batch=evaluateGraphSequentialExperiment(input());
 assert.equal(batch.algorithmVersion,ALGORITHM_VERSIONS.graphSequentialExperiment);
 assert.equal(batch.status,'offline_evaluated');assert.ok(batch.readinessGates.every(gate=>gate.ready));
 assert.equal(batch.evaluations.length,2);assert.deepEqual(batch.evaluations[0].metrics.map(metric=>metric.k),[1,2]);
 const comparison=batch.comparisons.find(row=>row.modelId==='graph-seq-v1');
 assert.equal(comparison.decision,'eligible_for_prospective_trial');assert.ok(comparison.confidenceInterval.lower>.05);
 assert.ok(batch.limitations.includes('offline_metrics_do_not_authorize_production'));
 validateGraphSequentialExperimentBatch(batch);
});

test('insufficient real outcomes block all model metrics and comparisons',()=>{
 const fixtureEvents=Array.from({length:100},(_,index)=>event(`fixture-${index}`,`fixture-learner-${index}`,'fixture-item',after,
  {sourceClass:'fixture'}));
 const batch=evaluateGraphSequentialExperiment(input({outcomes:[...outcomes,...fixtureEvents],
  policy:{...policy,minimumResolvedOutcomes:13}}));
 assert.equal(batch.status,'blocked_insufficient_real_outcomes');assert.equal(batch.evaluations.length,0);
 assert.equal(batch.comparisons.length,0);assert.equal(batch.datasetManifest.excludedNonRealOutcomeCount,100);
 assert.equal(batch.readinessGates.find(gate=>gate.gate==='real_resolved_outcomes').ready,false);
});

test('post-window outcomes cannot satisfy readiness gates',()=>{
 const future=event('future','future-learner','future-item',new Date('2027-01-01T00:00:00Z'));
 const batch=evaluateGraphSequentialExperiment(input({outcomes:[...outcomes,future],policy:{...policy,minimumResolvedOutcomes:13}}));
 assert.equal(batch.status,'blocked_insufficient_real_outcomes');
 assert.equal(batch.datasetManifest.excludedPostWindowOutcomeCount,1);
});

test('temporal leakage and graph snapshots without cutoffs are rejected',()=>{
 const leaked=[...outcomes.filter(row=>row.eventId!=='h-1-2'),event('h-1-2','learner-1','intermediate',after)];
 assert.throws(()=>evaluateGraphSequentialExperiment(input({outcomes:leaked})),/histories must end/);
 assert.throws(()=>evaluateGraphSequentialExperiment(input({models:[models[0],{...models[1],graphSnapshotEndsAt:null}]})),/Graph models require/);
 assert.throws(()=>evaluateGraphSequentialExperiment(input({models:[models[0],{...models[1],featureSnapshotEndsAt:after}]})),/training cutoff/);
});

test('rankings cannot bypass served-time eligibility or omit case-model pairs',()=>{
 assert.throws(()=>evaluateGraphSequentialExperiment(input({rankings:[...rankings.slice(0,-1)]})),/Every model must rank every/);
 const invalid=[...rankings];invalid[0]={...invalid[0],rankedItemIds:['not-eligible']};
 assert.throws(()=>evaluateGraphSequentialExperiment(input({rankings:invalid})),/eligible item set/);
});

test('paired bootstrap can retain the baseline when the challenger has no lift',()=>{
 const tied=rankings.map(row=>row.modelId==='graph-seq-v1'
  ?{...row,rankedItemIds:rankings.find(other=>other.caseId===row.caseId&&other.modelId==='production-v4').rankedItemIds}:row);
 const batch=evaluateGraphSequentialExperiment(input({rankings:tied}));
 const comparison=batch.comparisons.find(row=>row.modelId==='graph-seq-v1');
 assert.equal(comparison.decision,'retain_baseline');
 assert.ok(comparison.reasons.includes('primary_metric_lower_bound_does_not_clear_lift_gate'));
});

test('model and candidate ordering are canonicalized for reproducible evaluation',()=>{
 const first=evaluateGraphSequentialExperiment(input());
 const second=evaluateGraphSequentialExperiment(input({models:[...models].reverse(),cases:[...cases].reverse(),
  rankings:[...rankings].reverse(),policy:{...policy,kValues:[1,2]}}));
 assert.equal(second.inputsHash,first.inputsHash);assert.equal(second.resultHash,first.resultHash);
});

test('prospective-trial review requires a complete governance checklist',()=>{
 const review={reviewerPrincipal:'model-risk@example.org',modelId:'graph-seq-v1',decision:'approve_prospective_trial',
  rationale:'Temporal, eligibility, subgroup, and privacy checks passed for a controlled trial only.',
  reviewedAt:new Date('2026-08-02T00:00:00Z'),checklist:{temporalLeakageChecked:true,eligibilityConstraintsChecked:true,
   baselineComparisonChecked:true,subgroupMetricsChecked:true,privacyChecked:true}};
 assert.doesNotThrow(()=>validateRecommenderExperimentReview(review));
 assert.throws(()=>validateRecommenderExperimentReview({...review,checklist:{...review.checklist,privacyChecked:false}}),/complete governance checklist/);
});

test('aggregate persistence excludes learner-level input snapshots',async()=>{
 const batch=evaluateGraphSequentialExperiment(input()),calls=[];let released=false;
 const client={query:async(sql,params=[])=>{calls.push({sql:String(sql),params});
  if(String(sql).includes('FROM praxis.recommender_experiment_run'))return {rows:[]};return {rows:[]};},
  release:()=>{released=true;}};
 const recorded=await new GraphSequentialExperimentRepository({connect:async()=>client}).recordBatch('offline-evaluator',batch);
 assert.equal(recorded.replayed,false);assert.equal(released,true);
 const runInsert=calls.find(call=>call.sql.includes('INSERT INTO praxis.recommender_experiment_run'));
 assert.equal(Object.hasOwn(JSON.parse(runInsert.params[10]),'inputSnapshot'),false);
 assert.ok(calls.some(call=>call.sql.includes('INSERT INTO praxis.recommender_experiment_model_result')));
 assert.ok(calls.some(call=>call.sql.includes('INSERT INTO praxis.recommender_experiment_comparison')));
 assert.ok(calls.some(call=>call.sql==='COMMIT'));
});

test('database cohort loader maps only the governed real-outcome view',async()=>{
 const rows=[{event_id:'outcome-1',learner_id:'learner-1',item_id:'item-1',resolved_at:new Date('2026-07-10T00:00:00Z'),
  completion_status:'completed',assessed_skill_gain:true}];
 const pool={query:async(sql,params)=>{assert.ok(String(sql).includes('recommender_experiment_real_outcome_source'));
  assert.equal(params[0].toISOString(),'2026-07-31T23:59:59.000Z');return {rows};}};
 const cohort=await new GraphSequentialExperimentRepository(pool).loadRealOutcomeCohort(new Date('2026-07-31T23:59:59Z'));
 assert.deepEqual(cohort[0],{eventId:'outcome-1',learnerId:'learner-1',itemId:'item-1',resolvedAt:rows[0].resolved_at,
  completionStatus:'completed',assessedSkillGain:true,sourceClass:'real'});
});

test('experiment review persistence permits only independent offline-eligible trial candidates',async()=>{
 const runId='11111111-1111-4111-8111-111111111111';
 const review={reviewerPrincipal:'model-risk',modelId:'graph-seq-v1',decision:'approve_prospective_trial',
  rationale:'Approved for a separately governed prospective trial only.',reviewedAt:new Date('2026-08-02T00:00:00Z'),
  checklist:{temporalLeakageChecked:true,eligibilityConstraintsChecked:true,baselineComparisonChecked:true,
   subgroupMetricsChecked:true,privacyChecked:true}};
 const makeClient=row=>({query:async sql=>String(sql).includes('SELECT run.generated_by_principal')?{rows:[row]}:{rows:[]},release:()=>{}});
 const id=await new GraphSequentialExperimentRepository({connect:async()=>makeClient({generated_by_principal:'evaluator',
  comparison_decision:'eligible_for_prospective_trial'})}).recordReview(runId,review);
 assert.match(id,/^[0-9a-f-]{36}$/);
 await assert.rejects(()=>new GraphSequentialExperimentRepository({connect:async()=>makeClient({generated_by_principal:'model-risk',
  comparison_decision:'eligible_for_prospective_trial'})}).recordReview(runId,review),/independent/);
 await assert.rejects(()=>new GraphSequentialExperimentRepository({connect:async()=>makeClient({generated_by_principal:'evaluator',
  comparison_decision:'retain_baseline'})}).recordReview(runId,review),/offline-eligible/);
});

test('tampered experiment evidence fails provenance validation',()=>{
 const batch=evaluateGraphSequentialExperiment(input());
 assert.throws(()=>validateGraphSequentialExperimentBatch({...batch,status:'blocked_insufficient_real_outcomes'}),/provenance/);
});
