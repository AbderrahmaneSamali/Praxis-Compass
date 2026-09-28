// Original educational cases, not lending decisions, regulatory rules, or career-level certification.
import 'dotenv/config';
import pg from 'pg';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DevelopmentActivityRepository,activityContentHash,validateActivity,publishDevelopmentActivity} from '../dist/exploration/activities.js';
import {StandaloneRomeExplorer} from '../dist/exploration/rome-explorer.js';

const criterion=(code,label,prompt,expectedBehavior,choices)=>({code,label,prompt,expectedBehavior,
 options:[...choices.map(([code,label,isCorrect,feedback])=>({code,label,isCorrect,feedback})),{code:'unknown',label:'Je ne sais pas encore',isCorrect:false,feedback:'Reprenez les données du cas et les étapes, puis réessayez. Ce résultat ne mesure pas votre maîtrise professionnelle.'}]});
const limitations='Exercice pilote PRAXIS, sans revue métier indépendante. Données fictives et règles propres au cas ; aucune règle réglementaire française ou marocaine, décision de crédit réelle, ni validation de compétence ou de niveau de carrière.';
export const activityDrafts=[
 {key:'credit-evidence',title:'Préparer un dossier de crédit fictif',minutes:20,codes:['C1202','C1214'],ogr:'123187',
  purpose:'Distinguer les données connues, le reste mensuel calculable et les pièces encore manquantes.',output:'Un contrôle de dossier en trois décisions structurées.',
  materials:{intro:'Cas A, en unités monétaires fictives. La procédure de cet exercice demande une pièce de revenu, un justificatif de charges et la liste des engagements avant toute analyse complète. Aucune décision de prêt n’est demandée.',
   columns:['Élément','Donnée reçue','Pièce'],rows:[['Revenu mensuel','4 000','Reçue'],['Charges mensuelles hors engagements','3 000','Reçue'],['Engagements en cours','Non renseignés','Absente']]},
  steps:['Repérez les données accompagnées d’une pièce et la donnée encore inconnue.','Calculez revenu moins charges connues. Ce résultat ne tient pas compte des engagements manquants.','Choisissez la pièce à demander et la prochaine action autorisée par la règle de ce cas.'],
  criteria:[
   criterion('remainder','Calculer avec les données connues','Quel reste mensuel peut-on calculer avant les engagements inconnus ?','Soustraire les seules charges connues sans traiter une donnée manquante comme zéro.',[
    ['7000','7 000',false,'Les charges se soustraient au revenu : 4 000 − 3 000 = 1 000.'],['1000','1 000, avant engagements inconnus',true,'4 000 − 3 000 = 1 000. Les engagements manquants empêchent une conclusion complète.'],['zero','0, car le dossier est incomplet',false,'Un dossier incomplet n’empêche pas ce calcul partiel : 1 000. Il empêche une conclusion sur le reste final.']]),
   criterion('missing','Identifier la pièce manquante','Que faut-il obtenir pour compléter ce dossier selon la règle donnée ?','Identifier le manque plutôt que supposer l’absence d’engagements.',[
    ['commitments','La liste documentée des engagements en cours',true,'Cette seule catégorie n’est ni renseignée ni documentée dans le cas.'],['income','Une seconde copie du revenu déjà justifié',false,'Le revenu est déjà documenté ; la liste des engagements reste manquante.'],['nothing','Aucune pièce, absence signifie zéro',false,'Une donnée absente n’est pas une valeur nulle.']]),
   criterion('next','Respecter les limites du dossier','Quelle est la prochaine action adaptée à ce cas ?','Séparer préparation du dossier et décision de prêt.',[
    ['approve','Accorder directement le prêt',false,'Le cas ne demande pas une décision de prêt et les engagements restent inconnus.'],['reject','Refuser automatiquement le prêt',false,'Une pièce absente ne justifie aucune décision automatique dans ce cas.'],['request','Demander la liste des engagements puis reprendre l’analyse',true,'Le manque est identifié et l’analyse reste ouverte jusqu’à réception de la pièce.']])]},
 {key:'credit-sensitivity',title:'Tester un scénario de trésorerie simple',minutes:25,codes:['C1202','C1214'],ogr:'123187',prerequisite:'credit-evidence',
  purpose:'Comparer deux hypothèses sans transformer un calcul pédagogique en décision de crédit.',output:'Deux restes mensuels et un signal à examiner, enregistrés par choix.',
  materials:{intro:'Cas B : toutes les données sont fournies. Calcul demandé = revenu − charges − engagements existants − mensualité simulée. Règle pédagogique : si le reste devient négatif, signaler ce scénario pour analyse ; ne pas décider du prêt.',columns:['Variable','Situation de base','Scénario'],rows:[['Revenu','4 000','3 600'],['Charges','2 500','2 500'],['Engagements existants','500','500'],['Mensualité simulée','800','800']]},
  steps:['Appliquez la formule fournie à la situation de base.','Appliquez la même formule au scénario ; seul le revenu change.','Comparez les résultats et choisissez le signal conforme à la règle pédagogique.'],
  criteria:[
   criterion('base','Calculer le scénario de base','Quel est le reste dans la situation de base ?','Utiliser les quatre postes fournis.',[
    ['1000','1 000',false,'Ce montant oublie la mensualité simulée : 4 000 − 2 500 − 500 − 800 = 200.'],['200','200',true,'Les quatre postes donnent un reste de 200.'],['700','700',false,'Les engagements existants de 500 doivent aussi être soustraits.']]),
   criterion('stress','Calculer le scénario dégradé','Quel est le reste avec un revenu de 3 600 ?','Réutiliser la même formule sans modifier les autres postes.',[
    ['negative200','−200',true,'3 600 − 2 500 − 500 − 800 = −200.'],['positive200','200',false,'Le revenu diminue de 400 : le reste de 200 devient −200.'],['600','600',false,'La mensualité simulée doit également être soustraite.']]),
   criterion('signal','Interpréter selon la règle du cas','Quelle conclusion respecte les données et la règle pédagogique ?','Signaler le scénario sans inventer un seuil bancaire réel.',[
    ['approve','Le prêt doit obligatoirement être accordé',false,'Le cas n’établit aucune règle d’octroi réelle.'],['decline','Le prêt doit obligatoirement être refusé',false,'Le cas ne donne qu’un signal de trésorerie à analyser.'],['analyse','Le scénario devient négatif ; demander une analyse complémentaire',true,'C’est le signal prévu dans ce cas. Il ne constitue pas une décision de crédit.']])]},
 {key:'market-reconciliation',title:'Rapprocher un lot d’opérations fictives',minutes:20,codes:['C1301','C1302'],ogr:'121569',
  purpose:'Repérer un écart de montant et une opération absente en comparant deux relevés fournis.',output:'Un contrôle de lot avec trois constats sélectionnés.',
  materials:{intro:'Même unité monétaire fictive pour tous les montants. Règle du cas : une référence doit apparaître une seule fois dans le registre, avec le même montant que dans le relevé source. Une valeur « absente » ne signifie pas zéro.',columns:['Référence','Relevé source','Registre'],rows:[['O01','1 250','1 250'],['O02','980','890'],['O03','450','Absente']]},
  steps:['Comparez les références une par une entre le relevé et le registre.','Calculez l’écart de O02 et identifiez le statut de O03.','Comptez les anomalies avant de décider si le lot respecte la règle fournie.'],
  criteria:[
   criterion('difference','Mesurer l’écart','De combien le montant de O02 est-il inférieur au relevé source ?','Calculer 980 − 890.',[
    ['zero','0',false,'Les deux montants diffèrent de 90.'],['90','90',true,'980 − 890 = 90.'],['190','190',false,'La différence est 90, pas 190.']]),
   criterion('missing','Identifier l’absence','Quel constat décrit O03 ?','Distinguer une donnée absente d’un montant nul.',[
    ['absent','Présente dans la source, absente du registre',true,'La ligne source existe mais aucune inscription correspondante n’est fournie.'],['zero','Son montant est nul',false,'Absente ne signifie pas zéro.'],['valid','Les deux relevés concordent',false,'O03 n’a pas de ligne correspondante dans le registre.']]),
   criterion('batch','Contrôler le lot','Combien d’anomalies ce lot comporte-t-il selon la règle donnée ?','Compte séparé de l’écart O02 et de l’absence O03.',[
    ['one','Une : seulement O02',false,'L’absence de O03 est aussi une anomalie.'],['three','Trois : toutes les opérations',false,'O01 concorde ; seules O02 et O03 ont une anomalie.'],['two','Deux : O02 et O03',true,'O02 a un écart de montant ; O03 est absente. Le lot doit être clarifié.']])]},
 {key:'market-correction',title:'Préparer un circuit de correction contrôlé',minutes:25,codes:['C1301','C1302'],ogr:'122031',prerequisite:'market-reconciliation',
  purpose:'Choisir la correction proposée, la pièce manquante et une validation distincte.',output:'Une fiche d’incident structurée pour deux anomalies.',
  materials:{intro:'Suite du lot O01–O03. Dans cette procédure fictive, le préparateur propose une correction ; une autre personne habilitée la valide. Une opération absente exige une pièce source rapprochée avant proposition d’enregistrement. Aucun accès à un système réel n’est requis.',columns:['Anomalie','État','Responsabilité'],rows:[['O02','Source 980 ; registre 890','Préparateur : proposer le montant corrigé'],['O03','Source 450 ; registre absent','Préparateur : rapprocher la pièce'],['Validation','Après préparation','Autre personne habilitée']]},
  steps:['Reprenez les deux anomalies détectées dans le premier exercice.','Pour O02, choisissez le montant à proposer ; pour O03, choisissez la vérification préalable.','Sélectionnez un circuit respectant la séparation préparation/validation imposée par ce cas.'],
  criteria:[
   criterion('amount','Proposer le bon montant','Quel montant proposer pour O02, après rapprochement de la source ?','Proposer 980 sans confondre le montant final et l’écart.',[
    ['90','90',false,'90 est l’écart ; le montant final doit être 980.'],['980','980',true,'Le montant proposé reprend le relevé source rapproché.'],['1870','1 870',false,'Additionner source et registre ne constitue pas une correction.']]),
   criterion('document','Vérifier avant d’enregistrer','Que faire d’abord pour O03 ?','Rapprocher la pièce source avant toute proposition.',[
    ['erase','Supprimer la source pour faire disparaître l’écart',false,'Cela masquerait l’anomalie sans la résoudre.'],['copy','Enregistrer immédiatement sans pièce rapprochée',false,'La procédure fournie exige le rapprochement de la pièce avant proposition.'],['check','Rapprocher la pièce source puis préparer la proposition',true,'Cette action suit la condition explicitement donnée.']]),
   criterion('review','Séparer les responsabilités','Quel circuit est conforme à cette procédure fictive ?','Faire valider par une autre personne habilitée.',[
    ['separate','Un préparateur propose ; une autre personne habilitée valide',true,'Les rôles de préparation et de validation sont séparés.'],['same','Le préparateur valide lui-même son travail',false,'La procédure exige une autre personne pour valider.'],['none','Aucune validation après correction',false,'Une validation est explicitement requise dans le cas.']])]},
 {key:'agency-team-plan',title:'Répartir le travail d’une équipe fictive',minutes:25,codes:['C1207'],ogr:'300440',
  purpose:'Associer tâches, habilitations et capacité disponible dans un cas d’équipe.',output:'Un plan d’affectation et un arbitrage de charge choisis dans une grille.',
  materials:{intro:'Règle propre au cas : la préparation et le contrôle doivent être réalisés par deux personnes distinctes et habilitées. Ana accompagne aussi Chloé pendant 30 minutes. Aucun critère personnel ou appréciation d’un salarié réel n’est utilisé.',columns:['Personne / tâche','Habilitation / durée','Temps disponible'],rows:[['Ana','Préparation ; accompagnement','120 min'],['Bilal','Contrôle','60 min'],['Chloé','Apprentissage accompagné','60 min'],['Lot à préparer','60 min','—'],['Lot à contrôler','45 min','—'],['Accompagnement de Chloé','30 min pour Ana et Chloé','—']]},
  steps:['Associez chaque tâche à une personne disposant de l’habilitation indiquée.','Réservez les 30 minutes d’accompagnement pour Ana et Chloé.','Calculez la capacité restante d’Ana puis examinez une demande supplémentaire de 80 minutes.'],
  criteria:[
   criterion('roles','Respecter les habilitations','Quelle affectation respecte le cas ?','Séparer les rôles et conserver l’accompagnement.',[
    ['ana-all','Ana prépare et contrôle ; Chloé travaille seule',false,'Ana n’est pas habilitée au contrôle et Chloé doit être accompagnée.'],['split','Ana prépare, Bilal contrôle, Chloé apprend avec Ana',true,'Les habilitations et la séparation des rôles sont respectées.'],['chloe-controls','Ana prépare, Chloé contrôle, Bilal accompagne',false,'Chloé n’a pas l’habilitation de contrôle dans le cas fourni.']]),
   criterion('capacity','Calculer la charge restante','Combien de minutes reste-t-il à Ana après préparation et accompagnement ?','120 − 60 − 30.',[
    ['60','60 minutes',false,'L’accompagnement mobilise aussi 30 minutes d’Ana.'],['90','90 minutes',false,'La préparation de 60 minutes doit aussi être soustraite.'],['30','30 minutes',true,'120 − 60 − 30 = 30 minutes.']]),
   criterion('arbitrate','Arbitrer une surcharge','Une nouvelle tâche de 80 minutes arrive pour Ana. Quel constat est correct ?','Comparer la demande à la capacité restante, sans supprimer les contrôles.',[
    ['replan','Il manque 50 minutes ; replanifier ou demander un arbitrage',true,'80 − 30 = 50 minutes manquantes. Le contrôle et l’accompagnement restent prévus.'],['fits','La tâche tient dans les 30 minutes restantes',false,'La demande dépasse la capacité restante de 50 minutes.'],['remove-control','Supprimer le contrôle pour tenir le délai',false,'Cela ne respecte pas la règle de contrôle distinct donnée dans le cas.']])]},
 {key:'market-quality',title:'Mesurer la qualité d’un traitement de lot',minutes:30,codes:['C1302'],ogr:'124442',prerequisite:'market-correction',
  purpose:'Calculer des indicateurs simples et choisir une expérimentation d’amélioration.',output:'Un mini-bilan qualité avec deux indicateurs et une action proposée.',
  materials:{intro:'Cas C : sur 200 opérations traitées, 20 anomalies ont été détectées. 15 de ces anomalies ont été résolues le jour même. Définitions du cas : taux initial = anomalies / opérations ; taux de résolution = anomalies résolues / anomalies détectées. Ces indicateurs n’établissent pas un seuil réglementaire.',columns:['Mesure','Valeur'],rows:[['Opérations traitées','200'],['Anomalies détectées','20'],['Anomalies résolues le jour même','15'],['Anomalies encore ouvertes','5']]},
  steps:['Repérez le dénominateur propre à chaque indicateur.','Calculez les taux initial et de résolution à partir des nombres fournis.','Choisissez une amélioration testable qui conserve la trace des anomalies.'],
  criteria:[
   criterion('initial','Calculer le taux initial','Quel est le taux initial d’anomalies ?','20 / 200 × 100.',[
    ['2.5','2,5 %',false,'2,5 % correspond aux 5 anomalies ouvertes sur 200, pas au taux initial.'],['10','10 %',true,'20 / 200 × 100 = 10 %.'],['20','20 %',false,'20 est le nombre d’anomalies ; le taux utilise aussi les 200 opérations.']]),
   criterion('resolution','Choisir le bon dénominateur','Quel est le taux de résolution des anomalies le jour même ?','15 / 20 × 100.',[
    ['75','75 %',true,'15 anomalies résolues sur 20 détectées donnent 75 %.'],['7.5','7,5 %',false,'Le dénominateur est le nombre d’anomalies détectées (20), pas le nombre d’opérations (200).'],['15','15 %',false,'15 est un nombre d’anomalies ; le taux est 75 %.']]),
   criterion('improve','Proposer une amélioration vérifiable','Quelle action permet de tester une amélioration sans masquer les anomalies ?','Conserver les observations et comparer un correctif sur le même indicateur.',[
    ['hide','Supprimer les alertes encore ouvertes',false,'Cela change la mesure en masquant les observations.'],['declare','Déclarer toutes les anomalies résolues',false,'Cinq anomalies restent ouvertes dans les données du cas.'],['test','Analyser une cause, tester un correctif puis comparer les mêmes indicateurs',true,'Cette démarche conserve les traces et rend le résultat du test comparable.']])]},
];

