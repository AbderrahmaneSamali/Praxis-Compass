import {readFile,writeFile} from 'node:fs/promises';
import {evaluate} from './evaluate.mjs';
import {extractCatalogSkills} from './catalog-extractor.mjs';

const directory=new URL('./pilot/',import.meta.url);
const gold=(await readFile(new URL('gold.jsonl',directory),'utf8')).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const catalog=JSON.parse(await readFile(new URL('catalog.json',directory),'utf8'));
const ids=new Set(catalog.concepts.filter(c=>c.type==='skill').map(c=>c.uri));
for(const record of gold){if(record.catalogVersion!==catalog.version)throw new Error('Frozen catalog version mismatch');for(const span of record.annotations)if(span.skillId!==null && !ids.has(span.skillId))throw new Error('Gold annotation refers to an unknown catalog skill');}
const outputs={};
const linkerVersions=new Set();
for(const [name,expanded] of [['preferred-labels',false],['multilingual-alternatives',true]]){
 const predictions=gold.map(record=>extractCatalogSkills(record,catalog,{expanded}));
 for(const prediction of predictions)linkerVersions.add(prediction.algorithmVersion);
 await writeFile(new URL(`${name}.predictions.jsonl`,directory),predictions.map(record=>JSON.stringify(record)).join('\n')+'\n');
 outputs[name]={development:evaluate(gold,predictions,{split:'dev'}),test:evaluate(gold,predictions,{split:'test'})};
}
const report={kind:'provisional_local_real_cv_excerpt_pilot',catalogVersion:catalog.version,
 linkerAlgorithmVersions:[...linkerVersions].sort(),
 documents:gold.length,subjects:new Set(gold.map(record=>record.subjectId)).size,
 annotationStatus:'single agent annotation; independent human adjudication pending',
 scope:'French skill-section excerpts from real local CVs; no real Arabic or full-document claims',results:outputs};
await writeFile(new URL('results.json',directory),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
