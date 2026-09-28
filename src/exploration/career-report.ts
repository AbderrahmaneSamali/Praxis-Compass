import {ALGORITHM_VERSIONS} from '../kernel/algorithm-versions.js';
import {hashComputationInputs} from '../kernel/computation-provenance.js';
import {buildDevelopmentPlan,type DevelopmentPlan,type DevelopmentPlanInput} from './development-plan.js';
import type {ExplorationReason} from './rome-explorer.types.js';
import type {DirectionRecommendation} from './direction-recommendations.js';
import type {RequirementState} from './exploration.types.js';

export const CAREER_REPORT_SCHEMA='career-report-v1';
export type ReportCandidate={code:string;title:string;description:string;access:string[];workContexts:string[];
 releaseId:string;domains:{code:string;label:string}[];reasons:ExplorationReason[];saved:boolean;
 requirements:{id:string;ogr:string;kind:string;label:string;state:RequirementState;sourceReference:string;confirmationId:string|null}[];
 levelAvailability:string;frameworkCount:number};
export type ReportActivity={id:string;version:number;title:string;status:string;contentHash:string;purpose:string;output:string;limitations:string;minutes:number;
 materials:{intro:string;columns:string[];rows:string[][]};steps:{code:string;instruction:string}[];
 prerequisites:{code:string;label:string;rationale:string;state:string;explanation:string}[];
 criteria:{code:string;label:string;expectedBehavior:string}[];
 sources:{id:string;title:string;publisher:string;reference:string;url:string|null;limitations:string}[]};
export type ReportTarget={code:string;input:DevelopmentPlanInput;inputHash:string;plan:DevelopmentPlan;outputHash:string;activities:ReportActivity[]};
export type CareerReportSnapshot={schemaVersion:typeof CAREER_REPORT_SCHEMA;versions:{report:string;plan:string};
 profile:{currentCode:string|null;currentLabel:string|null;domainCode:string|null;domainLabel:string|null;
  marketCode:string|null;marketLabel:string|null;trackCode:string|null;trackLabel:string|null;interests:{code:number;label:string}[]};
 context:{sessionId:string;version:string;status:string;answers:{questionId:string;label:string;answer:string;source:string}[]}|null;
 candidates:ReportCandidate[];recommendations:DirectionRecommendation[];targets:ReportTarget[]};
export type CareerReport={id:string;createdAt:string;schemaVersion:string;contentHash:string;snapshot:CareerReportSnapshot};

/** Every format must pass these checks before exposing frozen facts. */
export function verifyCareerReport(record:CareerReport){
 const s=record.snapshot;
 if(record.schemaVersion!==CAREER_REPORT_SCHEMA||s.schemaVersion!==CAREER_REPORT_SCHEMA||s.versions.report!==ALGORITHM_VERSIONS.careerReport||s.versions.plan!==ALGORITHM_VERSIONS.developmentPlan)throw new Error('Unsupported career report version');
 if(hashComputationInputs(s)!==record.contentHash)throw new Error('Career report integrity mismatch');
 const candidates=new Map(s.candidates.map(c=>[c.code,c]));
 if(candidates.size!==s.candidates.length||!candidates.size||s.targets.length<1||s.targets.length>3||new Set(s.targets.map(t=>t.code)).size!==s.targets.length)throw new Error('Invalid report scope');
 if(s.candidates.some(c=>s.profile.domainCode&&!c.domains.some(d=>d.code===s.profile.domainCode)))throw new Error('Report contains an out-of-domain candidate');
 if(new Set(s.candidates.map(c=>c.releaseId)).size!==1)throw new Error('Mixed report source releases');
 for(const t of s.targets){
  const c=candidates.get(t.code);
  if(!c||t.code!==t.input.target.codeRome||t.input.target.marketCode!==s.profile.marketCode||t.input.target.releaseId!==c.releaseId)throw new Error('Report target scope mismatch');
  if(hashComputationInputs(t.input)!==t.inputHash||hashComputationInputs(t.plan)!==t.outputHash||hashComputationInputs(buildDevelopmentPlan(t.input))!==t.outputHash)throw new Error('Report plan replay mismatch');
  const occupationGaps=t.plan.gaps.filter(g=>g.kind==='occupation');
  const state={supported:'declared_practice',development_needed:'development_needed',unknown:'unknown',conflicting:'conflicting'};
  if(c.requirements.length!==occupationGaps.length||c.requirements.some(r=>!occupationGaps.some(g=>g.id===r.id&&g.label===r.label&&g.skillOgr===r.ogr&&g.state===state[r.state])))throw new Error('Report requirement scope mismatch');
  if(t.activities.some(a=>!t.input.activities.some(p=>p.id===a.id&&p.contentHash===a.contentHash)||!['pilot','reviewed'].includes(a.status)))throw new Error('Unavailable report activity');
 }
 if(s.recommendations.some(r=>!candidates.has(r.directionId.replace(/^rome:/,''))))throw new Error('Out-of-scope report recommendation');
 return {reportId:record.id,verified:true as const,contentHash:record.contentHash,targetCount:s.targets.length,candidateCount:candidates.size};
}

