import test from 'node:test';
import assert from 'node:assert/strict';
import {
 ALGORITHM_VERSIONS,
 applyLearnerSkillConfirmation,
 buildEvidenceProfile,
 buildLearnerSkillConfirmationRequest,
 SkillConfirmationRepository,
 validateLearnerSkillConfirmationResult,
} from '../dist/index.js';

const now=new Date('2026-09-20T10:00:00Z');
const catalog={version:'esco-v1',concepts:[
 {uri:'skill:python',type:'skill',labels:{fr:'programmer en Python',ar:'البرمجة بلغة بايثون',en:'program in Python'},alternatives:{}},
 {uri:'skill:sql',type:'skill',labels:{fr:'utiliser SQL',ar:'استخدام SQL',en:'use SQL'},alternatives:{}},
]};
const proposal=(id,extra={})=>({id,learnerId:'learner-1',sourceEvidenceId:`evidence-${id}`,cvDocumentId:'cv-1',
 catalogVersion:'esco-v1',extractionAlgorithmVersion:'extract-v1',decision:'linked',skillId:'skill:python',
 mention:{start:0,end:6,text:'Python'},extractedAt:new Date('2026-09-19T10:00:00Z'),...extra});
const response=(request,responses)=>({requestId:request.requestId,requestDigest:request.requestDigest,learnerId:'learner-1',
 submittedAt:now,responses});

test('confirmation request groups repeated mentions and exposes no model scores',()=>{
 const request=buildLearnerSkillConfirmationRequest('learner-1',[proposal('one'),proposal('two',{cvDocumentId:'cv-2'})],catalog,'ar',now);
 assert.equal(request.cards.length,1);assert.equal(request.cards[0].mentions.length,2);
 assert.equal(request.cards[0].label,'البرمجة بلغة بايثون');
 assert.equal(JSON.stringify(request).includes('score'),false);
 assert.equal(request.algorithmVersion,ALGORITHM_VERSIONS.learnerSkillConfirmation);
});

test('presence confirmation without a level creates no mastery evidence',()=>{
 const request=buildLearnerSkillConfirmationRequest('learner-1',[proposal('one')],catalog,'fr',now);
 const result=applyLearnerSkillConfirmation(request,response(request,[{cardId:request.cards[0].cardId,action:'confirm'}]),catalog);
 assert.deepEqual(result.needsLevelSkillIds,['skill:python']);
 assert.equal(result.evidenceDrafts.length,0);assert.equal(result.decisions[0].evidenceStatus,'needs_level');
 validateLearnerSkillConfirmationResult(result);
});

test('an explicitly attested level becomes low-authority confirmed-CV evidence',()=>{
 const request=buildLearnerSkillConfirmationRequest('learner-1',[proposal('one')],catalog,'fr',now);
 const result=applyLearnerSkillConfirmation(request,response(request,[{cardId:request.cards[0].cardId,action:'confirm',
  declaredLevel:2,levelAttestation:true,masteryRubricVersion:request.masteryRubricVersion}]),catalog);
 const draft=result.evidenceDrafts[0];assert.equal(draft.level,2);assert.equal(draft.confidence,'low');
 const profile=buildEvidenceProfile({learnerId:'learner-1',constraints:{}},[{...draft,id:'persisted',supersededBy:null}],{now});
 assert.equal(profile.selectedEvidence[0].level,2);assert.equal(profile.selectedEvidence[0].confidence,'low');
});

test('reject and unsure are retained decisions but never become L0 evidence',()=>{
 const proposals=[proposal('one'),proposal('sql',{skillId:'skill:sql',mention:{start:7,end:10,text:'SQL'}})];
 const request=buildLearnerSkillConfirmationRequest('learner-1',proposals,catalog,'fr',now);
 const actions=new Map(request.cards.map(card=>[card.suggestedSkillId,card.suggestedSkillId==='skill:sql'?'unsure':'reject']));
 const result=applyLearnerSkillConfirmation(request,response(request,request.cards.map(card=>({cardId:card.cardId,action:actions.get(card.suggestedSkillId)}))),catalog);
 assert.equal(result.evidenceDrafts.length,0);assert.deepEqual(result.needsLevelSkillIds,[]);
 assert.ok(result.decisions.every(decision=>decision.selectedSkillId===null));
});

test('corrections are catalog-bound and levels require explicit rubric attestation',()=>{
 const request=buildLearnerSkillConfirmationRequest('learner-1',[proposal('one')],catalog,'fr',now),cardId=request.cards[0].cardId;
 assert.throws(()=>applyLearnerSkillConfirmation(request,response(request,[{cardId,action:'correct',correctedSkillId:'skill:missing'}]),catalog),/different skill/);
 assert.throws(()=>applyLearnerSkillConfirmation(request,response(request,[{cardId,action:'confirm',declaredLevel:1}]),catalog),/attestation/);
 const result=applyLearnerSkillConfirmation(request,response(request,[{cardId,action:'correct',correctedSkillId:'skill:sql',
  declaredLevel:1,levelAttestation:true,masteryRubricVersion:request.masteryRubricVersion}]),catalog);
 assert.equal(result.evidenceDrafts[0].skillId,'skill:sql');
 const changed={...request,cards:[...request.cards,{...request.cards[0],cardId:'forged'}]};
 assert.throws(()=>applyLearnerSkillConfirmation(changed,response(request,[]),catalog),/changed after creation/);
});

test('confirmation repository persists decision and evidence atomically without CV snippets',async()=>{
 const request=buildLearnerSkillConfirmationRequest('learner-1',[proposal('one',{sourceEvidenceId:undefined})],catalog,'fr',now);
 const result=applyLearnerSkillConfirmation(request,response(request,[{cardId:request.cards[0].cardId,action:'confirm',
  declaredLevel:2,levelAttestation:true,masteryRubricVersion:request.masteryRubricVersion}]),catalog);
 const calls=[];let released=false;
 const client={query:async(sql,params=[])=>{
  calls.push({sql:String(sql),params});
  if(String(sql).includes('FROM praxis.cv_skill_confirmation_request'))return {rows:[]};
  if(String(sql).includes('FROM praxis.learner WHERE'))return {rows:[{id:'learner-1'}]};
  if(String(sql).includes('SELECT id,esco_skill_uri FROM praxis.skill'))return {rows:[{id:'local-python',esco_skill_uri:'skill:python'}]};
  return {rows:[]};
 },release:()=>{released=true;}};
 const repository=new SkillConfirmationRepository({connect:async()=>client});
 const recorded=await repository.record(result);
 assert.equal(recorded.replayed,false);assert.equal(recorded.evidenceIds.length,1);assert.equal(released,true);
 assert.ok(calls.some(call=>call.sql.includes("'cv_extracted_confirmed'")));
 assert.ok(calls.some(call=>call.sql==='COMMIT'));
 const persistedJson=calls.flatMap(call=>call.params).filter(value=>typeof value==='string' && value.startsWith('{'));
 assert.ok(persistedJson.every(value=>!value.includes('"mentions"') && !value.includes('"text":"Python"')));
});

test('answered proposal IDs can be suppressed from later confirmation requests',async()=>{
 const repository=new SkillConfirmationRepository({query:async(sql,params)=>{
  assert.match(sql,/unnest\(decision.source_proposal_ids\)/);assert.deepEqual(params,['learner-1']);
  return {rows:[{proposal_id:'proposal-a'},{proposal_id:'proposal-b'}]};
 }});
 assert.deepEqual([...await repository.decidedProposalIds('learner-1')],['proposal-a','proposal-b']);
 await assert.rejects(()=>repository.decidedProposalIds(''),/learnerId/);
});
