import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendDirections} from '../dist/index.js';

const profile={currentRomeCode:'M1405',confirmedInterestCodes:[7]};
const requirement=(ogr,state,kind='savoir_faire')=>({skillId:`rome:${ogr}`,romeOgr:ogr,
  label:`Pratique ${ogr}`,requirementKind:kind,state,evidenceId:state==='supported'?'evidence-1':null});
const direction=(id,reasons,requirements)=>({id:`rome:${id}`,romeCode:id,title:`Métier ${id}`,reasons,requirements});
const mobility=(toCodeRome,sourceOrder)=>({kind:'rome_mobility',fromCodeRome:'M1405',toCodeRome,sourceOrder,releaseId:'release-1'});
const interest=code=>({kind:'rome_interest_centre',centreCode:code,centreLabel:'Créer',principal:true,releaseId:'release-1'});

test('shortlist prioritizes confirmed interests, retains source links, and asks a concrete question',()=>{
 const possibilities=[
  direction('M1410',[mobility('M1410',1)],[requirement('11','unknown')]),
  direction('M1420',[mobility('M1420',2),interest(7)],[requirement('22','unknown','savoir'),requirement('23','unknown')]),
  direction('M1430',[interest(9)],[requirement('33','supported')]),
 ];
 const result=recommendDirections(profile,possibilities,3);
 assert.deepEqual(result.map(item=>item.directionId),['rome:M1420','rome:M1430','rome:M1410']);
 assert.equal(result[0].signals[0].sourceId,'interest:release-1:7:M1420');
 assert.equal(result[0].nextStep.requirementId,'23','a practical unknown requirement is selected first');
 assert.equal(result[0].nextStep.kind,'confirm');
 assert.ok(!JSON.stringify(result).includes('score'));
});

test('confirmed practice and development lead to distinct next actions without inferred mastery',()=>{
 const shared={kind:'rome_shared_skills',fromCodeRome:'M1405',sharedSkillOgrs:['1','2'],originSkillCount:5,releaseId:'release-1'};
 const [practice]=recommendDirections(profile,[direction('M1410',[shared],
  [requirement('1','supported'),requirement('2','development_needed')])]);
 assert.equal(practice.nextStep.kind,'practice');
 assert.equal(practice.confirmedCount,1);
 assert.equal(practice.signals.find(item=>item.kind==='personal_confirmation').sourceId,'confirmation:evidence-1');
 const [conversation]=recommendDirections(profile,[direction('M1410',[shared],[requirement('1','supported')])]);
 assert.equal(conversation.nextStep.kind,'conversation');
 assert.throws(()=>recommendDirections(profile,[],0),RangeError);
});

test('the next confirmation targets a skill shared by several directions',()=>{
 const possibilities=[
  direction('M1410',[mobility('M1410',1)],[requirement('solo','unknown'),requirement('shared','unknown')]),
  direction('M1420',[mobility('M1420',2)],[requirement('shared','unknown')]),
 ];
 const result=recommendDirections(profile,possibilities);
 assert.equal(result[0].nextStep.requirementId,'shared');
 assert.equal(result[0].nextStep.linkedDirections,2);
 assert.match(result[0].nextStep.label,/2 pistes/);
});

test('a preferred domain is a hard boundary even when an unrelated role has more interests',()=>{
 const finance={...direction('C1202',[],[requirement('finance','unknown')]),
  romeProfile:{professionalDomains:[{code:'C12',label:'Finance'}]},
  reasons:[{kind:'rome_domain',domainCode:'C12',domainLabel:'Finance',releaseId:'release-1'}]};
 const media={...direction('E1401',[interest(7),interest(8)],[requirement('marketing','supported')]),
  romeProfile:{professionalDomains:[{code:'E14',label:'Publicité'}]}};
 const results=recommendDirections({...profile,preferredDomainCode:'C12',confirmedInterestCodes:[7,8]},[media,finance]);
 assert.deepEqual(results.map(item=>item.directionId),['rome:C1202']);
 assert.equal(results[0].signals[0].kind,'domain');
 assert.match(results[0].rankingNote,/aucune affinité personnelle établie/);
 assert.equal(results[0].nextStep.requirementId,'finance');
 assert.deepEqual(recommendDirections({...profile,preferredDomainCode:'C12'},[media]),[]);
});

test('a declared starting occupation remains visible in its domain while a confirmed interest may lead',()=>{
 const inDomain=code=>({...direction(code,[{kind:'rome_domain',domainCode:'C12',domainLabel:'Banque',releaseId:'release-1'}],[requirement(code,'unknown')]),
  romeProfile:{professionalDomains:[{code:'C12',label:'Banque'}]}});
 const many=['C1201','C1202','C1203','C1204','C1205','C1206'].map(inDomain);
 const profile={currentRomeCode:'C1206',preferredDomainCode:'C12',confirmedInterestCodes:[]};
 const ranked=recommendDirections(profile,many,5);
 assert.equal(ranked[0].directionId,'rome:C1206');
 assert.equal(ranked[0].signals.find(s=>s.kind==='starting_occupation').sourceId,'profile:starting-occupation:C1206');
 assert.match(ranked[0].rankingNote,/point de départ/);
 const interested={...many[0],reasons:[...many[0].reasons,interest(7)]};
 assert.equal(recommendDirections({...profile,confirmedInterestCodes:[7]},[interested,...many.slice(1)],5)[0].directionId,'rome:C1201');
 assert.deepEqual(recommendDirections({...profile,preferredDomainCode:'C13'},many),[]);
});
