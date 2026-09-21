import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validateDataset} from './evaluate.mjs';

export const ANNOTATION_SCHEMAS=Object.freeze({
 batch:'praxis-cv-annotation-batch-v1',
 submission:'praxis-cv-annotation-submission-v1',
 queue:'praxis-cv-adjudication-queue-v1',
 decisions:'praxis-cv-adjudication-decisions-v1',
});

const LANGUAGES=new Set(['fr','ar','mixed']);
const SPLITS=new Set(['dev','test']);
const RESOLUTIONS=new Set(['reviewer_a','reviewer_b','replace','exclude']);
const RATIONALES=new Set(['boundary','catalog_specificity','nil','not_a_skill','guideline','other']);
const SHA256=/^[a-f0-9]{64}$/;
const key=annotation=>`${annotation.start}:${annotation.end}`;
const ratio=(numerator,denominator)=>denominator ? numerator/denominator : null;
const overlap=(left,right)=>left.start<right.end && right.start<left.end;
const cleanAnnotation=annotation=>({start:annotation.start,end:annotation.end,skillId:annotation.skillId});
const sorted=annotations=>[...annotations].map(cleanAnnotation).sort((a,b)=>a.start-b.start || a.end-b.end || String(a.skillId).localeCompare(String(b.skillId)));

function requiredString(value,name){
 if(typeof value!=='string' || !value.trim())throw new TypeError(`${name} must be a nonempty string`);
 return value;
}

function assertIsoTimestamp(value,name){
 requiredString(value,name);
 if(!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))
  throw new TypeError(`${name} must be an ISO-8601 timestamp`);
}

function validateAnnotations(annotations,text,catalogIds){
 if(!Array.isArray(annotations))throw new TypeError('annotations must be an array');
 const length=Array.from(text).length,seen=new Set();
 for(const annotation of annotations){
  if(!Number.isInteger(annotation.start) || !Number.isInteger(annotation.end) || annotation.start<0 ||
    annotation.end<=annotation.start || annotation.end>length)
   throw new RangeError('Annotation offsets must be Unicode code points with an exclusive end');
  if(seen.has(key(annotation)))throw new TypeError('A reviewer cannot assign two concepts to the same span');
  seen.add(key(annotation));
  if(annotation.skillId!==null && (typeof annotation.skillId!=='string' || !annotation.skillId.trim()))
   throw new TypeError('skillId must be a nonempty catalog ID or null (NIL)');
  if(annotation.skillId!==null && catalogIds && !catalogIds.has(annotation.skillId))
   throw new RangeError(`Unknown skillId in frozen catalog: ${annotation.skillId}`);
  if(annotation.needsAdjudication!==undefined && typeof annotation.needsAdjudication!=='boolean')
   throw new TypeError('needsAdjudication must be boolean when supplied');
  if(annotation.note!==undefined && (typeof annotation.note!=='string' || annotation.note.length>1000))
   throw new TypeError('Annotation notes must be strings of at most 1000 characters');
 }
}

export function validateAnnotationBatch(batch){
 if(batch?.schemaVersion!==ANNOTATION_SCHEMAS.batch || !Array.isArray(batch.documents) || !batch.documents.length)
  throw new TypeError(`Expected a nonempty ${ANNOTATION_SCHEMAS.batch}`);
 requiredString(batch.catalogVersion,'catalogVersion');
 const documentIds=new Set(),subjects=new Map();
 for(const document of batch.documents){
  requiredString(document.documentId,'documentId');
  if(documentIds.has(document.documentId))throw new TypeError('documentId must be unique');
  documentIds.add(document.documentId);
  requiredString(document.subjectId,'subjectId');
  if(!LANGUAGES.has(document.language) || !SPLITS.has(document.split))throw new TypeError('Invalid language or split');
  if(document.catalogVersion!==batch.catalogVersion)throw new RangeError('Every document must use the frozen batch catalogVersion');
  if(subjects.has(document.subjectId) && subjects.get(document.subjectId)!==document.split)
   throw new RangeError('A subject appears in both dev and test');
  subjects.set(document.subjectId,document.split);
  if(typeof document.text!=='string')throw new TypeError('Document text is required');
  if(Object.hasOwn(document,'annotations'))throw new TypeError('Blind annotation batches cannot contain annotations');
  if(!SHA256.test(document.sourceSha256))throw new TypeError('sourceSha256 must be a lowercase SHA-256 digest');
  if(!['confirmed','pending'].includes(document.deidentificationStatus))
   throw new TypeError('deidentificationStatus must be confirmed or pending');
  if(!['confirmed','documented_legal_basis','not_recorded'].includes(document.consentStatus))
   throw new TypeError('consentStatus is invalid');
 }
 return batch;
}

