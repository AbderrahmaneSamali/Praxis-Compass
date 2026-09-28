// Explicit operator command. Imports original PRAXIS proposals as drafts only; never publishes.
import 'dotenv/config';
import pg from 'pg';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {CareerLevelRepository,frameworkContentHash,validateFramework} from '../dist/exploration/career-levels.js';

const accessedOn='2026-09-27';
const markets={FR:{label:'France',source:{id:'local-context',title:'Classification bancaire, article 33',publisher:'Légifrance',
  url:'https://www.legifrance.gouv.fr/conv_coll/article/KALIARTI000020406878',supportKind:'level_descriptors',locator:'Article 33, définitions de responsabilités',
  limitations:'Source de contexte française. Aucune équivalence entre sa classification et les niveaux PRAXIS proposés. Champ conventionnel à vérifier pour chaque employeur.'}},
  MA:{label:'Maroc',source:{id:'local-context',title:'Nos métiers',publisher:'BANK OF AFRICA',url:'https://www.bankofafrica.ma/fr/groupe/nos-metiers',
  supportKind:'occupation_context',locator:'Métiers et domaines d’expertise du groupe',
  limitations:'Présentation d’un employeur marocain, pas une grille nationale de niveaux. Ne valide aucun seuil de séniorité, ni aucune correspondance de compétences.'}}};

