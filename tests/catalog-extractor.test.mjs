import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCatalogSkills,linkSkillMentions} from '../evaluation/cv-skills/catalog-extractor.mjs';
const catalog={version:'test-v1',concepts:[{uri:'office',type:'skill',labels:{fr:'Microsoft Office',en:'Office suite'},alternatives:{fr:['Pack Office']}},{uri:'python',type:'skill',labels:{fr:'Python'},alternatives:{}}]};
test('catalog extractor links a frozen catalog without matching inside another word',()=>{
 const result=extractCatalogSkills({documentId:'cv',language:'fr',text:'Python Pythonista'},catalog),spans=result.spans;
 assert.equal(result.algorithmVersion,'praxis-esco-retrieve-rank-v1');assert.equal(result.catalogVersion,'test-v1');
 assert.equal(spans.length,1);assert.deepEqual({start:spans[0].start,end:spans[0].end,decision:spans[0].decision,
  skillId:spans[0].skillId,candidates:spans[0].candidates},{start:0,end:6,decision:'linked',skillId:'python',candidates:['python']});
 assert.equal(spans[0].ranking[0].rankScore,1);assert.equal(spans[0].reason,'accepted');
});
test('expanded aliases preserve original Unicode offsets through ligature normalization',()=>{
 const record={documentId:'cv',language:'fr',text:'😀 Pack Oﬃce'};
 assert.equal(extractCatalogSkills(record,catalog).spans.length,0);
 const span=extractCatalogSkills(record,catalog,{expanded:true}).spans[0];
 assert.deepEqual({start:span.start,end:span.end,decision:span.decision,skillId:span.skillId,candidates:span.candidates},
  {start:2,end:11,decision:'linked',skillId:'office',candidates:['office']});
});
test('detector-supplied mentions can be NIL or abstain from an ambiguous ESCO link',()=>{
 const ambiguous={version:'v',concepts:[
  {uri:'analysis-a',type:'skill',labels:{fr:'Analyse'},alternatives:{}},
  {uri:'analysis-b',type:'skill',labels:{fr:'Analyse'},alternatives:{}},
 ]};
 const record={documentId:'cv',language:'fr',text:'Analyse inconnue'};
 const abstained=linkSkillMentions(record,ambiguous,[{start:0,end:7}]).spans[0];
 assert.equal(abstained.decision,'abstain');assert.equal(abstained.skillId,null);
 assert.deepEqual(abstained.candidates,['analysis-a','analysis-b']);assert.equal(abstained.reason,'ambiguous_margin');
 const nil=linkSkillMentions(record,ambiguous,[{start:8,end:16}],{minimumRetrievalScore:.9}).spans[0];
 assert.equal(nil.decision,'nil');assert.equal(nil.skillId,null);assert.deepEqual(nil.candidates,[]);
});
test('linker validates thresholds and Unicode mention offsets',()=>{
 const record={documentId:'cv',language:'fr',text:'😀 Python'};
 assert.throws(()=>linkSkillMentions(record,catalog,[{start:2,end:8}],{nilThreshold:.9,linkThreshold:.8}),/cannot exceed/);
 assert.throws(()=>linkSkillMentions(record,catalog,[{start:2,end:10}]),/Unicode code points/);
 assert.equal(linkSkillMentions(record,catalog,[{start:2,end:8}]).spans[0].decision,'linked');
});