/** Convert an existing annotated JSONL dataset into a blind, annotation-free batch. */
export function prepareAnnotationBatch(records){
 validateDataset(records);
 const catalogVersion=records[0].catalogVersion;
 const batch={schemaVersion:ANNOTATION_SCHEMAS.batch,catalogVersion,documents:records.map(record=>({
  documentId:record.documentId,
  subjectId:record.subjectId,
  language:record.language,
  split:record.split,
  catalogVersion:record.catalogVersion,
  text:record.text,
  sourceSha256:record.sourceSha256,
  deidentificationStatus:record.deidentificationStatus ?? (record.scope?.startsWith('deidentified') ? 'confirmed':'pending'),
  consentStatus:record.consentStatus ?? 'not_recorded',
 }))};
 return validateAnnotationBatch(batch);
}

function assertReviewCollectionReady(batch){
 if(batch.documents.some(document=>document.deidentificationStatus!=='confirmed'))
  throw new RangeError('Review cannot start until every document is de-identified');
 if(batch.documents.some(document=>!['confirmed','documented_legal_basis'].includes(document.consentStatus)))
  throw new RangeError('Review cannot start without recorded consent or a documented legal basis');
}

/** Scaffold a deliberately invalid blank file; the reviewer completes and signs it after blind annotation. */
export function createBlankAnnotationSubmission(batch,{submissionId,reviewerId}){
 validateAnnotationBatch(batch);assertReviewCollectionReady(batch);
 requiredString(submissionId,'submissionId');requiredString(reviewerId,'reviewerId');
 return {schemaVersion:ANNOTATION_SCHEMAS.submission,submissionId,reviewerId,annotatedAt:null,
  catalogVersion:batch.catalogVersion,annotationMethod:'manual_blind',independenceDeclaration:false,
  documents:batch.documents.map(document=>({documentId:document.documentId,sourceSha256:document.sourceSha256,annotations:[]}))};
}

export function catalogSkillIds(catalog,batch){
 if(!catalog || catalog.version!==batch.catalogVersion || !Array.isArray(catalog.concepts))
  throw new RangeError('Catalog must be the frozen export named by the annotation batch');
 return new Set(catalog.concepts.filter(concept=>concept.type==='skill').map(concept=>concept.uri));
}

export function validateAnnotationSubmission(batch,submission,catalogIds){
 validateAnnotationBatch(batch);
 assertReviewCollectionReady(batch);
 if(submission?.schemaVersion!==ANNOTATION_SCHEMAS.submission)
  throw new TypeError(`Expected ${ANNOTATION_SCHEMAS.submission}`);
 requiredString(submission.submissionId,'submissionId');
 requiredString(submission.reviewerId,'reviewerId');
 assertIsoTimestamp(submission.annotatedAt,'annotatedAt');
 if(submission.catalogVersion!==batch.catalogVersion)throw new RangeError('Submission catalogVersion does not match the batch');
 if(submission.annotationMethod!=='manual_blind' || submission.independenceDeclaration!==true)
  throw new TypeError('Gold reviewers must declare manual_blind annotation and independent work');
 if(!Array.isArray(submission.documents))throw new TypeError('Submission documents are required');
 const sources=new Map(batch.documents.map(document=>[document.documentId,document])),seen=new Set();
 for(const document of submission.documents){
  const source=sources.get(document.documentId);
  if(!source || seen.has(document.documentId))throw new TypeError('Unknown or duplicate submission document');
  seen.add(document.documentId);
  if(document.sourceSha256!==source.sourceSha256)throw new RangeError('Submission sourceSha256 does not match the immutable source text');
  validateAnnotations(document.annotations,source.text,catalogIds);
 }
 if(seen.size!==batch.documents.length)throw new RangeError('A complete submission must include every batch document, including zero-mention documents');
 return submission;
}

function issueId(documentId,type,a,b){
 const payload=JSON.stringify({documentId,type,a:sorted(a),b:sorted(b)});
 return `issue-${createHash('sha256').update(payload).digest('hex').slice(0,16)}`;
}

