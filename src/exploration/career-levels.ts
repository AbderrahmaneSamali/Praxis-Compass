import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type CareerPreference = {marketCode:string|null;trackCode:string|null};
export type CareerLevelAvailability = 'available' | 'unavailable' | 'market_required';
export type FrameworkHeader = {id:string;familyId:string;marketCode:string;version:number;title:string;scope:string;
  limitations:string;author:string;status:'draft'|'reviewed'|'retired';reviewer:string|null;reviewedAt:string|null;contentHash:string|null};
export type FrameworkSource = {id:string;title:string;publisher:string;url:string|null;accessedOn:string;locator:string;supportKind:string;reuseNote:string;limitations:string};
export type CareerLevel = {code:string;trackCode:string;label:string;order:number;autonomy:string;scope:string;influence:string;managesPeople:boolean;basis:string;sourceId:string};
export type LevelApplicability = {levelCode:string;codeRome:string;rationale:string;sourceId:string};
export type LevelRequirement = {id:string;levelCode:string;dimension:string;label:string;expectedBehavior:string;skillOgr:string|null;skillId:string|null;sourceId:string};
export type LevelEvidenceCriterion = {requirementId:string;code:string;label:string;assessmentMode:string;sourceId:string};
export type LevelTransition = {fromCode:string;toCode:string;kind:string;rationale:string;sourceId:string};
export type FrameworkBundle = {framework:FrameworkHeader;sources:FrameworkSource[];levels:CareerLevel[];
  applicability:LevelApplicability[];requirements:LevelRequirement[];criteria:LevelEvidenceCriterion[];transitions:LevelTransition[]};
export type CareerLevelGoal = {frameworkId:string;trackCode:string;targetLevelCode:string;currentLevelCode:string|null};
export class CareerLevelInputError extends Error {}

