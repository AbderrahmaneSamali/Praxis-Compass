import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,validateDataset} from '../evaluation/cv-skills/evaluate.mjs';

const record={documentId:'cv',subjectId:'person',language:'fr',split:'test',catalogVersion:'v1',text:'Python inconnu',annotations:[{start:0,end:6,skillId:'python'},{start:7,end:14,skillId:null}]};
test('CV evaluation penalizes misses and separates extraction from linking errors',()=>{
 const result=evaluate([record],[{documentId:'cv',spans:[{start:0,end:6,skillId:'wrong',candidates:['wrong','python']}]}]).overall;
 assert.equal(result.extraction.precision,1);assert.equal(result.extraction.recall,.5);
 assert.equal(result.endToEndLinking.f1,0);assert.equal(result.retrievalOnMatchedNonNilSpans.recallAt1,0);
 assert.equal(result.retrievalOnMatchedNonNilSpans.recallAt3,1);assert.equal(result.nil.recall,0);
 assert.equal(evaluate([record],[]).overall.extraction.recall,0);
});
test('NIL false positives are counted and missing denominators stay undefined',()=>{
 const result=evaluate([record],[{documentId:'cv',spans:[{start:7,end:14,skillId:null,candidates:[]},{start:0,end:5,skillId:null,candidates:[]}]}]).overall;
 assert.equal(result.nil.precision,.5);assert.equal(result.nil.recall,1);
 assert.equal(result.retrievalOnMatchedNonNilSpans.recallAt1,null);
});
test('CV evaluator rejects subject leakage, unknown documents, duplicate spans and empty datasets',()=>{
 assert.throws(()=>validateDataset([record,{...record,documentId:'other',split:'dev'}]),/both dev and test/);
 assert.throws(()=>evaluate([record],[{documentId:'unknown',spans:[]}]),/Unknown/);
 const span={start:0,end:6,skillId:'python',candidates:['python']};
 assert.throws(()=>evaluate([record],[{documentId:'cv',spans:[span,span]}]),/Duplicate span/);
 assert.throws(()=>evaluate([],[]),/No annotated/);
});
test('Arabic and supplementary characters use Unicode code-point offsets',()=>{
 const arabic={...record,language:'ar',text:'😀 تحليل',annotations:[{start:2,end:7,skillId:'analysis'}]};
 const result=evaluate([arabic],[{documentId:'cv',spans:[{start:2,end:7,skillId:'analysis',candidates:['analysis']}]}]);
 assert.equal(result.byLanguage.ar.endToEndLinking.f1,1);
 assert.throws(()=>evaluate([arabic],[{documentId:'cv',spans:[{start:2,end:8,skillId:'analysis',candidates:['analysis']}]}]),/Unicode code points/);
});
test('test scores exclude development documents',()=>{
 const dev={...record,documentId:'dev',subjectId:'another',split:'dev'};
 assert.equal(evaluate([record,dev],[]).overall.documents,1);
});
