import type {Pool,PoolClient} from 'pg';
import {ALGORITHM_VERSIONS} from '../kernel/algorithm-versions.js';
import {hashComputationInputs} from '../kernel/computation-provenance.js';
import {buildEvidenceProfile} from '../evidence/learner-evidence.js';
import {StandaloneRecommendationRepository} from '../engine/recommendation.repository.js';
import {ExplorationRepository} from './exploration.repository.js';
import {CareerLevelRepository} from './career-levels.js';
import {DevelopmentActivityRepository} from './activities.js';
import type {RoleDirection,StartingProfile} from './exploration.types.js';
import {buildDevelopmentPlan,DEVELOPMENT_CASE_SCHEMA,replayDevelopmentCase,type DevelopmentCase,type DevelopmentPlanInput,type PlanConfirmation,type PlanRequirement,type PlanSource,type PlanAttempt} from './development-plan.js';

export class DevelopmentPlanInputError extends Error {constructor(message:string,public readonly status=400){super(message);}}
const caseColumns=`id,created_at::text AS "createdAt",schema_version AS "schemaVersion",algorithm_version AS "algorithmVersion",
 input_hash AS "inputHash",output_hash AS "outputHash",input_snapshot AS input,output_snapshot AS plan`;

/** Capture every input through one repeatable-read snapshot, including candidate membership. */
export async function captureDevelopmentPlanInput(db:PoolClient,learnerId:string,codeRome:string,scope?:{profile:StartingProfile;directions:RoleDirection[]}):Promise<DevelopmentPlanInput>{
 const pool=db as unknown as Pool,exploration=new ExplorationRepository(pool),levels=new CareerLevelRepository(db);
 const profile=scope?.profile??await exploration.profile(learnerId);
 const direction=(scope?.directions??await exploration.romeDirections(profile)).find(d=>d.romeCode===codeRome);
 if(!direction?.romeProfile)throw new DevelopmentPlanInputError('Métier indisponible dans votre exploration.',404);
 const career=await levels.forOccupation(learnerId,codeRome),catalog=await new DevelopmentActivityRepository(pool).forOccupation(learnerId,codeRome);
 const goal=career.goal,framework=goal?career.frameworks.find(b=>b.framework.id===goal.frameworkId):null;
 const targetLevel=framework?.levels.find(l=>l.code===goal?.targetLevelCode);
 const requirements:PlanRequirement[]=direction.requirements.map(r=>({id:`occupation:${r.requirementKind}:${r.romeOgr}`,
  kind:'occupation',label:r.label,dimension:r.requirementKind??'skill',skillOgr:r.romeOgr??null,skillId:null,
  expectedBehavior:null,sourceId:r.source.reference,criteria:[]}));
 const sources=new Map<string,PlanSource>();
 for(const r of direction.requirements)sources.set(r.source.reference,{id:r.source.reference,label:r.source.label,reference:r.source.reference,status:r.source.reviewStatus});
 if(framework&&goal&&targetLevel){
  for(const s of framework.sources){const id=`framework:${framework.framework.id}:${s.id}`;sources.set(id,{id,label:s.title,reference:s.url??s.locator,status:'reviewed'});}
  for(const r of framework.requirements.filter(r=>r.levelCode===goal.targetLevelCode))requirements.push({id:`framework:${framework.framework.id}:${r.id}`,
   kind:'career_level',label:r.label,dimension:r.dimension,skillOgr:r.skillOgr,skillId:r.skillId,expectedBehavior:r.expectedBehavior,
   sourceId:`framework:${framework.framework.id}:${r.sourceId}`,
   criteria:framework.criteria.filter(c=>c.requirementId===r.id).map(c=>({code:c.code,label:c.label,assessmentMode:c.assessmentMode,sourceId:`framework:${framework.framework.id}:${c.sourceId}`}))});
 }
 const activities=catalog.activities.map(a=>{
  for(const s of a.sources){const id=`activity:${a.id}:${s.id}`;sources.set(id,{id,label:s.title,reference:s.url??s.reference,status:a.status});}
  return {id:a.id,version:a.version,title:a.title,status:a.status as 'pilot'|'reviewed',contentHash:a.contentHash!,minutes:a.minutes,
   skillOgrs:a.skills.map(s=>s.ogr),levelRequirementIds:a.levelTargets.map(t=>`framework:${t.frameworkId}:${t.requirementId}`),
   sourceIds:a.sources.map(s=>`activity:${a.id}:${s.id}`),
   prerequisites:a.prerequisites.map(({state,explanation,...p})=>p),
   criteria:a.criteria.map(c=>({code:c.code,label:c.label,expectedBehavior:c.expectedBehavior}))};
 });
 const ogrs=[...new Set([...requirements.flatMap(r=>r.skillOgr?[r.skillOgr]:[]),...activities.flatMap(a=>a.prerequisites.flatMap(p=>p.skillOgr?[p.skillOgr]:[]))])];
 const confirmations=await db.query<PlanConfirmation>(`SELECT id,code_ogr::text AS ogr,response,release_id AS "releaseId",recorded_at::text AS "recordedAt",practice_context_id AS "practiceContextId"
  FROM praxis.rome_requirement_confirmation WHERE learner_id=$1 AND release_id=$2 AND superseded_by IS NULL AND code_ogr=ANY($3::bigint[]) ORDER BY id`,[learnerId,direction.romeProfile.releaseId,ogrs]);
 const attempts=await db.query<PlanAttempt>(`SELECT t.id,t.activity_id AS "activityId",a.title_fr AS title,t.content_hash AS "contentHash",t.outcome,
  t.submitted_at::text AS "submittedAt",t.met_count AS "metCount",t.total_count AS "totalCount",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('criterionCode',r.criterion_code,'met',r.criterion_met) ORDER BY r.criterion_code)
   FROM praxis.development_activity_answer r WHERE r.attempt_id=t.id),'[]') AS results
  FROM praxis.development_activity_attempt t JOIN praxis.development_activity a ON a.id=t.activity_id
  WHERE t.learner_id=$1 AND t.code_rome=$2 AND t.market_code=$3 ORDER BY t.id`,[learnerId,codeRome,career.preference.marketCode]);
 // No PRAXIS/ESCO -> source-skill crosswalk is inferred. Only exact explicit IDs are accepted.
 const skillIds=new Set(requirements.flatMap(r=>r.skillId?[r.skillId]:[]));
 const rows=skillIds.size?(await new StandaloneRecommendationRepository(pool).skillEvidence(learnerId)).filter(e=>skillIds.has(e.skillId)):[];
 const asOf=(await db.query<{asOf:Date}>('SELECT transaction_timestamp() AS "asOf"')).rows[0]!.asOf;
 const evidence=buildEvidenceProfile({learnerId,constraints:{remoteOnly:true,hoursPerWeek:8}},rows,{now:asOf});
 return {schemaVersion:DEVELOPMENT_CASE_SCHEMA,
  target:{codeRome,title:direction.title,releaseId:direction.romeProfile.releaseId,marketCode:career.preference.marketCode,
   marketLabel:career.catalog.markets.find(m=>m.code===career.preference.marketCode)?.label??null,domainCode:profile.preferredDomainCode??null,trackCode:career.preference.trackCode},
  careerGoal:framework&&goal&&targetLevel?{frameworkId:framework.framework.id,frameworkVersion:framework.framework.version,contentHash:framework.framework.contentHash!,
   targetLevelCode:goal.targetLevelCode,targetLevelLabel:targetLevel.label,currentLevelCode:goal.currentLevelCode}:null,
  levelAvailability:career.previousGoalUnavailable?'goal_unavailable':career.availability==='available'?goal?'selected':'goal_required':career.availability,
  requirements:requirements.sort((a,b)=>a.id.localeCompare(b.id)),sources:[...sources.values()].sort((a,b)=>a.id.localeCompare(b.id)),confirmations:confirmations.rows,
  evidence:{adapterVersion:evidence.algorithmVersion,selected:evidence.selectedEvidence.map(e=>({id:e.evidenceId,skillId:e.skillId,level:e.level,type:e.evidenceType,confidence:e.confidence,
    observedAt:e.observedAt,assessmentSessionId:typeof e.provenance.assessmentSessionId==='string'?e.provenance.assessmentSessionId:null})),
   ignored:[...evidence.ignoredEvidence],conflictingSkillIds:[...evidence.conflictingSkillIds],disagreements:evidence.disagreements.map(d=>({...d,evidenceIds:[...d.evidenceIds]}))},
  activities:activities.sort((a,b)=>a.id.localeCompare(b.id)),attempts:attempts.rows};
}