export async function createCareerFrameworkDrafts(pool){
  const available=await pool.query("SELECT domain_code FROM praxis.rome_professional_domains WHERE domain_code IN ('C12','C13')");
  if(available.rowCount!==2)throw new Error('Import the occupation source data before creating career framework drafts');
  await pool.query("INSERT INTO praxis.career_family VALUES ('banking','C12','Banque'),('finance','C13','Finance') ON CONFLICT(id) DO NOTHING");
  const created=[];
  for(const [marketCode,market] of Object.entries(markets))for(const family of ['banking','finance']){
    const id=`${marketCode.toLowerCase()}-${family}-v1`,client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`career-draft:${id}`]);
      if((await client.query('SELECT id FROM praxis.career_framework WHERE id=$1',[id])).rowCount){await client.query('COMMIT');created.push(id);continue;}
      const banking=family==='banking',familyLabel=banking?'Banque':'Finance';
      await client.query(`INSERT INTO praxis.career_framework(id,family_id,market_code,version,title_fr,scope_fr,limitations_fr,authored_by)
        VALUES ($1,$2,$3,1,$4,$5,$6,'praxis-research-draft')`,[id,family,marketCode,`${familyLabel} · ${market.label} · proposition de niveaux`,
        banking?'Pilote limité à l’analyse de crédit (C1202/C1214) et à la direction d’agence (C1207).':'Pilote limité aux opérations sur marchés financiers (C1302), avec des variantes proposées d’expertise, de projet et d’encadrement.',
        'Brouillon éditorial. Libellés, critères, affectations métier et transitions à faire revoir par un spécialiste du marché. Aucun grade officiel, droit à promotion, délai, salaire, ni équivalence Senior/Lead/Staff. Les niveaux ne s’étendent pas automatiquement à toute la famille.']);
      const sources=[market.source,{id:'proposal',title:'Proposition de structuration PRAXIS',publisher:'PRAXIS · rédaction de brouillon',url:null,
        supportKind:'authored_proposal',locator:'database/career-framework-drafts.mjs',limitations:'Tous les niveaux et critères ci-dessous sont des propositions. Le fait de citer des sources de contexte ne les valide pas.'},
        {id:'catalog',title:'Catalogue métiers utilisé pour les identifiants de compétences',publisher:'France Travail',url:'https://www.francetravail.fr/employeur/vos-recrutements/le-rome-et-les-fiches-metiers.html',
          supportKind:'occupation_context',locator:'Base locale active : identifiants métier et compétence',limitations:marketCode==='MA'?'Taxonomie française de référence technique. Applicabilité au Maroc et attentes par niveau à revoir séparément.':'La fiche métier ne donne pas de seuil de maîtrise par niveau de carrière.'}];
      if(marketCode==='FR'&&banking)sources.push({id:'management-context',title:'Animation et responsabilité d’unité commerciale',publisher:'Observatoire des métiers de la banque',
        url:'https://www.observatoire-metiers-banque.fr/nos-metiers/metiers/metiers-de-lanimation-et-de-la-responsabilite-dunite-commerciale/',supportKind:'occupation_context',locator:'Missions et compétences',limitations:'Responsabilités de métier ; ne définit pas les deux niveaux de management proposés.'});
      if(marketCode==='MA')sources.push({id:'career-policy',title:'Emploi & carrières',publisher:'Attijariwafa bank',url:'https://www.attijariwafabank.com/fr/emploi-carrieres',
        supportKind:'career_policy',locator:'Politique RH et développement des compétences',limitations:'Contexte propre à cet employeur. Aucune grille de grades ou de maîtrise publiquement établie dans cette page.'});
      for(const s of sources)await client.query(`INSERT INTO praxis.career_framework_source(framework_id,id,title,publisher,url,accessed_on,locator,support_kind,reuse_note,limitations_fr)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,s.id,s.title,s.publisher,s.url,accessedOn,s.locator,s.supportKind,
        s.id==='proposal'?'Texte original PRAXIS, à revoir.':'Lien bibliographique et résumé limité ; aucun texte source intégral reproduit, aucune licence de redistribution présumée.',s.limitations]);
      const levels=[
        {code:'E1',track:'expertise',label:banking?'Analyste de crédit accompagné':'Opérateur accompagné',order:1,people:false,
          autonomy:'Traiter des situations définies avec validation par un référent.',scope:'Dossiers ou opérations délimités.',influence:'Signaler les anomalies et demander une vérification.'},
        {code:'E2',track:'expertise',label:banking?'Analyste de crédit autonome':'Gestionnaire autonome des opérations',order:2,people:false,
          autonomy:'Décider dans les limites documentées de sa délégation.',scope:'Ensemble de dossiers ou flux attribués.',influence:'Expliquer ses décisions et aider à résoudre les incidents courants.'},
        {code:'E3',track:'expertise',label:banking?'Référent en analyse de crédit':'Référent opérations de marché',order:3,people:false,
          autonomy:'Traiter les situations complexes et faire évoluer les méthodes dans son mandat.',scope:'Expertise partagée au-delà de son portefeuille de dossiers.',influence:'Accompagner les pairs et soumettre des améliorations aux instances compétentes.'},
        {code:'P1',track:'project_leadership',label:banking?'Pilote de projet crédit':'Pilote de projet opérations',order:1,people:false,
          autonomy:'Coordonner un projet selon un mandat, des jalons et une gouvernance explicites.',scope:'Projet avec plusieurs contributeurs.',influence:'Obtenir des arbitrages sans supposer d’autorité hiérarchique.'},
        {code:'M1',track:'management',label:banking?'Responsable d’agence · prise de fonction':'Responsable d’équipe opérations',order:1,people:true,
          autonomy:'Organiser l’activité d’une équipe dans le cadre des délégations reçues.',scope:'Une équipe avec objectifs et moyens identifiés.',influence:'Répartir le travail, accompagner les collaborateurs et faire remonter les risques.'},
        {code:'M2',track:'management',label:banking?'Responsable d’agence · périmètre élargi':'Responsable d’activité opérations',order:2,people:true,
          autonomy:'Arbitrer les priorités et les ressources d’un périmètre plus complexe.',scope:'Activité élargie, interfaces et délégations à préciser avec l’employeur.',influence:'Développer les relais et organiser la supervision des risques.'},
      ];
      for(const l of levels){
        await client.query(`INSERT INTO praxis.career_level(framework_id,code,track_code,label_fr,display_order,autonomy_fr,scope_fr,influence_fr,manages_people,basis,source_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'editorial_proposal','proposal')`,[id,l.code,l.track,l.label,l.order,l.autonomy,l.scope,l.influence,l.people]);
        const occupations=banking?(l.people?['C1207']:['C1202','C1214']):['C1302'];
        for(const code of occupations)await client.query(`INSERT INTO praxis.career_level_occupation(framework_id,level_code,code_rome,rationale_fr,source_id)
          VALUES ($1,$2,$3,$4,'proposal')`,[id,l.code,code,l.people?'Variante proposée uniquement pour un poste comportant réellement une responsabilité hiérarchique. Le code métier ne suffit pas à établir cette responsabilité.':'Rattachement proposé à ce métier pilote ; pertinence locale et périmètre à faire valider.']);
        const rows=[['autonomy','Autonomie et délégation',l.autonomy],['scope','Périmètre de responsabilité',l.scope],['influence',l.people?'Accompagnement de l’équipe':'Contribution collective',l.influence]];
        for(const [dimension,label,behavior] of rows){
          const requirementId=`${l.code}-${dimension}`;
          await client.query(`INSERT INTO praxis.career_level_requirement(framework_id,id,level_code,dimension,label_fr,expected_behavior_fr,source_id)
            VALUES ($1,$2,$3,$4,$5,$6,'proposal')`,[id,requirementId,l.code,dimension,label,behavior]);
          await client.query(`INSERT INTO praxis.career_level_evidence_criterion(framework_id,requirement_id,code,label_fr,assessment_mode,source_id)
            VALUES ($1,$2,'scenario',$3,'structured_scenario','proposal')`,[id,requirementId,
            dimension==='autonomy'?'Dans une mise en situation, distinguer les décisions autorisées de celles à escalader.':dimension==='scope'?'Sélectionner les responsabilités et interfaces qui appartiennent au mandat présenté.':l.people?'Dans un cas d’équipe, choisir une répartition justifiée du travail et un accompagnement adapté.':'Dans un cas collectif, choisir une contribution adaptée et identifier les personnes à consulter.']);
        }
        const skillOgr=l.people?'300440':banking?'123187':'121569';
        const skillLabel=l.people?'Animer, coordonner une équipe':banking?'Evaluer la solvabilité d’un créditeur et les risques':'Contrôler la conformité de traitement des opérations boursières';
        await client.query(`INSERT INTO praxis.career_level_requirement(framework_id,id,level_code,dimension,label_fr,expected_behavior_fr,skill_ogr,source_id)
          VALUES ($1,$2,$3,'skill',$4,$5,$6,'proposal')`,[id,`${l.code}-skill`,l.code,skillLabel,
          `Proposition : mobiliser cette compétence au périmètre et à l’autonomie décrits pour « ${l.label} ». Une grille métier locale doit encore préciser les critères d’évaluation.`,skillOgr]);
        await client.query(`INSERT INTO praxis.career_level_evidence_criterion(framework_id,requirement_id,code,label_fr,assessment_mode,source_id)
          VALUES ($1,$2,'observed',$3,'observed_practice','proposal')`,[id,`${l.code}-skill`,'Faire observer une situation représentative et faire confirmer les critères de qualité, d’autonomie et d’escalade par un évaluateur désigné.']);
      }
      for(const [from,to,kind] of [['E1','E2','progression'],['E2','E3','progression'],['E2','P1','track_change'],['E3','M1','track_change'],['M1','M2','progression']]){
        await client.query(`INSERT INTO praxis.career_level_transition(framework_id,from_code,to_code,kind,rationale_fr,source_id)
          VALUES ($1,$2,$3,$4,$5,'proposal')`,[id,from,to,kind,'Transition proposée à examiner selon les critères du niveau cible et les responsabilités réelles. Ni passage obligatoire, ni promotion garantie.']);
      }
      await client.query('COMMIT');created.push(id);
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  return created;
}

export async function exportCareerFrameworkDrafts(pool,ids){
  const repo=new CareerLevelRepository(pool),bundles=[];
  for(const id of ids){const bundle=await repo.bundle(id);if(bundle)bundles.push({...bundle,hash:frameworkContentHash(bundle),structuralErrors:validateFramework(bundle)});}
  await mkdir(new URL('../docs/career-frameworks/',import.meta.url),{recursive:true});
  for(const bundle of bundles)await writeFile(new URL(`../docs/career-frameworks/${bundle.framework.id}.json`,import.meta.url),JSON.stringify(bundle,null,2)+'\n');
  const lines=['# Career levels — draft review pack','',`Prepared ${accessedOn}. **All four frameworks remain drafts, at the user’s request.** No learner can select these levels.`,
    '', '## What needs review','',
    '- Validate local role and level names with employers in each market. Senior, Lead and Staff are not automatically translated into grades.',
    '- Check each occupation mapping, skill expectation and assessment criterion. These are PRAXIS proposals, not facts extracted from a national competency ladder.',
    '- Confirm management responsibilities from the job itself. Neither a cadre flag nor a portfolio-manager title proves people-management duties.',
    '- Check every transition explicitly; display order does not establish a prerequisite.',
    '- Obtain employer frameworks or applicable local references, and record reviewer identity before publication. France and Morocco have no automatic equivalence.',
    '- Do not publish the Morocco proposals as a Moroccan national classification. The researched employer pages do not establish one.',
    '', '## Reviewed source context','',
    '- France: [banking classification, article 33](https://www.legifrance.gouv.fr/conv_coll/article/KALIARTI000020406878) distinguishes responsibility levels and includes both expertise and management. Its legal applicability depends on the employer; it does not validate the proposed PRAXIS ladder.',
    '- France: [banking management occupation](https://www.observatoire-metiers-banque.fr/nos-metiers/metiers/metiers-de-lanimation-et-de-la-responsabilite-dunite-commerciale/) describes agency responsibilities, including commercial activity, controls and team support. It does not define our two proposed management levels.',
    '- Morocco: [BANK OF AFRICA occupations](https://www.bankofafrica.ma/fr/groupe/nos-metiers) and [Attijariwafa bank careers](https://www.attijariwafabank.com/fr/emploi-carrieres) provide employer context, not a public level-by-level competency standard.',
    '', '## Pilot coverage','', 'Banque: C1202/C1214 for expertise and projects; C1207 for management. Finance: C1302, with management variants requiring explicit role review. Every other occupation remains unavailable for levels.',''];
  for(const b of bundles){
    lines.push(`## ${b.framework.title}`,'',`ID: \`${b.framework.id}\` · status: **${b.framework.status}** · content hash: \`${b.hash}\``, '',b.framework.scope,'',b.framework.limitations,'',
      '| Proposed level | Track | Autonomy | Scope | Influence |','|---|---|---|---|---|');
    for(const l of b.levels)lines.push(`| ${l.code} — ${l.label} | ${l.trackCode} | ${l.autonomy} | ${l.scope} | ${l.influence} |`);
    lines.push('','Transitions: '+b.transitions.map(t=>`${t.fromCode} → ${t.toCode} (${t.kind})`).join('; '),
      '',`[Full structured requirements, sources and criteria](career-frameworks/${b.framework.id}.json)`,'',
      `Structural validation: ${b.structuralErrors.length?b.structuralErrors.join('; '):'passed (does not establish factual validity or reviewer approval)'}.`,'');
  }
  await writeFile(new URL('../docs/career-level-framework-review.md',import.meta.url),lines.join('\n'));
  return bundles.map(b=>({id:b.framework.id,status:b.framework.status,levels:b.levels.length,requirements:b.requirements.length,structuralErrors:b.structuralErrors}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  try{
    const name=(await pool.query('SELECT current_database() AS name')).rows[0].name;
    if(name!=='praxis_standalone'&&!name.endsWith('_test'))throw new Error('Use the standalone or a dedicated test database');
    if(process.argv[2]!=='--write-drafts')throw new Error('Use --write-drafts to import draft proposals and export the review pack');
    const ids=await createCareerFrameworkDrafts(pool);console.log(JSON.stringify(await exportCareerFrameworkDrafts(pool,ids),null,2));
  }finally{await pool.end();}
}