/** Operator workflow only. This is deliberately not exposed by the learner HTTP server. */
export async function reviewCareerFramework(pool:Pool,id:string,input:{reviewer:string;decision:'approve'|'reject';rationale:string;expectedHash:string}) {
  if(!input.reviewer.trim()||!input.rationale.trim()||!['approve','reject'].includes(input.decision))throw new CareerLevelInputError('Review identity and rationale are required');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT id FROM praxis.career_framework WHERE id=$1 FOR UPDATE',[id]);
    const bundle=await new CareerLevelRepository(client).bundle(id);
    if(!bundle||bundle.framework.status!=='draft'||bundle.framework.author===input.reviewer)throw new CareerLevelInputError('An independent review of a draft is required');
    const hash=frameworkContentHash(bundle);
    if(hash!==input.expectedHash)throw new CareerLevelInputError('Framework changed since review');
    const errors=validateFramework(bundle);
    if(input.decision==='approve'&&errors.length)throw new CareerLevelInputError(errors.join('; '));
    await client.query('INSERT INTO praxis.career_framework_review(framework_id,reviewer,decision,content_hash,rationale) VALUES ($1,$2,$3,$4,$5)',[id,input.reviewer,input.decision,hash,input.rationale]);
    if(input.decision==='approve')await client.query(`UPDATE praxis.career_framework SET status='reviewed',reviewed_by=$2,reviewed_at=clock_timestamp(),content_hash=$3 WHERE id=$1`,[id,input.reviewer,hash]);
    await client.query('COMMIT');return {id,status:input.decision==='approve'?'reviewed':'draft',contentHash:hash};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

/** Do not hash mutable publication metadata. Database reads return content in explicit stable order. */
export function frameworkContentHash(bundle:FrameworkBundle):string {
  const {status,reviewer,reviewedAt,contentHash,...content}=bundle.framework;
  return createHash('sha256').update(JSON.stringify({...bundle,framework:content})).digest('hex');
}

export function validateFramework(bundle:FrameworkBundle):string[] {
  const errors:string[]=[],levels=new Map(bundle.levels.map(item=>[item.code,item]));
  const sources=new Set(bundle.sources.map(item=>item.id));
  if(!levels.size)errors.push('No career levels');
  for(const item of [...bundle.levels,...bundle.applicability,...bundle.requirements,...bundle.criteria,...bundle.transitions]) {
    if(!sources.has(item.sourceId))errors.push(`Unknown source: ${item.sourceId}`);
  }
  for(const level of bundle.levels){
    if(!bundle.applicability.some(item=>item.levelCode===level.code))errors.push(`No occupation mapping: ${level.code}`);
    if(!bundle.requirements.some(item=>item.levelCode===level.code))errors.push(`No requirements: ${level.code}`);
  }
  for(const requirement of bundle.requirements){
    if(!levels.has(requirement.levelCode))errors.push(`Unknown level: ${requirement.levelCode}`);
    if(!bundle.criteria.some(item=>item.requirementId===requirement.id))errors.push(`No evidence criteria: ${requirement.id}`);
  }
  for(const edge of bundle.transitions){
    const from=levels.get(edge.fromCode),to=levels.get(edge.toCode);
    if(!from||!to)errors.push('Transition has an unknown level');
    else if((from.trackCode===to.trackCode)!==(edge.kind==='progression'))errors.push('Transition kind does not match tracks');
  }
  const visited=new Set<string>(),active=new Set<string>();
  const visit=(code:string):boolean=>{
    if(active.has(code))return true;if(visited.has(code))return false;active.add(code);
    for(const edge of bundle.transitions.filter(item=>item.fromCode===code))if(visit(edge.toCode))return true;
    active.delete(code);visited.add(code);return false;
  };
  if([...levels.keys()].some(visit))errors.push('Career transitions contain a cycle');
  return [...new Set(errors)];
}

/** Display order is not a prerequisite, and no equivalence between markets is inferred. */
export function projectCareerFramework(bundle:FrameworkBundle,codeRome:string,preference:CareerPreference) {
  if(bundle.framework.status!=='reviewed'||bundle.framework.marketCode!==preference.marketCode)return null;
  const applicable=new Set(bundle.applicability.filter(item=>item.codeRome===codeRome).map(item=>item.levelCode));
  const allLevels=bundle.levels.filter(item=>applicable.has(item.code));
  const levels=allLevels.filter(item=>!preference.trackCode||item.trackCode===preference.trackCode);
  if(!levels.length)return null;
  const codes=new Set(levels.map(item=>item.code)),requirements=bundle.requirements.filter(item=>codes.has(item.levelCode));
  const requirementIds=new Set(requirements.map(item=>item.id));
  return {...bundle,levels,allLevels,requirements,criteria:bundle.criteria.filter(item=>requirementIds.has(item.requirementId)),
    applicability:bundle.applicability.filter(item=>item.codeRome===codeRome&&codes.has(item.levelCode)),
    transitions:bundle.transitions.filter(item=>applicable.has(item.fromCode)&&applicable.has(item.toCode)),
    currentLevelIsSelfReported:true,readiness:'not_assessed' as const};
}

type Database = Pick<Pool,'query'> | Pick<PoolClient,'query'>;
export class CareerLevelRepository {
  constructor(private readonly db:Database) {}

  async catalog(){
    const [markets,tracks]=[
      await this.db.query<{code:string;label:string}>('SELECT code,label_fr AS label FROM praxis.career_market ORDER BY label_fr'),
      await this.db.query<{code:string;label:string;description:string}>('SELECT code,label_fr AS label,description_fr AS description FROM praxis.career_track ORDER BY display_order'),
    ];return {markets:markets.rows,tracks:tracks.rows};
  }
  async preference(learnerId:string):Promise<CareerPreference>{
    const result=await this.db.query<CareerPreference>('SELECT market_code AS "marketCode",track_code AS "trackCode" FROM praxis.learner_career_preference WHERE learner_id=$1',[learnerId]);
    return result.rows[0]??{marketCode:null,trackCode:null};
  }
  async savePreference(learnerId:string,value:CareerPreference){
    const catalog=await this.catalog();
    if((value.marketCode!==null&&!catalog.markets.some(item=>item.code===value.marketCode))||
       (value.trackCode!==null&&!catalog.tracks.some(item=>item.code===value.trackCode)))throw new CareerLevelInputError('Choisissez un pays et un parcours proposés.');
    await this.db.query(`INSERT INTO praxis.learner_career_preference(learner_id,market_code,track_code) VALUES ($1,$2,$3)
      ON CONFLICT(learner_id) DO UPDATE SET market_code=EXCLUDED.market_code,track_code=EXCLUDED.track_code,updated_at=clock_timestamp()`,[learnerId,value.marketCode,value.trackCode]);
    return this.preference(learnerId);
  }
  async coverage(codes:readonly string[],preference:CareerPreference){
    const available=preference.marketCode&&codes.length?(await this.db.query<{code:string;count:number}>(
      `SELECT o.code_rome AS code,count(DISTINCT f.id)::integer AS count FROM praxis.career_framework f
       JOIN praxis.career_level_occupation o ON o.framework_id=f.id
       JOIN praxis.career_level l ON l.framework_id=o.framework_id AND l.code=o.level_code
       WHERE f.status='reviewed' AND f.market_code=$1 AND o.code_rome=ANY($2::text[]) AND ($3::text IS NULL OR l.track_code=$3)
       GROUP BY o.code_rome`,[preference.marketCode,codes,preference.trackCode])).rows:[];
    const counts=new Map(available.map(item=>[item.code,item.count]));
    return Object.fromEntries(codes.map(code=>[code,{availability:(!preference.marketCode?'market_required':counts.has(code)?'available':'unavailable') as CareerLevelAvailability,
      frameworkCount:counts.get(code)??0,marketCode:preference.marketCode,trackCode:preference.trackCode}]));
  }
  /** Operator-only data access. Never expose this draft-capable method as a learner route. */
  async bundle(id:string):Promise<FrameworkBundle|null>{
    const head=await this.db.query<FrameworkHeader>(`SELECT id,family_id AS "familyId",market_code AS "marketCode",version,
      title_fr AS title,scope_fr AS scope,limitations_fr AS limitations,authored_by AS author,status,
      reviewed_by AS reviewer,reviewed_at::text AS "reviewedAt",content_hash AS "contentHash" FROM praxis.career_framework WHERE id=$1`,[id]);
    if(!head.rows[0])return null;
    const [sources,levels,applicability,requirements,criteria,transitions]=[
      await this.db.query<FrameworkSource>(`SELECT id,title,publisher,url,accessed_on::text AS "accessedOn",locator,support_kind AS "supportKind",reuse_note AS "reuseNote",limitations_fr AS limitations FROM praxis.career_framework_source WHERE framework_id=$1 ORDER BY id`,[id]),
      await this.db.query<CareerLevel>(`SELECT code,track_code AS "trackCode",label_fr AS label,display_order AS "order",autonomy_fr AS autonomy,scope_fr AS scope,influence_fr AS influence,manages_people AS "managesPeople",basis,source_id AS "sourceId" FROM praxis.career_level WHERE framework_id=$1 ORDER BY track_code,display_order,code`,[id]),
      await this.db.query<LevelApplicability>(`SELECT level_code AS "levelCode",code_rome AS "codeRome",rationale_fr AS rationale,source_id AS "sourceId" FROM praxis.career_level_occupation WHERE framework_id=$1 ORDER BY level_code,code_rome`,[id]),
      await this.db.query<LevelRequirement>(`SELECT id,level_code AS "levelCode",dimension,label_fr AS label,expected_behavior_fr AS "expectedBehavior",skill_ogr::text AS "skillOgr",skill_id AS "skillId",source_id AS "sourceId" FROM praxis.career_level_requirement WHERE framework_id=$1 ORDER BY level_code,id`,[id]),
      await this.db.query<LevelEvidenceCriterion>(`SELECT requirement_id AS "requirementId",code,label_fr AS label,assessment_mode AS "assessmentMode",source_id AS "sourceId" FROM praxis.career_level_evidence_criterion WHERE framework_id=$1 ORDER BY requirement_id,code`,[id]),
      await this.db.query<LevelTransition>(`SELECT from_code AS "fromCode",to_code AS "toCode",kind,rationale_fr AS rationale,source_id AS "sourceId" FROM praxis.career_level_transition WHERE framework_id=$1 ORDER BY from_code,to_code`,[id]),
    ];
    return {framework:head.rows[0],sources:sources.rows,levels:levels.rows,applicability:applicability.rows,requirements:requirements.rows,criteria:criteria.rows,transitions:transitions.rows};
  }
  async forOccupation(learnerId:string,codeRome:string){
    const preference=await this.preference(learnerId),catalog=await this.catalog();
    const coverage=(await this.coverage([codeRome],preference))[codeRome]!;
    const frameworks=[];
    if(coverage.availability==='available'){
      const ids=await this.db.query<{id:string}>(`SELECT DISTINCT f.id FROM praxis.career_framework f JOIN praxis.career_level_occupation o ON o.framework_id=f.id
        WHERE f.status='reviewed' AND f.market_code=$1 AND o.code_rome=$2 ORDER BY f.id`,[preference.marketCode,codeRome]);
      for(const {id} of ids.rows){const bundle=await this.bundle(id);if(bundle){const projected=projectCareerFramework(bundle,codeRome,preference);if(projected)frameworks.push(projected);}}
    }
    const saved=await this.db.query<CareerLevelGoal>(`SELECT framework_id AS "frameworkId",track_code AS "trackCode",target_level_code AS "targetLevelCode",current_level_code AS "currentLevelCode"
      FROM praxis.learner_career_level_goal WHERE learner_id=$1 AND code_rome=$2 AND market_code=$3`,[learnerId,codeRome,preference.marketCode]);
    if(coverage.availability==='available'&&!frameworks.length){coverage.availability='unavailable';coverage.frameworkCount=0;}
    const goal=saved.rows[0]??null;
    const goalAvailable=Boolean(goal&&frameworks.some(item=>item.framework.id===goal.frameworkId&&item.levels.some(level=>level.code===goal.targetLevelCode)));
    return {codeRome,preference,catalog,...coverage,frameworks,goal:goalAvailable?goal:null,previousGoalUnavailable:Boolean(goal&&!goalAvailable),
      message:coverage.availability==='market_required'?'Choisissez la France ou le Maroc pour consulter les niveaux de ce marché.':
        coverage.availability==='unavailable'?'Aucun référentiel de niveaux revu pour ce métier et ces choix. Vous pouvez continuer à explorer les compétences.':
          'Choisissez votre objectif. Un niveau déclaré ne constitue pas une évaluation de vos compétences.'};
  }
  async saveGoal(learnerId:string,codeRome:string,goal:CareerLevelGoal){
    const available=await this.forOccupation(learnerId,codeRome);
    const bundle=available.frameworks.find(item=>item.framework.id===goal.frameworkId);
    const target=bundle?.levels.find(item=>item.code===goal.targetLevelCode&&item.trackCode===goal.trackCode);
    if(!target||(goal.currentLevelCode!==null&&!bundle?.allLevels.some(item=>item.code===goal.currentLevelCode)))
      throw new CareerLevelInputError('Ce niveau n’est pas disponible pour ce métier, ce pays et ce parcours.');
    await this.db.query(`INSERT INTO praxis.learner_career_level_goal(learner_id,code_rome,market_code,framework_id,track_code,target_level_code,current_level_code)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(learner_id,code_rome,market_code) DO UPDATE SET framework_id=EXCLUDED.framework_id,
      track_code=EXCLUDED.track_code,target_level_code=EXCLUDED.target_level_code,current_level_code=EXCLUDED.current_level_code,updated_at=clock_timestamp()`,
      [learnerId,codeRome,available.preference.marketCode,goal.frameworkId,goal.trackCode,goal.targetLevelCode,goal.currentLevelCode]);
    return this.forOccupation(learnerId,codeRome);
  }
  async clearGoal(learnerId:string,codeRome:string){
    const preference=await this.preference(learnerId);
    await this.db.query('DELETE FROM praxis.learner_career_level_goal WHERE learner_id=$1 AND code_rome=$2 AND market_code=$3',[learnerId,codeRome,preference.marketCode]);
    return this.forOccupation(learnerId,codeRome);
  }
}