export function reportReason(reason:ExplorationReason):string{
 switch(reason.kind){
  case 'rome_domain':return `Appartient au domaine ${reason.domainLabel}.`;
  case 'rome_interest_centre':return `Intérêt confirmé : ${reason.centreLabel}${reason.principal?' (principal pour ce métier)':''}.`;
  case 'rome_mobility':return `Mobilité publiée depuis le métier ${reason.fromCodeRome}.`;
  case 'rome_shared_skills':return `${reason.sharedSkillOgrs.length} savoir-faire communs avec le métier ${reason.fromCodeRome}.`;
 }
}
export const reportGapLabels:Record<string,string>={unknown:'Pratique inconnue',declared_practice:'Pratique déclarée',development_needed:'À développer selon votre déclaration',conflicting:'Éléments contradictoires',evidence_available:'Évaluation disponible ; objectif non évalué'};
export const reportMilestoneLabels:Record<string,string>={ready:'Disponible',blocked:'Prérequis à terminer',needs_information:'Prérequis à préciser',completed:'Cas réussi',unavailable:'Indisponible'};
export type ReportBlock={kind:'title'|'heading'|'subheading'|'paragraph'|'note'|'bullet';text:string;anchor?:string;pageBreak?:boolean};
export type ReportDocument={title:string;id:string;createdAt:string;contentHash:string;candidateCount:number;targetCount:number;blocks:ReportBlock[]};

