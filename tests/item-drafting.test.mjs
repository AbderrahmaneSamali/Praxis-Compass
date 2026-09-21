import test from 'node:test';
import assert from 'node:assert/strict';
import {
 AssessmentItemAuthoringRepository,
 buildItemGenerationRequest,
 validateExpertItemReview,
 validateGeneratedItemCompletion,
 validateItemDraftBatch,
} from '../dist/index.js';

const blueprintId='11111111-1111-4111-8111-111111111111';
const requesterId='22222222-2222-4222-8222-222222222222';
const reviewerId='33333333-3333-4333-8333-333333333333';
const specification={blueprintId,skillId:'skill_clash_detection',language:'fr',targetLevel:'L2',
 subSkillId:'sub_result_interpretation',learningObjective:'Interpréter et trier les résultats de détection.',requestedCount:2,
 promptTemplateVersion:'item-draft-fr-v1',sourceMaterials:[{id:'source-1',title:'Guide approuvé',
  content:'Les détections doivent être validées avant d’être classées comme conflits réels.'}]};
const candidate={stem:'Pourquoi faut-il valider une détection avant de la classer comme conflit réel ?',
 options:[
  {text:'Parce qu’une détection peut être un faux positif.',rationale:'Réponse correcte fondée sur la source.'},
  {text:'Parce que chaque détection impose un changement.',rationale:'Confond détection et décision.'},
  {text:'Parce que le logiciel ne conserve aucun résultat.',rationale:'Affirmation incorrecte sur l’outil.'},
  {text:'Parce que toutes les tolérances doivent être nulles.',rationale:'Ignore les tolérances approuvées.'},
 ],correctOptionIndex:0,answerRationale:'La validation distingue une intersection détectée d’un conflit réel.',sourceIds:['source-1']};

function completion(request,candidates=[candidate]){return {requestId:request.requestId,requestDigest:request.requestDigest,
 provider:'host-model-provider',model:'draft-model-v1',modelParameters:{temperature:0.2},
 completedAt:new Date('2026-09-20T12:00:00Z'),candidates};}

test('generation request binds sources without retaining their text in the audit snapshot',()=>{
 const request=buildItemGenerationRequest(specification);
 assert.match(request.requestId,/^item-draft-[a-f0-9]{24}$/);
 assert.equal(JSON.stringify(request.inputSnapshot).includes('faux positif'),false);
 assert.equal(request.prompt.payload.sources[0].content,specification.sourceMaterials[0].content);
 assert.match(request.prompt.systemInstruction,/untrusted reference content/);
});

test('valid model output becomes only an uncalibrated expert-review draft',()=>{
 const request=buildItemGenerationRequest(specification);
 const batch=validateGeneratedItemCompletion(request,completion(request));
 validateItemDraftBatch(batch);
 const draft=batch.candidates[0].draft;
 assert.equal(draft.status,'draft');assert.equal(draft.calibrationStatus,'uncalibrated');
 assert.ok(draft.qualityFlags.includes('semantic_accuracy_requires_expert_review'));
 assert.ok(draft.qualityFlags.includes('difficulty_requires_pilot_calibration'));
 assert.equal(draft.itemPayload.keyOptionId,'option-1');
 assert.throws(()=>validateItemDraftBatch({...batch,provider:'forged'}),/provenance/);
});

test('malformed or duplicated generated candidates are retained as rejected validation results',()=>{
 const request=buildItemGenerationRequest(specification);
 const malformed={...candidate,options:candidate.options.map((option,index)=>index===1?{...option,text:candidate.options[0].text}:option)};
 const duplicate={...candidate};
 const batch=validateGeneratedItemCompletion(request,completion(request,[malformed,duplicate]));
 assert.equal(batch.candidates[0].status,'rejected_validation');
 assert.ok(batch.candidates[0].issues.some(issue=>issue.code==='duplicate_option'));
 assert.equal(batch.candidates[1].status,'rejected_validation');
 assert.ok(batch.candidates[1].issues.some(issue=>issue.code==='duplicate_stem'));
 const nonObject=validateGeneratedItemCompletion(request,completion(request,[null]));
 assert.equal(nonObject.candidates[0].status,'rejected_validation');
});

test('approval requires an attesting expert and every checklist item',()=>{
 const review={reviewerLearnerId:reviewerId,reviewerRole:'subject_matter_expert',expertAttestation:true,
  decision:'approved',checklist:{factualAccuracy:true,singleBestAnswer:true,distractorQuality:true,
   objectiveAlignment:true,languageQuality:true,biasAndAccessibility:true,sourceGrounding:true},
  rationale:'The answer, distractors, language, and source alignment were checked.',reviewedAt:new Date()};
 validateExpertItemReview(review);
 assert.throws(()=>validateExpertItemReview({...review,checklist:{...review.checklist,biasAndAccessibility:false}}),/every expert-review/);
});

test('draft persistence is atomic and expert review must be independent',async()=>{
 const request=buildItemGenerationRequest(specification),batch=validateGeneratedItemCompletion(request,completion(request));
 const calls=[];let released=false;
 const client={query:async(sql,params=[])=>{
  calls.push({sql:String(sql),params});
  if(String(sql).includes('FROM praxis.assessment_item_generation_run WHERE request_id'))return {rows:[]};
  if(String(sql).includes('FROM praxis.assessment_blueprint'))return {rows:[{skill_id:specification.skillId,language:'fr',status:'published'}]};
  if(String(sql).includes('FROM praxis.learner'))return {rows:[{id:requesterId}]};
  return {rows:[]};
 },release:()=>{released=true;}};
 const repository=new AssessmentItemAuthoringRepository({connect:async()=>client});
 const recorded=await repository.recordDraftBatch(requesterId,batch);
 assert.equal(recorded.itemIds.length,1);assert.equal(recorded.replayed,false);assert.equal(released,true);
 const itemInsert=calls.find(call=>call.sql.includes('INSERT INTO praxis.assessment_item\n'));
 assert.ok(itemInsert);assert.ok(itemInsert.sql.includes("'draft'"));assert.ok(itemInsert.sql.includes("'uncalibrated'"));

 const review={reviewerLearnerId:requesterId,reviewerRole:'subject_matter_expert',expertAttestation:true,
  decision:'approved',checklist:{factualAccuracy:true,singleBestAnswer:true,distractorQuality:true,
   objectiveAlignment:true,languageQuality:true,biasAndAccessibility:true,sourceGrounding:true},
  rationale:'Reviewed.',reviewedAt:new Date()};
 const reviewClient={query:async sql=>String(sql).includes('FROM praxis.assessment_item item')?
  {rows:[{status:'draft',content_origin:'ai_assisted',requested_by_learner_id:requesterId}]}:{rows:[]},release:()=>{}};
 const reviewRepository=new AssessmentItemAuthoringRepository({connect:async()=>reviewClient});
 await assert.rejects(()=>reviewRepository.recordExpertReview(recorded.itemIds[0],review),/independent expert/);
});