export async function seedDevelopmentActivities(pool){
 const explorer=new StandaloneRomeExplorer(pool),ids=[];
 for(const a of activityDrafts){
  const id=a.key+'-v1';ids.push(id);
  if((await pool.query('SELECT 1 FROM praxis.development_activity WHERE id=$1',[id])).rowCount)continue;
  const profiles=[];
  for(const code of a.codes){const r=await explorer.requirements(code);if(!r)throw Error('Load occupation source before activity drafts');
   const skill=r.savoirFaire.flatMap(g=>g.subgroups.flatMap(s=>s.items)).find(s=>s.ogr===a.ogr);if(!skill)throw Error('No source occupation/skill link for '+id+'/'+code);profiles.push({code,release:r.releaseId,skill});}
  const client=await pool.connect();try{
   await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['activity-seed:'+id]);
   if((await client.query('SELECT 1 FROM praxis.development_activity WHERE id=$1',[id])).rowCount){await client.query('COMMIT');continue;}
   await client.query(`INSERT INTO praxis.development_activity(id,activity_key,version,title_fr,purpose_fr,output_fr,limitations_fr,estimated_minutes,materials,authored_by)
    VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,'praxis-original-practice')`,[id,a.key,a.title,a.purpose,a.output,limitations,a.minutes,JSON.stringify(a.materials)]);
   await client.query(`INSERT INTO praxis.development_activity_source VALUES
    ($1,'case','Cas pédagogique original PRAXIS','PRAXIS',NULL,'database/development-activities.mjs','authored_exercise',$2),
    ($1,'catalog','Lien métier-compétence du catalogue','France Travail','https://www.francetravail.fr/employeur/vos-recrutements/le-rome-et-les-fiches-metiers.html',$3,'occupation_catalog',$4)`,
    [id,limitations,profiles.map(p=>`rome:${p.release}:${p.code}:item:${a.ogr}`).join('; '),'Le catalogue confirme le lien métier-compétence, pas la qualité pédagogique de cet exercice ni une maîtrise après réussite. Les rattachements locaux France/Maroc restent des périmètres pilotes.']);
   for(const code of a.codes){for(const market of ['FR','MA'])await client.query("INSERT INTO praxis.development_activity_scope VALUES ($1,$2,$3,'case')",[id,code,market]);
    await client.query(`INSERT INTO praxis.rome_development_action(action_id,code_rome,kind,title,activity_version_id) VALUES ($1,$2,'practice',$3,$1) ON CONFLICT DO NOTHING`,[id,code,a.title]);}
   await client.query("INSERT INTO praxis.development_activity_skill VALUES ($1,$2,$3,'catalog')",[id,a.ogr,profiles[0].skill.label]);
   for(const [i,instruction] of a.steps.entries())await client.query('INSERT INTO praxis.development_activity_step VALUES ($1,$2,$3,$4)',[id,'step-'+(i+1),i+1,instruction]);
   if(a.prerequisite)await client.query(`INSERT INTO praxis.development_activity_prerequisite VALUES ($1,'previous','activity_passed',$2,NULL,$3,$4,'case')`,[id,a.prerequisite+'-v1',activityDrafts.find(p=>p.key===a.prerequisite).title,'Ce cas reprend les données et les contrôles exercés dans l’activité précédente. Ce lien est pédagogique et explicite.']);
   for(const [i,c] of a.criteria.entries()){
    await client.query("INSERT INTO praxis.development_activity_criterion VALUES ($1,$2,$3,$4,$5,$6,'case')",[id,c.code,i+1,c.label,c.prompt,c.expectedBehavior]);
    for(const [j,o] of c.options.entries())await client.query('INSERT INTO praxis.development_activity_option VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,c.code,o.code,j+1,o.label,o.isCorrect,o.feedback]);
   }
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 return ids;
}
export async function enableDevelopmentPilots(pool,ids){
 const repo=new DevelopmentActivityRepository(pool);
 for(const id of ids){const b=await repo.bundle(id);if(b.activity.status==='pilot')continue;
  if(b.activity.status!=='draft')throw Error('Do not change an existing reviewed or retired activity');
  await publishDevelopmentActivity(pool,id,{actor:'praxis-pilot-release',decision:'enable_pilot',expectedHash:activityContentHash(b),rationale:'Original fictional cases enabled for testing. Deterministic answer keys checked by tests; no independent professional-content review or mastery claim.'});
 }
}
export async function exportDevelopmentActivities(pool,ids){
 const repo=new DevelopmentActivityRepository(pool),rows=[];
 await mkdir(new URL('../docs/development-activities/',import.meta.url),{recursive:true});
 const doc=['# Development activities — pilot catalogue','',
  'Original fictional exercises. No real credit decisions, local regulations or career-level certification. The France/Morocco career frameworks remain drafts. A pilot is available for testing and is not independently reviewed content.','',
  'Each exercise has a version, exact occupation/country scope, real catalogue skill identifier, case data, ordered steps, explicit prerequisites and selectable assessment criteria. All 18 criteria are automatically checked only against the supplied case. No result writes to skill evidence or career levels.','',
  '## Catalogue','', '| Exercise | Minutes | Occupations | Prerequisite | State |','|---|---:|---|---|---|'];
 for(const id of ids){const b=await repo.bundle(id),errors=validateActivity(b);if(errors.length)throw Error(id+': '+errors.join('; '));
  await writeFile(new URL(`../docs/development-activities/${id}.json`,import.meta.url),JSON.stringify({...b,hash:activityContentHash(b)},null,2)+'\n');
  doc.push(`| [${b.activity.title}](development-activities/${id}.json) | ${b.activity.minutes} | ${[...new Set(b.scopes.map(s=>s.codeRome))].join(', ')} | ${b.prerequisites.map(p=>p.label).join('; ')||'None'} | ${b.activity.status} |`);
  rows.push({id,status:b.activity.status,criteria:b.criteria.length});
 }
 doc.push('','## Review before promotion to reviewed content','',
  '- A named independent reviewer must check the relevance of each task and skill mapping for each market, the instructions, answer choices, feedback, difficulty and duration.',
  '- Fictional case rules must remain labelled as such. Do not reinterpret them as banking regulation or an employer’s policy.',
  '- Career-level links need an explicit reviewed framework/requirement mapping; no Senior, Lead or Staff level is inferred from these exercises.',
  '- A passed exercise can unlock its named sequel in the same occupation and country. It is not independent proof of workplace competence.',
  '- Published pilot/reviewed versions are immutable. Fixes require a new version and retirement of the old version. Learner attempts retain the exact version, content hash, prerequisite snapshot and structured answers.','');
 await writeFile(new URL('../docs/development-activity-review.md',import.meta.url),doc.join('\n'));return rows;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});try{
  const name=(await pool.query('SELECT current_database() AS name')).rows[0].name;if(name!=='praxis_standalone'&&!name.endsWith('_test'))throw Error('Use the standalone or dedicated test database');
  if(!['--write-drafts','--enable-pilots'].includes(process.argv[2]))throw Error('Choose --write-drafts or --enable-pilots');
  const ids=await seedDevelopmentActivities(pool);if(process.argv[2]==='--enable-pilots')await enableDevelopmentPilots(pool,ids);
  console.log(await exportDevelopmentActivities(pool,ids));
 }finally{await pool.end();}
}