function disagreementComponents(a,b){
 const nodes=[...a.map(annotation=>({side:'a',annotation})),...b.map(annotation=>({side:'b',annotation}))];
 const visited=new Set(),components=[];
 for(let index=0;index<nodes.length;index++){
  if(visited.has(index))continue;
  const pending=[index],component=[];visited.add(index);
  while(pending.length){
   const current=pending.pop();component.push(nodes[current]);
   for(let candidate=0;candidate<nodes.length;candidate++){
    if(!visited.has(candidate) && overlap(nodes[current].annotation,nodes[candidate].annotation)){
     visited.add(candidate);pending.push(candidate);
    }
   }
  }
  components.push(component);
 }
 return components;
}

/** Compare two complete blind submissions without treating unlabelled characters as negative examples. */
export function compareAnnotationSubmissions(batch,reviewerA,reviewerB,catalogIds){
 validateAnnotationSubmission(batch,reviewerA,catalogIds);
 validateAnnotationSubmission(batch,reviewerB,catalogIds);
 if(reviewerA.reviewerId===reviewerB.reviewerId || reviewerA.submissionId===reviewerB.submissionId)
  throw new RangeError('Adjudication requires two distinct reviewers and submissions');
 const aDocs=new Map(reviewerA.documents.map(document=>[document.documentId,document.annotations]));
 const bDocs=new Map(reviewerB.documents.map(document=>[document.documentId,document.annotations]));
 const agreements={},issues=[];
 let aTotal=0,bTotal=0,exactSpanMatches=0,exactConceptMatches=0,unflaggedAgreements=0;
 for(const source of batch.documents){
  const a=aDocs.get(source.documentId),b=bDocs.get(source.documentId);aTotal+=a.length;bTotal+=b.length;
  const aBySpan=new Map(a.map(annotation=>[key(annotation),annotation]));
  const bBySpan=new Map(b.map(annotation=>[key(annotation),annotation]));
  const consumedA=new Set(),consumedB=new Set();agreements[source.documentId]=[];
  for(const [spanKey,left] of aBySpan){
   const right=bBySpan.get(spanKey);if(!right)continue;
   consumedA.add(left);consumedB.add(right);exactSpanMatches++;
   if(left.skillId===right.skillId)exactConceptMatches++;
   if(left.skillId===right.skillId && !left.needsAdjudication && !right.needsAdjudication){
    agreements[source.documentId].push(cleanAnnotation(left));unflaggedAgreements++;continue;
   }
   const type=left.skillId===right.skillId ? 'flagged':'concept';
   issues.push({issueId:issueId(source.documentId,type,[left],[right]),documentId:source.documentId,
    language:source.language,type,reviewerA:sorted([left]),reviewerB:sorted([right])});
  }
  const remainingA=a.filter(annotation=>!consumedA.has(annotation));
  const remainingB=b.filter(annotation=>!consumedB.has(annotation));
  for(const component of disagreementComponents(remainingA,remainingB)){
   const left=component.filter(node=>node.side==='a').map(node=>node.annotation);
   const right=component.filter(node=>node.side==='b').map(node=>node.annotation);
   const type=left.length && right.length ? 'boundary':'missing_mention';
   issues.push({issueId:issueId(source.documentId,type,left,right),documentId:source.documentId,
    language:source.language,type,reviewerA:sorted(left),reviewerB:sorted(right)});
  }
  agreements[source.documentId]=sorted(agreements[source.documentId]);
 }
 issues.sort((left,right)=>left.documentId.localeCompare(right.documentId) ||
  Math.min(...[...left.reviewerA,...left.reviewerB].map(item=>item.start))-Math.min(...[...right.reviewerA,...right.reviewerB].map(item=>item.start)));
 const byType=Object.fromEntries(['concept','boundary','missing_mention','flagged'].map(type=>[type,issues.filter(issue=>issue.type===type).length]));
 const queue={schemaVersion:ANNOTATION_SCHEMAS.queue,catalogVersion:batch.catalogVersion,
  reviewerA:{submissionId:reviewerA.submissionId,reviewerId:reviewerA.reviewerId},
  reviewerB:{submissionId:reviewerB.submissionId,reviewerId:reviewerB.reviewerId},agreements,issues,
  summary:{documents:batch.documents.length,annotations:{reviewerA:aTotal,reviewerB:bTotal},
   exactSpan:{matches:exactSpanMatches,precision:ratio(exactSpanMatches,bTotal),recall:ratio(exactSpanMatches,aTotal),
    f1:aTotal+bTotal ? 2*exactSpanMatches/(aTotal+bTotal):null},
   conceptAgreementOnExactSpans:ratio(exactConceptMatches,exactSpanMatches),agreedAnnotations:unflaggedAgreements,
   issues:issues.length,byType}};
 queue.queueDigest=createHash('sha256').update(JSON.stringify(queue)).digest('hex');
 return queue;
}