/** One untruncated document feeds HTML and PDF. Presentation never reads the database. */
export function careerReportDocument(record:CareerReport):ReportDocument{
 verifyCareerReport(record);const s=record.snapshot,p=s.profile,blocks:ReportBlock[]=[];
 const add=(kind:ReportBlock['kind'],text:string,extra:Partial<ReportBlock>={})=>blocks.push({kind,text,...extra});
 const lines=(label:string,values:readonly string[])=>{if(values.length){add('subheading',label);for(const value of values)add('bullet',value);}};
 add('title','Votre rapport d’exploration professionnelle');
 add('paragraph',`${s.candidates.length} métiers dans votre périmètre · ${s.targets.length} cible(s) analysée(s) en détail.`);
 add('note','Ce rapport décrit les informations enregistrées à sa création. Il ne garantit ni accès à un emploi, ni maîtrise professionnelle, ni niveau de carrière. Les inconnues restent visibles.');
 add('heading','01 / Votre point de départ',{anchor:'context'});
 for(const [label,value] of [['Domaine exploré',p.domainLabel??'Tous les domaines reliés à vos choix'],['Métier actuel ou précédent',p.currentLabel??'Non précisé'],['Pays de progression',p.marketLabel??'Non précisé'],['Parcours',p.trackLabel??'Tous les parcours']])add('paragraph',`${label} : ${value}.`);
 lines('Centres d’intérêt confirmés',p.interests.map(i=>i.label));if(!p.interests.length)add('paragraph','Aucun centre d’intérêt confirmé.');
 if(s.context){add('subheading',`Situation déclarée${s.context.status==='in_progress'?' - questionnaire en cours':''}`);for(const a of s.context.answers)add('paragraph',`${a.label} : ${a.answer}${a.source==='learner'?'':' (information reprise du parcours)'}.`);}else add('paragraph','Situation personnelle non renseignée dans le questionnaire.');
 add('note','Les fiches métiers proviennent de France Travail. Le pays sélectionne les exercices et référentiels de progression ; il ne transforme pas ces fiches en validation réglementaire locale.');
 add('heading','02 / Quelques pistes à examiner',{anchor:'recommendations'});
 add('paragraph','Cette sélection sert de point de départ. L’annexe contient tous les métiers du périmètre. L’ordre repose sur les intérêts confirmés, la pratique déclarée et les liens du catalogue ; aucun score de compatibilité n’est calculé.');
 for(const r of s.recommendations){add('subheading',r.title);add('paragraph',r.rankingNote);lines('Liens enregistrés',r.signals.map(x=>x.label));add('paragraph',`${r.confirmedCount} pratique(s) déclarée(s) ; ${r.unknownCount} exigence(s) inconnue(s) ou contradictoire(s).`);if(r.nextStep.kind==='confirm')add('paragraph',`À clarifier : ${r.nextStep.label}.`);else add('paragraph','Consultez les exercices disponibles dans l’analyse de cette cible ; une suggestion générale ne remplace pas une activité du catalogue.');}
 add('heading','03 / Vos cibles et leur plan',{anchor:'targets',pageBreak:true});
 for(const [index,t] of s.targets.entries()){
  const c=s.candidates.find(c=>c.code===t.code)!,plan=t.plan,summary=plan.summary;
  add('heading',`${index+1}. ${c.title}`,{anchor:`target-${c.code}`,pageBreak:index>0});add('paragraph',c.description);
  lines('Pourquoi cette piste apparaît',c.reasons.map(reportReason));lines('Accès au métier selon la source',c.access);
  add('subheading','Objectif de progression');
  if(plan.careerGoal){add('paragraph',`Objectif : ${plan.careerGoal.targetLevelLabel}. Référentiel ${plan.careerGoal.frameworkId}, version ${plan.careerGoal.frameworkVersion}. Niveau de départ déclaré : ${plan.careerGoal.currentLevelCode??'non précisé'} ; aucune validation n’en découle.`);}
  for(const n of plan.notices)add('note',n.label);
  add('paragraph',`${summary.requirements} exigences : ${summary.declaredPractice} pratique(s) déclarée(s), ${summary.developmentNeeded} à développer selon déclaration, ${summary.unknown} inconnue(s), ${summary.conflicting} contradictoire(s). ${summary.assessedEvidenceAvailable} exigence(s) avec une évaluation liée à un identifiant exact.`);
  add('paragraph',`${summary.withActivity} exigence(s) reliée(s) à un exercice, ${summary.withoutActivity} sans exercice disponible. ${summary.exercisesCompleted}/${summary.exercises} exercices réussis sur leur cas. Temps estimé des exercices restants : ${summary.remainingExerciseMinutes} minutes ; ce n’est pas un délai de maîtrise du métier.`);
  lines('Prochains jalons disponibles',plan.nextMilestoneIds.map(id=>{const m=plan.milestones.find(m=>m.id===id)!;return `${m.label} : ${m.explanation}`;}));
  add('subheading','Parcours des exercices et dépendances');
  const exercises=plan.milestones.filter(m=>m.kind==='exercise');if(!exercises.length)add('paragraph','Aucun exercice disponible pour cette cible et ce pays.');
  for(const m of exercises){add('bullet',`${m.label} - ${reportMilestoneLabels[m.state]}. ${m.explanation}`);if(m.dependsOn.length)add('paragraph',`Dépend de : ${m.dependsOn.map(id=>plan.milestones.find(x=>x.id===id)?.label??'préalable indisponible').join(' ; ')}.`);}
  add('subheading','Analyse complète des exigences');
  for(const g of plan.gaps){
   add('subheading',g.label);add('paragraph',`${g.kind==='career_level'?'Exigence du niveau visé':'Exigence du métier'} - ${reportGapLabels[g.state]}.`);
   if(g.expectedBehavior)add('paragraph',`Comportement attendu : ${g.expectedBehavior}`);
   add('paragraph',`${g.confirmationIds.length} déclaration(s) directe(s) ; ${g.exerciseAttemptIds.length} tentative(s) d’exercice liée(s). Maîtrise professionnelle non établie.`);
   for(const e of g.declarations)add('paragraph',`Indice ${e.type==='self_declared'?'déclaré':'de parcours'} : niveau ${e.level}, observé le ${e.observedAt.slice(0,10)}. Ce résultat reste distinct d’une évaluation indépendante.`);
   for(const e of g.assessedEvidence)add('paragraph',`Évaluation ${e.type==='human_validated'?'humaine':'par test'} : niveau ${e.level}, observé le ${e.observedAt.slice(0,10)}. L’objectif de carrière reste non évalué.`);
   if(g.disagreements.length)add('note','Des éléments d’évaluation divergent ; leur résolution et leurs identifiants sont conservés dans le dossier.');
   add('paragraph',g.activityIds.length?`Exercices liés : ${g.activityIds.map(id=>t.input.activities.find(a=>a.id===id)!.title).join(' ; ')}.`:'Aucun exercice disponible dans le catalogue.');
   if(g.criteria.length){lines('Critères attendus',g.criteria.map(k=>k.label));add('paragraph','Aucun dispositif de validation de ces critères de niveau n’est connecté.');}
   else add('paragraph','La fiche ne donne pas de niveau attendu ni de critères de validation professionnelle.');
   add('note',`Source : ${t.input.sources.find(x=>x.id===g.sourceId)?.label??'Source du dossier'}.`);
  }
  add('heading','Activités concrètes pour cette cible');
  for(const a of t.activities){add('subheading',`${a.title} - v${a.version} - ${a.status==='pilot'?'pilote':'revu'}`);add('paragraph',a.purpose);add('paragraph',`Résultat attendu : ${a.output} Durée estimée : ${a.minutes} min.`);lines('Prérequis',a.prerequisites.map(x=>`${x.label} : ${x.explanation} ${x.rationale}`));if(!a.prerequisites.length)add('paragraph','Aucun exercice ni niveau préalable exigé.');add('paragraph',a.materials.intro);for(const row of a.materials.rows)add('bullet',row.map((cell,i)=>`${a.materials.columns[i]} : ${cell}`).join(' ; '));lines('Étapes de réalisation',a.steps.map((step,i)=>`${i+1}. ${step.instruction}`));lines('Critères observables',a.criteria.map(k=>`${k.label} : ${k.expectedBehavior}`));add('note',a.limitations);}
  add('subheading','Résultats d’exercices enregistrés');
  if(!plan.exerciseResults.length)add('paragraph','Aucune tentative enregistrée pour cette cible dans ce pays.');
  for(const a of plan.exerciseResults){add('paragraph',`${a.title} - ${a.submittedAt.slice(0,10)} : ${a.metCount}/${a.totalCount} critères remplis sur ce cas${a.currentlyAvailable?'':' ; version actuellement retirée'}. Référence ${a.id}.`);}
  add('note','Les résultats de ces exercices ne constituent pas une certification de compétence ou de niveau de carrière.');
 }
 add('heading','04 / Annexe complète des possibilités',{anchor:'appendix',pageBreak:true});
 add('paragraph',`${s.candidates.length} métiers, par ordre alphabétique. Tous les métiers et toutes leurs exigences sont conservés ; la sélection courte n’a pas réduit cette annexe.`);
 for(const [i,c] of s.candidates.entries()){
  add('subheading',`${i+1}. ${c.title} (${c.code})`,{anchor:`candidate-${c.code}`});add('paragraph',c.description);
  lines('Liens avec votre point de départ',c.reasons.map(reportReason));lines('Accès au métier selon la source',c.access);lines('Contextes de travail',c.workContexts);
  add('paragraph',c.levelAvailability==='available'?`${c.frameworkCount} référentiel(s) de niveaux revu(s) disponible(s) pour vos choix.`:c.levelAvailability==='market_required'?'Pays à préciser pour consulter les niveaux.':'Aucun référentiel de niveaux revu pour vos choix.');
  for(const [state,label] of [['supported','Pratiquées selon votre déclaration'],['development_needed','Pas encore pratiquées'],['unknown','Pratique inconnue'],['conflicting','Déclarations contradictoires']] as const){
   const rows=c.requirements.filter(r=>r.state===state);if(rows.length){add('paragraph',`${label} (${rows.length}) :`);for(const r of rows)add('bullet',`${r.label} (${({savoir_faire:'savoir-faire',savoir_etre:'savoir-être',savoir:'connaissance'} as Record<string,string>)[r.kind]??'exigence'}).`);}
  }
  add('note',`Source : France Travail, fiche ${c.code}, version ${c.releaseId}. Aucune maîtrise ni adéquation au métier déduite de ces déclarations.`);
 }
 add('heading','05 / Sources, méthode et traçabilité',{anchor:'sources',pageBreak:true});
 add('paragraph','Le catalogue définit les exigences des métiers. Vos confirmations renseignent une pratique déclarée. Les résultats d’exercices portent uniquement sur les cas fournis. Les évaluations PRAXIS ne sont rapprochées d’une exigence que par un identifiant explicitement relié.');
 add('paragraph','Les niveaux de carrière exigent un référentiel revu pour le pays et le métier concernés. Les brouillons ne sont pas exposés. Les transitions entre niveaux n’ajoutent pas de prérequis ou d’équivalences implicites.');
 for(const t of s.targets){
  add('subheading',t.plan.target.title);add('paragraph',`Calcul : ${s.versions.plan}. Empreinte des entrées : ${t.inputHash}. Empreinte du résultat : ${t.outputHash}.`);
  const seen=new Set<string>();
  for(const source of t.input.sources.filter(x=>!x.id.startsWith('rome:'))){const key=`${source.label}:${source.reference}`;if(seen.has(key))continue;seen.add(key);
   add('bullet',`${source.label} - ${source.reference} (${source.status==='pilot'?'contenu pilote':source.status==='reviewed'?'contenu revu':'source publiée'}).`);}
  for(const a of t.activities)for(const source of a.sources){const key=`${source.title}:${source.url??source.reference}`;if(seen.has(key))continue;seen.add(key);
   add('bullet',`${source.title} - ${source.publisher}. ${source.url??source.reference}. Limites : ${source.limitations}`);}
  if(t.input.evidence.ignored.length)add('paragraph',`${t.input.evidence.ignored.length} élément(s) d’évaluation écarté(s) par les règles de sélection ; motifs conservés dans le dossier.`);
 }
 add('paragraph',`Rapport ${record.id}. Version ${s.versions.report}. Empreinte du dossier : ${record.contentHash}.`);
 return {title:'PRAXIS - Rapport d’exploration',id:record.id,createdAt:record.createdAt,contentHash:record.contentHash,candidateCount:s.candidates.length,targetCount:s.targets.length,blocks};
}
