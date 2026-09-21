import test from 'node:test';
import assert from 'node:assert/strict';
import {
 ALGORITHM_VERSIONS,
 AssessmentIrtRepository,
 estimateIrtPosterior,
 evaluateIrtStopping,
 selectNextIrtItem,
 validateIrtPosterior,
} from '../dist/index.js';

const options={prior:{mean:0,standardDeviation:1,version:'calibrated-population-v1'},levelThresholds:[
 {level:'L1',minimumTheta:-1},{level:'L2',minimumTheta:0},{level:'L3',minimumTheta:1},
]};
const item=(id,difficulty=0,extra={})=>({id,difficulty,discrimination:1,calibrationStatus:'calibrated',...extra});

test('2PL posterior updates symmetrically and returns normalized uncertainty',()=>{
 const correct=estimateIrtPosterior([{item:item('one'),correct:true}],options);
 const incorrect=estimateIrtPosterior([{item:item('one'),correct:false}],options);
 assert.ok(correct.eapTheta>0);assert.ok(incorrect.eapTheta<0);
 assert.ok(Math.abs(correct.eapTheta+incorrect.eapTheta)<1e-10);
 assert.ok(correct.posteriorStandardDeviation<1);
 assert.ok(Math.abs(correct.distribution.reduce((sum,point)=>sum+point.probability,0)-1)<1e-12);
 assert.ok(Math.abs(Object.values(correct.categoryProbabilities).reduce((sum,value)=>sum+value,0)-1)<1e-12);
 assert.equal(correct.algorithmVersion,ALGORITHM_VERSIONS.irtPosterior);
 validateIrtPosterior(correct);
});

test('omitted answers carry no evidence and extreme response patterns remain finite',()=>{
 const omitted=estimateIrtPosterior([{item:item('skip'),correct:null}],options);
 assert.equal(omitted.responseCounts.scored,0);assert.equal(omitted.responseCounts.omitted,1);
 assert.ok(omitted.qualityFlags.includes('no_scored_responses'));
 assert.ok(Math.abs(omitted.eapTheta)<1e-12);
 const allCorrect=estimateIrtPosterior(Array.from({length:20},(_,index)=>({item:item(`i-${index}`,index/20-.5),correct:true})),options);
 assert.ok(Number.isFinite(allCorrect.eapTheta));assert.ok(Number.isFinite(allCorrect.posteriorStandardDeviation));
 assert.ok(allCorrect.credibleInterval.lower<=allCorrect.eapTheta && allCorrect.eapTheta<=allCorrect.credibleInterval.upper);
});

test('item parameter uncertainty is marginalized and avoids point-estimate precision claims',()=>{
 const fixed=estimateIrtPosterior([{item:item('fixed'),correct:true}],options);
 const uncertain=estimateIrtPosterior([{item:item('uncertain',0,{difficultyStandardError:.8,discriminationStandardError:.5}),correct:true}],options);
 assert.equal(fixed.calibrationUncertainty,'conditional_point_estimates');
 assert.ok(fixed.qualityFlags.includes('item_parameter_uncertainty_not_propagated'));
 assert.equal(uncertain.calibrationUncertainty,'marginalized');
 assert.ok(uncertain.posteriorStandardDeviation>=fixed.posteriorStandardDeviation);
 assert.ok(uncertain.testInformationAtEap<fixed.testInformationAtEap);
 assert.ok(uncertain.qualityFlags.includes('dif_not_modeled'));
});

test('stopping requires coverage, information, precision, and category certainty',()=>{
 const strong=estimateIrtPosterior(Array.from({length:16},(_,index)=>({item:item(`hard-${index}`,1,{discrimination:2}),correct:true})),options);
 const policy={minimumScoredItems:5,maximumScoredItems:20,maximumPosteriorStandardDeviation:.6,
  minimumCategoryProbability:.7,minimumTestInformation:1,version:'stop-v1'};
 const classified=evaluateIrtStopping(strong,true,policy);
 assert.equal(classified.shouldStop,true);assert.equal(classified.outcome,'level');assert.equal(classified.level,'L3');
 assert.equal(evaluateIrtStopping(strong,false,policy).reason,'coverage');
 const uncertain=estimateIrtPosterior([{item:item('a'),correct:true},{item:item('b'),correct:false}],options);
 const exhausted=evaluateIrtStopping(uncertain,true,{...policy,minimumScoredItems:2,maximumScoredItems:2,
  maximumPosteriorStandardDeviation:.1,minimumCategoryProbability:.99});
 assert.equal(exhausted.outcome,'inconclusive');assert.equal(exhausted.reason,'maximum_items_uncertain');
});

test('next-item selection maximizes posterior information while respecting exposure',()=>{
 const posterior=estimateIrtPosterior([],options);
 const selected=selectNextIrtItem(posterior,[item('far',3),item('center',0),item('blocked',0,{discrimination:3,exposureRate:.9})],new Set(),.5);
 assert.equal(selected.item.id,'center');
 assert.equal(selectNextIrtItem(posterior,[item('done')],new Set(['done'])),null);
});

test('IRT rejects uncalibrated, duplicate, and incomplete parameter inputs',()=>{
 assert.throws(()=>estimateIrtPosterior([{item:{...item('bad'),calibrationStatus:'pilot'},correct:true}],options),/calibrated item/);
 assert.throws(()=>estimateIrtPosterior([{item:item('same'),correct:true},{item:item('same'),correct:false}],options),/only once/);
 assert.throws(()=>estimateIrtPosterior([{item:item('se',0,{difficultyStandardError:.2}),correct:true}],options),/both item-parameter/);
 assert.throws(()=>estimateIrtPosterior([], {...options,levelThresholds:[{level:'L1',minimumTheta:0}]}),/one explicit theta/);
 assert.throws(()=>estimateIrtPosterior([], {...options,grid:{minimum:-.5,maximum:.5,step:.01}}),/within the IRT grid/);
});

test('posterior output integrity and transactional persistence are enforced',async()=>{
 const posterior=estimateIrtPosterior([{item:item('00000000-0000-4000-8000-000000000001'),correct:true}],options);
 assert.throws(()=>validateIrtPosterior({...posterior,eapTheta:posterior.eapTheta+1}),/provenance/);
 const calls=[];let released=false;
 const client={query:async(sql,params=[])=>{
  calls.push({sql:String(sql),params});
  if(String(sql).includes('FROM praxis.assessment_session'))return {rows:[{id:'00000000-0000-4000-8000-000000000010'}]};
  if(String(sql).includes('count(*)::int'))return {rows:[{total:1}]};
  if(String(sql).includes('SELECT result_hash'))return {rows:[]};
  return {rows:[]};
 },release:()=>{released=true;}};
 const repository=new AssessmentIrtRepository({connect:async()=>client});
 const policy={minimumScoredItems:1,maximumScoredItems:10,maximumPosteriorStandardDeviation:1,
  minimumCategoryProbability:.3,minimumTestInformation:0,version:'test-stop-v1'};
 const recorded=await repository.record('00000000-0000-4000-8000-000000000010',posterior,true,policy);
 assert.equal(recorded.replayed,false);assert.equal(recorded.step,1);assert.equal(released,true);
 assert.ok(calls.some(call=>call.sql.includes('INSERT INTO praxis.assessment_irt_posterior')));
 assert.ok(calls.some(call=>call.sql==='COMMIT'));
});
