import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALGORITHM_VERSIONS,
  TaskNetworkCrosswalkRepository,
  proposeTaskNetworkCrosswalk,
  validateTaskCrosswalkBatch,
  validateTaskCrosswalkReview,
} from '../dist/index.js';

const ESCO_RELEASE='11111111-1111-4111-8111-111111111111';
const ONET_RELEASE='22222222-2222-4222-8222-222222222222';
const policy={version:'task-crosswalk-pilot-v1',topK:2,minimumCandidateScore:.35,minimumProposalScore:.7,
 minimumProposalMargin:.15,minimumTextScoreForDirectionalSuggestion:.6,
 weights:{text:.5,occupationContext:.2,skillContext:.2,networkContext:.1}};
const text=(language,value,kind='label')=>({language,kind,text:value,provenance:'official release field'});
const node=(taxonomy,releaseId,entityId,label,anchors={})=>({taxonomy,releaseId,
 entityKind:taxonomy==='esco'?'esco_skill':taxonomy==='rome'?'rome_competence':'onet_task',entityId,
 texts:[text('en',label)],occupationAnchorIds:anchors.occupations??[],skillAnchorIds:anchors.skills??[],
 networkContextIds:anchors.network??[]});
const source=node('esco',ESCO_RELEASE,'esco-1','install electrical wiring',
 {occupations:['occupation-electrician'],skills:['electrical-installation'],network:['cluster-install']});
const exact=node('onet',ONET_RELEASE,'onet-1','install electrical wiring',
 {occupations:['occupation-electrician'],skills:['electrical-installation'],network:['cluster-install']});
const alternative=node('onet',ONET_RELEASE,'onet-2','inspect electrical equipment',
 {occupations:['occupation-electrician'],skills:['electrical-inspection'],network:['cluster-inspect']});
const run=(overrides={})=>proposeTaskNetworkCrosswalk({sourceNodes:[source],targetNodes:[exact,alternative],policy,
 computedAt:new Date('2026-09-20T12:00:00Z'),...overrides});

test('task-network evidence creates a deterministic review proposal, not an authoritative mapping',()=>{
 const batch=run(),outcome=batch.outcomes[0],candidate=outcome.candidates[0];
 assert.equal(batch.algorithmVersion,ALGORITHM_VERSIONS.taskNetworkCrosswalk);
 assert.equal(outcome.decision,'proposed');assert.equal(outcome.selectedTargetKey,candidate.targetKey);
 assert.equal(candidate.suggestedRelation,'equivalent');assert.equal(candidate.score,1);
 assert.ok(candidate.qualityFlags.includes('direction_requires_review'));
 validateTaskCrosswalkBatch(batch);
 assert.deepEqual(run(),batch);
});

test('node and pool ordering are canonicalized for reproducible retries',()=>{
 const reorderedSource={...source,occupationAnchorIds:[...source.occupationAnchorIds].reverse(),
  skillAnchorIds:[...source.skillAnchorIds].reverse(),networkContextIds:[...source.networkContextIds].reverse()};
 const first=run(),second=run({sourceNodes:[reorderedSource],targetNodes:[alternative,exact]});
 assert.equal(second.inputsHash,first.inputsHash);assert.equal(second.resultHash,first.resultHash);
});

test('weak evidence produces explicit NIL and cross-language text is never silently compared',()=>{
 const unrelated=node('onet',ONET_RELEASE,'onet-x','prepare financial statements');
 const french={...source,entityId:'esco-fr',texts:[text('fr','installer le câblage électrique')]};
 const batch=run({sourceNodes:[french],targetNodes:[unrelated]});
 const outcome=batch.outcomes[0];
 assert.equal(outcome.decision,'nil');assert.equal(outcome.selectedTargetKey,null);
 assert.equal(outcome.reason,'no_plausible_candidate');assert.equal(outcome.topScore,null);
 assert.ok(outcome.candidates[0].qualityFlags.includes('no_same_language_text'));
});

test('near-tied plausible candidates cause abstention',()=>{
 const twin={...exact,entityId:'onet-twin'};
 const batch=run({targetNodes:[exact,twin]});
 assert.equal(batch.outcomes[0].decision,'abstained');
 assert.equal(batch.outcomes[0].reason,'ambiguous_margin');
 assert.equal(batch.outcomes[0].margin,0);
});

test('direction is only a suggestion derived from nonempty governed scope anchors',()=>{
 const broader={...exact,entityId:'onet-broad',occupationAnchorIds:['occupation-electrician','occupation-maintenance']};
 const batch=run({targetNodes:[broader]});
 assert.equal(batch.outcomes[0].candidates[0].suggestedRelation,'source_narrower');
 const noContext=run({sourceNodes:[{...source,entityId:'esco-no-context',occupationAnchorIds:[],skillAnchorIds:[],networkContextIds:[]}],
  targetNodes:[{...exact,entityId:'onet-no-context',occupationAnchorIds:[],skillAnchorIds:[],networkContextIds:[]} ]});
 assert.equal(noContext.outcomes[0].candidates[0].suggestedRelation,'related');
});

