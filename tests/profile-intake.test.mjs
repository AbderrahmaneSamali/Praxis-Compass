import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeProfileSkills} from '../dist/index.js';

const catalog=[{skillId:'analysis',label:'Analyse de données'}];
const experience='J’ai préparé un tableau et mené une analyse de données.';

test('provider proposals are catalog-bound, grounded in a verbatim span and carry no level',async()=>{
 const result=await proposeProfileSkills(experience,catalog,async()=>({proposals:[
  {skillId:'analysis',supportingText:'analyse de données',level:4},
  {skillId:'invented',supportingText:'J’ai préparé un tableau'},
  {skillId:'analysis',supportingText:'analyse de données'}]}));
 assert.deepEqual(result.proposals,[{skillId:'analysis',label:'Analyse de données',supportingText:'analyse de données'}]);
 assert.equal(result.proposals[0].level,undefined);
});

test('AI failure and no provider leave the manual flow available',async()=>{
 assert.deepEqual(await proposeProfileSkills(experience,catalog),{proposals:[],status:'unavailable'});
 assert.deepEqual(await proposeProfileSkills(experience,catalog,async()=>{throw new Error('down');}),
  {proposals:[],status:'unavailable'});
 assert.deepEqual(await proposeProfileSkills(experience,catalog,async()=>({proposals:[{skillId:'analysis',supportingText:'unsupported text'}]})),
  {proposals:[],status:'proposed'});
});
