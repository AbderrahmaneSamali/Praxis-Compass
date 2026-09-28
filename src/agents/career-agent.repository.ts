import type {Pool} from 'pg';
import {ALGORITHM_VERSIONS} from '../kernel/algorithm-versions.js';
import {CareerReportRepository} from '../exploration/career-report.repository.js';
import {CAREER_AGENT_LIMITS,CAREER_AGENT_SYSTEM,parseAgentMessage,runAgentTool,validateAgentFinal,type AgentMessage} from './career-agent.js';
import {NVIDIA_MODEL,type AgentProvider} from './nvidia-provider.js';

export class CareerAgentError extends Error{constructor(message:string,public readonly status=400){super(message);}}
type RunRow={id:string;reportId:string;reportHash:string;status:string;model:string;policyVersion:string;modelCalls:number;toolCalls:number;result:unknown;errorCode:string|null;createdAt:string;startedAt:string|null;finishedAt:string|null;deadlineAt:string};
const columns=`id,report_id AS "reportId",report_hash AS "reportHash",status,model,policy_version AS "policyVersion",model_calls AS "modelCalls",tool_calls AS "toolCalls",result,error_code AS "errorCode",created_at::text AS "createdAt",started_at::text AS "startedAt",finished_at::text AS "finishedAt",deadline_at::text AS "deadlineAt"`;