export function finalizeAdjudication(batch,reviewerA,reviewerB,decisionSet,catalogIds){
 const queue=compareAnnotationSubmissions(batch,reviewerA,reviewerB,catalogIds);
 if(decisionSet?.schemaVersion!==ANNOTATION_SCHEMAS.decisions || decisionSet.queueDigest!==queue.queueDigest)
  throw new RangeError('Decisions must target the current deterministic adjudication queue');
 requiredString(decisionSet.adjudicatorId,'adjudicatorId');
 assertIsoTimestamp(decisionSet.adjudicatedAt,'adjudicatedAt');
 if(!Array.isArray(decisionSet.decisions))throw new TypeError('Adjudication decisions are required');
 const issues=new Map(queue.issues.map(issue=>[issue.issueId,issue])),decisions=new Map();
 for(const decision of decisionSet.decisions){
  const issue=issues.get(decision.issueId);
  if(!issue || decisions.has(decision.issueId))throw new TypeError('Unknown or duplicate adjudication issue');
  if(!RESOLUTIONS.has(decision.resolution) || !RATIONALES.has(decision.rationale))
   throw new TypeError('Invalid adjudication resolution or rationale');
  if(decision.note!==undefined && (typeof decision.note!=='string' || decision.note.length>1000))
   throw new TypeError('Decision notes must be strings of at most 1000 characters');
  if(decision.resolution==='replace'){
   const source=batch.documents.find(document=>document.documentId===issue.documentId);
   validateAnnotations(decision.annotations,source.text,catalogIds);
   if(!decision.annotations.length)throw new TypeError('Use exclude instead of an empty replacement');
   const disputed=[...issue.reviewerA,...issue.reviewerB],start=Math.min(...disputed.map(annotation=>annotation.start)),
    end=Math.max(...disputed.map(annotation=>annotation.end));
   if(decision.annotations.some(annotation=>annotation.start>=end || annotation.end<=start))
    throw new RangeError('Replacement annotations must overlap the disputed text region');
  }
  else if(decision.annotations!==undefined)throw new TypeError('Only replace decisions may supply annotations');
  decisions.set(decision.issueId,decision);
 }
 if(decisions.size!==issues.size)throw new RangeError('Every disagreement must be explicitly adjudicated');
 const decisionDigest=createHash('sha256').update(JSON.stringify(decisionSet)).digest('hex');
 const resolved=new Map(batch.documents.map(document=>[document.documentId,[...queue.agreements[document.documentId]]]));
 for(const issue of queue.issues){
  const decision=decisions.get(issue.issueId);
  const chosen=decision.resolution==='reviewer_a' ? issue.reviewerA : decision.resolution==='reviewer_b' ? issue.reviewerB :
   decision.resolution==='replace' ? decision.annotations : [];
  resolved.get(issue.documentId).push(...chosen.map(cleanAnnotation));
 }
 const records=batch.documents.map(document=>({documentId:document.documentId,subjectId:document.subjectId,language:document.language,
  split:document.split,catalogVersion:document.catalogVersion,text:document.text,annotations:sorted(resolved.get(document.documentId)),
  sourceSha256:document.sourceSha256,scope:'deidentified_cv_text',consentStatus:document.consentStatus,
  deidentificationStatus:document.deidentificationStatus,annotationStatus:'adjudicated_two_independent_reviewers',
  adjudication:{queueDigest:queue.queueDigest,reviewerSubmissionIds:[reviewerA.submissionId,reviewerB.submissionId],
   decisionDigest,adjudicatorId:decisionSet.adjudicatorId,adjudicatedAt:decisionSet.adjudicatedAt}}));
 validateDataset(records);
 for(const record of records)validateAnnotations(record.annotations,record.text,catalogIds);
 return records;
}

