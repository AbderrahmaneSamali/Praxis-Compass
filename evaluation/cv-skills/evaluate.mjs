import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const key=span=>`${span.start}:${span.end}`;
const concept=id=>id===null || (typeof id==='string' && id.trim().length>0);
const ratio=(numerator,denominator)=>denominator ? numerator/denominator : null;
const prf=(correct,predicted,gold)=>({correct,predicted,gold,precision:ratio(correct,predicted),recall:ratio(correct,gold),f1:predicted+gold ? 2*correct/(predicted+gold) : null});

export function validateDataset(records){
 const documents=new Set(),subjects=new Map(),versions=new Set();
 for(const record of records){
  if(!record.documentId?.trim() || documents.has(record.documentId))throw new TypeError('documentId must be nonempty and unique');
  documents.add(record.documentId);
  if(!record.subjectId?.trim() || !record.catalogVersion?.trim())throw new TypeError('subjectId and catalogVersion are required');
  versions.add(record.catalogVersion);
  if(!['dev','test'].includes(record.split) || !['fr','ar','mixed'].includes(record.language))throw new TypeError('Invalid split or language');
  if(subjects.has(record.subjectId) && subjects.get(record.subjectId)!==record.split)throw new RangeError('A subject appears in both dev and test');
  subjects.set(record.subjectId,record.split);
  if(typeof record.text!=='string' || !Array.isArray(record.annotations))throw new TypeError('Text and annotations are required');
  validateSpans(record.annotations,record.text,false);
 }
 if(versions.size>1)throw new RangeError('Use one frozen catalog version per benchmark');
 return records;
}
function validateSpans(spans,text,prediction){
 const seen=new Set(),length=Array.from(text).length;
 for(const span of spans){
  if(!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start<0 || span.end<=span.start || span.end>length)
   throw new RangeError('Span offsets must be Unicode code points with an exclusive end');
  if(seen.has(key(span)))throw new TypeError('Duplicate span');seen.add(key(span));
  if(!concept(span.skillId))throw new TypeError('skillId must be a catalog ID or null (NIL)');
  if(prediction && (!Array.isArray(span.candidates) || span.candidates.length>10 ||
    span.candidates.some(id=>id===null || !concept(id)) || new Set(span.candidates).size!==span.candidates.length ||
    (span.skillId!==null && !span.candidates.includes(span.skillId))))
   throw new TypeError('Predictions need up to ten unique ranked candidates containing the selected non-NIL ID');
  if(prediction && span.decision!==undefined && (!['linked','nil','abstain'].includes(span.decision) ||
    (span.decision==='linked')!==(span.skillId!==null)))
   throw new TypeError('Decision must be linked with a skillId, or nil/abstain with a null skillId');
 }
}

/** Exact spans and exact catalog IDs; missing predictions count as false negatives. */
export function evaluate(gold,predictions,{split='test'}={}){
 validateDataset(gold);
 if(!['dev','test'].includes(split))throw new TypeError('Choose dev or test');
 const docs=new Map(gold.map(record=>[record.documentId,record])),byDocument=new Map();
 for(const prediction of predictions){
  const record=docs.get(prediction.documentId);
  if(!record || byDocument.has(prediction.documentId))throw new TypeError('Unknown or duplicate prediction document');
  if(!Array.isArray(prediction.spans))throw new TypeError('Prediction spans are required');
  validateSpans(prediction.spans,record.text,true);byDocument.set(prediction.documentId,prediction.spans);
 }
 const selected=gold.filter(record=>record.split===split);
 if(!selected.length)throw new RangeError(`No annotated ${split} documents; no benchmark score can be reported`);
 const summarize=records=>{
  let goldCount=0,predictedCount=0,matched=0,linked=0,goldNil=0,predictedNil=0,correctNil=0,matchedLinked=0,
   acceptedLinked=0,correctAcceptedLinked=0,abstained=0,matchedAbstained=0;
  const hits={1:0,3:0,5:0};
  for(const record of records){
   const expected=new Map(record.annotations.map(span=>[key(span),span]));
   const spans=byDocument.get(record.documentId)??[];
   goldCount+=expected.size;predictedCount+=spans.length;goldNil+=record.annotations.filter(span=>span.skillId===null).length;
   for(const span of spans){
    const isAbstention=span.decision==='abstain';
    if(isAbstention)abstained++;else if(span.skillId===null)predictedNil++;
    const annotation=expected.get(key(span));if(!annotation)continue;
    if(isAbstention)matchedAbstained++;
    matched++;if(!isAbstention && span.skillId===annotation.skillId)linked++;
    if(annotation.skillId===null && span.skillId===null && !isAbstention)correctNil++;
    if(annotation.skillId!==null){matchedLinked++;if(span.skillId!==null){acceptedLinked++;if(span.skillId===annotation.skillId)correctAcceptedLinked++;}
     for(const k of [1,3,5])if(span.candidates.slice(0,k).includes(annotation.skillId))hits[k]++;}
   }
  }
  return {documents:records.length,documentsWithPredictions:records.filter(record=>byDocument.has(record.documentId)).length,
   extraction:prf(matched,predictedCount,goldCount),endToEndLinking:prf(linked,predictedCount,goldCount),
   linkingAccuracyOnMatchedSpans:ratio(linked,matched),
   selectiveLinking:{correct:correctAcceptedLinked,accepted:acceptedLinked,eligible:matchedLinked,
    accuracy:ratio(correctAcceptedLinked,acceptedLinked),coverage:ratio(acceptedLinked,matchedLinked)},
   retrievalOnMatchedNonNilSpans:{denominator:matchedLinked,recallAt1:ratio(hits[1],matchedLinked),recallAt3:ratio(hits[3],matchedLinked),recallAt5:ratio(hits[5],matchedLinked)},
   nil:prf(correctNil,predictedNil,goldNil),
   abstention:{predicted:abstained,matched:matchedAbstained,rate:ratio(abstained,predictedCount)}};
 };
 return {split,catalogVersion:selected[0].catalogVersion,offsetUnit:'unicode_code_points',
  overall:summarize(selected),byLanguage:Object.fromEntries(['fr','ar','mixed'].filter(language=>selected.some(record=>record.language===language))
   .map(language=>[language,summarize(selected.filter(record=>record.language===language))]))};
}
async function jsonl(path){return (await readFile(path,'utf8')).split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [goldPath,predictionPath,split='test']=process.argv.slice(2);
  if(!goldPath || !predictionPath)throw new Error('Usage: node evaluation/cv-skills/evaluate.mjs GOLD.jsonl PREDICTIONS.jsonl [dev|test]');
  console.log(JSON.stringify(evaluate(await jsonl(goldPath),await jsonl(predictionPath),{split}),null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
