import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {CareerLevelRepository} from './career-levels.js';

export class ActivityInputError extends Error {constructor(message:string,public readonly status=400){super(message);}}
type Activity = {id:string;key:string;version:number;title:string;purpose:string;output:string;limitations:string;minutes:number;
 materials:{intro:string;columns:string[];rows:string[][]};author:string;status:'draft'|'pilot'|'reviewed'|'retired';contentHash:string|null;reviewer:string|null;reviewedAt:string|null};
type ActivitySource = {id:string;title:string;publisher:string;url:string|null;reference:string;kind:string;limitations:string};
type Scope = {codeRome:string;marketCode:string;sourceId:string};
type Skill = {ogr:string;label:string;sourceId:string};
type Step = {code:string;position:number;instruction:string};
export type ActivityPrerequisite = {code:string;kind:'activity_passed'|'declared_practice';requiredActivityId:string|null;skillOgr:string|null;label:string;rationale:string;sourceId:string};
type Criterion = {code:string;position:number;label:string;prompt:string;expectedBehavior:string;sourceId:string};
type Option = {criterionCode:string;code:string;position:number;label:string;isCorrect:boolean;feedback:string};
type LevelTarget = {frameworkId:string;requirementId:string;sourceId:string};
export type ActivityBundle = {activity:Activity;sources:ActivitySource[];scopes:Scope[];skills:Skill[];steps:Step[];prerequisites:ActivityPrerequisite[];criteria:Criterion[];options:Option[];levelTargets:LevelTarget[]};
export type ActivityAnswer = {criterionCode:string;optionCode:string};
export type PrerequisiteState = ActivityPrerequisite & {state:'met'|'unmet'|'unknown'|'unavailable';explanation:string};

export function activityContentHash(bundle:ActivityBundle){
 const {status,contentHash,reviewer,reviewedAt,...activity}=bundle.activity;
 return createHash('sha256').update(JSON.stringify({...bundle,activity})).digest('hex');
}
export function validateActivity(bundle:ActivityBundle){
 const errors:string[]=[],sources=new Set(bundle.sources.map(s=>s.id)),a=bundle.activity,m=a.materials;
 if(!a.title.trim()||!a.purpose.trim()||!a.output.trim()||!a.limitations.trim())errors.push('Missing activity description');
 if(!Number.isInteger(a.minutes)||a.minutes<1||a.minutes>1440)errors.push('Invalid duration');
 if(!m||typeof m.intro!=='string'||!m.intro.trim()||!Array.isArray(m.columns)||!m.columns.length||!m.columns.every(x=>typeof x==='string')||
  !Array.isArray(m.rows)||m.rows.some(r=>!Array.isArray(r)||r.length!==m.columns.length||!r.every(x=>typeof x==='string')))errors.push('Invalid supplied case data');
 if(!bundle.scopes.length||!bundle.skills.length||!bundle.steps.length||!bundle.criteria.length)errors.push('Scope, skills, steps and criteria are required');
 for(const item of [...bundle.scopes,...bundle.skills,...bundle.prerequisites,...bundle.criteria,...bundle.levelTargets])if(!sources.has(item.sourceId))errors.push('Unknown source');
 for(const c of bundle.criteria){const choices=bundle.options.filter(o=>o.criterionCode===c.code);
  if(choices.length<2||!choices.some(o=>o.isCorrect)||!choices.some(o=>!o.isCorrect))errors.push('Every criterion needs correct and incorrect choices');
  if(choices.some(o=>!o.label.trim()||!o.feedback.trim()))errors.push('Every choice needs a label and feedback');
 }
 if(bundle.options.some(o=>!bundle.criteria.some(c=>c.code===o.criterionCode)))errors.push('Unknown criterion');
 if(bundle.prerequisites.some(p=>p.requiredActivityId===a.id))errors.push('Self prerequisite');
 return [...new Set(errors)];
}
export function resolveActivityPrerequisites(prerequisites:ActivityPrerequisite[],passed:ReadonlySet<string>,available:ReadonlySet<string>,practice:ReadonlyMap<string,string>):PrerequisiteState[]{
 return prerequisites.map(p=>{
  if(p.kind==='activity_passed'){
   if(!available.has(p.requiredActivityId!))return {...p,state:'unavailable',explanation:'Cet exercice préalable n’est plus disponible pour ce métier et ce pays.'};
   return {...p,state:passed.has(p.requiredActivityId!)?'met':'unmet',explanation:passed.has(p.requiredActivityId!)?'Exercice déjà réussi dans ce contexte.':'Réussissez d’abord cet exercice dans le même métier et le même pays.'};
  }
  const response=practice.get(p.skillOgr!);
  return {...p,state:response==='practiced'?'met':response==='not_yet'?'unmet':'unknown',explanation:response==='practiced'?'Pratique déclarée : condition d’entrée remplie, sans preuve de maîtrise.':response==='not_yet'?'Vous avez déclaré ne pas avoir encore pratiqué cette compétence.':'Votre pratique reste à préciser dans la fiche métier.'};
 });
}
export function gradeActivity(bundle:ActivityBundle,answers:unknown){
 if(!Array.isArray(answers)||answers.length!==bundle.criteria.length)throw new ActivityInputError('Répondez à chaque critère avec un choix proposé.');
 const seen=new Set<string>();
 const results=answers.map((answer:unknown)=>{
  if(!answer||typeof answer!=='object'||Array.isArray(answer)||Object.keys(answer).some(k=>!['criterionCode','optionCode'].includes(k)))throw new ActivityInputError('Utilisez uniquement les choix proposés.');
  const a=answer as ActivityAnswer,c=bundle.criteria.find(c=>c.code===a.criterionCode),o=bundle.options.find(o=>o.criterionCode===a.criterionCode&&o.code===a.optionCode);
  if(!c||!o||seen.has(c.code))throw new ActivityInputError('Réponse inconnue ou critère répété.');seen.add(c.code);
  return {criterionCode:c.code,criterion:c.label,optionCode:o.code,answer:o.label,met:o.isCorrect,feedback:o.feedback};
 });
 results.sort((a,b)=>bundle.criteria.findIndex(c=>c.code===a.criterionCode)-bundle.criteria.findIndex(c=>c.code===b.criterionCode));
 return {outcome:results.every(r=>r.met)?'passed' as const:'needs_practice' as const,metCount:results.filter(r=>r.met).length,totalCount:results.length,results,
  evidenceKind:'exercise_result' as const,masteryEstablished:false as const};
}

