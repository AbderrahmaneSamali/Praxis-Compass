import {createCareerReports} from './career-reports.js';
import {createCareerAgent} from './career-agent.js';
import {createCareerLevels} from './career-levels.js';
import {createDevelopmentActivities} from './development-activities.js';
import {createDevelopmentPlan} from './development-plan.js';
import {createCareerMap} from './career-map.js';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function sourceReference(reference){const parts=String(reference??'').split(':');if(parts[0]==='rome'){return parts[2]==='item'?`Exigence ${parts[3]} · France Travail`:`Fiche métier ${parts[2]??''} · France Travail`;}return reference??'';}
const state={csrf:'',catalog:[],interestCentres:[],occupations:[],choices:{},result:null,selected:new Set(),directionId:null,busy:false,profileDirty:false,mapFocus:null,proposalId:null,survey:null};
const labels={supported:'Soutenu par les preuves disponibles',development_needed:'À développer',unknown:'Non connu',conflicting:'Preuves contradictoires'};
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,7000);}
async function jsonResponse(response){let value;try{value=await response.json();}catch{throw new Error('Réponse du service illisible. Réessayez.');}if(!response.ok)throw new Error(value.error??'Une erreur est survenue.');return value;}
const get=path=>fetch(path).then(jsonResponse);
const post=(path,body)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Praxis-CSRF':state.csrf},body:JSON.stringify(body)}).then(jsonResponse);
$('#reset-session').addEventListener('click',()=>run(async()=>{await post('/api/session/reset',{});window.location.reload();}));
async function run(action){if(state.busy)return;state.busy=true;const buttonStates=[...document.querySelectorAll('button')].map(button=>[button,button.disabled]);buttonStates.forEach(([button])=>button.disabled=true);$('#status').textContent='Mise à jour en cours…';try{await action();$('#status').textContent='Votre exploration est à jour.';}catch(error){$('#status').textContent='Une action a échoué. Vos informations déjà enregistrées restent disponibles.';toast(error.message);}finally{state.busy=false;buttonStates.forEach(([button,disabled])=>{if(button.isConnected)button.disabled=disabled;});}}
const careerAgent=createCareerAgent($('#career-agent'),{get,post,notify:toast,openFocus:target=>openAgentFocus(target)});
const careerReports=createCareerReports($('#career-reports'),{get,post,notify:toast,onReport:id=>careerAgent.load(id)});
const careerLevels=createCareerLevels($('#career-levels'),{get,post,notify:toast});
function openPlanRequirement(ogr){show('detail');if([...$('#rome-requirement').options].some(o=>o.value===ogr)){$('#rome-requirement').value=ogr;$('#rome-confirmation-form').scrollIntoView({behavior:'smooth',block:'start'});}else toast('Cette exigence doit être évaluée dans le référentiel de niveau.');}
const developmentPlan=createDevelopmentPlan($('#development-plan'),{get,post,notify:toast,openRequirement:openPlanRequirement,
 openActivity:id=>developmentActivities.select(id)});
const developmentActivities=createDevelopmentActivities($('#development-activities'),{get,post,notify:toast,marketLabel:code=>state.result?.careerLevels.catalog.markets.find(m=>m.code===code)?.label??code,
 openRequirement:openPlanRequirement,onChanged:()=>developmentPlan.load(direction()?.romeCode)});
