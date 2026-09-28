import test from 'node:test';
import assert from 'node:assert/strict';
import {hashComputationInputs} from '../dist/kernel/computation-provenance.js';
import {ALGORITHM_VERSIONS} from '../dist/kernel/algorithm-versions.js';
import {buildDevelopmentPlan,DEVELOPMENT_CASE_SCHEMA} from '../dist/exploration/development-plan.js';
import {CAREER_REPORT_SCHEMA,careerReportDocument,verifyCareerReport} from '../dist/exploration/career-report.js';
import {renderCareerReportHtml,renderCareerReportPdf} from '../dist/exploration/career-report.render.js';
import {PDFDocument} from 'pdf-lib';

function fixture(){
 const input={schemaVersion:DEVELOPMENT_CASE_SCHEMA,target:{codeRome:'C1302',title:'Marchés financiers',releaseId:'release',marketCode:'FR',marketLabel:'France',domainCode:'C13',trackCode:null},careerGoal:null,levelAvailability:'unavailable',
  requirements:[{id:'occupation:savoir_faire:12',kind:'occupation',label:'Contrôler un lot',dimension:'savoir_faire',skillOgr:'12',skillId:null,expectedBehavior:null,sourceId:'source:12',criteria:[]}],
  sources:[{id:'source:12',label:'Fiche métier',reference:'catalogue:release:12',status:'official_source'}],confirmations:[],
  evidence:{adapterVersion:'adapter',selected:[],ignored:[],conflictingSkillIds:[],disagreements:[]},activities:[],attempts:[]};
 const plan=buildDevelopmentPlan(input),target={code:'C1302',input,inputHash:hashComputationInputs(input),plan,outputHash:hashComputationInputs(plan),activities:[]};
 const candidate={code:'C1302',title:'Marchés financiers',description:'Fiche avec données structurées.',access:['Formation spécialisée'],workContexts:['Bureau'],releaseId:'release',domains:[{code:'C13',label:'Finance'}],
  reasons:[{kind:'rome_domain',domainCode:'C13',domainLabel:'Finance',releaseId:'release'}],saved:false,
  requirements:[{id:'occupation:savoir_faire:12',ogr:'12',kind:'savoir_faire',label:'Contrôler un lot',state:'unknown',sourceReference:'catalogue:release:12',confirmationId:null}],levelAvailability:'unavailable',frameworkCount:0};
 const second={...candidate,code:'C1301',title:'Gestion des opérations',description:'Autre métier.',requirements:[{...candidate.requirements[0],label:'Reconcilier un dossier',id:'occupation:savoir_faire:13',ogr:'13'}]};
 const snapshot={schemaVersion:CAREER_REPORT_SCHEMA,versions:{report:ALGORITHM_VERSIONS.careerReport,plan:ALGORITHM_VERSIONS.developmentPlan},
  profile:{currentCode:null,currentLabel:null,domainCode:'C13',domainLabel:'Finance',marketCode:'FR',marketLabel:'France',trackCode:null,trackLabel:null,interests:[{code:1,label:'Aimer les chiffres'}]},
  context:null,candidates:[second,candidate],recommendations:[],targets:[target]};
 return {id:'00000000-0000-4000-8000-000000000001',createdAt:'2026-09-27T12:00:00.000Z',schemaVersion:CAREER_REPORT_SCHEMA,contentHash:hashComputationInputs(snapshot),snapshot};
}

test('HTML and PDF receive the same complete untruncated document',async()=>{
 const r=fixture(),document=careerReportDocument(r),html=renderCareerReportHtml(r),bytes=await renderCareerReportPdf(r),pdf=await PDFDocument.load(bytes);
 assert.equal(document.candidateCount,2);assert.equal(document.targetCount,1);
 for(const c of r.snapshot.candidates){assert.ok(document.blocks.some(b=>b.anchor===`candidate-${c.code}`));for(const skill of c.requirements)assert.ok(document.blocks.some(b=>b.text.includes(skill.label)));assert.ok(html.includes(c.title));}
 assert.ok(document.blocks.some(b=>b.text.includes('Aucun référentiel de niveaux revu')));assert.ok(document.blocks.some(b=>b.text.includes('Maîtrise professionnelle non établie')));
 assert.ok(html.includes('Gestion des opérations'));assert.ok(html.includes('Télécharger le PDF'));assert.ok(html.includes('Annexe complète (2)'));
 assert.ok(bytes.length>3000);assert.ok(pdf.getPageCount()>=2);assert.match(pdf.getSubject(),new RegExp(r.contentHash));
});
test('snapshot verification rejects modified content, targets, domains and calculated results',()=>{
 const r=fixture();assert.equal(verifyCareerReport(r).verified,true);
 for(const edit of [x=>x.snapshot.candidates.pop(),x=>x.snapshot.targets[0].plan.summary.unknown=0,x=>x.snapshot.profile.domainCode='C12']){
  const copy=structuredClone(r);edit(copy);assert.throws(()=>verifyCareerReport(copy),/integrity mismatch/);
 }
 const wrong=structuredClone(r);wrong.snapshot.candidates[1].domains=[{code:'C12',label:'Banque'}];wrong.contentHash=hashComputationInputs(wrong.snapshot);assert.throws(()=>verifyCareerReport(wrong),/out-of-domain/);
 const changed=structuredClone(r);changed.snapshot.targets[0].plan.summary.unknown=0;changed.snapshot.targets[0].outputHash=hashComputationInputs(changed.snapshot.targets[0].plan);changed.contentHash=hashComputationInputs(changed.snapshot);assert.throws(()=>verifyCareerReport(changed),/replay mismatch/);
 const bad=structuredClone(r);bad.snapshot.candidates[1].requirements[0].state='supported';bad.contentHash=hashComputationInputs(bad.snapshot);assert.throws(()=>verifyCareerReport(bad),/requirement scope mismatch/);
});
test('document encoding escapes saved labels while preserving text content',()=>{
 const r=fixture();r.snapshot.candidates[0].title='<img src=x onerror=alert(1)>';r.contentHash=hashComputationInputs(r.snapshot);
 const html=renderCareerReportHtml(r);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));
});
