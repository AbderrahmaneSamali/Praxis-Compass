import test from 'node:test';
import assert from 'node:assert/strict';
import {
 ANNOTATION_SCHEMAS,
 auditStageTwoReadiness,
 catalogSkillIds,
 compareAnnotationSubmissions,
 createBlankAnnotationSubmission,
 finalizeAdjudication,
 prepareAnnotationBatch,
 validateAnnotationSubmission,
} from '../evaluation/cv-skills/annotation-workflow.mjs';

const digest=value=>value.repeat(64);
const skills={python:'esco:python',sql:'esco:sql',analysis:'esco:analysis'};
const batch={schemaVersion:ANNOTATION_SCHEMAS.batch,catalogVersion:'esco-test',documents:[
 {documentId:'fr-1',subjectId:'subject-fr',language:'fr',split:'dev',catalogVersion:'esco-test',text:'Python SQL',
  sourceSha256:digest('a'),deidentificationStatus:'confirmed',consentStatus:'confirmed'},
 {documentId:'ar-1',subjectId:'subject-ar',language:'ar',split:'test',catalogVersion:'esco-test',text:'تحليل بيانات',
  sourceSha256:digest('b'),deidentificationStatus:'confirmed',consentStatus:'documented_legal_basis'},
]};
const catalog={version:'esco-test',concepts:Object.values(skills).map(uri=>({uri,type:'skill'}))};
const ids=catalogSkillIds(catalog,batch);
const submission=(id,reviewer,documents)=>({schemaVersion:ANNOTATION_SCHEMAS.submission,submissionId:id,reviewerId:reviewer,
 annotatedAt:'2026-09-20T10:00:00Z',catalogVersion:'esco-test',annotationMethod:'manual_blind',independenceDeclaration:true,documents});
const reviewerA=submission('submission-a','reviewer-a',[
 {documentId:'fr-1',sourceSha256:digest('a'),annotations:[
  {start:0,end:6,skillId:skills.python},{start:7,end:10,skillId:null},
 ]},
 {documentId:'ar-1',sourceSha256:digest('b'),annotations:[{start:0,end:5,skillId:skills.analysis}]},
]);
const reviewerB=submission('submission-b','reviewer-b',[
 {documentId:'fr-1',sourceSha256:digest('a'),annotations:[
  {start:0,end:6,skillId:skills.python},{start:7,end:10,skillId:skills.sql},
 ]},
 {documentId:'ar-1',sourceSha256:digest('b'),annotations:[{start:0,end:4,skillId:skills.analysis}]},
]);

test('preparing a blind batch strips provisional labels and does not invent consent',()=>{
 const records=[{documentId:'fr',subjectId:'person',language:'fr',split:'test',catalogVersion:'v1',text:'Python',
  annotations:[{start:0,end:6,skillId:'python'}],sourceSha256:digest('c'),scope:'deidentified_excerpt'}];
 const prepared=prepareAnnotationBatch(records);
 assert.equal('annotations' in prepared.documents[0],false);
 assert.equal(prepared.documents[0].deidentificationStatus,'confirmed');
 assert.equal(prepared.documents[0].consentStatus,'not_recorded');
 const audit=auditStageTwoReadiness(prepared);
 assert.equal(audit.ready,false);
 assert.match(audit.reasons.join(' '),/Arabic/);
 assert.match(audit.reasons.join(' '),/consent/);
});

test('two blind submissions produce deterministic concept and Arabic boundary issues',()=>{
 const blank=createBlankAnnotationSubmission(batch,{reviewerId:'reviewer-new',submissionId:'submission-new'});
 assert.equal(blank.independenceDeclaration,false);
 assert.deepEqual(blank.documents.map(document=>document.annotations.length),[0,0]);
 validateAnnotationSubmission(batch,reviewerA,ids);
 const queue=compareAnnotationSubmissions(batch,reviewerA,reviewerB,ids);
 assert.equal(queue.summary.exactSpan.matches,2);
 assert.equal(queue.summary.exactSpan.f1,2/3);
 assert.equal(queue.summary.conceptAgreementOnExactSpans,.5);
 assert.deepEqual(queue.summary.byType,{concept:1,boundary:1,missing_mention:0,flagged:0});
 assert.deepEqual(queue.issues.map(issue=>issue.type).sort(),['boundary','concept']);
 assert.equal(compareAnnotationSubmissions(batch,reviewerA,reviewerB,ids).queueDigest,queue.queueDigest);
 assert.throws(()=>validateAnnotationSubmission(batch,{...reviewerA,documents:[
  {...reviewerA.documents[0],annotations:[{start:0,end:6,skillId:'esco:unknown'}]},reviewerA.documents[1],
 ]},ids),/Unknown skillId/);
 assert.throws(()=>compareAnnotationSubmissions(batch,reviewerA,{...reviewerB,reviewerId:'reviewer-a'},ids),/distinct reviewers/);
});

test('finalization requires every current issue and emits auditable gold',()=>{
 const queue=compareAnnotationSubmissions(batch,reviewerA,reviewerB,ids);
 const decisions={schemaVersion:ANNOTATION_SCHEMAS.decisions,queueDigest:queue.queueDigest,adjudicatorId:'adjudicator-1',
  adjudicatedAt:'2026-09-21T10:00:00Z',decisions:queue.issues.map(issue=>({issueId:issue.issueId,
   resolution:issue.type==='concept' ? 'reviewer_b':'reviewer_a',rationale:issue.type==='concept' ? 'nil':'boundary'}))};
 assert.throws(()=>finalizeAdjudication(batch,reviewerA,reviewerB,{...decisions,decisions:decisions.decisions.slice(1)},ids),/Every disagreement/);
 const records=finalizeAdjudication(batch,reviewerA,reviewerB,decisions,ids);
 assert.equal(records.length,2);
 assert.equal(records[0].annotationStatus,'adjudicated_two_independent_reviewers');
 assert.equal(records[0].annotations.find(annotation=>annotation.start===7).skillId,skills.sql);
 assert.equal(records[1].annotations[0].end,5);
 assert.deepEqual(auditStageTwoReadiness(batch,{records}),{ready:true,documents:2,languageCounts:{fr:1,ar:1,mixed:0},reasons:[]});
});
