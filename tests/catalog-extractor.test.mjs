import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCatalogSkills} from '../evaluation/cv-skills/catalog-extractor.mjs';
const catalog={concepts:[{uri:'office',type:'skill',labels:{fr:'Microsoft Office',en:'Office suite'},alternatives:{fr:['Pack Office']}},{uri:'python',type:'skill',labels:{fr:'Python'},alternatives:{}}]};
test('catalog extractor links a frozen catalog without matching inside another word',()=>{
 const spans=extractCatalogSkills({documentId:'cv',language:'fr',text:'Python Pythonista'},catalog).spans;
 assert.equal(spans.length,1);assert.deepEqual(spans[0],{start:0,end:6,skillId:'python',candidates:['python']});
});
test('expanded aliases preserve original Unicode offsets through ligature normalization',()=>{
 const record={documentId:'cv',language:'fr',text:'😀 Pack Oﬃce'};
 assert.equal(extractCatalogSkills(record,catalog).spans.length,0);
 assert.deepEqual(extractCatalogSkills(record,catalog,{expanded:true}).spans[0],{start:2,end:11,skillId:'office',candidates:['office']});
});