/** A single local worker per run. The DB owns state and the in-memory controller only interrupts this process. */
export class CareerAgentRepository{
 private readonly active=new Map<string,AbortController>();
 private readonly reports:CareerReportRepository;
 constructor(private readonly pool:Pool,private readonly provider:AgentProvider|null){this.reports=new CareerReportRepository(pool);}
 get available(){return Boolean(this.provider);}
 async expire(learnerId:string){
  const expired=await this.pool.query<{id:string}>(`UPDATE praxis.career_agent_run SET status='failed',error_code='deadline',finished_at=clock_timestamp()
   WHERE learner_id=$1 AND status IN ('queued','running') AND deadline_at<clock_timestamp() RETURNING id`,[learnerId]);
  for(const row of expired.rows){this.active.get(row.id)?.abort();await this.event(row.id,learnerId,'failed',{code:'deadline'});}
 }
 private async event(id:string,learnerId:string,kind:string,detail:Record<string,unknown>={}){
  await this.pool.query('INSERT INTO praxis.career_agent_event(run_id,learner_id,kind,detail) VALUES($1,$2,$3,$4)',[id,learnerId,kind,JSON.stringify(detail)]);
 }
 async create(learnerId:string,reportId:unknown){
  if(!this.provider)throw new CareerAgentError('Assistance IA non configurée sur ce serveur.',503);
  if(typeof reportId!=='string')throw new CareerAgentError('Choisissez un rapport enregistré.');
  await this.expire(learnerId);
  const report=await this.reports.read(learnerId,reportId);
  let row:RunRow;
  try{
   const result=await this.pool.query<RunRow>(`INSERT INTO praxis.career_agent_run(learner_id,report_id,report_hash,policy_version,model,status,deadline_at)
    VALUES($1,$2,$3,$4,$5,'queued',clock_timestamp()+interval '60 seconds') RETURNING ${columns}`,
    [learnerId,report.id,report.contentHash,ALGORITHM_VERSIONS.careerAgent,NVIDIA_MODEL]);
   row=result.rows[0]!;
  }catch(error){if((error as {code?:string}).code==='23505')throw new CareerAgentError('Une analyse est déjà en cours pour votre session.',409);throw error;}
  await this.event(row.id,learnerId,'queued',{reportId:report.id});
  void this.execute(row.id,learnerId,report).catch(()=>{});
  return row;
 }
 private async execute(id:string,learnerId:string,report:Awaited<ReturnType<CareerReportRepository['read']>>){
  const controller=new AbortController();this.active.set(id,controller);
  const timer=setTimeout(()=>controller.abort(),CAREER_AGENT_LIMITS.deadlineMs);
  const signal=controller.signal;
  try{
   const started=await this.pool.query(`UPDATE praxis.career_agent_run SET status='running',started_at=clock_timestamp()
    WHERE id=$1 AND learner_id=$2 AND status='queued' RETURNING id`,[id,learnerId]);
   if(!started.rowCount)return;
   await this.event(id,learnerId,'started',{model:NVIDIA_MODEL,modelBudget:CAREER_AGENT_LIMITS.modelCalls,toolBudget:CAREER_AGENT_LIMITS.toolCalls});
   const messages:AgentMessage[]=[{role:'system',content:CAREER_AGENT_SYSTEM},{role:'user',content:JSON.stringify({task:'Proposez un ordre de consultation et un jalon disponible par cible, sans inventer de preuve. Commencez par get_targets.',report:{candidateCount:report.snapshot.candidates.length,domain:report.snapshot.profile.domainLabel,market:report.snapshot.profile.marketLabel,targets:report.snapshot.targets.map(t=>({code:t.code,title:t.plan.target.title}))}})}];
   let tools=0;
   for(let call=1;call<=CAREER_AGENT_LIMITS.modelCalls;call++){
    if(signal.aborted)throw new Error('cancelled');
    const state=await this.pool.query(`UPDATE praxis.career_agent_run SET model_calls=model_calls+1 WHERE id=$1 AND learner_id=$2 AND status='running' RETURNING id`,[id,learnerId]);
    if(!state.rowCount)throw new Error('cancelled');
    await this.event(id,learnerId,'model_call',{number:call});
    const content=await this.provider!(messages,signal);
    if(signal.aborted)throw new Error('cancelled');
    const request=parseAgentMessage(content);
    messages.push({role:'assistant',content});
    if(request.type==='final'){
     if(!tools)throw new Error('no_tool_used');
     const result=validateAgentFinal(report,request,NVIDIA_MODEL,ALGORITHM_VERSIONS.careerAgent);
     const finished=await this.pool.query(`UPDATE praxis.career_agent_run SET status='completed',result=$3,finished_at=clock_timestamp()
      WHERE id=$1 AND learner_id=$2 AND status='running' RETURNING id`,[id,learnerId,JSON.stringify(result)]);
     if(finished.rowCount)await this.event(id,learnerId,'completed',{targetCount:result.targets.length});
     return;
    }
    if(tools>=CAREER_AGENT_LIMITS.toolCalls||call===CAREER_AGENT_LIMITS.modelCalls)throw new Error('tool_budget_exceeded');
    const began=Date.now(),result=runAgentTool(report,request.name,request.arguments);
    const updated=await this.pool.query(`UPDATE praxis.career_agent_run SET tool_calls=tool_calls+1 WHERE id=$1 AND learner_id=$2 AND status='running' RETURNING id`,[id,learnerId]);
    if(!updated.rowCount)throw new Error('cancelled');
    tools++;
    await this.event(id,learnerId,'tool_call',{number:tools,name:request.name,elapsedMs:Date.now()-began});
    messages.push({role:'user',content:JSON.stringify({toolResult:{name:request.name,arguments:request.arguments,data:result},remainingToolCalls:CAREER_AGENT_LIMITS.toolCalls-tools,remainingModelCalls:CAREER_AGENT_LIMITS.modelCalls-call})});
   }
  }catch(error){
   const message=error instanceof Error?error.message:'run_failed';
   const safe=/^[a-z_0-9]{1,60}$/.test(message)?message:'run_failed';
   const failed=await this.pool.query(`UPDATE praxis.career_agent_run SET status='failed',error_code=$3,finished_at=clock_timestamp()
    WHERE id=$1 AND learner_id=$2 AND status IN ('queued','running') RETURNING id`,[id,learnerId,safe]);
   if(failed.rowCount)await this.event(id,learnerId,'failed',{code:safe});
  }finally{clearTimeout(timer);this.active.delete(id);}
 }
 async cancel(learnerId:string,id:unknown){
  if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw new CareerAgentError('Analyse introuvable.',404);
  await this.expire(learnerId);
  const result=await this.pool.query<RunRow>(`UPDATE praxis.career_agent_run SET status='cancelled',finished_at=clock_timestamp()
   WHERE id=$1 AND learner_id=$2 AND status IN ('queued','running') RETURNING ${columns}`,[id,learnerId]);
  if(result.rows[0]){this.active.get(id)?.abort();await this.event(id,learnerId,'cancelled');return result.rows[0];}
  const existing=await this.read(learnerId,id);if(existing.run.status==='cancelled')return existing.run;
  throw new CareerAgentError('Cette analyse est déjà terminée.',409);
 }
 async read(learnerId:string,id:string){
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new CareerAgentError('Analyse introuvable.',404);
  await this.expire(learnerId);
  const run=(await this.pool.query<RunRow>(`SELECT ${columns} FROM praxis.career_agent_run WHERE id=$1 AND learner_id=$2`,[id,learnerId])).rows[0];
  if(!run)throw new CareerAgentError('Analyse introuvable.',404);
  const events=(await this.pool.query(`SELECT kind,detail,created_at::text AS "createdAt" FROM praxis.career_agent_event
   WHERE run_id=$1 AND learner_id=$2 ORDER BY id`,[id,learnerId])).rows;
  return {run,events,limits:CAREER_AGENT_LIMITS};
 }
 async history(learnerId:string,offset=0){
  if(!Number.isSafeInteger(offset)||offset<0)throw new CareerAgentError('Historique invalide.');
  await this.expire(learnerId);
  const rows=(await this.pool.query<RunRow>(`SELECT ${columns} FROM praxis.career_agent_run WHERE learner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $2`,[learnerId,offset])).rows;
  return {runs:rows.slice(0,20),nextOffset:rows.length>20?offset+20:null,available:this.available,model:NVIDIA_MODEL,limits:CAREER_AGENT_LIMITS};
 }
}
