import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import 'dotenv/config';
import {StandaloneRecommendationRepository,StandaloneRomeExplorer,ExplorationRepository,StandaloneContextSurvey,StandaloneAgentGateway,AgentGatewayInputError,SurveyAnswerError,SurveyNotFoundError,SurveyStateError,ContextValidationError,buildEvidenceProfile,exploreDirections,compareDirections,proposeProfileSkills,validateLearner} from '../dist/index.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string' && typeof b==='string' && a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const problem=(status,message)=>Object.assign(new Error(message),{status});
const publicFolder=new URL('./public/',import.meta.url);
const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};

export function createLearnerServer({pool,example=false,assessmentUrl=null,aiProvider=null}){
 const ranker=new StandaloneRecommendationRepository(pool),exploration=new ExplorationRepository(pool),rome=new StandaloneRomeExplorer(pool),survey=new StandaloneContextSurvey(pool),agentGateway=new StandaloneAgentGateway(pool),csrfTokens=new Map(),displayed=new Map(),pendingProposals=new Map();
 if(assessmentUrl && !/^https:\/\//.test(assessmentUrl))throw new TypeError('Assessment integration URL must use HTTPS');
 async function identity(req,res,create=false){
  const token=req.headers.cookie?.match(/(?:^|;\s*)praxis_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(token){
   const found=await pool.query(`SELECT s.learner_id FROM praxis.learner_session s JOIN praxis.learner l ON l.id=s.learner_id
    WHERE s.session_key=$1 AND s.created_at>now()-interval '30 days' AND l.deleted_at IS NULL`,[hash(token)]);
   if(found.rows[0])return {learnerId:found.rows[0].learner_id,key:hash(token)};
  }
  if(!create)throw problem(401,'Votre session a expiré. Rechargez la page.');
  const next=randomBytes(32).toString('hex'),key=hash(next),learnerId=randomUUID(),client=await pool.connect();
  try{await client.query('BEGIN');await client.query("INSERT INTO praxis.learner(id,locale) VALUES ($1,'fr')",[learnerId]);
   await client.query('INSERT INTO praxis.learner_session(session_key,learner_id) VALUES ($1,$2)',[key,learnerId]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  res.setHeader('Set-Cookie',`praxis_session=${next}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
  return {learnerId,key};
 }
 async function body(req){
  if(!req.headers['content-type']?.startsWith('application/json'))throw problem(415,'Envoyez un formulaire JSON.');
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>64*1024)throw problem(413,'Le texte est trop long.');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value || typeof value!=='object' || Array.isArray(value))throw new Error();return value;}catch{throw problem(400,'Le formulaire est illisible.');}
 }
 function constraints(input={}){
  const allowed=['hoursPerWeek','budgetMad','languages','onlineFormat'];
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key)))throw problem(400,'Préférences invalides.');
  const result={remoteOnly:true,hoursPerWeek:input.hoursPerWeek??8};
  if(input.budgetMad!==undefined)result.budgetMad=input.budgetMad;
  if(input.languages!==undefined){if(!Array.isArray(input.languages) || !input.languages.length || input.languages.some(lang=>!['fr','en','ar'].includes(lang)))throw problem(400,'Choisissez une langue valide.');result.languages=[...new Set(input.languages)];}
  if(input.onlineFormat!==undefined){if(!['online_live','online_self_paced'].includes(input.onlineFormat))throw problem(400,'Format invalide.');result.onlineFormat=input.onlineFormat;}
  validateLearner({learnerId:'validation',constraints:result,skills:[]});return result;
 }
 async function target(id){
  if(typeof id!=='string' || id.length>160)throw problem(400,'Choisissez votre objectif.');
  const found=await pool.query("SELECT id FROM praxis.occupation WHERE id=$1 AND status='published'",[id]);
  if(!found.rows[0])throw problem(404,'Cet objectif n’est pas disponible.');return ranker.deriveTargetProfile(id,'fr');
 }
 async function recommendation(user,id,prefs){
  const result=await ranker.recommendFromEvidence({learnerId:user.learnerId,constraints:prefs},id,{explorationProbability:0},'fr');
  const cache=displayed.get(user.key)??new Map();cache.set(result.requestId,{result,recorded:false});
  while(cache.size>3)cache.delete(cache.keys().next().value);displayed.set(user.key,cache);
  return {result,assessmentConnected:Boolean(assessmentUrl),example};
 }
 async function explorationResult(user){
  const profile=await exploration.profile(user.learnerId);
  const [directions,rows,saved,selectedActions,confirmations,context]=await Promise.all([
   exploration.romeDirections(profile),ranker.skillEvidence(user.learnerId),
   exploration.savedDirections(user.learnerId),exploration.selectedActions(user.learnerId),
   exploration.romeConfirmations(user.learnerId),pool.query(`SELECT motivation,situation,hours_per_week,deadline::text
     FROM praxis.learner_context WHERE learner_id=$1 AND superseded_by IS NULL
       AND context_version='praxis-context-survey-v2' ORDER BY created_at DESC LIMIT 1`,[user.learnerId])]);
  const evidence=buildEvidenceProfile({learnerId:user.learnerId,constraints:{remoteOnly:true,hoursPerWeek:8}},rows);
  const contextRow=context.rows[0];
  return {...exploreDirections(profile,directions,evidence,saved,confirmations),profile,selectedActions,
   careerContext:contextRow?{motivation:contextRow.motivation,situation:contextRow.situation,
    hoursPerWeek:contextRow.hours_per_week===null?null:Number(contextRow.hours_per_week),deadline:contextRow.deadline}:null};
 }
 function shortText(value,max,label){if(typeof value!=='string' || value.length>max)throw problem(400,`${label} invalide.`);return value.trim();}
 async function savePreferences(client,user,profile,prefs){
    const contextId=randomUUID();
    await client.query(`INSERT INTO praxis.learner_context(id,learner_id,context_version,goal_kind,goal_text,hours_per_week,
      budget_band,budget_min_mad,budget_max_mad,languages,remote_only,online_format)
      VALUES ($1,$2,'learner-screen-v1','role',$3,$4,$5,$6,$7,$8,true,$9)`,[contextId,user.learnerId,profile.occupationId,prefs.hoursPerWeek,prefs.budgetMad===undefined?null:'range',prefs.budgetMad===undefined?null:0,prefs.budgetMad??null,prefs.languages??null,prefs.onlineFormat??null]);
    await client.query('UPDATE praxis.learner_context SET superseded_by=$1 WHERE learner_id=$2 AND superseded_by IS NULL AND id<>$1',[contextId,user.learnerId]);
    const selectionId=randomUUID();await client.query("INSERT INTO praxis.learner_target_selection(id,learner_id,occupation_id,source) VALUES ($1,$2,$3,'picker')",[selectionId,user.learnerId,profile.occupationId]);
    await client.query('UPDATE praxis.learner_target_selection SET superseded_by=$1 WHERE learner_id=$2 AND superseded_by IS NULL AND id<>$1',[selectionId,user.learnerId]);
 }
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','no-store');
  const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   const port=server.address()?.port;
   if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))throw problem(403,'Adresse locale invalide.');
   const url=new URL(req.url,`http://${req.headers.host}`);
   if(req.method==='GET' && assets[url.pathname]){const [name,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type});res.end(await readFile(new URL(name,publicFolder)));return;}
   if(req.method==='GET' && url.pathname==='/api/bootstrap'){
    const user=await identity(req,res,true),csrf=csrfTokens.get(user.key)??randomBytes(32).toString('hex');csrfTokens.set(user.key,csrf);
    const goals=await pool.query(`SELECT o.id,o.label_fr AS label,count(t.skill_id)::integer AS skill_count FROM praxis.occupation o
      JOIN praxis.navigator_role_skill_targets t ON t.role_id=o.id AND t.archived_at IS NULL AND t.profile_source='authored'
      WHERE o.status='published' GROUP BY o.id,o.label_fr ORDER BY o.label_fr`);
    const saved=await pool.query(`SELECT goal_text,hours_per_week,budget_max_mad,languages,online_format FROM praxis.learner_context
      WHERE learner_id=$1 AND superseded_by IS NULL ORDER BY created_at DESC,id DESC LIMIT 1`,[user.learnerId]);
    const s=saved.rows[0],prefs=s?{hoursPerWeek:Number(s.hours_per_week??8),...(s.budget_max_mad===null?{}:{budgetMad:Number(s.budget_max_mad)}),...(s.languages?.length?{languages:s.languages}:{}),...(s.online_format?{onlineFormat:s.online_format}:{})}:{hoursPerWeek:8,languages:['fr']};
    json({csrf,goals:goals.rows,occupationId:s?.goal_text??goals.rows[0]?.id??null,constraints:prefs,example,assessmentConnected:Boolean(assessmentUrl)});return;
   }
   if(req.method==='GET' && url.pathname==='/api/profile'){
    const user=await identity(req,res);json({profile:await exploration.profile(user.learnerId),directions:await exploration.directions()});return;
   }
   if(req.method==='GET' && url.pathname==='/api/rome/origins'){
    await identity(req,res);const q=url.searchParams.get('q')??'';
    if(q.length>100)throw problem(400,'Recherche trop longue.');
    json({origins:await rome.searchOrigins(q,8)});return;
   }
   if(req.method==='GET' && url.pathname==='/api/rome/interests'){
    await identity(req,res);json({interests:await rome.interestCentres()});return;
   }
   if(req.method==='GET' && url.pathname==='/api/context-survey/latest'){
    const user=await identity(req,res);json({survey:await survey.latest(user.learnerId)});return;
   }
   if(req.method==='GET' && /^\/api\/directions\/[^/]+$/.test(url.pathname)){
    const user=await identity(req,res),id=decodeURIComponent(url.pathname.split('/')[3]);
    const result=await explorationResult(user),direction=result.possibilities.find(item=>item.id===id);
    if(!direction)throw problem(404,'Direction indisponible.');json({direction,selectedActions:result.selectedActions});return;
   }
   if(req.method!=='POST' || !url.pathname.startsWith('/api/'))throw problem(404,'Page introuvable.');
   const user=await identity(req,res);
   if(req.headers.origin!==`http://${req.headers.host}` || !equal(req.headers['x-praxis-csrf'],csrfTokens.get(user.key)))throw problem(403,'Rechargez la page avant d’envoyer ce formulaire.');
   const data=await body(req);
   if(url.pathname==='/api/context-survey/start'){
    const profile=await exploration.profile(user.learnerId);
    json({survey:await survey.start({learnerId:user.learnerId,romeCode:profile.currentRomeCode??undefined})});return;
   }
   if(url.pathname==='/api/context-survey/answer'){
    json({survey:await survey.answer(user.learnerId,data.sessionId,
      {questionId:data.questionId,value:data.value,declined:data.declined})});return;
   }
   if(url.pathname==='/api/context-survey/back'){
    json({survey:await survey.back(user.learnerId,data.sessionId)});return;
   }
   if(url.pathname==='/api/context-survey/complete'){
    json({survey:await survey.complete(user.learnerId,data.sessionId)});return;
   }
   if(url.pathname==='/api/profile'){
    if(data.currentRomeCode!==null && data.currentRomeCode!==undefined &&
      (typeof data.currentRomeCode!=='string' || !(await rome.occupation(data.currentRomeCode))))throw problem(400,'Métier ROME indisponible.');
    if(!Array.isArray(data.confirmedInterestCodes) || data.confirmedInterestCodes.length>30 ||
      data.confirmedInterestCodes.some(code=>!Number.isInteger(code)) ||
      new Set(data.confirmedInterestCodes).size!==data.confirmedInterestCodes.length)throw problem(400,'Centres d’intérêt invalides.');
    const known=new Set((await rome.interestCentres()).map(item=>item.code));
    if(data.confirmedInterestCodes.some(code=>!known.has(code)))throw problem(400,'Centre d’intérêt inconnu.');
    const profile=await exploration.saveRomeProfile({learnerId:user.learnerId,currentRoleId:null,
     currentRomeCode:data.currentRomeCode??null,confirmedInterestCodes:data.confirmedInterestCodes,
     experience:shortText(data.experience,4000,'Expérience'),interests:shortText(data.interests,1000,'Centres d’intérêt'),
     constraints:shortText(data.constraints,1000,'Contraintes'),updatedAt:null});
    pendingProposals.delete(user.key);
    json({profile});return;
   }
   if(url.pathname==='/api/profile/proposals'){
    const profile=await exploration.profile(user.learnerId),directions=await exploration.directions();
    const catalog=[...new Map(directions.flatMap(item=>item.requirements.map(skill=>[skill.skillId,{skillId:skill.skillId,label:skill.label}]))).values()];
    const result=await proposeProfileSkills(profile.experience,catalog,aiProvider);
    const proposalId=result.proposals.length?randomUUID():null;
    if(proposalId)pendingProposals.set(user.key,{proposalId,skillIds:new Set(result.proposals.map(item=>item.skillId)),expires:Date.now()+10*60*1000});
    json({...result,proposalId});return;
   }
   if(url.pathname==='/api/profile/skills' || url.pathname==='/api/profile/confirmations'){
    const confirmation=url.pathname==='/api/profile/confirmations';
    const pending=confirmation?pendingProposals.get(user.key):null;
    if(confirmation && (data.confirmed!==true || !pending || pending.proposalId!==data.proposalId || pending.expires<Date.now()))throw problem(400,'Cette proposition a expiré. Demandez-en une nouvelle.');
    const directions=await exploration.directions(),allowed=new Set(directions.flatMap(item=>item.requirements.map(skill=>skill.skillId)));
    if(!Array.isArray(data.declarations) || data.declarations.length<1 || data.declarations.length>40)throw problem(400,'Choisissez une ou plusieurs compétences.');
    const seen=new Set();
    const declarations=data.declarations.map(item=>{
     if(!item || typeof item.skillId!=='string' || !allowed.has(item.skillId) || (confirmation&&!pending.skillIds.has(item.skillId)) || seen.has(item.skillId) ||
       !Number.isInteger(item.level) || item.level<0 || item.level>4)throw problem(400,'Compétence ou niveau invalide.');
     seen.add(item.skillId);
     const workExample=shortText(item.workExample??'',2000,'Exemple');
     if(item.level>0 && workExample.length<5)throw problem(400,'Ajoutez un exemple concret d’au moins cinq caractères.');
     return {skillId:item.skillId,level:item.level,workExample};
    });
    const client=await pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[user.learnerId]);
     for(const item of declarations){
      const id=randomUUID();
      await client.query(`INSERT INTO praxis.skill_evidence(id,learner_id,skill_id,level,evidence_type,confidence,provenance,observed_at)
       VALUES ($1,$2,$3,$4,'self_declared','low',$5::jsonb,clock_timestamp())`,
       [id,user.learnerId,item.skillId,item.level,JSON.stringify({source:confirmation?'confirmed_profile_proposal':'exploration_profile',workExample:item.workExample})]);
      await client.query(`UPDATE praxis.skill_evidence SET superseded_by=$1 WHERE learner_id=$2 AND skill_id=$3
       AND evidence_type='self_declared' AND superseded_by IS NULL AND id<>$1`,[id,user.learnerId,item.skillId]);
     }
     await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    if(confirmation)pendingProposals.delete(user.key);
    json(await explorationResult(user));return;
   }
   if(url.pathname==='/api/explore'){json(await explorationResult(user));return;}
   if(url.pathname==='/api/agent-gateway/compare'){
    if(Object.keys(data).some(key=>key!=='ids'))throw problem(400,'Formulaire de comparaison invalide.');
    try{json(await agentGateway.compare(user.learnerId,data.ids,()=>explorationResult(user)));}
    catch(error){if(error instanceof AgentGatewayInputError)throw problem(400,error.message);throw error;}
    return;
   }
   if(url.pathname==='/api/rome/confirmations'){
    const result=await explorationResult(user);
    const direction=result.possibilities.find(item=>item.romeCode===data.codeRome);
    if(!direction || typeof data.ogr!=='string' || !direction.requirements.some(item=>item.romeOgr===data.ogr) ||
      !['practiced','not_yet','unsure'].includes(data.response))throw problem(400,'Exigence ROME indisponible.');
    const workExample=shortText(data.workExample??'',2000,'Exemple');
    if(data.response==='practiced' && workExample.length<5)throw problem(400,'Ajoutez un exemple concret.');
    const occupation=await rome.occupation(direction.romeCode);
    await exploration.confirmRomeRequirement(user.learnerId,data.ogr,occupation.releaseId,data.response,workExample);
    json(await explorationResult(user));return;
   }
   if(url.pathname==='/api/directions/compare'){
    const result=await explorationResult(user);
    if(!Array.isArray(data.ids) || data.ids.some(id=>typeof id!=='string'))throw problem(400,'Choisissez deux ou trois directions.');
    const directions=compareDirections(result.possibilities,data.ids);
    const requirementsComparison=directions.every(item=>item.romeCode)
      ? (await rome.compare(directions.map(item=>item.romeCode))).requirements : null;
    json({directions,requirementsComparison,coverageNote:result.coverageNote});return;
   }
   if(url.pathname==='/api/exploration/saved'){
    const result=await explorationResult(user);
    if(typeof data.directionId!=='string' || !result.possibilities.some(item=>item.id===data.directionId) || typeof data.saved!=='boolean')throw problem(400,'Direction indisponible.');
    await exploration.saveDirection(user.learnerId,data.directionId,data.saved);json({saved:await exploration.savedDirections(user.learnerId)});return;
   }
   if(url.pathname==='/api/development-actions/selected'){
   const result=await explorationResult(user),direction=result.possibilities.find(item=>item.id===data.directionId);
    const action=direction?.startingActions.find(item=>item.id===data.actionId);
    if(!direction || !action)throw problem(400,'Action indisponible.');
    await exploration.selectAction(user.learnerId,direction.id,action);
    json({selectedActions:await exploration.selectedActions(user.learnerId)});return;
   }
   if(url.pathname==='/api/feedback'){
    if(typeof data.useful!=='boolean' || (data.directionId!==null && data.directionId!==undefined &&
      !(await explorationResult(user)).possibilities.some(item=>item.id===data.directionId)))throw problem(400,'Retour invalide.');
    await exploration.feedback(user.learnerId,data.directionId??null,data.useful,shortText(data.comment??'',1000,'Commentaire'));
    json({recorded:true});return;
   }
   if(url.pathname==='/api/impressions'){
    const entry=displayed.get(user.key)?.get(data.requestId);if(!entry)throw problem(400,'Ce résultat a expiré.');
    if(!entry.recorded){entry.recording??=ranker.recordImpression(entry.result,'learner_screen',example);try{await entry.recording;entry.recorded=true;}catch(error){entry.recording=null;throw error;}}json({recorded:true});return;
   }
   if(url.pathname==='/api/assessment-launch'){
    if(!assessmentUrl)throw problem(409,'Aucun service d’évaluation n’est connecté. Vous pouvez déclarer votre niveau.');
    const profile=await target(data.occupationId);
    const result=await ranker.recommendFromEvidence({learnerId:user.learnerId,constraints:constraints(data.constraints)},profile.occupationId,{explorationProbability:0},'fr');
    const request=result.assessmentHandoff.requests.find(item=>item.skillId===data.skillId && item.action==='take_assessment');
    if(!request?.assessment)throw problem(409,'Cette évaluation n’est plus disponible.');
    const launch=new URL(assessmentUrl);launch.searchParams.set('skill',request.skillId);launch.searchParams.set('blueprint',request.assessment.blueprintId);
    // Identity/assessment scoring belongs to the configured host service. No learner identifiers are exposed in this URL.
    json({url:launch.href});return;
   }
   const profile=await target(data.occupationId),prefs=constraints(data.constraints);
   if(url.pathname==='/api/recommendations'){
    const client=await pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[user.learnerId]);
     await savePreferences(client,user,profile,prefs);await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    json(await recommendation(user,profile.occupationId,prefs));return;
   }
   if(url.pathname!=='/api/levels')throw problem(404,'Action introuvable.');
   if(!Array.isArray(data.declarations) || !data.declarations.length || data.declarations.length>40)throw problem(400,'Choisissez au moins un niveau.');
   const evidence=buildEvidenceProfile({learnerId:user.learnerId,constraints:prefs},await ranker.skillEvidence(user.learnerId));
   const current=await ranker.recommendForTarget(evidence.learnerState,profile.occupationId,{explorationProbability:0},'fr');
   const allowed=new Set([...profile.skills.map(s=>s.skillId),...current.assessmentHandoff.requests.map(s=>s.skillId)]),seen=new Set();
   const declarations=data.declarations.map(entry=>{
    if(!allowed.has(entry.skillId) || seen.has(entry.skillId) || !Number.isInteger(entry.level) || entry.level<0 || entry.level>4)throw problem(400,'Compétence ou niveau invalide.');seen.add(entry.skillId);
    const workExample=entry.level===0?'Je n’ai pas encore pratiqué cette compétence.':entry.workExample?.trim();
    if(typeof workExample!=='string' || workExample.length<5 || workExample.length>2000)throw problem(400,'Ajoutez un exemple de travail (5 à 2 000 caractères).');
    return {skillId:entry.skillId,level:entry.level,workExample};
   });
   const client=await pool.connect();
   try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[user.learnerId]);
    for(const entry of declarations){
     const id=randomUUID();await client.query(`INSERT INTO praxis.skill_evidence(id,learner_id,skill_id,level,evidence_type,confidence,provenance,observed_at)
       VALUES ($1,$2,$3,$4,'self_declared','low',$5::jsonb,clock_timestamp())`,[id,user.learnerId,entry.skillId,entry.level,JSON.stringify({source:'learner_screen',workExample:entry.workExample,targetOccupationId:profile.occupationId})]);
     await client.query(`UPDATE praxis.skill_evidence SET superseded_by=$1 WHERE learner_id=$2 AND skill_id=$3 AND evidence_type='self_declared' AND superseded_by IS NULL AND id<>$1`,[id,user.learnerId,entry.skillId]);
     await client.query(`INSERT INTO praxis.learner_prerequisite_declaration(learner_id,skill_id,declared_level,work_example)
       VALUES ($1,$2,$3,$4) ON CONFLICT(learner_id,skill_id) DO UPDATE SET declared_level=EXCLUDED.declared_level,work_example=EXCLUDED.work_example,updated_at=clock_timestamp()`,[user.learnerId,entry.skillId,entry.level,entry.workExample]);
    }
    await savePreferences(client,user,profile,prefs);
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
   json(await recommendation(user,profile.occupationId,prefs));
  }catch(error){const status=error.status??(error instanceof SurveyNotFoundError?404:
   error instanceof SurveyAnswerError || error instanceof SurveyStateError || error instanceof ContextValidationError ||
   error instanceof TypeError || error instanceof RangeError?400:500);
   if(status===500)console.error('Learner request failed:',error.message);
   json({error:status===500?'Le service est momentanément indisponible. Réessayez.':error.message},status);
  }
 });
 return server;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 const connectionString=process.env.DATABASE_URL;
 if(!connectionString)throw new Error('Set DATABASE_URL to a migrated Praxis database before starting the learner screen.');
 const pool=new pg.Pool({connectionString,max:5}),port=Number(process.env.PRAXIS_LEARNER_PORT??4173);
 await pool.query('SELECT level FROM praxis.skill_evidence LIMIT 0');
 const aiEndpoint=process.env.PRAXIS_AI_ENDPOINT;
 if(aiEndpoint && !/^https:\/\//.test(aiEndpoint))throw new Error('PRAXIS_AI_ENDPOINT must use HTTPS.');
 const aiProvider=aiEndpoint?async request=>{
  const response=await fetch(aiEndpoint,{method:'POST',headers:{'Content-Type':'application/json',
   ...(process.env.PRAXIS_AI_TOKEN?{Authorization:`Bearer ${process.env.PRAXIS_AI_TOKEN}`}:{})},
   body:JSON.stringify(request),signal:AbortSignal.timeout(4500)});
  if(!response.ok)throw new Error('AI provider unavailable');return response.json();
 }:null;
 const server=createLearnerServer({pool,example:process.env.PRAXIS_LEARNER_EXAMPLE==='true',assessmentUrl:process.env.PRAXIS_ASSESSMENT_URL??null,aiProvider});
 server.listen(port,'127.0.0.1',()=>console.log(`Praxis learner screen: http://127.0.0.1:${port}`));
 async function stop(){await new Promise(resolve=>server.close(resolve));await pool.end();process.exit(0);}
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
