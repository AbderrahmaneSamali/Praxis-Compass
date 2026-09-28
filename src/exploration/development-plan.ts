import {ALGORITHM_VERSIONS} from '../kernel/algorithm-versions.js';
import {hashComputationInputs} from '../kernel/computation-provenance.js';
import {resolveActivityPrerequisites, type ActivityPrerequisite} from './activities.js';

export const DEVELOPMENT_CASE_SCHEMA = 'development-case-v1';
export type PlanSource = {id:string;label:string;reference:string;status:string};
export type PlanRequirement = {id:string;kind:'occupation'|'career_level';label:string;dimension:string;
 skillOgr:string|null;skillId:string|null;expectedBehavior:string|null;sourceId:string;
 criteria:{code:string;label:string;assessmentMode:string;sourceId:string}[]};
export type PlanConfirmation = {id:string;ogr:string;response:'practiced'|'not_yet'|'unsure';releaseId:string;recordedAt:string;practiceContextId:string|null};
export type PlanEvidence = {id:string;skillId:string;level:number;type:string;confidence:string;observedAt:string;assessmentSessionId:string|null};
export type PlanActivity = {id:string;version:number;title:string;status:'pilot'|'reviewed';contentHash:string;minutes:number;
 skillOgrs:string[];levelRequirementIds:string[];sourceIds:string[];prerequisites:ActivityPrerequisite[];
 criteria:{code:string;label:string;expectedBehavior:string}[]};
export type PlanAttempt = {id:string;activityId:string;title:string;contentHash:string;outcome:'passed'|'needs_practice';
 submittedAt:string;metCount:number;totalCount:number;results:{criterionCode:string;met:boolean}[]};
export type DevelopmentPlanInput = {
 schemaVersion:typeof DEVELOPMENT_CASE_SCHEMA;
 target:{codeRome:string;title:string;releaseId:string;marketCode:string|null;marketLabel:string|null;domainCode:string|null;trackCode:string|null};
 careerGoal:{frameworkId:string;frameworkVersion:number;contentHash:string;targetLevelCode:string;targetLevelLabel:string;currentLevelCode:string|null}|null;
 levelAvailability:'market_required'|'unavailable'|'goal_required'|'goal_unavailable'|'selected';
 requirements:PlanRequirement[];sources:PlanSource[];confirmations:PlanConfirmation[];
 evidence:{adapterVersion:string;selected:PlanEvidence[];ignored:{evidenceId:string;skillId:string;reason:string}[];conflictingSkillIds:string[];disagreements:{skillId:string;evidenceIds:string[];resolution:string}[]};
 activities:PlanActivity[];attempts:PlanAttempt[];
};
export type GapState = 'unknown'|'declared_practice'|'development_needed'|'conflicting'|'evidence_available';
export type PlanMilestone = {id:string;kind:'clarify'|'exercise'|'assessment'|'context';label:string;explanation:string;
 state:'ready'|'blocked'|'needs_information'|'completed'|'unavailable';requirementIds:string[];dependsOn:string[];
 activityId:string|null;skillOgr:string|null;minutes:number|null;sourceIds:string[];evidenceIds:string[]};

const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const ordered=<T extends {id:string}>(items:T[])=>[...items].sort((a,b)=>compare(a.id,b.id));