export class DevelopmentPlanRepository {
 constructor(private readonly pool:Pool){}
 async create(learnerId:string,codeRome:string){
  if(typeof codeRome!=='string'||!/^[A-Z][0-9]{4}$/.test(codeRome))throw new DevelopmentPlanInputError('Choisissez un métier proposé.');
  // A concurrent identical creation can conflict with a repeatable-read snapshot. Retry the whole capture.
  for(let attempt=0;attempt<3;attempt++){
   const client=await this.pool.connect();
   try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const input=await captureDevelopmentPlanInput(client,learnerId,codeRome),plan=buildDevelopmentPlan(input);
    const inputHash=hashComputationInputs(input),outputHash=hashComputationInputs(plan);
    const args=[learnerId,codeRome,input.target.marketCode,DEVELOPMENT_CASE_SCHEMA,ALGORITHM_VERSIONS.developmentPlan,inputHash,outputHash,JSON.stringify(input),JSON.stringify(plan)];
    const inserted=await client.query<DevelopmentCase>(`INSERT INTO praxis.development_plan_case
     (learner_id,code_rome,market_code,schema_version,algorithm_version,input_hash,output_hash,input_snapshot,output_snapshot)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING ${caseColumns}`,args);
    const record=inserted.rows[0]??(await client.query<DevelopmentCase>(`SELECT ${caseColumns} FROM praxis.development_plan_case
     WHERE learner_id=$1 AND schema_version=$2 AND algorithm_version=$3 AND input_hash=$4`,[learnerId,DEVELOPMENT_CASE_SCHEMA,ALGORITHM_VERSIONS.developmentPlan,inputHash])).rows[0];
    if(!record)throw new Error('Case creation returned no record');
    replayDevelopmentCase(record);await client.query('COMMIT');return record;
   }catch(error){await client.query('ROLLBACK');if((error as {code?:string}).code==='40001'&&attempt<2)continue;throw error;}finally{client.release();}
  }
  throw new Error('Case creation exhausted retries');
 }
 async read(learnerId:string,id:string){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new DevelopmentPlanInputError('Dossier introuvable.',404);
  const record=(await this.pool.query<DevelopmentCase>(`SELECT ${caseColumns} FROM praxis.development_plan_case WHERE learner_id=$1 AND id=$2`,[learnerId,id])).rows[0];
  if(!record)throw new DevelopmentPlanInputError('Dossier introuvable.',404);return record;
 }
 async history(learnerId:string,codeRome:string,offset=0){
  if(!/^[A-Z][0-9]{4}$/.test(codeRome)||!Number.isSafeInteger(offset)||offset<0)throw new DevelopmentPlanInputError('Historique invalide.');
  const rows=await this.pool.query(`SELECT id,market_code AS "marketCode",created_at::text AS "createdAt",algorithm_version AS "algorithmVersion",
   output_snapshot->'summary' AS summary FROM praxis.development_plan_case WHERE learner_id=$1 AND code_rome=$2
   ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $3`,[learnerId,codeRome,offset]);
  return {cases:rows.rows.slice(0,20),nextOffset:rows.rows.length>20?offset+20:null};
 }
 async replay(learnerId:string,id:string){return replayDevelopmentCase(await this.read(learnerId,id));}
}
