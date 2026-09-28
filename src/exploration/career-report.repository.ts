import type {Pool,PoolClient} from 'pg';
import {ALGORITHM_VERSIONS} from '../kernel/algorithm-versions.js';
import {hashComputationInputs} from '../kernel/computation-provenance.js';
import {buildEvidenceProfile} from '../evidence/learner-evidence.js';
import {StandaloneContextSurvey} from '../survey/context-survey.service.js';
import {ExplorationRepository} from './exploration.repository.js';
import {StandaloneRomeExplorer} from './rome-explorer.js';
import {exploreDirections} from './exploration.service.js';
import {recommendDirections} from './direction-recommendations.js';
import {CareerLevelRepository} from './career-levels.js';
import {DevelopmentActivityRepository} from './activities.js';
import {captureDevelopmentPlanInput} from './development-plan.repository.js';
import {buildDevelopmentPlan} from './development-plan.js';
import {CAREER_REPORT_SCHEMA,verifyCareerReport,type CareerReport,type CareerReportSnapshot,type ReportTarget} from './career-report.js';

export class CareerReportInputError extends Error {constructor(message:string,public readonly status=400){super(message);}}
const columns=`id,created_at::text AS "createdAt",schema_version AS "schemaVersion",content_hash AS "contentHash",snapshot`;

async function captureReport(db:PoolClient,learnerId:string,codes:string[]):Promise<CareerReportSnapshot>{
 const pool=db as unknown as Pool,exploration=new ExplorationRepository(pool),levels=new CareerLevelRepository(db);
 const profile=await exploration.profile(learnerId),directions=await exploration.romeDirections(profile);
 if(codes.some(code=>!directions.some(d=>d.romeCode===code)))throw new CareerReportInputError('Choisissez des métiers disponibles dans votre exploration.',404);
 const confirmations=await exploration.romeConfirmations(learnerId),saved=await exploration.savedDirections(learnerId);
 const result=exploreDirections(profile,directions,buildEvidenceProfile({learnerId,constraints:{remoteOnly:true,hoursPerWeek:8}},[]),saved,confirmations);
 const preference=await levels.preference(learnerId),catalog=await levels.catalog(),coverage=await levels.coverage(directions.map(d=>d.romeCode!),preference);
 const interests=await new StandaloneRomeExplorer(pool).interestCentres(),context=await new StandaloneContextSurvey(pool).latest(learnerId);
 const candidates=result.possibilities.map(c=>({code:c.romeCode!,title:c.title,description:c.description,access:[...c.romeProfile!.access],workContexts:(c.workContexts??[]).map(w=>w.label),
  releaseId:c.romeProfile!.releaseId,domains:c.romeProfile!.professionalDomains.map(d=>({code:d.code,label:d.label})),reasons:[...(c.reasons??[])],saved:c.saved,
  requirements:c.requirements.map(r=>({id:`occupation:${r.requirementKind}:${r.romeOgr}`,ogr:r.romeOgr!,kind:r.requirementKind!,label:r.label,state:r.state,sourceReference:r.source.reference,confirmationId:r.evidenceId})),
  levelAvailability:coverage[c.romeCode!]!.availability,frameworkCount:coverage[c.romeCode!]!.frameworkCount})).sort((a,b)=>a.title.localeCompare(b.title,'fr')||a.code.localeCompare(b.code));
 const targets:ReportTarget[]=[];
 for(const code of codes){
  const input=await captureDevelopmentPlanInput(db,learnerId,code,{profile,directions}),plan=buildDevelopmentPlan(input);
  const catalog=await new DevelopmentActivityRepository(pool).forOccupation(learnerId,code);
  const relevant=new Set(plan.milestones.flatMap(m=>m.activityId?[m.activityId]:[]));
  targets.push({code,input,inputHash:hashComputationInputs(input),plan,outputHash:hashComputationInputs(plan),
   activities:catalog.activities.filter(a=>relevant.has(a.id)).map(a=>({id:a.id,version:a.version,title:a.title,status:a.status,contentHash:a.contentHash!,purpose:a.purpose,
    output:a.output,limitations:a.limitations,minutes:a.minutes,materials:a.materials,steps:a.steps.map(x=>({code:x.code,instruction:x.instruction})),
    prerequisites:a.prerequisites.map(p=>({code:p.code,label:p.label,rationale:p.rationale,state:p.state,explanation:p.explanation})),
    criteria:a.criteria.map(k=>({code:k.code,label:k.label,expectedBehavior:k.expectedBehavior})),sources:a.sources.map(x=>({id:x.id,title:x.title,publisher:x.publisher,reference:x.reference,url:x.url,limitations:x.limitations}))}))});
 }
 return {schemaVersion:CAREER_REPORT_SCHEMA,versions:{report:ALGORITHM_VERSIONS.careerReport,plan:ALGORITHM_VERSIONS.developmentPlan},
  profile:{currentCode:profile.currentRomeCode??null,currentLabel:profile.currentRomeLabel??null,domainCode:profile.preferredDomainCode??null,domainLabel:profile.preferredDomainLabel??null,
   marketCode:preference.marketCode,marketLabel:catalog.markets.find(m=>m.code===preference.marketCode)?.label??null,
   trackCode:preference.trackCode,trackLabel:catalog.tracks.find(t=>t.code===preference.trackCode)?.label??null,
   interests:interests.filter(i=>profile.confirmedInterestCodes?.includes(i.code)).map(i=>({code:i.code,label:i.label}))},
  context:context?{sessionId:context.sessionId,version:context.surveyVersion,status:context.status,answers:context.summary.map(a=>({questionId:a.questionId,label:a.labelFr,answer:a.answerLabelFr,source:a.source}))}:null,
  candidates,recommendations:recommendDirections(profile,result.possibilities,6),targets};
}