/** Operator-only. Enabling a pilot does not represent independent content review. */
export async function publishDevelopmentActivity(pool:Pool,id:string,input:{actor:string;decision:'enable_pilot'|'approve'|'reject';expectedHash:string;rationale:string}){
 if(!input.actor.trim()||!input.rationale.trim()||!['enable_pilot','approve','reject'].includes(input.decision))throw new ActivityInputError('Publication decision and actor are required');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT id FROM praxis.development_activity WHERE id=$1 FOR UPDATE',[id]);
  const b=await new DevelopmentActivityRepository(client as unknown as Pool).bundle(id);
  if(!b||!['draft','pilot'].includes(b.activity.status)||(b.activity.status==='pilot'&&input.decision==='enable_pilot'))throw new ActivityInputError('Activity cannot enter this publication state');
  if(input.decision==='approve'&&input.actor===b.activity.author)throw new ActivityInputError('An independent reviewer is required');
  const hash=activityContentHash(b);if(hash!==input.expectedHash)throw new ActivityInputError('Activity changed since review');
  const errors=validateActivity(b);if(input.decision!=='reject'&&errors.length)throw new ActivityInputError(errors.join('; '));
  await client.query('INSERT INTO praxis.development_activity_review(activity_id,actor,decision,content_hash,rationale) VALUES ($1,$2,$3,$4,$5)',[id,input.actor,input.decision,hash,input.rationale]);
  if(input.decision!=='reject')await client.query(`UPDATE praxis.development_activity SET status=$2,content_hash=$3,
   reviewed_by=CASE WHEN $2='reviewed' THEN $4 ELSE NULL END,reviewed_at=CASE WHEN $2='reviewed' THEN clock_timestamp() ELSE NULL END WHERE id=$1`,[id,input.decision==='approve'?'reviewed':'pilot',hash,input.actor]);
  await client.query('COMMIT');return {id,status:input.decision==='reject'?b.activity.status:input.decision==='approve'?'reviewed':'pilot',contentHash:hash};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export class DevelopmentActivityRepository {
 constructor(private readonly pool:Pool){}
 /** Draft-capable operator read; never expose directly in learner routes. */
 async bundle(id:string):Promise<ActivityBundle|null>{
  const h=await this.pool.query<Activity>(`SELECT id,activity_key AS key,version,title_fr AS title,purpose_fr AS purpose,output_fr AS output,limitations_fr AS limitations,
   estimated_minutes AS minutes,materials,authored_by AS author,status,content_hash AS "contentHash",reviewed_by AS reviewer,reviewed_at::text AS "reviewedAt" FROM praxis.development_activity WHERE id=$1`,[id]);
  if(!h.rows[0])return null;
  const sources=await this.pool.query<ActivitySource>('SELECT id,title,publisher,url,reference,kind,limitations_fr AS limitations FROM praxis.development_activity_source WHERE activity_id=$1 ORDER BY id',[id]);
  const scopes=await this.pool.query<Scope>('SELECT code_rome AS "codeRome",market_code AS "marketCode",source_id AS "sourceId" FROM praxis.development_activity_scope WHERE activity_id=$1 ORDER BY code_rome,market_code',[id]);
  const skills=await this.pool.query<Skill>('SELECT skill_ogr::text AS ogr,label_fr AS label,source_id AS "sourceId" FROM praxis.development_activity_skill WHERE activity_id=$1 ORDER BY skill_ogr',[id]);
  const steps=await this.pool.query<Step>('SELECT code,position,instruction_fr AS instruction FROM praxis.development_activity_step WHERE activity_id=$1 ORDER BY position',[id]);
  const prerequisites=await this.pool.query<ActivityPrerequisite>('SELECT code,kind,required_activity_id AS "requiredActivityId",skill_ogr::text AS "skillOgr",label_fr AS label,rationale_fr AS rationale,source_id AS "sourceId" FROM praxis.development_activity_prerequisite WHERE activity_id=$1 ORDER BY code',[id]);
  const criteria=await this.pool.query<Criterion>('SELECT code,position,label_fr AS label,prompt_fr AS prompt,expected_behavior_fr AS "expectedBehavior",source_id AS "sourceId" FROM praxis.development_activity_criterion WHERE activity_id=$1 ORDER BY position',[id]);
  const options=await this.pool.query<Option>('SELECT criterion_code AS "criterionCode",code,position,label_fr AS label,is_correct AS "isCorrect",feedback_fr AS feedback FROM praxis.development_activity_option WHERE activity_id=$1 ORDER BY criterion_code,position',[id]);
  const targets=await this.pool.query<LevelTarget>('SELECT framework_id AS "frameworkId",requirement_id AS "requirementId",source_id AS "sourceId" FROM praxis.development_activity_level_target WHERE activity_id=$1 ORDER BY framework_id,requirement_id',[id]);
  return {activity:h.rows[0],sources:sources.rows,scopes:scopes.rows,skills:skills.rows,steps:steps.rows,prerequisites:prerequisites.rows,criteria:criteria.rows,options:options.rows,levelTargets:targets.rows};
 }
 async forOccupation(learnerId:string,codeRome:string){
  const preference=await new CareerLevelRepository(this.pool).preference(learnerId),market=preference.marketCode;
  if(!market)return {availability:'market_required' as const,marketCode:null,codeRome,activities:[],note:'Choisissez un pays dans votre point de départ pour voir les exercices disponibles.'};
  const ids=await this.pool.query<{id:string}>(`SELECT a.id FROM praxis.development_activity a JOIN praxis.development_activity_scope s ON s.activity_id=a.id
   WHERE a.status IN ('pilot','reviewed') AND s.code_rome=$1 AND s.market_code=$2 ORDER BY a.estimated_minutes,a.id`,[codeRome,market]);
  const available=new Set(ids.rows.map(a=>a.id));
  const attempts=await this.pool.query<{activityId:string;passed:boolean;attemptCount:number;latestId:string;latestOutcome:string}>(`SELECT DISTINCT ON(activity_id) activity_id AS "activityId",
   bool_or(outcome='passed') OVER(PARTITION BY activity_id) AS passed,count(*) OVER(PARTITION BY activity_id)::int AS "attemptCount",id AS "latestId",outcome AS "latestOutcome"
   FROM praxis.development_activity_attempt WHERE learner_id=$1 AND code_rome=$2 AND market_code=$3 ORDER BY activity_id,submitted_at DESC,id DESC`,[learnerId,codeRome,market]);
  const passed=new Set(attempts.rows.filter(a=>a.passed).map(a=>a.activityId));
  const started=await this.pool.query<{id:string}>('SELECT activity_id AS id FROM praxis.learner_activity_start WHERE learner_id=$1 AND code_rome=$2 AND market_code=$3',[learnerId,codeRome,market]);
  const confirmations=await this.pool.query<{ogr:string;response:string}>(`SELECT q.code_ogr::text AS ogr,q.response FROM praxis.rome_requirement_confirmation q
   JOIN praxis.source_releases r ON r.id=q.release_id AND r.source='rome' AND r.is_active WHERE q.learner_id=$1 AND q.superseded_by IS NULL`,[learnerId]);
  const grouped=new Map<string,Set<string>>();for(const c of confirmations.rows){const set=grouped.get(c.ogr)??new Set();set.add(c.response);grouped.set(c.ogr,set);}
  const practice=new Map([...grouped].map(([ogr,responses])=>[ogr,responses.size===1?[...responses][0]!:'conflicting']));
  const activities=[];
  for(const {id} of ids.rows){
   const b=await this.bundle(id);if(!b||!['pilot','reviewed'].includes(b.activity.status))continue;
   const prerequisites=resolveActivityPrerequisites(b.prerequisites,passed,available,practice);
   const eligibility=prerequisites.some(p=>p.state==='unmet'||p.state==='unavailable')?'blocked':prerequisites.some(p=>p.state==='unknown')?'needs_information':'ready';
   const progress=attempts.rows.find(a=>a.activityId===id);
   const targets=await this.pool.query(`SELECT f.title_fr AS framework,l.label_fr AS level,q.label_fr AS requirement,f.id AS "frameworkId",q.id AS "requirementId"
    FROM praxis.development_activity_level_target t JOIN praxis.career_framework f ON f.id=t.framework_id AND f.status='reviewed' AND f.market_code=$2
    JOIN praxis.career_level_requirement q ON q.framework_id=f.id AND q.id=t.requirement_id
    JOIN praxis.career_level l ON l.framework_id=f.id AND l.code=q.level_code
    JOIN praxis.career_level_occupation o ON o.framework_id=f.id AND o.level_code=l.code AND o.code_rome=$3 WHERE t.activity_id=$1`,[id,market,codeRome]);
   activities.push({...b.activity,sources:b.sources,skills:b.skills,steps:b.steps,prerequisites,eligibility,
    criteria:b.criteria.map(c=>({...c,options:b.options.filter(o=>o.criterionCode===c.code).map(o=>({code:o.code,label:o.label}))})),levelTargets:targets.rows,
    progress:{state:progress?.passed?'completed':progress?'needs_practice':started.rows.some(s=>s.id===id)?'in_progress':'not_started',attemptCount:progress?.attemptCount??0,latestOutcome:progress?.latestOutcome??null},
    latestAttempt:progress?await this.attempt(learnerId,progress.latestId):null});
  }
  return {availability:activities.length?'available' as const:'unavailable' as const,marketCode:market,codeRome,activities,
   note:activities.length?'Résultats d’exercices uniquement : ils ne valident ni une compétence professionnelle ni un niveau de carrière.':'Aucun exercice disponible pour ce métier et ce pays. Les exercices ne sont pas générés à partir du seul titre du métier.'};
 }
 async attempt(learnerId:string,id:string){
  const result=await this.pool.query(`SELECT id,activity_id AS "activityId",code_rome AS "codeRome",market_code AS "marketCode",outcome,met_count AS "metCount",total_count AS "totalCount",submitted_at::text AS "submittedAt",content_hash AS "contentHash"
   FROM praxis.development_activity_attempt WHERE learner_id=$1 AND id=$2`,[learnerId,id]);
  if(!result.rows[0])throw new ActivityInputError('Tentative introuvable.',404);
  const answers=await this.pool.query(`SELECT a.criterion_code AS "criterionCode",c.label_fr AS criterion,a.option_code AS "optionCode",o.label_fr AS answer,a.criterion_met AS met,o.feedback_fr AS feedback
   FROM praxis.development_activity_answer a JOIN praxis.development_activity_criterion c ON c.activity_id=a.activity_id AND c.code=a.criterion_code
   JOIN praxis.development_activity_option o ON o.activity_id=a.activity_id AND o.criterion_code=a.criterion_code AND o.code=a.option_code WHERE a.attempt_id=$1 ORDER BY c.position`,[id]);
  return {...result.rows[0],results:answers.rows,evidenceKind:'exercise_result',masteryEstablished:false};
 }
 private async withLearner<T>(learnerId:string,work:(repo:DevelopmentActivityRepository,client:PoolClient)=>Promise<T>){
  const client=await this.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`activities:${learnerId}`]);
   await client.query('SELECT learner_id FROM praxis.learner_career_preference WHERE learner_id=$1 FOR SHARE',[learnerId]);
   const result=await work(new DevelopmentActivityRepository(client as unknown as Pool),client);await client.query('COMMIT');return result;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async start(learnerId:string,codeRome:string,activityId:string,marketCode:string){
  return this.withLearner(learnerId,async(repo,client)=>{
   const catalog=await repo.forOccupation(learnerId,codeRome),activity=catalog.activities.find(a=>a.id===activityId);
   if(catalog.marketCode!==marketCode)throw new ActivityInputError('Votre pays a changé. Rechargez les exercices.',409);
   if(!activity)throw new ActivityInputError('Exercice indisponible.');
   if(activity.eligibility!=='ready')throw new ActivityInputError('Complétez ou clarifiez les prérequis avant de commencer.',409);
   await client.query('SELECT id FROM praxis.development_activity WHERE id=$1 AND status IN (\'pilot\',\'reviewed\') FOR SHARE',[activityId]).then(r=>{if(!r.rowCount)throw new ActivityInputError('Exercice retiré.',409);});
   await client.query(`INSERT INTO praxis.learner_activity_start(learner_id,activity_id,code_rome,market_code) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[learnerId,activityId,codeRome,catalog.marketCode]);
   return {started:true,activityId};
  });
 }
 async submit(learnerId:string,input:{codeRome:string;marketCode:string;activityId:string;requestKey:string;answers:unknown}){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestKey))throw new ActivityInputError('Identifiant de tentative invalide.');
  return this.withLearner(learnerId,async(repo,client)=>{
   const b=await repo.bundle(input.activityId);if(!b)throw new ActivityInputError('Exercice indisponible.');
   const grade=gradeActivity(b,input.answers);
   const inputHash=createHash('sha256').update(JSON.stringify({activityId:input.activityId,codeRome:input.codeRome,marketCode:input.marketCode,answers:grade.results.map(r=>[r.criterionCode,r.optionCode])})).digest('hex');
   const previous=await client.query<{id:string;input_hash:string}>('SELECT id,input_hash FROM praxis.development_activity_attempt WHERE learner_id=$1 AND request_key=$2',[learnerId,input.requestKey]);
   if(previous.rows[0]){if(previous.rows[0].input_hash!==inputHash)throw new ActivityInputError('Cette tentative a déjà été enregistrée avec d’autres réponses.',409);return repo.attempt(learnerId,previous.rows[0].id);}
   const catalog=await repo.forOccupation(learnerId,input.codeRome),activity=catalog.activities.find(a=>a.id===input.activityId);
   if(catalog.marketCode!==input.marketCode)throw new ActivityInputError('Votre pays a changé. Rechargez les exercices.',409);
   if(!activity)throw new ActivityInputError('Exercice indisponible.');
   if(activity.eligibility!=='ready')throw new ActivityInputError('Les prérequis doivent être remplis avant cet exercice.',409);
   const starts=await client.query('SELECT 1 FROM praxis.learner_activity_start WHERE learner_id=$1 AND activity_id=$2 AND code_rome=$3 AND market_code=$4',[learnerId,input.activityId,input.codeRome,catalog.marketCode]);
   if(!starts.rowCount)throw new ActivityInputError('Commencez cet exercice avant de répondre.',409);
   const locked=await client.query('SELECT id FROM praxis.development_activity WHERE id=$1 AND status IN (\'pilot\',\'reviewed\') FOR SHARE',[input.activityId]);
   if(!locked.rowCount)throw new ActivityInputError('Exercice retiré.',409);
   const saved=await client.query<{id:string}>(`INSERT INTO praxis.development_activity_attempt(learner_id,activity_id,code_rome,market_code,request_key,input_hash,content_hash,prerequisite_snapshot,outcome,met_count,total_count)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[learnerId,input.activityId,input.codeRome,catalog.marketCode,input.requestKey,inputHash,activity.contentHash,JSON.stringify(activity.prerequisites),grade.outcome,grade.metCount,grade.totalCount]);
   const id=saved.rows[0]!.id;
   for(const r of grade.results)await client.query('INSERT INTO praxis.development_activity_answer(attempt_id,activity_id,criterion_code,option_code,criterion_met) VALUES ($1,$2,$3,$4,$5)',[id,input.activityId,r.criterionCode,r.optionCode,r.met]);
   return repo.attempt(learnerId,id);
  });
 }
}