function direction(){return state.result?.possibilities.find(item=>item.id===state.directionId)??null;}
function show(view){if(view!=='profile'&&state.profileDirty){run(async()=>{await saveStartingProfile();show(view);});return;}if((view==='detail'||view==='action')&&!direction()){toast('Ouvrez d’abord une direction.');view='explore';}document.querySelectorAll('.view').forEach(node=>node.hidden=node.id!==`${view}-view`);document.querySelectorAll('.steps button').forEach(node=>{node.classList.toggle('active',node.dataset.view===view);if(node.dataset.view===view)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');});if(view==='report'){careerReports.load(state.result,[...state.selected].map(id=>id.replace(/^rome:/,'')));careerAgent.load();}if(view==='compare')renderCompare();if(view==='detail')renderDetail();if(view==='action')renderActions();window.scrollTo({top:$('.steps').offsetTop-20,behavior:'smooth'});}
function openDirection(id){state.directionId=id;show('detail');const rec=state.result.recommendations?.find(item=>item.directionId===id);if(rec?.nextStep.kind==='confirm'&&rec.nextStep.requirementId&&$('#rome-requirement'))$('#rome-requirement').value=rec.nextStep.requirementId;}
async function openAgentFocus(target){
 const focus=target.focus;
 if(focus.kind==='context'){show('profile');$('#career-market').focus();return;}
 const id='rome:'+target.code;
 if(!state.result?.possibilities.some(item=>item.id===id)){toast('Ce métier appartient à un ancien périmètre. Consultez son rapport enregistré.');return;}
 state.directionId=id;
 if(focus.kind==='exercise'&&focus.activityId){show('action');await developmentActivities.load(target.code);developmentActivities.select(focus.activityId);return;}
 if(focus.kind==='clarify'&&focus.skillOgr){show('detail');const field=$('#rome-requirement');if([...field.options].some(option=>option.value===focus.skillOgr)){field.value=focus.skillOgr;$('#rome-confirmation-form').scrollIntoView({behavior:'smooth',block:'start'});}return;}
 show('action');
}
function catalogSkills(){const map=new Map();for(const d of state.catalog)for(const s of d.requirements)map.set(s.skillId,s.label);return [...map].sort((a,b)=>a[1].localeCompare(b[1],'fr'));}
function renderProfile(){const profile=state.result.profile;
 const progression=state.result.careerLevels;
 $('#career-market').innerHTML='<option value="">Je préfère préciser plus tard</option>'+progression.catalog.markets.map(x=>`<option value="${esc(x.code)}">${esc(x.label)}</option>`).join('');
 $('#career-track').innerHTML='<option value="">Tous les parcours</option>'+progression.catalog.tracks.map(x=>`<option value="${esc(x.code)}">${esc(x.label)}</option>`).join('');
 $('#career-market').value=progression.preference.marketCode??'';$('#career-track').value=progression.preference.trackCode??'';renderTrackDescription();
 const current=profile.currentRomeCode;
 const domainPicker=$('#occupation-domain'),previousDomain=profile.preferredDomainCode??'';
 const domains=[...new Map(state.occupations.flatMap(job=>job.domains.map(domain=>[domain.code,domain]))).values()].sort((a,b)=>a.label.localeCompare(b.label,'fr'));
 domainPicker.innerHTML='<option value="">Tous les domaines</option>'+domains.map(item=>`<option value="${esc(item.code)}">${esc(item.label)}</option>`).join('');
 domainPicker.value=domains.some(item=>String(item.code)===previousDomain)?previousDomain:'';
 renderOccupationChoices(current);
 $('#rome-interests').innerHTML=state.interestCentres.map(item=>`<label><input type="checkbox" value="${item.code}" ${profile.confirmedInterestCodes?.includes(item.code)?'checked':''}>${esc(item.label)}</label>`).join('');
 const previousSkill=$('#skill-id').value;
 $('#skill-id').innerHTML=catalogSkills().map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('');
 if(catalogSkills().some(([id])=>id===previousSkill))$('#skill-id').value=previousSkill;
 const selected=state.result.evidence.selectedEvidence,byId=new Map(catalogSkills());
 const focused=selected.find(item=>item.skillId===$('#skill-id').value);$('#skill-level').value=focused?String(focused.level):'';$('#skill-practice-context').value=focused?.provenance?.practiceContextId??'';togglePracticeFields();
 $('#my-skills').innerHTML=selected.length?selected.map(item=>`<span class="chip">${esc(byId.get(item.skillId)??item.skillId)} · niveau ${item.level} · ${item.evidenceType==='self_declared'?'déclaré':'preuve enregistrée'} (${esc(item.confidence)})</span>`).join(''):'<span class="source-note">Aucun niveau renseigné. Vous pouvez explorer quand même.</span>';
}
function renderOccupationChoices(selected=$('#current-rome').value){
 const domain=$('#occupation-domain').value;
 const available=state.occupations.filter(job=>!domain||job.domains.some(item=>String(item.code)===domain));
 $('#current-rome').innerHTML='<option value="">Je préfère préciser plus tard</option>'+available.map(job=>`<option value="${esc(job.code)}">${esc(job.label)}</option>`).join('');
 $('#current-rome').value=available.some(job=>job.code===selected)?selected:'';
}
function renderChoiceOptions(){
 const populate=(selector,group,empty)=>{$(selector).innerHTML=(empty?`<option value="">${esc(empty)}</option>`:'')+(state.choices[group]??[]).map(item=>`<option value="${esc(['skill_level','requirement_response'].includes(group)?item.value:item.id)}">${esc(item.labelFr)}</option>`).join('');};
 populate('#skill-level','skill_level','Je ne sais pas encore');
 populate('#rome-response','requirement_response');
 populate('#skill-practice-context','practice_context','Choisir un contexte');
 populate('#rome-practice-context','practice_context','Choisir un contexte');
 populate('#feedback-reason','feedback_reason','Je préfère ne pas préciser');
 togglePracticeFields();
}
function togglePracticeFields(){
 for(const [prefix,active] of [['rome',$('#rome-response').value==='practiced'],['skill',Number($('#skill-level').value)>0]]){
  $('#'+prefix+'-practice-field').hidden=!active;$('#'+prefix+'-practice-context').required=active;
  if(!active)$('#'+prefix+'-practice-context').value='';
 }
}
$('#profile-form').addEventListener('change',()=>{state.profileDirty=true;$('#status').textContent='Choix modifiés : vos pistes seront recalculées en ouvrant l’exploration.';});
function renderTrackDescription(){$('#career-track-description').textContent=state.result?.careerLevels.catalog.tracks.find(x=>x.code===$('#career-track').value)?.description??'Expertise, pilotage de projets ou management : explorez des responsabilités différentes.';}
$('#career-track').addEventListener('change',renderTrackDescription);
$('#occupation-domain').addEventListener('change',()=>renderOccupationChoices());
$('#rome-response').addEventListener('change',togglePracticeFields);
$('#skill-level').addEventListener('change',togglePracticeFields);
function kindLabel(kind){return {adjacent_role:'MÉTIER ADJACENT',specialization:'SPÉCIALISATION',current_role_growth:'ÉVOLUTION DANS MON MÉTIER',rome_exploration:'PISTE MÉTIER'}[kind]??kind;}
function romeKindLabel(kind){return {savoir_faire:'Savoir-faire',savoir_etre:'Savoir-être',savoir:'Savoir'}[kind]??kind;}
function reasonLabel(reason){if(!reason)return 'Direction issue des fiches métiers de France Travail.';
 if(reason.kind==='rome_domain')return `Métier du domaine « ${reason.domainLabel} » que vous avez choisi.`;
 if(reason.kind==='rome_mobility')return 'Évolution possible depuis votre métier de départ, selon France Travail.';
 if(reason.kind==='rome_interest_centre')return `Centre d’intérêt confirmé : ${reason.centreLabel}${reason.principal?' (principal pour ce métier)':''}.`;
 if(reason.kind==='rome_shared_skills')return `${reason.sharedSkillOgrs.length} savoir-faire communs avec votre métier de départ.`;
 return 'Direction à explorer.';}
let careerMap;
function changeComparison(id,checked){
 if(checked && !state.selected.has(id) && state.selected.size>=3){toast('Comparez trois directions au maximum.');return;}
 if(checked)state.selected.add(id);else state.selected.delete(id);
 document.querySelectorAll('[data-compare]').forEach(input=>input.checked=state.selected.has(input.dataset.compare));
 careerMap?.syncSelection();
}
function renderCareerMap(){
 careerMap??=createCareerMap($('#career-map'),{request:options=>post('/api/exploration/graph',options),openCareer:openDirection,toggleCompare:changeComparison,selected:()=>state.selected,notify:toast});
 careerMap.update(state.result);
}
function renderExplore(){const result=state.result,recommendations=result.recommendations??[];$('#coverage').textContent=result.coverageNote;renderCareerMap();
 $('#possibilities').innerHTML=recommendations.length?recommendations.slice(0,3).map(rec=>{const item=result.possibilities.find(direction=>direction.id===rec.directionId);
  return `<article class="card recommendation-card"><p class="eyebrow">PISTE MÉTIER · ${rec.confirmedCount?`${rec.confirmedCount} pratique(s) déclarée(s)`:'PRATIQUE À CLARIFIER'}</p><h3>${esc(rec.title)}</h3><p class="ranking-note">${esc(rec.rankingNote)}</p><ul class="signal-list">${rec.signals.map(signal=>`<li>${esc(signal.label)}</li>`).join('')}</ul><div class="next-step"><strong>Prochain pas concret</strong><p>${esc(rec.nextStep.label)}</p></div><p class="source-note">${rec.unknownCount} exigence(s) encore inconnue(s). Liens issus des fiches métiers de France Travail; vos confirmations sont personnelles.</p><div class="card-actions"><button class="button primary small" type="button" data-open="${esc(rec.directionId)}">Voir la fiche et répondre →</button><button class="button secondary small save-toggle" type="button" data-save="${esc(rec.directionId)}" aria-pressed="${Boolean(item?.saved)}">${item?.saved?'Enregistrée ✓':'Enregistrer'}</button></div><label class="select-compare"><input type="checkbox" data-compare="${esc(rec.directionId)}" ${state.selected.has(rec.directionId)?'checked':''}> Comparer cette piste</label></article>`;
 }).join('')+(recommendations.length>3?`<details class="more-directions"><summary>Voir ${recommendations.length-3} autre(s) piste(s) de la carte</summary><div class="card-grid">${recommendations.slice(3).map(rec=>`<article class="card"><h3>${esc(rec.title)}</h3><p>${esc(rec.signals[0]?.label??'Lien avec votre point de départ')}</p><p><strong>Prochain pas :</strong> ${esc(rec.nextStep.label)}</p><button class="button secondary small" type="button" data-open="${esc(rec.directionId)}">Voir cette fiche</button><label class="select-compare"><input type="checkbox" data-compare="${esc(rec.directionId)}" ${state.selected.has(rec.directionId)?'checked':''}> Comparer cette piste</label></article>`).join('')}</div></details>`:''):'<div class="empty">Aucune piste liée à vos choix pour le moment. Sélectionnez un métier ou un centre d’intérêt dans votre point de départ.</div>';
 $('#questions').innerHTML=recommendations.length?`<h3>Pour rendre ces pistes plus précises</h3><p>La première question utile est : ${esc(recommendations[0].nextStep.label)}</p><button class="button secondary small" type="button" data-open="${esc(recommendations[0].directionId)}">Répondre sur cette fiche →</button>`:'<h3>Commencez par un choix structuré</h3><p>Votre métier et vos centres d’intérêt suffisent pour afficher les premiers liens.</p><button class="button secondary small" type="button" data-view="profile">Choisir mon point de départ →</button>';
}
async function renderCompare(){const ids=[...state.selected];if(ids.length<2){$('#comparison').innerHTML='<div class="empty">Choisissez au moins deux directions dans « Explorer les possibilités » pour les comparer.</div>';return;}
 try{const {directions,requirementsComparison}=await post('/api/directions/compare',{ids});const rows=[
  ['Responsabilités',d=>d.responsibilities.join(' · ')],
  ['Pratique déclarée',d=>d.transferableSkills.map(s=>`${s.label}${s.observedLevel===null?'':' (niveau '+s.observedLevel+')'}`).join(' · ')||'Aucune encore renseignée'],
  ['À développer',d=>d.requirements.filter(s=>s.state==='development_needed').map(s=>s.label).join(' · ')||'Aucun écart établi'],
  ['À clarifier',d=>d.requirements.filter(s=>s.state==='unknown'||s.disagreementResolution).map(s=>`${s.label} (${s.disagreementResolution?'preuves divergentes':'non connu'})`).join(' · ')||'Aucune dans les exigences renseignées'],
  ['Premier essai',d=>d.startingActions[0]?.title??'À définir']];
  if(requirementsComparison){rows.push(['Exigences communes',()=>requirementsComparison.common.slice(0,12).map(x=>x.label).join(' · ')||'Aucune']);rows.push(['Exigences propres',d=>(requirementsComparison.onlyIn[d.romeCode]??[]).slice(0,12).map(x=>x.label).join(' · ')||'Aucune']);}
  $('#comparison').innerHTML=`<div class="table-wrap"><table><thead><tr><th>À regarder</th>${directions.map(d=>`<th>${esc(d.title)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label,fn])=>`<tr><td>${esc(label)}</td>${directions.map(d=>`<td>${esc(fn(d))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="next"><button type="button" class="button secondary" data-gateway-compare>Résumer les points à clarifier</button></div><div id="gateway-comparison" aria-live="polite"></div>`;
 }catch(error){$('#comparison').innerHTML=`<div class="empty">${esc(error.message)}</div>`;}}
function renderDetail(){const item=direction();if(!item)return;careerLevels.load(item.romeCode);if(item.romeCode){renderRomeDetail(item);return;}$('#rome-confirmation-form').hidden=true;$('#detail-title').textContent=item.title;$('#detail-description').textContent=item.description;
 const groups=[['supported','Forces indiquées'],['development_needed','Compétences à développer'],['unknown','À éclaircir'],['conflicting','Preuves contradictoires']];
 $('#detail-content').innerHTML=`<div class="detail-grid"><div><div class="state-group"><h3>Ce que ce métier implique</h3><ul>${item.responsibilities.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><h3>Pourquoi cette piste apparaît</h3><ul>${item.reasonsToExplore.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div><div class="state-group"><h3>Sources et limites</h3>${item.sources.map(s=>`<p class="source-note">${esc(s.label)} · ${esc(s.reference)} · ${s.reviewStatus==='reviewed'?'revu':'démonstration non revue'}</p>`).join('')}<p class="source-note">Les niveaux déclarés répondent à une comparaison, mais ne prouvent pas une maîtrise vérifiée.</p></div></div><div>${groups.map(([state,label])=>`<div class="state-group"><h3>${label}</h3>${item.requirements.filter(r=>r.state===state).map(r=>`<div class="requirement ${state}"><strong>${esc(r.label)}</strong>Niveau attendu : ${r.targetLevel} · ${labels[state]}${r.observedLevel!==null?` · niveau indiqué : ${r.observedLevel}`:''}<br><small>${r.evidenceType?`Preuve : ${esc(r.evidenceType)} · force ${esc(r.evidenceStrength)}`:'Aucun niveau établi'} · source : ${esc(r.source.reference)}</small></div>`).join('')||'<p class="source-note">Aucune compétence dans cette catégorie.</p>'}</div>`).join('')}</div></div><div class="next"><button type="button" class="button primary" data-view="action">Choisir un premier pas →</button></div>`;
 if(item.uncertainties.length)$('#detail-content').insertAdjacentHTML('beforeend',`<div class="question-box"><h3>Points à clarifier</h3><ul>${item.uncertainties.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`);
}
function renderRomeDetail(item){
 $('#detail-title').textContent=item.title;$('#detail-description').textContent=item.romeProfile?.definition?.[0]??item.description;
 const reasons=[...new Set((item.reasons??[]).map(reason=>reasonLabel(reason)))].map(label=>`<li>${esc(label)}</li>`).join('');
 const groups=[['supported','Pratiquées selon votre déclaration'],['development_needed','Pas encore pratiquées'],['unknown','À éclaircir'],['conflicting','Déclarations contradictoires']];
 const rec=state.result.recommendations?.find(value=>value.directionId===item.id);
 const requirementRow=(r,status)=>`<div class="requirement ${status}"><strong>${esc(r.label)}</strong><small>${esc(romeKindLabel(r.requirementKind))}</small></div>`;
 const requirementGroups=groups.map(([status,label])=>{const items=item.requirements.filter(r=>r.state===status);
  if(!items.length)return '';
  return `<section class="state-group"><h3>${esc(label)} <small>(${items.length})</small></h3>${items.slice(0,4).map(r=>requirementRow(r,status)).join('')}${items.length>4?`<details class="requirement-more"><summary>Voir ${items.length-4} autre(s) exigence(s)</summary>${items.slice(4).map(r=>requirementRow(r,status)).join('')}</details>`:''}</section>`;
 }).join('');
 $('#detail-content').innerHTML=`${rec?`<div class="question-box"><h3>Le prochain point à vérifier</h3><p>${esc(rec.nextStep.label)}</p><p class="source-note">${rec.confirmedCount} pratique(s) déclarée(s), ${rec.unknownCount} exigence(s) encore inconnue(s).</p></div>`:''}<div class="detail-grid"><div><div class="state-group"><h3>Pourquoi cette piste apparaît</h3><ul>${reasons}</ul></div><div class="state-group"><h3>Contextes de travail</h3><ul>${(item.workContexts??[]).slice(0,4).map(x=>`<li>${esc(x.label)}</li>`).join('')||'<li>Non précisé</li>'}</ul></div><div class="state-group"><h3>Source et limite</h3><p>Fiches métiers de France Travail</p><p>Une confirmation personnelle ne prouve pas la maîtrise.</p></div></div><div>${requirementGroups}</div></div><div class="next"><button type="button" class="button primary" data-view="action">Choisir un premier pas →</button></div>`;
 const profile=item.romeProfile;
 if(profile)$('#detail-content').insertAdjacentHTML('beforeend',`<details class="source-details"><summary>Voir le profil complet du métier</summary><p><strong>Accès au métier</strong></p><ul>${profile.access.map(x=>`<li>${esc(x)}</li>`).join('')||'<li>Non précisé</li>'}</ul><p><strong>Centres d’intérêt :</strong> ${profile.interestCentres.map(x=>esc(x.label)).join(' · ')||'Non renseignés'}</p><p><strong>Secteurs :</strong> ${profile.sectors.map(x=>esc(x.parentLabel?`${x.parentLabel} › ${x.label}`:x.label)).join(' · ')||'Non renseignés'}</p><p><strong>Domaines :</strong> ${profile.professionalDomains.map(x=>esc(x.label)).join(' · ')||'Non renseignés'}</p><p><strong>Réglementé :</strong> ${profile.regulated?'oui':'non'}</p></details>`);
 const picker=$('#rome-requirement'),previous=picker.value;
 picker.innerHTML=item.requirements.map(r=>`<option value="${esc(r.romeOgr)}">${esc(r.label)} · ${esc(romeKindLabel(r.requirementKind))}</option>`).join('');
 if(item.requirements.some(r=>r.romeOgr===previous))picker.value=previous;
 $('#rome-confirmation-form').hidden=item.requirements.length===0;
}
function renderActions(){const item=direction();if(!item)return;
 developmentPlan.load(item.romeCode);
 $('#actions').hidden=Boolean(item.romeCode);$('#selected-actions').hidden=Boolean(item.romeCode);developmentActivities.load(item.romeCode);
 const context=state.result.careerContext,motivations={career_change:'Changer de métier',promotion:'Évoluer dans mon poste',employer_required:'Répondre à une demande de mon employeur',job_seeking:'Trouver un emploi',exploration:'Explorer sans urgence'};
 const contextNotes=[context?.motivation?`Projet : ${motivations[context.motivation]??context.motivation}`:null,context?.hoursPerWeek?`Temps déclaré pour explorer : ${context.hoursPerWeek} h par semaine`:null,context?.deadline?`Échéance souhaitée : ${new Date(context.deadline+'T00:00:00').toLocaleDateString('fr-FR')}`:null].filter(Boolean);
 $('#action-constraints').hidden=!contextNotes.length&&!state.result.profile.constraints;
 $('#action-constraints').innerHTML=`<h3>Choisir selon votre situation</h3>${contextNotes.length?`<p>${contextNotes.map(esc).join('<br>')}</p>`:''}${state.result.profile.constraints?`<p>${esc(state.result.profile.constraints)}</p>`:''}<p>Regardez les prérequis de chaque action. Vous pouvez préciser votre situation dans « Mon point de départ ».</p>`;
 $('#actions').innerHTML=item.startingActions.map(action=>`<article class="card"><p class="eyebrow">${esc(action.kind.toUpperCase().replace('_',' '))}</p><h3>${esc(action.title)}</h3><p>${esc(action.purpose)}</p>${[['À faire',action.instructions],['Résultat concret',action.output],['Pré-requis',action.prerequisites],['Comment juger le progrès',action.completionCriteria],['Ensuite',action.unlocks]].map(([name,value])=>`<p class="action-field"><strong>${name}</strong>${esc(value)}</p>`).join('')}<button class="button secondary small" type="button" data-action="${esc(action.id)}" ${state.result.selectedActions.includes(action.id)?'disabled':''}>${state.result.selectedActions.includes(action.id)?'Action choisie ✓':'Choisir cette action'}</button></article>`).join('');
 const selected=state.result.selectedActions;
 $('#selected-actions').innerHTML=`<h3>Mes actions enregistrées</h3>${selected.length?`<ul>${selected.map(id=>{const match=state.result.possibilities.flatMap(d=>d.startingActions).find(a=>a.id===id);return `<li>${esc(match?.title??id)}</li>`;}).join('')}</ul>`:'<p>Aucune action choisie pour le moment.</p>'}`;
}
function renderSurvey(){const area=$('#survey-area'),survey=state.survey;
 if(!survey){area.innerHTML='<button class="button secondary" type="button" data-survey="start">Commencer les questions</button>';return;}
 const summary=survey.summary.length?`<div class="survey-summary"><h4>Votre récapitulatif</h4><ul>${survey.summary.map(x=>`<li><strong>${esc(x.labelFr)}</strong> ${esc(x.answerLabelFr)}</li>`).join('')}</ul></div>`:'';
 if(survey.status!=='in_progress'){area.innerHTML=`<p>${survey.status==='completed'?'Situation enregistrée.':'Ce questionnaire a été remplacé.'}</p>${summary}<button class="button secondary" type="button" data-survey="start">${survey.status==='completed'?'Mettre à jour ma situation':'Recommencer'}</button>`;return;}
 const question=survey.question;
 const progress=`<p class="source-note">${survey.progress.remaining} question(s) possible(s) encore. Vous pouvez terminer maintenant.</p>`;
 if(!question){area.innerHTML=`${progress}${summary}<button class="button primary" type="button" data-survey="complete">Enregistrer ma situation</button><button class="button secondary" type="button" data-survey="back" ${survey.canUndo?'':'disabled'}>Revenir en arrière</button>`;return;}
 const choices=question.options.map(option=>`<label class="survey-choice"><input type="radio" name="survey-choice" value="${esc(option.value)}" ${String(question.current?.value)===option.value?'checked':''}><span>${esc(option.labelFr)}${option.detailFr?`<small>${esc(option.detailFr)}</small>`:''}</span></label>`).join('');
 area.innerHTML=`${progress}<form id="survey-form"><fieldset><legend>${esc(question.promptFr)}</legend>${question.helpFr?`<p class="source-note">${esc(question.helpFr)}</p>`:''}${question.triggeredBy.length?`<p class="source-note">Suite à : ${question.triggeredBy.map(x=>esc(x.answerLabelFr)).join(' · ')}</p>`:''}<div class="survey-choices">${choices}</div></fieldset><div class="survey-controls"><button class="button primary" type="submit">Continuer</button><button class="button secondary" type="button" data-survey="skip">Passer cette question</button><button class="button secondary" type="button" data-survey="back" ${survey.canUndo?'':'disabled'}>Retour</button><button class="button secondary" type="button" data-survey="complete">Terminer maintenant</button></div></form>${summary}`;
}
async function refresh(){state.result=await post('/api/explore',{});const available=new Set(state.result.possibilities.map(item=>item.id));state.selected=new Set([...state.selected].filter(id=>available.has(id)));if(state.directionId&&!direction())state.directionId=null;renderProfile();renderExplore();if(!$('#detail-view').hidden)renderDetail();if(!$('#action-view').hidden)renderActions();if(!$('#report-view').hidden)careerReports.load(state.result);}
$('#survey-area').addEventListener('submit',event=>{if(event.target.id!=='survey-form')return;event.preventDefault();run(async()=>{const question=state.survey.question,selected=$('#survey-form input[name="survey-choice"]:checked');const value=selected?.value;if(value===undefined||value==='')throw new Error('Choisissez une réponse ou passez cette question.');const result=await post('/api/context-survey/answer',{sessionId:state.survey.sessionId,questionId:question.id,value});state.survey=result.survey;renderSurvey();});});
$('#survey-area').addEventListener('click',event=>{const action=event.target.closest('button')?.dataset.survey;if(!action)return;run(async()=>{let result;if(action==='start')result=await post('/api/context-survey/start',{});else if(action==='skip')result=await post('/api/context-survey/answer',{sessionId:state.survey.sessionId,questionId:state.survey.question.id,declined:true});else if(action==='back')result=await post('/api/context-survey/back',{sessionId:state.survey.sessionId});else if(action==='complete')result=await post('/api/context-survey/complete',{sessionId:state.survey.sessionId});state.survey=result.survey;renderSurvey();if(action==='complete'){await refresh();toast('Votre situation est enregistrée.');}});});
async function saveStartingProfile(){
 await post('/api/career/preferences',{marketCode:$('#career-market').value||null,trackCode:$('#career-track').value||null});
 await post('/api/profile',{currentRomeCode:$('#current-rome').value||null,preferredDomainCode:$('#occupation-domain').value||null,confirmedInterestCodes:[...document.querySelectorAll('#rome-interests input:checked')].map(input=>Number(input.value))});
 await refresh();state.profileDirty=false;
}
$('#profile-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{await saveStartingProfile();toast('Choix enregistrés et pistes recalculées.');});});
$('#rome-confirmation-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{const item=direction();if(!item?.romeCode)throw new Error('Ouvrez une fiche métier.');await post('/api/rome/confirmations',{codeRome:item.romeCode,ogr:$('#rome-requirement').value,response:$('#rome-response').value,practiceContextId:$('#rome-response').value==='practiced'?$('#rome-practice-context').value:null});await refresh();$('#rome-practice-context').value='';toast('Confirmation enregistrée.');});});
$('#skills-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{if($('#skill-level').value==='')throw new Error('Choisissez un niveau ou laissez cette compétence non connue.');await post('/api/profile/skills',{declarations:[{skillId:$('#skill-id').value,level:Number($('#skill-level').value),practiceContextId:Number($('#skill-level').value)>0?$('#skill-practice-context').value:null}]});await refresh();$('#skill-practice-context').value='';toast('Déclaration enregistrée.');});});
$('#skill-id').addEventListener('change',()=>{const found=state.result?.evidence.selectedEvidence.find(e=>e.skillId===$('#skill-id').value);$('#skill-level').value=found?String(found.level):'';$('#skill-practice-context').value=found?.provenance?.practiceContextId??'';togglePracticeFields();});
document.addEventListener('click',event=>{const mapNode=event.target.closest?.('[data-map-focus]');if(mapNode&&!state.busy){state.mapFocus=mapNode.dataset.mapFocus;renderCareerMap();document.querySelector(`[data-map-focus="${state.mapFocus}"]`)?.focus();return;}const button=event.target.closest('button');if(!button||state.busy)return;if(button.dataset.open){openDirection(button.dataset.open);}else if(button.hasAttribute('data-gateway-compare')){run(async()=>{const result=await post('/api/agent-gateway/compare',{ids:[...state.selected]});$('#gateway-comparison').innerHTML=`<div class="question-box"><h3>Points à clarifier avant de choisir</h3>${result.directions.map(item=>`<div class="state-group"><h4>${esc(item.title)}</h4><p>${item.requirements.counts.supported} pratique(s) déclarée(s) · ${item.requirements.counts.developmentNeeded} à développer · ${item.requirements.counts.unknown} à clarifier</p><ul>${item.requirements.toClarify.map(requirement=>`<li>${esc(requirement.label)} · ${esc(sourceReference(requirement.sourceReference))}</li>`).join('')||'<li>Aucun point inconnu dans les exigences disponibles.</li>'}</ul><p class="source-note">${item.sources.map(source=>`${esc(source.label)} · ${esc(sourceReference(source.reference))}`).join(' ; ')||'Sources non revues'}</p></div>`).join('')}<p class="source-note">${esc(result.note)}</p></div>`;});}else if(button.dataset.save){run(async()=>{const item=state.result.possibilities.find(d=>d.id===button.dataset.save);await post('/api/exploration/saved',{directionId:item.id,saved:!item.saved});await refresh();toast(item.saved?'Direction retirée.':'Direction enregistrée.');});}else if(button.dataset.action){run(async()=>{await post('/api/development-actions/selected',{directionId:state.directionId,actionId:button.dataset.action});await refresh();toast('Premier pas enregistré.');});}else if(button.dataset.view)show(button.dataset.view);});
document.addEventListener('change',event=>{if(!event.target.dataset.compare)return;changeComparison(event.target.dataset.compare,event.target.checked);event.target.checked=state.selected.has(event.target.dataset.compare);});
$('#feedback-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{const form=new FormData(event.target);await post('/api/feedback',{directionId:state.directionId,useful:form.get('useful')==='yes',reasonId:$('#feedback-reason').value||null});event.target.reset();toast('Merci pour votre retour.');});});
await run(async()=>{const bootstrap=await get('/api/bootstrap');state.csrf=bootstrap.csrf;const [profile,interestResponse,surveyResponse,occupationResponse,choiceResponse]=await Promise.all([get('/api/profile'),get('/api/rome/interests'),get('/api/context-survey/latest'),get('/api/occupation-choices'),get('/api/learner-choices')]);state.occupations=occupationResponse.occupations;state.choices=choiceResponse.choices;renderChoiceOptions();state.catalog=profile.directions;state.interestCentres=interestResponse.interests;state.survey=surveyResponse.survey;await refresh();renderSurvey();show(state.result.profile.updatedAt?'explore':'profile');});
