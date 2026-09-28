import test from 'node:test';
import assert from 'node:assert/strict';
import {frameworkContentHash,projectCareerFramework,validateFramework} from '../dist/exploration/career-levels.js';

const fixture=()=>({framework:{id:'FR-pilot',familyId:'finance',marketCode:'FR',version:1,title:'Pilot',scope:'C1302',limitations:'Local only',author:'author',status:'reviewed',reviewer:'reviewer',reviewedAt:'2026-09-27',contentHash:'a'.repeat(64)},
 sources:[{id:'source',title:'Original framework',publisher:'Test',url:null,accessedOn:'2026-09-27',locator:'fixture',supportKind:'authored_proposal',reuseNote:'test',limitations:'test'}],
 levels:[{code:'E1',trackCode:'expertise',label:'Autonomous',order:1,autonomy:'Delegated decisions',scope:'Team',influence:'Peers',managesPeople:false,basis:'editorial_proposal',sourceId:'source'},
 {code:'M1',trackCode:'management',label:'Team manager',order:1,autonomy:'Team decisions',scope:'Team',influence:'Direct reports',managesPeople:true,basis:'editorial_proposal',sourceId:'source'}],
 applicability:['E1','M1'].map(levelCode=>({levelCode,codeRome:'C1302',rationale:'Explicit mapping',sourceId:'source'})),
 requirements:['E1','M1'].map(levelCode=>({id:levelCode+'-autonomy',levelCode,dimension:'autonomy',label:'Autonomy',expectedBehavior:'Demonstrate delegated decisions',skillOgr:null,skillId:null,sourceId:'source'})),
 criteria:['E1','M1'].map(levelCode=>({requirementId:levelCode+'-autonomy',code:'scenario',label:'Choose when to escalate',assessmentMode:'structured_scenario',sourceId:'source'})),
 transitions:[{fromCode:'E1',toCode:'M1',kind:'track_change',rationale:'Explicit reviewed transition',sourceId:'source'}]});

test('career levels require a reviewed framework, matching market and occupation',()=>{
 const b=fixture(),preference={marketCode:'FR',trackCode:null};
 assert.ok(projectCareerFramework(b,'C1302',preference));
 for(const status of ['draft','retired'])assert.equal(projectCareerFramework({...b,framework:{...b.framework,status}},'C1302',preference),null);
 for(const marketCode of ['MA',null])assert.equal(projectCareerFramework(b,'C1302',{...preference,marketCode}),null);
 assert.equal(projectCareerFramework(b,'C1303',preference),null);
});
test('track projection preserves explicit transitions and self-report semantics',()=>{
 const b=fixture(),p=projectCareerFramework(b,'C1302',{marketCode:'FR',trackCode:'expertise'});
 assert.deepEqual(p.levels.map(l=>l.code),['E1']);assert.equal(p.allLevels.length,2);
 assert.equal(p.requirements.length,1);assert.equal(p.criteria.length,1);
 assert.equal(p.currentLevelIsSelfReported,true);assert.equal(p.readiness,'not_assessed');
 assert.deepEqual(p.transitions,b.transitions);
 b.transitions=[];assert.deepEqual(projectCareerFramework(b,'C1302',{marketCode:'FR',trackCode:null}).transitions,[],'display order never invents prerequisites');
 assert.equal(projectCareerFramework(b,'C1302',{marketCode:'FR',trackCode:'project_leadership'}),null);
});
test('framework validation detects missing evidence, bad sources, cycles and wrong transition kinds',()=>{
 const b=fixture();assert.deepEqual(validateFramework(b),[]);
 const missing=structuredClone(b);missing.criteria=[];missing.applicability=[];
 assert.ok(validateFramework(missing).some(x=>x.includes('No evidence')));assert.ok(validateFramework(missing).some(x=>x.includes('No occupation')));
 const bad=structuredClone(b);bad.levels[0].sourceId='missing';bad.transitions[0].kind='progression';
 assert.ok(validateFramework(bad).some(x=>x.includes('Unknown source')));assert.ok(validateFramework(bad).some(x=>x.includes('kind')));
 b.transitions.push({fromCode:'M1',toCode:'E1',kind:'track_change',sourceId:'source'});assert.ok(validateFramework(b).some(x=>x.includes('cycle')));
});
test('review hash binds content and excludes publication metadata',()=>{
 const b=fixture(),original=frameworkContentHash(b);b.framework.status='draft';b.framework.reviewer=null;b.framework.reviewedAt=null;b.framework.contentHash=null;
 assert.equal(frameworkContentHash(b),original);b.requirements[0].expectedBehavior='Changed after review';assert.notEqual(frameworkContentHash(b),original);
});
