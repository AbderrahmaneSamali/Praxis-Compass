import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCareerGraph, CareerGraphInputError, assemblePossibilities} from '../dist/index.js';

const profile = {preferredDomainCode:'C12',preferredDomainLabel:'Banque',currentRomeCode:'C1200'};
const source = {label:'France Travail',reference:'rome:release:item:100',reviewStatus:'official_source'};
const skill = (id,state='unknown',kind='savoir_faire') => ({skillId:`rome:${id}`,romeOgr:String(id),label:`Compétence ${id}`,
  requirementKind:kind,state,evidenceType:null,evidenceId:null,source,targetLevel:null});
const job = (index,requirements=[skill(100)],domain='C12') => ({id:`rome:C12${String(index).padStart(2,'0')}`,
  romeCode:`C12${String(index).padStart(2,'0')}`,title:`Métier ${String(index).padStart(2,'0')}`,saved:index===0,
  romeProfile:{professionalDomains:[{code:domain}],releaseId:'release'},requirements,sources:[source],
  reasons:[{kind:'rome_domain',domainCode:domain,domainLabel:'Banque',releaseId:'release'}]});

test('complete candidates are paginated without losing the current job or admitting another domain',()=>{
  const jobs=Array.from({length:17},(_,i)=>job(i));jobs.push(job(90,[],'C13'));
  const ids=[];
  for(let page=0;page<5;page++){
    const graph=buildCareerGraph(profile,jobs,{page});assert.equal(graph.total,17);assert.equal(graph.pageCount,5);
    ids.push(...graph.pageIds);
    if(page===0)assert.equal(graph.careers[0].current,true);
  }
  assert.equal(new Set(ids).size,17);assert.equal(ids.length,17);
  assert.equal(buildCareerGraph(profile,jobs,{page:99}).page,4);
});

test('expansion merges shared skills and exposes real requirement edges and evidence states',()=>{
  const jobs=[job(0,[skill(100,'supported'),skill(200)]),job(1,[skill(100,'supported'),skill(201,'development_needed')]),job(2,[skill(202)])];
  const graph=buildCareerGraph(profile,jobs,{expandedIds:[jobs[0].id,jobs[1].id]});
  assert.equal(graph.skills.length,3);
  const shared=graph.skills.find(item=>item.requirementId==='100');
  assert.equal(shared.state,'supported');assert.equal(shared.linkedCareers.length,2);
  assert.equal(graph.edges.filter(edge=>edge.to===shared.id).length,2);
  for(const edge of graph.edges.filter(edge=>edge.kind==='requirement')){
    assert.equal(edge.references[0].releaseId,'release');assert.ok(edge.references[0].itemId);assert.ok(edge.references[0].codeRome);
  }
  assert.equal(graph.careers[0].levelAvailability,'unavailable');
  const unknown=buildCareerGraph(profile,jobs,{expandedIds:[jobs[0].id,jobs[1].id],skillState:'unknown'});
  assert.deepEqual(unknown.skills.map(item=>item.requirementId),['200']);
  assert.ok(unknown.skills.every(item=>item.state==='unknown'));
});

test('every requirement is accessible and expanded targets remain visible across pages',()=>{
  const jobs=Array.from({length:8},(_,i)=>job(i,Array.from({length:19},(_,j)=>skill(100+j))));
  const ids=[];
  const pages=buildCareerGraph(profile,jobs,{expandedIds:[jobs[0].id]}).skillPageCount;
  for(let skillPage=0;skillPage<pages;skillPage++){
    const graph=buildCareerGraph(profile,jobs,{page:1,expandedIds:[jobs[0].id],skillPage});
    assert.equal(graph.skillTotal,19);assert.equal(graph.careers.find(item=>item.id===jobs[0].id).pinned,true);
    ids.push(...graph.skills.map(item=>item.id));
  }
  assert.equal(new Set(ids).size,19);assert.equal(ids.length,19);
});

test('selection filters, distinct requirement types, invalid options and scope isolation',()=>{
  const jobs=[job(0,[skill(100,'supported'),skill(100,'unknown','savoir')]),job(1),job(9,[],'C13')];
  assert.equal(buildCareerGraph(profile,jobs,{filter:'saved'}).filteredTotal,1);
  assert.equal(buildCareerGraph(profile,jobs,{filter:'practiced'}).filteredTotal,1);
  assert.equal(buildCareerGraph(profile,jobs,{expandedIds:[jobs[0].id]}).skills.length,2);
  assert.equal(buildCareerGraph(profile,jobs,{expandedIds:[jobs[0].id],skillKind:'savoir'}).skills.length,1);
  for(const options of [{page:-1},{pageSize:100},{skillPage:1.2},{skillState:'mastered'},{expandedIds:[jobs[2].id]},
    {expandedIds:[jobs[0].id,jobs[0].id]},{expandedIds:null},{filter:'invented'}]){
    assert.throws(()=>buildCareerGraph(profile,jobs,options),CareerGraphInputError);
  }
  assert.equal(buildCareerGraph(profile,[]).total,0);
});

test('unlimited source assembly preserves every domain occupation including the origin when requested',()=>{
  const domain=Array.from({length:23},(_,i)=>({codeRome:`C${i}`,label:`Métier ${i}`,riasec:null,reasons:[]}));
  const sources={originCodeRome:'C0',domain,mobility:[],interests:[],sharedSkills:[]};
  assert.equal(assemblePossibilities(sources,8).domain.items.length,8);
  assert.equal(assemblePossibilities({...sources,includeOrigin:true},null).domain.items.length,23);
  assert.equal(assemblePossibilities(sources,null).domain.items.length,22);
});