test('release mixing, same-taxonomy runs, and invalid policy weights are rejected',()=>{
 assert.throws(()=>run({sourceNodes:[source,{...source,entityId:'esco-2',releaseId:'33333333-3333-4333-8333-333333333333'}]}),/one frozen source release/);
 assert.throws(()=>run({targetNodes:[{...exact,taxonomy:'esco',entityKind:'esco_skill'}]}),/distinct taxonomies/);
 assert.throws(()=>run({policy:{...policy,weights:{...policy.weights,text:.6}}}),/sum to 1/);
});

test('approval requires a complete human checklist and reviewer-selected direction',()=>{
 const review={reviewerPrincipal:'taxonomy-expert@example.org',decision:'approved',reviewedRelation:'equivalent',
  rationale:'The task action, object, occupational context, and scope match.',reviewedAt:new Date('2026-09-21T10:00:00Z'),
  checklist:{semanticScopeChecked:true,occupationContextChecked:true,directionChecked:true,sourceReleaseChecked:true}};
 assert.doesNotThrow(()=>validateTaskCrosswalkReview(review));
 assert.throws(()=>validateTaskCrosswalkReview({...review,reviewedRelation:null}),/reviewer-selected relation/);
 assert.throws(()=>validateTaskCrosswalkReview({...review,checklist:{...review.checklist,directionChecked:false}}),/complete expert checklist/);
 assert.throws(()=>validateTaskCrosswalkReview({...review,decision:'rejected'}),/Only an approved review/);
});

test('persistence records frozen nodes, all candidates, and NIL/abstention outcomes atomically',async()=>{
 const batch=run(),calls=[];let released=false;
 const client={query:async(sql,params=[])=>{
  const statement=String(sql);calls.push({sql:statement,params});
  if(statement.includes('FROM praxis.task_network_crosswalk_run'))return {rows:[]};
  if(statement.includes('FROM praxis.source_releases'))return {rows:[{id:ESCO_RELEASE,source:'esco'},{id:ONET_RELEASE,source:'onet'}]};
  if(statement.includes('FROM praxis.source_task_network_node'))return {rows:[]};
  return {rows:[]};
 },release:()=>{released=true;}};
 const result=await new TaskNetworkCrosswalkRepository({connect:async()=>client}).recordBatch('crosswalk-generator',batch);
 assert.equal(result.replayed,false);assert.equal(result.candidateIds.length,2);assert.equal(released,true);
 assert.ok(calls.some(call=>call.sql.includes('INSERT INTO praxis.source_task_network_node')));
 assert.ok(calls.some(call=>call.sql.includes('INSERT INTO praxis.task_network_crosswalk_candidate')));
 assert.ok(calls.some(call=>call.sql.includes('INSERT INTO praxis.task_network_crosswalk_outcome')));
 assert.ok(calls.some(call=>call.sql==='COMMIT'));
});

test('review persistence enforces reviewer independence before writing an append-only event',async()=>{
 const review={reviewerPrincipal:'taxonomy-expert',decision:'approved',reviewedRelation:'related',
  rationale:'The scopes overlap but neither task fully contains the other.',reviewedAt:new Date('2026-09-21T10:00:00Z'),
  checklist:{semanticScopeChecked:true,occupationContextChecked:true,directionChecked:true,sourceReleaseChecked:true}};
 const candidateId='33333333-3333-4333-8333-333333333333';
 let released=false;
 const independentCalls=[];
 const independentClient={query:async(sql,params=[])=>{
  independentCalls.push({sql:String(sql),params});
  if(String(sql).includes('SELECT run.generated_by_principal'))return {rows:[{generated_by_principal:'generator'}]};
  return {rows:[]};
 },release:()=>{released=true;}};
 const id=await new TaskNetworkCrosswalkRepository({connect:async()=>independentClient}).recordReview(candidateId,review);
 assert.match(id,/^[0-9a-f-]{36}$/);assert.equal(released,true);
 assert.ok(independentCalls.some(call=>call.sql.includes('INSERT INTO praxis.task_network_crosswalk_review')));
 const sameClient={query:async(sql)=>String(sql).includes('SELECT run.generated_by_principal')
  ?{rows:[{generated_by_principal:'taxonomy-expert'}]}:{rows:[]},release:()=>{}};
 await assert.rejects(()=>new TaskNetworkCrosswalkRepository({connect:async()=>sameClient}).recordReview(candidateId,review),/independent/);
});

test('tampered proposal output fails provenance validation',()=>{
 const batch=run();
 assert.throws(()=>validateTaskCrosswalkBatch({...batch,policyVersion:'tampered'}),/provenance/);
});