export class CareerReportRepository{
 constructor(private readonly pool:Pool){}
 async create(learnerId:string,targetCodes:unknown){
  if(!Array.isArray(targetCodes)||targetCodes.length<1||targetCodes.length>3||targetCodes.some(c=>typeof c!=='string'||!/^[A-Z][0-9]{4}$/.test(c))||new Set(targetCodes).size!==targetCodes.length)throw new CareerReportInputError('Choisissez entre un et trois métiers distincts pour l’analyse détaillée.');
  const codes=[...targetCodes].sort() as string[];
  for(let attempt=0;attempt<3;attempt++){
   const db=await this.pool.connect();try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const snapshot=await captureReport(db,learnerId,codes),hash=hashComputationInputs(snapshot);
    const inserted=await db.query<CareerReport>(`INSERT INTO praxis.career_report(learner_id,schema_version,content_hash,snapshot)
     VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING ${columns}`,[learnerId,CAREER_REPORT_SCHEMA,hash,JSON.stringify(snapshot)]);
    const record=inserted.rows[0]??(await db.query<CareerReport>(`SELECT ${columns} FROM praxis.career_report WHERE learner_id=$1 AND schema_version=$2 AND content_hash=$3`,[learnerId,CAREER_REPORT_SCHEMA,hash])).rows[0];
    if(!record)throw new Error('Report creation returned no record');verifyCareerReport(record);await db.query('COMMIT');return record;
   }catch(error){await db.query('ROLLBACK');if((error as {code?:string}).code==='40001'&&attempt<2)continue;throw error;}finally{db.release();}
  }
  throw new Error('Report creation exhausted retries');
 }
 async read(learnerId:string,id:string){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new CareerReportInputError('Rapport introuvable.',404);
  const record=(await this.pool.query<CareerReport>(`SELECT ${columns} FROM praxis.career_report WHERE learner_id=$1 AND id=$2`,[learnerId,id])).rows[0];
  if(!record)throw new CareerReportInputError('Rapport introuvable.',404);verifyCareerReport(record);return record;
 }
 async history(learnerId:string,offset=0){
  if(!Number.isSafeInteger(offset)||offset<0)throw new CareerReportInputError('Historique invalide.');
  const result=await this.pool.query(`SELECT id,created_at::text AS "createdAt",snapshot->'profile'->>'domainLabel' AS domain,
   snapshot->'profile'->>'marketLabel' AS market,jsonb_array_length(snapshot->'candidates') AS "candidateCount",
   (SELECT jsonb_agg(t->'plan'->'target'->>'title') FROM jsonb_array_elements(snapshot->'targets') t) AS targets
   FROM praxis.career_report WHERE learner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $2`,[learnerId,offset]);
  return {reports:result.rows.slice(0,20),nextOffset:result.rows.length>20?offset+20:null};
 }
}
