import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvidenceProfile,exploreDirections,compareDirections} from '../dist/index.js';

const learnerId='learner-one',now=new Date('2026-09-24T12:00:00.000Z');
const source={label:'Données de démonstration',reference:'demo-v1',reviewStatus:'demo_unreviewed'};
const directions=[
 {id:'analyst',roleId:'role-analyst',kind:'adjacent_role',title:'Analyste',description:'Analyser',
  responsibilities:['Examiner des données'],interestTags:['données'],sources:[source],
  requirements:[{skillId:'analysis',label:'Analyse',targetLevel:2,importance:3,source},
   {skillId:'communication',label:'Communication',targetLevel:2,importance:2,source}]},
 {id:'growth',roleId:'role-analyst',kind:'current_role_growth',title:'Progression',description:'Approfondir',
  responsibilities:['Présenter'],interestTags:['données'],sources:[source],
  requirements:[{skillId:'analysis',label:'Analyse',targetLevel:3,importance:3,source}]},
 {id:'finance',roleId:'role-finance',kind:'specialization',title:'Finance',description:'Étudier',
  responsibilities:['Examiner des comptes'],interestTags:['finance'],sources:[source],
  requirements:[{skillId:'communication',label:'Communication',targetLevel:2,importance:2,source}]},
];
const profile={learnerId,currentRoleId:null,experience:'',interests:'',constraints:'',updatedAt:null};
const context={learnerId,constraints:{remoteOnly:true,hoursPerWeek:8}};
const evidence=(skillId,level,id,observedAt=now)=>({id,learnerId,skillId,level,evidenceType:'self_declared',confidence:'low',observedAt,supersededBy:null,provenance:{source:'test'}});
const resolved=rows=>buildEvidenceProfile(context,rows,{now});

test('incomplete profiles can explore catalog directions without courses; unknown stays unknown',()=>{
 const result=exploreDirections(profile,directions,resolved([]));
 assert.deepEqual(result.possibilities.map(item=>item.id),['analyst','finance']);
 assert.ok(result.questions.length>0);
 assert.equal(result.possibilities[0].requirements[0].state,'unknown');
 assert.equal(result.possibilities[0].requirements[0].observedLevel,null);
 assert.ok(result.possibilities[0].startingActions.some(item=>item.kind==='evidence_check'));
});

test('a self-declared level can satisfy a requirement without becoming verified mastery',()=>{
 const result=exploreDirections({...profile,currentRoleId:'role-analyst',interests:'données'},directions,resolved([evidence('analysis',2,'a')]));
 const analyst=result.possibilities.find(item=>item.id==='analyst');
 assert.equal(analyst.requirements[0].state,'supported');
 assert.equal(analyst.requirements[0].evidenceType,'self_declared');
 assert.equal(analyst.requirements[0].evidenceStrength,'low');
 assert.equal(result.possibilities.find(item=>item.id==='growth').requirements[0].state,'development_needed');
 assert.deepEqual(result.evidence.selectedEvidence.map(item=>item.level),[2]);
 assert.ok(analyst.startingActions.every(action=>action.output&&action.completionCriteria&&action.unlocks));
});

test('contradictions remain visible and comparison preserves requirements',()=>{
 const result=exploreDirections(profile,directions,resolved([evidence('communication',1,'a'),evidence('communication',3,'b')]));
 const analyst=result.possibilities.find(item=>item.id==='analyst');
 assert.equal(analyst.requirements[1].state,'conflicting');
 const compared=compareDirections(result.possibilities,['analyst','finance']);
 assert.equal(compared[0].requirements[1].state,'conflicting');
 assert.equal(compared[1].requirements[0].state,'conflicting');
 assert.throws(()=>compareDirections(result.possibilities,['analyst','analyst']),/distinctes/);
});

test('a resolved disagreement stays visible alongside the selected level',()=>{
 const earlier=new Date('2026-09-23T12:00:00.000Z');
 const result=exploreDirections(profile,directions,resolved([evidence('analysis',1,'a',earlier),evidence('analysis',3,'b')]));
 const analysis=result.possibilities[0].requirements[0];
 assert.equal(analysis.state,'supported');
 assert.equal(analysis.disagreementResolution,'confidence_then_recency');
 assert.ok(result.possibilities[0].uncertainties.some(item=>item.includes('preuves divergentes')));
});

test('choosing an action leaves evidence and levels unchanged',()=>{
 const current=resolved([]);
 const result=exploreDirections(profile,directions,current);
 const action=result.possibilities[0].startingActions[0];
 assert.ok(action.id);
 assert.equal(result.evidence.selectedEvidence.length,0);
 assert.equal(result.possibilities[0].requirements[0].state,'unknown');
});
