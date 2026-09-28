import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDevelopmentPlan} from '../dist/exploration/development-plan.js';
import {hashComputationInputs} from '../dist/kernel/computation-provenance.js';
import {ALGORITHM_VERSIONS} from '../dist/kernel/algorithm-versions.js';
import {parseAgentMessage,runAgentTool,validateAgentFinal} from '../dist/agents/career-agent.js';
import {nvidiaProvider} from '../dist/agents/nvidia-provider.js';

function fixture(){
 const input={schemaVersion:'development-case-v1',target:{codeRome:'C1302',title:'Opérations financières',releaseId:'r1',marketCode:null,marketLabel:null,domainCode:'C13',trackCode:null},careerGoal:null,levelAvailability:'market_required',requirements:[],sources:[],confirmations:[],evidence:{adapterVersion:'test',selected:[],ignored:[],conflictingSkillIds:[],disagreements:[]},activities:[],attempts:[]};
 const plan=buildDevelopmentPlan(input);
 const snapshot={schemaVersion:'career-report-v1',versions:{report:ALGORITHM_VERSIONS.careerReport,plan:ALGORITHM_VERSIONS.developmentPlan},profile:{currentCode:null,currentLabel:null,domainCode:'C13',domainLabel:'Finance',marketCode:null,marketLabel:null,trackCode:null,trackLabel:null,interests:[]},context:null,candidates:[{code:'C1302',title:'Opérations financières',description:'',access:[],workContexts:[],releaseId:'r1',domains:[{code:'C13',label:'Finance'}],reasons:[],saved:false,requirements:[],levelAvailability:'market_required',frameworkCount:0}],recommendations:[],targets:[{code:'C1302',input,inputHash:hashComputationInputs(input),plan,outputHash:hashComputationInputs(plan),activities:[]}]};
 return {id:'00000000-0000-4000-8000-000000000001',createdAt:new Date().toISOString(),schemaVersion:'career-report-v1',snapshot,contentHash:hashComputationInputs(snapshot)};
}

test('agent tool requests are strict and can only read frozen report targets',()=>{
 const report=fixture();assert.deepEqual(runAgentTool(report,'get_targets',{})[0].suggestedMilestones.map(m=>m.id),['context:market']);
 assert.throws(()=>runAgentTool(report,'get_requirements',{code:'C1202'}),/out_of_scope_target/);
 assert.throws(()=>runAgentTool(report,'get_targets',{sql:'SELECT *'}),/invalid_tool_arguments/);
 assert.throws(()=>parseAgentMessage('Some advice, not JSON'),/invalid_model_json/);
 assert.throws(()=>parseAgentMessage('{"type":"tool","name":"run_sql","arguments":{}}'),/invalid_tool_request/);
});

test('final advice contains only exact report targets and ready milestones',()=>{
 const report=fixture(),decision={type:'final',order:['C1302'],focus:[{code:'C1302',milestoneId:'context:market'}]};
 const result=validateAgentFinal(report,decision,'google/gemma-4-31b-it','praxis-career-agent-v1');
 assert.equal(result.targets[0].focus.label,'Préciser mon pays');assert.equal(result.targets[0].summary.requirements,0);
 assert.throws(()=>validateAgentFinal(report,{...decision,order:['C1202']},'model','version'),/invalid_final_scope/);
 assert.throws(()=>validateAgentFinal(report,{...decision,focus:[{code:'C1302',milestoneId:'assessment:made-up'}]},'model','version'),/unavailable_milestone/);
});

test('NVIDIA adapter uses the fixed model endpoint and bounded status polling',async()=>{
 const calls=[],requestId='00000000-0000-4000-8000-000000000003';
 const fetcher=async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(JSON.stringify({requestId}),{status:202}):new Response(JSON.stringify({choices:[{message:{content:'{"type":"final"}'}}]}),{status:200});};
 const provider=nvidiaProvider('a'.repeat(24),fetcher);
 assert.equal(await provider([{role:'user',content:'test'}],new AbortController().signal),'{"type":"final"}');
 assert.equal(calls.length,2);assert.equal(calls[0].url,'https://integrate.api.nvidia.com/v1/chat/completions');
 assert.equal(JSON.parse(calls[0].options.body).model,'google/gemma-4-31b-it');
 assert.equal(calls[1].url,'https://integrate.api.nvidia.com/v1/status/'+requestId);
});