export function auditStageTwoReadiness(batch,{records,minFrenchDocuments=1,minArabicDocuments=1}={}){
 validateAnnotationBatch(batch);
 const counts={fr:0,ar:0,mixed:0};for(const document of batch.documents)counts[document.language]++;
 const reasons=[];
 if(counts.fr<minFrenchDocuments)reasons.push(`Need at least ${minFrenchDocuments} French CV documents`);
 if(counts.ar<minArabicDocuments)reasons.push(`Need at least ${minArabicDocuments} Arabic CV documents`);
 if(batch.documents.some(document=>document.deidentificationStatus!=='confirmed'))reasons.push('Every CV must be de-identified before review');
 if(batch.documents.some(document=>!['confirmed','documented_legal_basis'].includes(document.consentStatus)))
  reasons.push('Every CV needs recorded consent or a documented legal basis');
 if(records){
  validateDataset(records);
  const byId=new Map(records.map(record=>[record.documentId,record]));
  const mismatched=batch.documents.some(document=>{
   const record=byId.get(document.documentId);
   return !record || record.text!==document.text || record.sourceSha256!==document.sourceSha256 ||
    record.catalogVersion!==document.catalogVersion || record.annotationStatus!=='adjudicated_two_independent_reviewers';
  });
  if(records.length!==batch.documents.length || mismatched)
   reasons.push('Every batch document must have completed two-reviewer adjudication');
 }else reasons.push('Adjudicated records have not been supplied');
 return {ready:reasons.length===0,documents:batch.documents.length,languageCounts:counts,reasons};
}

async function readJsonl(path){
 return (await readFile(path,'utf8')).split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));
}
async function readJson(path){return JSON.parse(await readFile(path,'utf8'));}
async function writeJson(path,value){await writeFile(path,`${JSON.stringify(value,null,2)}\n`,'utf8');}
async function writeJsonl(path,records){await writeFile(path,`${records.map(record=>JSON.stringify(record)).join('\n')}\n`,'utf8');}

async function catalogFor(path,batch){return catalogSkillIds(await readJson(path),batch);}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [command,...args]=process.argv.slice(2);
  if(command==='prepare'){
   const [goldPath,batchPath]=args;if(!goldPath || !batchPath)throw new Error('prepare requires INPUT.jsonl OUTPUT.json');
   const batch=prepareAnnotationBatch(await readJsonl(goldPath));await writeJson(batchPath,batch);
   console.log(JSON.stringify(auditStageTwoReadiness(batch),null,2));
  }else if(command==='start'){
   const [batchPath,reviewerId,submissionId,outputPath]=args;if(!outputPath)throw new Error('start requires BATCH.json REVIEWER_ID SUBMISSION_ID OUTPUT.json');
   const submission=createBlankAnnotationSubmission(await readJson(batchPath),{reviewerId,submissionId});await writeJson(outputPath,submission);
   console.log(JSON.stringify({created:true,submissionId,documents:submission.documents.length},null,2));
  }else if(command==='validate'){
   const [batchPath,submissionPath,catalogPath]=args;if(!catalogPath)throw new Error('validate requires BATCH.json SUBMISSION.json CATALOG.json');
   const batch=await readJson(batchPath),submission=await readJson(submissionPath);
   validateAnnotationSubmission(batch,submission,await catalogFor(catalogPath,batch));
   console.log(JSON.stringify({valid:true,submissionId:submission.submissionId,documents:submission.documents.length},null,2));
  }else if(command==='compare'){
   const [batchPath,aPath,bPath,catalogPath,queuePath]=args;if(!queuePath)throw new Error('compare requires BATCH.json REVIEWER_A.json REVIEWER_B.json CATALOG.json QUEUE.json');
   const batch=await readJson(batchPath),a=await readJson(aPath),b=await readJson(bPath);
   const queue=compareAnnotationSubmissions(batch,a,b,await catalogFor(catalogPath,batch));await writeJson(queuePath,queue);
   console.log(JSON.stringify(queue.summary,null,2));
  }else if(command==='finalize'){
   const [batchPath,aPath,bPath,catalogPath,decisionsPath,outputPath]=args;if(!outputPath)throw new Error('finalize requires BATCH.json REVIEWER_A.json REVIEWER_B.json CATALOG.json DECISIONS.json OUTPUT.jsonl');
   const batch=await readJson(batchPath),a=await readJson(aPath),b=await readJson(bPath),decisions=await readJson(decisionsPath);
   const records=finalizeAdjudication(batch,a,b,decisions,await catalogFor(catalogPath,batch));await writeJsonl(outputPath,records);
   console.log(JSON.stringify(auditStageTwoReadiness(batch,{records}),null,2));
  }else if(command==='audit'){
   const [batchPath,recordsPath]=args;if(!batchPath)throw new Error('audit requires BATCH.json [ADJUDICATED.jsonl]');
   const batch=await readJson(batchPath),records=recordsPath ? await readJsonl(recordsPath):undefined;
   const result=auditStageTwoReadiness(batch,{records});console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=2;
  }else throw new Error('Usage: node annotation-workflow.mjs prepare|start|validate|compare|finalize|audit ...');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