/** Pure policy over frozen, scoped facts. A case result is never a career-readiness verdict. */
export function buildDevelopmentPlan(input:DevelopmentPlanInput){
 if(input.schemaVersion!==DEVELOPMENT_CASE_SCHEMA)throw new Error('Unsupported development case schema');
 const requirements=ordered(input.requirements),activities=ordered(input.activities),attempts=ordered(input.attempts);
 const sources=new Set(input.sources.map(s=>s.id));
 if(new Set(requirements.map(r=>r.id)).size!==requirements.length||new Set(activities.map(a=>a.id)).size!==activities.length)throw new Error('Duplicate plan facts');
 if(requirements.some(r=>!sources.has(r.sourceId)||r.criteria.some(c=>!sources.has(c.sourceId))))throw new Error('Missing requirement provenance');
 if(activities.some(a=>!['pilot','reviewed'].includes(a.status)||a.sourceIds.some(id=>!sources.has(id))))throw new Error('Unavailable activity content');
 if(input.levelAvailability!=='selected'&&requirements.some(r=>r.kind==='career_level'))throw new Error('Career requirements need an available goal');
 const grouped=new Map<string,Set<string>>();
 for(const c of input.confirmations){
  if(c.releaseId!==input.target.releaseId)throw new Error('Confirmation belongs to another source release');
  const group=grouped.get(c.ogr)??new Set();group.add(c.response);grouped.set(c.ogr,group);
 }
 const practice=new Map([...grouped].map(([ogr,responses])=>[ogr,responses.size===1?[...responses][0]!:'conflicting']));
 const available=new Set(activities.map(a=>a.id));
 const validAttempts=attempts.filter(t=>activities.some(a=>a.id===t.activityId&&a.contentHash===t.contentHash));
 const passed=new Set(validAttempts.filter(t=>t.outcome==='passed').map(t=>t.activityId));
 const matching=(r:PlanRequirement,a:PlanActivity)=>Boolean(r.skillOgr&&a.skillOgrs.includes(r.skillOgr))||a.levelRequirementIds.includes(r.id);
 const gaps=requirements.map(r=>{
  const confirmations=ordered(input.confirmations.filter(c=>c.ogr===r.skillOgr));
  const declared=r.skillOgr?practice.get(r.skillOgr):undefined;
  const evidence=ordered(input.evidence.selected.filter(e=>e.skillId===r.skillId));
  const independentlyAssessed=evidence.filter(e=>['human_validated','quiz_sufficient_coverage','quiz_plus_practical'].includes(e.type));
  const disputed=r.skillId&&input.evidence.conflictingSkillIds.includes(r.skillId);
  const state:GapState=disputed||declared==='conflicting'?'conflicting':declared==='not_yet'?'development_needed':
   declared==='practiced'?'declared_practice':independentlyAssessed.length?'evidence_available':
    evidence.some(e=>e.type==='self_declared'&&e.level===0)?'development_needed':
    evidence.some(e=>['self_declared','cv_extracted_confirmed'].includes(e.type)&&e.level>0)?'declared_practice':'unknown';
  const related=activities.filter(a=>matching(r,a));
  return {...r,state,confirmationIds:confirmations.map(c=>c.id),declarations:evidence.filter(e=>!independentlyAssessed.includes(e)),
   assessedEvidence:independentlyAssessed,disagreements:input.evidence.disagreements.filter(d=>d.skillId===r.skillId),
   activityIds:related.map(a=>a.id),exerciseAttemptIds:validAttempts.filter(t=>related.some(a=>a.id===t.activityId)).map(t=>t.id),
   canConfirmPractice:Boolean(r.skillOgr&&requirements.some(x=>x.kind==='occupation'&&x.skillOgr===r.skillOgr)),
   professionalMastery:'not_established' as const,targetAssessment:'not_assessed' as const,
   assessmentCriteriaAvailable:r.criteria.length>0};
 });
 // Only explicit activity edges can add prerequisites; catalogue hierarchy is never an edge.
 const included=new Set(activities.filter(a=>requirements.some(r=>matching(r,a))).map(a=>a.id));
 const visiting=new Set<string>(),visited=new Set<string>(),exerciseOrder:string[]=[];
 const visit=(id:string)=>{if(visiting.has(id))throw new Error('Cyclic activity prerequisites');if(visited.has(id))return;
  const a=activities.find(a=>a.id===id);if(!a)return;visiting.add(id);
  for(const p of [...a.prerequisites].sort((a,b)=>compare(a.code,b.code)))if(p.kind==='activity_passed'&&available.has(p.requiredActivityId!)){included.add(p.requiredActivityId!);visit(p.requiredActivityId!);}
  visiting.delete(id);visited.add(id);exerciseOrder.push(id);
 };
 for(const id of [...included].sort(compare))visit(id);
 const milestones:PlanMilestone[]=[];
 for(const gap of gaps){
  if(gap.canConfirmPractice&&['unknown','conflicting'].includes(gap.state))milestones.push({id:`clarify:${gap.id}`,kind:'clarify',label:gap.label,
   explanation:gap.state==='conflicting'?'Vos déclarations divergent. Choisissez la situation qui décrit votre pratique actuelle.':'Indiquez si vous avez déjà pratiqué cette compétence.',
   state:'ready',requirementIds:[gap.id],dependsOn:[],activityId:null,skillOgr:gap.skillOgr,minutes:null,sourceIds:[gap.sourceId],evidenceIds:gap.confirmationIds});
 }
 for(const id of exerciseOrder){
  const a=activities.find(a=>a.id===id)!,related=gaps.filter(r=>matching(r,a));
  const prerequisites=resolveActivityPrerequisites(a.prerequisites,passed,available,practice);
  const complete=passed.has(id);
  const state=complete?'completed':prerequisites.some(p=>p.state==='unavailable')?'unavailable':prerequisites.some(p=>p.state==='unmet')?'blocked':prerequisites.some(p=>p.state==='unknown')?'needs_information':'ready';
  const dependsOn=a.prerequisites.flatMap(p=>p.kind==='activity_passed'?[`exercise:${p.requiredActivityId}`]:gaps.filter(g=>g.canConfirmPractice&&g.skillOgr===p.skillOgr&&['unknown','conflicting'].includes(g.state)).map(g=>`clarify:${g.id}`));
  milestones.push({id:`exercise:${id}`,kind:'exercise',label:a.title,state,requirementIds:related.map(r=>r.id),dependsOn,
   explanation:complete?'Les critères de ce cas ont été remplis. La compétence professionnelle reste à évaluer.':
    state==='ready'?'Exercice disponible pour ce métier et ce pays. Ses critères portent sur le cas fourni.':prerequisites.filter(p=>p.state!=='met').map(p=>`${p.label} : ${p.explanation}`).join(' '),
   activityId:id,skillOgr:null,minutes:a.minutes,sourceIds:a.sourceIds,evidenceIds:validAttempts.filter(t=>t.activityId===id).map(t=>t.id)});
 }
 for(const gap of gaps)milestones.push({id:`assessment:${gap.id}`,kind:'assessment',label:gap.label,
  explanation:gap.criteria.length?'Les critères du niveau visé nécessitent une évaluation dédiée. Aucun dispositif de validation de ces critères n’est connecté.':
   'La fiche métier ne fournit pas de niveau attendu ni de critères de validation. Le plan ne peut pas conclure à la maîtrise.',
  state:'unavailable',requirementIds:[gap.id],dependsOn:[],activityId:null,skillOgr:gap.skillOgr,minutes:null,
  sourceIds:[gap.sourceId,...gap.criteria.map(c=>c.sourceId)],evidenceIds:gap.assessedEvidence.map(e=>e.id)});
 const notices:{code:string;label:string}[]=[];
 if(input.levelAvailability!=='selected')notices.push({code:input.levelAvailability,label:input.levelAvailability==='market_required'?'Choisissez un pays pour consulter les exercices et les niveaux.':input.levelAvailability==='goal_unavailable'?'Votre objectif de niveau enregistré n’est plus disponible avec ces choix.':input.levelAvailability==='goal_required'?'Vous pouvez choisir un objectif parmi les niveaux revus.':'Aucun référentiel de niveaux revu pour ce métier et ce pays. Le plan porte sur les compétences du métier.'});
 if(!input.target.marketCode)milestones.unshift({id:'context:market',kind:'context',label:'Préciser mon pays',explanation:notices[0]!.label,state:'ready',requirementIds:[],dependsOn:[],activityId:null,skillOgr:null,minutes:null,sourceIds:[],evidenceIds:[]});
 const next=milestones.filter(m=>m.state==='ready').sort((a,b)=>{
  const priority=(m:PlanMilestone)=>m.kind==='context'?0:m.kind==='clarify'&&milestones.some(x=>x.dependsOn.includes(m.id))?1:m.kind==='exercise'?2:m.kind==='clarify'&&gaps.some(g=>m.requirementIds.includes(g.id)&&g.activityIds.length)?3:4;
  return priority(a)-priority(b)||compare(a.id,b.id);
 }).slice(0,4).map(m=>m.id);
 return {target:input.target,careerGoal:input.careerGoal,levelAvailability:input.levelAvailability,
  gaps,milestones,nextMilestoneIds:next,notices,
  exerciseResults:attempts.map(t=>({...t,currentlyAvailable:available.has(t.activityId),evidenceKind:'exercise_result' as const})),
  summary:{requirements:gaps.length,unknown:gaps.filter(g=>g.state==='unknown').length,declaredPractice:gaps.filter(g=>g.state==='declared_practice').length,
   developmentNeeded:gaps.filter(g=>g.state==='development_needed').length,conflicting:gaps.filter(g=>g.state==='conflicting').length,
   assessedEvidenceAvailable:gaps.filter(g=>g.assessedEvidence.length).length,withActivity:gaps.filter(g=>g.activityIds.length).length,
   withoutActivity:gaps.filter(g=>!g.activityIds.length).length,exercises:exerciseOrder.length,exercisesCompleted:exerciseOrder.filter(id=>passed.has(id)).length,
   remainingExerciseMinutes:milestones.filter(m=>m.kind==='exercise'&&m.state!=='completed').reduce((n,m)=>n+(m.minutes??0),0)},
  readiness:'not_assessed' as const,masteryEstablished:false as const,
  policy:{exerciseCompletion:'any_pass_of_exact_version_in_same_occupation_and_market',requirements:'no_inherited_level_requirements',assessment:'no_numeric_target_or_criterion_validation_assumed'},
 };
}
export type DevelopmentPlan = ReturnType<typeof buildDevelopmentPlan>;
export type DevelopmentCase = {id:string;createdAt:string;schemaVersion:string;algorithmVersion:string;inputHash:string;outputHash:string;input:DevelopmentPlanInput;plan:DevelopmentPlan};
export function replayDevelopmentCase(record:DevelopmentCase){
 if(record.schemaVersion!==DEVELOPMENT_CASE_SCHEMA||record.algorithmVersion!==ALGORITHM_VERSIONS.developmentPlan)throw new Error('Unsupported development case version');
 if(hashComputationInputs(record.input)!==record.inputHash||hashComputationInputs(record.plan)!==record.outputHash)throw new Error('Development case integrity mismatch');
 const plan=buildDevelopmentPlan(record.input);
 if(hashComputationInputs(plan)!==record.outputHash)throw new Error('Development case replay mismatch');
 return {caseId:record.id,verified:true as const,algorithmVersion:record.algorithmVersion,inputHash:record.inputHash,outputHash:record.outputHash,plan};
}
